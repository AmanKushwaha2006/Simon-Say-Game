// Simon Says game - all the game logic lives here

"use strict";

// Game state variables
let gameSeq = [];
let userSeq = [];
let level = 0;
let started = false;
let accepting = false;   // whether we accept user clicks

const COLORS = ["red", "blue", "green", "yellow"];

// Grab all the elements we need from the page
const statusEl = document.getElementById("status-msg");
const levelVal = document.getElementById("level-value");
const hsVal = document.getElementById("highscore-value");
const btnStart = document.getElementById("btn-start");
const board = document.getElementById("simon-board");
const hsList = document.getElementById("hs-list");
const btnClearHs = document.getElementById("btn-clear-hs");

// High score saving and loading (stored in localStorage)
const HS_KEY = "simonSays_highscores";
const MAX_SCORES = 5;

function loadScores() {
    try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; }
    catch { return []; }
}
function saveScores(arr) {
    localStorage.setItem(HS_KEY, JSON.stringify(arr));
}
function recordScore(score) {
    const arr = loadScores();
    arr.push({ score, date: new Date().toLocaleDateString() });
    arr.sort((a, b) => b.score - a.score);
    const trimmed = arr.slice(0, MAX_SCORES);
    saveScores(trimmed);
    return trimmed;
}
function renderScores() {
    const arr = loadScores();
    if (arr.length === 0) {
        hsList.innerHTML = '<li class="hs-empty">No scores yet – be the first!</li>';
        return;
    }
    const medals = ["gold", "silver", "bronze"];
    hsList.innerHTML = arr.map((entry, i) => `
    <li>
      <span class="hs-rank ${medals[i] || ''}">
        ${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
      </span>
      <span class="hs-label">Level&nbsp;${entry.score}</span>
      <span class="hs-score">${entry.score}</span>
    </li>
  `).join("");
    // update best badge
    hsVal.textContent = arr[0].score;
}

// Sound - we use the Web Audio API to make tones without any audio files
let audioCtx = null;

function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

const COLOR_FREQ = { red: 261.6, blue: 329.6, green: 392.0, yellow: 523.3 };

function playTone(color, duration = 0.22) {
    try {
        const ctx = getAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = "sine";
        osc.frequency.value = COLOR_FREQ[color] || 440;

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration + 0.02);
    } catch (e) {
        // Some browsers block audio until the user interacts - just skip if that happens
    }
}

function playErrorSound() {
    try {
        const ctx = getAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
    } catch (e) { }
}

function playSuccessChime() {
    [261.6, 329.6, 392.0, 523.3].forEach((freq, i) => {
        try {
            const ctx = getAudio();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
            gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + i * 0.1 + 0.02);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.1 + 0.18);
            osc.start(ctx.currentTime + i * 0.1);
            osc.stop(ctx.currentTime + i * 0.1 + 0.2);
        } catch (e) { }
    });
}

// Creates the ink-ripple animation when you click a button
function createRipple(event, el) {
    const rect = el.getBoundingClientRect();
    const r = document.createElement("span");
    r.className = "ripple";
    const size = Math.max(rect.width, rect.height);
    r.style.width = r.style.height = `${size}px`;
    r.style.left = `${event.clientX - rect.left - size / 2}px`;
    r.style.top = `${event.clientY - rect.top - size / 2}px`;
    el.appendChild(r);
    r.addEventListener("animationend", () => r.remove());
}

// Lights up a pad for Simon's turn or the user's turn
function flashPad(color, isSimon = true) {
    return new Promise(resolve => {
        const pad = document.getElementById(color);
        const cls = isSimon ? "flash-simon" : "flash-user";
        pad.classList.add(cls);
        playTone(color);
        setTimeout(() => {
            pad.classList.remove(cls);
            resolve();
        }, isSimon ? 450 : 200);
    });
}

