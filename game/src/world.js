// Solmar Bay — the whole simulation: city, traffic, pedestrians, police,
// wanted level, missions, taxi fares and stashes. Pure logic, no DOM, no
// canvas: the browser renders this state, and Node tests drive it headless.
import {
  WORLD_W, WORLD_H, ROAD_SPACING, ROAD_W, ROAD_HALF, LANE_OFFSET, SIDEWALK_OFFSET,
  SEA_W, BEACH_W, PLAYER_WALK, PLAYER_RUN, PLAYER_R,
  CAR_ACCEL, CAR_BRAKE, CAR_REVERSE_MAX, CAR_MAX_SPEED, CAR_TURN, CAR_DRAG, CAR_R,
  CAR_HEALTH, SCRAPE_DAMAGE, SCRAPE_COOLDOWN, KMH,
  TRAFFIC_COUNT, TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX,
  PED_COUNT, PED_SPEED_MIN, PED_SPEED_MAX, PARKED_COUNT,
  WANTED_MAX, WANTED_DECAY_SECONDS, WANTED_DECAY_RANGE,
  WANTED_STEAL, WANTED_PUNCH, WANTED_PED_HIT,
  BUSTED_CONTACT, BUSTED_FINE,
  POLICE_BASE_SPEED, POLICE_SPEED_PER_STAR, POLICE_SPAWN_DIST_MIN, POLICE_SPAWN_DIST_MAX,
  TAXI_FARE, STASH_VALUE, STASH_COUNT,
  PLAYER_START, PRECINCT_POS, MARA_POS, DINER_POS, DOCKS_POS, MOTEL_POS, HIDEOUT_POS,
  MISSIONS, GETAWAY_SECONDS,
  PICKUP_R, DROPOFF_R, STASH_R, TALK_R, PUNCH_R,
  PALETTE,
} from './config.js';
import { createRng } from './random.js';

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// --- road and collision helpers (exported for tests and the autopilot) ---

export function nearestRoadX(x) {
  return clamp(Math.round(x / ROAD_SPACING) * ROAD_SPACING, ROAD_SPACING, WORLD_W - ROAD_SPACING);
}

export function nearestRoadY(y) {
  return clamp(Math.round(y / ROAD_SPACING) * ROAD_SPACING, ROAD_SPACING, WORLD_H - ROAD_SPACING);
}

export function pointOnRoad(state, x, y) {
  for (const rx of state.roadX) {
    if (Math.abs(x - rx) <= ROAD_HALF + 1 && y >= -ROAD_HALF && y <= WORLD_H + ROAD_HALF) return true;
  }
  for (const ry of state.roadY) {
    if (Math.abs(y - ry) <= ROAD_HALF + 1 && x >= -ROAD_HALF && x <= WORLD_W + ROAD_HALF) return true;
  }
  return false;
}

// Returns the building a circle overlaps, the string 'sea' for the sea,
// or null when the spot is free.
export function buildingAt(state, x, y, r) {
  if (x - r < SEA_W) return 'sea';
  for (const b of state.buildings) {
    if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return b;
  }
  return null;
}

// Push a circle out of buildings and the sea. Returns true on a hit.
function resolveSolids(state, pos, r) {
  let hit = false;
  if (pos.x - r < SEA_W) {
    pos.x = SEA_W + r;
    hit = true;
  }
  if (pos.x + r > WORLD_W) {
    pos.x = WORLD_W - r;
    hit = true;
  }
  if (pos.y - r < 0) {
    pos.y = r;
    hit = true;
  }
  if (pos.y + r > WORLD_H) {
    pos.y = WORLD_H - r;
    hit = true;
  }
  for (const b of state.buildings) {
    const nx = clamp(pos.x, b.x, b.x + b.w);
    const ny = clamp(pos.y, b.y, b.y + b.h);
    const dx = pos.x - nx;
    const dy = pos.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * r;
      pos.y = ny + (dy / d) * r;
    } else {
      // centre inside the building: push out along the smallest axis
      const pushL = pos.x - (b.x - r);
      const pushR = b.x + b.w + r - pos.x;
      const pushU = pos.y - (b.y - r);
      const pushD = b.y + b.h + r - pos.y;
      const m = Math.min(pushL, pushR, pushU, pushD);
      if (m === pushL) pos.x = b.x - r;
      else if (m === pushR) pos.x = b.x + b.w + r;
      else if (m === pushU) pos.y = b.y - r;
      else pos.y = b.y + b.h + r;
    }
  }
  return hit;
}

// --- city generation ---

