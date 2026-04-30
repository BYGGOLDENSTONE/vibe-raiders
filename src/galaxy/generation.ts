import type {
  EconomyKind,
  GalaxyData,
  MoonData,
  PlanetData,
  PlanetType,
  RiskLevel,
  StarClass,
  SystemData,
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
): PlanetStub {
  const type: PlanetType = rng.pick(PLANET_TYPES_BY_ZONE[zone]);
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

function makeSystem(rng: Rng, position: [number, number, number]): SystemData {
  const starClass: StarClass = rng.pick([
    'red-dwarf', 'red-dwarf', 'orange', 'orange', 'yellow', 'yellow', 'white-blue', 'blue-giant',
  ]);
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
    stubs.push(buildPlanetStub(rng, name, i, zone, isRomantic));
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
    id: `sys-${rng.int(0, 1e9).toString(36)}`,
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

// Spiral arm placement
export function generateGalaxy(seed: number, systemCount = 200): GalaxyData {
  const rng = new Rng(seed);
  const arms = 4;
  const armSpread = 0.55;
  const twist = 3.6;
  const radius = 10000;
  const thickness = 120;
  const innerRadius = 1500; // outside the supermassive black hole, with breathing room

  const systems: SystemData[] = [];
  const extents: number[] = [];

  // Hard floor for any pair regardless of how small both systems are. The
  // real exclusion radius is `extent_a + extent_b + buffer`, which scales up
  // for bigger systems with eccentric orbits and wide moon families.
  const minSeparation = 600;
  const buffer = 140;

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
      const jitterR = Math.pow(rng.next(), 1.7) * 2400;
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
    const candidate = makeSystem(rng, [x, y, z]);
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

  return { systems, radius };
}
