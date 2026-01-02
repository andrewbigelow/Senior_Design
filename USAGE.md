# Cognitive Overload Training Game

A multi-modal cognitive challenge game that combines visual and auditory tasks to train users in high-pressure decision-making scenarios. Built for UC San Diego Bioengineering Senior Design Project.

## Overview

This application presents users with simultaneous visual and auditory challenges that increase in difficulty. Users must:
- Complete **visual tasks** like clicking on items starting with a specific letter, counting colored boxes, or identifying shapes
- Complete **audio tasks** like counting numbers, adding/subtracting even/odd numbers, or identifying prime numbers
- Handle both tasks under time pressure with moving timers and distracting elements

## Features

### Visual Tasks
- **Letter matching**: Click on all images starting with a specific letter (e.g., "B" - banana, blanket, etc.)
- **Color counting**: Count items of a specific color among mixed colored boxes
- **Number operations**: Count odd/even/prime numbers displayed on screen

### Audio Tasks
Generated using Google Text-to-Speech (gTTS) with varying difficulty:
- **Easy**: Count all numbers (slow speech, no accents)
- **Medium**: Count specific number types or perform addition
- **Hard**: Complex operations like "add even and subtract odd"
- Difficulty affects speech rate, accent variation, and number of words/numbers

### Difficulty Progression
1. **Easy** (Level 1): 40 seconds, fewer items, slow speech
2. **Medium** (Level 2): 35 seconds, more items, moderate complexity
3. **Hard** (Level 3): 30 seconds, complex tasks
4. **Expert** (Level 4): 25 seconds, high cognitive load
5. **Overload** (Level 5): 20 seconds, maximum challenge

## Installation

### Prerequisites
- Python 3.8 or higher
- pip (Python package manager)

### Setup

1. **Clone or navigate to the repository**:
   ```bash
   cd /path/to/Senior_Design
   ```

2. **Install dependencies**:
   ```bash
   pip3 install -r requirements.txt
   ```

   Required packages:
   - Flask (web framework)
   - flask-cors (cross-origin resource sharing)
   - gTTS (Google Text-to-Speech)
   - python-dotenv (environment variables)

3. **Verify word files exist**:
   Ensure these files are present:
   - `easy_words.txt`
   - `medium_words.txt`
   - `hard_words.txt`

## Running the Application

1. **Start the Flask server**:
   ```bash
   python3 app.py
   ```

2. **Open your browser** and navigate to:
   ```
   http://localhost:5000
   ```

3. **Click "Start Game"** to begin the first challenge

## How to Play

1. **Read both instructions**:
   - **VISUAL** task (green background) - shown on screen
   - **AUDIO** task (blue background) - listen to the audio

2. **Complete the visual task**:
   - For "click" tasks: Click on matching items (they'll highlight in gold)
   - For "count" tasks: Just observe and count

3. **Listen and solve the audio task**:
   - Audio plays automatically when the round starts
   - Calculate the answer based on the spoken instructions

4. **Enter your audio answer** in the input field

5. **Click "Submit Both Answers"** before time runs out

6. **Review feedback**:
   - Green = both tasks correct
   - Red = shows which tasks were incorrect and expected answers

7. **Click "Next Challenge"** to advance to the next difficulty level

## Project Structure

```
Senior_Design/
├── app.py                  # Flask backend with API endpoints
├── audio_output.py         # Text-to-speech audio generation
├── difficulty.py           # Difficulty settings and task generation
├── word_generator.py       # Word loading from difficulty files
├── requirements.txt        # Python dependencies
├── templates/
│   └── game.html          # Main game interface
├── static/                 # Static assets (images, CSS, JS)
├── easy_words.txt         # Word pool for easy difficulty
├── medium_words.txt       # Word pool for medium difficulty
└── hard_words.txt         # Word pool for hard difficulty
```

## API Endpoints

### POST `/api/start-challenge`
Generates a new round with visual and audio tasks.

**Request body**:
```json
{
  "difficulty": 1-5
}
```

**Response**:
```json
{
  "visual_task": {
    "type": "letter_start|color_count|number_count",
    "instruction": "Click on all images that start with the letter B",
    "items": [...],
    "display_type": "clickable|count"
  },
  "audio_task": {
    "instruction": "Count all even numbers",
    "audio_url": "/api/audio/number_audio.mp3"
  }
}
```

### POST `/api/submit-answer`
Validates user answers for both tasks.

**Request body**:
```json
{
  "visual_answer": [...] or number,
  "audio_answer": number
}
```

**Response**:
```json
{
  "visual_correct": true/false,
  "audio_correct": true/false,
  "both_correct": true/false,
  "visual_expected": ...,
  "audio_expected": number,
  "total_correct": number
}
```

### GET `/api/audio/<filename>`
Serves generated audio files.

## Customization

### Adding New Visual Task Types
Edit `app.py`, add to `VISUAL_TASKS` list:
```python
{
    'type': 'your_task_type',
    'instruction': 'Your instruction template',
    'categories': [...]
}
```

### Adjusting Difficulty Settings
Edit `difficulty.py` to modify:
- Speech rate (`speech_rate_by_difficulty`)
- Accent variation (`use_accents_by_difficulty`)
- Number of words/numbers (`audio_output_by_difficulty`)
- Task complexity

### Changing Time Limits
Edit `templates/game.html`, modify the `difficulties` array:
```javascript
const difficulties = [
    { name: "Easy", level: 1, timeLimit: 40 },
    // ... adjust timeLimit values
];
```

## Development Team

**Group 6**: Design of a Device for Task Saturation to Improve Safety and Communication in the Operating Room

- Sophie Brown
- Andrew Bigelow

**Mentor**: Dr. Nicolas Bauer, Anesthesia, UC San Diego Health

## Troubleshooting

### Audio not playing
- Ensure gTTS is installed: `pip3 install gTTS`
- Check browser console for errors
- Verify audio files are being generated in the project directory

### Port already in use
Change the port in `app.py`:
```python
app.run(debug=True, port=5001)  # Change to any available port
```

### Word files missing
Ensure `easy_words.txt`, `medium_words.txt`, and `hard_words.txt` exist in the project root.

### Module not found errors
Reinstall dependencies:
```bash
pip3 install -r requirements.txt
```

## License

UC San Diego Bioengineering Senior Design Project, 2025-2026

## Future Enhancements

- [ ] Add actual image display instead of text labels
- [ ] Implement user authentication and progress tracking
- [ ] Add performance analytics dashboard
- [ ] Support multiplayer competitive mode
- [ ] Mobile-responsive design
- [ ] Adjustable difficulty curve based on user performance