function buildCity(state) {
  const rng = state.rng;
  state.roadX = [];
  for (let x = ROAD_SPACING; x < WORLD_W; x += ROAD_SPACING) state.roadX.push(x);
  state.roadY = [];
  for (let y = ROAD_SPACING; y < WORLD_H; y += ROAD_SPACING) state.roadY.push(y);
  state.sea = { x: 0, y: 0, w: SEA_W, h: WORLD_H };
  state.beach = { x: SEA_W, y: 0, w: BEACH_W, h: WORLD_H };

  state.buildings = [];
  state.parks = [];
  for (let i = 0; i < state.roadX.length - 1; i++) {
    for (let j = 0; j < state.roadY.length - 1; j++) {
      const bx = state.roadX[i] + ROAD_HALF;
      const by = state.roadY[j] + ROAD_HALF;
      const bw = ROAD_SPACING - ROAD_W;
      const bh = ROAD_SPACING - ROAD_W;
      if (rng.chance(0.25)) {
        const trees = [];
        const n = rng.int(5, 9);
        for (let t = 0; t < n; t++) {
          trees.push({ x: bx + rng.range(20, bw - 20), y: by + rng.range(20, bh - 20), r: rng.range(10, 16) });
        }
        state.parks.push({ x: bx, y: by, w: bw, h: bh, trees });
        continue;
      }
      const two = rng.chance(0.4);
      const spots = two
        ? [
            { x0: bx + 56, x1: bx + bw / 2 - 8, y0: by + 56, y1: by + bh - 56 },
            { x0: bx + bw / 2 + 8, x1: bx + bw - 56, y0: by + 56, y1: by + bh - 56 },
          ]
        : [{ x0: bx + 56, x1: bx + bw - 56, y0: by + 56, y1: by + bh - 56 }];
      for (const s of spots) {
        const w = rng.range(70, Math.min(150, s.x1 - s.x0));
        const h = rng.range(70, Math.min(150, s.y1 - s.y0));
        const x = rng.range(s.x0, s.x1 - w);
        const y = rng.range(s.y0, s.y1 - h);
        state.buildings.push({
          x, y, w, h,
          color: rng.pick(PALETTE.building),
          roof: rng.pick(PALETTE.roof),
        });
      }
    }
  }

  // Cash stashes: hidden on walkable ground, never in a building or the sea.
  state.stashes = [];
  let guard = 0;
  while (state.stashes.length < STASH_COUNT && guard++ < 2000) {
    const x = rng.range(300, WORLD_W - 100);
    const y = rng.range(100, WORLD_H - 100);
    if (buildingAt(state, x, y, 20)) continue;
    if (pointOnRoad(state, x, y)) continue;
    if (state.stashes.some((s) => dist(s.x, s.y, x, y) < 120)) continue;
    state.stashes.push({ id: state.stashes.length, x, y, taken: false });
  }
}

function lanePos(road, dir) {
  // Right-hand traffic: eastbound rides the south lane, southbound the west.
  if (road === 'h') return dir > 0 ? LANE_OFFSET : -LANE_OFFSET;
  return dir > 0 ? -LANE_OFFSET : LANE_OFFSET;
}

function spawnParkedCars(state) {
  const rng = state.rng;
  const kinds = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sport'];
  const colors = ['#c94f42', '#4a7ac9', '#d8c84a', '#7a7a7a', '#4a9a5a', '#c98a2a', '#8a5ac9'];
  state.cars = [];
  let guard = 0;
  while (state.cars.length < PARKED_COUNT && guard++ < 500) {
    const horizontal = rng.chance(0.5);
    const roadPos = horizontal ? rng.pick(state.roadY) : rng.pick(state.roadX);
    const along = rng.range(150, (horizontal ? WORLD_W : WORLD_H) - 150);
    // Parked in a bay just off the road (68px from the centre): clear of the
    // travel lanes, so traffic never has to stop for a parked car.
    const side = rng.pick([-1, 1]) * (ROAD_HALF + 20);
    const x = horizontal ? along : roadPos + side;
    const y = horizontal ? roadPos + side : along;
    const angle = horizontal ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (dist(x, y, PLAYER_START.x, PLAYER_START.y) < 150) continue;
    if (state.cars.some((c) => dist(c.x, c.y, x, y) < 90)) continue;
    state.cars.push({
      id: state.cars.length, x, y, angle, speed: 0,
      kind: rng.pick(kinds), color: rng.pick(colors),
      parked: true, stolen: false, health: CAR_HEALTH, disabled: false,
    });
  }
}

function spawnTraffic(state) {
  const rng = state.rng;
  const colors = ['#c94f42', '#4a7ac9', '#d8c84a', '#7a7a7a', '#4a9a5a', '#c98a2a', '#8a5ac9', '#e8e8e8'];
  state.traffic = [];
  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const horizontal = rng.chance(0.5);
    const roadPos = horizontal ? rng.pick(state.roadY) : rng.pick(state.roadX);
    const along = rng.range(150, (horizontal ? WORLD_W : WORLD_H) - 150);
    const dir = rng.pick([-1, 1]);
    const off = lanePos(horizontal ? 'h' : 'v', dir);
    const angle = horizontal ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    state.traffic.push({
      id: i,
      x: horizontal ? along : roadPos + off,
      y: horizontal ? roadPos + off : along,
      angle, speed: rng.range(TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX),
      cruise: rng.range(TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX),
      road: horizontal ? 'h' : 'v', roadPos, dir,
      decided: false, color: rng.pick(colors),
      kind: rng.pick(['sedan', 'sedan', 'taxi', 'van']),
    });
  }
}

