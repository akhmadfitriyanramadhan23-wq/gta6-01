// The screenshot autopilot: drives Solmar Bay the way a player would, with
// no randomness of its own. On foot it walks to the nearest parked car and
// steals it; in a car it follows a breadth-first route across the road grid
// toward the mission marker, in the right-hand lane, braking for traffic
// and pedestrians and before sharp turns, and going around the block instead
// of ever U-turning. Pure logic over the world — no DOM — so the same code
// runs in the browser's shot scenes and in a Node trace.
import { angleDiff, currentTarget, findRoute } from './world.js';
import { HORIZONTAL_ROADS, VERTICAL_ROADS } from './config.js';

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

// The car's position snapped onto the road it is on: the start of the
// first leg, so the lane offset is worked out from the leg's own axis.
function snapToRoad(x, y) {
  for (const vx of VERTICAL_ROADS) {
    if (Math.abs(x - vx) <= 36) return { x: vx, y };
  }
  for (const hy of HORIZONTAL_ROADS) {
    if (Math.abs(y - hy) <= 36) return { x, y: hy };
  }
  return { x, y };
}

// The right-hand lane point for a leg from P to Q: Q shifted 18 px to the
// side the driver's right hand falls on, from the leg's dominant axis.
function legTarget(prev, next) {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: next.x, y: next.y + (dx > 0 ? 18 : -18) };
  return { x: next.x + (dy > 0 ? -18 : 18), y: next.y };
}

