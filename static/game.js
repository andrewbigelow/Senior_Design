/* ===================================================================
   Cognitive Overload Challenge – Multiplayer Client
   Uses Socket.IO for real-time party sync.
   =================================================================== */

// ── Socket connection ──────────────────────────────────────────
const socket = io();

// ── Game state ─────────────────────────────────────────────────
let myRole = null;           // 'host' | 'helper'
let myName = '';
let partyCode = '';
let partyPlayers = [];

let currentRound = 1;
let correctAnswers = 0;
let timeLeft = 30;
let gameActive = false;
let timerInterval;
let currentVisualTask = null;
let currentAudioTask = null;
let selectedItems = [];
let audioElement = null;
let lastRoundSuccess = false;

// Team / voice
let teamMembers = [];
let recognition = null;
let isListening = false;
let voiceAnswerMode = false;
let voiceAnswerText = '';
let playerCount = 2;          // legacy team setup support
let helpEnabled = false;      // helper input enable flag
let isSolo = false;           // single player mode
let currentRoundType = 'normal'; // 'normal' | 'fact'
let permissionedPlayers = new Set();  // names of players who currently have access

// ── Levenshtein distance for fuzzy name matching ───────────────
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

// Phonetic code to handle pronunciation discrepancies
function phoneticCode(str) {
    str = str.toLowerCase().trim();
    if (!str) return '';
    let s = str
        .replace(/^[^a-z]+|[^a-z]+$/g, '')
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/sh/g, 'S')
        .replace(/ch/g, 'C')
        .replace(/th/g, 'T')
        .replace(/gh/g, '')
        .replace(/kn/g, 'n')
        .replace(/wr/g, 'r')
        .replace(/wh/g, 'w')
        .replace(/gn/g, 'n')
        .replace(/mb$/g, 'm')
        .replace(/ce/g, 'se')
        .replace(/ci/g, 'si')
        .replace(/cy/g, 'sy')
        .replace(/ge/g, 'je')
        .replace(/gi/g, 'ji')
        .replace(/x/g, 'ks')
        .replace(/qu/g, 'kw')
        .replace(/[aeiou]/g, 'a')  // collapse vowels
        .replace(/aa+/g, 'a')
        .replace(/([^a])\1+/g, '$1');  // collapse repeated consonants
    return s;
}