function spawnPeds(state) {
  const rng = state.rng;
  const colors = ['#e85a9a', '#5aa8e8', '#e8a23e', '#7ac95a', '#c95a5a', '#9a7ac9', '#e8e8e8', '#4a4a4a'];
  state.peds = [];
  for (let i = 0; i < PED_COUNT; i++) {
    const horizontal = rng.chance(0.5);
    const roadPos = horizontal ? rng.pick(state.roadY) : rng.pick(state.roadX);
    const along = rng.range(160, (horizontal ? WORLD_W : WORLD_H) - 160);
    const side = rng.pick([-1, 1]);
    const dir = rng.pick([-1, 1]);
    const angle = horizontal ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    state.peds.push({
      id: i,
      x: horizontal ? along : roadPos + side * SIDEWALK_OFFSET,
      y: horizontal ? roadPos + side * SIDEWALK_OFFSET : along,
      angle, speed: rng.range(PED_SPEED_MIN, PED_SPEED_MAX),
      road: horizontal ? 'h' : 'v', roadPos, dir, side,
      down: false, downTimer: 0, decided: false,
      taxi: false, inCar: false, color: rng.pick(colors),
    });
  }
}

export function createWorld(seed = 1) {
  const state = {
    seed,
    rng: createRng(seed),
    time: 0,
    width: WORLD_W,
    height: WORLD_H,
    cash: 0,
    wanted: 0,
    wantedTimer: 0,
    policeTimer: 3,
    player: {
      x: PLAYER_START.x, y: PLAYER_START.y, angle: -Math.PI / 2, speed: 0,
      onFoot: true, carId: null, health: 100,
      scrapeTimer: 0, punchTimer: 0, contactTimer: 0,
    },
    cars: [], traffic: [], peds: [], police: [],
    buildings: [], parks: [], stashes: [],
    roadX: [], roadY: [], sea: null, beach: null,
    mission: { index: 0, stage: 'pickup', timer: 0, passenger: false, mara: { ...MARA_POS, boarded: false } },
    taxi: null, taxiTimer: 4,
    busted: { active: false, timer: 0 },
    message: 'Welcome to Solmar Bay. Follow the yellow marker.',
    messageTimer: 6,
    events: [],
    stats: { pedHits: 0, carsStolen: 0, stashesFound: 0, faresDone: 0 },
  };
  buildCity(state);
  spawnParkedCars(state);
  spawnTraffic(state);
  spawnPeds(state);
  return state;
}

// --- per-step updates ---

function setMessage(state, text, seconds = 4) {
  state.message = text;
  state.messageTimer = seconds;
}

function playerCar(state) {
  if (state.player.onFoot || state.player.carId === null) return null;
  return state.cars.find((c) => c.id === state.player.carId) || null;
}

function stepPlayerFoot(state, input, dt) {
  const p = state.player;
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    const speed = input.run ? PLAYER_RUN : PLAYER_WALK;
    p.x += dx * speed * dt;
    p.y += dy * speed * dt;
    p.angle = Math.atan2(dy, dx);
    p.speed = speed;
  } else {
    p.speed = 0;
  }
  resolveSolids(state, p, PLAYER_R);
  p.punchTimer = Math.max(0, p.punchTimer - dt);
  if (input.action && p.punchTimer <= 0) {
    p.punchTimer = 0.35;
    let best = null;
    let bestD = PUNCH_R;
    for (const ped of state.peds) {
      if (ped.down || ped.inCar) continue;
      const d = dist(p.x, p.y, ped.x, ped.y);
      if (d < bestD) {
        best = ped;
        bestD = d;
      }
    }
    if (best) {
      best.down = true;
      best.downTimer = 3;
      state.wanted = Math.min(WANTED_MAX, state.wanted + WANTED_PUNCH);
      state.events.push('punch');
      setMessage(state, 'You decked a pedestrian. The cops noticed.');
    }
  }
  if (input.enter) {
    let best = null;
    let bestD = 60;
    for (const car of state.cars) {
      if (!car.parked) continue;
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < bestD) {
        best = car;
        bestD = d;
      }
    }
    if (best) enterCar(state, best);
  }
}

function enterCar(state, car) {
  const p = state.player;
  p.onFoot = false;
  p.carId = car.id;
  p.speed = 0;
  car.parked = false;
  car.speed = 0;
  if (!car.stolen) {
    car.stolen = true;
    state.wanted = Math.min(WANTED_MAX, state.wanted + WANTED_STEAL);
    state.stats.carsStolen++;
    state.events.push('steal');
    setMessage(state, 'You stole a car! Wanted level up.');
  }
}

