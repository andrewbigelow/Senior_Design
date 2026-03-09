#!/usr/bin/env node
/**
 * Local test script for voice recognition name matching.
 * Run: node test_voice_matching.js
 *
 * Tests the phoneticCode, nameSimilarity, and handleVoiceCommand logic
 * to verify that pronunciation variants and help requests work correctly.
 */

// ── Copy of matching functions from game.js ────────────────────

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

function phoneticCode(str) {
    str = str.toLowerCase().trim();
    if (!str) return '';
    let s = str
        .replace(/^[^a-z]+|[^a-z]+$/g, '')
        .replace(/ph/g, 'f')
        .replace(/ck/g, 'k')
        .replace(/sh/g, 'S')
        .replace(/th/g, 'T')
        .replace(/gh/g, '')
        .replace(/kn/g, 'n')
        .replace(/wr/g, 'r')
        .replace(/wh/g, 'w')
        .replace(/[aeiou]/g, 'a')
        .replace(/aa+/g, 'a')
        .replace(/([^a])\1+/g, '$1');
    return s;
}

function nameSimilarity(spoken, actualName) {
    spoken = spoken.toLowerCase().trim();
    actualName = actualName.toLowerCase().trim();
    if (spoken === actualName) return 1.0;
    if (spoken.includes(actualName) || actualName.includes(spoken)) return 0.95;

    const spokenPhonetic = phoneticCode(spoken);
    const namePhonetic = phoneticCode(actualName);
    if (spokenPhonetic && namePhonetic && spokenPhonetic === namePhonetic) return 0.92;

    const words = spoken.split(/\s+/);
    let bestWordScore = 0;
    for (const w of words) {
        const dist = levenshtein(w, actualName);
        const maxLen = Math.max(w.length, actualName.length);
        const score = maxLen > 0 ? 1 - dist / maxLen : 0;
        if (score > bestWordScore) bestWordScore = score;

        const wPhonetic = phoneticCode(w);
        if (wPhonetic && namePhonetic && wPhonetic === namePhonetic) {
            bestWordScore = Math.max(bestWordScore, 0.90);
        }
        if (wPhonetic && namePhonetic) {
            const pDist = levenshtein(wPhonetic, namePhonetic);
            const pMax = Math.max(wPhonetic.length, namePhonetic.length);
            const pScore = pMax > 0 ? 1 - pDist / pMax : 0;
            if (pScore > 0.6) bestWordScore = Math.max(bestWordScore, pScore * 0.85);
        }
    }
    if (bestWordScore >= 0.4) return bestWordScore;

    const minLen = Math.min(spoken.length, actualName.length);
    if (minLen >= 3) {
        const p = Math.min(4, minLen);
        if (spoken.substring(0, p) === actualName.substring(0, p)) return 0.8;
    }

    let matchCount = 0;
    for (const ch of spoken) if (actualName.includes(ch)) matchCount++;
    return matchCount / Math.max(spoken.length, actualName.length);
}

/**
 * Simulate handleVoiceCommand: given a transcript, myName, and teamMembers,
 * return the matched helper name or null.
 */
function simulateVoiceCommand(transcript, myName, teamMembers) {
    const cleaned = transcript.toLowerCase()
        .replace(/^(hey|yo|ok|okay|um|uh|like)\s+/i, '')
        .trim();
    const words = cleaned.split(/\s+/);
    let bestMatch = null;
    let bestScore = 0.35;

    for (const member of teamMembers) {
        if (member.name.toLowerCase() === myName.toLowerCase()) continue;

        const fullScore = nameSimilarity(cleaned, member.name);
        if (fullScore > bestScore) { bestScore = fullScore; bestMatch = member.name; }

        for (const w of words) {
            if (w.length < 2) continue;
            const s = nameSimilarity(w, member.name);
            if (s > bestScore) { bestScore = s; bestMatch = member.name; }
        }

        for (let i = 0; i < words.length - 1; i++) {
            const combo = words[i] + ' ' + words[i + 1];
            const cs = nameSimilarity(combo, member.name);
            if (cs > bestScore) { bestScore = cs; bestMatch = member.name; }
        }
    }

    return { match: bestMatch, score: bestScore };
}

