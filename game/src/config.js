// Solmar Bay — every number the game tunes on, in one place.
// The city is 3200x2400. Roads sit on a 400px grid; the west edge is sea
// and beach. All positions are world coordinates in pixels.
export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const ROAD_SPACING = 400;
export const ROAD_W = 96;
export const ROAD_HALF = ROAD_W / 2;
export const LANE_OFFSET = 24;
export const SIDEWALK_OFFSET = 60;

// West edge: sea, then sand, then the city proper.
export const SEA_W = 100;
export const BEACH_W = 160; // sand band east of the sea (x 100..260)

// Player on foot.
export const PLAYER_WALK = 150;
export const PLAYER_RUN = 235;
export const PLAYER_R = 14;

// Cars.
export const CAR_ACCEL = 300;
export const CAR_BRAKE = 560;
export const CAR_REVERSE_MAX = 140;
export const CAR_MAX_SPEED = 520;
export const CAR_TURN = 2.6; // rad/s at full steer and full speed
export const CAR_DRAG = 0.55; // per second, exponential
export const CAR_R = 20;
export const CAR_HEALTH = 100;
export const SCRAPE_DAMAGE = 2;
export const SCRAPE_COOLDOWN = 0.5;
export const KMH = 0.222; // px/s -> km/h on the speedometer

// Traffic and pedestrians.
export const TRAFFIC_COUNT = 14;
export const TRAFFIC_SPEED_MIN = 130;
export const TRAFFIC_SPEED_MAX = 200;
export const PED_COUNT = 24;
export const PED_SPEED_MIN = 40;
export const PED_SPEED_MAX = 70;
export const PARKED_COUNT = 12;

// Wanted level 0..5.
export const WANTED_MAX = 5;
export const WANTED_DECAY_SECONDS = 18;
export const WANTED_DECAY_RANGE = 600;
export const WANTED_STEAL = 1;
export const WANTED_PUNCH = 1;
export const WANTED_PED_HIT = 2;
export const BUSTED_CONTACT = 0.9; // seconds of police contact on foot
export const BUSTED_FINE = 100;
export const POLICE_BASE_SPEED = 300;
export const POLICE_SPEED_PER_STAR = 15;
export const POLICE_SPAWN_DIST_MIN = 700;
export const POLICE_SPAWN_DIST_MAX = 900;

// Money.
export const TAXI_FARE = 50;
export const STASH_VALUE = 25;
export const STASH_COUNT = 10;

// Key places.
export const PLAYER_START = { x: 1200, y: 1200 };
export const PRECINCT_POS = { x: 2032, y: 1232 };
export const MARA_POS = { x: 1264, y: 864 };
export const DINER_POS = { x: 2432, y: 1632 };
export const DOCKS_POS = { x: 240, y: 1200 };
export const MOTEL_POS = { x: 2832, y: 432 };
export const HIDEOUT_POS = { x: 632, y: 2032 };

// Missions: name, blurb, pay. The third is timed.
export const MISSIONS = [
  {
    name: 'The Pickup',
    intro: 'Rook: Mara is waiting at Palm & 3rd. Bring a car, pick her up, take her to the Sunset Diner.',
    pay: 150,
  },
  {
    name: 'The Drop',
    intro: 'Mara: a package waits at the docks. Grab it, then run it to the Starlite Motel. The cops will notice.',
    pay: 250,
  },
  {
    name: 'The Getaway',
    intro: 'Rook: the heat is on — wanted level 2. Reach the hideout on Coral & 5th in 90 seconds.',
    pay: 400,
  },
];
export const GETAWAY_SECONDS = 90;

// Interaction ranges.
export const PICKUP_R = 75;
export const DROPOFF_R = 90;
export const STASH_R = 40;
export const TALK_R = 60;
export const PUNCH_R = 55;

export const SAVE_KEY = 'solmar-bay.save.v1';

// Sun-soaked palette: warm sand, turquoise sea, pastel blocks.
export const PALETTE = {
  sea: '#2fa8c9',
  seaDeep: '#1d7fa3',
  sand: '#e8d5a3',
  grass: '#7fae62',
  park: '#5d9b4a',
  road: '#3d3a38',
  roadEdge: '#57504a',
  lane: '#e8d44f',
  sidewalk: '#b9b2a4',
  building: ['#e8a798', '#a8c8e8', '#e8d28a', '#b8a8d8', '#98d8b8', '#e8b88a', '#c8c8c8'],
  roof: ['#8a5a4a', '#4a6a8a', '#7a6a3a', '#5a4a7a', '#3a6a4a'],
  player: '#ffd23e',
  police: '#2a4a8a',
  taxi: '#f2c200',
  mara: '#e85a9a',
  marker: '#ffd23e',
};
