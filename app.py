from flask import Flask, render_template, jsonify, request, send_file
from flask_cors import CORS
import random
import os
import glob
from pathlib import Path
import audio_output
import difficulty
import word_generator

app = Flask(__name__)
CORS(app)

# Store current game state
game_state = {
    'current_round': 1,
    'correct_answers': 0,
    'visual_task': None,
    'audio_task': None,
    'audio_file': None,
    'correct_answer': None
}

# Visual task templates with image categories
VISUAL_TASKS = [
    {
        'type': 'letter_start',
        'instruction': 'Click on all images that start with the letter {letter}',
        'categories': ['apple', 'banana', 'cow', 'dog', 'elephant', 'flower', 'guitar', 'hat', 'ice', 'jungle']
    },
    {
        'type': 'color_count',
        'instruction': 'Count all {color} colored items',
        'colors': ['red', 'blue', 'green', 'yellow', 'purple']
    },
    {
        'type': 'number_count',
        'instruction': 'Count all {type} numbers',
        'types': ['odd', 'even', 'prime']
    },
    {
        'type': 'shape_select',
        'instruction': 'Click on all {shape} shapes',
        'shapes': ['circle', 'square', 'triangle', 'star']
    }
]

def generate_visual_task(difficulty_level):
    """Generate a visual task based on difficulty"""
    # Occasionally make it a voice task (10% chance at higher difficulties)
    is_voice_task = difficulty_level >= 3 and random.random() < 0.1
    
    task_template = random.choice(VISUAL_TASKS)
    
    # Scale items based on difficulty more gradually
    base_items = 8
    items_per_level = 4
    num_items = base_items + (difficulty_level * items_per_level)
    
    if task_template['type'] == 'letter_start':
        # Scan the static/images directory for available images
        image_files = [f for f in os.listdir('static/images') if f.endswith(('.png', '.jpg', '.jpeg', '.svg'))]
        
        # If no images are found, return a fallback task
        if not image_files:
            return {
                'type': 'letter_start',
                'instruction': 'No images found! Please add images to the static/images folder.',
                'items': [],
                'correct_answer': [],
                'display_type': 'clickable',
                'is_voice_task': False
            }

        items = [Path(f).stem for f in image_files] # Get the name of the item from the filename

        max_attempts = 10
        for attempt in range(max_attempts):
            letter = random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
            selected_items = random.sample(items, min(num_items, len(items)))
            correct_items = [item for item in selected_items if item.upper().startswith(letter)]
            
            if len(correct_items) > 0:
                break
        
        if len(correct_items) == 0:
            letter = selected_items[0][0].upper()
            correct_items = [item for item in selected_items if item.upper().startswith(letter)]
        
        # Map item names back to full filenames for the frontend
        selected_filenames = [f for f in image_files if Path(f).stem in selected_items]
        correct_filenames = [f for f in image_files if Path(f).stem in correct_items]

        return {
            'type': 'letter_start',
            'instruction': f'Click on all images that start with the letter {letter}',
            'items': selected_filenames,
            'correct_answer': correct_filenames,
            'display_type': 'clickable',
            'is_voice_task': is_voice_task
        }
    
    elif task_template['type'] == 'color_count':
        color = random.choice(task_template['colors'])
        
        items = []
        correct_count = 0
        for i in range(num_items):
            item_color = random.choice(task_template['colors'])
            items.append({'id': i, 'color': item_color, 'type': 'colored_box'})
            if item_color == color:
                correct_count += 1
        
        return {
            'type': 'color_count',
            'instruction': f'Count all {color} colored items',
            'items': items,
            'correct_answer': correct_count,
            'display_type': 'count',
            'is_voice_task': is_voice_task
        }
    
    elif task_template['type'] == 'number_count':
        num_type = random.choice(task_template['types'])
        
        numbers = random.sample(range(1, 100), num_items)
        correct_count = 0
        
        for num in numbers:
            if num_type == 'odd' and num % 2 == 1:
                correct_count += 1
            elif num_type == 'even' and num % 2 == 0:
                correct_count += 1
            elif num_type == 'prime':
                if num > 1 and all(num % i != 0 for i in range(2, int(num**0.5) + 1)):
                    correct_count += 1
        
        items = [{'id': i, 'value': num, 'type': 'number'} for i, num in enumerate(numbers)]
        
        return {
            'type': 'number_count',
            'instruction': f'Count all {num_type} numbers',
            'items': items,
            'correct_answer': correct_count,
            'display_type': 'count',
            'is_voice_task': is_voice_task
        }
    
    return None

