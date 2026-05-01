import type {
  EconomyKind,
  GalaxyData,
  GalaxyPalette,
  MoonData,
  PlanetData,
  PlanetType,
  RiskLevel,
  StarClass,
  SystemData,
  UniverseData,
} from './types';
import { Rng } from './rng';

// --- Naming -----------------------------------------------------------------

const TECH_PREFIXES = [
  'Kepler', 'HD', 'Gliese', 'Wolf', 'Trappist', 'NGC', 'TYC', 'Ross', 'Tau Ceti',
];

const ROMANTIC_NAMES = [
  'Solara', 'Nacre', 'Mirage', 'Kharon', 'Aetheria', 'Vela', 'Ortis', 'Caelum',
  'Pyra', 'Thalon', 'Veridia', 'Halcyon', 'Lyran', 'Sable', 'Auriga', 'Orenth',
  'Sirius Vex', 'Vega Bright', 'Andra', 'Lysander', 'Polara', 'Ember Hold',
  'Cygnis', 'Drovara', 'Helith', 'Kaltris', 'Vorath', 'Nyxus', 'Othilon',
];

const PLANET_GIVEN_NAMES = [
  'Aster', 'Ember', 'Velora', 'Thane', 'Cella', 'Orren', 'Sora', 'Caldus',
  'Notus', 'Mord', 'Riven', 'Pyre', 'Galen', 'Hesper', 'Mira', 'Korin',
  'Talos', 'Nerion', 'Vesper', 'Quil', 'Sable', 'Amber', 'Aurum', 'Volos',
  'Thessa', 'Drake', 'Hyrios', 'Selen', 'Carmin', 'Brisa', 'Doran', 'Lethe',
  'Ix', 'Ozar', 'Pellis', 'Reiv',
];

const PLANET_SUFFIXES = ['', ' Prime', ' II', ' III', ' Minor', ' Major', ' Reach', ' Hold'];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function makeSystemName(rng: Rng): string {
  // 50/50 between tech-style and romantic
  if (rng.bool(0.5)) {
    const prefix = rng.pick(TECH_PREFIXES);
    const num = rng.int(100, 9999);
    return `${prefix}-${num}`;
  }
  const base = rng.pick(ROMANTIC_NAMES);
  const tail = rng.bool(0.55) ? ' System' : ` ${rng.pick(['Core', 'Belt', 'Line', 'Gate'])}`;
  return `${base}${tail}`;
}

function makePlanetName(rng: Rng, systemName: string, index: number, isRomanticSystem: boolean): string {
  if (isRomanticSystem && rng.bool(0.7)) {
    const given = rng.pick(PLANET_GIVEN_NAMES);
    const suf = rng.pick(PLANET_SUFFIXES);
    return `${given}${suf}`;
  }
  // tech style: SystemName + roman or letter
  const stripped = systemName.replace(/ (System|Core|Belt|Line|Gate)$/, '');
  return `${stripped} ${ROMAN[index] ?? String(index + 1)}`;
}

function makeMoonName(planetName: string, index: number): string {
  const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
  return `${planetName} ${letters[index] ?? String(index + 1)}`;
}

// --- Color palettes ---------------------------------------------------------

const STAR_PRESETS: Record<
  StarClass,
  { color: [number, number, number]; radius: [number, number] }
> = {
  'red-dwarf':  { color: [1.00, 0.45, 0.30], radius: [3.0,  4.8 ] },
  'orange':     { color: [1.00, 0.65, 0.35], radius: [4.0,  6.5 ] },
  'yellow':     { color: [1.00, 0.92, 0.65], radius: [5.0,  8.0 ] },
  'white-blue': { color: [0.85, 0.92, 1.00], radius: [6.5, 10.5 ] },
  'blue-giant': { color: [0.60, 0.75, 1.00], radius: [9.0, 14.0 ] },
};

const PLANET_PALETTES: Record<
  PlanetType,
  { primary: [number, number, number]; secondary: [number, number, number]; accent: [number, number, number] }