function exitCar(state) {
  const p = state.player;
  const car = playerCar(state);
  if (!car) {
    p.onFoot = true;
    p.carId = null;
    return;
  }
  // Step out to the side of the car; try four offsets, take the first free one.
  const offsets = [
    [0, 34], [0, -34], [34, 0], [-34, 0],
  ];
  const sin = Math.sin(car.angle);
  const cos = Math.cos(car.angle);
  let placed = false;
  for (const [a, b] of offsets) {
    const x = car.x + -sin * a + cos * b;
    const y = car.y + cos * a + sin * b;
    if (!buildingAt(state, x, y, PLAYER_R)) {
      p.x = x;
      p.y = y;
      placed = true;
      break;
    }
  }
  if (!placed) {
    p.x = car.x;
    p.y = car.y;
  }
  p.onFoot = true;
  p.carId = null;
  p.speed = 0;
  car.parked = true;
  car.speed = 0;
}

function stepPlayerCar(state, input, dt) {
  const p = state.player;
  const car = playerCar(state);
  if (!car) {
    p.onFoot = true;
    p.carId = null;
    return;
  }
  if (input.enter) {
    exitCar(state);
    return;
  }
  car.scrapeTimer = Math.max(0, (car.scrapeTimer || 0) - dt);
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (!car.disabled) {
    if (input.up) car.speed += CAR_ACCEL * dt;
    if (input.down) {
      if (car.speed > 10) car.speed -= CAR_BRAKE * dt;
      else car.speed -= CAR_ACCEL * 0.6 * dt;
    }
  }
  car.speed -= car.speed * CAR_DRAG * dt;
  car.speed = clamp(car.speed, -CAR_REVERSE_MAX, CAR_MAX_SPEED);
  if (car.disabled) car.speed = clamp(car.speed, 0, 0);
  const speedFactor = clamp(Math.abs(car.speed) / 150, 0, 1);
  car.angle += steer * CAR_TURN * speedFactor * dt * (car.speed < 0 ? -1 : 1);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  p.x = car.x;
  p.y = car.y;
  p.angle = car.angle;
  p.speed = Math.abs(car.speed);

  // Buildings and the sea: push out, scrape paint and health.
  const before = { x: car.x, y: car.y };
  if (resolveSolids(state, car, CAR_R)) {
    const moved = dist(before.x, before.y, car.x, car.y);
    if (moved > 0.5) car.speed *= 0.4;
    if ((car.scrapeTimer || 0) <= 0 && Math.abs(car.speed) > 40) {
      car.health -= SCRAPE_DAMAGE;
      car.scrapeTimer = SCRAPE_COOLDOWN;
      state.events.push('scrape');
      if (car.health <= 0 && !car.disabled) {
        car.disabled = true;
        car.health = 0;
        setMessage(state, 'Your car is wrecked — get out and find another.');
      }
    }
  }
  // Other cars: soft push-apart, no damage.
  for (const other of [...state.traffic, ...state.cars]) {
    if (other === car || (other.parked && other.id === car.id)) continue;
    const d = dist(car.x, car.y, other.x, other.y);
    if (d < CAR_R * 2 && d > 0.01) {
      const push = (CAR_R * 2 - d) / 2;
      const nx = (car.x - other.x) / d;
      const ny = (car.y - other.y) / d;
      car.x += nx * push;
      car.y += ny * push;
      if (other.speed !== undefined && !other.parked) {
        other.x -= nx * push;
        other.y -= ny * push;
      }
      car.speed *= 0.7;
      if (other.speed !== undefined) other.speed *= 0.8;
    }
  }
  // Pedestrians: hitting one is +2 wanted.
  for (const ped of state.peds) {
    if (ped.down || ped.inCar) continue;
    if (dist(car.x, car.y, ped.x, ped.y) < CAR_R + 10) {
      ped.down = true;
      ped.downTimer = 4;
      state.wanted = Math.min(WANTED_MAX, state.wanted + WANTED_PED_HIT);
      state.stats.pedHits++;
      state.events.push('pedhit');
      setMessage(state, 'You hit a pedestrian! Wanted level up.');
    }
  }
}

function obstacleAhead(state, x, y, angle, range) {
  const ax = x + Math.cos(angle) * range;
  const ay = y + Math.sin(angle) * range;
  for (const t of state.traffic) {
    if (dist(ax, ay, t.x, t.y) < 26) return true;
  }
  for (const c of state.cars) {
    if (!c.parked) continue;
    if (!pointOnRoad(state, c.x, c.y)) continue; // parked off the road, in a bay
    if (dist(ax, ay, c.x, c.y) < 26) return true;
  }
  const pc = playerCar(state);
  if (pc && dist(ax, ay, pc.x, pc.y) < 26) return true;
  for (const ped of state.peds) {
    if (ped.down || ped.inCar) continue;
    if (dist(ax, ay, ped.x, ped.y) < 22) return true;
  }
  return false;
}

