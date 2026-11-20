// Solmar Bay — the world: a seeded city, its traffic, pedestrians and
// police, the player on foot and in a car, collisions, the mission state
// machine, wanted level and save. No drawing and no browser in here: the
// renderer paints what this module returns, and stepWorld advances it one
// fixed step. The simulation never calls Math.random — every random choice
// comes from the seeded generator, so a seed replays the same city.
import {
  BEACH_W, BLOCK, BUSTED_CONTACT_SECONDS, BUSTED_FINE, CAR_ACCEL, CAR_BRAKE,
  CAR_MAX_SPEED, CAR_R, CAR_REVERSE_MAX, CAR_TURN, CAR_WID, HORIZONTAL_ROADS,
  MISSIONS, PALETTE, PARKED_COUNT, PED_COUNT, PLAYER_R, PLAYER_START,
  POLICE_STATION, RUN_SPEED, SAVE_KEY, SEA_W, STASH_COUNT, STASH_VALUE,
  START_CASH, TAXI_FARE, TRAFFIC_COUNT, VERTICAL_ROADS, WALK_SPEED,
  WANTED_DECAY_SECONDS, WANTED_MAX, WANTED_QUIET_RADIUS, WORLD_H, WORLD_W,
} from './config.js';
import { pick, range } from './random.js';

export const KIND_PARKED = 'parked';
export const KIND_TRAFFIC = 'traffic';
export const KIND_POLICE = 'police';
export const KIND_PLAYER = 'player';
export const KIND_WRECK = 'wreck';

// Landmark blocks, named so the renderer can label them and the missions
// can point at them: each is the [x-cell, y-cell] of a road-grid block.
const POI = {
  diner: { cell: [5, 3], label: 'SUNSET DINER' },
  motel: { cell: [7, 1], label: 'STARLITE MOTEL' },
  hideout: { cell: [2, 4], label: 'HIDEOUT' },
  police: { cell: [3, 0], label: 'POLICE' },
};

const TRAFFIC_COLORS = ['#d94f3d', '#3d7dd9', '#e8c33d', '#7d3dd9', '#e8e8e8', '#3d9e6a', '#d97d3d'];
const PED_COLORS = ['#e8e8e8', '#3d7dd9', '#d94f3d', '#e8c33d', '#7d3dd9', '#3d9e6a'];
const TAXI_COLOR = '#f2c230';

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Smallest signed turn from angle `from` to angle `to`, in (-PI, PI].
export function angleDiff(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  return diff;
}

function isOnRoad(x, y) {
  for (const vx of VERTICAL_ROADS) if (Math.abs(x - vx) <= 36) return true;
  for (const hy of HORIZONTAL_ROADS) if (Math.abs(y - hy) <= 36) return true;
  return false;
}

// The nearest intersection to a point.
function nearestIntersection(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const vx of VERTICAL_ROADS) {
    for (const hy of HORIZONTAL_ROADS) {
      const d = distance(x, y, vx, hy);
      if (d < bestD) {
        bestD = d;
        best = { x: vx, y: hy };
      }
    }
  }
  return best;
}

// Push a circle out of every building it overlaps. Returns true on a hit.
function resolveBuildings(obj, radius, buildings) {
  let hit = false;
  for (const b of buildings) {
    const nearX = clamp(obj.x, b.x, b.x + b.w);
    const nearY = clamp(obj.y, b.y, b.y + b.h);
    const dx = obj.x - nearX;
    const dy = obj.y - nearY;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 0.01) {
      const d = Math.sqrt(d2);
      obj.x = nearX + (dx / d) * radius;
      obj.y = nearY + (dy / d) * radius;
    } else {
      // Centre inside the block: shove out along the shallowest side.
      const left = obj.x - b.x;
      const right = b.x + b.w - obj.x;
      const top = obj.y - b.y;
      const bottom = b.y + b.h - obj.y;
      const min = Math.min(left, right, top, bottom);
      if (min === left) obj.x = b.x - radius;
      else if (min === right) obj.x = b.x + b.w + radius;
      else if (min === top) obj.y = b.y - radius;
      else obj.y = b.y + b.h + radius;
    }
  }
  return hit;
}

// Two cars overlap if either car's centre lies in the other's oriented box
// (40 px long, 20 px wide): a circle cannot fit a 46 x 24 car, and a circle
// big enough for its length swallows the next lane and the parked cars on
// the shoulder.
function pointInCarBox(car, x, y) {
  const dx = x - car.x;
  const dy = y - car.y;
  const c = Math.cos(-car.angle);
  const s = Math.sin(-car.angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) < 40 && Math.abs(ly) < 20;
}

