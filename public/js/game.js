const socket = io();

// Game state
let selectedCharacter = null;
let isRecording = false;
let recognition = null;
let currentGamePhase = "lobby";
let playerVoted = false;
let chatHistory = [];
let isChatOpen = false;
let votingHistory = [];

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

// Audio system variables
let backgroundMusic = null;
let backgroundMusicVolume = 0.5;
let characterVoiceVolume = 0.8;
let isMusicPlaying = false;

// Initialize game
document.addEventListener("DOMContentLoaded", () => {
    updateUIForPhase(window.gameState.phase);
    
    // Initialize audio system
    initializeAudioSystem();
    
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

    // Audio settings controls
    const audioSettingsBtn = document.getElementById('audio-settings-btn');
    const closeAudioBtn = document.getElementById('close-audio-btn');
    const backgroundVolumeSlider = document.getElementById('background-volume');
    const characterVolumeSlider = document.getElementById('character-volume');
    const toggleMusicBtn = document.getElementById('toggle-background-music');
    const testVoiceBtn = document.getElementById('test-character-voice');

    if (audioSettingsBtn) {
        audioSettingsBtn.addEventListener('click', toggleAudioSettings);
    }
    if (closeAudioBtn) {
        closeAudioBtn.addEventListener('click', closeAudioSettings);
    }
    if (backgroundVolumeSlider) {
        backgroundVolumeSlider.addEventListener('input', updateBackgroundVolume);
    }
    if (characterVolumeSlider) {
        characterVolumeSlider.addEventListener('input', updateCharacterVolume);
    }
    if (toggleMusicBtn) {
        toggleMusicBtn.addEventListener('click', toggleBackgroundMusic);
    }
    if (testVoiceBtn) {
        testVoiceBtn.addEventListener('click', testCharacterVoice);
    }

    // Voting results/history controls
    const votingResultsBtn = document.getElementById('voting-results-btn');
    const closeVotingHistoryBtn = document.getElementById('close-voting-history-btn');
    const exportVotingHistoryBtn = document.getElementById('export-voting-history-btn');

    if (votingResultsBtn) {
        votingResultsBtn.addEventListener('click', showVotingHistory);
    }
    if (closeVotingHistoryBtn) {
        closeVotingHistoryBtn.addEventListener('click', closeVotingHistory);
    }
    if (exportVotingHistoryBtn) {
        exportVotingHistoryBtn.addEventListener('click', exportVotingHistory);
    }
});

// Audio system functions
function initializeAudioSystem() {
    backgroundMusic = document.getElementById('background-music');
    
    if (backgroundMusic) {
        backgroundMusic.volume = backgroundMusicVolume;
        
        // Auto-play background music when user interacts with the page
        document.addEventListener('click', startBackgroundMusic, { once: true });
        document.addEventListener('keydown', startBackgroundMusic, { once: true });
        
        backgroundMusic.addEventListener('canplaythrough', () => {
            console.log('Background music loaded successfully');
        });
        
        backgroundMusic.addEventListener('error', (e) => {
            console.error('Error loading background music:', e);
            showNotification('Background music failed to load', 'warning');
        });
    }
}

function startBackgroundMusic() {
    if (backgroundMusic && !isMusicPlaying) {
        backgroundMusic.play().then(() => {
            isMusicPlaying = true;
            updateMusicButton();
            showNotification('Background music started! 🎵', 'success', 2000);
        }).catch((error) => {
            console.error('Error playing background music:', error);
            showNotification('Click anywhere to enable audio', 'info');
        });
    }
}

function toggleAudioSettings() {
    const audioPanel = document.getElementById('audio-settings-panel');
    if (audioPanel) {
        audioPanel.classList.toggle('open');
    }
}

function closeAudioSettings() {
    const audioPanel = document.getElementById('audio-settings-panel');
    if (audioPanel) {
        audioPanel.classList.remove('open');
    }
}

