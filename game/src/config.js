// Solmar Bay — every number the game tunes by, in one place.
// The city is 3200 x 2400 px on a 400 px road grid, with the sea and the
// beach down its west edge. Roads are 72 px wide; cars drive on the right.

export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const SEA_W = 110; // x < 110 is water
export const BEACH_W = 100; // 110..210 is sand
export const ROAD_W = 72;
export const BLOCK = 400;

export const VERTICAL_ROADS = [400, 800, 1200, 1600, 2000, 2400, 2800];
export const HORIZONTAL_ROADS = [400, 800, 1200, 1600, 2000];

export const STEP = 1 / 60; // fixed simulation step, seconds

// The player on foot.
export const WALK_SPEED = 175;
export const RUN_SPEED = 265;
export const PLAYER_R = 14;

// Cars.
export const CAR_ACCEL = 300;
export const CAR_BRAKE = 620;
export const CAR_REVERSE_MAX = 130;
export const CAR_MAX_SPEED = 540;
export const CAR_TURN = 2.7; // rad/s at full lock, low speed
export const CAR_R = 19; // collision circle
export const CAR_LEN = 46;
export const CAR_WID = 24;

// Traffic and pedestrians.
export const TRAFFIC_COUNT = 14;
export const PED_COUNT = 18;
export const PARKED_COUNT = 10;
export const STASH_COUNT = 10;

// Wanted level.
export const WANTED_MAX = 5;
export const WANTED_DECAY_SECONDS = 18;
export const WANTED_QUIET_RADIUS = 450;
export const BUSTED_CONTACT_SECONDS = 0.9;
export const BUSTED_FINE = 100;

// Money.
export const START_CASH = 50;
export const TAXI_FARE = 50;
export const STASH_VALUE = 25;

// Missions: pickup point, drop-off point, reward. Mara waits on the
// sidewalk north-east of the 800/800 crossing; the diner, the motel and
// the hideout sit in the blocks beside their markers.
export const MISSIONS = [
  {
    name: 'The Pickup',
    brief: 'Pick up Mara at the 8th St crossing, then drive her to the Sunset Diner.',
    pickup: { x: 852, y: 748, label: 'Mara' },
    dropoff: { x: 2364, y: 1236, label: 'Sunset Diner' },
    reward: 150,
  },
  {
    name: 'The Drop',
    brief: 'Collect the package at the docks, then take it to the Starlite Motel. The cops will notice.',
    pickup: { x: 400, y: 2036, label: 'Package' },
    dropoff: { x: 2800, y: 764, label: 'Starlite Motel' },
    reward: 250,
  },
  {
    name: 'The Getaway',
    brief: 'Lose the heat and reach the hideout in 90 seconds.',
    pickup: null,
    dropoff: { x: 1200, y: 2036, label: 'Hideout' },
    reward: 400,
    timed: 90,
  },
];

export const PLAYER_START = { x: 600, y: 1160 };
export const POLICE_STATION = { x: 1600, y: 436 };

// Save slot.
export const SAVE_KEY = 'solmar-bay.save.v1';

// Sun-soaked palette: warm sand, teal sea, pastel blocks.
export const PALETTE = {
  sea: '#2e7fa8',
  seaDeep: '#256d91',
  sand: '#e6cf9a',
  grass: '#79a95c',
  park: '#5f9c4e',
  sidewalk: '#b7ad97',
  road: '#3b4048',
  roadEdge: '#2c3037',
  lane: '#e8d44d',
  building: ['#e0a58c', '#9fc3d4', '#d9c58f', '#b7a8cc', '#e8b7c4', '#a8c8a0', '#d4a06a'],
  roof: '#00000022',
  player: '#2ec4b6',
  police: '#f4f6f8',
};
