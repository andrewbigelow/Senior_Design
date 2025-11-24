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
    if difficulty == 1:
        return True
    else:
        return False
    
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
def audio_output_by_difficulty(difficulty: int) -> list[str]:
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
    
    output_audio = [] * difficulty * 20
    output_audio.append(task)

    words = word_generator.load_words('easy' if difficulty <=2 else 'medium' if difficulty ==3 else 'hard')
    selected_words = random.sample(words, difficulty * 20)
    output_audio.extend(selected_words)
    output_audio = list(set(output_audio))  # Remove duplicates

    spaces_locations = random.sample(range(len(output_audio)), difficulty * 5)
    for index in spaces_locations:
        output_audio.insert(index, ' ')

    interspersed = []
    for i, item in enumerate(output_audio):
        interspersed.append(item)
        if i < len(output_audio) - 1:
            interspersed.append(' ')
    output_audio = interspersed

    if "even" in task or "odd" in task:
        numbers = [str(num) for num in range(1, 101)]
    else:
        filler_numbers = [random.randint(1, 100) for _ in range(difficulty * 10)]
        numbers = [str(num) for num in realistic_prime_numbers + filler_numbers]
        numbers = list(set(numbers))  # Remove duplicates
    selected_numbers = random.sample(numbers, difficulty * 5)
    
    # Insert numbers at random even indices (to avoid replacing spaces)
    for number in selected_numbers:
        insert_index = 1
        while insert_index % 2 != 0:
            insert_index = random.randint(0, len(output_audio))
        output_audio[insert_index] = number

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
