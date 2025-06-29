const socket = io();

// Game state
let selectedCharacter = null;
let isRecording = false;
let recognition = null;
let currentGamePhase = "lobby";
let playerVoted = false;

// Initialize speech recognition
if ("webkitSpeechRecognition" in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        handleVoiceInput(transcript);
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        stopRecording();
    };
}

// DOM elements
const micButton = document.getElementById("mic-button");
const voteButton = document.getElementById("vote-button");
const accuseButton = document.getElementById("accuse-button");
const startGameBtn = document.getElementById("start-game-btn");
const dialogueBox = document.getElementById("current-dialogue");
const phaseTimer = document.getElementById("phase-timer");
const currentPhase = document.getElementById("current-phase");
const currentRound = document.getElementById("current-round");
const selectedNameSpan = document.getElementById("selected-name");
const phaseInstructions = document.getElementById("phase-instructions");
const actionStatus = document.getElementById("action-status");
const aliveCount = document.getElementById("alive-count");

// Initialize game
document.addEventListener("DOMContentLoaded", () => {
    updateUIForPhase(window.gameState.phase);
});

// Character selection
document.querySelectorAll(".character-frame").forEach((frame) => {
    frame.addEventListener("click", () => {
        if (!frame.classList.contains("eliminated")) {
            selectCharacter(frame.dataset.character, frame);
        }
    });
});

function selectCharacter(characterName, frameElement) {
    // Clear previous selection
    document.querySelectorAll(".character-frame").forEach((f) => {
        f.classList.remove("selected");
    });

    // Set new selection
    frameElement.classList.add("selected");
    selectedCharacter = characterName;
    selectedNameSpan.textContent = characterName;

    // Update button states based on phase
    updateButtonStates();

    updateDialogue(`Selected ${characterName}. ${getPhaseActionText()}`);
}

function getPhaseActionText() {
    switch (currentGamePhase) {
        case "night":
            return "Listen to the night unfold...";
        case "discussion":
            return "You can speak to them about your suspicions.";
        case "voting":
            return "You can vote to eliminate them!";
        default:
            return "You can interact with them.";
    }
}

function updateButtonStates() {
    const hasSelection = selectedCharacter !== null;

    switch (currentGamePhase) {
        case "night":
            micButton.disabled = false;
            voteButton.disabled = true;
            accuseButton.disabled = true;
            break;
        case "discussion":
            micButton.disabled = !hasSelection;
            voteButton.disabled = true;
            accuseButton.disabled = !hasSelection;
            break;
        case "voting":
            micButton.disabled = true;
            voteButton.disabled = !hasSelection || playerVoted;
            accuseButton.disabled = true;
            break;
        default:
            micButton.disabled = !hasSelection;
            voteButton.disabled = true;
            accuseButton.disabled = true;
    }

    // Visual indicators
    if (currentGamePhase === "voting" && hasSelection && !playerVoted) {
        voteButton.classList.add("phase-active");
    } else {
        voteButton.classList.remove("phase-active");
    }
}

function updateUIForPhase(phase) {
    currentGamePhase = phase;
    currentPhase.textContent = phase.toUpperCase();
    currentPhase.className = `phase-value ${phase}`;

    // Update instructions
    const instructions = {
        lobby: "Waiting for game to start...",
        night: "🌙 Night Phase - The mafia is choosing their target...",
        discussion: "💬 Day Phase - Discuss who might be the mafia!",
        voting: "🗳️ Voting Phase - Vote to eliminate a suspect!",
        gameOver: "🏁 Game Over - Check the results!",
    };

    phaseInstructions.textContent =
        instructions[phase] || "Game in progress...";

    // Update button states
    updateButtonStates();

    // Special phase handling
    if (phase === "voting") {
        playerVoted = false;
        voteButton.textContent = "📊 Vote";
        voteButton.disabled = selectedCharacter === null;
    }
}

// Timer formatting
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// Game control handlers
startGameBtn.addEventListener("click", () => {
    socket.emit("start-game");
    startGameBtn.style.display = "none";
});

// Voice input handling
micButton.addEventListener("mousedown", startRecording);
micButton.addEventListener("mouseup", stopRecording);
micButton.addEventListener("touchstart", startRecording);
micButton.addEventListener("touchend", stopRecording);

