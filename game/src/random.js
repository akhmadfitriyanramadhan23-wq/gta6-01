// A tiny seeded generator (mulberry32). The same seed builds the same city,
// the same traffic and the same pedestrians, which is what makes the
// screenshot scenes repeatable frame for frame.

export function createRandom(seed) {
  let state = seed | 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick one element of an array with the seeded generator.
export function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

// A number in [min, max) from the seeded generator.
export function range(random, min, max) {
  return min + random() * (max - min);
}
