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

function nameSimilarity(spoken, actualName) {
    spoken = spoken.toLowerCase().trim();
    actualName = actualName.toLowerCase().trim();
    if (spoken === actualName) return 1.0;
    if (spoken.includes(actualName) || actualName.includes(spoken)) return 0.9;

    // Try matching individual words in the spoken phrase
    const words = spoken.split(/\s+/);
    let bestWordScore = 0;
    for (const w of words) {
        const dist = levenshtein(w, actualName);
        const maxLen = Math.max(w.length, actualName.length);
        const score = maxLen > 0 ? 1 - dist / maxLen : 0;
        if (score > bestWordScore) bestWordScore = score;
    }
    if (bestWordScore >= 0.5) return bestWordScore;

    // Prefix match
    const minLen = Math.min(spoken.length, actualName.length);
    if (minLen >= 3) {
        const p = Math.min(4, minLen);
        if (spoken.substring(0, p) === actualName.substring(0, p)) return 0.8;
    }

    // Character overlap
    let matchCount = 0;
    for (const ch of spoken) if (actualName.includes(ch)) matchCount++;
    return matchCount / Math.max(spoken.length, actualName.length);
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
    showScreen('partyOverlay');
};

window.createParty = function () {
    const name = document.getElementById('hostNameInput').value.trim();
    if (!name) { alert('Enter your name first!'); return; }
    myName = name;
    socket.emit('create_party', {name});
};

window.joinParty = function () {
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    const name = document.getElementById('joinNameInput').value.trim();
    if (!code || !name) { alert('Enter both a code and your name!'); return; }
    myName = name;
    socket.emit('join_party', {code, name});
};

window.hostStartGame = function () {
    socket.emit('start_game');
};

// ── Socket.IO listeners ───────────────────────────────────────

socket.on('party_created', data => {
    partyCode = data.code;
    myRole = 'host';
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
    const list = document.getElementById('lobbyPlayerList');
    if (!list) return;
    list.innerHTML = partyPlayers.map(p =>
        `<div style="margin:4px 0;padding:8px 12px;background:${p.role==='host'?'#e3f2fd':'#f5f5f5'};border-radius:6px;">
            <strong>${p.name}</strong> <span style="color:#888;font-size:13px;">(${p.role})</span>
        </div>`
    ).join('');
    // Build teamMembers from party
    teamMembers = partyPlayers.map(p => ({name: p.name, fact: ''}));
});

socket.on('game_started', () => {
    // All players see the instruction pages together
    currentRound = 1;
    correctAnswers = 0;
    showScreen('startOverlay');
    // Fill teammate facts display on page 4
    const factsDiv = document.getElementById('teammateFactsDisplay');
    if (factsDiv) {
        factsDiv.innerHTML = teamMembers.map(m =>
            `<div style="padding:10px;background:#f9f9f9;border-radius:6px;border:1px solid #e0e0e0;">
                <strong>${m.name}</strong>
            </div>`
        ).join('');
    }
    const teamList = document.getElementById('teamList');
    if (teamList) {
        teamList.innerHTML = teamMembers.map(m =>
            `<div style="margin:5px 0;">• <strong>${m.name}</strong></div>`
        ).join('');
    }
});

socket.on('round_data', data => {
    // Reset UI for all players (helpers didn't call startRound directly)
    resetRoundUI();
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
    // If I'm the helper being called, enable my inputs
    if (myRole === 'helper' && myName.toLowerCase() === helperName.toLowerCase()) {
        helpEnabled = true;
        updateInputAccess();
        showNotification(`${fromName} asked for your help!`, '#FF9800');
    } else if (myRole === 'host') {
        showNotification(`Asked ${helperName} for help`, '#4CAF50');
    }
});

socket.on('role_changed', data => {
    myRole = data.role;
    showNotification('You are now the Host!', '#2196F3');
    updateInputAccess();
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
        lockMsg.textContent = '🔒 Waiting for the host to call your name for help...';
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

// All players receive this and enter the game together
socket.on('sync_start_game', () => {
    const overlay = document.getElementById('startOverlay');
    if (overlay) overlay.style.display = 'none';
    currentRound = 1;
    correctAnswers = 0;
    document.getElementById('correctCount').textContent = '0';
    startVoiceListening();
    startRound();
});

function gatherAnswers() {
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

function handleVoiceCommand(transcript) {
    if (voiceAnswerMode) {
        voiceAnswerText = transcript;
        document.getElementById('voiceAnswerDisplay').textContent = `You said: "${transcript}"`;
        return;
    }
    if (!gameActive) return;

    const words = transcript.toLowerCase().split(/\s+/);
    let bestMatch = null;
    let bestScore = 0.5;  // lenient threshold

    for (const member of teamMembers) {
        // Try full transcript and individual words
        const fullScore = nameSimilarity(transcript, member.name);
        if (fullScore > bestScore) { bestScore = fullScore; bestMatch = member.name; }
        for (const w of words) {
            const s = nameSimilarity(w, member.name);
            if (s > bestScore) { bestScore = s; bestMatch = member.name; }
        }
    }

    if (bestMatch) {
        // Emit help request through server so all clients see it
        socket.emit('request_help', {helper_name: bestMatch});
    }
}

function showHelpRequest(playerName, confidence) {
    const pct = Math.round(confidence * 100);
    showNotification(`${playerName} – Help requested! (${pct}% match)`, '#FF9800');
}

function startVoiceListening() {
    if (recognition && !isListening) {
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
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = function (e) {
        const t = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
        console.log('Voice:', t);
        handleVoiceCommand(t);
    };
    recognition.onerror = function (e) {
        if (e.error === 'no-speech' && isListening && gameActive) {
            try { recognition.start(); } catch (_) {}
        }
    };
    recognition.onend = function () {
        if (isListening && gameActive && !voiceAnswerMode) {
            try { recognition.start(); } catch (_) {}
        }
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
});