function carsOverlap(a, b) {
  return pointInCarBox(a, b.x, b.y) || pointInCarBox(b, a.x, a.y);
}
function sidewalkPoint(random) {
  if (random() < 0.5) {
    const vx = pick(random, VERTICAL_ROADS);
    const side = random() < 0.5 ? -52 : 52;
    return { x: clamp(vx + side, SEA_W + BEACH_W + 20, WORLD_W - 20), y: range(random, 80, WORLD_H - 80) };
  }
  const hy = pick(random, HORIZONTAL_ROADS);
  const side = random() < 0.5 ? -52 : 52;
  return { x: range(random, SEA_W + BEACH_W + 20, WORLD_W - 20), y: clamp(hy + side, 80, WORLD_H - 80) };
}

// The right-hand lane offset for driving from A to B: +18 on the side the
// driver's right hand falls on.
function laneOffset(from, to) {
  if (from.y === to.y) return { x: 0, y: to.x > from.x ? 18 : -18 };
  return { x: to.y > from.y ? -18 : 18, y: 0 };
}

// Breadth-first route across the intersection grid, from the intersection
// nearest (fx, fy) to the one nearest (tx, ty), then the target itself.
// With a heading, the start is the nearest intersection ahead of the car
// instead of the nearest one outright: a route that begins behind the car
// would ask for a U-turn, and the driver goes around the block instead.
export function findRoute(fx, fy, tx, ty, heading) {
  let start = nearestIntersection(fx, fy);
  if (heading !== undefined) {
    const hx = Math.cos(heading);
    const hy = Math.sin(heading);
    let bestAhead = null;
    let bestAheadD = Infinity;
    for (const vx of VERTICAL_ROADS) {
      for (const hy2 of HORIZONTAL_ROADS) {
        const dx = vx - fx;
        const dy = hy2 - fy;
        const d = Math.hypot(dx, dy);
        if (d < 1) continue;
        if ((dx * hx + dy * hy) / d > 0.05 && d < bestAheadD) {
          bestAheadD = d;
          bestAhead = { x: vx, y: hy2 };
        }
      }
    }
    if (bestAhead) start = bestAhead;
  }
  const goal = nearestIntersection(tx, ty);
  const key = (p) => `${p.x},${p.y}`;
  const prev = new Map([[key(start), null]]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.x === goal.x && cur.y === goal.y) break;
    const neighbours = [];
    const vi = VERTICAL_ROADS.indexOf(cur.x);
    const hi = HORIZONTAL_ROADS.indexOf(cur.y);
    if (vi > 0) neighbours.push({ x: VERTICAL_ROADS[vi - 1], y: cur.y });
    if (vi < VERTICAL_ROADS.length - 1) neighbours.push({ x: VERTICAL_ROADS[vi + 1], y: cur.y });
    if (hi > 0) neighbours.push({ x: cur.x, y: HORIZONTAL_ROADS[hi - 1] });
    if (hi < HORIZONTAL_ROADS.length - 1) neighbours.push({ x: cur.x, y: HORIZONTAL_ROADS[hi + 1] });
    for (const next of neighbours) {
      if (!prev.has(key(next))) {
        prev.set(key(next), cur);
        queue.push(next);
      }
    }
  }
  const points = [];
  let cur = goal;
  while (cur) {
    points.unshift(cur);
    cur = prev.get(key(cur));
  }
  if (points.length === 0) points.push(start);
  points.push({ x: tx, y: ty });
  return points;
}

