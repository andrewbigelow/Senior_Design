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

# Image aliases for ambiguous interpretations
# Maps image filename (without extension) to list of accepted starting letters
IMAGE_ALIASES = {
    'peanuts': ['p', 'n'],  # Can be "peanuts" or "nut"
    'telescope': ['t', 's'],  # Can be "telescope" or "scope"
    'squirrel': ['s', 'c'],  # Can be "squirrel" or "chipmunk"
}

# Visual task templates - weighted to favor clipart images (2.5:1:1:1 ratio)
# More clipart entries = higher probability of image tasks
VISUAL_TASK_TYPES = ['clipart_images', 'clipart_images', 'clipart_images', 'clipart_images', 'clipart_images', 
                     'color_count', 'color_count', 'number_count', 'number_count', 'number_sum', 'number_sum']

def generate_clipart_task(difficulty_level, num_items):
    """Generate a clipart-based image selection task"""
    # Scan the static/images directory for available images
    image_files = [f for f in os.listdir('static/images') if f.endswith(('.png', '.jpg', '.jpeg', '.svg'))]
    
    # If no images are found, return None
    if not image_files:
        return None

    # Get item names from filenames
    items = [Path(f).stem for f in image_files]
    
    # Try to find a letter that has at least one matching image
    max_attempts = 20
    letter = None
    selected_items = []
    correct_items = []
    ambiguous_items = []  # Items that can be clicked or not without penalty
    
    for attempt in range(max_attempts):
        test_letter = random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        test_selected = random.sample(items, min(num_items, len(items)))
        
        # Check which items match this letter
        test_correct = []
        test_ambiguous = []
        for item in test_selected:
            item_lower = item.lower()
            # Check if item starts with the letter (primary match)
            if item_lower.startswith(test_letter.lower()):
                test_correct.append(item)
            # Check aliases - these are ambiguous/optional
            elif item_lower in IMAGE_ALIASES:
                if test_letter.lower() in [alias.lower() for alias in IMAGE_ALIASES[item_lower]]:
                    test_ambiguous.append(item)
        
        # Accept if we have at least one correct item and not too many
        if 1 <= len(test_correct) <= len(test_selected) - 1:
            letter = test_letter
            selected_items = test_selected
            correct_items = test_correct
            ambiguous_items = test_ambiguous
            break
    
    # Fallback: if no good letter found, just pick the first letter of a random item
    if letter is None:
        selected_items = random.sample(items, min(num_items, len(items)))
        letter = selected_items[0][0].upper()
        correct_items = [item for item in selected_items if item.upper().startswith(letter)]
        ambiguous_items = []
    
    # Map item names back to full filenames for the frontend
    selected_filenames = [f for f in image_files if Path(f).stem in selected_items]
    correct_filenames = [f for f in image_files if Path(f).stem in correct_items]
    ambiguous_filenames = [f for f in image_files if Path(f).stem in ambiguous_items]

    return {
        'type': 'clipart_images',
        'instruction': f'Click on all images that start with the letter {letter}',
        'items': selected_filenames,
        'correct_answer': correct_filenames,
        'ambiguous_answer': ambiguous_filenames,
        'display_type': 'clickable',
        'letter': letter
    }