// Strip common suffixes/possessives that speech-to-text adds
function stripSuffix(word) {
    return word
        .replace(/'s$/, '')
        .replace(/s$/, '')
        .replace(/ing$/, '')
        .replace(/ed$/, '');
}

function nameSimilarity(spoken, actualName) {
    spoken = spoken.toLowerCase().trim();
    actualName = actualName.toLowerCase().trim();
    if (spoken === actualName) return 1.0;
    if (spoken.includes(actualName) || actualName.includes(spoken)) return 0.95;

    // Also try with suffix stripping (speech API often adds "'s", "s", etc.)
    const spokenStripped = stripSuffix(spoken);
    const nameStripped = stripSuffix(actualName);
    if (spokenStripped === nameStripped) return 0.97;
    if (spokenStripped.includes(nameStripped) || nameStripped.includes(spokenStripped)) return 0.93;

    // Phonetic match — handles pronunciation discrepancies like Sean/Shawn, Sara/Sarah
    const spokenPhonetic = phoneticCode(spoken);
    const namePhonetic = phoneticCode(actualName);
    if (spokenPhonetic && namePhonetic && spokenPhonetic === namePhonetic) return 0.92;

    // Try matching individual words in the spoken phrase
    const words = spoken.split(/\s+/);
    let bestWordScore = 0;

    const checkWord = (w) => {
        if (w.length < 2) return;  // only skip single chars
        // Try raw and suffix-stripped versions
        for (const candidate of [w, stripSuffix(w)]) {
            if (!candidate) continue;
            // Direct Levenshtein
            const dist = levenshtein(candidate, actualName);
            const maxLen = Math.max(candidate.length, actualName.length);
            const score = maxLen > 0 ? 1 - dist / maxLen : 0;
            if (score > bestWordScore) bestWordScore = score;

            // Also check against stripped name
            if (nameStripped !== actualName) {
                const dist2 = levenshtein(candidate, nameStripped);
                const maxLen2 = Math.max(candidate.length, nameStripped.length);
                const score2 = maxLen2 > 0 ? 1 - dist2 / maxLen2 : 0;
                if (score2 > bestWordScore) bestWordScore = score2;
            }

            // Phonetic comparison per word
            const wPhonetic = phoneticCode(candidate);
            if (wPhonetic && namePhonetic && wPhonetic === namePhonetic) {
                bestWordScore = Math.max(bestWordScore, 0.90);
            }
            // Partial phonetic: Levenshtein on phonetic codes
            if (wPhonetic && namePhonetic) {
                const pDist = levenshtein(wPhonetic, namePhonetic);
                const pMax = Math.max(wPhonetic.length, namePhonetic.length);
                const pScore = pMax > 0 ? 1 - pDist / pMax : 0;
                if (pScore > 0.65) bestWordScore = Math.max(bestWordScore, pScore * 0.88);
            }
        }
    };

    // Check individual words
    for (const w of words) {
        checkWord(w);
    }

    // Try joining adjacent words — speech API often splits names
    // e.g. "and drew" → "andrew", "serve a" → "sarah"
    for (let i = 0; i < words.length - 1; i++) {
        checkWord(words[i] + words[i + 1]);           // no space: "and"+"drew" → "andrew"
        checkWord(words[i] + ' ' + words[i + 1]);     // with space for multi-word names
    }
    // Try 3-word joins for longer names
    for (let i = 0; i < words.length - 2; i++) {
        checkWord(words[i] + words[i + 1] + words[i + 2]);
    }

    if (bestWordScore >= 0.55) return bestWordScore;

    // Prefix match (first 3-4 chars) — only if name is 4+ chars
    const minLen = Math.min(spoken.length, actualName.length);
    if (minLen >= 4) {
        const p = Math.min(4, minLen);
        if (spoken.substring(0, p) === actualName.substring(0, p)) return 0.8;
    }
    // Also check prefix on individual words
    for (const w of words) {
        if (w.length >= 3 && actualName.length >= 3) {
            const p = Math.min(3, w.length, actualName.length);
            if (w.substring(0, p) === actualName.substring(0, p)) return 0.7;
        }
    }

    return 0;
}

// ── Party UI helpers ───────────────────────────────────────────

function showScreen(id) {
    ['welcomeOverlay', 'partyOverlay', 'lobbyOverlay', 'startOverlay'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(id);
    if (target) target.style.display = 'flex';
}

// Welcome → Party screen
window.goToParty = function () {
    isSolo = false;
    showScreen('partyOverlay');
};

window.goToSinglePlayer = function () {
    document.getElementById('soloSetup').style.display = 'block';
    document.getElementById('welcomeButtons').style.opacity = '0.4';
    document.getElementById('welcomeButtons').style.pointerEvents = 'none';
};

window.startSoloGame = function () {
    const name = document.getElementById('soloNameInput').value.trim();
    if (!name) { alert('Enter your name!'); return; }
    myName = name;
    isSolo = true;
    myRole = 'host';
    socket.emit('create_party', {name, solo: true});
};

window.createParty = function () {
    const name = document.getElementById('hostNameInput').value.trim();
    const fact = document.getElementById('hostFactInput').value.trim();
    if (!name) { alert('Enter your name first!'); return; }
    myName = name;
    socket.emit('create_party', {name, fact});
};

window.joinParty = function () {
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    const name = document.getElementById('joinNameInput').value.trim();
    const fact = document.getElementById('joinFactInput').value.trim();
    if (!code || !name) { alert('Enter both a code and your name!'); return; }
    myName = name;
    socket.emit('join_party', {code, name, fact});
};

window.hostStartGame = function () {
    socket.emit('start_game');
};

window.transferHost = function (playerName) {
    if (myRole !== 'host') return;
    socket.emit('transfer_host', {new_host_name: playerName});
};

window.returnToLobby = function () {
    if (myRole !== 'host') return;
    if (!confirm('Return everyone to the lobby? Progress will be reset.')) return;
    socket.emit('return_to_lobby');
};

// ── Socket.IO listeners ───────────────────────────────────────

socket.on('party_created', data => {
    partyCode = data.code;
    myRole = 'host';
    if (isSolo) {
        // Solo: skip lobby, go straight to instructions
        teamMembers = [{name: myName, fact: ''}];
        currentRound = 1;
        correctAnswers = 0;
        showScreen('startOverlay');
        setupInstructionPage4();
        return;
    }
    showScreen('lobbyOverlay');
    document.getElementById('lobbyCode').textContent = partyCode;
    document.getElementById('lobbyRole').textContent = 'Host';
    document.getElementById('startGameBtn').style.display = 'inline-block';
});

socket.on('party_joined', data => {
    partyCode = data.code;
    myRole = data.role;
    showScreen('lobbyOverlay');
    document.getElementById('lobbyCode').textContent = partyCode;
    document.getElementById('lobbyRole').textContent = myRole === 'host' ? 'Host' : 'Helper';
    document.getElementById('startGameBtn').style.display = myRole === 'host' ? 'inline-block' : 'none';
});

socket.on('lobby_update', data => {
    partyPlayers = data.players;
    // Update own role FIRST so the render uses the correct role
    const me = partyPlayers.find(p => p.name === myName);
    if (me) {
        myRole = me.role;
        document.getElementById('lobbyRole').textContent = myRole === 'host' ? 'Host' : 'Helper';
        document.getElementById('startGameBtn').style.display = myRole === 'host' ? 'inline-block' : 'none';
        // Update the fact input field with current fact
        const factInput = document.getElementById('lobbyFactInput');
        if (factInput) {
            factInput.value = me.fact || '';
        }
    }
    const list = document.getElementById('lobbyPlayerList');
    if (!list) return;
    list.innerHTML = partyPlayers.map(p => {
        // Show "Make Host" button for the current host, on non-host players
        const canTransfer = myRole === 'host' && p.role !== 'host';
        const transferBtn = canTransfer
            ? `<button onclick="transferHost('${p.name.replace(/'/g, "\\'")}')" style="float:right;padding:4px 10px;background:#ff9800;color:white;border:none;border-radius:4px;font-size:11px;cursor:pointer;">Make Host</button>`
            : '';
        return `<div style="margin:4px 0;padding:8px 12px;background:${p.role==='host'?'#e3f2fd':'#f5f5f5'};border-radius:6px;">
            ${transferBtn}
            <strong>${p.name}</strong> <span style="color:#888;font-size:13px;">(${p.role})</span>
            ${p.fact ? `<div style="font-size:12px;color:#666;margin-top:4px;">💡 ${p.fact}</div>` : ''}
        </div>`;
    }).join('');
    // Build teamMembers from party (include facts)
    teamMembers = partyPlayers.map(p => ({name: p.name, fact: p.fact || ''}));
});

socket.on('game_started', () => {
    // All players see the instruction pages together
    currentRound = 1;
    correctAnswers = 0;
    showScreen('startOverlay');
    setupInstructionPage4();
});

socket.on('returned_to_lobby', data => {
    // Stop any active game state
    gameActive = false;
    clearInterval(timerInterval);
    stopVoiceListening();
    if (audioElement) audioElement.pause();
    // Reset game progress
    currentRound = 1;
    correctAnswers = 0;
    helpEnabled = false;
    permissionedPlayers = new Set();
    // Reset instruction pages for next game
    instructionPage = 1;
    document.querySelectorAll('.instructionPage').forEach((el, i) => {
        el.style.display = i === 0 ? 'block' : 'none';
    });
    // Hide the home button
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) homeBtn.style.display = 'none';
    // Update role in case host changed
    if (data.your_role) {
        myRole = data.your_role;
    }
    // Show the lobby
    showScreen('lobbyOverlay');
    document.getElementById('lobbyCode').textContent = partyCode;
    document.getElementById('lobbyRole').textContent = myRole === 'host' ? 'Host' : 'Helper';
    document.getElementById('startGameBtn').style.display = myRole === 'host' ? 'inline-block' : 'none';
    showNotification('Returned to lobby — progress reset', '#2196F3');
});

function setupInstructionPage4() {
    const factsDiv = document.getElementById('teammateFactsDisplay');
    const teamList = document.getElementById('teamList');
    const page4Content = document.querySelector('.instructionPage[data-page="4"]');
    if (!page4Content) return;

    if (isSolo) {
        // Solo mode: hide team communication bullet
        const teamBullet = document.getElementById('teamCommBullet');
        if (teamBullet) teamBullet.style.display = 'none';
        // Solo mode: modify page 4 content
        page4Content.innerHTML = `
            <div style="text-align:left;margin:20px 0;padding:18px;background:#e8f5e9;border-radius:8px;border:2px solid #66bb6a;">
                <h3 style="margin:0 0 12px 0;color:#2e7d32;font-size:18px;">🎯 Solo Mode</h3>
                <p style="font-size:14px;color:#444;margin:0;">
                    You're playing solo — no teammates to memorize this time!<br>
                    Focus on the visual and audio challenges. Good luck!
                </p>
            </div>`;
        return;
    }

    // Multiplayer: show teammate facts
    if (factsDiv) {
        factsDiv.innerHTML = teamMembers.map(m =>
            `<div style="padding:12px;background:#f9f9f9;border-radius:6px;border:1px solid #e0e0e0;">
                <strong>${m.name}</strong>
                ${m.fact
                    ? `<div style="margin-top:6px;font-size:14px;color:#555;font-style:italic;">"${m.fact}"</div>`
                    : '<div style="margin-top:4px;font-size:13px;color:#aaa;">No fact shared</div>'}
            </div>`
        ).join('');
    }
    if (teamList) {
        teamList.innerHTML = teamMembers.map(m =>
            `<div style="margin:5px 0;">• <strong>${m.name}</strong>${m.fact ? ` — "${m.fact}"` : ''}</div>`
        ).join('');
    }
}

socket.on('round_data', data => {
    // Reset UI for all players (helpers didn't call startRound directly)
    resetRoundUI();

    // Handle fact quiz rounds
    if (data.round_type === 'fact') {
        currentRoundType = 'fact';
        showFactRound(data);
        return;
    }
    currentRoundType = 'normal';

    currentVisualTask = data.visual_task;
    currentAudioTask = data.audio_task;
    const hasAudio = data.has_audio;

    // Update visual instruction
    let visualInstruction = 'VISUAL: ' + currentVisualTask.instruction;
    document.getElementById('taskInstruction').textContent = visualInstruction;

    // Audio instruction
    const existingAudioInst = document.getElementById('audioInstruction');
    if (existingAudioInst) existingAudioInst.remove();

    if (hasAudio && currentAudioTask) {
        const ai = document.createElement('div');
        ai.className = 'task-instruction';
        ai.id = 'audioInstruction';
        ai.style.background = 'rgba(33,150,243,0.2)';
        ai.style.color = '#2196F3';
        ai.textContent = 'AUDIO: ' + currentAudioTask.instruction;
        document.getElementById('challengeArea').insertBefore(ai, document.getElementById('contentGrid'));
        document.getElementById('audioAnswerInput').parentElement.style.display = 'block';
    } else {
        document.getElementById('audioAnswerInput').parentElement.style.display = 'none';
    }

    generateContent(currentVisualTask);
    startTimer();

    // Play audio after a delay
    if (hasAudio && currentAudioTask) {
        const delay = 5000 + Math.random() * 3000;
        setTimeout(() => {
            if (gameActive) playAudio(currentAudioTask.audio_url);
        }, delay);
    }

    // Submit button text
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.textContent = (hasAudio && currentAudioTask) ? 'Submit Both Answers' : 'Submit Task';

    // Enable/disable input based on role
    updateInputAccess();
});

socket.on('round_result', data => {
    if (data.both_correct) {
        correctAnswers = data.total_correct;
        document.getElementById('correctCount').textContent = correctAnswers;
    }
    endRound(data);
});

socket.on('help_requested', data => {
    const helperName = data.helper_name;
    const fromName = data.from;

    // If I'm the one being called, enable me BEFORE the dedup check
    // (my own name is in permissionedPlayers from resetRoundUI, so checking
    //  the set first would incorrectly block my own enablement)
    if (!helpEnabled && myRole !== 'host') {
        const similarity = nameSimilarity(helperName, myName);
        if (similarity >= 0.65) {
            helpEnabled = true;
            permissionedPlayers.add(helperName.toLowerCase());
            updateInputAccess();
            showNotification(`${fromName} asked for your help!`, '#FF9800');
            return;
        }
    }

    // Skip if the target already has permission (avoid duplicate prompts)
    if (permissionedPlayers.has(helperName.toLowerCase())) return;

    // Track who now has permission (so nobody can be prompted twice)
    permissionedPlayers.add(helperName.toLowerCase());
    // Notifications for players who can see the game
    if (myRole === 'host' || helpEnabled) {
        if (fromName !== myName) {
            showNotification(`${fromName} asked ${helperName} for help`, '#4CAF50');
        } else {
            showNotification(`Asked ${helperName} for help`, '#4CAF50');
        }
    }
});

socket.on('role_changed', data => {
    myRole = data.role;
    showNotification('You are now the Host!', '#2196F3');
    updateInputAccess();
    // Show/hide home button based on new role
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn && gameActive) homeBtn.style.display = myRole === 'host' ? 'block' : 'none';
});