export function createWorld(random) {
  const buildings = [];
  const parks = [];
  const xCuts = [SEA_W + BEACH_W, ...VERTICAL_ROADS, WORLD_W];
  const yCuts = [0, ...HORIZONTAL_ROADS, WORLD_H];

  for (let i = 0; i < xCuts.length - 1; i += 1) {
    for (let j = 0; j < yCuts.length - 1; j += 1) {
      const bx0 = xCuts[i] + 36;
      const bx1 = xCuts[i + 1] - 36;
      const by0 = yCuts[j] + 36;
      const by1 = yCuts[j + 1] - 36;
      const bw = bx1 - bx0;
      const bh = by1 - by0;
      if (bw < 200 || bh < 200) {
        parks.push({ x: bx0, y: by0, w: bw, h: bh, trees: [] });
        continue;
      }
      // Landmark blocks always hold one labelled building.
      let label = null;
      for (const poi of Object.values(POI)) {
        if (poi.cell[0] === i && poi.cell[1] === j) label = poi.label;
      }
      if (label) {
        const w = range(random, 150, 190);
        const h = range(random, 130, 170);
        buildings.push({
          x: bx0 + 56 + (bw - 112 - w) / 2,
          y: by0 + 56 + (bh - 112 - h) / 2,
          w, h, color: pick(random, PALETTE.building), label,
        });
        continue;
      }
      if (random() < 0.2) {
        const trees = [];
        const count = 3 + Math.floor(random() * 4);
        for (let t = 0; t < count; t += 1) {
          trees.push({ x: range(random, bx0 + 30, bx1 - 30), y: range(random, by0 + 30, by1 - 30), r: range(random, 12, 20) });
        }
        parks.push({ x: bx0, y: by0, w: bw, h: bh, trees });
        continue;
      }
      if (random() < 0.3) {
        // Two buildings side by side.
        for (let k = 0; k < 2; k += 1) {
          const w = range(random, 80, 95);
          const h = range(random, 120, 190);
          buildings.push({
            x: bx0 + 56 + k * ((bw - 112) / 2) + ((bw - 112) / 2 - w) / 2,
            y: by0 + 56 + (bh - 112 - h) / 2,
            w, h, color: pick(random, PALETTE.building), label: null,
          });
        }
      } else {
        const w = range(random, 130, 200);
        const h = range(random, 120, 190);
        buildings.push({
          x: bx0 + 56 + (bw - 112 - w) / 2,
          y: by0 + 56 + (bh - 112 - h) / 2,
          w, h, color: pick(random, PALETTE.building), label: null,
        });
      }
    }
  }

  const stashes = [];
  for (let i = 0; i < STASH_COUNT; i += 1) {
    const p = sidewalkPoint(random);
    stashes.push({ id: i, x: p.x, y: p.y, taken: false });
  }

  const cars = [];
  let nextCarId = 1;
  // One sedan is always parked outside the player's apartment, south of the
  // 12th St crossing: the first car any new player steals.
  cars.push({
    id: nextCarId, kind: KIND_PARKED,
    x: 700, y: 1246, angle: 0, speed: 0, color: '#d94f3d', health: 100,
    cruise: 0, route: null, wp: 0, stuck: 0, hitCooldown: 0,
  });
  nextCarId += 1;
  // The rest of the parked cars sit just off the road, 46 px from its centre
  // line, nose along the road, so traffic in the lane passes them by.
  for (let i = 1; i < PARKED_COUNT; i += 1) {
    const vertical = random() < 0.5;
    const road = vertical ? pick(random, VERTICAL_ROADS) : pick(random, HORIZONTAL_ROADS);
    const along = range(random, 500, vertical ? WORLD_H - 500 : WORLD_W - 500);
    const side = random() < 0.5 ? -46 : 46;
    const dir = random() < 0.5 ? 1 : -1;
    const angle = vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    cars.push({
      id: nextCarId, kind: KIND_PARKED,
      x: vertical ? road + side : along,
      y: vertical ? along : road + side,
      angle, speed: 0, color: pick(random, TRAFFIC_COLORS), health: 100,
      cruise: 0, route: null, wp: 0, stuck: 0, hitCooldown: 0,
    });
    nextCarId += 1;
  }

  // Traffic cars drive the grid on random walks, one intersection at a time.
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const vertical = random() < 0.5;
    const road = vertical ? pick(random, VERTICAL_ROADS) : pick(random, HORIZONTAL_ROADS);
    const dir = random() < 0.5 ? 1 : -1;
    const along = range(random, 200, vertical ? WORLD_H - 200 : WORLD_W - 200);
    const lane = vertical ? (dir > 0 ? -18 : 18) : (dir > 0 ? 18 : -18);
    const angle = vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const x = vertical ? road + lane : along;
    const y = vertical ? along : road + lane;
    const first = nearestIntersection(x, y);
    cars.push({
      id: nextCarId, kind: KIND_TRAFFIC,
      x, y, angle, speed: range(random, 120, 180),
      color: pick(random, TRAFFIC_COLORS), health: 100,
      cruise: range(random, 130, 200), route: [first], wp: 0, stuck: 0, hitCooldown: 0,
    });
    nextCarId += 1;
  }

  const peds = [];
  for (let i = 0; i < PED_COUNT; i += 1) {
    const p = sidewalkPoint(random);
    const t = sidewalkPoint(random);
    peds.push({
      x: p.x, y: p.y, angle: 0, speed: range(random, 40, 70),
      target: t, state: 'walk', downTimer: 0, fleeTimer: 0, hitCooldown: 0,
      color: pick(random, PED_COLORS),
    });
  }

  const world = {
    rng: random,
    time: 0,
    stepCount: 0,
    buildings,
    parks,
    stashes,
    cars,
    peds,
    nextCarId,
    player: {
      x: PLAYER_START.x, y: PLAYER_START.y, angle: -Math.PI / 2,
      onFoot: true, car: null, punchCooldown: 0,
    },
    rider: { kind: 'mara', x: MISSIONS[0].pickup.x, y: MISSIONS[0].pickup.y, state: 'waiting' },
    mission: { index: 0, stage: 'pickup', timer: 0, packageHeld: false },
    taxi: { state: 'idle', cooldown: 0, dest: null },
    cash: START_CASH,
    wanted: 0,
    quietTime: 0,
    bustedTimer: 0,
    banner: null,
    events: [],
  };
  return world;
}

