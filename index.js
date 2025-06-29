const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const axios = require("axios");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const friendsCharacters = require("./characters");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/images/players/");
    },
    filename: (req, file, cb) => {
        const uniqueName = `player_${Date.now()}_${file.originalname}`;
        cb(null, uniqueName);
    },
});
const upload = multer({ storage: storage });

// Setup
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enhanced game state with round-based mechanics
let gameState = {
    players: new Map(),
    aiPersonas: [],
    phase: "lobby", // 'lobby', 'night', 'day', 'discussion', 'voting', 'gameOver'
    round: 0,
    alivePlayers: [],
    eliminatedPlayers: [],
    votes: new Map(),
    mafiaTarget: null,
    doctorSave: null,
    detectiveCheck: null,
    phaseTimer: null,
    timeRemaining: 0,
    nightActions: new Map(), // Store night actions
    gameResults: {
        winner: null,
        reason: "",
    },
};

// Game configuration
const GAME_CONFIG = {
    nightPhaseDuration: 30, // 30 seconds for demo (normally 2-3 minutes)
    discussionDuration: 180, // 3 minutes
    votingDuration: 60, // 1 minute
    minPlayers: 4,
    maxPlayers: 8,
};

// ElevenLabs API function
async function generateVoice(text, voiceId) {
    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text: text,
                model_id: "eleven_monolingual_v1",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5,
                },
            },
            {
                headers: {
                    Accept: "audio/mpeg",
                    "Content-Type": "application/json",
                    "xi-api-key": process.env.ELEVENLABS_API_KEY,
                },
                responseType: "arraybuffer",
            },
        );
        return Buffer.from(response.data);
    } catch (error) {
        console.error("ElevenLabs API Error:", error.message);
        return null;
    }
}

// Enhanced MCP Manager with role-based responses
class MCPManager {
    constructor() {
        this.conversations = new Map();
        this.gameContext = null;
    }

    setGameContext(context) {
        this.gameContext = context;
    }

    generateResponse(character, context, gamePhase) {
        const characterData = friendsCharacters[character];
        const conversation = this.conversations.get(character) || [];

        let response = this.selectContextualResponse(
            characterData,
            context,
            gamePhase,
        );

        conversation.push({ role: "system", content: context });
        conversation.push({ role: "assistant", content: response });
        this.conversations.set(character, conversation.slice(-10));

        return response;
    }

    selectContextualResponse(characterData, context, gamePhase) {
        const { traits, catchphrases, mafiaRole } = characterData;

        // Phase-specific responses
        if (gamePhase === "night") {
            if (mafiaRole === "mafia") {
                return "The night is perfect for... activities. *whispers suspiciously*";
            } else if (mafiaRole === "doctor") {
                return "I need to protect someone tonight. Who needs my help?";
            } else if (mafiaRole === "detective") {
                return "Time to investigate. Someone here isn't who they seem...";
            }
            return "It's so quiet tonight... too quiet.";
        }

        if (gamePhase === "discussion") {
            if (context.includes("eliminated")) {
                const responses = [
                    "This is terrible! We need to find who did this!",
                    "The mafia struck again. We must be more careful.",
                    "Someone among us is not who they seem...",
                ];
                return responses[Math.floor(Math.random() * responses.length)];
            }
        }

        if (context.includes("accused")) {
            if (mafiaRole === "mafia") {
                return "Me? That's ridiculous! I would never hurt anyone here!";
            } else {
                return "I'm innocent! You're making a huge mistake!";
            }
        }

        // Default character-specific responses
        return catchphrases[Math.floor(Math.random() * catchphrases.length)];
    }
}

const mcpManager = new MCPManager();

// Game Logic Functions
function initializeGame() {
    // Assign roles to AI personas randomly
    const roles = [
        "mafia",
        "mafia",
        "doctor",
        "detective",
        "townsfolk",
        "townsfolk",
    ];
    const shuffledRoles = roles.sort(() => Math.random() - 0.5);

    gameState.aiPersonas.forEach((persona, index) => {
        persona.role = shuffledRoles[index] || "townsfolk";
        persona.isAlive = true;
        persona.votes = 0;
    });

    // Add human player as townsfolk
    gameState.players.forEach((player) => {
        player.role = "townsfolk";
        player.isAlive = true;
        player.votes = 0;
    });

    updateAlivePlayers();
    gameState.phase = "night";
    gameState.round = 1;

    console.log(
        "Game initialized with roles:",
        gameState.aiPersonas.map((p) => `${p.name}: ${p.role}`),
    );
}

function updateAlivePlayers() {
    gameState.alivePlayers = [
        ...Array.from(gameState.players.values()).filter((p) => p.isAlive),
        ...gameState.aiPersonas.filter((p) => p.isAlive),
    ];
}

