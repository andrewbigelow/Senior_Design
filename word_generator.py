import random
from pathlib import Path

'''
This module loads words from difficulty based files and randomly selects the set of words to be used in the TTS.

use word files:
    - easy_words.txt
    - medium_words.txt
    - hard_words.txt
'''
def load_words(difficulty: str) -> list[str]:
    '''
    Loads words from a file based on the given difficulty level.
    difficulty: The difficulty level ('easy', 'medium', 'hard').
    Returns: list[str]: A list of words loaded from the corresponding file.
    '''
    file_map = {
        'easy': 'easy_words.txt',
        'medium': 'medium_words.txt',
        'hard': 'hard_words.txt'
    }
    
    if difficulty not in file_map:
        raise ValueError("Invalid difficulty level. Choose from 'easy', 'medium', or 'hard'.")
    
    file_path = Path(__file__).parent / file_map[difficulty]
    
    with open(file_path, 'r') as file:
        words = [line.strip() for line in file.readlines()]
    
    return words
  
if __name__ == "__main__":
    print("Testing word loader...\n")

    print("Easy:", load_words("easy")[:10])
    print("Medium:", load_words("medium")[:10])
    print("Hard:", load_words("hard")[:10])