socket.on('error', data => {
    alert(data.message);
});

// ── Input access control ──────────────────────────────────────
function updateInputAccess() {
    // Host can always interact; helpers only when helpEnabled
    const canInteract = gameActive && (myRole === 'host' || helpEnabled);
    document.getElementById('submitBtn').disabled = !canInteract;
    document.getElementById('visualAnswerInput').disabled = !canInteract;
    document.getElementById('audioAnswerInput').disabled = !canInteract;

    document.querySelectorAll('.clickable-item').forEach(el => {
        el.style.pointerEvents = canInteract ? 'auto' : 'none';
        el.style.opacity = canInteract ? '1' : '0.6';
    });

    // Show a waiting message for locked helpers
    let lockMsg = document.getElementById('helperLockMsg');
    if (myRole === 'helper' && !helpEnabled && gameActive) {
        if (!lockMsg) {
            lockMsg = document.createElement('div');
            lockMsg.id = 'helperLockMsg';
            lockMsg.style.cssText = 'text-align:center;padding:12px;background:#fff3e0;border:2px solid #ff9800;border-radius:8px;margin:10px 0;font-weight:bold;color:#e65100;';
            document.getElementById('challengeArea').appendChild(lockMsg);
        }
        lockMsg.textContent = '🔒 Waiting for a teammate to call your name for help...';
        lockMsg.style.display = 'block';
    } else if (lockMsg) {
        lockMsg.style.display = 'none';
    }
}