def generate_visual_task(difficulty_level):
    """Generate a visual task - randomly choose between different task types"""
    # Scale items based on difficulty
    base_items = 6
    items_per_level = 2
    num_items = base_items + (difficulty_level * items_per_level)
    
    # Choose a random task type
    task_type = random.choice(VISUAL_TASK_TYPES)
    
    if task_type == 'clipart_images':
        task = generate_clipart_task(difficulty_level, num_items)
        if task:
            return task
        # Fallback to another type if clipart fails
        task_type = 'number_count'
    
    if task_type == 'color_count':
        colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink']
        color = random.choice(colors)
        
        items = []
        # Ensure at least 1 correct answer by placing the target color first
        items.append({'id': 0, 'color': color, 'type': 'colored_box'})
        correct_count = 1
        
        for i in range(1, num_items):
            item_color = random.choice(colors)
            items.append({'id': i, 'color': item_color, 'type': 'colored_box'})
            if item_color == color:
                correct_count += 1
        
        # Shuffle to randomize position
        random.shuffle(items)
        # Re-assign IDs after shuffle
        for i, item in enumerate(items):
            item['id'] = i
        
        return {
            'type': 'color_count',
            'instruction': f'Count all {color} colored items',
            'items': items,
            'correct_answer': correct_count,
            'display_type': 'count'
        }
    
    elif task_type == 'number_count':
        num_type = random.choice(['odd', 'even'])
        
        # Ensure at least 1 correct answer
        if num_type == 'odd':
            numbers = [random.choice([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29])]  # Start with an odd
        else:
            numbers = [random.choice([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30])]  # Start with an even
        
        # Add remaining random numbers
        remaining = random.sample(range(1, 50), min(num_items - 1, 48))
        numbers.extend(remaining)
        
        # Count correct answers
        correct_count = 0
        for num in numbers:
            if num_type == 'odd' and num % 2 == 1:
                correct_count += 1
            elif num_type == 'even' and num % 2 == 0:
                correct_count += 1
        
        # Shuffle to randomize position
        random.shuffle(numbers)
        items = [{'id': i, 'value': num, 'type': 'number'} for i, num in enumerate(numbers)]
        
        return {
            'type': 'number_count',
            'instruction': f'Count all {num_type} numbers',
            'items': items,
            'correct_answer': correct_count,
            'display_type': 'count'
        }
    
    elif task_type == 'number_sum':
        operation = random.choice(['add_even', 'add_odd', 'add_all'])
        numbers = random.sample(range(1, 30), min(num_items, 29))
        
        if operation == 'add_even':
            correct_answer = sum(n for n in numbers if n % 2 == 0)
            instruction = 'Add all EVEN numbers'
        elif operation == 'add_odd':
            correct_answer = sum(n for n in numbers if n % 2 == 1)
            instruction = 'Add all ODD numbers'
        else:
            correct_answer = sum(numbers)
            instruction = 'Add ALL numbers'
        
        items = [{'id': i, 'value': num, 'type': 'number'} for i, num in enumerate(numbers)]
        
        return {
            'type': 'number_sum',
            'instruction': instruction,
            'items': items,
            'correct_answer': correct_answer,
            'display_type': 'count'
        }
    
    # Fallback
    return generate_clipart_task(difficulty_level, num_items)

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
    current_round = data.get('round', 1)
    time_limit = data.get('time_limit', 45)  # Get time limit from request
    
    # Generate visual task (always clipart-based)
    visual_task = generate_visual_task(difficulty_level)
    game_state['visual_task'] = visual_task
    
    # Only include audio task after level 3
    if current_round > 3:
        audio_task = generate_audio_task(difficulty_level, time_limit)
        game_state['audio_task'] = audio_task
        game_state['audio_file'] = audio_task['audio_file']
        
        return jsonify({
            'visual_task': visual_task,
            'audio_task': {
                'instruction': audio_task['instruction'],
                'audio_url': f'/api/audio/{audio_task["audio_file"]}'
            },
            'difficulty': difficulty_level,
            'has_audio': True
        })
    else:
        # Levels 1-3: No audio task
        game_state['audio_task'] = None
        game_state['audio_file'] = None
        
        return jsonify({
            'visual_task': visual_task,
            'audio_task': None,
            'difficulty': difficulty_level,
            'has_audio': False
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
            ambiguous_set = set(game_state['visual_task'].get('ambiguous_answer', []))
            user_set = set(visual_answer) if visual_answer else set()
            
            # Remove ambiguous items from comparison - they're optional
            user_set_filtered = user_set - ambiguous_set
            
            # Check if user selected all required items and no incorrect items
            visual_correct = correct_set == user_set_filtered
        else:
            visual_correct = visual_answer == game_state['visual_task']['correct_answer']
    
    # Check audio answer (only if audio task exists)
    if game_state['audio_task']:
        audio_correct = audio_answer == game_state['audio_task']['correct_answer']
        audio_expected = game_state['audio_task']['correct_answer']
    else:
        # No audio task = automatically correct
        audio_correct = True
        audio_expected = 'N/A'  # Not applicable for levels 1-3
    
    both_correct = visual_correct and audio_correct
    
    if both_correct:
        game_state['correct_answers'] += 1
    
    return jsonify({
        'visual_correct': visual_correct,
        'audio_correct': audio_correct,
        'both_correct': both_correct,
        'visual_expected': game_state['visual_task']['correct_answer'] if game_state['visual_task'] else None,
        'audio_expected': audio_expected,
        'total_correct': game_state['correct_answers']
    })

@app.route('/api/next-round', methods=['POST'])
def next_round():
    """Advance to next round"""
    game_state['current_round'] += 1
    return jsonify({'round': game_state['current_round']})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
