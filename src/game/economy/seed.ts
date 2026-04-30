// Deterministic galaxy seed generator.
// Same numeric seed -> identical 100-planet layout, sector boundaries, names, kinds.
// Both browser clients and the PartyKit server consume identical output.
// No Three.js imports — pure data.

import { GALAXY, type PlanetDef, type PlanetKind, type Vec3Tuple } from './types';

// ---------- PRNG: mulberry32 (deterministic, fast, fine for seed-grade work) ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rand(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Name pools (jam-acceptable variety, ~6KB total) ----------

const NAME_PREFIX = [
  'Kael', 'Veyra', 'Argon', 'Solis', 'Nyx', 'Tarsis', 'Orin', 'Calix',
  'Mira', 'Theta', 'Zera', 'Lyra', 'Vex', 'Hael', 'Ozin', 'Ryl',
  'Quor', 'Eska', 'Jovan', 'Cinder', 'Ember', 'Vale', 'Auro', 'Polis',
  'Drax', 'Kepler', 'Halcyon', 'Onyx', 'Triton', 'Marrow', 'Sable', 'Crux',
];
const NAME_SUFFIX = [
  'Prime', 'II', 'III', 'IV', 'V', 'IX', 'X', 'XII',
  '-A', '-B', '-Beta', '-Gamma', 'Reach', 'Hold', 'Anchor', 'Forge',
  'Spire', 'Veil', 'Crest', 'Fold', 'Vault', 'Drift',
];
const NEUTRAL_PREFIX = ['Cinder', 'Voidwell', 'Glass', 'Hush', 'Pale', 'Brim'];

