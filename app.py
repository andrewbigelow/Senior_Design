from flask import Flask, render_template, jsonify, request, send_file
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import random
import os
import glob
import string
from pathlib import Path
from io import BytesIO
from difflib import SequenceMatcher
import audio_output
import difficulty
import word_generator

app = Flask(__name__)
CORS(app)
app.config['SECRET_KEY'] = 'cognitive-overload-secret'
socketio = SocketIO(app, cors_allowed_origins="*")

# ── Party / session management ──────────────────────────────────
parties = {}           # code -> party dict
player_sessions = {}   # socket sid -> {party_code, name, role}


def generate_party_code():
    """Generate a unique 4-character alphanumeric party code"""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
        if code not in parties:
            return code


# Scripted visual tasks for first 5 rounds (no addition tasks)
SCRIPTED_VISUAL_TASKS = {
    1: 'clipart_images',
    2: 'clipart_images',
    3: 'color_count',
    4: 'clipart_images',
    5: 'number_count',
}

# Image aliases for ambiguous interpretations
# Maps image filename (without extension) to list of accepted starting letters
IMAGE_ALIASES = {
    'peanuts': ['p', 'n'],      # peanuts or nut
    'telescope': ['t', 's'],    # telescope or scope
    'squirrel': ['s', 'c'],     # squirrel or chipmunk
    'greenhouse': ['g', 'h'],   # greenhouse or house
    'glasses': ['g', 's'],      # glasses or spectacles
    'balloons': ['b'],           # balloon (singular) also starts with b so fine
    'kangroo': ['k'],            # intentional typo in filename, still k
    'icecream': ['i'],           # no space in filename, still i for ice cream
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

def generate_visual_task(difficulty_level, current_round=None):
    """Generate a visual task - randomly choose between different task types"""
    # Scale items based on difficulty
    base_items = 6
    items_per_level = 2
    num_items = base_items + (difficulty_level * items_per_level)
    
    # Use scripted task type for first 5 rounds if round info provided
    if current_round and current_round in SCRIPTED_VISUAL_TASKS:
        task_type = SCRIPTED_VISUAL_TASKS[current_round]
    else:
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

def generate_audio_task(difficulty_level, time_limit=45, current_round=None):
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
    audio_content = difficulty.audio_output_by_difficulty(
        difficulty_level, time_limit, current_round=current_round
    )
    
    # Extract the task from the first element and clean it
    task_instruction = audio_content[0] if audio_content else "Count all numbers"
    # Remove trailing punctuation and whitespace for display
    task_instruction_clean = task_instruction.rstrip('. ')
    
    # Generate audio file (may fail due to network/gTTS issues)
    try:
        audio_filename = audio_output.create_number_audio(audio_content, slow, accents)
    except Exception as e:
        print(f"[audio] gTTS failed: {e}")
        raise
    
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


@app.route('/api/audio/<filename>')
def serve_audio(filename):
    """Serve an audio file, then delete it to keep things clean"""
    audio_path = Path(__file__).parent / filename
    if audio_path.exists():
        # Read into memory so we can delete the file immediately
        with open(audio_path, 'rb') as f:
            audio_data = BytesIO(f.read())
        try:
            os.remove(audio_path)
            print(f"[cleanup] Deleted audio file: {filename}")
        except Exception as e:
            print(f"[cleanup] Could not delete {filename}: {e}")
        return send_file(audio_data, mimetype='audio/mpeg', download_name=filename)
    return jsonify({'error': 'Audio file not found'}), 404


# ── Fact answer matching ────────────────────────────────────────

_STOP_WORDS = frozenset(
    'i me my he she his her they their them a an the is am are was were '
    'be been being do does did have has had that this it its of in to for '
    'on at by with about as just also very really and or but so if then '
    'than too not no'.split()
)


def _extract_keywords(text):
    """Pull meaningful words out of a sentence, lowercased, stop-words removed."""
    words = text.lower().split()
    # strip punctuation off each word
    cleaned = [''.join(ch for ch in w if ch.isalnum()) for w in words]
    return [w for w in cleaned if w and w not in _STOP_WORDS]


def _check_fact_answer(answer, fact):
    """
    Return True if the player's answer is close enough to the stored fact.

    Uses multiple signals so paraphrases like "king triton" → "he was king
    triton" or "triton" still match:
      1. SequenceMatcher ratio on the full strings
      2. Keyword overlap (Jaccard-style)
      3. Whether all important fact keywords appear somewhere in the answer
      4. Whether the answer is a substring of the fact or vice versa
    """
    if not answer or not fact:
        return False

    a = answer.lower().strip()
    f = fact.lower().strip()

    # 1. Direct SequenceMatcher on full strings
    seq_ratio = SequenceMatcher(None, a, f).ratio()
    if seq_ratio >= 0.50:
        return True

    # 2. Substring containment (either direction)
    if a in f or f in a:
        return True

    # 3. Keyword-based scoring
    a_kw = set(_extract_keywords(answer))
    f_kw = set(_extract_keywords(fact))

    if not f_kw:
        return seq_ratio >= 0.40

    # How many fact keywords did the answer mention?
    overlap = a_kw & f_kw
    recall = len(overlap) / len(f_kw)  # what fraction of fact words were hit?

    # If the answer nails most of the fact's keywords, accept it
    if recall >= 0.50:
        return True

    # 4. Fuzzy per-word matching (catches typos/partial words)
    #    For each fact keyword, check if any answer keyword is close
    fuzzy_hits = 0
    for fword in f_kw:
        for aword in a_kw:
            word_sim = SequenceMatcher(None, aword, fword).ratio()
            if word_sim >= 0.70:
                fuzzy_hits += 1
                break
    fuzzy_recall = fuzzy_hits / len(f_kw)
    if fuzzy_recall >= 0.50:
        return True

    return False


# ── Socket.IO events ───────────────────────────────────────────

@socketio.on('create_party')
def handle_create_party(data):
    name = data.get('name', 'Host').strip() or 'Host'
    fact = data.get('fact', '').strip()
    code = generate_party_code()
    parties[code] = {
        'host_sid': request.sid,
        'players': {request.sid: {'name': name, 'role': 'host', 'fact': fact}},
        'state': 'lobby',
        'round': 0,
        'scores': {request.sid: 0},
        'round_data': None,
        'fact_rounds_done': 0,
    }
    player_sessions[request.sid] = {'party_code': code, 'name': name, 'role': 'host'}
    join_room(code)
    emit('party_created', {'code': code, 'name': name})
    _broadcast_lobby(code)


@socketio.on('join_party')
def handle_join_party(data):
    code = data.get('code', '').strip().upper()
    name = data.get('name', 'Player').strip() or 'Player'
    if code not in parties:
        emit('error', {'message': 'Party not found. Check the code and try again.'})
        return
    party = parties[code]
    if party['state'] != 'lobby':
        emit('error', {'message': 'Game already in progress. Wait for the next session.'})
        return
    fact = data.get('fact', '').strip()
    party['players'][request.sid] = {'name': name, 'role': 'helper', 'fact': fact}
    party['scores'][request.sid] = 0
    player_sessions[request.sid] = {'party_code': code, 'name': name, 'role': 'helper'}
    join_room(code)
    emit('party_joined', {'code': code, 'name': name, 'role': 'helper'})
    _broadcast_lobby(code)


@socketio.on('start_game')
def handle_start_game():
    info = player_sessions.get(request.sid)
    if not info or info['role'] != 'host':
        return
    code = info['party_code']
    party = parties.get(code)
    if not party:
        return
    party['state'] = 'playing'
    party['round'] = 0
    socketio.emit('game_started', {}, room=code)


@socketio.on('request_round')
def handle_request_round(data):
    info = player_sessions.get(request.sid)
    if not info:
        return
    code = info['party_code']
    party = parties.get(code)
    if not party:
        return

    difficulty_level = data.get('difficulty', 1)
    current_round = data.get('round', 1)
    time_limit = data.get('time_limit', 45)

    party['round'] = current_round

    # ── Teammate Fact Quiz Round (round 10, 15, 20, …) ──────────
    num_players = len(party['players'])
    max_fact_rounds = num_players - 1  # 2 players → 1 quiz, 3 → 2, etc.
    is_fact_round = (
        current_round >= 10
        and (current_round - 10) % 5 == 0
        and num_players >= 2
        and party.get('fact_rounds_done', 0) < max_fact_rounds
    )
    if is_fact_round:
        sids_with_facts = [
            sid for sid in party['players']
            if party['players'][sid].get('fact')
        ]
        if len(sids_with_facts) >= 2:
            all_sids = list(party['players'].keys())
            # Simple rotation so nobody gets their own fact
            targets = sids_with_facts[1:] + [sids_with_facts[0]]
            assignments = {}
            for i, sid in enumerate(sids_with_facts):
                assignments[sid] = targets[i]
            # Players without facts still participate
            for sid in all_sids:
                if sid not in assignments:
                    available = [s for s in sids_with_facts if s != sid]
                    assignments[sid] = (
                        random.choice(available) if available
                        else sids_with_facts[0]
                    )
            party['round_data'] = {
                'round_type': 'fact',
                'assignments': assignments,
            }
            party['fact_rounds_done'] = party.get('fact_rounds_done', 0) + 1
            for sid in all_sids:
                target_sid = assignments[sid]
                about = party['players'][target_sid]
                response = {
                    'round_type': 'fact',
                    'round': current_round,
                    'fact_question': {
                        'about_player': about['name'],
                        'question': (
                            f"What fun fact did {about['name']} share "
                            f"about themselves?"
                        ),
                    },
                    'visual_task': None,
                    'audio_task': None,
                    'has_audio': False,
                }
                socketio.emit('round_data', response, room=sid)
            return

    # ── Normal round ────────────────────────────────────────────

    # Generate visual task (use scripted types for early rounds)
    visual_task = generate_visual_task(difficulty_level, current_round=current_round)

    # Audio only after round 3
    has_audio = current_round > 3
    audio_task = None
    if has_audio:
        try:
            audio_task = generate_audio_task(
                difficulty_level, time_limit, current_round=current_round
            )
        except Exception as e:
            print(f"[audio] Generation failed for round {current_round}: {e}")
            has_audio = False

    party['round_data'] = {
        'visual_task': visual_task,
        'audio_task': audio_task,
        'has_audio': has_audio,
    }

    response = {
        'visual_task': visual_task,
        'audio_task': (
            {
                'instruction': audio_task['instruction'],
                'audio_url': f'/api/audio/{audio_task["audio_file"]}',
            }
            if audio_task
            else None
        ),
        'difficulty': difficulty_level,
        'has_audio': has_audio,
        'round': current_round,
    }
    socketio.emit('round_data', response, room=code)


@socketio.on('submit_answer')
def handle_submit_answer(data):
    info = player_sessions.get(request.sid)
    if not info:
        return
    code = info['party_code']
    party = parties.get(code)
    if not party or not party['round_data']:
        return

    visual_answer = data.get('visual_answer')
    audio_answer = data.get('audio_answer')
    rd = party['round_data']

    # ── Fact round answer ───────────────────────────────────────
    if isinstance(rd, dict) and rd.get('round_type') == 'fact':
        fact_answer = data.get('fact_answer', '').strip()
        assignment = rd.get('assignments', {}).get(request.sid)
        if not assignment:
            return
        correct_fact = party['players'].get(assignment, {}).get('fact', '')
        fact_correct = _check_fact_answer(fact_answer, correct_fact)
        if fact_correct:
            party['scores'][request.sid] = (
                party['scores'].get(request.sid, 0) + 1
            )
        result = {
            'round_type': 'fact',
            'both_correct': fact_correct,
            'visual_correct': True,
            'audio_correct': True,
            'fact_expected': correct_fact,
            'player': info['name'],
            'total_correct': party['scores'].get(request.sid, 0),
        }
        socketio.emit('round_result', result, room=request.sid)
        return

    # ── Normal round answer ─────────────────────────────────────
    vt = rd['visual_task']
    at = rd['audio_task']

    visual_correct = False
    audio_correct = False

    # Check visual answer
    if vt:
        if vt['display_type'] == 'clickable':
            correct_set = set(vt['correct_answer']) if vt['correct_answer'] else set()
            ambiguous_set = set(vt.get('ambiguous_answer', []))
            user_set = set(visual_answer) if visual_answer else set()
            user_set_filtered = user_set - ambiguous_set
            visual_correct = correct_set == user_set_filtered
        else:
            visual_correct = visual_answer == vt['correct_answer']

    # Check audio answer
    if at:
        audio_correct = audio_answer == at['correct_answer']
        audio_expected = at['correct_answer']
    else:
        audio_correct = True
        audio_expected = 'N/A'

    both_correct = visual_correct and audio_correct
    if both_correct:
        party['scores'][request.sid] = party['scores'].get(request.sid, 0) + 1

    result = {
        'visual_correct': visual_correct,
        'audio_correct': audio_correct,
        'both_correct': both_correct,
        'visual_expected': vt['correct_answer'] if vt else None,
        'audio_expected': audio_expected,
        'player': info['name'],
        'total_correct': party['scores'].get(request.sid, 0),
    }
    socketio.emit('round_result', result, room=code)


@socketio.on('request_help')
def handle_request_help(data):
    """Host asks a specific helper for help"""
    info = player_sessions.get(request.sid)
    if not info:
        return
    code = info['party_code']
    helper_name = data.get('helper_name', '')
    socketio.emit(
        'help_requested',
        {'from': info['name'], 'helper_name': helper_name},
        room=code,
    )


@socketio.on('player_start_game')
def handle_player_start_game():
    """Any player clicks Start Game on instruction page — broadcast to all"""
    info = player_sessions.get(request.sid)
    if not info:
        return
    code = info['party_code']
    socketio.emit('sync_start_game', {}, room=code)


@socketio.on('sync_input')
def handle_sync_input(data):
    """Broadcast input changes to all other players in the party"""
    info = player_sessions.get(request.sid)
    if not info:
        return
    code = info['party_code']
    # Broadcast to everyone except the sender
    socketio.emit('sync_input_update', data, room=code, include_self=False)


@socketio.on('next_round')
def handle_next_round(data):
    """Host or any player triggers next/retry — broadcast to all"""
    info = player_sessions.get(request.sid)
    if not info:
        return
    code = info['party_code']
    advance = data.get('advance', False)
    socketio.emit('sync_next_round', {'advance': advance}, room=code)


@socketio.on('disconnect')
def handle_disconnect():
    info = player_sessions.pop(request.sid, None)
    if not info:
        return
    code = info['party_code']
    party = parties.get(code)
    if not party:
        return
    party['players'].pop(request.sid, None)
    party['scores'].pop(request.sid, None)
    leave_room(code)

    if not party['players']:
        # Last player left – delete the party
        del parties[code]
    else:
        # If the host left, promote someone else
        if info['role'] == 'host':
            new_host_sid = next(iter(party['players']))
            party['players'][new_host_sid]['role'] = 'host'
            party['host_sid'] = new_host_sid
            player_sessions[new_host_sid]['role'] = 'host'
            socketio.emit('role_changed', {'role': 'host'}, room=new_host_sid)
        _broadcast_lobby(code)


def _broadcast_lobby(code):
    party = parties.get(code)
    if not party:
        return
    players_list = [
        {'name': p['name'], 'role': p['role'], 'fact': p.get('fact', '')}
        for p in party['players'].values()
    ]
    socketio.emit('lobby_update', {'players': players_list, 'code': code}, room=code)


if __name__ == "__main__":
    # Clean up any leftover audio files on startup
    for f in glob.glob('number_audio_*.mp3'):
        try:
            os.remove(f)
        except:
            pass
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