// Where the current mission wants the player: its marker point and label.
export function currentTarget(world) {
  const { mission, rider, taxi } = world;
  if (mission.index === 0) {
    if (mission.stage === 'pickup') return { x: rider.x, y: rider.y, label: 'Mara' };
    return { x: MISSIONS[0].dropoff.x, y: MISSIONS[0].dropoff.y, label: 'Sunset Diner' };
  }
  if (mission.index === 1) {
    if (mission.stage === 'pickup') return { x: MISSIONS[1].pickup.x, y: MISSIONS[1].pickup.y, label: 'Package' };
    return { x: MISSIONS[1].dropoff.x, y: MISSIONS[1].dropoff.y, label: 'Starlite Motel' };
  }
  if (mission.index === 2) return { x: MISSIONS[2].dropoff.x, y: MISSIONS[2].dropoff.y, label: 'Hideout' };
  if (taxi.state === 'pickup' && rider) return { x: rider.x, y: rider.y, label: 'Fare' };
  if (taxi.state === 'deliver' && taxi.dest) return { x: taxi.dest.x, y: taxi.dest.y, label: 'Drop-off' };
  return null;
}

export function objectiveText(world) {
  const { mission } = world;
  if (mission.index < MISSIONS.length) {
    const m = MISSIONS[mission.index];
    if (mission.index === 2) return `${m.name} — ${Math.ceil(mission.timer)}s left`;
    if (mission.stage === 'pickup') return `${m.name} — go to ${m.pickup.label}`;
    return `${m.name} — take it to ${m.dropoff.label}`;
  }
  if (world.taxi.state === 'pickup') return 'Free roam — pick up the fare';
  if (world.taxi.state === 'deliver') return 'Free roam — drop the fare off';
  return 'Free roam — find a fare, or hunt the $25 stashes';
}