// ── Notification banner ───────────────────────────────────────
function showNotification(msg, color) {
    let banner = document.getElementById('notificationBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'notificationBanner';
        banner.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;color:white;font-weight:bold;font-size:16px;z-index:500;transition:opacity 0.5s;';
        document.body.appendChild(banner);
    }
    banner.textContent = msg;
    banner.style.background = color || '#333';
    banner.style.opacity = '1';
    setTimeout(() => { banner.style.opacity = '0'; }, 3000);
}

// ── Difficulty ─────────────────────────────────────────────────
function getDifficulty(round) {
    const level = Math.min(Math.ceil(round / 2), 5);
    const timeLimit = Math.max(45 - (round * 2), 25);
    const names = ["Beginner", "Easy", "Medium", "Challenging", "Advanced", "Expert"];
    return {name: names[Math.min(Math.floor(round / 2), 5)], level, timeLimit};
}

// ── Round lifecycle ───────────────────────────────────────────

function resetRoundUI() {
    // Clear any existing timer to prevent stacking
    clearInterval(timerInterval);
    gameActive = true;
    selectedItems = [];
    helpEnabled = false;
    currentRoundType = 'normal';
    // Reset permissions each round — only host starts with access
    permissionedPlayers = new Set();
    permissionedPlayers.add(myName.toLowerCase());

    // Reset fact round UI
    const factArea = document.getElementById('factQuestionArea');
    if (factArea) factArea.style.display = 'none';

    // Reset task instruction styling
    const inst = document.getElementById('taskInstruction');
    if (inst) {
        inst.style.background = 'rgba(76,175,80,0.2)';
        inst.style.color = '#4CAF50';
    }

    // Restore visual input visibility
    document.getElementById('visualAnswerInput').parentElement.style.display = 'block';
    document.getElementById('visualAnswerInput').style.display = 'inline-block';

    const diff = getDifficulty(currentRound);
    timeLeft = diff.timeLimit;

    document.getElementById('difficultyLevel').textContent = diff.name;
    document.getElementById('roundNum').textContent = currentRound;
    document.getElementById('feedback').style.display = 'none';
    document.getElementById('nextRoundBtn').style.display = 'none';
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('visualAnswerInput').value = '';
    document.getElementById('audioAnswerInput').value = '';
    document.getElementById('timer').style.color = '#ff4444';

    // Update progress bar
    updateProgressBar();
}

function startRound() {
    resetRoundUI();

    // Only the host requests new round data from the server
    if (myRole === 'host') {
        const diff = getDifficulty(currentRound);
        socket.emit('request_round', {
            difficulty: diff.level,
            time_limit: diff.timeLimit,
            round: currentRound
        });
    }
}

