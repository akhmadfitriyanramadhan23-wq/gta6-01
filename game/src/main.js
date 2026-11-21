// Solmar Bay — the entry point. Fixed-step loop, title / play / paused /
// busted screens, a tiny WebAudio synth, save in localStorage, and the
// deterministic ?seed= / ?shot= staging the screenshots are taken from.
import { createWorld, stepWorld, saveGame, loadGame } from './world.js';
import { SAVE_KEY, WORLD_W, WORLD_H } from './config.js';
import { render } from './render.js';
import { createInput } from './input.js';
import { autopilotInput } from './shots.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || '1') || 1;
const shot = params.get('shot'); // start | play | end | null

const state = createWorld(seed);
const input = createInput();
input.attach();

// A saved game resumes where the player left off — except in a staged
// screenshot run, which must be deterministic.
let hasSave = false;
if (!shot) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw && loadGame(state, raw)) hasSave = true;
  } catch {
    hasSave = false;
  }
}

let screen = 'title';
let camera = { x: state.player.x, y: state.player.y };
let shotClock = 0;
let frozen = false;
let statusText = '';

function setStatus(text) {
  if (text === statusText) return;
  statusText = text;
  statusEl.textContent = text;
}

// --- tiny synth: blips, a mission jingle, a police siren ---

let audio = null;
function ensureAudio() {
  if (audio) return audio;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
  } catch {
    audio = null;
  }
  return audio;
}

function blip(freq, seconds, type = 'sine', gain = 0.08) {
  const ac = ensureAudio();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + seconds);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + seconds);
  } catch {
    // Sound is garnish; never let it break the game.
  }
}

let sirenNodes = null;
function siren(on) {
  const ac = ensureAudio();
  if (!ac) return;
  try {
    if (on && !sirenNodes) {
      const osc = ac.createOscillator();
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      const g = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 700;
      lfo.type = 'sine';
      lfo.frequency.value = 0.5;
      lfoGain.gain.value = 250;
      g.gain.value = 0.025;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(g).connect(ac.destination);
      osc.start();
      lfo.start();
      sirenNodes = { osc, lfo, g };
    } else if (!on && sirenNodes) {
      sirenNodes.osc.stop();
      sirenNodes.lfo.stop();
      sirenNodes = null;
    }
  } catch {
    sirenNodes = null;
  }
}

function playEvents(events) {
  for (const e of events) {
    if (e === 'pickup') blip(880, 0.12, 'sine', 0.09);
    else if (e === 'steal') blip(220, 0.15, 'square', 0.05);
    else if (e === 'scrape') blip(140, 0.08, 'sawtooth', 0.05);
    else if (e === 'pedhit') blip(110, 0.2, 'sawtooth', 0.07);
    else if (e === 'busted') {
      blip(330, 0.3, 'square', 0.06);
      setTimeout(() => blip(220, 0.4, 'square', 0.06), 220);
    } else if (e === 'mission') {
      [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'sine', 0.09), i * 130));
    }
  }
}

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, saveGame(state));
  } catch {
    // Private mode or a full store: the game plays on without a save.
  }
}

// --- shot staging ---

function stageShot(name) {
  if (name === 'start') {
    // Title over the live city: traffic rolls, the camera drifts.
    screen = 'title';
  } else if (name === 'play') {
    screen = 'play';
  } else if (name === 'end') {
    // A busted scene: wanted, police closing in on foot.
    screen = 'play';
    state.wanted = 2;
    state.policeTimer = 0;
  }
}

if (shot) stageShot(shot);

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- the loop ---

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  const keys = input.read();

  if (screen === 'title') {
    if (input.wasPressed('Enter')) {
      ensureAudio();
      screen = 'play';
      setStatus('Playing. Follow the yellow marker.');
    } else if (shot === 'start') {
      // The live city rolls behind the title; the camera drifts slowly.
      stepWorld(state, {}, STEP);
      camera.x = 1600 + Math.sin(state.time * 0.05) * 500;
      camera.y = 1200 + Math.cos(state.time * 0.04) * 300;
      window.__solmarShotReady = true;
    }
  } else if (screen === 'play') {
    if (input.wasPressed('KeyP') || input.wasPressed('Escape')) {
      screen = 'paused';
    } else if (state.busted.active) {
      screen = 'busted';
      siren(false);
      if (input.wasPressed('Enter')) {
        state.busted.active = false;
        state.busted.timer = 0;
        screen = 'play';
      }
    } else if (!frozen) {
      // The play shot is driven by the autopilot; the end shot leaves the
      // player standing on foot so the police can close in and bust them.
      const driving = shot === 'play';
      acc += elapsed;
      let n = 0;
      while (acc >= STEP && n < 5) {
        const stepInput = driving ? autopilotInput(state) : keys;
        stepWorld(state, stepInput, STEP);
        playEvents(state.events);
        acc -= STEP;
        n++;
      }
      if (n === 5) acc = 0;
      siren(state.wanted > 0);
      if (shot === 'play') {
        shotClock += elapsed;
        if (shotClock >= 16) {
          frozen = true;
          window.__solmarShotReady = true;
        }
      } else if (shot === 'end' && state.busted.active) {
        frozen = true;
        window.__solmarShotReady = true;
      }
      if (!shot) {
        shotClock += elapsed;
        if (shotClock > 5) {
          shotClock = 0;
          persist();
        }
      }
    }
  } else if (screen === 'paused') {
    siren(false);
    if (input.wasPressed('KeyP') || input.wasPressed('Escape') || input.wasPressed('Enter')) {
      screen = 'play';
    }
  } else if (screen === 'busted') {
    if (input.wasPressed('Enter')) {
      state.busted.active = false;
      state.busted.timer = 0;
      screen = 'play';
      persist();
    }
  }

  // Camera follows the player (or the staged drift on the title screen).
  if (screen !== 'title' || shot !== 'start') {
    camera.x += (state.player.x - camera.x) * 0.12;
    camera.y += (state.player.y - camera.y) * 0.12;
  }
  camera.x = Math.max(canvas.width / 2 - 200, Math.min(WORLD_W - canvas.width / 2 + 200, camera.x));
  camera.y = Math.max(canvas.height / 2 - 200, Math.min(WORLD_H - canvas.height / 2 + 200, camera.y));

  if (screen === 'title' && !shot) {
    setStatus(hasSave ? 'Solmar Bay. Press Enter to continue your game.' : 'Solmar Bay. Press Enter to start.');
  } else if (screen === 'play' && !shot) {
    setStatus(state.busted.active ? 'Busted.' : 'Playing. Follow the yellow marker.');
  } else if (screen === 'paused') {
    setStatus('Paused.');
  }

  render(ctx, state, { width: canvas.width, height: canvas.height, screen, camera });
}

window.__solmar = {
  get state() {
    return state;
  },
  get screen() {
    return screen;
  },
};

requestAnimationFrame(frame);