function stepTraffic(state, dt) {
  const rng = state.rng;
  for (const t of state.traffic) {
    // Decide once per intersection whether to turn.
    const ix = nearestRoadX(t.x);
    const iy = nearestRoadY(t.y);
    const nearCenter = Math.abs(t.x - ix) < 40 && Math.abs(t.y - iy) < 40;
    if (nearCenter && !t.decided) {
      t.decided = true;
      if (rng.chance(0.25)) {
        const turn = rng.pick([-1, 1]);
        const fromH = t.road === 'h';
        let newAngle = t.angle + (turn * Math.PI) / 2;
        if (newAngle > Math.PI) newAngle -= Math.PI * 2;
        if (newAngle < -Math.PI) newAngle += Math.PI * 2;
        t.road = fromH ? 'v' : 'h';
        t.roadPos = fromH ? ix : iy;
        t.dir = Math.abs(Math.cos(newAngle)) > 0.5
          ? (Math.cos(newAngle) > 0 ? 1 : -1)
          : (Math.sin(newAngle) > 0 ? 1 : -1);
        // Snap onto the new lane at the intersection.
        const off = lanePos(t.road, t.dir);
        if (t.road === 'h') t.y = t.roadPos + off;
        else t.x = t.roadPos + off;
        t.angle = newAngle;
      }
    } else if (!nearCenter) {
      t.decided = false;
    }
    // Brake for anything ahead, else cruise.
    const blocked = obstacleAhead(state, t.x, t.y, t.angle, 70);
    const target = blocked ? 0 : t.cruise;
    t.speed += clamp(target - t.speed, -260 * dt, 160 * dt);
    t.x += Math.cos(t.angle) * t.speed * dt;
    t.y += Math.sin(t.angle) * t.speed * dt;
    // Turn around at the city edge instead of driving into the sea.
    if (t.road === 'h' && (t.x < 150 || t.x > WORLD_W - 150)) {
      t.angle += Math.PI;
      t.dir *= -1;
      t.y = t.roadPos + lanePos('h', t.dir);
    }
    if (t.road === 'v' && (t.y < 150 || t.y > WORLD_H - 150)) {
      t.angle += Math.PI;
      t.dir *= -1;
      t.x = t.roadPos + lanePos('v', t.dir);
    }
  }
}

function randomSidewalkPoint(state) {
  const rng = state.rng;
  const horizontal = rng.chance(0.5);
  const roadPos = horizontal ? rng.pick(state.roadY) : rng.pick(state.roadX);
  const along = rng.range(160, (horizontal ? WORLD_W : WORLD_H) - 160);
  const side = rng.pick([-1, 1]);
  return {
    x: horizontal ? along : roadPos + side * SIDEWALK_OFFSET,
    y: horizontal ? roadPos + side * SIDEWALK_OFFSET : along,
  };
}

function stepPeds(state, dt) {
  const rng = state.rng;
  for (const ped of state.peds) {
    if (ped.down) {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        const spot = randomSidewalkPoint(state);
        ped.x = spot.x;
        ped.y = spot.y;
        ped.down = false;
      }
      continue;
    }
    if (ped.inCar) continue; // riding with the player
    const ix = nearestRoadX(ped.x);
    const iy = nearestRoadY(ped.y);
    const nearCenter = Math.abs(ped.x - ix) < 35 && Math.abs(ped.y - iy) < 35;
    if (nearCenter && !ped.decided) {
      ped.decided = true;
      if (rng.chance(0.3)) {
        const turn = rng.pick([-1, 1]);
        const fromH = ped.road === 'h';
        const newAngle = ped.angle + (turn * Math.PI) / 2;
        ped.road = fromH ? 'v' : 'h';
        ped.roadPos = fromH ? ix : iy;
        ped.dir = Math.abs(Math.sin(newAngle)) > 0.5
          ? (Math.sin(newAngle) > 0 ? 1 : -1)
          : (Math.cos(newAngle) > 0 ? 1 : -1);
        const side = rng.pick([-1, 1]);
        ped.side = side;
        if (ped.road === 'h') ped.y = ped.roadPos + side * SIDEWALK_OFFSET;
        else ped.x = ped.roadPos + side * SIDEWALK_OFFSET;
        ped.angle = newAngle;
      }
    } else if (!nearCenter) {
      ped.decided = false;
    }
    ped.x += Math.cos(ped.angle) * ped.speed * dt;
    ped.y += Math.sin(ped.angle) * ped.speed * dt;
    if (ped.road === 'h' && (ped.x < 150 || ped.x > WORLD_W - 150)) {
      ped.angle += Math.PI;
      ped.dir *= -1;
    }
    if (ped.road === 'v' && (ped.y < 150 || ped.y > WORLD_H - 150)) {
      ped.angle += Math.PI;
      ped.dir *= -1;
    }
    ped.x = clamp(ped.x, 130, WORLD_W - 10);
    ped.y = clamp(ped.y, 30, WORLD_H - 10);
  }
}