function startGame() {
    // Host broadcasts start to all players
    socket.emit('player_start_game');
}
window.startGame = startGame;

function showFactRound(data) {
    const fq = data.fact_question;

    // Hide regular task areas
    document.getElementById('contentGrid').innerHTML = '';
    document.getElementById('visualAnswerInput').parentElement.style.display = 'none';
    document.getElementById('audioAnswerInput').parentElement.style.display = 'none';

    // Show fact question area
    const factArea = document.getElementById('factQuestionArea');
    if (factArea) {
        factArea.style.display = 'block';
        document.getElementById('factQuestionText').textContent = fq.question;
        document.getElementById('factAnswerInput').value = '';
    }

    // Build multiple choice buttons (only host can answer)
    const choicesArea = document.getElementById('factChoicesArea');
    choicesArea.innerHTML = '';

    if (fq.choices && fq.choices.length > 0) {
        fq.choices.forEach(choice => {
            const btn = document.createElement('button');
            btn.textContent = choice;
            btn.style.cssText = `
                padding: 14px 20px;
                font-size: 16px;
                border: 2px solid #ab47bc;
                border-radius: 8px;
                background: #fff;
                color: #333;
                cursor: ${myRole === 'host' ? 'pointer' : 'default'};
                text-align: left;
                transition: background 0.15s, color 0.15s;
                opacity: ${myRole === 'host' ? '1' : '0.75'};
            `;

            if (myRole === 'host') {
                btn.addEventListener('click', () => {
                    // Deselect all buttons
                    choicesArea.querySelectorAll('button').forEach(b => {
                        b.style.background = '#fff';
                        b.style.color = '#333';
                        b.style.borderColor = '#ab47bc';
                    });
                    // Highlight selected
                    btn.style.background = '#ab47bc';
                    btn.style.color = '#fff';
                    btn.style.borderColor = '#7b1fa2';
                    // Store answer
                    document.getElementById('factAnswerInput').value = choice;
                });
            }

            choicesArea.appendChild(btn);
        });
    }

    // Update task instruction
    const inst = document.getElementById('taskInstruction');
    inst.textContent = '🧠 TEAMMATE QUIZ ROUND';
    inst.style.background = 'rgba(171,71,188,0.2)';
    inst.style.color = '#ab47bc';

    // Only host can submit; helpers see a waiting message
    const submitBtn = document.getElementById('submitBtn');
    if (myRole === 'host') {
        submitBtn.textContent = 'Submit Answer';
        submitBtn.disabled = false;
    } else {
        submitBtn.textContent = '⏳ Host is answering...';
        submitBtn.disabled = true;
    }

    startTimer();

}

function updateProgressBar() {
    const maxRound = 20;
    const progress = Math.min((currentRound / maxRound) * 100, 100);
    const fill = document.getElementById('progressFill');
    if (fill) fill.style.width = progress + '%';
    const roundEl = document.getElementById('progressRound');
    if (roundEl) roundEl.textContent = currentRound;
    const label = document.getElementById('progressLabel');
    if (label) {
        const labels = ['Getting Started','Warming Up','Finding Rhythm','Picking Up Speed','In the Zone','Expert Level'];
        label.textContent = labels[Math.min(Math.floor((currentRound - 1) / 4), labels.length - 1)];
    }
}

// All players receive this and enter the game together
socket.on('sync_start_game', () => {
    const overlay = document.getElementById('startOverlay');
    if (overlay) overlay.style.display = 'none';
    currentRound = 1;
    correctAnswers = 0;
    document.getElementById('correctCount').textContent = '0';
    // Show home button for host only
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) homeBtn.style.display = myRole === 'host' ? 'block' : 'none';
    startVoiceListening();
    startRound();
});

function gatherAnswers() {
    if (currentRoundType === 'fact') {
        const factInput = document.getElementById('factAnswerInput');
        return {fact_answer: factInput ? factInput.value.trim() : ''};
    }
    let visualAnswer;
    if (currentVisualTask.display_type === 'clickable') {
        visualAnswer = selectedItems.length > 0 ? selectedItems : [];
    } else {
        visualAnswer = parseInt(document.getElementById('visualAnswerInput').value) || 0;
    }
    const audioAnswer = currentAudioTask
        ? (parseInt(document.getElementById('audioAnswerInput').value) || 0)
        : null;
    return {visual_answer: visualAnswer, audio_answer: audioAnswer};
}

function submitAnswer() {
    if (!gameActive) return;
    socket.emit('submit_answer', gatherAnswers());
}
window.submitAnswer = submitAnswer;

function autoSubmitOnTimeout() {
    if (!gameActive) return;
    // Submit whatever is currently filled in
    socket.emit('submit_answer', gatherAnswers());
}

function nextRound() {
    // Broadcast to all players in the party so everyone moves together
    socket.emit('next_round', { advance: lastRoundSuccess });
}
window.nextRound = nextRound;

// All players receive this and move in sync
socket.on('sync_next_round', data => {
    if (data.advance) currentRound++;
    if (teamMembers.length > 0) startVoiceListening();
    startRound();
});

// ── Timer ─────────────────────────────────────────────────────

function startTimer() {
    // Always clear old interval first to prevent double-ticking
    clearInterval(timerInterval);
    const el = document.getElementById('timer');
    el.style.color = '#ff4444';
    el.textContent = timeLeft;
    timerInterval = setInterval(() => {
        timeLeft--;
        el.textContent = timeLeft;
        if (timeLeft <= 10) el.style.color = '#ff6600';
        if (timeLeft <= 5) el.style.color = '#ff0000';
        if (timeLeft <= 0) {
            // Auto-submit whatever is in the fields instead of failing
            autoSubmitOnTimeout();
        }
    }, 1000);
}

