const socket = io();

// Game state
let selectedCharacter = null;
let isRecording = false;
let recognition = null;
let currentGamePhase = "lobby";
let playerVoted = false;
let chatHistory = [];
let isChatOpen = false;

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
    
    // Chat panel controls
    const toggleChatBtn = document.getElementById('toggle-chat-btn');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const exportChatBtn = document.getElementById('export-chat-btn');

    if (toggleChatBtn) {
        toggleChatBtn.addEventListener('click', toggleChat);
    }
    if (closeChatBtn) {
        closeChatBtn.addEventListener('click', closeChat);
    }
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }
    if (exportChatBtn) {
        exportChatBtn.addEventListener('click', exportChat);
    }
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
        playerName: window.playerData.name
    });
}

// Voting functionality
voteButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        showNotification("Please select a character to vote for!", "warning");
        return;
    }

    if (currentGamePhase !== "voting") {
        showNotification("Voting is only allowed during voting phase!", "error");
        return;
    }

    showConfirmation(
        "Confirm Vote",
        `Are you sure you want to vote to eliminate ${selectedCharacter}?`,
        () => {
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
            showNotification(`Vote cast for ${selectedCharacter}!`, "success");
        }
    );
});

// Accusation functionality (available during discussion)
accuseButton.addEventListener("click", () => {
    if (!selectedCharacter) {
        showNotification("Please select a character to accuse!", "warning");
        return;
    }

    if (currentGamePhase !== "discussion") {
        showNotification("Accusations are only allowed during discussion phase!", "error");
        return;
    }

    showConfirmation(
        "Public Accusation",
        `Are you sure you want to publicly accuse ${selectedCharacter} of being mafia?`,
        () => {
            const message = `I accuse ${selectedCharacter} of being mafia!`;

            socket.emit("voice-input", {
                transcript: message,
                targetCharacter: selectedCharacter,
                playerName: window.playerData.name
            });

            updateDialogue(`You publicly accused ${selectedCharacter}!`);
            actionStatus.textContent = `Accused ${selectedCharacter} of being mafia!`;
            showNotification(`Publicly accused ${selectedCharacter} of being mafia!`, "warning");
        }
    );
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
    location.href = "/";
});

// Restart game functionality
document.getElementById("restart-game-btn").addEventListener("click", () => {
    showConfirmation(
        "Restart Game",
        "Start a new game with re-randomized roles? All current progress will be lost.",
        () => {
            socket.emit("restart-game");
            showNotification("Starting new game with re-randomized roles...", "info");
        }
    );
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

// Chat functions
function toggleChat() {
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) {
        chatPanel.classList.toggle('open');
        isChatOpen = !isChatOpen;
    }
}

function closeChat() {
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) {
        chatPanel.classList.remove('open');
        isChatOpen = false;
    }
}

function clearChat() {
    showConfirmation(
        "Clear Chat History",
        "Are you sure you want to clear all chat history? This action cannot be undone.",
        () => {
            chatHistory = [];
            updateChatDisplay();
            socket.emit('clear-chat-history');
            showNotification("Chat history cleared!", "success");
        }
    );
}

