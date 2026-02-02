# Voice Recognition Features

## Overview
The Cognitive Overload Training Game now includes free speech-to-text capabilities using the **Web Speech API** (built into Chrome, Edge, and Safari browsers).

## Features Implemented

### 1. Team Setup Screen
- **What it does**: Before the game starts, team members enter their names and fun facts
- **Instructions**: Players are prompted to SAY this information out loud to their teammates while typing it in
- **Why**: Creates team bonding and stores player names for voice recognition

### 2. Voice-Activated Help Requests
- **How it works**: During gameplay, the app continuously listens for teammate names
- **Usage**: Say a teammate's name out loud (e.g., "Sarah!" or "Hey John!") to request help
- **Feedback**: A notification appears showing "{Name} - Help requested!"
- **Purpose**: Simulates OR communication and task delegation under pressure

### 3. Voice Answer Tasks (10% chance at difficulty 3+)
- **What**: Some tasks require speaking your answer instead of typing
- **Indicator**: Task instruction shows "(SPEAK YOUR ANSWER!)"
- **How to use**:
  1. Click the "🎤 Speak Answer" button
  2. Say your answer clearly (e.g., "five" or "the answer is 5")
  3. The app will display what you said
  4. Submit normally - your voice answer will be used for the visual task

## Browser Compatibility

### ✅ Supported Browsers
- **Chrome** (desktop & Android)
- **Microsoft Edge**
- **Safari** (desktop & iOS)
- **Samsung Internet**

### ❌ Not Supported
- Firefox (doesn't support Web Speech API)
- Older browsers

### Permission Required
When you first start the game, your browser will ask for **microphone permission**. You must allow this for voice features to work.

## Technical Details

### Web Speech API
- **Cost**: 100% FREE - uses built-in browser functionality
- **Privacy**: All processing happens in your browser, nothing sent to external servers
- **Accuracy**: Generally very good for clear speech in quiet environments

### Voice Recognition States
- **Listening**: 🎤 indicator shows "Listening..." (active during gameplay)
- **Help Request**: Indicator shows "{Name} - Help requested!" for 3 seconds
- **Voice Answer**: Special mode for capturing spoken answers

## Usage Tips

### For Best Results:
1. **Speak clearly** and at a moderate pace
2. **Use quiet environment** - background noise affects accuracy
3. **Say full names** - "Sarah Johnson" works better than just "Sarah"
4. **Wait for prompt** - let the button show "Listening..." before speaking
5. **Check microphone** - ensure your browser has microphone access

### Voice Answer Numbers:
The app will extract numbers from your speech:
- Say "five" → recognizes as 5
- Say "the answer is twelve" → extracts 12
- Say "twenty three" → extracts 23

## Troubleshooting

### "Speech recognition not supported"
- Use Chrome, Edge, or Safari
- Update your browser to the latest version

### Microphone not working
1. Check browser permissions (usually in address bar)
2. Ensure no other app is using your microphone
3. Try refreshing the page

### Voice not being recognized
1. Speak louder and more clearly
2. Check if microphone is working in other apps
3. Move closer to microphone
4. Reduce background noise

### Help requests not triggering
- Make sure you've entered team names in setup
- Say the EXACT name as entered
- Speak clearly with the name as a distinct word

## Game Flow

1. **Team Setup** → Enter names and fun facts (say them aloud!)
2. **Start Screen** → Review team info, click "Start Game"
3. **Permission Prompt** → Allow microphone access
4. **Gameplay** → Voice recognition active (🎤 indicator visible)
5. **Voice Tasks** → Occasionally, speak your answer instead of typing
6. **Help Requests** → Say teammate names anytime during challenges

## Future Enhancements (Potential)

- [ ] Voice commands to replay audio task
- [ ] Team scoring based on help requests
- [ ] Voice-activated timer pause
- [ ] Speech analysis for cognitive load assessment
- [ ] Multi-language support

## Credits

Built using the Web Speech API (https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
