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
    votingHistory: [], // Store all voting rounds for the current game
    gameResults: {
        winner: null,
        reason: "",
    },
};

// Game configuration
const GAME_CONFIG = {
    nightPhaseDuration: 10, // 10 seconds (reduced by 3x from 30)
    discussionDuration: 90, // 90 seconds (reduced by 2x from 180)
    votingDuration: 20, // 20 seconds (reduced by 3x from 60)
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

// Enhanced MCP Manager with contextual mafia responses and chat history
class MCPManager {
    constructor() {
        this.conversations = new Map();
        this.gameHistory = []; // Store all game conversations
    }

    generateResponse(character, userInput, gameContext) {
        const characterData = friendsCharacters[character];
        const conversation = this.conversations.get(character) || [];
        
        // Add user input to conversation history
        conversation.push({ 
            role: "user", 
            content: userInput,
            timestamp: new Date(),
            speaker: gameContext.playerName || "Player"
        });
        
        // Generate contextual response
        let response = this.selectContextualResponse(character, characterData, userInput, gameContext, conversation);
        
        // Add AI response to conversation history
        conversation.push({ 
            role: "assistant", 
            content: response,
            timestamp: new Date(),
            speaker: character
        });
        
        // Store in game history for chat display
        this.gameHistory.push({
            character: gameContext.playerName || "Player",
            message: userInput,
            timestamp: new Date(),
            type: "player"
        });
        
        this.gameHistory.push({
            character: character,
            message: response,
            timestamp: new Date(),
            type: "ai"
        });
        
        this.conversations.set(character, conversation.slice(-20)); // Keep last 20 exchanges
        
        return response;
    }

    selectContextualResponse(character, characterData, userInput, gameContext, conversation) {
        const { traits, catchphrases, mafiaRole } = characterData;
        const phase = gameContext.phase;
        const round = gameContext.round;
        
        // Analyze conversation context
        const recentMessages = conversation.slice(-6);
        const suspiciousKeywords = ['suspicious', 'mafia', 'kill', 'eliminate', 'vote', 'accuse'];
        const hasBeenAccused = recentMessages.some(msg => 
            msg.content.toLowerCase().includes('accuse') && msg.role === 'user'
        );
        
        // Character-specific responses based on role and personality
        if (character === 'Joey') {
            return this.getJoeyResponse(userInput, phase, hasBeenAccused, gameContext);
        } else if (character === 'Phoebe') {
            return this.getPhoebeResponse(userInput, phase, mafiaRole, gameContext);
        } else if (character === 'Chandler') {
            return this.getChandlerResponse(userInput, phase, mafiaRole, gameContext);
        } else if (character === 'Rachel') {
            return this.getRachelResponse(userInput, phase, hasBeenAccused, gameContext);
        } else if (character === 'Ross') {
            return this.getRossResponse(userInput, phase, gameContext);
        } else if (character === 'Monica') {
            return this.getMonicaResponse(userInput, phase, mafiaRole, gameContext);
        }
        
        return catchphrases[Math.floor(Math.random() * catchphrases.length)];
    }

    getJoeyResponse(userInput, phase, hasBeenAccused, gameContext) {
        if (hasBeenAccused) {
            return "Whoa, whoa, whoa! Me? I would never hurt anyone! I'm just here for the sandwiches, okay?";
        }
        
        if (userInput.toLowerCase().includes('food') || userInput.toLowerCase().includes('sandwich')) {
            return "Did someone say food? Look, I don't know about this mafia stuff, but Joey doesn't share food!";
        }
        
        if (phase === 'night') {
            return "It's so quiet... I'm kinda hungry. Anyone else thinking about late night snacks right now?";
        }
        
        if (phase === 'discussion') {
            const responses = [
                "I don't really understand this whole mafia thing, but someone's being really mean, right?",
                "How you doin'? I mean, besides the whole someone-might-be-evil thing.",
                "Can we talk about this over pizza? I think better when I'm eating.",
                "I'm confused. Who's the bad guy again? And why can't we all just get along?"
            ];
            return responses[Math.floor(Math.random() * responses.length)];
        }
        
        if (phase === 'voting') {
            return "Voting? Like for class president? I never understood politics. Can't we just rock-paper-scissors?";
        }
        
        return "How you doin'? This whole situation is making me nervous. And hungry.";
    }

    getPhoebeResponse(userInput, phase, mafiaRole, gameContext) {
        if (mafiaRole === 'mafia') {
            if (phase === 'night') {
                return "*humming mysteriously* The spirits are telling me... interesting things tonight.";
            }
            if (userInput.toLowerCase().includes('accuse')) {
                return "Accusing me? That's like, really bad karma. The universe doesn't like when people point fingers.";
            }
        }
        
        if (userInput.toLowerCase().includes('song') || userInput.toLowerCase().includes('music')) {
            return "Smelly cat, smelly cat, what are they feeding you? Wait, that's not about mafia... or is it?";
        }
        
        if (phase === 'discussion') {
            const responses = [
                "I had a dream about this! There was a dark aura around someone, but I can't remember who...",
                "My grandmother's spirit is trying to tell me something, but she's being really cryptic.",
                "The vibes in here are so intense. Someone's definitely hiding something negative.",
                "I don't like accusing people, but my crystals are pointing toward... someone suspicious."
            ];
            return responses[Math.floor(Math.random() * responses.length)];
        }
        
        return "Oh, this is like that time I helped the police catch that guy! Except more confusing.";
    }

    getChandlerResponse(userInput, phase, mafiaRole, gameContext) {
        if (mafiaRole === 'detective') {
            if (phase === 'night') {
                return "Could this BE any more mysterious? I'm trying to figure out who's who here...";
            }
            if (phase === 'discussion') {
                return "So let me get this straight - someone here is pretending to be innocent? In MY statistical analysis, the odds are... well, complicated.";
            }
        }
        
        if (userInput.toLowerCase().includes('accuse')) {
            return "Could this BE any more dramatic? I'm being accused? What's next, someone's gonna blame me for the '94 Rangers loss?";
        }
        
        if (phase === 'voting') {
            return "So we're voting people off? Could this BE any more like a really twisted game show?";
        }
        
        const responses = [
            "Could this mafia situation BE any more confusing? I process data, not... whatever this is.",
            "I'm not great at reading people. Could I interest you in some statistical analysis instead?",
            "This is like my job, except instead of boring reports, people might actually die. Fun!",
            "Hi, I'm Chandler. I make jokes when I'm terrified of being murdered."
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    }

    getRachelResponse(userInput, phase, hasBeenAccused, gameContext) {
        if (hasBeenAccused) {
            return "Excuse me? I am NOT mafia! I work in fashion, not... whatever evil people do!";
        }
        
        if (phase === 'discussion') {
            const responses = [
                "Okay, so like, someone here is totally lying and I do NOT appreciate it!",
                "This is worse than working at Bloomingdale's during Black Friday!",
                "I may not know much about crime, but I know when someone's being shady!",
                "OMG, this is so stressful! Can we please just figure out who the bad person is?"
            ];
            return responses[Math.floor(Math.random() * responses.length)];
        }
        
        return "I am so not equipped for this! I deal with fashion emergencies, not actual emergencies!";
    }

    getRossResponse(userInput, phase, gameContext) {
        if (userInput.toLowerCase().includes('dinosaur')) {
            return "Did someone mention dinosaurs? Because statistically, a velociraptor would be the perfect mafia member...";
        }
        
        if (phase === 'discussion') {
            const responses = [
                "As a paleontologist, I'm trained to analyze evidence. And the evidence suggests... someone's lying.",
                "This reminds me of pack hunting behavior in prehistoric predators. Very concerning.",
                "Scientifically speaking, human deception patterns are fascinating. And terrifying.",
                "We need to approach this methodically. Like carbon dating, but for catching liars."
            ];
            return responses[Math.floor(Math.random() * responses.length)];
        }
        
        return "This is more stressful than when the museum moved my dinosaur exhibit!";
    }

    getMonicaResponse(userInput, phase, mafiaRole, gameContext) {
        if (mafiaRole === 'doctor') {
            if (phase === 'night') {
                return "I need to keep everyone safe! That's what I do - I take care of people!";
            }
        }
        
        if (phase === 'discussion') {
            const responses = [
                "I KNOW someone here is lying! I can always tell when people aren't being honest!",
                "This is like organizing a dinner party, except someone wants to murder the guests!",
                "We need rules! Structure! A proper system for catching the bad guy!",
                "I'm getting my competitive face on. Someone's going DOWN!"
            ];
            return responses[Math.floor(Math.random() * responses.length)];
        }
        
        return "Rules help control the fun! And apparently, help catch murderers!";
    }

    getGameHistory() {
        return this.gameHistory;
    }

    clearHistory() {
        this.gameHistory = [];
    }
}

const mcpManager = new MCPManager();

// Enhanced AI Strategy Functions with Role-Based Intelligence
function selectStrategicMafiaTarget(aliveTargets, aliveMafia) {
    // Priority system for mafia target selection with advanced strategy
    const targetPriorities = [];
    const gameRound = gameState.round;
    const totalPlayers = gameState.alivePlayers.length;
    
    aliveTargets.forEach(target => {
        let priority = 0;
        let reasoning = "";
        
        // Role-based priority system
        if (target.role === "detective") {
            // Detective is highest priority, especially early game
            priority += 120 + (gameRound <= 2 ? 30 : 0);
            reasoning = "Detective - critical threat to mafia";
        }
        else if (target.role === "doctor") {
            // Doctor priority increases as game progresses
            priority += 90 + (gameRound >= 3 ? 20 : 0);
            reasoning = "Doctor - can protect key targets";
        }
        else if (target.role === "townsfolk") {
            // Townspeople priority based on game state
            priority += 60;
            reasoning = "Townsperson - standard elimination target";
        }
        
        // Strategic considerations
        
        // If close to winning (mafia >= innocents), target anyone
        const aliveMafiaCount = gameState.alivePlayers.filter(p => p.role === "mafia").length;
        const aliveInnocentCount = gameState.alivePlayers.filter(p => p.role !== "mafia").length;
        
        if (aliveMafiaCount >= aliveInnocentCount - 1) {
            priority += 50;
            reasoning += " + close to victory";
        }
        
        // Avoid targeting if only 3 players left (might expose mafia)
        if (totalPlayers <= 3 && target.role === "townsfolk") {
            priority -= 30;
            reasoning += " - endgame caution";
        }
        
        // Add strategic randomness (less predictable)
        priority += (Math.random() - 0.5) * 25;
        
        targetPriorities.push({
            target: target,
            priority: priority,
            reasoning: reasoning
        });
    });
    
    // Sort by priority (highest first)
    targetPriorities.sort((a, b) => b.priority - a.priority);
    
    // Log AI decision making for debugging
    console.log(`AI Mafia target selection (Round ${gameRound}):`);
    targetPriorities.forEach((item, index) => {
        console.log(`${index + 1}. ${item.target.name || item.target.playerName} - Priority: ${item.priority.toFixed(1)} (${item.reasoning})`);
    });
    
    // Return highest priority target
    return targetPriorities[0].target;
}

function selectStrategicDoctorTarget(aliveTargets, gameRound) {
    // Doctor AI strategy for protection
    const protectionPriorities = [];
    
    aliveTargets.forEach(target => {
        let priority = 0;
        let reasoning = "";
        
        // Role-based protection priority
        if (target.role === "detective") {
            priority += 100;
            reasoning = "Detective - protect key investigator";
        }
        else if (target.role === "doctor") {
            // Self-protection in dangerous situations
            priority += 70 + (gameRound >= 3 ? 20 : 0);
            reasoning = "Doctor - self-preservation";
        }
        else if (target.role === "townsfolk") {
            priority += 40;
            reasoning = "Townsperson - protect innocent";
        }
        
        // Strategic considerations
        if (gameRound === 1) {
            // First round: protect detective or self
            if (target.role === "detective") priority += 30;
            if (target.role === "doctor") priority += 20;
            reasoning += " + first round priority";
        }
        
        // Late game: focus on self-preservation
        if (gameRound >= 4 && target.role === "doctor") {
            priority += 40;
            reasoning += " + late game survival";
        }
        
        // Add some randomness
        priority += Math.random() * 15;
        
        protectionPriorities.push({
            target: target,
            priority: priority,
            reasoning: reasoning
        });
    });
    
    protectionPriorities.sort((a, b) => b.priority - a.priority);
    
    console.log(`AI Doctor protection selection (Round ${gameRound}):`);
    protectionPriorities.forEach((item, index) => {
        console.log(`${index + 1}. ${item.target.name || item.target.playerName} - Priority: ${item.priority.toFixed(1)} (${item.reasoning})`);
    });
    
    return protectionPriorities[0].target;
}

function selectStrategicDetectiveTarget(aliveTargets, gameRound) {
    // Detective AI strategy for investigation
    const investigationPriorities = [];
    
    aliveTargets.forEach(target => {
        let priority = 0;
        let reasoning = "";
        
        // Never investigate known roles (in a real game, detective wouldn't know)
        // But for AI strategy, focus on suspicious behavior patterns
        
        // Base investigation priority
        priority += 50;
        reasoning = "Standard investigation target";
        
        // Strategic considerations
        if (gameRound === 1) {
            // First round: investigate randomly but strategically
            priority += Math.random() * 30;
            reasoning += " + first round exploration";
        } else {
            // Later rounds: focus on surviving players who might be mafia
            priority += Math.random() * 40;
            reasoning += " + behavioral analysis";
        }
        
        // Prioritize investigating players who are still alive and active
        if (target.role === "mafia") {
            // In reality, detective wouldn't know this, but for AI strategy
            priority += 80;
            reasoning = "High suspicion target";
        }
        
        investigationPriorities.push({
            target: target,
            priority: priority,
            reasoning: reasoning
        });
    });
    
    investigationPriorities.sort((a, b) => b.priority - a.priority);
    
    console.log(`AI Detective investigation selection (Round ${gameRound}):`);
    investigationPriorities.forEach((item, index) => {
        console.log(`${index + 1}. ${item.target.name || item.target.playerName} - Priority: ${item.priority.toFixed(1)} (${item.reasoning})`);
    });
    
    return investigationPriorities[0].target;
}

function enhanceAIVotingBehavior() {
    // Enhanced AI voting with role-based strategies
    const votingStrategies = new Map();
    
    gameState.aiPersonas.filter(p => p.isAlive).forEach(persona => {
        const strategy = getVotingStrategy(persona);
        votingStrategies.set(persona.name, strategy);
    });
    
    return votingStrategies;
}

function getVotingStrategy(aiPersona) {
    const aliveTargets = gameState.alivePlayers.filter(p => p !== aiPersona);
    const targetScores = new Map();
    
    aliveTargets.forEach(target => {
        let score = 0;
        let reasoning = [];
        
        if (aiPersona.role === "mafia") {
            // Mafia strategy: Vote for innocents, avoid other mafia
            if (target.role === "mafia") {
                score -= 1000; // Never vote for mafia partner
                reasoning.push("Mafia partner - avoid");
            } else if (target.role === "detective") {
                score += 200; // High priority to eliminate detective
                reasoning.push("Detective - eliminate threat");
            } else if (target.role === "doctor") {
                score += 150; // High priority to eliminate doctor
                reasoning.push("Doctor - eliminate protection");
            } else {
                score += 100; // Standard innocent target
                reasoning.push("Innocent - standard target");
            }
        } else {
            // Innocent strategy: Try to identify and vote for mafia
            if (target.role === "mafia") {
                score += 300; // High priority to vote for actual mafia
                reasoning.push("Suspected mafia - eliminate");
            } else {
                score += Math.random() * 50; // Random voting among innocents
                reasoning.push("Uncertain - random choice");
            }
        }
        
        // Add some randomness to make AI less predictable
        score += (Math.random() - 0.5) * 30;
        
        targetScores.set(target, {
            score: score,
            reasoning: reasoning.join(", ")
        });
    });
    
    return targetScores;
}

// Game Logic Functions
function initializeGame() {
    // Define all 7 roles for the game (1 human + 6 AI)
    const allRoles = [
        "mafia",
        "mafia", 
        "doctor",
        "detective",
        "townsfolk",
        "townsfolk",
        "townsfolk"
    ];
    
    // Shuffle roles randomly
    const shuffledRoles = allRoles.sort(() => Math.random() - 0.5);
    
    // Assign first role to human player
    gameState.players.forEach((player) => {
        player.role = shuffledRoles[0];
        player.isAlive = true;
        player.votes = 0;
    });
    
    // Assign remaining roles to AI personas
    gameState.aiPersonas.forEach((persona, index) => {
        persona.role = shuffledRoles[index + 1];
        persona.isAlive = true;
        persona.votes = 0;
    });

    updateAlivePlayers();
    gameState.phase = "night";
    gameState.round = 1;

    // Log role assignments for debugging
    console.log("Game initialized with roles:");
    gameState.players.forEach(player => {
        console.log(`${player.playerName} (Human): ${player.role}`);
    });
    gameState.aiPersonas.forEach(persona => {
        console.log(`${persona.name} (AI): ${persona.role}`);
    });
    
    // Find mafia partners for coordination
    const mafiaMembers = [
        ...Array.from(gameState.players.values()).filter(p => p.role === "mafia"),
        ...gameState.aiPersonas.filter(p => p.role === "mafia")
    ];
    
    if (mafiaMembers.length === 2) {
        gameState.mafiaPartners = mafiaMembers;
        console.log("Mafia partners:", mafiaMembers.map(m => m.name || m.playerName));
    }
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
    let privateInfo = new Map(); // Store role-specific private information

    // Process player night actions first
    const playerActions = Array.from(gameState.nightActions.values());
    
    // Determine mafia target with enhanced coordination
    let mafiaTarget = null;
    const playerMafiaAction = playerActions.find(action => action.role === "mafia");
    
    if (playerMafiaAction) {
        // Player is mafia and chose target
        const target = gameState.alivePlayers.find(p => 
            (p.name || p.playerName) === playerMafiaAction.target
        );
        mafiaTarget = target;
        narrative += `🔪 The mafia targeted ${playerMafiaAction.target}...\n`;
        
        // Send coordination info to player if they're mafia
        const playerMafia = Array.from(gameState.players.values()).find(p => p.role === "mafia");
        if (playerMafia) {
            const aiMafiaPartner = gameState.aiPersonas.find(p => p.isAlive && p.role === "mafia");
            if (aiMafiaPartner) {
                privateInfo.set("mafia", {
                    message: `Your partner ${aiMafiaPartner.name} agreed with your target choice: ${playerMafiaAction.target}`,
                    partnerName: aiMafiaPartner.name,
                    targetAgreed: true,
                    coordination: "successful"
                });
            }
        }
    } else {
        // AI mafia chooses target with strategic coordination
        const aliveMafia = gameState.aiPersonas.filter(p => p.isAlive && p.role === "mafia");
        const aliveTargets = gameState.alivePlayers.filter(p => p.role !== "mafia");
        
        if (aliveMafia.length > 0 && aliveTargets.length > 0) {
            // Enhanced AI target selection with strategic priorities
            mafiaTarget = selectStrategicMafiaTarget(aliveTargets, aliveMafia);
            narrative += `🔪 The mafia targeted ${mafiaTarget.name || mafiaTarget.playerName}...\n`;
        }
    }
    gameState.mafiaTarget = mafiaTarget;

    // Determine doctor protection (prioritize player action if doctor)
    let doctorSave = null;
    const playerDoctorAction = playerActions.find(action => action.role === "doctor");
    
    if (playerDoctorAction) {
        // Player is doctor and chose protection target
        const target = gameState.alivePlayers.find(p => 
            (p.name || p.playerName) === playerDoctorAction.target
        );
        doctorSave = target;
        narrative += `💊 The doctor protected someone...\n`;
        
        // Send private info to doctor player
        privateInfo.set("doctor", {
            message: `You protected ${playerDoctorAction.target}`,
            target: playerDoctorAction.target,
            successful: mafiaTarget && (mafiaTarget.name || mafiaTarget.playerName) === playerDoctorAction.target
        });
    } else {
        // AI doctor chooses protection with strategic intelligence
        const aliveDoctor = gameState.aiPersonas.find(p => p.isAlive && p.role === "doctor");
        if (aliveDoctor) {
            // Use strategic doctor AI
            const protectionTargets = gameState.alivePlayers.filter(p => p !== aliveDoctor);
            if (protectionTargets.length > 0) {
                doctorSave = selectStrategicDoctorTarget(protectionTargets, gameState.round);
                narrative += `💊 The doctor protected someone...\n`;
                console.log(`AI Doctor ${aliveDoctor.name} strategically protected ${doctorSave.name || doctorSave.playerName}`);
            }
        }
    }
    gameState.doctorSave = doctorSave;

    // Determine detective investigation (prioritize player action if detective)
    let detectiveCheck = null;
    const playerDetectiveAction = playerActions.find(action => action.role === "detective");
    
    if (playerDetectiveAction) {
        // Player is detective and chose investigation target
        const target = gameState.alivePlayers.find(p => 
            (p.name || p.playerName) === playerDetectiveAction.target
        );
        detectiveCheck = target;
        narrative += `🔍 The detective investigated someone...\n`;
        
        // Send private info to detective player
        privateInfo.set("detective", {
            target: playerDetectiveAction.target,
            isMafia: target ? target.role === "mafia" : false,
            message: target ? 
                `Investigation Result: ${playerDetectiveAction.target} is ${target.role === "mafia" ? "MAFIA" : "INNOCENT"}` :
                `Investigation failed - target not found`
        });
    } else {
        // AI detective investigates with strategic intelligence
        const aliveDetective = gameState.aiPersonas.find(p => p.isAlive && p.role === "detective");
        if (aliveDetective) {
            // Use strategic detective AI
            const investigationTargets = gameState.alivePlayers.filter(p => p !== aliveDetective);
            if (investigationTargets.length > 0) {
                detectiveCheck = selectStrategicDetectiveTarget(investigationTargets, gameState.round);
                narrative += `🔍 The detective investigated someone...\n`;
                console.log(`AI Detective ${aliveDetective.name} strategically investigated ${detectiveCheck.name || detectiveCheck.playerName}`);
            }
        }
    }
    gameState.detectiveCheck = detectiveCheck;

    // Resolve actions
    let eliminated = null;
    if (mafiaTarget && mafiaTarget !== doctorSave) {
        eliminated = mafiaTarget;
        eliminated.isAlive = false;
        gameState.eliminatedPlayers.push(eliminated);
        narrative += `💀 ${eliminated.name || eliminated.playerName} was eliminated!\n`;
    } else if (mafiaTarget && mafiaTarget === doctorSave) {
        narrative += `🛡️ The doctor's protection saved a life!\n`;
        
        // Update doctor private info if player is doctor
        if (privateInfo.has("doctor")) {
            const doctorInfo = privateInfo.get("doctor");
            doctorInfo.successful = true;
            doctorInfo.message += " - Your protection was successful!";
        }
    }

    updateAlivePlayers();

    // Clear night actions for next round
    gameState.nightActions.clear();

    // Check win conditions
    if (checkWinConditions()) {
        return;
    }

    // Send public night results to all players
    io.emit("night-results", {
        narrative: narrative,
        eliminated: eliminated
    });

    // Send private information to specific players
    gameState.players.forEach((player, playerId) => {
        if (privateInfo.has(player.role)) {
            io.to(playerId).emit("private-night-info", {
                role: player.role,
                info: privateInfo.get(player.role)
            });
        }
    });

    startPhase("discussion", GAME_CONFIG.discussionDuration);
}

function startVotingPhase() {
    gameState.votes.clear();
    startPhase("voting", GAME_CONFIG.votingDuration);

    // Enhanced AI voting with strategic behavior
    setTimeout(() => {
        const votingStrategies = enhanceAIVotingBehavior();
        
        gameState.aiPersonas
            .filter((p) => p.isAlive)
            .forEach((persona) => {
                const strategy = votingStrategies.get(persona.name);
                if (strategy && strategy.size > 0) {
                    // Find target with highest score
                    let bestTarget = null;
                    let bestScore = -Infinity;
                    
                    strategy.forEach((scoreData, target) => {
                        if (scoreData.score > bestScore) {
                            bestScore = scoreData.score;
                            bestTarget = target;
                        }
                    });
                    
                    if (bestTarget) {
                        gameState.votes.set(persona.name, bestTarget.name || bestTarget.playerName);
                        
                        // Log AI voting decision for debugging
                        const scoreData = strategy.get(bestTarget);
                        console.log(`${persona.name} (${persona.role}) voted for ${bestTarget.name || bestTarget.playerName} - Score: ${scoreData.score.toFixed(1)} (${scoreData.reasoning})`);
                    }
                } else {
                    // Fallback to random voting if strategy fails
                    const targets = gameState.alivePlayers.filter(p => p !== persona);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        gameState.votes.set(persona.name, target.name || target.playerName);
                        console.log(`${persona.name} voted randomly for ${target.name || target.playerName}`);
                    }
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

            // Store voting round in history
            const votingRound = {
                round: gameState.round,
                timestamp: new Date().toLocaleString(),
                eliminatedPlayer: eliminatedPlayer,
                eliminatedRole: player.role,
                voteBreakdown: Array.from(voteCount.entries()),
                votingDetails: Array.from(gameState.votes.entries())
            };
            gameState.votingHistory.push(votingRound);

            io.emit("player-eliminated", {
                playerName: eliminatedPlayer,
                role: player.role,
                votes: maxVotes,
                voteBreakdown: Array.from(voteCount.entries()),
                votingDetails: Array.from(gameState.votes.entries()),
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

    // Send role-specific game results to each player
    gameState.players.forEach((player, playerId) => {
        const roleSpecificResults = generateRoleSpecificResults(player, gameState.gameResults);
        
        io.to(playerId).emit("game-over", {
            results: roleSpecificResults,
            playerRole: player.role,
            playerSurvived: player.isAlive,
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
    });

    // Send generic results to any spectators or for logging
    console.log("Game ended:", gameState.gameResults);
}

function generateRoleSpecificResults(player, gameResults) {
    const playerWon = checkPlayerVictory(player, gameResults);
    
    const roleSpecificResults = {
        winner: gameResults.winner,
        reason: gameResults.reason,
        playerOutcome: playerWon ? "victory" : "defeat",
        playerRole: player.role,
        playerSurvived: player.isAlive
    };

    // Generate role-specific messages
    if (player.role === "mafia") {
        if (gameResults.winner === "mafia") {
            roleSpecificResults.title = "🔴 MAFIA VICTORY!";
            roleSpecificResults.personalMessage = player.isAlive ? 
                "Congratulations! You and your partner successfully took control of the town!" :
                "Victory! Even though you were eliminated, your mafia partner completed the mission!";
            roleSpecificResults.roleMessage = "The mafia has won by either eliminating enough innocents or surviving to the end.";
        } else {
            roleSpecificResults.title = "🔴 MAFIA DEFEATED";
            roleSpecificResults.personalMessage = "Defeat! The townspeople discovered your identity and eliminated the mafia.";
            roleSpecificResults.roleMessage = "The innocent townspeople successfully identified and eliminated all mafia members.";
        }
    } else if (player.role === "detective") {
        if (gameResults.winner === "innocents") {
            roleSpecificResults.title = "🔍 DETECTIVE VICTORY!";
            roleSpecificResults.personalMessage = player.isAlive ?
                "Excellent work, Detective! Your investigations helped the town identify and eliminate the mafia!" :
                "Victory! Your investigative work helped the town win, even after your sacrifice!";
            roleSpecificResults.roleMessage = "Your detective skills were crucial in identifying the mafia threats.";
        } else {
            roleSpecificResults.title = "🔍 DETECTIVE DEFEATED";
            roleSpecificResults.personalMessage = "The mafia has won. Your investigations weren't enough to save the town.";
            roleSpecificResults.roleMessage = "Despite your efforts to uncover the truth, the mafia succeeded in their mission.";
        }
    } else if (player.role === "doctor") {
        if (gameResults.winner === "innocents") {
            roleSpecificResults.title = "💊 DOCTOR VICTORY!";
            roleSpecificResults.personalMessage = player.isAlive ?
                "Well done, Doctor! Your protection saved lives and helped the town defeat the mafia!" :
                "Victory! Your medical expertise helped the town win, even after your elimination!";
            roleSpecificResults.roleMessage = "Your healing abilities were vital in protecting innocent lives.";
        } else {
            roleSpecificResults.title = "💊 DOCTOR DEFEATED";
            roleSpecificResults.personalMessage = "The mafia has won. You couldn't save enough lives to protect the town.";
            roleSpecificResults.roleMessage = "Despite your medical skills, the mafia's attacks were too effective.";
        }
    } else { // townsfolk
        if (gameResults.winner === "innocents") {
            roleSpecificResults.title = "👥 TOWNSPERSON VICTORY!";
            roleSpecificResults.personalMessage = player.isAlive ?
                "Congratulations! You helped the town identify and eliminate the mafia threat!" :
                "Victory! Your sacrifice helped the town achieve victory against the mafia!";
            roleSpecificResults.roleMessage = "The power of the townspeople working together defeated the mafia.";
        } else {
            roleSpecificResults.title = "👥 TOWNSPERSON DEFEATED";
            roleSpecificResults.personalMessage = "The mafia has taken control of the town. The innocent people have lost.";
            roleSpecificResults.roleMessage = "The mafia successfully deceived and eliminated enough townspeople to win.";
        }
    }

    return roleSpecificResults;
}

function checkPlayerVictory(player, gameResults) {
    // Mafia wins if mafia team wins
    if (player.role === "mafia") {
        return gameResults.winner === "mafia";
    }
    // All other roles (detective, doctor, townsfolk) win if innocents win
    else {
        return gameResults.winner === "innocents";
    }
}

// Game restart function
function resetGame() {
    // Clear game state
    gameState.phase = "lobby";
    gameState.round = 0;
    gameState.alivePlayers = [];
    gameState.eliminatedPlayers = [];
    gameState.votes.clear();
    gameState.mafiaTarget = null;
    gameState.doctorSave = null;
    gameState.detectiveCheck = null;
    gameState.nightActions.clear();
    gameState.gameResults = {
        winner: null,
        reason: "",
    };

    // Clear timer
    if (gameState.phaseTimer) {
        clearInterval(gameState.phaseTimer);
        gameState.phaseTimer = null;
    }
    gameState.timeRemaining = 0;

    // Reset AI personas
    gameState.aiPersonas.forEach(persona => {
        persona.isAlive = true;
        persona.role = "townsfolk";
        persona.votes = 0;
    });

    // Reset players
    gameState.players.forEach(player => {
        player.isAlive = true;
        player.role = "townsfolk";
        player.votes = 0;
    });

    // Clear chat history
    mcpManager.clearHistory();

    console.log("Game reset successfully");
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
            
            // Send role information to the player
            const player = Array.from(gameState.players.values())[0];
            socket.emit("role-assigned", {
                role: player.role,
                mafiaPartners: gameState.mafiaPartners ? gameState.mafiaPartners.map(m => m.name || m.playerName) : []
            });
            
            startPhase("night", GAME_CONFIG.nightPhaseDuration);
        }
    });
    // Start game when enough players join
    socket.on("start-game", () => {
        if (gameState.phase === "lobby" && gameState.players.size >= 1) {
            initializeGame();
            
            // Send role information to the player
            const player = Array.from(gameState.players.values())[0];
            socket.emit("role-assigned", {
                role: player.role,
                mafiaPartners: gameState.mafiaPartners ? gameState.mafiaPartners.map(m => m.name || m.playerName) : []
            });
            
            startPhase("night", GAME_CONFIG.nightPhaseDuration);
        }
    });

    // Handle voice input with enhanced contextual responses and chat history
    socket.on("voice-input", async (data) => {
        const { transcript, targetCharacter, playerName } = data;

        const aiResponse = mcpManager.generateResponse(
            targetCharacter,
            transcript,
            { 
                phase: gameState.phase, 
                round: gameState.round,
                playerName: playerName
            }
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

        // Send updated chat history to all clients
        io.emit('chat-history-update', mcpManager.getGameHistory());

        setTimeout(() => io.emit("clear-speaker"), 3000);
    });

    // Handle player night actions
    socket.on("night-action", (data) => {
        if (gameState.phase !== "night") {
            socket.emit("error", "Night actions are only allowed during night phase!");
            return;
        }

        const { role, target, playerId } = data;
        const player = gameState.players.get(playerId);

        if (player && player.isAlive && player.role === role) {
            // Store the player's night action
            gameState.nightActions.set(playerId, {
                role: role,
                target: target,
                playerName: player.playerName
            });

            // Send confirmation to player
            socket.emit("night-action-confirmed", {
                role: role,
                target: target,
                message: `Your ${role} action has been submitted.`
            });

            console.log(`Player ${player.playerName} (${role}) submitted night action: ${target}`);
        }
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

    // Handle clear chat history
    socket.on('clear-chat-history', () => {
        mcpManager.clearHistory();
        io.emit('chat-history-update', []);
    });

    // Handle voting history request
    socket.on("get-voting-history", () => {
        socket.emit("voting-history-update", gameState.votingHistory);
    });

    // Handle skip round
    socket.on("skip-round", (data) => {
        if (gameState.phase === "lobby" || gameState.phase === "gameOver") {
            socket.emit("error", "Cannot skip round in current phase!");
            return;
        }

        const player = gameState.players.get(data.playerId);
        if (!player) {
            socket.emit("error", "Player not found!");
            return;
        }

        console.log(`Player ${player.playerName} requested to skip ${data.currentPhase} phase`);

        // Clear current timer
        if (gameState.phaseTimer) {
            clearInterval(gameState.phaseTimer);
            gameState.phaseTimer = null;
        }

        // Set time remaining to 1 to trigger phase end
        gameState.timeRemaining = 1;

        // Notify all clients
        io.emit("timer-update", {
            phase: gameState.phase,
            timeRemaining: gameState.timeRemaining,
        });

        // Trigger phase end after a brief delay
        setTimeout(() => {
            handlePhaseEnd();
        }, 1000);

        // Notify all clients about the skip
        io.emit("phase-skipped", {
            skippedBy: player.playerName,
            phase: data.currentPhase
        });
    });

    // Handle game restart
    socket.on("restart-game", () => {
        resetGame();
        
        // Clear voting history
        gameState.votingHistory = [];
        
        // Notify all clients of game restart
        io.emit("game-restarted", {
            phase: gameState.phase,
            round: gameState.round,
            alivePlayers: gameState.alivePlayers.length,
        });

        // Clear chat history for all clients
        io.emit('chat-history-update', []);
        
        console.log("Game restarted by player");
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// Add route to get chat history
app.get('/api/chat-history', (req, res) => {
    res.json(mcpManager.getGameHistory());
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