// Deterministic Mitchell's best-candidate-ish placement on a thick disc, then
// k-means assignment of planets to 16 sector centers. Cheap enough to run client+server.
function discPoint(rand: () => number): Vec3Tuple {
  // Sample (r, theta) with sqrt-r for area-uniform distribution on the disc.
  const r = Math.sqrt(rand()) * GALAXY.discRadius;
  const theta = rand() * Math.PI * 2;
  const y = (rand() - 0.5) * GALAXY.discThickness;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

function dist2(a: Vec3Tuple, b: Vec3Tuple): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function pickKind(sectorId: number, isHome: boolean, isNeutral: boolean, rand: () => number): PlanetKind {
  if (isNeutral) return 'neutral';
  if (isHome) return 'home';
  // Mix: ~50% rocky, ~25% gas, ~25% ice. Each sector skews slightly by sectorId.
  const skew = (sectorId * 17) % 100 / 100;
  const r = rand();
  if (r < 0.5 + skew * 0.1) return 'rocky';
  if (r < 0.75 + skew * 0.05) return 'gas';
  return 'ice';
}

export interface GalaxyLayout {
  seed: number;
  planets: PlanetDef[];
  sectorCenters: Vec3Tuple[];     // length GALAXY.totalSectors
  // Map sectorId -> homePlanetId.
  sectorHomeIds: Map<number, string>;
}

export function generateGalaxy(seed: number): GalaxyLayout {
  const rand = mulberry32(seed);

  // 1. Place sector centers as 16 well-spaced points on the disc using Mitchell.
  const sectorCenters: Vec3Tuple[] = [];
  const sectorCandidates = 32;
  for (let i = 0; i < GALAXY.totalSectors; i++) {
    let best: Vec3Tuple = [0, 0, 0];
    let bestMinDist = -1;
    for (let c = 0; c < sectorCandidates; c++) {
      const cand = discPoint(rand);
      let minDist = Infinity;
      for (const existing of sectorCenters) {
        const d = dist2(cand, existing);
        if (d < minDist) minDist = d;
      }
      if (sectorCenters.length === 0 || minDist > bestMinDist) {
        bestMinDist = minDist;
        best = cand;
      }
    }
    sectorCenters.push(best);
  }

  // 2. Place planets, assign to nearest sector. Per sector: ensure exactly one home,
  //    a few unlockable, and 1-2 neutrals near sector boundaries.
  const planets: PlanetDef[] = [];
  const perSector: PlanetDef[][] = sectorCenters.map(() => []);

  // Step 2a: place candidate positions and bucket by nearest sector.
  const positions: Vec3Tuple[] = [];
  const positionsAttempts = GALAXY.totalPlanets * 4;
  while (positions.length < GALAXY.totalPlanets && positions.length < positionsAttempts) {
    const cand = discPoint(rand);
    // Reject if too close to any existing planet (visual cleanliness).
    let tooClose = false;
    for (const p of positions) {
      if (dist2(cand, p) < 9.0) { tooClose = true; break; }
    }
    if (!tooClose) positions.push(cand);
  }
  // If we couldn't reach 100 with the rejection sampler, fill the rest unrestricted.
  while (positions.length < GALAXY.totalPlanets) positions.push(discPoint(rand));

  // 2b: nearest-sector assignment.
  type Pending = { pos: Vec3Tuple; sector: number };
  const pending: Pending[] = positions.map((pos) => {
    let bestSector = 0;
    let bestD = Infinity;
    for (let s = 0; s < sectorCenters.length; s++) {
      const d = dist2(pos, sectorCenters[s]);
      if (d < bestD) { bestD = d; bestSector = s; }
    }
    return { pos, sector: bestSector };
  });

  // Guarantee every sector has at least one planet: if a sector is empty,
  // donate the planet that is currently second-nearest to that sector center
  // from the donor sector with the most planets.
  const counts = new Array<number>(sectorCenters.length).fill(0);
  for (const p of pending) counts[p.sector]++;
  for (let s = 0; s < sectorCenters.length; s++) {
    if (counts[s] > 0) continue;
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < pending.length; i++) {
      if (counts[pending[i].sector] <= 1) continue; // don't drain a single-planet sector
      const d = dist2(pending[i].pos, sectorCenters[s]);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      counts[pending[bestIdx].sector]--;
      pending[bestIdx].sector = s;
      counts[s] = 1;
    }
  }

  for (const { pos, sector } of pending) {
    perSector[sector].push({
      id: '',                        // assigned below
      name: '',
      kind: 'rocky',
      sectorId: sector,
      position: pos,
      isHomeOfSector: false,
      isNeutral: false,
      surfaceSeed: Math.floor(rand() * 0x7fffffff),
    });
  }

  // 2c: For each sector, mark the planet closest to the sector center as home,
  //     and the planet farthest from the sector center as neutral (boundary planet).
  const sectorHomeIds = new Map<number, string>();
  for (let s = 0; s < sectorCenters.length; s++) {
    const bucket = perSector[s];
    if (bucket.length === 0) continue;
    let home = bucket[0];
    let homeD = dist2(home.position, sectorCenters[s]);
    let neutral = bucket[0];
    let neutralD = homeD;
    for (const p of bucket) {
      const d = dist2(p.position, sectorCenters[s]);
      if (d < homeD) { home = p; homeD = d; }
      if (d > neutralD) { neutral = p; neutralD = d; }
    }
    home.isHomeOfSector = true;
    if (bucket.length > 1 && neutral !== home) neutral.isNeutral = true;
  }

  // 2d: Names + kinds + ids, in a stable per-sector order.
  let globalIndex = 0;
  for (let s = 0; s < perSector.length; s++) {
    const bucket = perSector[s];
    bucket.sort((a, b) => dist2(a.position, sectorCenters[s]) - dist2(b.position, sectorCenters[s]));
    for (let i = 0; i < bucket.length; i++) {
      const p = bucket[i];
      p.id = `p${s.toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
      p.kind = pickKind(s, p.isHomeOfSector, p.isNeutral, rand);
      p.name = makePlanetName(rand, p.isNeutral);
      planets.push(p);
      if (p.isHomeOfSector) sectorHomeIds.set(s, p.id);
      globalIndex++;
    }
  }
  void globalIndex;

  return { seed, planets, sectorCenters, sectorHomeIds };
}

function makePlanetName(rand: () => number, neutral: boolean): string {
  const prefix = neutral
    ? NEUTRAL_PREFIX[Math.floor(rand() * NEUTRAL_PREFIX.length)]
    : NAME_PREFIX[Math.floor(rand() * NAME_PREFIX.length)];
  const suffix = NAME_SUFFIX[Math.floor(rand() * NAME_SUFFIX.length)];
  return `${prefix} ${suffix}`;
}