/**
 * Simulate the helper receiving a help_requested event.
 * Returns true if the helper would be enabled.
 */
function simulateHelperReceive(helperNameFromServer, myName) {
    const similarity = nameSimilarity(helperNameFromServer, myName);
    return { enabled: similarity >= 0.5, similarity };
}

// ── Test runner ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, testName, detail) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        console.log(`  ❌ ${testName}  — ${detail || 'FAILED'}`);
    }
}

// ================================================================
console.log('\n🔤 PHONETIC CODE TESTS');
console.log('─'.repeat(50));
// ================================================================

assert(phoneticCode('Sarah') === phoneticCode('Sara'),
    'Sarah ↔ Sara phonetic match',
    `"${phoneticCode('Sarah')}" vs "${phoneticCode('Sara')}"`);

assert(phoneticCode('Shawn') === phoneticCode('Sean'),
    'Shawn ↔ Sean phonetic match',
    `"${phoneticCode('Shawn')}" vs "${phoneticCode('Sean')}"`);

assert(phoneticCode('Chris') === phoneticCode('Kris'),
    'Chris ↔ Kris phonetic match',
    `"${phoneticCode('Chris')}" vs "${phoneticCode('Kris')}"`);

assert(phoneticCode('Phillip') === phoneticCode('Filip'),
    'Phillip ↔ Filip phonetic match',
    `"${phoneticCode('Phillip')}" vs "${phoneticCode('Filip')}"`);

assert(phoneticCode('Nick') === phoneticCode('Nik'),
    'Nick ↔ Nik phonetic match',
    `"${phoneticCode('Nick')}" vs "${phoneticCode('Nik')}"`);

// Phonetic codes for names that should NOT match
assert(phoneticCode('Andrew') !== phoneticCode('Sarah'),
    'Andrew ≠ Sarah phonetic',
    `"${phoneticCode('Andrew')}" vs "${phoneticCode('Sarah')}"`);

// ================================================================
console.log('\n📏 NAME SIMILARITY TESTS');
console.log('─'.repeat(50));
// ================================================================

const simTests = [
    // [spoken, actual, minScore, description]
    ['sarah', 'Sarah', 1.0,  'Exact match (case-insensitive)'],
    ['sara', 'Sarah', 0.85,  'Sara → Sarah (missing h)'],
    ['shawn', 'Sean', 0.5,   'Shawn → Sean (phonetic variant)'],
    ['andrew', 'Andrew', 1.0, 'Exact match'],
    ['andru', 'Andrew', 0.5,  'Andru → Andrew (typo)'],
    ['hey sarah', 'Sarah', 0.85, '"hey sarah" contains name'],
    ['can sarah help', 'Sarah', 0.85, '"can sarah help" contains name'],
    ['jon', 'John', 0.5,     'Jon → John (missing h)'],
    ['mike', 'Michael', 0.4, 'Mike → Michael (nickname-ish)'],
    ['kris', 'Chris', 0.85,  'Kris → Chris (phonetic)'],
    ['phillip', 'Filip', 0.7, 'Phillip → Filip (phonetic)'],
];

for (const [spoken, actual, minScore, desc] of simTests) {
    const score = nameSimilarity(spoken, actual);
    assert(score >= minScore,
        `${desc}: ${score.toFixed(2)} ≥ ${minScore}`,
        `got ${score.toFixed(3)}, need ≥ ${minScore}`);
}

// ================================================================
console.log('\n🎤 VOICE COMMAND SIMULATION TESTS');
console.log('─'.repeat(50));
// ================================================================

const team = [
    { name: 'Andrew' },
    { name: 'Sarah' },
    { name: 'John' },
];