// ── End round ─────────────────────────────────────────────────

function endRound(result) {
    gameActive = false;
    clearInterval(timerInterval);
    stopVoiceListening();
    if (audioElement) audioElement.pause();
    lastRoundSuccess = result.both_correct;

    const fb = document.getElementById('feedback');
    fb.style.display = 'block';
    fb.innerHTML = '';

    // Fact round results
    if (result.round_type === 'fact') {
        const factArea = document.getElementById('factQuestionArea');
        if (factArea) factArea.style.display = 'none';
        lastRoundSuccess = true; // Fact rounds always advance
        if (result.both_correct) {
            fb.className = 'feedback correct';
            fb.innerHTML = '🎉 Correct! You really know your teammates!';
        } else {
            fb.className = 'feedback incorrect';
            fb.innerHTML = `<strong>Not quite!</strong><br>The answer was: "<em>${result.fact_expected || '...'}</em>"<br><br><em>Try to remember it for next time!</em>`;
        }
        if (result.both_correct) {
            correctAnswers = result.total_correct;
            document.getElementById('correctCount').textContent = correctAnswers;
        }
        document.getElementById('submitBtn').disabled = true;
        const nextBtn = document.getElementById('nextRoundBtn');
        nextBtn.style.display = 'inline-block';
        nextBtn.disabled = false;
        nextBtn.textContent = 'Next Challenge';
        const aiInst = document.getElementById('audioInstruction');
        if (aiInst) aiInst.remove();
        return;
    }

    if (result.both_correct) {
        fb.className = 'feedback correct';
        fb.innerHTML = currentRound <= 3
            ? '🎉 Perfect! Visual task completed correctly!<br>'
            : '🎉 Perfect! Both tasks completed correctly!<br>';
    } else {
        fb.className = 'feedback incorrect';
        fb.innerHTML = currentRound <= 3
            ? '<strong>Try Again!</strong><br>'
            : '<strong>Try Again – You must complete both tasks!</strong><br>';

        if (!result.visual_correct) {
            // Format expected answer nicely
            let expected = result.visual_expected;
            if (Array.isArray(expected)) {
                expected = expected.map(f => {
                    const name = f.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
                    return name.charAt(0).toUpperCase() + name.slice(1);
                }).join(', ');
            }
            fb.innerHTML += `❌ Visual Task: Expected ${expected}<br>`;
        } else {
            fb.innerHTML += '✓ Visual Task: Correct!<br>';
        }

        if (currentAudioTask && !result.audio_correct) {
            fb.innerHTML += `❌ Audio Task: Expected ${result.audio_expected}<br>`;
        } else if (currentAudioTask) {
            fb.innerHTML += '✓ Audio Task: Correct!<br>';
        }
        fb.innerHTML += '<br><em>You will replay this round.</em>';
    }

    document.getElementById('submitBtn').disabled = true;
    const nextBtn = document.getElementById('nextRoundBtn');
    nextBtn.style.display = 'inline-block';
    nextBtn.disabled = false;
    nextBtn.textContent = lastRoundSuccess ? 'Next Challenge' : 'Retry Challenge';

    const aiInst = document.getElementById('audioInstruction');
    if (aiInst) aiInst.remove();
}

// ── Audio playback ────────────────────────────────────────────

function playAudio(url) {
    if (audioElement) audioElement.pause();
    audioElement = new Audio(url);
    audioElement.play().catch(err => {
        console.error('Audio playback failed:', err);
    });
}

// ── Visual content generation ─────────────────────────────────

function generateContent(visualTask) {
    const grid = document.getElementById('contentGrid');
    grid.innerHTML = '';

    if (visualTask.display_type === 'clickable') {
        visualTask.items.forEach((filename) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'item clickable-item';
            itemDiv.dataset.item = filename;
            itemDiv.style.cursor = 'pointer';

            const img = document.createElement('img');
            img.src = '/static/images/' + filename;
            img.alt = filename;
            img.onerror = function () {
                img.style.display = 'none';
                const fb = document.createElement('div');
                fb.textContent = '?';
                fb.style.fontSize = '24px';
                itemDiv.appendChild(fb);
            };
            itemDiv.appendChild(img);

            itemDiv.onclick = function () {
                if (!gameActive) return;
                if (myRole === 'helper' && !helpEnabled) return;
                if (selectedItems.includes(filename)) {
                    selectedItems = selectedItems.filter(i => i !== filename);
                    itemDiv.classList.remove('selected');
                } else {
                    selectedItems.push(filename);
                    itemDiv.classList.add('selected');
                }
                // Sync image selections to all players
                socket.emit('sync_input', {type: 'selection', selectedItems});
            };
            grid.appendChild(itemDiv);
        });
        document.getElementById('visualAnswerInput').style.display = 'none';
        document.getElementById('visualAnswerInput').parentElement.style.display = 'none';
    } else if (visualTask.display_type === 'count') {
        visualTask.items.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'item';
            itemDiv.style.cursor = 'default';
            if (item.type === 'number') {
                itemDiv.textContent = item.value;
                const colors = ['#ff6b6b','#4ecdc4','#45b7d1','#f9ca24','#6c5ce7','#fd79a8','#00b894'];
                itemDiv.style.background = colors[Math.floor(Math.random()*colors.length)];
                itemDiv.style.color = 'white';
            } else if (item.type === 'colored_box') {
                itemDiv.style.background = item.color;
                itemDiv.style.minHeight = '80px';
            } else if (item.type === 'image') {
                const img = document.createElement('img');
                img.src = '/static/images/' + item.filename;
                img.alt = item.filename;
                img.onerror = function () {
                    img.style.display = 'none';
                    const fb = document.createElement('div');
                    fb.textContent = '?';
                    fb.style.fontSize = '24px';
                    itemDiv.appendChild(fb);
                };
                itemDiv.appendChild(img);
            }
            grid.appendChild(itemDiv);
        });
        document.getElementById('visualAnswerInput').style.display = 'inline-block';
        document.getElementById('visualAnswerInput').parentElement.style.display = 'block';
        document.getElementById('visualAnswerInput').focus();
    }

    updateInputAccess();

    // Attach input sync listeners for text fields
    const visualInput = document.getElementById('visualAnswerInput');
    const audioInput = document.getElementById('audioAnswerInput');
    visualInput.oninput = function() {
        socket.emit('sync_input', {type: 'visual', value: visualInput.value});
    };
    audioInput.oninput = function() {
        socket.emit('sync_input', {type: 'audio', value: audioInput.value});
    };
}

