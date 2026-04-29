// Tiny seeded RNG (mulberry32). Deterministic per session seed.

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rangeRng(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function intRangeRng(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rangeRng(rng, lo, hi + 1));
}