def generate_audio_task(difficulty_level, time_limit=45):
    """Generate an audio task using the difficulty module"""
    # Clean up old audio files to prevent clutter
    old_files = glob.glob('number_audio_*.mp3')
    for old_file in old_files:
        try:
            os.remove(old_file)
        except:
            pass
    
    slow = difficulty.speech_rate_by_difficulty(difficulty_level)
    accents = difficulty.use_accents_by_difficulty(difficulty_level)
    audio_content = difficulty.audio_output_by_difficulty(difficulty_level, time_limit)
    
    # Extract the task from the first element and clean it
    task_instruction = audio_content[0] if audio_content else "Count all numbers"
    # Remove trailing punctuation and whitespace for display
    task_instruction_clean = task_instruction.rstrip('. ')
    
    # Generate audio file
    audio_filename = audio_output.create_number_audio(audio_content, slow, accents)
    
    # Calculate correct answer based on task
    correct_answer = calculate_audio_answer(audio_content, task_instruction_clean)
    
    return {
        'instruction': task_instruction_clean,
        'audio_file': audio_filename,
        'correct_answer': correct_answer
    }

def calculate_audio_answer(audio_content, task):
    """Calculate the correct answer for an audio task"""
    numbers = []
    for item in audio_content[1:]:  # Skip the task instruction
        if item.strip().isdigit():
            numbers.append(int(item))
    
    task_lower = task.lower()
    
    if "count all numbers" in task_lower:
        return len(numbers)
    elif "count all even" in task_lower:
        return sum(1 for n in numbers if n % 2 == 0)
    elif "count all odd" in task_lower:
        return sum(1 for n in numbers if n % 2 == 1)
    elif "count all prime" in task_lower:
        return sum(1 for n in numbers if n > 1 and all(n % i != 0 for i in range(2, int(n**0.5) + 1)))
    elif "add all even" in task_lower:
        return sum(n for n in numbers if n % 2 == 0)
    elif "add all odd" in task_lower:
        return sum(n for n in numbers if n % 2 == 1)
    elif "add even" in task_lower and "subtract odd" in task_lower:
        return sum(n for n in numbers if n % 2 == 0) - sum(n for n in numbers if n % 2 == 1)
    elif "add odd" in task_lower and "subtract even" in task_lower:
        return sum(n for n in numbers if n % 2 == 1) - sum(n for n in numbers if n % 2 == 0)
    
    return len(numbers)

@app.route('/')
def index():
    """Serve the main game page"""
    return render_template('game.html')

@app.route('/api/start-challenge', methods=['POST'])
def start_challenge():
    """Start a new challenge round"""
    data = request.json
    difficulty_level = data.get('difficulty', 1)
    time_limit = data.get('time_limit', 45)  # Get time limit from request
    
    # Generate both visual and audio tasks
    visual_task = generate_visual_task(difficulty_level)
    audio_task = generate_audio_task(difficulty_level, time_limit)
    
    game_state['visual_task'] = visual_task
    game_state['audio_task'] = audio_task
    game_state['audio_file'] = audio_task['audio_file']
    
    return jsonify({
        'visual_task': visual_task,
        'audio_task': {
            'instruction': audio_task['instruction'],
            'audio_url': f'/api/audio/{audio_task["audio_file"]}'
        },
        'difficulty': difficulty_level
    })

@app.route('/api/audio/<filename>')
def serve_audio(filename):
    """Serve audio files"""
    audio_path = Path(__file__).parent / filename
    if audio_path.exists():
        return send_file(audio_path, mimetype='audio/mpeg')
    return jsonify({'error': 'Audio file not found'}), 404

@app.route('/api/submit-answer', methods=['POST'])
def submit_answer():
    """Check submitted answers"""
    data = request.json
    visual_answer = data.get('visual_answer')
    audio_answer = data.get('audio_answer')
    
    visual_correct = False
    audio_correct = False
    
    # Check visual answer
    if game_state['visual_task']:
        if game_state['visual_task']['display_type'] == 'clickable':
            correct_set = set(game_state['visual_task']['correct_answer']) if game_state['visual_task']['correct_answer'] else set()
            user_set = set(visual_answer) if visual_answer else set()
            visual_correct = correct_set == user_set
        else:
            visual_correct = visual_answer == game_state['visual_task']['correct_answer']
    
    # Check audio answer
    if game_state['audio_task']:
        audio_correct = audio_answer == game_state['audio_task']['correct_answer']
    
    both_correct = visual_correct and audio_correct
    
    if both_correct:
        game_state['correct_answers'] += 1
    
    return jsonify({
        'visual_correct': visual_correct,
        'audio_correct': audio_correct,
        'both_correct': both_correct,
        'visual_expected': game_state['visual_task']['correct_answer'] if game_state['visual_task'] else None,
        'audio_expected': game_state['audio_task']['correct_answer'] if game_state['audio_task'] else None,
        'total_correct': game_state['correct_answers']
    })

@app.route('/api/next-round', methods=['POST'])
def next_round():
    """Advance to next round"""
    game_state['current_round'] += 1
    return jsonify({'round': game_state['current_round']})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