// ── Receive synced inputs from other players ──────────────────
let _ignoreSyncInput = false;
socket.on('sync_input_update', data => {
    _ignoreSyncInput = true;
    if (data.type === 'visual') {
        document.getElementById('visualAnswerInput').value = data.value;
    } else if (data.type === 'audio') {
        document.getElementById('audioAnswerInput').value = data.value;
    } else if (data.type === 'selection') {
        // Sync image selections
        selectedItems = data.selectedItems || [];
        document.querySelectorAll('.clickable-item').forEach(el => {
            if (selectedItems.includes(el.dataset.item)) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    }
    _ignoreSyncInput = false;
});

// ── Voice recognition ─────────────────────────────────────────

// Track last help request to debounce duplicate triggers
let _lastHelpName = '';
let _lastHelpTime = 0;

function handleVoiceCommand(transcript, isFinal) {
    if (voiceAnswerMode) {
        voiceAnswerText = transcript;
        document.getElementById('voiceAnswerDisplay').textContent = `You said: "${transcript}"`;
        return;
    }
    if (!gameActive) return;
    // Only players who already have permission can prompt others
    // Host always has permission; helpers only after being prompted this round
    if (myRole !== 'host' && !helpEnabled) return;

    // Strip filler words that speech API may prepend
    const cleaned = transcript.toLowerCase()
        .replace(/^(hey|yo|ok|okay|um|uh|like|so|the|a)\s+/i, '')
        .trim();
    // Use lower threshold for final results (more reliable) vs interim (noisier)
    const threshold = isFinal ? 0.65 : 0.72;
    let bestMatch = null;
    let bestScore = threshold;

    for (const member of teamMembers) {
        const memberLower = member.name.toLowerCase();
        // Skip yourself
        if (memberLower === myName.toLowerCase()) continue;
        // Skip players who already have permission (host always has it)
        if (permissionedPlayers.has(memberLower)) continue;

        // nameSimilarity already handles word splitting, joins, suffix stripping, etc.
        const score = nameSimilarity(cleaned, member.name);
        if (score > bestScore) { bestScore = score; bestMatch = member.name; }
    }

    if (bestMatch) {
        // Debounce: don't fire the same help request within 5 seconds
        const now = Date.now();
        if (bestMatch === _lastHelpName && now - _lastHelpTime < 5000) {
            return;
        }
        _lastHelpName = bestMatch;
        _lastHelpTime = now;
        console.log(`Voice match: "${transcript}" → ${bestMatch} (score: ${bestScore.toFixed(2)})`);
        socket.emit('request_help', {helper_name: bestMatch});
    }
}

function showHelpRequest(playerName, confidence) {
    const pct = Math.round(confidence * 100);
    showNotification(`${playerName} – Help requested! (${pct}% match)`, '#FF9800');
}

function startVoiceListening() {
    if (recognition && !isListening) {
        // Update grammar hints with current team member names
        if (recognition._grammarList && teamMembers.length > 0) {
            try {
                const names = teamMembers.map(m => m.name).join(' | ');
                const grammar = '#JSGF V1.0; grammar names; public <name> = ' + names + ' ;';
                recognition._grammarList = new (window.SpeechGrammarList || window.webkitSpeechGrammarList)();
                recognition._grammarList.addFromString(grammar, 1);
                recognition.grammars = recognition._grammarList;
            } catch (_) {}
        }
        isListening = true;
        try {
            recognition.start();
        } catch (e) { console.error('Voice start error:', e); }
    }
}

function stopVoiceListening() {
    if (recognition && isListening) {
        isListening = false;
        try { recognition.stop(); } catch (e) { /* ignore */ }
    }
}

function startVoiceAnswer() {
    if (!recognition) {
        alert('Speech recognition not supported. Use Chrome, Edge, or Safari.');
        return;
    }
    voiceAnswerMode = true;
    voiceAnswerText = '';
    document.getElementById('voiceAnswerDisplay').textContent = '🎤 Listening...';
    document.getElementById('voiceAnswerBtn').textContent = '🎤 Listening...';
    document.getElementById('voiceAnswerBtn').disabled = true;

    if (isListening) { recognition.stop(); isListening = false; }

    const ar = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    ar.continuous = false;
    ar.interimResults = false;
    ar.lang = 'en-US';
    ar.onresult = function (e) {
        const t = e.results[0][0].transcript;
        voiceAnswerText = t;
        document.getElementById('voiceAnswerDisplay').textContent = `You said: "${t}"`;
        document.getElementById('voiceAnswerBtn').textContent = '🎤 Speak Again';
        document.getElementById('voiceAnswerBtn').disabled = false;
        voiceAnswerMode = false;
        if (gameActive) setTimeout(startVoiceListening, 500);
    };
    ar.onerror = function () {
        document.getElementById('voiceAnswerDisplay').textContent = 'Error – Click to try again';
        document.getElementById('voiceAnswerBtn').textContent = '🎤 Speak Answer';
        document.getElementById('voiceAnswerBtn').disabled = false;
        voiceAnswerMode = false;
    };
    ar.start();
}
window.startVoiceAnswer = startVoiceAnswer;

// Init speech recognition
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;   // process speech in real-time as user talks
    recognition.maxAlternatives = 5;     // more chances to catch the name
    recognition.lang = 'en-US';

    // Add grammar hints to bias recognition toward teammate names
    if (typeof SpeechGrammarList !== 'undefined' || typeof webkitSpeechGrammarList !== 'undefined') {
        try {
            const SGL = window.SpeechGrammarList || window.webkitSpeechGrammarList;
            recognition._grammarList = new SGL();
            // Grammar will be populated when team members are known
        } catch (_) {}
    }

    recognition.onresult = function (e) {
        // Check every result (interim and final) for a teammate name
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const isFinal = e.results[i].isFinal;
            const t = e.results[i][0].transcript.toLowerCase().trim();
            console.log('Voice' + (isFinal ? ' (final)' : ' (interim)') + ':', t);
            handleVoiceCommand(t, isFinal);
            // Also check alternative transcriptions
            for (let alt = 1; alt < e.results[i].length; alt++) {
                const altText = e.results[i][alt].transcript.toLowerCase().trim();
                if (altText !== t) handleVoiceCommand(altText, isFinal);
            }
        }
    };
    recognition.onerror = function (e) {
        console.warn('Voice recognition error:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            console.error('Microphone access denied — voice help unavailable.');
            isListening = false;
            return;
        }
        // Let onend handle the restart — don't double-restart from here
    };
    recognition.onend = function () {
        // Only restart if we're supposed to be listening
        if (!isListening || !gameActive || voiceAnswerMode) return;
        // Exponential backoff: if recognition keeps dying quickly, slow down restarts
        const now = Date.now();
        const timeSinceLastRestart = now - (recognition._lastRestartTime || 0);
        if (timeSinceLastRestart < 1000) {
            // Died too fast — back off longer (2s) to let things settle
            recognition._restartBackoff = Math.min((recognition._restartBackoff || 1000) * 2, 10000);
        } else {
            recognition._restartBackoff = 1000;  // normal 1s delay
        }
        const delay = recognition._restartBackoff;
        console.log(`Voice recognition ended, restarting in ${delay}ms`);
        setTimeout(() => {
            if (isListening && gameActive && !voiceAnswerMode) {
                recognition._lastRestartTime = Date.now();
                try { recognition.start(); } catch (_) {}
            }
        }, delay);
    };
}

