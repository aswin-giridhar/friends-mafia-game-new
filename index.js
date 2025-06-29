const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const axios = require("axios");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

// OpenAI configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = "https://api.openai.com/v1";

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
    chatHistory: [], // Store all chat messages for display
    suspicionLevels: new Map(), // Track suspicion between characters
    investigationResults: new Map(), // Store detective investigation results
    discussionTopics: [], // Current discussion topics
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

// OpenAI API function for dynamic conversation generation
async function generateOpenAIDialogue(character, context) {
    if (!OPENAI_API_KEY) {
        console.log("OpenAI API key not found, falling back to rule-based dialogue");
        return null;
    }

    try {
        const characterData = friendsCharacters[character];
        const gameContext = buildGameContext();
        
        const systemPrompt = `You are ${character} from Friends playing a Mafia game. 

CHARACTER TRAITS:
${characterData.traits.join(', ')}

CURRENT GAME CONTEXT:
- Phase: ${gameContext.phase}
- Round: ${gameContext.round}
- Alive Players: ${gameContext.alivePlayers.join(', ')}
- Eliminated Players: ${gameContext.eliminatedPlayers.join(', ')}
- Your Role: ${context.role}
- Discussion Topic: ${context.topicType}
- Target/Subject: ${context.target || 'None'}

RECENT GAME EVENTS:
${gameContext.recentEvents.join('\n')}

CONVERSATION HISTORY (last 5 messages):
${gameContext.recentConversations.slice(-5).map(msg => `${msg.speaker}: ${msg.message}`).join('\n')}

INSTRUCTIONS:
1. Stay completely in character as ${character}
2. Use their signature speech patterns and catchphrases
3. Respond to the current discussion topic: ${context.topicType}
4. Keep responses under 150 characters for voice synthesis
5. Be strategic based on your role but don't reveal it directly
6. Reference recent game events naturally
7. Show appropriate suspicion/trust based on game state

Generate a single response that ${character} would say in this situation:`;

        const response = await axios.post(
            `${OPENAI_BASE_URL}/chat/completions`,
            {
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: `Generate ${character}'s response to the current situation. Topic: ${context.topicType}${context.target ? `, regarding ${context.target}` : ''}`
                    }
                ],
                max_tokens: 100,
                temperature: 0.8,
                presence_penalty: 0.3,
                frequency_penalty: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const generatedDialogue = response.data.choices[0].message.content.trim();
        
        // Clean up the response (remove quotes, ensure it's not too long)
        const cleanDialogue = generatedDialogue
            .replace(/^["']|["']$/g, '') // Remove surrounding quotes
            .substring(0, 200); // Limit length for voice synthesis
        
        console.log(`OpenAI generated dialogue for ${character}: ${cleanDialogue}`);
        return cleanDialogue;

    } catch (error) {
        console.error("OpenAI API Error:", error.message);
        return null; // Fall back to rule-based system
    }
}

// Build comprehensive game context for OpenAI
function buildGameContext() {
    const recentEvents = [];
    const recentConversations = [];
    
    // Add recent eliminations
    if (gameState.eliminatedPlayers.length > 0) {
        const lastEliminated = gameState.eliminatedPlayers[gameState.eliminatedPlayers.length - 1];
        recentEvents.push(`${lastEliminated.name || lastEliminated.playerName} was recently eliminated (${lastEliminated.role})`);
    }
    
    // Add investigation results context
    if (gameState.investigationResults.size > 0) {
        gameState.investigationResults.forEach((result, detective) => {
            recentEvents.push(`${detective} investigated ${result.target} and found they are ${result.isMafia ? 'suspicious' : 'innocent'}`);
        });
    }
    
    // Add suspicion levels
    if (gameState.suspicionLevels.size > 0) {
        const topSuspicions = Array.from(gameState.suspicionLevels.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        topSuspicions.forEach(([player, level]) => {
            recentEvents.push(`${player} has high suspicion level (${level})`);
        });
    }
    
    // Add recent conversations
    if (mcpManager.gameHistory.length > 0) {
        recentConversations.push(...mcpManager.gameHistory.slice(-10));
    }
    
    return {
        phase: gameState.phase,
        round: gameState.round,
        alivePlayers: gameState.alivePlayers.map(p => p.name || p.playerName),
        eliminatedPlayers: gameState.eliminatedPlayers.map(p => p.name || p.playerName),
        recentEvents: recentEvents.length > 0 ? recentEvents : ['Game just started'],
        recentConversations: recentConversations
    };
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

// AI Discussion Manager - Generates automatic conversations during discussion phase
class AIDiscussionManager {
    constructor() {
        this.discussionQueue = [];
        this.activeDiscussion = null;
        this.discussionTimer = null;
        this.conversationHistory = [];
    }

    // Start AI discussions during discussion phase
    startDiscussionPhase() {
        this.generateDiscussionTopics();
        this.scheduleDiscussions();
    }

    // Generate discussion topics based on game state, investigations, and suspicions
    generateDiscussionTopics() {
        const topics = [];
        const alivePlayers = gameState.alivePlayers.filter(p => p.name); // AI characters only
        
        // Topic 1: Investigation-based discussions
        if (gameState.investigationResults.size > 0) {
            gameState.investigationResults.forEach((result, detective) => {
                if (result.isMafia) {
                    topics.push({
                        type: "investigation_accusation",
                        speaker: detective,
                        target: result.target,
                        priority: 100,
                        content: `I have reason to believe ${result.target} is suspicious. Their behavior last night was very concerning.`
                    });
                } else {
                    topics.push({
                        type: "investigation_defense",
                        speaker: detective,
                        target: result.target,
                        priority: 70,
                        content: `I can vouch for ${result.target}. They seem trustworthy to me.`
                    });
                }
            });
        }

        // Topic 2: Suspicion-based discussions
        if (gameState.suspicionLevels.size > 0) {
            const suspicions = Array.from(gameState.suspicionLevels.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
            
            suspicions.forEach(([suspectedPlayer, level]) => {
                const accusers = alivePlayers.filter(p => Math.random() > 0.6); // Random accusers
                accusers.forEach(accuser => {
                    topics.push({
                        type: "suspicion",
                        speaker: accuser.name,
                        target: suspectedPlayer,
                        priority: level,
                        content: this.generateSuspicionComment(accuser.name, suspectedPlayer, level)
                    });
                });
            });
        }

        // Topic 3: Defense responses
        const accusations = topics.filter(t => t.type === "suspicion" || t.type === "investigation_accusation");
        accusations.forEach(accusation => {
            const defender = alivePlayers.find(p => p.name === accusation.target);
            if (defender) {
                topics.push({
                    type: "defense",
                    speaker: accusation.target,
                    target: accusation.speaker,
                    priority: 80,
                    content: this.generateDefenseResponse(accusation.target, accusation.speaker)
                });
            }
        });

        // Topic 4: Strategic discussions based on eliminations
        if (gameState.eliminatedPlayers.length > 0) {
            const lastEliminated = gameState.eliminatedPlayers[gameState.eliminatedPlayers.length - 1];
            alivePlayers.forEach(player => {
                if (Math.random() > 0.7) { // 30% chance each player comments
                    topics.push({
                        type: "elimination_analysis",
                        speaker: player.name,
                        target: lastEliminated.name || lastEliminated.playerName,
                        priority: 60,
                        content: this.generateEliminationComment(player.name, lastEliminated)
                    });
                }
            });
        }

        // Topic 5: Role-based strategic comments
        alivePlayers.forEach(player => {
            if (player.role === "mafia") {
                // Mafia tries to deflect suspicion
                const innocentTargets = alivePlayers.filter(p => p.role !== "mafia" && p !== player);
                if (innocentTargets.length > 0) {
                    const target = innocentTargets[Math.floor(Math.random() * innocentTargets.length)];
                    topics.push({
                        type: "mafia_deflection",
                        speaker: player.name,
                        target: target.name,
                        priority: 90,
                        content: this.generateMafiaDeflection(player.name, target.name)
                    });
                }
            } else if (player.role === "detective" && Math.random() > 0.5) {
                // Detective shares "insights" without revealing role
                topics.push({
                    type: "detective_insight",
                    speaker: player.name,
                    target: null,
                    priority: 75,
                    content: this.generateDetectiveInsight(player.name)
                });
            }
        });

        // Sort topics by priority and store
        this.discussionQueue = topics.sort((a, b) => b.priority - a.priority);
        gameState.discussionTopics = this.discussionQueue;
    }

    // Schedule discussions throughout the discussion phase
    scheduleDiscussions() {
        const discussionDuration = GAME_CONFIG.discussionDuration * 1000; // Convert to milliseconds
        const numDiscussions = Math.min(this.discussionQueue.length, 8); // Max 8 discussions
        const interval = discussionDuration / (numDiscussions + 1); // Space them out

        let delay = interval * 0.3; // Start after 30% of first interval

        for (let i = 0; i < numDiscussions; i++) {
            setTimeout(() => {
                if (gameState.phase === "discussion" && this.discussionQueue.length > 0) {
                    this.triggerDiscussion();
                }
            }, delay);
            delay += interval;
        }
    }

    // Trigger a single discussion
    async triggerDiscussion() {
        if (this.discussionQueue.length === 0) return;

        const topic = this.discussionQueue.shift();
        const speaker = gameState.aiPersonas.find(p => p.name === topic.speaker && p.isAlive);
        
        if (!speaker) return;

        // Generate character-specific dialogue
        const dialogue = this.generateCharacterDialogue(speaker, topic);
        
        // Add to conversation history
        this.conversationHistory.push({
            speaker: speaker.name,
            content: dialogue,
            timestamp: new Date(),
            topic: topic.type,
            target: topic.target
        });

        // Add to game chat history
        gameState.chatHistory.push({
            character: speaker.name,
            message: dialogue,
            timestamp: new Date(),
            type: "ai"
        });

        // Update MCP manager history
        mcpManager.gameHistory.push({
            character: speaker.name,
            message: dialogue,
            timestamp: new Date(),
            type: "ai"
        });

        // Generate voice and broadcast
        try {
            const audioBuffer = await generateVoice(dialogue, speaker.voiceId);
            
            io.emit("character-speaking", {
                character: speaker.name,
                dialogue: dialogue,
                audio: audioBuffer ? audioBuffer.toString("base64") : null,
            });

            // Update chat history for all clients
            io.emit('chat-history-update', mcpManager.getGameHistory());

            // Update suspicion levels based on discussion
            this.updateSuspicionLevels(topic);

            setTimeout(() => io.emit("clear-speaker"), 3000);
        } catch (error) {
            console.error("Error generating discussion audio:", error);
        }

        // Trigger responses from other characters
        setTimeout(() => {
            this.triggerResponse(topic);
        }, 4000);
    }

    // Generate character-specific dialogue based on personality
    async generateCharacterDialogue(speaker, topic) {
        // Try OpenAI first for dynamic, contextual dialogue
        const openAIDialogue = await generateOpenAIDialogue(speaker.name, {
            role: speaker.role,
            topicType: topic.type,
            target: topic.target,
            content: topic.content
        });

        // If OpenAI succeeds, use it; otherwise fall back to rule-based
        if (openAIDialogue) {
            console.log(`Using OpenAI dialogue for ${speaker.name}: ${openAIDialogue}`);
            return openAIDialogue;
        }

        // Fallback to rule-based dialogue generation
        console.log(`Falling back to rule-based dialogue for ${speaker.name}`);
        const characterData = friendsCharacters[speaker.name];
        let baseDialogue = topic.content;

        // Customize dialogue based on character personality
        switch (speaker.name) {
            case "Joey":
                return this.joeyifyDialogue(baseDialogue, topic);
            case "Phoebe":
                return this.phoebeifyDialogue(baseDialogue, topic);
            case "Chandler":
                return this.chandlerifyDialogue(baseDialogue, topic);
            case "Rachel":
                return this.rachelifyDialogue(baseDialogue, topic);
            case "Ross":
                return this.rossifyDialogue(baseDialogue, topic);
            case "Monica":
                return this.monicaifyDialogue(baseDialogue, topic);
            default:
                return baseDialogue;
        }
    }

    joeyifyDialogue(dialogue, topic) {
        if (topic.type === "suspicion") {
            return `I don't know about all this detective stuff, but ${topic.target} has been acting weird. Like, weirder than usual. And that's saying something!`;
        } else if (topic.type === "defense") {
            return `Hey, hey, hey! Why is everyone picking on me? I'm just trying to figure out who's the bad guy here. Can we discuss this over sandwiches?`;
        } else if (topic.type === "mafia_deflection") {
            return `You know what? I think we should look at ${topic.target}. They've been way too quiet. Suspicious people are quiet, right?`;
        }
        return `${dialogue} Also, is anyone else hungry right now?`;
    }

    phoebeifyDialogue(dialogue, topic) {
        if (topic.type === "suspicion") {
            return `My spirit guide is telling me that ${topic.target} has some seriously dark energy around them. Like, really dark. Darker than my grandmother's basement.`;
        } else if (topic.type === "defense") {
            return `Okay, first of all, accusing me is like, really bad karma. The universe doesn't like finger-pointers. Second, I would never hurt anyone - I'm a vegetarian!`;
        } else if (topic.type === "detective_insight") {
            return `I had this dream last night where someone was wearing a mask, but I couldn't see who it was. But the vibes were definitely evil. Very evil vibes.`;
        }
        return `${dialogue} The crystals are very active today, which means someone's lying.`;
    }

    chandlerifyDialogue(dialogue, topic) {
        if (topic.type === "suspicion") {
            return `Could ${topic.target} BE any more suspicious? I mean, seriously, their behavior is like a textbook case of 'how to act guilty 101'.`;
        } else if (topic.type === "defense") {
            return `Could this BE any more ridiculous? I'm being accused of being mafia? What's next, someone's gonna blame me for the Y2K bug?`;
        } else if (topic.type === "mafia_deflection") {
            return `I'm not saying ${topic.target} is definitely mafia, but if I had to bet my statistical analysis software on it... well, let's just say the odds aren't in their favor.`;
        }
        return `${dialogue} Could this situation BE any more confusing?`;
    }

    rachelifyDialogue(dialogue, topic) {
        if (topic.type === "suspicion") {
            return `OMG, ${topic.target} is totally acting shady! Like, shadier than when I tried to return that dress I wore to Barry's wedding. Something is definitely not right here!`;
        } else if (topic.type === "defense") {
            return `Excuse me? I am NOT mafia! I work in fashion, not... whatever evil people do! This is so unfair!`;
        } else if (topic.type === "elimination_analysis") {
            return `I can't believe ${topic.target} is gone! This is like, worse than when Central Perk ran out of non-fat milk. We need to figure this out!`;
        }
        return `${dialogue} This is so stressful, I need a shopping break!`;
    }

    rossifyDialogue(dialogue, topic) {
        if (topic.type === "suspicion") {
            return `From a scientific perspective, ${topic.target}'s behavioral patterns are consistent with deceptive tendencies. It's like studying predator-prey relationships in the Cretaceous period.`;
        } else if (topic.type === "defense") {
            return `This accusation is completely unfounded! I have three degrees and I would never engage in such duplicitous behavior. This is more frustrating than when they moved my dinosaur exhibit!`;
        } else if (topic.type === "detective_insight") {
            return `As someone who studies ancient civilizations, I can tell you that deception has been a human trait for millennia. We need to analyze the evidence methodically.`;
        }
        return `${dialogue} Paleontologically speaking, this situation is fascinating yet terrifying.`;
    }

    monicaifyDialogue(dialogue, topic) {
        if (topic.type === "suspicion") {
            return `I KNOW ${topic.target} is lying! I can always tell when people aren't being honest - it's like my superpower! We need to vote them out NOW!`;
        } else if (topic.type === "defense") {
            return `How DARE you accuse me! I am the most honest person here! I organize, I clean, I take care of everyone - I would NEVER be mafia!`;
        } else if (topic.type === "mafia_deflection") {
            return `We need to be systematic about this! ${topic.target} has been acting suspicious and we need to eliminate threats efficiently!`;
        }
        return `${dialogue} We need rules and structure to catch the mafia!`;
    }

    // Generate suspicion comments based on character and suspicion level
    generateSuspicionComment(speaker, target, level) {
        const comments = [
            `${target} has been acting really strange lately.`,
            `I don't trust ${target}. Something feels off about them.`,
            `Has anyone else noticed how quiet ${target} has been?`,
            `${target}'s behavior last round was very suspicious.`,
            `I think we should keep an eye on ${target}.`
        ];
        return comments[Math.floor(Math.random() * comments.length)];
    }

    // Generate defense responses
    generateDefenseResponse(defender, accuser) {
        const responses = [
            `Why are you targeting me, ${accuser}? That's pretty suspicious if you ask me.`,
            `I'm innocent! ${accuser} is just trying to deflect attention from themselves.`,
            `This accusation is completely unfair, ${accuser}. I've been trying to help!`,
            `${accuser}, you're making a huge mistake. I'm on your side!`,
            `I can't believe you're accusing me, ${accuser}. We need to work together!`
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    }

    // Generate elimination analysis comments
    generateEliminationComment(speaker, eliminated) {
        const comments = [
            `I can't believe ${eliminated.name || eliminated.playerName} is gone. They seemed so innocent.`,
            `Maybe eliminating ${eliminated.name || eliminated.playerName} was a mistake.`,
            `${eliminated.name || eliminated.playerName}'s elimination tells us something about who voted for them.`,
            `We need to learn from what happened to ${eliminated.name || eliminated.playerName}.`,
            `The fact that ${eliminated.name || eliminated.playerName} was eliminated makes me suspicious of their accusers.`
        ];
        return comments[Math.floor(Math.random() * comments.length)];
    }

    // Generate mafia deflection comments
    generateMafiaDeflection(speaker, target) {
        const deflections = [
            `I think we're looking at the wrong person. ${target} has been way too quiet.`,
            `${target} is the one we should be worried about, not me.`,
            `Has anyone else noticed how ${target} always deflects when questioned?`,
            `${target}'s voting patterns have been very suspicious.`,
            `We should focus on ${target} - they're the real threat here.`
        ];
        return deflections[Math.floor(Math.random() * deflections.length)];
    }

    // Generate detective insights without revealing role
    generateDetectiveInsight(speaker) {
        const insights = [
            `I've been watching everyone carefully, and I have some concerns about certain people.`,
            `Based on what I've observed, I think we need to be more careful about who we trust.`,
            `I've noticed some patterns in behavior that are concerning.`,
            `My instincts are telling me that someone here is definitely not who they seem.`,
            `I think we need to pay more attention to the details of what people say and do.`
        ];
        return insights[Math.floor(Math.random() * insights.length)];
    }

    // Trigger responses from other characters
    async triggerResponse(originalTopic) {
        if (gameState.phase !== "discussion") return;

        const respondents = gameState.aiPersonas.filter(p => 
            p.isAlive && 
            p.name !== originalTopic.speaker && 
            Math.random() > 0.7 // 30% chance to respond
        );

        for (const respondent of respondents.slice(0, 2)) { // Max 2 responses
            setTimeout(async () => {
                if (gameState.phase !== "discussion") return;

                const response = this.generateResponse(respondent, originalTopic);
                
                // Add to histories
                this.conversationHistory.push({
                    speaker: respondent.name,
                    content: response,
                    timestamp: new Date(),
                    topic: "response",
                    target: originalTopic.speaker
                });

                gameState.chatHistory.push({
                    character: respondent.name,
                    message: response,
                    timestamp: new Date(),
                    type: "ai"
                });

                mcpManager.gameHistory.push({
                    character: respondent.name,
                    message: response,
                    timestamp: new Date(),
                    type: "ai"
                });

                try {
                    const audioBuffer = await generateVoice(response, respondent.voiceId);
                    
                    io.emit("character-speaking", {
                        character: respondent.name,
                        dialogue: response,
                        audio: audioBuffer ? audioBuffer.toString("base64") : null,
                    });

                    io.emit('chat-history-update', mcpManager.getGameHistory());
                    setTimeout(() => io.emit("clear-speaker"), 3000);
                } catch (error) {
                    console.error("Error generating response audio:", error);
                }
            }, Math.random() * 3000 + 1000); // Random delay 1-4 seconds
        }
    }

    // Generate responses to topics
    generateResponse(respondent, originalTopic) {
        if (originalTopic.target === respondent.name) {
            // Direct response to being accused/mentioned
            return this.generateCharacterDialogue(respondent, {
                type: "defense",
                speaker: respondent.name,
                target: originalTopic.speaker,
                content: `I disagree with ${originalTopic.speaker}.`
            });
        } else if (originalTopic.type === "suspicion" && respondent.role === "mafia") {
            // Mafia supports accusations against innocents
            return this.generateCharacterDialogue(respondent, {
                type: "mafia_support",
                speaker: respondent.name,
                target: originalTopic.target,
                content: `I agree with ${originalTopic.speaker}. ${originalTopic.target} does seem suspicious.`
            });
        } else {
            // General agreement or disagreement
            const agree = Math.random() > 0.5;
            const response = agree ? 
                `I think ${originalTopic.speaker} makes a good point.` :
                `I'm not sure I agree with ${originalTopic.speaker} on this one.`;
            
            return this.generateCharacterDialogue(respondent, {
                type: "general_response",
                speaker: respondent.name,
                target: originalTopic.speaker,
                content: response
            });
        }
    }

    // Update suspicion levels based on discussions
    updateSuspicionLevels(topic) {
        if (topic.type === "suspicion" || topic.type === "investigation_accusation") {
            const currentLevel = gameState.suspicionLevels.get(topic.target) || 0;
            gameState.suspicionLevels.set(topic.target, currentLevel + 10);
        } else if (topic.type === "defense") {
            const currentLevel = gameState.suspicionLevels.get(topic.speaker) || 0;
            gameState.suspicionLevels.set(topic.speaker, Math.max(0, currentLevel - 5));
        }
    }

    // Store investigation results for future discussions
    storeInvestigationResult(detective, target, isMafia) {
        gameState.investigationResults.set(detective, {
            target: target,
            isMafia: isMafia,
            round: gameState.round
        });
    }

    // Clear discussion data for new round
    clearDiscussionData() {
        this.discussionQueue = [];
        this.conversationHistory = [];
        if (this.discussionTimer) {
            clearTimeout(this.discussionTimer);
            this.discussionTimer = null;
        }
    }
}

const aiDiscussionManager = new AIDiscussionManager();

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

    // Store investigation results for AI discussions
    if (detectiveCheck) {
        const detective = gameState.alivePlayers.find(p => p.role === "detective");
        if (detective) {
            aiDiscussionManager.storeInvestigationResult(
                detective.name || detective.playerName,
                detectiveCheck.name || detectiveCheck.playerName,
                detectiveCheck.role === "mafia"
            );
        }
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
    
    // Start AI discussions during discussion phase
    setTimeout(() => {
        if (gameState.phase === "discussion") {
            aiDiscussionManager.startDiscussionPhase();
        }
    }, 2000); // Start discussions 2 seconds into discussion phase
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

    // Clear discussion data for new round
    aiDiscussionManager.clearDiscussionData();

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
    let playerPhoto;

    if (req.file) {
        // User uploaded a photo
        playerPhoto = req.file.filename;
    } else {
        // Generate a random avatar using a placeholder service
        const avatarStyles = ['adventurer', 'avataaars', 'big-ears', 'big-smile', 'croodles', 'fun-emoji', 'icons', 'identicon', 'initials', 'lorelei', 'micah', 'miniavs', 'open-peeps', 'personas', 'pixel-art'];
        const randomStyle = avatarStyles[Math.floor(Math.random() * avatarStyles.length)];
        const seed = encodeURIComponent(playerName + Date.now()); // Use player name + timestamp as seed
        playerPhoto = `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
    }

    const playerId = uuidv4();
    gameState.players.set(playerId, {
        id: playerId,
        playerName: playerName,
        photo: playerPhoto,
        isUploaded: !!req.file, // Track if photo was uploaded or generated
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