export function createAutopilot(world) {
  const state = {
    mode: 'toCar',
    targetKey: '',
    route: null,
    wp: 0,
    targetCar: null,
    stuckTime: 0,
    lastX: 0,
    lastY: 0,
    sidestep: 0,
    sidestepDir: 1,
    blockedTime: 0,
    overtake: null,
  };

  function replan() {
    const target = currentTarget(world);
    if (!target) {
      state.route = null;
      return;
    }
    const { player } = world;
    const fx = player.onFoot ? player.x : player.car.x;
    const fy = player.onFoot ? player.y : player.car.y;
    const heading = player.onFoot ? undefined : player.car.angle;
    state.route = findRoute(fx, fy, target.x, target.y, heading);
    state.wp = 0;
    state.targetKey = `${world.mission.index}:${world.mission.stage}:${target.x},${target.y}`;
  }

  // Is anything driveable straight ahead of the car, in its own lane?
  // Parked cars are not obstacles: they sit on the shoulder, out of the
  // lane, and neither is the car coming the other way, 36 px to the side.
  // Returns the blocker, or null.
  function blockedAhead(world, car) {
    const hx = Math.cos(car.angle);
    const hy = Math.sin(car.angle);
    const lookAhead = 80 + Math.abs(car.speed) * 0.7;
    let best = null;
    let bestAlong = Infinity;
    const consider = (x, y, obj) => {
      const rx = x - car.x;
      const ry = y - car.y;
      const along = rx * hx + ry * hy;
      const across = Math.abs(rx * hy - ry * hx);
      if (along > 0 && along < lookAhead && across < 26 && along < bestAlong) {
        bestAlong = along;
        best = obj;
      }
    };
    for (const other of world.cars) {
      if (other === car || other.kind === 'parked' || other.kind === 'wreck') continue;
      consider(other.x, other.y, other);
    }
    for (const ped of world.peds) {
      if (ped.state !== 'walk') continue;
      consider(ped.x, ped.y, ped);
    }
    return best;
  }

  function driveInput(world, dt) {
    const { player } = world;
    const car = player.car;
    const input = { axis: { x: 0, y: 0 }, run: false, enter: false, punch: false };
    if (!car) {
      state.mode = 'toCar';
      return input;
    }
    const target = currentTarget(world);
    if (!target) return input;
    const key = `${world.mission.index}:${world.mission.stage}:${target.x},${target.y}`;
    if (!state.route || key !== state.targetKey) replan();
    if (!state.route || state.wp >= state.route.length) {
      // Final approach: straight at the marker.
      const desired = Math.atan2(target.y - car.y, target.x - car.x);
      const diff = angleDiff(car.angle, desired);
      input.axis.x = clamp(diff * 2, -1, 1);
      const dist = Math.hypot(target.x - car.x, target.y - car.y);
      const cap = dist < 120 ? 120 : 300;
      input.axis.y = car.speed > cap ? 1 : -1;
      return input;
    }
    const raw = state.route[state.wp];
    const prev = state.wp > 0 ? state.route[state.wp - 1] : snapToRoad(car.x, car.y);
    const last = state.wp === state.route.length - 1;
    const aim = last ? raw : legTarget(prev, raw);
    const wx = aim.x;
    const wy = aim.y;
    const dx = wx - car.x;
    const dy = wy - car.y;
    const dist = Math.hypot(dx, dy);
    // Switch legs early (130 px out, 55 for the final marker): a car that
    // only starts turning at the crossing arcs wide across the pavement,
    // and the parked cars on it. The turn starts before the crossing, so
    // the arc ends in the next lane.
    if (dist < (last ? 55 : 130)) {
      state.wp += 1;
      return driveInput(world, dt);
    }
    const desired = Math.atan2(dy, dx);
    const diff = angleDiff(car.angle, desired);
    // A waypoint behind the car means the route was missed: replan and go
    // around the block instead of swinging a U-turn across the pavement.
    const ahead = Math.cos(diff);
    if (ahead < -0.2 && dist > 100) {
      replan();
      return input;
    }
    input.axis.x = clamp(diff * 2, -1, 1);
    // A blocker that has sat ahead for a while gets overtaken: slip 70 px
    // to the side of it and carry on, instead of waiting behind it forever.
    const blocker = blockedAhead(world, car);
    if (blocker) state.blockedTime += dt;
    else {
      state.blockedTime = 0;
      state.overtake = null;
    }
    if (blocker && state.blockedTime > 1.5 && !state.overtake) {
      const px = -Math.sin(car.angle);
      const py = Math.cos(car.angle);
      state.overtake = { x: blocker.x + px * 70, y: blocker.y + py * 70 };
    }
    if (state.overtake) {
      const odx = state.overtake.x - car.x;
      const ody = state.overtake.y - car.y;
      const odist = Math.hypot(odx, ody);
      const behind = !blocker
        || (blocker.x - car.x) * Math.cos(car.angle) + (blocker.y - car.y) * Math.sin(car.angle) < 0;
      if (odist < 40 || behind) {
        state.overtake = null;
        state.blockedTime = 0;
      } else {
        const odesired = Math.atan2(ody, odx);
        const odiff = angleDiff(car.angle, odesired);
        input.axis.x = clamp(odiff * 2, -1, 1);
        input.axis.y = car.speed > 200 ? 1 : -1;
        return input;
      }
    }
    let cap = 430 * Math.max(0.25, Math.cos(diff));
    if (dist < 180) cap = Math.min(cap, 130 + dist);
    // A sharp turn at the next crossing: slow down on the approach, so the
    // car turns inside the intersection instead of arcing wide across the
    // pavement — and the parked cars on it.
    if (state.wp + 1 < state.route.length) {
      const next = state.route[state.wp + 1];
      const legAngle = Math.atan2(wy - prev.y, wx - prev.x);
      const nextAngle = Math.atan2(next.y - raw.y, next.x - raw.x);
      if (Math.abs(angleDiff(legAngle, nextAngle)) > 0.5 && dist < 260) {
        cap = Math.min(cap, 60 + dist * 0.6);
      }
    }
    if (blocker) cap = 0;
    input.axis.y = car.speed > cap ? 1 : -1;
    // Stuck against something: replan once the car has sat still a while.
    if (Math.abs(car.speed) < 15) {
      state.stuckTime += dt;
      if (state.stuckTime > 3) {
        state.stuckTime = 0;
        replan();
      }
    } else {
      state.stuckTime = 0;
    }
    return input;
  }

  function walkInput(world, dt) {
    const { player } = world;
    const input = { axis: { x: 0, y: 0 }, run: true, enter: false, punch: false };
    if (!state.targetCar || (state.targetCar.kind !== 'parked' && state.targetCar.kind !== 'traffic')) {
      // The nearest car anywhere in the city, not just one in reach.
      let best = null;
      let bestD = Infinity;
      for (const car of world.cars) {
        if (car.kind !== 'parked' && car.kind !== 'traffic') continue;
        const d = Math.hypot(car.x - player.x, car.y - player.y);
        if (d < bestD) {
          bestD = d;
          best = car;
        }
      }
      state.targetCar = best;
      if (!state.targetCar) return input;
    }
    const car = state.targetCar;
    const dx = car.x - player.x;
    const dy = car.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 50) {
      input.enter = true;
      return input;
    }
    // If a building has the player pinned, sidestep around it for a while.
    const moved = Math.hypot(player.x - state.lastX, player.y - state.lastY);
    if (moved < 4) {
      state.sidestep += dt;
      if (state.sidestep > 1.2) {
        state.sidestep = 0;
        state.sidestepDir *= -1;
      }
    } else {
      state.sidestep = 0;
    }
    state.lastX = player.x;
    state.lastY = player.y;
    let mx = dx / dist;
    let my = dy / dist;
    if (state.sidestep > 0) {
      const px = -my * state.sidestepDir;
      const py = mx * state.sidestepDir;
      mx = (mx + px * 1.4) / Math.hypot(mx + px * 1.4, my + py * 1.4);
      my = (my + py * 1.4) / Math.hypot(mx + px * 1.4, my + py * 1.4);
    }
    input.axis.x = clamp(mx * 1.5, -1, 1);
    input.axis.y = clamp(my * 1.5, -1, 1);
    return input;
  }

  // One step of driving or walking, returning the input stepWorld wants.
  function update(world, dt) {
    const { player } = world;
    if (player.onFoot) {
      state.mode = 'toCar';
      state.route = null;
      return walkInput(world, dt);
    }
    state.mode = 'toTarget';
    return driveInput(world, dt);
  }

  return { update, state };
}