function startPhase(phase, duration) {
    gameState.phase = phase;
    gameState.timeRemaining = duration;

    // Clear previous timer
    if (gameState.phaseTimer) {
        clearInterval(gameState.phaseTimer);
    }

    // Start new timer
    gameState.phaseTimer = setInterval(() => {
        gameState.timeRemaining--;

        // Send timer update to all clients
        io.emit("timer-update", {
            phase: gameState.phase,
            timeRemaining: gameState.timeRemaining,
        });

        if (gameState.timeRemaining <= 0) {
            clearInterval(gameState.phaseTimer);
            handlePhaseEnd();
        }
    }, 1000);

    // Notify clients of phase change
    io.emit("phase-change", {
        phase: gameState.phase,
        round: gameState.round,
        timeRemaining: gameState.timeRemaining,
    });
}

function handlePhaseEnd() {
    switch (gameState.phase) {
        case "night":
            processNightActions();
            break;
        case "discussion":
            startVotingPhase();
            break;
        case "voting":
            processVotes();
            break;
    }
}

function processNightActions() {
    let narrative = `**Round ${gameState.round} - Night Results:**\n\n`;

    // Mafia action (AI chooses randomly among alive non-mafia)
    const aliveMafia = gameState.aiPersonas.filter(
        (p) => p.isAlive && p.role === "mafia",
    );
    const aliveTargets = gameState.alivePlayers.filter(
        (p) => p.role !== "mafia",
    );

    if (aliveMafia.length > 0 && aliveTargets.length > 0) {
        const target =
            aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
        gameState.mafiaTarget = target;
        narrative += `🔪 The mafia targeted ${target.name || target.playerName}...\n`;
    }

    // Doctor action (AI chooses randomly)
    const aliveDoctor = gameState.aiPersonas.find(
        (p) => p.isAlive && p.role === "doctor",
    );
    if (aliveDoctor) {
        const saveTarget =
            gameState.alivePlayers[
                Math.floor(Math.random() * gameState.alivePlayers.length)
            ];
        gameState.doctorSave = saveTarget;
        narrative += `💊 The doctor protected someone...\n`;
    }

    // Detective action (AI investigates randomly)
    const aliveDetective = gameState.aiPersonas.find(
        (p) => p.isAlive && p.role === "detective",
    );
    if (aliveDetective) {
        const checkTarget =
            gameState.alivePlayers[
                Math.floor(Math.random() * gameState.alivePlayers.length)
            ];
        gameState.detectiveCheck = checkTarget;
        narrative += `🔍 The detective investigated someone...\n`;
    }

    // Resolve actions
    let eliminated = null;
    if (
        gameState.mafiaTarget &&
        gameState.mafiaTarget !== gameState.doctorSave
    ) {
        eliminated = gameState.mafiaTarget;
        eliminated.isAlive = false;
        gameState.eliminatedPlayers.push(eliminated);
        narrative += `💀 ${eliminated.name || eliminated.playerName} was eliminated!\n`;
    } else if (
        gameState.mafiaTarget &&
        gameState.mafiaTarget === gameState.doctorSave
    ) {
        narrative += `🛡️ The doctor's protection saved a life!\n`;
    }

    updateAlivePlayers();

    // Check win conditions
    if (checkWinConditions()) {
        return;
    }

    // Start day phase
    io.emit("night-results", {
        narrative: narrative,
        eliminated: eliminated,
        detectiveResult: gameState.detectiveCheck
            ? {
                  target:
                      gameState.detectiveCheck.name ||
                      gameState.detectiveCheck.playerName,
                  isMafia: gameState.detectiveCheck.role === "mafia",
              }
            : null,
    });

    startPhase("discussion", GAME_CONFIG.discussionDuration);
}

function startVotingPhase() {
    gameState.votes.clear();
    startPhase("voting", GAME_CONFIG.votingDuration);

    // AI votes randomly
    setTimeout(() => {
        gameState.aiPersonas
            .filter((p) => p.isAlive)
            .forEach((persona) => {
                const targets = gameState.alivePlayers.filter(
                    (p) => p !== persona,
                );
                if (targets.length > 0) {
                    const target =
                        targets[Math.floor(Math.random() * targets.length)];
                    gameState.votes.set(
                        persona.name,
                        target.name || target.playerName,
                    );
                }
            });

        io.emit("ai-votes-cast", Array.from(gameState.votes.entries()));
    }, 2000);
}

function processVotes() {
    const voteCount = new Map();

    // Count votes
    gameState.votes.forEach((target, voter) => {
        voteCount.set(target, (voteCount.get(target) || 0) + 1);
    });

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedPlayer = null;
    let tiedPlayers = [];

    voteCount.forEach((votes, playerName) => {
        if (votes > maxVotes) {
            maxVotes = votes;
            eliminatedPlayer = playerName;
            tiedPlayers = [playerName];
        } else if (votes === maxVotes) {
            tiedPlayers.push(playerName);
        }
    });

    // Handle ties (random elimination for demo)
    if (tiedPlayers.length > 1) {
        eliminatedPlayer =
            tiedPlayers[Math.floor(Math.random() * tiedPlayers.length)];
    }

    // Eliminate player
    if (eliminatedPlayer) {
        const player = gameState.alivePlayers.find(
            (p) =>
                p.name === eliminatedPlayer ||
                p.playerName === eliminatedPlayer,
        );

        if (player) {
            player.isAlive = false;
            gameState.eliminatedPlayers.push(player);

            updateAlivePlayers();

            io.emit("player-eliminated", {
                playerName: eliminatedPlayer,
                role: player.role,
                votes: maxVotes,
                voteBreakdown: Array.from(voteCount.entries()),
            });

            // Check win conditions
            if (checkWinConditions()) {
                return;
            }
        }
    }

    // Start next round
    gameState.round++;
    gameState.mafiaTarget = null;
    gameState.doctorSave = null;
    gameState.detectiveCheck = null;

    setTimeout(() => {
        startPhase("night", GAME_CONFIG.nightPhaseDuration);
    }, 3000);
}

