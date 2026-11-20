// The screenshot scenes behind ?shot=start|play|end. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, so the frame
// is what real play looks like and the same seed always gives the same frame.
// No DOM in here: the browser paints the returned screen and focus point,
// and a Node trace can run the same staging.
import { STEP } from './config.js';
import { createAutopilot } from './autopilot.js';
import { stepWorld } from './world.js';
import { SCREEN_BUSTED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 8;
const PLAY_SECONDS = 12;
const END_LIMIT_SECONDS = 12;

// The empty input: no keys, no one-shots.
const IDLE = { axis: { x: 0, y: 0 }, run: false, enter: false, punch: false };

function focusOn(world) {
  const { player } = world;
  if (player.onFoot) return { x: player.x, y: player.y };
  return { x: player.car.x, y: player.car.y };
}

/**
 * Set `world` to the named scene (start, play or end; any other name is
 * start) and return the screen to draw over it, the point the camera should
 * centre on, and how many steps the staging ran.
 */
export function stageShot(world, name) {
  if (name === 'play') {
    const pilot = createAutopilot(world);
    let steps = 0;
    for (; steps < PLAY_SECONDS / STEP; steps += 1) {
      const input = pilot.update(world, STEP);
      stepWorld(world, input, STEP);
    }
    return { screen: SCREEN_PLAY, focus: focusOn(world), steps };
  }
  if (name === 'end') {
    // Stage the bust: the player on foot at the 16th St crossing, wanted
    // level 5, three cruisers already on top of them.
    const { player } = world;
    player.x = 1600;
    player.y = 1200;
    player.angle = -Math.PI / 2;
    player.onFoot = true;
    player.car = null;
    world.wanted = 5;
    world.quietTime = 0;
    world.cars = world.cars.filter((car) => car.kind !== 'police');
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2;
      world.cars.push({
        id: world.nextCarId, kind: 'police',
        x: player.x + Math.cos(angle) * 55,
        y: player.y + Math.sin(angle) * 55,
        angle: angle + Math.PI,
        speed: 0, color: '#f4f6f8', health: 100,
        cruise: 330, route: null, wp: 0, stuck: 0, hitCooldown: 0,
      });
      world.nextCarId += 1;
    }
    let steps = 0;
    for (; steps < END_LIMIT_SECONDS / STEP; steps += 1) {
      world.events.length = 0;
      stepWorld(world, IDLE, STEP);
      if (world.events.includes('busted')) break;
    }
    return { screen: SCREEN_BUSTED, focus: focusOn(world), steps };
  }
  // Start: the title over a living city, eight seconds in.
  for (let i = 0; i < START_SECONDS / STEP; i += 1) {
    stepWorld(world, { ...IDLE, harmless: true }, STEP);
  }
  return { screen: SCREEN_TITLE, focus: { x: 1600, y: 1200 }, steps: START_SECONDS / STEP };
}