function updateBackgroundVolume() {
    const slider = document.getElementById('background-volume');
    const valueDisplay = document.getElementById('background-volume-value');
    
    backgroundMusicVolume = slider.value / 100;
    valueDisplay.textContent = slider.value + '%';
    
    if (backgroundMusic) {
        backgroundMusic.volume = backgroundMusicVolume;
    }
    
    // Update slider track color
    updateSliderTrack(slider);
}

function updateCharacterVolume() {
    const slider = document.getElementById('character-volume');
    const valueDisplay = document.getElementById('character-volume-value');
    
    characterVoiceVolume = slider.value / 100;
    valueDisplay.textContent = slider.value + '%';
    
    // Update slider track color
    updateSliderTrack(slider);
}

function updateSliderTrack(slider) {
    const percentage = (slider.value / slider.max) * 100;
    slider.style.background = `linear-gradient(to right, #ffd700 0%, #ffd700 ${percentage}%, rgba(255,255,255,0.2) ${percentage}%, rgba(255,255,255,0.2) 100%)`;
}

function toggleBackgroundMusic() {
    const toggleBtn = document.getElementById('toggle-background-music');
    
    if (!backgroundMusic) return;
    
    if (isMusicPlaying) {
        backgroundMusic.pause();
        isMusicPlaying = false;
        toggleBtn.textContent = '▶️ Play';
        toggleBtn.classList.remove('playing');
        toggleBtn.classList.add('paused');
        showNotification('Background music paused', 'info', 2000);
    } else {
        backgroundMusic.play().then(() => {
            isMusicPlaying = true;
            toggleBtn.textContent = '⏸️ Pause';
            toggleBtn.classList.remove('paused');
            toggleBtn.classList.add('playing');
            showNotification('Background music resumed', 'success', 2000);
        }).catch((error) => {
            console.error('Error playing background music:', error);
            showNotification('Unable to play music. Click anywhere first.', 'warning');
        });
    }
}

function updateMusicButton() {
    const toggleBtn = document.getElementById('toggle-background-music');
    if (toggleBtn) {
        if (isMusicPlaying) {
            toggleBtn.textContent = '⏸️ Pause';
            toggleBtn.classList.remove('paused');
            toggleBtn.classList.add('playing');
        } else {
            toggleBtn.textContent = '▶️ Play';
            toggleBtn.classList.remove('playing');
            toggleBtn.classList.add('paused');
        }
    }
}

function testCharacterVoice() {
    const testBtn = document.getElementById('test-character-voice');
    testBtn.disabled = true;
    testBtn.textContent = '🔊 Testing...';
    
    // Create a test audio for demonstration
    const testMessage = "How you doin'? This is a test of the character voice volume!";
    
    // Simulate character voice test (you can replace this with actual ElevenLabs call)
    setTimeout(() => {
        showNotification(`Character voice test at ${Math.round(characterVoiceVolume * 100)}% volume`, 'info', 3000);
        testBtn.disabled = false;
        testBtn.textContent = '🔊 Test';
    }, 1000);
}

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
    
    // Update player role if provided
    if (data.playerRole) {
        updatePlayerRole(data.playerRole);
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
    
    // Update player role if provided
    if (data.playerRole) {
        updatePlayerRole(data.playerRole);
    }
});

// Function to update player role display
function updatePlayerRole(role) {
    const playerRoleElement = document.getElementById('player-role');
    if (playerRoleElement) {
        playerRoleElement.textContent = role;
        playerRoleElement.className = `player-role ${role}`;
        
        // Update window.playerData for reference
        if (window.playerData) {
            window.playerData.role = role;
        }
        
        // Show role-specific notification
        const roleDescriptions = {
            'mafia': 'You are MAFIA! Work with your partner to eliminate townspeople.',
            'detective': 'You are the DETECTIVE! Investigate players each night to find the mafia.',
            'doctor': 'You are the DOCTOR! Protect players from mafia attacks each night.',
            'townsfolk': 'You are a TOWNSPERSON! Find and eliminate the mafia through discussion and voting.'
        };
        
        if (roleDescriptions[role]) {
            showNotification(roleDescriptions[role], 'info', 8000);
        }
    }
}