function triggerBusted(state) {
  const p = state.player;
  state.busted.active = true;
  state.busted.timer = 2.5;
  state.cash = Math.max(0, state.cash - BUSTED_FINE);
  state.wanted = 0;
  state.wantedTimer = 0;
  state.police = [];
  p.contactTimer = 0;
  if (!p.onFoot) {
    const car = playerCar(state);
    if (car) {
      car.parked = true;
      car.speed = 0;
    }
    p.onFoot = true;
    p.carId = null;
  }
  p.x = PRECINCT_POS.x;
  p.y = PRECINCT_POS.y;
  p.speed = 0;
  // The current mission restarts from its beginning.
  const idx = state.mission.index;
  if (idx < 3) startMission(state, idx, true);
  state.events.push('busted');
  setMessage(state, `BUSTED! The cops took $${BUSTED_FINE}.`, 5);
}

function stepPolice(state, dt) {
  const p = state.player;
  const needed = state.wanted > 0 ? Math.min(state.wanted + 1, 4) : 0;
  if (needed === 0) {
    state.police = [];
    return;
  }
  if (state.police.length < needed) {
    state.policeTimer -= dt;
    if (state.policeTimer <= 0) {
      state.policeTimer = 4;
      // Spawn on a road 700-900px from the player.
      let placed = false;
      for (let tries = 0; tries < 12 && !placed; tries++) {
        const a = state.rng.range(0, Math.PI * 2);
        const d = state.rng.range(POLICE_SPAWN_DIST_MIN, POLICE_SPAWN_DIST_MAX);
        const x = clamp(p.x + Math.cos(a) * d, 200, WORLD_W - 100);
        const y = clamp(p.y + Math.sin(a) * d, 100, WORLD_H - 100);
        const rx = nearestRoadX(x);
        const ry = nearestRoadY(y);
        const px = Math.abs(x - rx) < Math.abs(y - ry) ? rx : x;
        const py = Math.abs(x - rx) < Math.abs(y - ry) ? y : ry;
        if (dist(px, py, p.x, p.y) < 500) continue;
        state.police.push({ id: state.police.length, x: px, y: py, angle: 0, speed: 0 });
        placed = true;
      }
    }
  }
  let nearest = Infinity;
  for (const cop of state.police) {
    const d = dist(cop.x, cop.y, p.x, p.y);
    nearest = Math.min(nearest, d);
    const want = angleTo(cop.x, cop.y, p.x, p.y);
    const turn = clamp(angleDiff(cop.angle, want), -1, 1) * 3 * dt;
    cop.angle += turn;
    if (!p.onFoot && d < 70) {
      cop.speed = 0; // trail the car, never ram it
    } else if (p.onFoot && d < 40) {
      cop.speed = 0; // has the player cornered
    } else {
      cop.speed = POLICE_BASE_SPEED + state.wanted * POLICE_SPEED_PER_STAR;
    }
    cop.x += Math.cos(cop.angle) * cop.speed * dt;
    cop.y += Math.sin(cop.angle) * cop.speed * dt;
    cop.x = clamp(cop.x, SEA_W + 10, WORLD_W - 10);
    cop.y = clamp(cop.y, 10, WORLD_H - 10);
  }
  if (p.onFoot) {
    if (nearest < 48) {
      p.contactTimer += dt;
      if (p.contactTimer >= BUSTED_CONTACT) triggerBusted(state);
    } else {
      p.contactTimer = Math.max(0, p.contactTimer - dt * 2);
    }
  } else {
    p.contactTimer = 0;
  }
}

// --- missions, taxi, stashes ---

export function startMission(state, index, keepWanted = false) {
  const m = state.mission;
  m.index = index;
  m.passenger = false;
  m.mara = { ...MARA_POS, boarded: false };
  if (index === 0) {
    m.stage = 'pickup';
    m.timer = 0;
    setMessage(state, MISSIONS[0].intro, 6);
  } else if (index === 1) {
    m.stage = 'package';
    m.timer = 0;
    setMessage(state, MISSIONS[1].intro, 6);
  } else if (index === 2) {
    m.stage = 'escape';
    m.timer = GETAWAY_SECONDS;
    if (!keepWanted) state.wanted = Math.max(state.wanted, 2);
    setMessage(state, MISSIONS[2].intro, 6);
  } else {
    m.stage = 'roam';
    m.timer = 0;
    state.taxi = null;
    state.taxiTimer = 3;
    setMessage(state, 'Free roam. Taxi fares pay $50, hidden stashes hide $25.', 6);
  }
  state.events.push('mission');
}