function checkWinConditions() {
    const aliveMafia = gameState.alivePlayers.filter(
        (p) => p.role === "mafia",
    ).length;
    const aliveInnocents = gameState.alivePlayers.filter(
        (p) => p.role !== "mafia",
    ).length;

    if (aliveMafia === 0) {
        // Innocents win
        gameState.gameResults = {
            winner: "innocents",
            reason: "All mafia members have been eliminated!",
        };
        endGame();
        return true;
    } else if (aliveMafia >= aliveInnocents) {
        // Mafia wins
        gameState.gameResults = {
            winner: "mafia",
            reason: "The mafia now controls the town!",
        };
        endGame();
        return true;
    }

    return false;
}

function endGame() {
    gameState.phase = "gameOver";

    if (gameState.phaseTimer) {
        clearInterval(gameState.phaseTimer);
    }

    io.emit("game-over", {
        results: gameState.gameResults,
        finalStats: {
            rounds: gameState.round,
            survivors: gameState.alivePlayers.map((p) => ({
                name: p.name || p.playerName,
                role: p.role,
            })),
            eliminated: gameState.eliminatedPlayers.map((p) => ({
                name: p.name || p.playerName,
                role: p.role,
            })),
        },
    });
}

// Routes
app.get("/", (req, res) => {
    res.render("index");
});

app.post("/start-game", upload.single("playerPhoto"), (req, res) => {
    const playerName = req.body.playerName;
    const playerPhoto = req.file ? req.file.filename : "default-player.jpg";

    const playerId = uuidv4();
    gameState.players.set(playerId, {
        id: playerId,
        playerName: playerName,
        photo: playerPhoto,
        role: "townsfolk",
        isAlive: true,
        votes: 0,
    });

    res.redirect(`/game?playerId=${playerId}`);
});

app.get("/game", (req, res) => {
    const playerId = req.query.playerId;
    const player = gameState.players.get(playerId);

    if (!player) {
        return res.redirect("/");
    }

    // Initialize AI personas if not already done
    if (gameState.aiPersonas.length === 0) {
        const selectedCharacters = Object.keys(friendsCharacters).slice(0, 6);
        gameState.aiPersonas = selectedCharacters.map((name) => ({
            name,
            ...friendsCharacters[name],
            isAlive: true,
            role: "townsfolk",
        }));
    }

    res.render("game", {
        personas: gameState.aiPersonas,
        player,
        gameState: {
            phase: gameState.phase,
            round: gameState.round,
            alivePlayers: gameState.alivePlayers.length,
        },
    });
});

// Socket.io connection handling
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Send current game state to new connection
    socket.emit("game-state-update", {
        phase: gameState.phase,
        round: gameState.round,
        timeRemaining: gameState.timeRemaining,
        alivePlayers: gameState.alivePlayers.map((p) => ({
            name: p.name || p.playerName,
            isAlive: p.isAlive,
        })),
    });

    // Start game when enough players join
    socket.on("start-game", () => {
        if (gameState.phase === "lobby" && gameState.players.size >= 1) {
            initializeGame();
            startPhase("night", GAME_CONFIG.nightPhaseDuration);
        }
    });

    // Handle voice input with phase-appropriate responses
    socket.on("voice-input", async (data) => {
        const { transcript, targetCharacter } = data;

        const context = `Phase: ${gameState.phase}, Round: ${gameState.round}, Input: ${transcript}`;
        const aiResponse = mcpManager.generateResponse(
            targetCharacter,
            context,
            gameState.phase,
        );

        const audioBuffer = await generateVoice(
            aiResponse,
            friendsCharacters[targetCharacter].voiceId,
        );

        io.emit("character-speaking", {
            character: targetCharacter,
            dialogue: aiResponse,
            audio: audioBuffer ? audioBuffer.toString("base64") : null,
        });
    });

    // Handle voting (only during voting phase)
    socket.on("vote", (data) => {
        if (gameState.phase !== "voting") {
            socket.emit("error", "Voting is only allowed during voting phase!");
            return;
        }

        const { playerId, targetCharacter } = data;
        const player = gameState.players.get(playerId);

        if (player && player.isAlive) {
            gameState.votes.set(player.playerName, targetCharacter);

            io.emit("vote-cast", {
                voter: player.playerName,
                target: targetCharacter,
            });
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