function exportChat() {
    const chatText = chatHistory.map(msg => 
        `[${msg.timestamp}] ${msg.character}: ${msg.message}`
    ).join('\n');
    
    const blob = new Blob([chatText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mafia-game-chat-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function addChatMessage(character, message, type = 'ai') {
    const timestamp = new Date().toLocaleTimeString();
    const chatMessage = {
        character,
        message,
        timestamp,
        type
    };
    
    chatHistory.push(chatMessage);
    updateChatDisplay();
    
    // Auto-scroll to bottom
    const chatHistoryDiv = document.getElementById('chat-history');
    if (chatHistoryDiv) {
        chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight;
    }
}

function updateChatDisplay() {
    const chatHistoryDiv = document.getElementById('chat-history');
    if (!chatHistoryDiv) return;
    
    chatHistoryDiv.innerHTML = chatHistory.map(msg => `
        <div class="chat-message ${msg.type}">
            <div class="message-sender">${msg.character}</div>
            <div class="message-bubble">${msg.message}</div>
            <div class="message-time">${msg.timestamp}</div>
        </div>
    `).join('');
}

// Enhanced character speaking handler with chat integration
socket.on('character-speaking', (data) => {
    const { character, dialogue } = data;
    
    // Add to chat history
    addChatMessage(character, dialogue, 'ai');
    
    highlightSpeaker(character);
    updateDialogue(`${character}: ${dialogue}`);
    
    if (data.audio) {
        playAudio(data.audio);
    }
});

// Add socket handler for chat history updates
socket.on('chat-history-update', (history) => {
    chatHistory = history;
    updateChatDisplay();
});

// Handle game restart
socket.on("game-restarted", (data) => {
    // Hide game results modal
    const modal = document.getElementById("game-results-modal");
    modal.style.display = "none";
    
    // Reset UI to lobby state
    updateUIForPhase(data.phase);
    currentRound.textContent = data.round;
    aliveCount.textContent = data.alivePlayers;
    
    // Clear all character eliminations
    document.querySelectorAll(".character-frame").forEach((frame) => {
        frame.classList.remove("eliminated", "selected");
        const overlay = frame.querySelector(".elimination-overlay");
        if (overlay) {
            overlay.style.display = "none";
        }
        const statusIndicator = frame.querySelector(".status-indicator");
        if (statusIndicator) {
            statusIndicator.classList.remove("dead");
            statusIndicator.classList.add("alive");
        }
        const voteCount = frame.querySelector(".vote-count");
        if (voteCount) {
            voteCount.textContent = "0 votes";
        }
    });
    
    // Reset game state
    selectedCharacter = null;
    selectedNameSpan.textContent = "None";
    playerVoted = false;
    
    // Show start game button
    startGameBtn.style.display = "inline-block";
    
    // Clear dialogue
    updateDialogue("Game restarted! Roles have been re-randomized. Click 'Start Game' to begin a new round.");
    
    // Clear chat history display
    chatHistory = [];
    updateChatDisplay();
    
    // Update button states
    updateButtonStates();
});

// Enhanced voice input handler with chat integration
function handleVoiceInput(transcript) {
    if (!selectedCharacter) return;

    // Add to chat history
    addChatMessage(window.playerData.name, transcript, 'player');
    
    updateDialogue(`You said: "${transcript}"`);
    actionStatus.textContent = `Speaking to ${selectedCharacter}...`;

    socket.emit("voice-input", {
        transcript: transcript,
        targetCharacter: selectedCharacter,
        playerName: window.playerData.name
    });
}

// Custom notification and confirmation system
let currentConfirmCallback = null;

function showNotification(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notification-container');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${icons[type] || icons.info}</span>
            <span class="notification-text">${message}</span>
        </div>
        <button class="notification-close">&times;</button>
    `;
    
    container.appendChild(notification);
    
    // Close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        removeNotification(notification);
    });
    
    // Auto-remove after duration
    if (duration > 0) {
        setTimeout(() => {
            removeNotification(notification);
        }, duration);
    }
    
    return notification;
}

function removeNotification(notification) {
    notification.classList.add('removing');
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

function showConfirmation(title, message, onConfirm, onCancel = null) {
    const modal = document.getElementById('confirmation-modal');
    const titleElement = document.getElementById('confirmation-title');
    const messageElement = document.getElementById('confirmation-message');
    const yesBtn = document.getElementById('confirm-yes-btn');
    const noBtn = document.getElementById('confirm-no-btn');
    
    titleElement.textContent = title;
    messageElement.textContent = message;
    
    // Remove existing event listeners
    const newYesBtn = yesBtn.cloneNode(true);
    const newNoBtn = noBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
    noBtn.parentNode.replaceChild(newNoBtn, noBtn);
    
    // Add new event listeners
    newYesBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        if (onConfirm) onConfirm();
    });
    
    newNoBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        if (onCancel) onCancel();
    });
    
    modal.style.display = 'flex';
}

// Initialize button states
updateButtonStates();
