import random
import word_generator

'''
Audio difficulty settings for speech synthesis. 
Places where difficulty levels affect audio output settings:
- Speech Rate: Adjusts how fast the text is spoken. (can be adjusted using the 'slow' parameter in gTTS as well as spaces)
- Accent Variation: Introduces different accents based on difficulty level.
- Number choices: The number of numbers/words to be spoken can vary based on difficulty.
- Player tasks: Different tasks can be assigned to players based on difficulty levels, affecting how audio is generated and presented.
                Possible tasks include counting prime numbers, adding odd numbers, subtracting even numbers, etc.

Difficulty can be measured using a constant. We can thus tweak difficulty by changing the constant value.
Levels should be within a range of 1-5
'''


def audio_difficulty_settings(difficulty: int) -> tuple[bool, bool, list[str], str]:
    '''
    Returns the audio settings based on the difficulty level.
    difficulty (int): The difficulty level (1-5).
    Returns: tuple[bool, bool, list[str], str]:
        - slow (bool): Whether the speech should be slow.
        - accents (bool): Whether to use accents.
        - words (list[str]): List of words/numbers to be spoken.
        - task (str): The player task associated with the difficulty level.
    '''
    if difficulty < 1 or difficulty > 5:
        raise ValueError("Difficulty level must be between 1 and 5.")
    

def speech_rate_by_difficulty(difficulty: int) -> bool:
    '''
    Determines the speech rate based on difficulty level.
    difficulty (int): The difficulty level (1-5).
    Returns: bool: True if speech should be slow, False otherwise.
    '''
    # Always use slow speech for better comprehension
    return True
    
def use_accents_by_difficulty(difficulty: int) -> bool:
    '''
    Determines whether to use accents based on difficulty level.
    difficulty (int): The difficulty level (1-5).
    Returns: bool: True if accents should be used, False otherwise.
    '''
    if difficulty < 3:
        return True
    else:
        return False

# Currently, number of words = difficulty * 20
# Number of spaces between words = number of words - (difficulty * 5)
def audio_output_by_difficulty(difficulty: int, time_limit: int = 45) -> list[str]:
    '''
    Determines the audio output file name based on difficulty level.
    difficulty (int): The difficulty level (1-5).
    Returns: str: The name of the output audio file.
    '''
    realistic_prime_numbers = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41]
    easy_tasks = ["Count all numbers", "Count all even numbers", "Count all odd numbers"]
    medium_tasks = ["Count all prime numbers", "Add all even numbers", "Add all odd numbers"]
    hard_tasks = ["Add even numbers and subtract odd numbers", "Add odd numbers and subtract even numbers", "Count even numbers and add prime numbers"]

    if difficulty <= 2:
        task = random.choice(easy_tasks)
    elif difficulty == 3:
        task = random.choice(medium_tasks)
    else:
        task = random.choice(hard_tasks)
    
    output_audio = []

    # Calculate max items based on time limit
    # Assume slow speech: ~2 seconds per word/number, plus task instruction (~3 seconds)
    # Add 5 second safety margin for audio delay
    max_audio_time = time_limit - 5
    max_items = max(3, int((max_audio_time - 3) / 2))  # Minimum 3 items
    
    # Reduce word count significantly - just 2-4 words per difficulty level
    # But never exceed what time allows
    words = word_generator.load_words('easy' if difficulty <= 2 else 'medium' if difficulty == 3 else 'hard')
    num_words = min(2 + difficulty, 6, max_items // 2)  # Half of max items for words
    selected_words = random.sample(words, num_words)
    
    # Significantly reduce number count and use smaller ranges for early levels
    # Level 1-2: 3-4 numbers from 1-10
    # Level 3: 4-5 numbers from 1-20  
    # Level 4+: 5-6 numbers from 1-30
    if difficulty <= 2:
        num_numbers = min(3, max_items - num_words)  # Just 3 numbers for levels 1-2
        if "even" in task or "odd" in task:
            numbers = [str(num) for num in range(1, 11)]  # Small range 1-10
        else:
            numbers = [str(num) for num in realistic_prime_numbers[:5]]  # Just first 5 primes
    elif difficulty == 3:
        num_numbers = min(4, max_items - num_words)  # 4 numbers for level 3
        if "even" in task or "odd" in task:
            numbers = [str(num) for num in range(1, 21)]  # Range 1-20
        else:
            numbers = [str(num) for num in realistic_prime_numbers[:7]]  # First 7 primes
    else:
        num_numbers = min(5 + (difficulty - 4), 7, max_items - num_words)  # 5-7 numbers for level 4+
        if "even" in task or "odd" in task:
            numbers = [str(num) for num in range(1, 31)]  # Range 1-30
        else:
            numbers = [str(num) for num in realistic_prime_numbers[:10]]  # First 10 primes
    
    # Special limit for "Count all numbers" task - max 5 numbers
    if "Count all numbers" in task:
        num_numbers = min(num_numbers, 5)
    
    num_numbers = max(1, num_numbers)  # At least 1 number
    selected_numbers = random.sample(numbers, min(num_numbers, len(numbers)))
    
    # Build simple audio output: task, then alternating words and numbers with pauses
    output_audio = [task + '. ']
    
    # Add pauses between items for clarity
    all_items = selected_words + selected_numbers
    random.shuffle(all_items)
    
    for item in all_items:
        output_audio.append(item)
        output_audio.append(', ')  # Pause between items
    
    return output_audio


if __name__ == "__main__":
    for level in range(1, 6):
        slow = speech_rate_by_difficulty(level)
        accents = use_accents_by_difficulty(level)
        audio_output = audio_output_by_difficulty(level)
        print(f"Difficulty Level: {level}")
        print(f"  Slow Speech: {slow}")
        print(f"  Use Accents: {accents}")
        print(f"  Audio Output Sample: {audio_output[:10]}...\n")