// Night Action Variables
let selectedNightTarget = null;
let nightActionSubmitted = false;

// Night Action Functions
function showNightActionPanel(role) {
    const nightPanel = document.getElementById('night-action-panel');
    const dayPanel = document.getElementById('day-action-panel');
    
    // Hide day panel, show night panel
    dayPanel.style.display = 'none';
    nightPanel.style.display = 'block';
    
    // Hide all role panels first
    document.querySelectorAll('.role-action-panel').forEach(panel => {
        panel.style.display = 'none';
    });
    
    // Show the appropriate role panel
    const rolePanel = document.getElementById(`${role}-action-panel`);
    if (rolePanel) {
        rolePanel.style.display = 'block';
        populateTargetList(role);
        setupNightActionHandlers(role);
    }
}

function hideNightActionPanel() {
    const nightPanel = document.getElementById('night-action-panel');
    const dayPanel = document.getElementById('day-action-panel');
    
    nightPanel.style.display = 'none';
    dayPanel.style.display = 'block';
    
    // Reset night action state
    selectedNightTarget = null;
    nightActionSubmitted = false;
}

function populateTargetList(role) {
    const targetListId = `${role}-target-list`;
    const targetList = document.getElementById(targetListId);
    
    if (!targetList) return;
    
    targetList.innerHTML = '';
    
    // Get all alive players (excluding self for most roles)
    const aliveCharacters = Array.from(document.querySelectorAll('.character-frame'))
        .filter(frame => !frame.classList.contains('eliminated'))
        .map(frame => frame.dataset.character);
    
    // Add human player to the list
    if (window.playerData && window.playerData.name) {
        aliveCharacters.push(window.playerData.name);
    }
    
    aliveCharacters.forEach(characterName => {
        // Skip self for mafia and detective (but allow for doctor)
        if ((role === 'mafia' || role === 'detective') && characterName === window.playerData.name) {
            return;
        }
        
        const targetOption = document.createElement('div');
        targetOption.className = 'target-option';
        targetOption.textContent = characterName;
        targetOption.dataset.target = characterName;
        
        targetOption.addEventListener('click', () => selectNightTarget(targetOption, role));
        
        targetList.appendChild(targetOption);
    });
}

function selectNightTarget(targetElement, role) {
    // Clear previous selection
    const targetList = document.getElementById(`${role}-target-list`);
    targetList.querySelectorAll('.target-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Select new target
    targetElement.classList.add('selected');
    selectedNightTarget = targetElement.dataset.target;
    
    // Enable confirm button
    const confirmBtn = document.getElementById(`${role}-confirm-btn`);
    if (confirmBtn) {
        confirmBtn.disabled = false;
    }
}

function setupNightActionHandlers(role) {
    const confirmBtn = document.getElementById(`${role}-confirm-btn`);
    
    if (confirmBtn) {
        // Remove existing event listeners
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        
        // Add new event listener
        newBtn.addEventListener('click', () => submitNightAction(role));
    }
    
    // Setup mafia partner display
    if (role === 'mafia' && window.playerData.mafiaPartners) {
        const partnerNameElement = document.getElementById('mafia-partner-name');
        if (partnerNameElement) {
            const partners = window.playerData.mafiaPartners.filter(name => name !== window.playerData.name);
            partnerNameElement.textContent = partners.join(', ') || 'Unknown';
        }
    }
}

function submitNightAction(role) {
    if (!selectedNightTarget || nightActionSubmitted) return;
    
    const actionData = {
        role: role,
        target: selectedNightTarget,
        playerId: window.playerData.id
    };
    
    // Send night action to server
    socket.emit('night-action', actionData);
    
    // Update UI
    nightActionSubmitted = true;
    const confirmBtn = document.getElementById(`${role}-confirm-btn`);
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = getActionConfirmText(role);
    }
    
    // Show confirmation
    const actionText = getActionText(role, selectedNightTarget);
    updateDialogue(actionText);
    showNotification(`Night action submitted: ${actionText}`, 'success');
}