function stepMissions(state, dt) {
  const m = state.mission;
  const p = state.player;
  const car = playerCar(state);
  const px = p.x;
  const py = p.y;

  if (m.index === 0 && m.stage === 'pickup') {
    if (!p.onFoot && car && dist(car.x, car.y, MARA_POS.x, MARA_POS.y) < PICKUP_R) {
      m.passenger = true;
      m.mara.boarded = true;
      m.stage = 'dropoff';
      state.events.push('pickup');
      setMessage(state, "Mara's in. Take her to the Sunset Diner.");
    } else if (p.onFoot && dist(px, py, MARA_POS.x, MARA_POS.y) < PICKUP_R && state.messageTimer <= 0) {
      setMessage(state, 'Mara needs a ride — bring a car.', 3);
    }
  } else if (m.index === 0 && m.stage === 'dropoff') {
    if (dist(px, py, DINER_POS.x, DINER_POS.y) < DROPOFF_R) {
      state.cash += MISSIONS[0].pay;
      state.events.push('mission');
      setMessage(state, `Mission complete! +$${MISSIONS[0].pay}.`, 5);
      startMission(state, 1);
    }
  } else if (m.index === 1 && m.stage === 'package') {
    if (dist(px, py, DOCKS_POS.x, DOCKS_POS.y) < TALK_R) {
      m.stage = 'deliver';
      state.wanted = Math.max(state.wanted, 1);
      state.events.push('pickup');
      setMessage(state, 'Package grabbed. The cops are onto you — run it to the Starlite Motel.');
    }
  } else if (m.index === 1 && m.stage === 'deliver') {
    if (dist(px, py, MOTEL_POS.x, MOTEL_POS.y) < DROPOFF_R) {
      state.cash += MISSIONS[1].pay;
      state.events.push('mission');
      setMessage(state, `Mission complete! +$${MISSIONS[1].pay}.`, 5);
      startMission(state, 2);
    }
  } else if (m.index === 2 && m.stage === 'escape') {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.timer = GETAWAY_SECONDS;
      setMessage(state, 'You lost them in the streets — the clock resets. Try again!', 4);
    } else if (dist(px, py, HIDEOUT_POS.x, HIDEOUT_POS.y) < DROPOFF_R) {
      state.cash += MISSIONS[2].pay;
      state.events.push('mission');
      setMessage(state, `You made it! +$${MISSIONS[2].pay}. Solmar Bay is yours now.`, 6);
      startMission(state, 3);
    }
  }
}

function stepTaxi(state, dt) {
  if (state.mission.index !== 3) return;
  const p = state.player;
  const car = playerCar(state);
  if (!state.taxi) {
    state.taxiTimer -= dt;
    if (state.taxiTimer <= 0) {
      const candidates = state.peds.filter((ped) => !ped.down && !ped.inCar && !ped.taxi);
      if (candidates.length > 0) {
        const fare = state.rng.pick(candidates);
        fare.taxi = true;
        const ix = state.rng.pick(state.roadX);
        const iy = state.rng.pick(state.roadY);
        state.taxi = {
          stage: 'wait', pedId: fare.id,
          destX: ix + 64, destY: iy + 64,
        };
        setMessage(state, 'Taxi fare waiting — pick them up.', 4);
      } else {
        state.taxiTimer = 3;
      }
    }
    return;
  }
  const fare = state.peds.find((ped) => ped.id === state.taxi.pedId);
  if (!fare) {
    state.taxi = null;
    state.taxiTimer = 3;
    return;
  }
  if (state.taxi.stage === 'wait') {
    if (!p.onFoot && car && dist(car.x, car.y, fare.x, fare.y) < PICKUP_R) {
      state.taxi.stage = 'ride';
      fare.inCar = true;
      state.events.push('pickup');
      setMessage(state, 'Fare aboard — take them to the marker.');
    }
  } else if (state.taxi.stage === 'ride') {
    if (dist(p.x, p.y, state.taxi.destX, state.taxi.destY) < DROPOFF_R) {
      state.cash += TAXI_FARE;
      state.stats.faresDone++;
      state.events.push('mission');
      setMessage(state, `Fare delivered! +$${TAXI_FARE}.`, 4);
      const spot = randomSidewalkPoint(state);
      fare.x = spot.x;
      fare.y = spot.y;
      fare.inCar = false;
      fare.taxi = false;
      state.taxi = null;
      state.taxiTimer = 5;
    }
  }
}

function stepStashes(state) {
  const p = state.player;
  for (const s of state.stashes) {
    if (s.taken) continue;
    if (dist(p.x, p.y, s.x, s.y) < STASH_R) {
      s.taken = true;
      state.cash += STASH_VALUE;
      state.stats.stashesFound++;
      state.events.push('pickup');
      setMessage(state, `Hidden stash found! +$${STASH_VALUE}.`);
    }
  }
}

// --- the main step ---

