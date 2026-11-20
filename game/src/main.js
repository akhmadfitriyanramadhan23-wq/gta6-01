// Boot and the one loop: input is read every frame, the world advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the
// renderer paints what is there. The game moves between four screens:
// title, play, paused and busted.
//
// ?seed=N fixes the city. ?shot=start|play|end (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { MISSIONS, PLAYER_START, STEP, WORLD_H, WORLD_W } from './config.js';
import { createRandom } from './random.js';
import { createWorld, loadGame, saveGame, stepWorld } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE, ACTION_PUNCH, createInput } from './input.js';
import { createRenderer, SCREEN_BUSTED, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

// A saved game resumes where it left off: cash, mission, stashes, position.
const saved = loadGame();
let saveInfo = null;
if (saved) {
  world.cash = saved.cash ?? world.cash;
  world.mission.index = saved.mission ?? 0;
  world.mission.stage = saved.stage ?? 'pickup';
  for (const id of saved.stashes ?? []) {
    const stash = world.stashes.find((s) => s.id === id);
    if (stash) stash.taken = true;
  }
  world.player.x = saved.x ?? PLAYER_START.x;
  world.player.y = saved.y ?? PLAYER_START.y;
  if (world.mission.index === 2) {
    world.mission.timer = MISSIONS[2].timed;
    world.wanted = Math.max(world.wanted, 2);
  }
  if (world.mission.index === 1 && world.mission.stage === 'deliver') world.mission.packageHeld = true;
  if (world.mission.index === 0 && world.mission.stage === 'deliver' && world.rider) {
    world.rider.state = 'following';
    world.rider.x = world.player.x;
    world.rider.y = world.player.y;
  }
  const missionName = world.mission.index < MISSIONS.length
    ? MISSIONS[world.mission.index].name
    : 'Free roam';
  saveInfo = `Saved game: $${world.cash} · ${missionName} · press Enter to continue.`;
}

// Tiny WebAudio synth: pickup blips, a mission jingle, a police siren while
// wanted. Everything is an oscillator, no audio files, no network.
const AudioSys = {
  ctx: null,
  siren: null,
  ensure() {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  },
  blip(freq, dur, type, vol) {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol || 0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    } catch {
      // Sound is garnish: a failure never stops the game.
    }
  },
  jingle() {
    if (!this.ctx) return;
    [523, 659, 784].forEach((freq, i) => {
      window.setTimeout(() => this.blip(freq, 0.16, 'triangle', 0.14), i * 110);
    });
  },
  setSiren(on) {
    if (!this.ctx) return;
    try {
      if (on && !this.siren) {
        const osc = this.ctx.createOscillator();
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 750;
        lfo.type = 'sine';
        lfo.frequency.value = 0.45;
        lfoGain.gain.value = 280;
        gain.gain.value = 0.035;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        lfo.start();
        this.siren = { osc, lfo, gain };
      } else if (!on && this.siren) {
        this.siren.gain.gain.setValueAtTime(0, this.ctx.currentTime);
        this.siren.osc.stop();
        this.siren.lfo.stop();
        this.siren = null;
      }
    } catch {
      this.siren = null;
    }
  },
};

function cameraFor(focusX, focusY) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    x: Math.max(0, Math.min(WORLD_W - vw, focusX - vw / 2)),
    y: Math.max(0, Math.min(WORLD_H - vh, focusY - vh / 2)),
  };
}

function playerFocus() {
  const { player } = world;
  if (player.onFoot) return { x: player.x, y: player.y };
  return { x: player.car.x, y: player.car.y };
}

function runShot(name) {
  const scene = stageShot(world, name);
  const cam = cameraFor(scene.focus.x, scene.focus.y);
  let painted = 0;
  function paint() {
    renderer.paint(world, {
      screen: scene.screen, camX: cam.x, camY: cam.y, time: world.time, saveInfo: null,
    });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  // Screen readers (and anyone watching the page's text) hear the screen
  // changes and each job's news.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    AudioSys.ensure();
    accumulator = 0;
    screen = SCREEN_PLAY;
    const target = world.mission.index < MISSIONS.length
      ? MISSIONS[world.mission.index].brief
      : 'Free roam: pick up fares and hunt stashes.';
    announce(`Playing. ${target}`);
  }

  function handleEvents() {
    for (const event of world.events) {
      if (event === 'mission') {
        AudioSys.jingle();
        announce(world.banner ? world.banner.text : 'Mission complete.');
      } else if (event === 'pickup' || event === 'stash' || event === 'taxi') {
        AudioSys.blip(880, 0.09, 'sine', 0.12);
      } else if (event === 'steal') {
        AudioSys.blip(220, 0.12, 'square', 0.08);
        announce('Car stolen. The cops noticed.');
      } else if (event === 'busted') {
        AudioSys.setSiren(false);
        screen = SCREEN_BUSTED;
        announce(`Busted. The police took $${world.lastFine || 100}. Press Enter to walk free.`);
      } else if (event === 'hitped' || event === 'crash') {
        AudioSys.blip(110, 0.15, 'sawtooth', 0.1);
      }
    }
    world.events.length = 0;
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_CONFIRM && screen === SCREEN_TITLE) startGame();
    else if (actions & ACTION_CONFIRM && screen === SCREEN_BUSTED) {
      screen = SCREEN_PLAY;
      announce('Back on the street. Stay out of trouble.');
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      saveGame(world);
      announce('Paused. Progress saved.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
    return actions;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      let first = true;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        if (screen === SCREEN_TITLE) {
          stepWorld(world, { axis: { x: 0, y: 0 }, run: false, enter: false, punch: false, harmless: true }, STEP);
        } else {
          // One-shot presses fire on the first catch-up step only.
          const stepInput = {
            axis: input.axis(),
            run: input.running(),
            enter: first && Boolean(actions & ACTION_ENTER),
            punch: first && Boolean(actions & ACTION_PUNCH),
          };
          stepWorld(world, stepInput, STEP);
          handleEvents();
        }
        first = false;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    AudioSys.setSiren(screen === SCREEN_PLAY && world.wanted > 0);
    const focus = playerFocus();
    const cam = cameraFor(focus.x, focus.y);
    renderer.paint(world, {
      screen, camX: cam.x, camY: cam.y, time: world.time, saveInfo,
    });
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      saveGame(world);
      announce('Paused. Progress saved.');
    }
  });

  announce('Solmar Bay. Press Enter or click to play.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