function getActionText(role, target) {
    switch (role) {
        case 'mafia':
            return `You chose to eliminate ${target}`;
        case 'detective':
            return `You chose to investigate ${target}`;
        case 'doctor':
            return `You chose to protect ${target}`;
        default:
            return `Action submitted for ${target}`;
    }
}

function getActionConfirmText(role) {
    switch (role) {
        case 'mafia':
            return '🔪 Target Selected';
        case 'detective':
            return '🔍 Investigation Submitted';
        case 'doctor':
            return '🛡️ Protection Active';
        default:
            return '✅ Action Submitted';
    }
}

socket.on("phase-change", (data) => {
    updateUIForPhase(data.phase);
    currentRound.textContent = data.round;
    phaseTimer.textContent = formatTime(data.timeRemaining);

    // Handle phase-specific UI changes
    if (data.phase === "night") {
        clearSelection();
        
        // Show night action panel based on player role
        if (window.playerData && window.playerData.role) {
            showNightActionPanel(window.playerData.role);
        }
    } else {
        // Hide night action panel for non-night phases
        hideNightActionPanel();
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

    // Add to voting history
    addVotingRound(data);

    // Show voting results modal
    showVotingResults(data);
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
        
        // Apply character voice volume setting
        audio.volume = characterVoiceVolume;
        
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
socket.on("role-assigned", (data) => {
    updatePlayerRole(data.role);
    
    // Store mafia partners if player is mafia
    if (data.role === "mafia" && data.mafiaPartners) {
        window.playerData.mafiaPartners = data.mafiaPartners;
        const partnerNames = data.mafiaPartners.filter(name => name !== window.playerData.name);
        if (partnerNames.length > 0) {
            showNotification(`Your mafia partner is: ${partnerNames.join(", ")}`, 'info', 10000);
        }
    }
});

socket.on("game-restarted", (data) => {
    // Hide game results modal
    const modal = document.getElementById("game-results-modal");
    modal.style.display = "none";
    
    // Reset UI to lobby state
    updateUIForPhase(data.phase);
    currentRound.textContent = data.round;
    aliveCount.textContent = data.alivePlayers;
    
    // Reset player role display
    const playerRoleElement = document.getElementById('player-role');
    if (playerRoleElement) {
        playerRoleElement.textContent = "Unknown";
        playerRoleElement.className = "player-role";
    }
    
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

// Voting Results Modal Functions
function showVotingResults(data) {
    const modal = document.getElementById('voting-results-modal');
    const title = document.getElementById('voting-results-title');
    const eliminatedName = document.getElementById('eliminated-player-name');
    const eliminatedRole = document.getElementById('eliminated-player-role');
    const eliminationVoteCount = document.getElementById('elimination-vote-count');
    const voteBreakdownList = document.getElementById('vote-breakdown-list');
    const votingDetailsList = document.getElementById('voting-details-list');

    // Set elimination info
    eliminatedName.textContent = `${data.playerName} Eliminated`;
    eliminatedRole.textContent = `Role: ${data.role.toUpperCase()}`;
    eliminationVoteCount.textContent = `Total Votes: ${data.votes}`;

    // Create vote breakdown (who got how many votes)
    voteBreakdownList.innerHTML = '';
    data.voteBreakdown.forEach(([playerName, votes]) => {
        const voteItem = document.createElement('div');
        voteItem.className = `vote-item ${playerName === data.playerName ? 'eliminated' : ''}`;
        voteItem.innerHTML = `
            <span class="vote-item-name">${playerName}</span>
            <span class="vote-item-count">${votes} vote${votes !== 1 ? 's' : ''}</span>
        `;
        voteBreakdownList.appendChild(voteItem);
    });

    // Create voting details (who voted for whom) - this would need to be passed from server
    votingDetailsList.innerHTML = '';
    if (data.votingDetails) {
        data.votingDetails.forEach(([voter, target]) => {
            const detailItem = document.createElement('div');
            detailItem.className = 'voting-detail-item';
            detailItem.innerHTML = `
                <span class="voter-name">${voter}</span>
                <span class="arrow">→</span>
                <span class="voted-for">${target}</span>
            `;
            votingDetailsList.appendChild(detailItem);
        });
    } else {
        // Fallback if detailed voting info not available
        votingDetailsList.innerHTML = '<p style="color: #ccc; font-style: italic;">Detailed voting information not available</p>';
    }

    // Show modal
    modal.style.display = 'flex';

    // Auto-close after 8 seconds
    setTimeout(() => {
        if (modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
    }, 8000);
}

// Close voting results modal
document.getElementById('close-voting-results-btn').addEventListener('click', () => {
    const modal = document.getElementById('voting-results-modal');
    modal.style.display = 'none';
});

// Voting History Functions
function showVotingHistory() {
    const modal = document.getElementById('voting-history-modal');
    const content = document.getElementById('voting-history-content');
    
    if (votingHistory.length === 0) {
        content.innerHTML = `
            <div class="no-votes-message">
                <p>No voting rounds completed yet.</p>
                <p>Voting results will appear here after each elimination.</p>
            </div>
        `;
    } else {
        content.innerHTML = votingHistory.map((round, index) => `
            <div class="voting-round">
                <div class="voting-round-header">
                    <h3 class="round-title">Round ${round.round} - Voting Results</h3>
                    <span class="round-timestamp">${round.timestamp}</span>
                </div>
                <div class="round-elimination">
                    <h4 class="eliminated-player">${round.eliminatedPlayer} Eliminated</h4>
                    <p class="eliminated-role">Role: ${round.eliminatedRole.toUpperCase()}</p>
                </div>
                <div class="round-vote-breakdown">
                    ${round.voteBreakdown.map(([name, votes]) => `
                        <div class="vote-item ${name === round.eliminatedPlayer ? 'eliminated' : ''}">
                            <span class="vote-item-name">${name}</span>
                            <span class="vote-item-count">${votes} vote${votes !== 1 ? 's' : ''}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="round-voting-details">
                    <h5>Who Voted for Whom:</h5>
                    <div class="voting-detail-grid">
                        ${round.votingDetails.map(([voter, target]) => `
                            <div class="voting-detail-item-small">
                                <span class="voter-name">${voter}</span> → <span class="voted-for">${target}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    modal.style.display = 'flex';
}

function closeVotingHistory() {
    const modal = document.getElementById('voting-history-modal');
    modal.style.display = 'none';
}

function exportVotingHistory() {
    if (votingHistory.length === 0) {
        showNotification('No voting history to export!', 'warning');
        return;
    }
    
    const exportText = votingHistory.map(round => {
        const breakdown = round.voteBreakdown.map(([name, votes]) => `${name}: ${votes} votes`).join(', ');
        const details = round.votingDetails.map(([voter, target]) => `${voter} → ${target}`).join(', ');
        
        return `Round ${round.round} (${round.timestamp})
Eliminated: ${round.eliminatedPlayer} (${round.eliminatedRole})
Vote Breakdown: ${breakdown}
Voting Details: ${details}
---`;
    }).join('\n\n');
    
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mafia-voting-history-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    showNotification('Voting history exported!', 'success');
}

function addVotingRound(data) {
    const votingRound = {
        round: parseInt(currentRound.textContent),
        timestamp: new Date().toLocaleString(),
        eliminatedPlayer: data.playerName,
        eliminatedRole: data.role,
        voteBreakdown: data.voteBreakdown,
        votingDetails: data.votingDetails || []
    };
    
    votingHistory.push(votingRound);
}

// Initialize button states
updateButtonStates();