> = {
  rocky:  { primary: [0.55, 0.42, 0.32], secondary: [0.34, 0.25, 0.18], accent: [0.72, 0.60, 0.48] },
  ocean:  { primary: [0.18, 0.42, 0.72], secondary: [0.28, 0.55, 0.32], accent: [0.85, 0.92, 1.00] },
  gas:    { primary: [0.86, 0.66, 0.40], secondary: [0.62, 0.42, 0.22], accent: [0.95, 0.85, 0.65] },
  ice:    { primary: [0.78, 0.88, 0.96], secondary: [0.55, 0.72, 0.86], accent: [0.92, 0.96, 1.00] },
  lava:   { primary: [0.18, 0.08, 0.06], secondary: [0.95, 0.30, 0.08], accent: [1.00, 0.65, 0.20] },
  desert: { primary: [0.82, 0.58, 0.32], secondary: [0.62, 0.38, 0.18], accent: [0.92, 0.78, 0.48] },
  toxic:  { primary: [0.55, 0.78, 0.30], secondary: [0.35, 0.55, 0.18], accent: [0.85, 0.92, 0.40] },
};

const PLANET_TYPES_BY_ZONE: Record<'inner' | 'mid' | 'outer', PlanetType[]> = {
  inner: ['lava', 'desert', 'rocky', 'toxic'],
  mid:   ['rocky', 'ocean', 'desert', 'toxic'],
  outer: ['gas', 'ice', 'rocky'],
};