// The nearest car the player can step into, within 55 px.
export function nearestEnterableCar(world, x, y) {
  let best = null;
  let bestD = 55;
  for (const car of world.cars) {
    if (car.kind !== KIND_PARKED && car.kind !== KIND_TRAFFIC) continue;
    const d = distance(x, y, car.x, car.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

function addWanted(world, n) {
  const before = world.wanted;
  world.wanted = Math.min(WANTED_MAX, world.wanted + n);
  if (world.wanted > before) world.quietTime = 0;
}

function setBanner(world, text) {
  world.banner = { text, until: world.time + 3 };
}

function completeMission(world) {
  const m = MISSIONS[world.mission.index];
  world.cash += m.reward;
  setBanner(world, `${m.name} complete! +$${m.reward}`);
  world.events.push('mission');
  // Mara's story ends with her mission; a later fare is a different rider.
  if (world.mission.index === 0) world.rider = null;
  world.mission.index += 1;
  world.mission.stage = 'pickup';
  world.mission.packageHeld = false;
  if (world.mission.index === 2) {
    world.mission.stage = 'timed';
    world.mission.timer = MISSIONS[2].timed;
    world.wanted = Math.max(world.wanted, 2);
    world.quietTime = 0;
  }
  saveGame(world);
}

function spawnPoliceCar(world) {
  const { player } = world;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const spot = nearestIntersection(
      range(world.rng, 200, WORLD_W - 200),
      range(world.rng, 200, WORLD_H - 200),
    );
    if (distance(spot.x, spot.y, player.x, player.y) < 500) continue;
    const car = {
      id: world.nextCarId, kind: KIND_POLICE,
      x: spot.x, y: spot.y,
      angle: Math.atan2(player.y - spot.y, player.x - spot.x),
      speed: 0, color: PALETTE.police, health: 100,
      cruise: 330, route: null, wp: 0, stuck: 0, hitCooldown: 0,
    };
    world.nextCarId += 1;
    world.cars.push(car);
    return;
  }
}

function stepPlayer(world, input, dt) {
  const { player } = world;
  if (player.punchCooldown > 0) player.punchCooldown -= dt;

  if (player.onFoot) {
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const ax = input.axis.x;
    const ay = input.axis.y;
    const len = Math.hypot(ax, ay);
    if (len > 0) {
      player.x += (ax / len) * speed * dt;
      player.y += (ay / len) * speed * dt;
      player.angle = Math.atan2(ay, ax);
    }
    player.x = clamp(player.x, 10, WORLD_W - 10);
    player.y = clamp(player.y, 10, WORLD_H - 10);
    resolveBuildings(player, PLAYER_R, world.buildings);
    // Cannot walk through cars.
    for (const car of world.cars) {
      const d = distance(player.x, player.y, car.x, car.y);
      if (d < CAR_R + PLAYER_R && d > 0.01) {
        player.x = car.x + ((player.x - car.x) / d) * (CAR_R + PLAYER_R);
        player.y = car.y + ((player.y - car.y) / d) * (CAR_R + PLAYER_R);
      }
    }
    if (input.punch && player.punchCooldown <= 0) {
      player.punchCooldown = 0.35;
      for (const ped of world.peds) {
        if (ped.state !== 'walk') continue;
        const d = distance(player.x, player.y, ped.x, ped.y);
        const facing = Math.abs(angleDiff(player.angle, Math.atan2(ped.y - player.y, ped.x - player.x)));
        if (d < 46 && facing < 1.2) {
          ped.state = 'down';
          ped.downTimer = 3;
          addWanted(world, 1);
          world.events.push('punch');
          break;
        }
      }
    }
    if (input.enter) {
      const car = nearestEnterableCar(world, player.x, player.y);
      if (car) {
        car.kind = KIND_PLAYER;
        car.route = null;
        player.car = car;
        player.onFoot = false;
        addWanted(world, 1);
        world.events.push('steal');
        // A waiting rider nearby climbs in too.
        if (world.rider && world.rider.state === 'waiting'
          && distance(player.x, player.y, world.rider.x, world.rider.y) < 90) {
          world.rider.state = 'inCar';
        }
      }
    }
    return;
  }

  // In a car: arcade handling, throttle, brake/reverse, steering that
  // bites less the faster the car goes.
  const car = player.car;
  if (!car) {
    player.onFoot = true;
    return;
  }
  if (input.axis.y < 0) car.speed += CAR_ACCEL * dt;
  else if (input.axis.y > 0) {
    car.speed -= (car.speed > 5 ? CAR_BRAKE : CAR_ACCEL * 0.6) * dt;
    if (car.speed < -CAR_REVERSE_MAX) car.speed = -CAR_REVERSE_MAX;
  } else {
    car.speed -= car.speed * 0.35 * dt;
    if (Math.abs(car.speed) < 4) car.speed = 0;
  }
  if (car.speed > CAR_MAX_SPEED) car.speed = CAR_MAX_SPEED;
  const steer = input.axis.x;
  const turnRate = CAR_TURN * clamp(car.speed / 140, -1, 1) * (1 - Math.min(Math.abs(car.speed) / 900, 0.55));
  car.angle += steer * turnRate * dt;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  car.x = clamp(car.x, 10, WORLD_W - 10);
  car.y = clamp(car.y, 10, WORLD_H - 10);
  if (car.hitCooldown > 0) car.hitCooldown -= dt;
  if (resolveBuildings(car, CAR_R, world.buildings)) {
    if (Math.abs(car.speed) > 180 && car.hitCooldown <= 0) {
      car.health -= (Math.abs(car.speed) - 180) / 25;
      car.hitCooldown = 0.5;
      world.events.push('crash');
    }
    car.speed *= 0.55;
  }
  if (car.health <= 0) {
    car.kind = KIND_WRECK;
    player.car = null;
    player.onFoot = true;
    player.x = car.x + 40;
    player.y = car.y;
    setBanner(world, 'Your car is wrecked!');
    return;
  }
  if (input.enter) {
    car.kind = KIND_PARKED;
    player.car = null;
    player.onFoot = true;
    player.x = car.x + Math.cos(car.angle + Math.PI / 2) * 32;
    player.y = car.y + Math.sin(car.angle + Math.PI / 2) * 32;
    player.angle = car.angle;
    // A rider in the car gets out with the player.
    if (world.rider && world.rider.state === 'inCar') {
      world.rider.state = 'following';
      world.rider.x = player.x;
      world.rider.y = player.y;
    }
  }
}

function stepTraffic(world, dt) {
  for (const car of world.cars) {
    if (car.kind !== KIND_TRAFFIC) continue;
    if (car.hitCooldown > 0) car.hitCooldown -= dt;
    // Next waypoint: keep walking the grid, never reversing into the
    // intersection just left.
    if (!car.route || car.wp >= car.route.length) {
      const here = nearestIntersection(car.x, car.y);
      const options = [];
      const vi = VERTICAL_ROADS.indexOf(here.x);
      const hi = HORIZONTAL_ROADS.indexOf(here.y);
      if (vi > 0) options.push({ x: VERTICAL_ROADS[vi - 1], y: here.y });
      if (vi < VERTICAL_ROADS.length - 1) options.push({ x: VERTICAL_ROADS[vi + 1], y: here.y });
      if (hi > 0) options.push({ x: here.x, y: HORIZONTAL_ROADS[hi - 1] });
      if (hi < HORIZONTAL_ROADS.length - 1) options.push({ x: here.x, y: HORIZONTAL_ROADS[hi + 1] });
      const prev = car.route && car.route.length > 1 ? car.route[car.route.length - 2] : null;
      const fresh = options.filter((o) => !prev || o.x !== prev.x || o.y !== prev.y);
      const next = pick(world.rng, fresh.length > 0 ? fresh : options);
      car.route = [here, next];
      car.wp = 1;
    }
    const target = car.route[car.wp];
    const off = laneOffset(car.route[car.wp - 1] ?? car.route[0], target);
    const tx = target.x + off.x;
    const ty = target.y + off.y;
    const dx = tx - car.x;
    const dy = ty - car.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 45) {
      car.wp += 1;
      continue;
    }
    // Brake for a car or a pedestrian straight ahead, in this lane: the
    // car in the oncoming lane, 36 px to the side, is not in the way. The
    // look-ahead grows with speed, so a fast car starts braking in time.
    let blocked = false;
    const hx = Math.cos(car.angle);
    const hy = Math.sin(car.angle);
    const lookAhead = 80 + Math.abs(car.speed) * 0.6;
    for (const other of world.cars) {
      if (other === car || other.kind === KIND_PARKED || other.kind === KIND_WRECK) continue;
      const rx = other.x - car.x;
      const ry = other.y - car.y;
      const along = rx * hx + ry * hy;
      const across = Math.abs(rx * hy - ry * hx);
      if (along > 0 && along < lookAhead && across < 26) { blocked = true; break; }
    }
    if (!blocked) {
      for (const ped of world.peds) {
        if (ped.state !== 'walk') continue;
        const rx = ped.x - car.x;
        const ry = ped.y - car.y;
        const along = rx * hx + ry * hy;
        const across = Math.abs(rx * hy - ry * hx);
        if (along > 0 && along < lookAhead && across < 26) { blocked = true; break; }
      }
    }
    const want = blocked ? 0 : car.cruise;
    car.speed += clamp(want - car.speed, -CAR_BRAKE * dt, CAR_ACCEL * dt);
    const desired = Math.atan2(dy, dx);
    car.angle += clamp(angleDiff(car.angle, desired), -2.4 * dt, 2.4 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    resolveBuildings(car, CAR_R, world.buildings);
    if (Math.abs(car.speed) < 5) {
      car.stuck += dt;
      if (car.stuck > 4) {
        car.wp += 1;
        car.stuck = 0;
      }
    } else car.stuck = 0;
  }
}

function stepPeds(world, dt) {
  const { player } = world;
  for (const ped of world.peds) {
    if (ped.hitCooldown > 0) ped.hitCooldown -= dt;
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        ped.state = 'flee';
        ped.fleeTimer = 3;
      }
      continue;
    }
    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      const away = Math.atan2(ped.y - player.y, ped.x - player.x);
      ped.x += Math.cos(away) * 130 * dt;
      ped.y += Math.sin(away) * 130 * dt;
      ped.angle = away;
      if (ped.fleeTimer <= 0) {
        ped.state = 'walk';
        ped.target = sidewalkPoint(world.rng);
      }
      continue;
    }
    const dx = ped.target.x - ped.x;
    const dy = ped.target.y - ped.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 12) {
      ped.target = sidewalkPoint(world.rng);
      continue;
    }
    ped.angle = Math.atan2(dy, dx);
    ped.x += (dx / dist) * ped.speed * dt;
    ped.y += (dy / dist) * ped.speed * dt;
    resolveBuildings(ped, 10, world.buildings);
    // Hit by the player's car: down they go, and the law notices. The
    // check is the car's own box: a pedestrian on the pavement, 34 px off
    // the lane, is not run down by a car staying in its lane.
    if (!player.onFoot && player.car && ped.hitCooldown <= 0) {
      const car = player.car;
      if (pointInCarBox(car, ped.x, ped.y) && Math.abs(car.speed) > 60) {
        ped.state = 'down';
        ped.downTimer = 3;
        ped.hitCooldown = 2;
        addWanted(world, 2);
        world.events.push('hitped');
      }
    }
  }
}