// Host is "Andrew", so voice should never match Andrew
const voiceTests = [
    // [transcript, myName, expectedMatch, description]
    ['Sarah',           'Andrew', 'Sarah', 'Direct name call'],
    ['hey Sarah',       'Andrew', 'Sarah', '"Hey Sarah" with filler'],
    ['sara',            'Andrew', 'Sarah', 'Sara (missing h) → Sarah'],
    ['um sarah',        'Andrew', 'Sarah', '"um sarah" with filler'],
    ['can john help',   'Andrew', 'John',  '"can john help" finds John'],
    ['jon',             'Andrew', 'John',  'Jon → John (variant)'],
    ['okay John',       'Andrew', 'John',  '"okay John" with filler'],
    ['Andrew',          'Andrew', null,    'Should NOT match self'],
    ['andrew help me',  'Andrew', null,    'Should NOT match self in phrase'],
    ['Sarah',           'John',   'Sarah', 'Helper perspective: Sarah'],
    ['hey john',        'Sarah',  'John',  'Helper perspective: hey john'],
];

for (const [transcript, myName, expected, desc] of voiceTests) {
    const result = simulateVoiceCommand(transcript, myName, team);
    if (expected === null) {
        assert(result.match === null,
            `${desc}: no match`,
            `got "${result.match}" (score ${result.score.toFixed(2)})`);
    } else {
        assert(result.match === expected,
            `${desc}: → ${expected} (score ${result.score.toFixed(2)})`,
            `got "${result.match}" instead of "${expected}"`);
    }
}

// ================================================================
console.log('\n🔓 HELPER RECEIVE TESTS (fuzzy unlock)');
console.log('─'.repeat(50));
// ================================================================

const receiveTests = [
    // [nameFromServer, helperMyName, shouldEnable, desc]
    ['Sarah', 'Sarah', true,  'Exact name enables helper'],
    ['sarah', 'Sarah', true,  'Case-insensitive enables helper'],
    ['Sara',  'Sarah', true,  'Sara enables Sarah (fuzzy)'],
    ['John',  'Sarah', false, 'John does NOT enable Sarah'],
    ['Jon',   'John',  true,  'Jon enables John (fuzzy)'],
    ['Andrew','Sarah', false, 'Andrew does NOT enable Sarah'],
];

for (const [serverName, myName, shouldEnable, desc] of receiveTests) {
    const result = simulateHelperReceive(serverName, myName);
    assert(result.enabled === shouldEnable,
        `${desc}: enabled=${result.enabled} (sim=${result.similarity.toFixed(2)})`,
        `expected enabled=${shouldEnable}, got ${result.enabled} (sim=${result.similarity.toFixed(2)})`);
}

// ================================================================
console.log('\n🔊 EDGE CASE TESTS');
console.log('─'.repeat(50));
// ================================================================

// Mumbled / partial speech
const edgeCases = [
    ['sar',    'Andrew', 'Sarah', 'Partial name "sar" → Sarah'],
    ['like sarah', 'Andrew', 'Sarah', '"like sarah" filler stripped'],
    ['yo john', 'Andrew', 'John', '"yo john" filler stripped'],
];

for (const [transcript, myName, expected, desc] of edgeCases) {
    const result = simulateVoiceCommand(transcript, myName, team);
    if (expected === null) {
        assert(result.match === null, `${desc}: no match`,
            `got "${result.match}" (score ${result.score.toFixed(2)})`);
    } else {
        assert(result.match === expected,
            `${desc}: → ${expected} (score ${result.score.toFixed(2)})`,
            `got "${result.match}" instead of "${expected}"`);
    }
}

// ================================================================
// Summary
// ================================================================
console.log('\n' + '═'.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed === 0) {
    console.log('🎉 All tests passed! Safe to push.');
} else {
    console.log('⚠️  Some tests failed — review before pushing.');
}
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
