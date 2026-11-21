// Solmar Bay — the road-following autopilot that stages the ?shot= scenes.
// It plans a route on the road graph (BFS over intersections, so it never
// U-turns: it goes around the block instead) and drives it in the right-hand
// lane, braking for pedestrians and cars and before sharp turns.
import { ROAD_SPACING, WORLD_W, WORLD_H, LANE_OFFSET, PICKUP_R } from './config.js';
import { nearestRoadX, nearestRoadY, pointOnRoad, objectiveOf } from './world.js';

function nodeKey(ix, iy) {
  return `${ix},${iy}`;
}

// BFS over the intersection graph from the intersection nearest (fx, fy)
// to the one nearest (tx, ty). Waypoints are intersection centres, plus the
// target itself as the last one.
export function planRoute(state, fx, fy, tx, ty) {
  const sx = nearestRoadX(fx);
  const sy = nearestRoadY(fy);
  const gx = nearestRoadX(tx);
  const gy = nearestRoadY(ty);
  if (sx === gx && sy === gy) return [{ x: tx, y: ty }];
  const prev = new Map();
  const seen = new Set([nodeKey(sx, sy)]);
  const queue = [[sx, sy]];
  let found = false;
  while (queue.length > 0) {
    const [cx, cy] = queue.shift();
    if (cx === gx && cy === gy) {
      found = true;
      break;
    }
    for (const [nx, ny] of [
      [cx + ROAD_SPACING, cy], [cx - ROAD_SPACING, cy],
      [cx, cy + ROAD_SPACING], [cx, cy - ROAD_SPACING],
    ]) {
      if (nx < ROAD_SPACING || nx > WORLD_W - ROAD_SPACING) continue;
      if (ny < ROAD_SPACING || ny > WORLD_H - ROAD_SPACING) continue;
      const k = nodeKey(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, [cx, cy]);
      queue.push([nx, ny]);
    }
  }
  const waypoints = [{ x: tx, y: ty }];
  if (found) {
    let cur = [gx, gy];
    const chain = [];
    while (!(cur[0] === sx && cur[1] === sy)) {
      chain.unshift({ x: cur[0], y: cur[1] });
      cur = prev.get(nodeKey(cur[0], cur[1]));
    }
    return [...chain, ...waypoints];
  }
  return waypoints;
}

// The right-hand lane point for travelling from (ax, ay) toward (bx, by)
// along a road: the lane centre 24px to the right of the direction of travel.
function laneTarget(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  // Right-hand side of the direction of travel.
  return { x: bx + ny * LANE_OFFSET, y: by - nx * LANE_OFFSET };
}

function nearestParkedCar(state, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (!car.parked) continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) {
      best = car;
      bestD = d;
    }
  }
  return best;
}

function obstacleAheadCar(state, car) {
  // Nearest obstacle ahead in the driving corridor, as a distance in px
  // (Infinity when the road ahead is clear). The corridor reaches far
  // enough to stop from full speed.
  const look = 50 + Math.abs(car.speed) * 0.55;
  const cx = Math.cos(car.angle);
  const cy = Math.sin(car.angle);
  let nearest = Infinity;
  const consider = (x, y, halfWidth) => {
    const dx = x - car.x;
    const dy = y - car.y;
    const along = dx * cx + dy * cy;
    if (along < 0 || along > look) return;
    const lateral = Math.abs(-dx * cy + dy * cx);
    if (lateral < halfWidth && along < nearest) nearest = along;
  };
  for (const t of state.traffic) consider(t.x, t.y, 30);
  for (const ped of state.peds) {
    if (ped.down || ped.inCar) continue;
    consider(ped.x, ped.y, 28);
  }
  for (const c of state.cars) {
    if (c === car || !c.parked) continue;
    if (!pointOnRoad(state, c.x, c.y)) continue; // parked off the road, in a bay
    consider(c.x, c.y, 30);
  }
  return nearest;
}

// One frame of autopilot input for the current world state. Stateless: it
// re-plans from the live state every call, so it recovers from any detour.
export function autopilotInput(state) {
  const p = state.player;
  const input = { up: false, down: false, left: false, right: false, run: false, action: false, enter: false };
  if (state.busted.active) return input;

  let target;
  if (p.onFoot) {
    const car = nearestParkedCar(state, p.x, p.y);
    if (!car) return input;
    if (Math.hypot(car.x - p.x, car.y - p.y) < 45) {
      input.enter = true;
      return input;
    }
    target = { x: car.x, y: car.y };
  } else {
    const obj = objectiveOf(state);
    target = { x: obj.x, y: obj.y };
  }

  const route = planRoute(state, p.x, p.y, target.x, target.y);
  // Drop waypoints we have already reached.
  let wp = route[0];
  let wpIndex = 0;
  while (wpIndex < route.length - 1 && Math.hypot(wp.x - p.x, wp.y - p.y) < 42) {
    wpIndex++;
    wp = route[wpIndex];
  }
  // Aim at the lane point of the leg we are driving.
  const legTarget = p.onFoot || wpIndex >= route.length - 1
    ? wp
    : laneTarget(p.x, p.y, wp.x, wp.y);
  const desired = Math.atan2(legTarget.y - p.y, legTarget.x - p.x);

  if (p.onFoot) {
    const dx = Math.cos(desired);
    const dy = Math.sin(desired);
    if (dx > 0.4) input.right = true;
    if (dx < -0.4) input.left = true;
    if (dy > 0.4) input.down = true;
    if (dy < -0.4) input.up = true;
    input.run = Math.hypot(target.x - p.x, target.y - p.y) > 200;
    return input;
  }

  // In a car: steer toward the waypoint, brake for turns and obstacles.
  const car = state.cars.find((c) => c.id === p.carId);
  if (!car) return input;
  let diff = desired - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > 0.12) input.right = true;
  else if (diff < -0.12) input.left = true;

  const distToWp = Math.hypot(wp.x - p.x, wp.y - p.y);
  const nextWp = route[Math.min(wpIndex + 1, route.length - 1)];
  const turnAhead = Math.abs(Math.atan2(nextWp.y - wp.y, nextWp.x - wp.x) - Math.atan2(wp.y - p.y, wp.x - p.x));
  const sharpTurn = turnAhead > 0.6 && distToWp < 130;
  const blocked = obstacleAheadCar(state, car);

  if (blocked < 70) {
    // Something close: brake hard and wait for it to clear.
    input.down = Math.abs(car.speed) > 30;
    return input;
  }
  if (blocked < Infinity) {
    // Something further up the road: ease off the gas and coast toward it.
    return input;
  }
  if (Math.abs(diff) > 1.1) {
    // Facing the wrong way: slow down, never reverse into a U-turn.
    input.down = Math.abs(car.speed) > 60;
    return input;
  }
  if (sharpTurn && Math.abs(car.speed) > 150) {
    input.down = true;
    return input;
  }
  input.up = true;
  return input;
}
