from gtts import gTTS
import random
import time

'''
Credit to https://pypi.org/project/gTTS/

This module provides functionality to convert text to speech
and save it as an audio file using the gTTS library.

Possible Tweaks:
I will use a constant based on level difficulty to adjust the speech rate and total number of numbers.
This can be tweaked later based on difficulty levels.

I plan to use this function in the main file. Based on the level selected, the game will call this function once
to generate the audio file for the numbers to be spoken. Those number will then be played in the game and stored locally 
for checking user input.

The list input should consist of both numbers and words to be spoken. The words can be randomly generated
by having a words file with words of varying difficulty levels, then randomly selecting words from that file based on the level.
'''


def create_number_audio(text: list[str], slow: bool, accents: bool) -> str:
    '''
    Converts the given text to speech and saves it as an audio file.
    text (list[str]): The text to be converted to speech. Should contain both numbers and words.
    Returns: str: The name of the output audio file.
    '''
    # Use timestamp to prevent caching issues
    timestamp = int(time.time() * 1000)
    output_filename = f"number_audio_{timestamp}.mp3"
    speech_output = ' '.join(text)
    possible_accents = ['com', 'co.uk', 'ca', 'com.au', 'ie', 'co.in', 'co.za', 'com.ng']
    if accents:
        tld = random.choice(possible_accents)
    else:
        tld = 'com'

    tts = gTTS(text=speech_output, lang='en', slow=slow, tld=tld)
    tts.save(output_filename)

    return output_filename

if __name__ == "__main__":
    sample_text = ["one", "two", "three", "apple", "banana"]
    create_number_audio(sample_text)