function stepPolice(world, dt) {
  const { player } = world;
  const want = Math.min(world.wanted, WANTED_MAX);
  let have = 0;
  for (const car of world.cars) if (car.kind === KIND_POLICE) have += 1;
  while (have < want) {
    spawnPoliceCar(world);
    have += 1;
  }
  if (world.wanted === 0) {
    world.cars = world.cars.filter((car) => car.kind !== KIND_POLICE);
    return;
  }
  let near = false;
  for (const car of world.cars) {
    if (car.kind !== KIND_POLICE) continue;
    const distToPlayer = distance(car.x, car.y, player.x, player.y);
    // Against a car the police hold off at 80 px, sirens blaring, instead
    // of ramming it: they only ever grab the player on foot.
    const wantSpeed = !player.onFoot && distToPlayer < 80 ? 0 : 330;
    const desired = Math.atan2(player.y - car.y, player.x - car.x);
    car.angle += clamp(angleDiff(car.angle, desired), -2.6 * dt, 2.6 * dt);
    car.speed += clamp(wantSpeed - car.speed, -CAR_BRAKE * dt, CAR_ACCEL * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    car.x = clamp(car.x, 10, WORLD_W - 10);
    car.y = clamp(car.y, 10, WORLD_H - 10);
    if (distToPlayer < WANTED_QUIET_RADIUS) near = true;
  }
  if (near) world.quietTime = 0;
  else world.quietTime += dt;
  if (world.wanted > 0 && world.quietTime >= WANTED_DECAY_SECONDS) {
    world.wanted -= 1;
    world.quietTime = 0;
    world.events.push('cooldown');
  }
  // On foot, a police car on top of the player for 0.9 s ends the run.
  if (player.onFoot) {
    let touching = false;
    for (const car of world.cars) {
      if (car.kind === KIND_POLICE && distance(car.x, car.y, player.x, player.y) < 30) {
        touching = true;
        break;
      }
    }
    if (touching) {
      world.bustedTimer += dt;
      if (world.bustedTimer >= BUSTED_CONTACT_SECONDS) {
        world.cash = Math.max(0, world.cash - BUSTED_FINE);
        world.lastFine = BUSTED_FINE;
        world.wanted = 0;
        world.bustedTimer = 0;
        world.cars = world.cars.filter((car) => car.kind !== KIND_POLICE);
        player.x = POLICE_STATION.x;
        player.y = POLICE_STATION.y;
        player.angle = -Math.PI / 2;
        if (player.car) {
          player.car.kind = KIND_PARKED;
          player.car = null;
        }
        player.onFoot = true;
        // Mara goes back to waiting for her pickup; a fare is lost.
        if (world.mission.index === 0 && world.rider) {
          world.rider.state = 'waiting';
          world.rider.x = MISSIONS[0].pickup.x;
          world.rider.y = MISSIONS[0].pickup.y;
        } else if (world.rider && world.rider.kind === 'taxi') {
          world.rider = null;
          world.taxi.state = 'idle';
          world.taxi.cooldown = 2;
        }
        setBanner(world, `BUSTED — the police took $${BUSTED_FINE}`);
        world.events.push('busted');
        saveGame(world);
      }
    } else {
      world.bustedTimer = Math.max(0, world.bustedTimer - dt * 2);
    }
  } else {
    world.bustedTimer = 0;
  }
}

function stepRider(world, dt) {
  const { rider, player } = world;
  if (!rider) return;
  if (rider.state === 'following') {
    const d = distance(rider.x, rider.y, player.x, player.y);
    if (d > 30) {
      const a = Math.atan2(player.y - rider.y, player.x - rider.x);
      rider.x += Math.cos(a) * 200 * dt;
      rider.y += Math.sin(a) * 200 * dt;
    }
    if (!player.onFoot && d < 90) rider.state = 'inCar';
  }
  if (rider.state === 'inCar' && player.car) {
    rider.x = player.car.x;
    rider.y = player.car.y;
  }
}

function stepMissions(world, dt) {
  const { mission, player, rider } = world;
  // Cash stashes hide all over the city, in any mode: walk or drive over one.
  const px = player.onFoot ? player.x : player.car.x;
  const py = player.onFoot ? player.y : player.car.y;
  for (const stash of world.stashes) {
    if (!stash.taken && distance(px, py, stash.x, stash.y) < 45) {
      stash.taken = true;
      world.cash += STASH_VALUE;
      setBanner(world, `Found a stash! +$${STASH_VALUE}`);
      world.events.push('stash');
      saveGame(world);
    }
  }
  if (mission.index === 0) {
    if (mission.stage === 'pickup') {
      if (rider.state === 'inCar') {
        mission.stage = 'deliver';
        setBanner(world, 'Mara is in — take her to the Sunset Diner');
        world.events.push('pickup');
      } else if (rider.state === 'waiting' && !player.onFoot
        && distance(player.car.x, player.car.y, rider.x, rider.y) < 70) {
        rider.state = 'inCar';
      } else if (rider.state === 'waiting' && player.onFoot
        && distance(player.x, player.y, rider.x, rider.y) < 50) {
        rider.state = 'following';
      }
    } else if (rider.state === 'inCar'
      && distance(player.car.x, player.car.y, MISSIONS[0].dropoff.x, MISSIONS[0].dropoff.y) < 70) {
      rider.state = 'done';
      completeMission(world);
    }
    return;
  }
  if (mission.index === 1) {
    if (mission.stage === 'pickup') {
      const px = player.onFoot ? player.x : player.car.x;
      const py = player.onFoot ? player.y : player.car.y;
      if (distance(px, py, MISSIONS[1].pickup.x, MISSIONS[1].pickup.y) < 60) {
        mission.stage = 'deliver';
        mission.packageHeld = true;
        world.wanted = Math.max(world.wanted, 1);
        world.quietTime = 0;
        setBanner(world, 'Package collected — the cops are onto you');
        world.events.push('pickup');
      }
    } else {
      const px = player.onFoot ? player.x : player.car.x;
      const py = player.onFoot ? player.y : player.car.y;
      if (distance(px, py, MISSIONS[1].dropoff.x, MISSIONS[1].dropoff.y) < 70) completeMission(world);
    }
    return;
  }
  if (mission.index === 2) {
    mission.timer -= dt;
    const px = player.onFoot ? player.x : player.car.x;
    const py = player.onFoot ? player.y : player.car.y;
    if (distance(px, py, MISSIONS[2].dropoff.x, MISSIONS[2].dropoff.y) < 70) {
      completeMission(world);
      return;
    }
    if (mission.timer <= 0) {
      mission.timer = MISSIONS[2].timed;
      world.wanted = Math.max(world.wanted, 2);
      world.quietTime = 0;
      setBanner(world, 'Too slow — the getaway starts over');
      world.events.push('fail');
    }
    return;
  }
  // Free roam: taxi fares.
  if (world.taxi.cooldown > 0) world.taxi.cooldown -= dt;
  if (world.taxi.state === 'idle' && world.taxi.cooldown <= 0 && !world.rider) {
    const p = sidewalkPoint(world.rng);
    world.rider = { kind: 'taxi', x: p.x, y: p.y, state: 'waiting' };
    world.taxi.state = 'pickup';
  }
  if (world.taxi.state === 'pickup' && world.rider) {
    if (world.rider.state === 'inCar') {
      const dest = nearestIntersection(range(world.rng, 300, WORLD_W - 300), range(world.rng, 300, WORLD_H - 300));
      world.taxi.dest = dest;
      world.taxi.state = 'deliver';
      setBanner(world, 'Fare aboard — take them to the marker');
    } else if (world.rider.state === 'waiting' && !player.onFoot
      && distance(player.car.x, player.car.y, world.rider.x, world.rider.y) < 55) {
      world.rider.state = 'inCar';
    } else if (world.rider.state === 'waiting' && player.onFoot
      && distance(player.x, player.y, world.rider.x, world.rider.y) < 50) {
      world.rider.state = 'following';
    }
  } else if (world.taxi.state === 'deliver' && world.rider && world.taxi.dest) {
    if (distance(px, py, world.taxi.dest.x, world.taxi.dest.y) < 70) {
      world.cash += TAXI_FARE;
      setBanner(world, `Fare paid! +$${TAXI_FARE}`);
      world.events.push('taxi');
      world.rider = null;
      world.taxi.state = 'idle';
      world.taxi.cooldown = 2;
      saveGame(world);
    }
  }
}

// One fixed step. `input` carries the movement axis, run, and one-shot
// enter/punch flags. With `harmless` set the city lives (traffic, peds)
// but nothing touches the player and no mission runs: the title screen.
export function stepWorld(world, input, dt) {
  world.time += dt;
  world.stepCount += 1;
  if (world.banner && world.time > world.banner.until) world.banner = null;
  stepTraffic(world, dt);
  stepPeds(world, dt);
  if (input.harmless) return;
  stepPlayer(world, input, dt);
  stepRider(world, dt);
  stepPolice(world, dt);
  stepMissions(world, dt);
  // Car-on-car shoves: the player's car and traffic bump each other.
  const solids = world.cars.filter((c) => c.kind !== KIND_WRECK);
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const a = solids[i];
      const b = solids[j];
      if (a.kind === KIND_PARKED && b.kind === KIND_PARKED) continue;
      // Police never touch the player's car: they hold off and wait for
      // the player to step out.
      if ((a.kind === KIND_POLICE && b.kind === KIND_PLAYER)
        || (a.kind === KIND_PLAYER && b.kind === KIND_POLICE)) continue;
      if (!carsOverlap(a, b)) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.01) continue;
      const push = Math.min(6, (56 - d) / 2);
      const nx = dx / d;
      const ny = dy / d;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const rel = Math.abs(a.speed - b.speed);
      if (rel > 150) {
        if (a.kind === KIND_PLAYER && a.hitCooldown <= 0) {
          a.health -= rel / 40;
          a.hitCooldown = 0.5;
          world.events.push('crash');
        }
        if (b.kind === KIND_PLAYER && b.hitCooldown <= 0) {
          b.health -= rel / 40;
          b.hitCooldown = 0.5;
          world.events.push('crash');
        }
        a.speed *= 0.7;
        b.speed *= 0.7;
      }
    }
  }
}

// Save: cash, mission, stashes and where the player stands. Guarded: a
// browser that refuses storage just plays without a save.
export function saveGame(world) {
  try {
    const taken = world.stashes.filter((s) => s.taken).map((s) => s.id);
    const data = {
      cash: world.cash,
      mission: world.mission.index,
      stage: world.mission.stage,
      stashes: taken,
      x: Math.round(world.player.x),
      y: Math.round(world.player.y),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // No storage, no save — the game still plays.
  }
}

export function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
