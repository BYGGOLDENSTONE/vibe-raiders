// Seeded deterministic RNG. Mulberry32. No Math.random anywhere in city module.

export interface Rng {
  next(): number; // [0,1)
  range(min: number, max: number): number;
  int(min: number, max: number): number; // inclusive both ends
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}

export function createRng(seed: number): Rng {
  // Normalize seed to a non-negative 32-bit integer.
  let state = (seed | 0) >>> 0;
  if (state === 0) state = 0x9e3779b9;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(min: number, max: number): number {
    return min + (max - min) * next();
  }

  function int(min: number, max: number): number {
    return Math.floor(range(min, max + 1));
  }

  function pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(next() * arr.length)];
  }

  function chance(p: number): boolean {
    return next() < p;
  }

  return { next, range, int, pick, chance };
}