function startRecording() {
    if (!selectedCharacter) {
        updateDialogue("Please select a character first!");
        return;
    }

    if (currentGamePhase !== "night" && currentGamePhase !== "discussion") {
        updateDialogue("Voice interaction not available in this phase!");
        return;
    }

    if (recognition && !isRecording) {
        isRecording = true;
        micButton.textContent = "🔴 Recording...";
        micButton.style.background = "#ff6b6b";
        recognition.start();
    }
}

function stopRecording() {
    if (recognition && isRecording) {
        isRecording = false;
        micButton.textContent = "🎤 Hold to Speak";
        micButton.style.background =
            "linear-gradient(145deg, #ffd700, #ffed4e)";
        recognition.stop();
    }
}

function handleVoiceInput(transcript) {
    if (!selectedCharacter) return;

    updateDialogue(`You said: "${transcript}"`);
    actionStatus.textContent = `Speaking to ${selectedCharacter}...`;

    socket.emit("voice-input", {
        transcript: transcript,
        targetCharacter: selectedCharacter,
    });
}

// Voting functionality
voteButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        updateDialogue("Please select a character to vote for!");
        return;
    }

    if (currentGamePhase !== "voting") {
        updateDialogue("Voting is only allowed during voting phase!");
        return;
    }

    const confirmation = confirm(
        `Are you sure you want to vote to eliminate ${selectedCharacter}?`,
    );
    if (confirmation) {
        socket.emit("vote", {
            playerId: window.playerData.id,
            targetCharacter: selectedCharacter,
        });

        playerVoted = true;
        voteButton.disabled = true;
        voteButton.textContent = "✅ Voted";
        voteButton.classList.remove("phase-active");

        updateDialogue(`You voted to eliminate ${selectedCharacter}!`);
        actionStatus.textContent = "Vote cast! Waiting for results...";
    }
});

// Accusation functionality (available during discussion)
accuseButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        updateDialogue("Please select a character to accuse!");
        return;
    }

    if (currentGamePhase !== "discussion") {
        updateDialogue("Accusations are only allowed during discussion phase!");
        return;
    }

    const confirmation = confirm(
        `Are you sure you want to publicly accuse ${selectedCharacter} of being mafia?`,
    );
    if (confirmation) {
        const message = `I accuse ${selectedCharacter} of being mafia!`;

        socket.emit("voice-input", {
            transcript: message,
            targetCharacter: selectedCharacter,
        });

        updateDialogue(`You publicly accused ${selectedCharacter}!`);
        actionStatus.textContent = `Accused ${selectedCharacter} of being mafia!`;
    }
});

// Socket event handlers
socket.on("game-state-update", (data) => {
    updateUIForPhase(data.phase);
    currentRound.textContent = data.round;
    aliveCount.textContent = data.alivePlayers.length;

    if (data.timeRemaining) {
        phaseTimer.textContent = formatTime(data.timeRemaining);
    }
});

socket.on("phase-change", (data) => {
    updateUIForPhase(data.phase);
    currentRound.textContent = data.round;
    phaseTimer.textContent = formatTime(data.timeRemaining);

    // Clear selection when phase changes
    if (data.phase === "night") {
        clearSelection();
    }

    updateDialogue(
        `Phase changed to ${data.phase.toUpperCase()}. Round ${data.round}.`,
    );
});

socket.on("timer-update", (data) => {
    phaseTimer.textContent = formatTime(data.timeRemaining);

    // Warning when time is low
    if (data.timeRemaining <= 10 && data.timeRemaining > 0) {
        phaseTimer.style.color = "#ff6b6b";
        phaseTimer.style.animation = "pulse 1s infinite";
    } else {
        phaseTimer.style.color = "#ffd700";
        phaseTimer.style.animation = "none";
    }
});

socket.on("night-results", (data) => {
    updateDialogue(data.narrative);

    if (data.eliminated) {
        markPlayerEliminated(
            data.eliminated.name || data.eliminated.playerName,
        );
    }

    if (data.detectiveResult) {
        setTimeout(() => {
            const result = data.detectiveResult.isMafia
                ? "IS MAFIA!"
                : "is innocent.";
            updateDialogue(
                `🔍 Detective Result: ${data.detectiveResult.target} ${result}`,
            );
        }, 2000);
    }
});

