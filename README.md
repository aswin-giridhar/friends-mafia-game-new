
# Central Perk Mafia - Friends Edition

A web-based multiplayer Mafia game featuring the beloved characters from the TV show "Friends". Players interact with AI-powered Friends characters using voice input and participate in classic Mafia gameplay.

## Features

- **AI-Powered Characters**: Interact with Joey, Phoebe, Chandler, Rachel, Ross, and Monica
- **Voice Interaction**: Speak to characters using speech recognition
- **Real-time Gameplay**: Live updates using Socket.IO
- **ElevenLabs Integration**: AI characters respond with generated voices
- **Photo Upload**: Players can upload their own photos
- **Responsive Design**: Works on desktop and mobile devices

## Prerequisites

Before running this application locally, ensure you have:

- **Node.js** (version 14 or higher)
- **npm** (comes with Node.js)
- **ElevenLabs API Key** (for voice generation)

## Installation

1. **Clone or download the project files** to your local machine

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Create environment file**:
   Create a `.env` file in the root directory and add your ElevenLabs API key:
   ```
   ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
   ```

4. **Create required directories**:
   ```bash
   mkdir -p public/images/players
   ```

## Getting Your ElevenLabs API Key

1. Sign up at [ElevenLabs](https://elevenlabs.io/)
2. Navigate to your profile settings
3. Generate an API key
4. Copy the key to your `.env` file

## Running the Application

1. **Start the server**:
   ```bash
   node index.js
   ```

2. **Open your browser** and navigate to:
   ```
   http://localhost:3000
   ```

3. **Enter your name** and optionally upload a photo

4. **Click "Start Game"** to begin playing

## How to Play

### Game Setup
- Enter your name and upload a photo (optional)
- Click "Start Game" to initialize the game with AI characters

### Game Phases

1. **Night Phase** (30 seconds)
   - Mafia chooses targets
   - Doctor protects someone
   - Detective investigates someone
   - Listen to the night unfold

2. **Discussion Phase** (3 minutes)
   - Discuss what happened during the night
   - Share suspicions about who might be mafia
   - Use voice input to talk to characters
   - Use the "Accuse" button to make formal accusations

3. **Voting Phase** (1 minute)
   - Vote to eliminate a suspected mafia member
   - Majority vote determines who gets eliminated

### Controls

- **Hold to Speak**: Press and hold the microphone button to talk to selected characters
- **Select Characters**: Click on character portraits to select them
- **Vote**: During voting phase, select a character and click "Vote"
- **Accuse**: During discussion phase, formally accuse someone of being mafia

### Roles

- **Townsfolk**: Eliminate all mafia members to win
- **Mafia**: Eliminate enough townspeople to control the town
- **Doctor**: Can save one person each night from elimination
- **Detective**: Can investigate one person each night to learn their role

## Project Structure

```
├── public/
│   ├── css/style.css          # Game styling
│   ├── js/game.js             # Client-side game logic
│   ├── images/
│   │   ├── characters/        # Friends character images
│   │   └── players/           # Uploaded player photos
├── views/
│   ├── index.ejs              # Game setup page
│   └── game.ejs               # Main game interface
├── characters.js              # Friends character data and voice IDs
├── index.js                   # Main server file
└── package.json               # Dependencies and scripts
```

## Configuration

You can modify game settings in `index.js`:

```javascript
const GAME_CONFIG = {
    nightPhaseDuration: 30,      // Night phase duration (seconds)
    discussionDuration: 180,     // Discussion phase duration (seconds)
    votingDuration: 60,          // Voting phase duration (seconds)
    minPlayers: 4,               // Minimum players to start
    maxPlayers: 8,               // Maximum players allowed
};
```

## Troubleshooting

### Common Issues

1. **"Module not found" errors**:
   - Make sure you ran `npm install`
   - Check that all dependencies are listed in `package.json`

2. **Voice generation not working**:
   - Verify your ElevenLabs API key is correct in `.env`
   - Check your ElevenLabs account has sufficient credits

3. **Images not loading**:
   - Ensure the `public/images/players/` directory exists
   - Check that character images are in `public/images/characters/`

4. **Socket.IO connection issues**:
   - Make sure the server is running on the correct port
   - Check browser console for connection errors

### Browser Compatibility

- **Speech Recognition**: Works best in Chrome/Chromium browsers
- **Audio Playback**: Supported in all modern browsers
- **File Upload**: Supported in all modern browsers

## Development

### Adding New Characters

1. Add character data to `characters.js`
2. Add character image to `public/images/characters/`
3. Get ElevenLabs voice ID for the character

### Modifying Game Logic

- **Phase timing**: Edit `GAME_CONFIG` in `index.js`
- **Win conditions**: Modify `checkWinConditions()` function
- **AI behavior**: Update `MCPManager` class responses

## Technical Details

- **Backend**: Node.js with Express
- **Real-time Communication**: Socket.IO
- **Template Engine**: EJS
- **File Upload**: Multer
- **Voice Generation**: ElevenLabs API
- **Speech Recognition**: Web Speech API (Chrome)

## Support

If you encounter issues:

1. Check the browser console for errors
2. Verify all dependencies are installed
3. Ensure your ElevenLabs API key is valid
4. Make sure you're using a supported browser (Chrome recommended)

---

Enjoy playing Central Perk Mafia with your favorite Friends characters!