// ── Test audio (instruction page) ─────────────────────────────
function playTestAudio() {
    const btn = document.getElementById('testAudioBtn');
    const ans = document.getElementById('testAudioAnswer');
    btn.disabled = true;
    btn.textContent = '🔊 Playing...';
    const u = new SpeechSynthesisUtterance("Count all odd numbers. 3, 8, 7, 12, 14");
    u.rate = 0.9;
    u.onend = function () {
        btn.textContent = '▶ Play Again';
        btn.disabled = false;
        ans.style.display = 'block';
    };
    window.speechSynthesis.speak(u);
}
window.playTestAudio = playTestAudio;

// ── Instruction page navigation ───────────────────────────────
let instructionPage = 1;
function changeInstructionPage(dir) {
    const total = document.querySelectorAll('.instructionPage').length;
    document.querySelector(`.instructionPage[data-page="${instructionPage}"]`).style.display = 'none';
    instructionPage += dir;
    if (instructionPage < 1) instructionPage = 1;
    if (instructionPage > total) instructionPage = total;
    document.querySelector(`.instructionPage[data-page="${instructionPage}"]`).style.display = 'block';

    const prev = document.getElementById('prevBtn');
    prev.disabled = instructionPage === 1;
    prev.style.opacity = instructionPage === 1 ? '0.5' : '1';
    prev.style.cursor = instructionPage === 1 ? 'not-allowed' : 'pointer';
    document.getElementById('nextBtn').style.display = instructionPage === total ? 'none' : 'inline-block';
}
window.changeInstructionPage = changeInstructionPage;

// ── Enter-key submission ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('visualAnswerInput')?.addEventListener('keypress', e => {
        if (e.key === 'Enter' && gameActive) submitAnswer();
    });
    document.getElementById('audioAnswerInput')?.addEventListener('keypress', e => {
        if (e.key === 'Enter' && gameActive) submitAnswer();

    });
    // Lobby fact input listener
    const factInput = document.getElementById('lobbyFactInput');
    if (factInput) {
        factInput.addEventListener('change', () => {
            socket.emit('update_fact', {fact: factInput.value});
        });
    }
});