// W9 — weighted picker. Each candidate's weight comes from the palette
// (defaults to 1 when missing). Picks deterministically given the rng so the
// same seed/palette always produces the same galaxy.
function weightedPick<T extends string>(
  rng: Rng,
  candidates: T[],
  weights: Partial<Record<T, number>>,
): T {
  const ws = candidates.map((c) => Math.max(0.01, weights[c] ?? 1.0));
  let sum = 0;
  for (const w of ws) sum += w;
  let r = rng.next() * sum;
  for (let i = 0; i < candidates.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

// --- Lore -------------------------------------------------------------------

const RESOURCES_BY_TYPE: Record<PlanetType, string[]> = {
  rocky:  ['Iron', 'Titanium', 'Nickel', 'Copper'],
  ocean:  ['Water', 'Food', 'Hydrogen'],
  gas:    ['Fuel', 'Helium-3', 'Hydrogen'],
  ice:    ['Crystal', 'Frozen gas', 'Water'],
  lava:   ['Plasma', 'Energy', 'Volcanic metal'],
  desert: ['Silicon', 'Glass', 'Rare mineral'],
  toxic:  ['Chemical', 'Acid', 'Exotic gas'],
};

const ECONOMY_BY_DOMINANT_TYPE: Record<PlanetType, EconomyKind[]> = {
  ocean:  ['colony-core', 'tourism-belt', 'trade-hub'],
  rocky:  ['frontier-mining', 'industrial', 'colony-core'],
  gas:    ['industrial', 'frontier-mining', 'military'],
  ice:    ['science-line', 'frontier-mining', 'lost-colony'],
  lava:   ['industrial', 'military', 'frontier-mining'],
  desert: ['frontier-mining', 'industrial', 'lost-colony'],
  toxic:  ['military', 'science-line', 'lost-colony'],
};

const SYSTEM_DESC_TEMPLATES: Record<EconomyKind, string[]> = {
  'colony-core':     ['A stable colony core with a wide habitable belt.', 'A temperate-belt system where early settlers took root.'],
  'science-line':    ['A cold-lit research line with few planets.', 'An advanced laboratory system spinning under a quiet star.'],
  'trade-hub':       ['A bustling trade node sitting on a busy route junction.', 'A lively trade stop intersecting several travel lanes.'],
  'frontier-mining': ['A mining system on the frontier, rich in raw resources.', 'Dark and compact — a cheap but punishing mining line.'],
  'tourism-belt':    ['A tourism belt known for its brightly colored orbits.', 'A system famous for its visual splendor and heavy passenger traffic.'],
  'industrial':      ['A heavy industrial hub packed with refineries.', 'A production-focused system with a perpetually glowing atmosphere.'],
  'military':        ['A military base ringed by tight orbital defenses.', 'A high-alert system shaped for fleet maneuvers.'],
  'lost-colony':     ['A lost colony abandoned by its original settlers.', 'A forgotten system spinning quietly, lessons learned and left behind.'],
  'empty':           ['A system named on the map but in truth deserted.', 'An empty system holding little more than its star.'],
};

const PLANET_DESC_TEMPLATES: Record<PlanetType, string[]> = {
  rocky: [
    'A plain but profitable world, its rocky crust laced with ore veins.',
    'A planet of metal-rich plateaus stretching beneath a thin atmosphere.',
  ],
  ocean: [
    'A life-bearing world of blue oceans and a balanced climate.',
    'A bright temperate-belt planet, its shallow seas glowing turquoise.',
  ],
  gas: [
    'A fuel reservoir famous for wide bands and colossal storms.',
    'A gas giant whose orbit easily hosts moons and station networks.',
  ],
  ice: [
    'A cold world cradling rare chemical reserves under a shell of ice.',
    'A frozen planet with crystal-bright northern and southern shields.',
  ],
  lava: [
    'An energy-rich world threaded with rivers of lava across an active surface.',
    'A glowing planet baking in close orbit, leaking plasma into space.',
  ],
  desert: [
    'A dry world cut by sand oceans and long-shadowed canyons.',
    'A desert planet hiding rare mineral veins beneath a scorching equator.',
  ],
  toxic: [
    'A world of exotic chemistry hidden under a dense, poisonous atmosphere.',
    'A planet supporting shielded life among greenish veils of fog.',
  ],
};

function pickEconomy(rng: Rng, planets: PlanetData[]): EconomyKind {
  if (planets.length === 0) return 'empty';
  // Tally types
  const tally = new Map<PlanetType, number>();
  for (const p of planets) tally.set(p.type, (tally.get(p.type) ?? 0) + 1);
  // Find dominant
  let dom: PlanetType = planets[0]!.type;
  let best = -1;
  for (const [k, v] of tally) {
    if (v > best) { dom = k; best = v; }
  }
  return rng.pick(ECONOMY_BY_DOMINANT_TYPE[dom]);
}

function riskFor(p: { type: PlanetType; temperatureC: number }): RiskLevel {
  if (p.type === 'lava' || p.type === 'toxic') return 'extreme';
  if (p.temperatureC > 200 || p.temperatureC < -150) return 'high';
  if (p.temperatureC > 60 || p.temperatureC < -40) return 'medium';
  return 'low';
}

// --- Generators -------------------------------------------------------------

function pickMoonGap(rng: Rng, planetRadius: number): number {
  // Bucketed: 40% close pair, 45% normal, 15% wide — kills "racing-track"
  // uniformity but keeps moon systems tight enough to leave breathing room
  // between planet orbits.
  const r = rng.next();
  if (r < 0.40) return planetRadius * rng.range(0.30, 0.70);
  if (r < 0.85) return planetRadius * rng.range(0.80, 1.50);
  return planetRadius * rng.range(1.70, 2.50);
}

function makeMoonsPacked(rng: Rng, planetRadius: number, planetName: string, count: number): MoonData[] {
  const moons: MoonData[] = [];
  // Start above planet surface with breathing room.
  let prevApoExt = planetRadius * 1.4;
  for (let i = 0; i < count; i++) {
    const radius = planetRadius * rng.range(0.15, 0.45);
    // Moons are usually quite circular; small but non-zero eccentricity for variation.
    const eccentricity = rng.range(0.0, 0.18);
    const omega = rng.range(0, Math.PI * 2);
    const gap = pickMoonGap(rng, planetRadius);
    // periapsis = a*(1-e); we need (a*(1-e) - radius) > prevApoExt + gap
    const a = (prevApoExt + gap + radius) / Math.max(0.001, 1 - eccentricity);
    prevApoExt = a * (1 + eccentricity) + radius;

    const tint = rng.range(0.55, 0.85);
    moons.push({
      id: `m${i}`,
      name: makeMoonName(planetName, i),
      radius,
      orbitRadius: a,
      orbitEccentricity: eccentricity,
      orbitOmega: omega,
      orbitSpeed: rng.range(0.18, 0.42),
      orbitPhase: rng.range(0, Math.PI * 2),
      orbitTilt: rng.range(-0.25, 0.25),
      color: [tint, tint * rng.range(0.9, 1.0), tint * rng.range(0.85, 0.95)],
    });
  }
  return moons;
}

interface PlanetStub {
  type: PlanetType;
  radius: number;
  name: string;
  zone: 'inner' | 'mid' | 'outer';
  moons: MoonData[];
  hasRings: boolean;
  ringInner: number;
  ringOuter: number;
  ringTint: number;
  eccentricity: number;
  omega: number;
  orbitTilt: number;
  bodyExtent: number; // worst-case radial reach from planet center (rings, moons inclusive)
}

function pickPlanetGap(rng: Rng): number {
  // Bucketed: 30% tight pair, 45% normal, 25% wide. Gives systems clear visual rhythm.
  const r = rng.next();
  if (r < 0.30) return rng.range(2.0, 4.0);
  if (r < 0.75) return rng.range(5.0, 9.0);
  return rng.range(11.0, 18.0);
}

function buildPlanetStub(
  rng: Rng,
  systemName: string,
  index: number,
  zone: 'inner' | 'mid' | 'outer',
  isRomanticSystem: boolean,
  palette: GalaxyPalette,
): PlanetStub {
  // W9 — palette weighting: candidate planet types in this zone, weighted by
  // the galaxy's palette so e.g. an ice-heavy galaxy yields more ice worlds.
  const type: PlanetType = weightedPick(rng, PLANET_TYPES_BY_ZONE[zone], palette.planetWeights);
  const radius =
    type === 'gas'   ? rng.range(1.6, 2.6) :
    type === 'ocean' ? rng.range(0.8, 1.6) :
    type === 'ice'   ? rng.range(0.6, 1.3) :
    rng.range(0.4, 1.2);

  const name = makePlanetName(rng, systemName, index, isRomanticSystem);

  const moonCount = type === 'gas' ? rng.int(1, 3) : rng.bool(0.55) ? rng.int(1, 2) : 0;
  const moons = makeMoonsPacked(rng, radius, name, moonCount);

  const hasRings = type === 'gas' && rng.bool(0.55);
  const ringInner = hasRings ? radius * rng.range(1.4, 1.7) : 0;
  const ringOuter = hasRings ? ringInner + radius * rng.range(0.6, 1.2) : 0;
  const ringTint = rng.range(0.6, 0.95);

  // Gas giants get tighter eccentricity (their wide moon system already adds visual width).
  const eccentricity =
    type === 'gas' ? rng.range(0.02, 0.10) :
    rng.range(0.04, 0.22);
  const omega = rng.range(0, Math.PI * 2);
  const orbitTilt = rng.range(-0.05, 0.05);

  let moonExtent = 0;
  for (const m of moons) {
    moonExtent = Math.max(moonExtent, m.orbitRadius * (1 + m.orbitEccentricity) + m.radius);
  }
  const bodyExtent = Math.max(radius, ringOuter, moonExtent);

  return {
    type, radius, name, zone, moons,
    hasRings, ringInner, ringOuter, ringTint,
    eccentricity, omega, orbitTilt, bodyExtent,
  };
}

function finalizePlanet(
  rng: Rng,
  stub: PlanetStub,
  index: number,
  semiMajor: number,
): PlanetData {
  const palette = PLANET_PALETTES[stub.type];

  const baseTemp =
    stub.zone === 'inner' ? rng.range(150, 600) :
    stub.zone === 'mid'   ? rng.range(-40, 60)   :
    rng.range(-200, -60);

  const jitter = (c: [number, number, number]): [number, number, number] => [
    Math.min(1, Math.max(0, c[0] + rng.range(-0.06, 0.06))),
    Math.min(1, Math.max(0, c[1] + rng.range(-0.06, 0.06))),
    Math.min(1, Math.max(0, c[2] + rng.range(-0.06, 0.06))),
  ];

  const temperatureC = Math.round(baseTemp);
  const resource = rng.pick(RESOURCES_BY_TYPE[stub.type]);
  const risk = riskFor({ type: stub.type, temperatureC });
  const description = rng.pick(PLANET_DESC_TEMPLATES[stub.type]);

  return {
    id: `p${index}`,
    name: stub.name,
    type: stub.type,
    radius: stub.radius,
    orbitRadius: semiMajor,
    orbitEccentricity: stub.eccentricity,
    orbitOmega: stub.omega,
    orbitSpeed: rng.range(0.06, 0.16) / Math.sqrt(semiMajor / 8),
    orbitPhase: rng.range(0, Math.PI * 2),
    orbitTilt: stub.orbitTilt,
    axialTilt: rng.range(-0.45, 0.45),
    rotationSpeed: rng.range(0.02, 0.08) * (rng.bool(0.8) ? 1 : -1),
    temperatureC,
    hasRings: stub.hasRings,
    ringInner: stub.ringInner,
    ringOuter: stub.ringOuter,
    ringColor: [stub.ringTint, stub.ringTint * 0.92, stub.ringTint * 0.78],
    primaryColor: jitter(palette.primary),
    secondaryColor: jitter(palette.secondary),
    accentColor: jitter(palette.accent),
    noiseSeed: rng.range(0, 1000),
    moons: stub.moons,
    resource,
    risk,
    description,
  };
}

function makeSystem(rng: Rng, position: [number, number, number], palette: GalaxyPalette, idPrefix: string): SystemData {
  // W9 — palette weighting for star class. Ice-tinted galaxies prefer red
  // dwarfs and white-blue stars; gas-tinted galaxies favour blue giants. Same
  // 5 classes, just different odds.
  const starClass: StarClass = weightedPick(rng,
    ['red-dwarf', 'orange', 'yellow', 'white-blue', 'blue-giant'],
    palette.starWeights,
  );
  const preset = STAR_PRESETS[starClass];
  const starRadius = rng.range(preset.radius[0], preset.radius[1]);
  const name = makeSystemName(rng);
  const isRomantic = !name.includes('-') || /[A-Z][a-z]/.test(name.split('-')[0] ?? '');

  const planetCount = rng.int(4, 7);

  // Stage 1: pre-compute every planet's properties except final orbit a.
  const stubs: PlanetStub[] = [];
  for (let i = 0; i < planetCount; i++) {
    const zone: 'inner' | 'mid' | 'outer' =
      i < planetCount * 0.33 ? 'inner' :
      i < planetCount * 0.7  ? 'mid' : 'outer';
    stubs.push(buildPlanetStub(rng, name, i, zone, isRomantic, palette));
  }

  // Stage 2: pack orbits sequentially. periapsis(i+1) - extent(i+1) > apoapsis(i) + extent(i) + gap.
  const planets: PlanetData[] = [];
  // First planet starts a comfortable distance off the star.
  let prevApoExt = starRadius * 2.8;
  for (let i = 0; i < planetCount; i++) {
    const stub = stubs[i];
    const gap = pickPlanetGap(rng);
    const requiredPeriInner = prevApoExt + gap; // inner edge of this planet's path must clear here
    const a = (requiredPeriInner + stub.bodyExtent) / Math.max(0.001, 1 - stub.eccentricity);
    planets.push(finalizePlanet(rng, stub, i, a));
    prevApoExt = a * (1 + stub.eccentricity) + stub.bodyExtent;
  }

  const economy = pickEconomy(rng, planets);
  const description = rng.pick(SYSTEM_DESC_TEMPLATES[economy]);

  return {
    // W9 — galaxy-prefixed system IDs so each galaxy lives in its own
    // namespace. Empire saves and the relay both use plain strings, so the
    // prefix just makes lookups across the universe unambiguous.
    id: `${idPrefix}:sys-${rng.int(0, 1e9).toString(36)}`,
    name,
    starClass,
    starColor: preset.color,
    starRadius,
    position,
    planets,
    economy,
    description,
  };
}

// Worst-case radial reach of a system — outermost planet apoapsis plus its
// own body extent (rings, moon system).
function systemOuterExtent(s: SystemData): number {
  let max = s.starRadius * 4.0;
  for (const p of s.planets) {
    let planetReach = Math.max(p.radius, p.ringOuter);
    for (const m of p.moons) {
      planetReach = Math.max(planetReach, m.orbitRadius * (1 + m.orbitEccentricity) + m.radius);
    }
    const apo = p.orbitRadius * (1 + p.orbitEccentricity);
    max = Math.max(max, apo + planetReach);
  }
  return max;
}

// W9 — single-galaxy generator (used by generateUniverse for each entry).
// Accepts the full GalaxyData shape with palette + radius + position so the
// main galaxy and the smaller satellites all flow through the same code path.
export interface GalaxySpec {
  id: string;
  name: string;
  seed: number;
  position: [number, number, number];
  radius: number;
  palette: GalaxyPalette;
  tilt: [number, number, number];
}

export function generateGalaxy(spec: GalaxySpec): GalaxyData {
  const rng = new Rng(spec.seed);
  const arms = spec.palette.arms;
  const armSpread = 0.55;
  const twist = spec.palette.spiralTwist;
  const radius = spec.radius;
  const thickness = spec.palette.thickness;
  const innerRadius = spec.palette.innerCutout;
  const systemCount = spec.palette.systemCount;

  const systems: SystemData[] = [];
  const extents: number[] = [];

  // Separation scales with the galaxy size so satellite galaxies still feel
  // dense — a 9k-radius galaxy with 600-unit min separation looks empty.
  const minSeparation = Math.max(700, radius * 0.06);
  const buffer = Math.max(200, radius * 0.014);

  let attempts = 0;
  const maxAttempts = systemCount * 200;
  while (systems.length < systemCount && attempts < maxAttempts) {
    attempts++;

    // Two sampling modes:
    //   - uniform spiral-arm sampling (default)
    //   - cluster bias: drop near a random existing system, creating
    //     overdensities and natural voids instead of an even Poisson grid.
    let x: number;
    let z: number;
    let y: number;

    if (systems.length > 8 && rng.bool(0.55)) {
      const seed = rng.pick(systems);
      // Power-law biased radius (exp > 1 = bias toward small): lots of close
      // neighbours forming a tight clump, occasional outliers at the edge.
      // Scales with the galaxy radius so smaller satellite galaxies still
      // produce tight clusters relative to their disk.
      const jitterR = Math.pow(rng.next(), 1.7) * radius * 0.24;
      const jitterAngle = rng.range(0, Math.PI * 2);
      x = seed.position[0] + Math.cos(jitterAngle) * jitterR;
      z = seed.position[2] + Math.sin(jitterAngle) * jitterR;
      y = seed.position[1] + rng.gauss() * thickness * 0.6;
      const rr = Math.sqrt(x * x + z * z);
      if (rr < innerRadius || rr > radius) continue;
    } else {
      const arm = rng.int(0, arms - 1);
      const t = Math.pow(rng.next(), 0.55);
      const armOffset = (arm * Math.PI * 2) / arms;
      const angle = armOffset + t * twist + rng.gauss() * armSpread * (1 - t * 0.4);
      const r = innerRadius + t * (radius - innerRadius);
      x = Math.cos(angle) * r;
      z = Math.sin(angle) * r;
      y = rng.gauss() * thickness * (1 - t * 0.5);
    }

    // Build the candidate system first so we know its actual outer reach
    // before deciding whether it fits.
    const candidate = makeSystem(rng, [x, y, z], spec.palette, spec.id);
    const candExt = systemOuterExtent(candidate);

    let tooClose = false;
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i]!;
      const sExt = extents[i]!;
      const minD = Math.max(minSeparation, candExt + sExt + buffer);
      const dx = s.position[0] - x;
      const dz = s.position[2] - z;
      if (dx * dx + dz * dz < minD * minD) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    systems.push(candidate);
    extents.push(candExt);
  }

  return {
    id: spec.id,
    name: spec.name,
    position: spec.position,
    systems,
    radius,
    palette: spec.palette,
    tilt: spec.tilt,
  };
}

// W9 — palette presets for each playable galaxy. Star/planet weighting drives
// the procedural feel ("blue giant frontier" vs "red dwarf graveyard"); the
// bulge + arm colours are used by the universe-view billboard so each galaxy
// reads distinctly from far away.
export const MAIN_PALETTE: GalaxyPalette = {
  starWeights:   { 'red-dwarf': 2, orange: 2, yellow: 2, 'white-blue': 1, 'blue-giant': 0.5 },
  planetWeights: {},  // even distribution (default 1)
  systemCount: 200,
  arms: 4,
  twist: 5.5,
  thickness: 1800,
  bulgeColor: [1.00, 0.88, 0.65],
  armColor:   [0.55, 0.78, 1.00],
  innerCutout: 3500,
  spiralTwist: 3.6,
};

const ANDROMEDA_PALETTE: GalaxyPalette = {
  starWeights:   { 'red-dwarf': 0.5, orange: 1, yellow: 1, 'white-blue': 3, 'blue-giant': 2 },
  planetWeights: { gas: 1.5, ocean: 1.5, ice: 0.7 },
  systemCount: 90,
  arms: 4,
  twist: 4.8,
  thickness: 1100,
  bulgeColor: [0.78, 0.92, 1.00],
  armColor:   [0.45, 0.70, 1.00],
  innerCutout: 2400,
  spiralTwist: 3.2,
};

const MAGELLAN_PALETTE: GalaxyPalette = {
  // Small irregular satellite — lots of red dwarfs, fewer planet types.
  starWeights:   { 'red-dwarf': 4, orange: 2, yellow: 0.6, 'white-blue': 0.2, 'blue-giant': 0.05 },
  planetWeights: { rocky: 1.5, lava: 1.5, desert: 1.5, gas: 0.4 },
  systemCount: 60,
  arms: 2,
  twist: 6.5,
  thickness: 700,
  bulgeColor: [1.00, 0.62, 0.42],
  armColor:   [1.00, 0.45, 0.30],
  innerCutout: 1200,
  spiralTwist: 2.4,
};

const SOMBRERO_PALETTE: GalaxyPalette = {
  starWeights:   { 'red-dwarf': 1.5, orange: 2, yellow: 1, 'white-blue': 0.8, 'blue-giant': 1 },
  planetWeights: { gas: 3, toxic: 1.5, ice: 1.2 },
  systemCount: 80,
  arms: 3,
  twist: 7.2,
  thickness: 2400,  // notoriously thick disc
  bulgeColor: [1.00, 0.80, 0.55],
  armColor:   [0.85, 0.50, 0.35],
  innerCutout: 2000,
  spiralTwist: 4.0,
};

const PINWHEEL_PALETTE: GalaxyPalette = {
  starWeights:   { 'red-dwarf': 1, orange: 1.5, yellow: 2, 'white-blue': 1.5, 'blue-giant': 0.8 },
  planetWeights: { ocean: 2, rocky: 1.5, ice: 1 },
  systemCount: 100,
  arms: 6,  // ultra-grand-design spiral
  twist: 4.0,
  thickness: 900,
  bulgeColor: [1.00, 0.92, 0.78],
  armColor:   [0.85, 0.50, 1.00],
  innerCutout: 2200,
  spiralTwist: 4.4,
};

const TRIANGULUM_PALETTE: GalaxyPalette = {
  starWeights:   { 'red-dwarf': 3, orange: 1, yellow: 0.5, 'white-blue': 0.4, 'blue-giant': 0.1 },
  planetWeights: { ice: 3, toxic: 2, gas: 2, ocean: 0.5 },
  systemCount: 65,
  arms: 3,
  twist: 6.0,
  thickness: 800,
  bulgeColor: [0.85, 1.00, 0.92],
  armColor:   [0.50, 0.95, 0.78],
  innerCutout: 1500,
  spiralTwist: 3.0,
};

// W9 — universe builder. Main galaxy at origin (where every player spawns),
// 5 satellite galaxies arranged at varied positions ~150-220k away. Each
// galaxy seeded off the main seed so the same seed produces the same universe.
export function generateUniverse(seed: number): UniverseData {
  const galaxies: GalaxyData[] = [];

  galaxies.push(generateGalaxy({
    id: 'milky-way',
    name: 'Milky Way',
    seed,
    position: [0, 0, 0],
    radius: 28000,
    palette: MAIN_PALETTE,
    tilt: [0, 0, 0],
  }));

  // Satellite galaxies. Positions chosen by hand so they spread across the
  // celestial sphere — the universe view should always show 3-4 of them.
  const extras: { id: string; name: string; offset: number; pos: [number, number, number]; tilt: [number, number, number]; radius: number; palette: GalaxyPalette }[] = [
    { id: 'andromeda',  name: 'Andromeda',  offset: 1, pos: [-180000,  35000, -150000], tilt: [ 0.30, 0.00,  0.40], radius: 18000, palette: ANDROMEDA_PALETTE },
    { id: 'magellan',   name: 'Magellan',   offset: 2, pos: [ 200000, -20000, -120000], tilt: [-0.20, 0.10,  0.30], radius:  9000, palette: MAGELLAN_PALETTE  },
    { id: 'sombrero',   name: 'Sombrero',   offset: 3, pos: [ 160000,  50000,  170000], tilt: [ 0.05, 0.20, -0.60], radius: 14000, palette: SOMBRERO_PALETTE  },
    { id: 'pinwheel',   name: 'Pinwheel',   offset: 4, pos: [-220000, -30000,  140000], tilt: [-0.40, 0.15,  0.20], radius: 16000, palette: PINWHEEL_PALETTE  },
    { id: 'triangulum', name: 'Triangulum', offset: 5, pos: [-100000,  60000,  220000], tilt: [ 0.20, -0.30, 0.50], radius: 12000, palette: TRIANGULUM_PALETTE},
  ];
  for (const e of extras) {
    galaxies.push(generateGalaxy({
      id: e.id,
      name: e.name,
      seed: seed + e.offset,
      position: e.pos,
      radius: e.radius,
      palette: e.palette,
      tilt: e.tilt,
    }));
  }

  return { galaxies };
}