export function stepWorld(state, input, dt) {
  state.events = [];
  if (state.busted.active) {
    state.busted.timer -= dt;
    if (state.busted.timer <= 0) state.busted.active = false;
    return;
  }
  state.time += dt;
  if (state.player.onFoot) stepPlayerFoot(state, input, dt);
  else stepPlayerCar(state, input, dt);
  stepTraffic(state, dt);
  stepPeds(state, dt);
  stepPolice(state, dt);

  // Wanted decays after 18s with no police nearby.
  if (state.wanted > 0) {
    const p = state.player;
    const near = state.police.some((cop) => dist(cop.x, cop.y, p.x, p.y) < WANTED_DECAY_RANGE);
    if (!near) {
      state.wantedTimer += dt;
      if (state.wantedTimer >= WANTED_DECAY_SECONDS) {
        state.wanted--;
        state.wantedTimer = 0;
      }
    } else {
      state.wantedTimer = 0;
    }
  } else {
    state.wantedTimer = 0;
  }

  stepMissions(state, dt);
  stepTaxi(state, dt);
  stepStashes(state);
  if (state.messageTimer > 0) {
    state.messageTimer -= dt;
    if (state.messageTimer <= 0) state.message = '';
  }
  state.player.speed = Math.abs(state.player.speed || 0);
}

// --- objectives, save, load ---

export function objectiveOf(state) {
  const m = state.mission;
  const p = state.player;
  let target;
  if (m.index === 0 && m.stage === 'pickup') {
    target = { label: 'Pick up Mara — bring a car', x: MARA_POS.x, y: MARA_POS.y };
  } else if (m.index === 0) {
    target = { label: 'Take Mara to the Sunset Diner', x: DINER_POS.x, y: DINER_POS.y };
  } else if (m.index === 1 && m.stage === 'package') {
    target = { label: 'Collect the package at the docks', x: DOCKS_POS.x, y: DOCKS_POS.y };
  } else if (m.index === 1) {
    target = { label: 'Deliver to the Starlite Motel', x: MOTEL_POS.x, y: MOTEL_POS.y };
  } else if (m.index === 2) {
    target = { label: `Reach the hideout — ${Math.max(0, Math.ceil(m.timer))}s left`, x: HIDEOUT_POS.x, y: HIDEOUT_POS.y };
  } else if (state.taxi && state.taxi.stage === 'wait') {
    const fare = state.peds.find((ped) => ped.id === state.taxi.pedId);
    target = fare
      ? { label: 'Pick up the taxi fare', x: fare.x, y: fare.y }
      : { label: 'Free roam — find a fare or a stash', x: p.x, y: p.y };
  } else if (state.taxi && state.taxi.stage === 'ride') {
    target = { label: 'Drop the fare off', x: state.taxi.destX, y: state.taxi.destY };
  } else {
    const open = state.stashes.filter((s) => !s.taken);
    if (open.length > 0) {
      let best = open[0];
      let bestD = dist(p.x, p.y, best.x, best.y);
      for (const s of open) {
        const d = dist(p.x, p.y, s.x, s.y);
        if (d < bestD) {
          best = s;
          bestD = d;
        }
      }
      target = { label: 'Free roam — find a hidden stash', x: best.x, y: best.y };
    } else {
      target = { label: 'Free roam — Solmar Bay is yours', x: p.x, y: p.y };
    }
  }
  return { ...target, dist: dist(p.x, p.y, target.x, target.y) };
}

export function saveGame(state) {
  return JSON.stringify({
    v: 1,
    cash: state.cash,
    wanted: state.wanted,
    mission: { index: state.mission.index, stage: state.mission.stage },
    stashes: state.stashes.filter((s) => s.taken).map((s) => s.id),
    player: { x: Math.round(state.player.x), y: Math.round(state.player.y) },
    time: Math.round(state.time),
  });
}

export function loadGame(state, data) {
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return false;
  }
  if (!parsed || parsed.v !== 1) return false;
  if (typeof parsed.cash !== 'number' || !Number.isFinite(parsed.cash)) return false;
  if (typeof parsed.player !== 'object' || !parsed.player) return false;
  if (typeof parsed.player.x !== 'number' || typeof parsed.player.y !== 'number') return false;
  if (!parsed.mission || typeof parsed.mission.index !== 'number') return false;
  state.cash = parsed.cash;
  state.wanted = typeof parsed.wanted === 'number' ? parsed.wanted : 0;
  startMission(state, Math.min(3, Math.max(0, parsed.mission.index | 0)));
  if (Array.isArray(parsed.stashes)) {
    for (const id of parsed.stashes) {
      const s = state.stashes.find((st) => st.id === id);
      if (s) s.taken = true;
    }
  }
  state.player.x = parsed.player.x;
  state.player.y = parsed.player.y;
  state.time = typeof parsed.time === 'number' ? parsed.time : 0;
  return true;
}

export { KMH };
