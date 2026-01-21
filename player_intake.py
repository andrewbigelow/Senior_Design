import time

players = []  # list to store player info
NUM_PLAYERS = 4  # number of players
PLAYER_TIME = 60  # 1 minute per player in seconds
REVIEW_TIME = 120  # 2 minutes to review table

print("Welcome! Each player has 1 minute to enter their information.\n")

for i in range(NUM_PLAYERS):
    print(f"Player {i+1} of {NUM_PLAYERS}")
    start_time = time.time()
    
    # Get name
    name = ""
    while not name:
        remaining = PLAYER_TIME - (time.time() - start_time)
        if remaining <= 0:
            print("\nTime's up! Moving to next player.")
            break
        print(f"Time remaining: {int(remaining)} seconds")
        name_input = input("Enter your first name: ").strip()
        if name_input:
            name = name_input

    # Get fun fact
    fact = ""
    while not fact and name:  # only ask fact if name was entered
        remaining = PLAYER_TIME - (time.time() - start_time)
        if remaining <= 0:
            print("\nTime's up! Moving to next player.")
            break
        print(f"Time remaining: {int(remaining)} seconds")
        fact_input = input("Enter a fun fact (5–10 words): ").strip()
        word_count = len(fact_input.split())
        if 5 <= word_count <= 10:
            fact = fact_input
        else:
            print("Fun fact must be 5–10 words.")

    players.append({
        "name": name if name else "N/A",
        "fact": fact if fact else "N/A"
    })
    print()  # blank line for spacing

# All players done
print("All players entered! You have 2 minutes to review the table.\n")

review_start = time.time()
while time.time() - review_start < REVIEW_TIME:
    print("Players and their fun facts:")
    for idx, p in enumerate(players, start=1):
        print(f"{idx}. {p['name']}: {p['fact']}")
    print("\nReviewing... Press Ctrl+C to exit early.")
    time.sleep(10)  # refresh every 10 seconds

print("Review time is over. Proceeding to the game!")