socket.on("player-eliminated", (data) => {
    updateDialogue(
        `💀 ${data.playerName} was eliminated by vote! They were a ${data.role.toUpperCase()}.`,
    );
    markPlayerEliminated(data.playerName);

    // Show vote breakdown
    setTimeout(() => {
        const breakdown = data.voteBreakdown
            .map(([name, votes]) => `${name}: ${votes}`)
            .join(", ");
        updateDialogue(`Vote results: ${breakdown}`);
    }, 3000);
});

socket.on("vote-cast", (data) => {
    updateDialogue(`${data.voter} voted for ${data.target}`);

    // Update vote display on character frame
    const frame = document.querySelector(`[data-character="${data.target}"]`);
    if (frame) {
        const voteDisplay = frame.querySelector(".vote-count");
        if (voteDisplay) {
            const currentVotes = parseInt(voteDisplay.textContent) || 0;
            voteDisplay.textContent = `${currentVotes + 1} votes`;
        }
    }
});

socket.on("ai-votes-cast", (votes) => {
    updateDialogue(`AI players have cast their votes...`);
});

socket.on("character-speaking", (data) => {
    const { character, dialogue } = data;

    highlightSpeaker(character);
    updateDialogue(`${character}: ${dialogue}`);

    if (data.audio) {
        playAudio(data.audio);
    }
});

socket.on("game-over", (data) => {
    showGameResults(data);
});

socket.on("clear-speaker", () => {
    clearSpeakerHighlight();
});

// Utility functions
function clearSelection() {
    document.querySelectorAll(".character-frame").forEach((f) => {
        f.classList.remove("selected");
    });
    selectedCharacter = null;
    selectedNameSpan.textContent = "None";
    updateButtonStates();
}

function markPlayerEliminated(playerName) {
    const frame = document.querySelector(`[data-character="${playerName}"]`);
    if (frame) {
        frame.classList.add("eliminated");
        const overlay = frame.querySelector(".elimination-overlay");
        if (overlay) {
            overlay.style.display = "flex";
        }
        const statusIndicator = frame.querySelector(".status-indicator");
        if (statusIndicator) {
            statusIndicator.classList.remove("alive");
            statusIndicator.classList.add("dead");
        }
    }

    // Update alive count
    const currentAlive = parseInt(aliveCount.textContent) - 1;
    aliveCount.textContent = currentAlive;
}

function showGameResults(data) {
    const modal = document.getElementById("game-results-modal");
    const title = document.getElementById("game-result-title");
    const content = document.getElementById("game-result-content");

    title.textContent =
        data.results.winner === "mafia"
            ? "🔴 MAFIA WINS!"
            : "🔵 INNOCENTS WIN!";

    let resultHTML = `
        <p><strong>Reason:</strong> ${data.results.reason}</p>
        <p><strong>Game Duration:</strong> ${data.finalStats.rounds} rounds</p>
        <h3>Final Results:</h3>
        <div style="display: flex; justify-content: space-around; text-align: left;">
            <div>
                <h4>👥 Survivors:</h4>
                <ul>
                    ${data.finalStats.survivors.map((p) => `<li>${p.name} (${p.role})</li>`).join("")}
                </ul>
            </div>
            <div>
                <h4>💀 Eliminated:</h4>
                <ul>
                    ${data.finalStats.eliminated.map((p) => `<li>${p.name} (${p.role})</li>`).join("")}
                </ul>
            </div>
        </div>
    `;

    content.innerHTML = resultHTML;
    modal.style.display = "flex";
}

// Play again functionality
document.getElementById("play-again-btn").addEventListener("click", () => {
    location.reload();
});

// Visual effects
function highlightSpeaker(characterName) {
    clearSpeakerHighlight();

    const characterFrame = document.querySelector(
        `[data-character="${characterName}"]`,
    );
    if (characterFrame && !characterFrame.classList.contains("eliminated")) {
        characterFrame.classList.add("speaking");
    }
}

function clearSpeakerHighlight() {
    document.querySelectorAll(".speaking").forEach((element) => {
        element.classList.remove("speaking");
    });
}

function updateDialogue(message) {
    dialogueBox.innerHTML = message.replace(/\n/g, "<br>");
    dialogueBox.scrollTop = dialogueBox.scrollHeight;
}

// Audio playback
function playAudio(base64Audio) {
    try {
        const audioBlob = new Blob(
            [Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0))],
            { type: "audio/mpeg" },
        );

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();

        audio.onended = () => URL.revokeObjectURL(audioUrl);
    } catch (error) {
        console.error("Error playing audio:", error);
    }
}

// Initialize button states
updateButtonStates();