// Simon shows the player the one new color he picked this round.
// The player then has to remember and repeat everything from Level 1 up to now.
async function playSequence() {
    accepting = false;
    setPadDisabled(true);
    statusEl.textContent = "👀 Watch Simon…";
    statusEl.className = "status-msg";

    // Only flash the last (newly added) color
    const newColor = gameSeq[gameSeq.length - 1];
    await sleep(400);
    await flashPad(newColor, true);

    await sleep(350);
    statusEl.innerHTML = `🎯 Your turn! Repeat <strong>${gameSeq.length}</strong> color${gameSeq.length > 1 ? "s" : ""} from Level 1`;
    statusEl.className = "status-msg active-level";
    setPadDisabled(false);
    accepting = true;
}

// Move to the next level - pick a new random color and add it to the sequence
async function levelUp() {
    userSeq = [];
    level++;
    updateLevelDisplay(level);

    const randColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    gameSeq.push(randColor);

    await playSequence();
}

// Check if the color the user just pressed matches the sequence
async function checkAns(idx) {
    if (userSeq[idx] !== gameSeq[idx]) {
        // Wrong!
        gameOver();
        return;
    }

    if (userSeq.length === gameSeq.length) {
        // Completed this round
        accepting = false;
        setPadDisabled(true);
        playSuccessChime();
        statusEl.textContent = `✅ Level ${level} complete!`;
        statusEl.className = "status-msg success";
        await sleep(900);
        levelUp();
    }
}

// Handle a wrong press - show game over, save the score, and reset
function gameOver() {
    accepting = false;
    setPadDisabled(true);
    playErrorSound();

    // Board shake
    board.classList.add("shake");
    board.addEventListener("animationend", () => board.classList.remove("shake"), { once: true });

    statusEl.innerHTML = `💀 Game Over! You reached <strong>Level ${level}</strong>. Press Start to retry.`;
    statusEl.className = "status-msg game-over";

    // Record score
    const best = recordScore(level);
    renderScores();

    // Update best badge with bump
    hsVal.textContent = best[0].score;
    hsVal.classList.add("bump");
    setTimeout(() => hsVal.classList.remove("bump"), 300);

    reset();
}

// Reset everything back to zero so a new game can start
function reset() {
    started = false;
    gameSeq = [];
    userSeq = [];
    level = 0;
    accepting = false;

    board.classList.remove("playing");
    btnStart.textContent = "START GAME";
    btnStart.disabled = false;
}

// Called when the user clicks one of the four colored pads
function handlePadClick(event) {
    if (!accepting) return;

    const color = this.id;
    createRipple(event, this);
    flashPad(color, false);

    userSeq.push(color);
    checkAns(userSeq.length - 1);
}

// Kick off a new game when the Start button is clicked
function startGame(event) {
    createRipple(event, btnStart);

    // Resume AudioContext if suspended (iOS / Chrome autoplay policy)
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

    // Reset any previous game
    gameSeq = [];
    userSeq = [];
    level = 0;
    started = true;

    board.classList.add("playing");
    btnStart.disabled = true;
    btnStart.textContent = "PLAYING…";

    statusEl.textContent = "Get ready…";
    statusEl.className = "status-msg";

    setTimeout(levelUp, 800);
}

// Hook up all the event listeners
btnStart.addEventListener("click", startGame);

document.querySelectorAll(".pad").forEach(pad => {
    pad.addEventListener("click", handlePadClick);
});

// Also support keyboard Start (Enter / Space)
document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && !started) {
        btnStart.click();
    }
});

btnClearHs.addEventListener("click", () => {
    if (confirm("Clear all saved scores?")) {
        localStorage.removeItem(HS_KEY);
        renderScores();
        hsVal.textContent = "0";
    }
});

// Small utility functions used throughout the game
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setPadDisabled(val) {
    document.querySelectorAll(".pad").forEach(p => p.disabled = val);
}

function updateLevelDisplay(lvl) {
    levelVal.textContent = lvl;
    levelVal.classList.add("bump");
    setTimeout(() => levelVal.classList.remove("bump"), 300);
}

// Run when the page first loads
renderScores();
