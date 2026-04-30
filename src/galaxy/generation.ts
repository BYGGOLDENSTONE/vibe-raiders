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
  const tail = rng.bool(0.55) ? ' Sistemi' : ` ${rng.pick(['Çekirdeği', 'Kuşağı', 'Hattı', 'Kapısı'])}`;
  return `${base}${tail}`;
}

function makePlanetName(rng: Rng, systemName: string, index: number, isRomanticSystem: boolean): string {
  if (isRomanticSystem && rng.bool(0.7)) {
    const given = rng.pick(PLANET_GIVEN_NAMES);
    const suf = rng.pick(PLANET_SUFFIXES);
    return `${given}${suf}`;
  }
  // tech style: SystemName + roman or letter
  const stripped = systemName.replace(/ (Sistemi|Çekirdeği|Kuşağı|Hattı|Kapısı)$/, '');
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
  rocky:  ['Demir', 'Titanyum', 'Nikel', 'Bakır'],
  ocean:  ['Su', 'Gıda', 'Hidrojen'],
  gas:    ['Yakıt', 'Helyum-3', 'Hidrojen'],
  ice:    ['Kristal', 'Donmuş gaz', 'Su'],
  lava:   ['Plazma', 'Enerji', 'Volkanik metal'],
  desert: ['Silikon', 'Cam', 'Nadir mineral'],
  toxic:  ['Kimyasal', 'Asit', 'Eksotik gaz'],
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
  'colony-core':     ['Yaşanabilir kuşağı geniş, kararlı bir koloni çekirdeği.', 'Erken yerleşimcilerin tutunduğu, ılıman kuşaklı sistem.'],
  'science-line':    ['Soğuk ışıklı, az gezegenli bir araştırma hattı.', 'Sessiz yıldızı altında dönen ileri laboratuvar sistemi.'],
  'trade-hub':       ['Yakın rota kavşağına oturmuş, hareketli bir ticaret düğümü.', 'Birden fazla geçidi kesen, canlı bir ticaret durağı.'],
  'frontier-mining': ['Sınırda ham kaynak değeri yüksek bir madencilik sistemi.', 'Karanlık ve kompakt; ucuz ama çetin bir maden hattı.'],
  'tourism-belt':    ['Parlak renkli yörüngeleriyle bilinen turizm kuşağı.', 'Görsel zenginliğiyle ünlü, yoğun yolcu trafiği taşıyan sistem.'],
  'industrial':      ['Yoğun rafinerileriyle ağır endüstri merkezi.', 'Atmosferi her zaman kor halinde, üretim odaklı sistem.'],
  'military':        ['Sıkı yörünge ağıyla korunan askeri üs.', 'Filo manevralarına uygun, yüksek alarm seviyesindeki sistem.'],
  'lost-colony':     ['Eski yerleşimcilerin terk ettiği, kayıp koloni sistemi.', 'Hatalardan ders kalmış, sessizce dönen unutulmuş sistem.'],
  'empty':           ['Harita üzerinde adı geçen ama aslında ıssız sistem.', 'Yıldızı dışında pek bir şey barındırmayan boş sistem.'],
};

const PLANET_DESC_TEMPLATES: Record<PlanetType, string[]> = {
  rocky: [
    'Kayalık yüzeyi maden damarlarıyla örülü, sade ama kazançlı dünya.',
    'İnce atmosferi altında metal-zengin platolar uzanan bir gezegen.',
  ],
  ocean: [
    'Mavi okyanusları ve dengeli iklimiyle yaşam taşıyan bir dünya.',
    'Sığ denizleri turkuaz parlayan, ılıman kuşaklı parlak gezegen.',
  ],
  gas: [
    'Geniş bantları ve devasa fırtınalarıyla bilinen yakıt deposu.',
    'Yörüngesinde uydu ve istasyon ağı barındırmaya uygun gaz devi.',
  ],
  ice: [
    'Buz kabuğunun altında nadir kimyasal rezervler barındıran soğuk dünya.',
    'Kristal yansımalı kuzey ve güney kalkanları olan donmuş gezegen.',
  ],
  lava: [
    'Aktif yüzeyi lav nehirleriyle damarlanmış, enerji açısından zengin dünya.',
    'Yıldızına çok yakın yörüngede pişen, plazma sızdıran kor gezegen.',
  ],
  desert: [
    'Kum okyanusları ve uzun gölgeli kanyonlarla yarılmış kuru dünya.',
    'Nadir mineral damarlarını saklayan, kavurucu ekvatorlu çöl gezegeni.',
  ],
  toxic: [
    'Yoğun zehirli atmosferi altında saklanan eksotik kimyasal dünya.',
    'Yeşilimsi sis bulutları arasında dönen, korumalı yaşam destekleyen gezegen.',
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

function makeMoon(rng: Rng, planetRadius: number, planetName: string, idx: number): MoonData {
  // Wide variation: tiny captured asteroid -> big companion moon (always < parent planet)
  const radius = planetRadius * rng.range(0.15, 0.45);
  const orbitRadius = planetRadius * rng.range(2.6, 4.4) + idx * planetRadius * 1.2;
  const tint = rng.range(0.55, 0.85);
  return {
    id: `m${idx}`,
    name: makeMoonName(planetName, idx),
    radius,
    orbitRadius,
    orbitSpeed: rng.range(0.18, 0.42),
    orbitPhase: rng.range(0, Math.PI * 2),
    orbitTilt: rng.range(-0.25, 0.25),
    color: [tint, tint * rng.range(0.9, 1.0), tint * rng.range(0.85, 0.95)],
  };
}

function makePlanet(
  rng: Rng,
  systemName: string,
  index: number,
  orbitRadius: number,
  zone: 'inner' | 'mid' | 'outer',
  isRomanticSystem: boolean,
): PlanetData {
  const type: PlanetType = rng.pick(PLANET_TYPES_BY_ZONE[zone]);
  const palette = PLANET_PALETTES[type];

  // Big variation but clamped under star sizes — star min 3.0 > planet max ~2.6
  const radius =
    type === 'gas'   ? rng.range(1.6, 2.6) :
    type === 'ocean' ? rng.range(0.8, 1.6) :
    type === 'ice'   ? rng.range(0.6, 1.3) :
    rng.range(0.4, 1.2);

  const name = makePlanetName(rng, systemName, index, isRomanticSystem);
  const moonCount = type === 'gas' ? rng.int(1, 3) : rng.bool(0.55) ? rng.int(1, 2) : 0;
  const moons: MoonData[] = [];
  for (let i = 0; i < moonCount; i++) moons.push(makeMoon(rng, radius, name, i));

  const hasRings = type === 'gas' && rng.bool(0.55);
  const ringInner = radius * rng.range(1.4, 1.7);
  const ringOuter = ringInner + radius * rng.range(0.6, 1.2);
  const ringTint = rng.range(0.6, 0.95);

  const baseTemp =
    zone === 'inner' ? rng.range(150, 600) :
    zone === 'mid'   ? rng.range(-40, 60)   :
    rng.range(-200, -60);

  const jitter = (c: [number, number, number]): [number, number, number] => [
    Math.min(1, Math.max(0, c[0] + rng.range(-0.06, 0.06))),
    Math.min(1, Math.max(0, c[1] + rng.range(-0.06, 0.06))),
    Math.min(1, Math.max(0, c[2] + rng.range(-0.06, 0.06))),
  ];

  const temperatureC = Math.round(baseTemp);
  const resource = rng.pick(RESOURCES_BY_TYPE[type]);
  const risk = riskFor({ type, temperatureC });
  const description = rng.pick(PLANET_DESC_TEMPLATES[type]);

  return {
    id: `p${index}`,
    name,
    type,
    radius,
    orbitRadius,
    orbitSpeed: rng.range(0.06, 0.16) / Math.sqrt(orbitRadius / 8),
    orbitPhase: rng.range(0, Math.PI * 2),
    orbitTilt: rng.range(-0.05, 0.05),
    axialTilt: rng.range(-0.45, 0.45),
    rotationSpeed: rng.range(0.02, 0.08) * (rng.bool(0.8) ? 1 : -1),
    temperatureC,
    hasRings,
    ringInner,
    ringOuter,
    ringColor: [ringTint, ringTint * 0.92, ringTint * 0.78],
    primaryColor: jitter(palette.primary),
    secondaryColor: jitter(palette.secondary),
    accentColor: jitter(palette.accent),
    noiseSeed: rng.range(0, 1000),
    moons,
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
  const name = makeSystemName(rng);
  const isRomantic = !name.includes('-') || /[A-Z][a-z]/.test(name.split('-')[0] ?? '');

  const planetCount = rng.int(4, 7);
  const planets: PlanetData[] = [];
  let prevOrbit = preset.radius[1] * 3.6;
  for (let i = 0; i < planetCount; i++) {
    const orbit = prevOrbit + rng.range(5.0, 8.0);
    const zone: 'inner' | 'mid' | 'outer' =
      i < planetCount * 0.33 ? 'inner' :
      i < planetCount * 0.7 ? 'mid' : 'outer';
    planets.push(makePlanet(rng, name, i, orbit, zone, isRomantic));
    prevOrbit = orbit;
  }

  const economy = pickEconomy(rng, planets);
  const description = rng.pick(SYSTEM_DESC_TEMPLATES[economy]);

  return {
    id: `sys-${rng.int(0, 1e9).toString(36)}`,
    name,
    starClass,
    starColor: preset.color,
    starRadius: rng.range(preset.radius[0], preset.radius[1]),
    position,
    planets,
    economy,
    description,
  };
}

// Spiral arm placement
export function generateGalaxy(seed: number, systemCount = 200): GalaxyData {
  const rng = new Rng(seed);
  const arms = 4;
  const armSpread = 0.55;
  const twist = 3.6;
  const radius = 7000;
  const thickness = 120;
  const innerRadius = 1500; // outside the supermassive black hole, with breathing room

  const systems: SystemData[] = [];
  const minDistance = 280;

  let attempts = 0;
  while (systems.length < systemCount && attempts < systemCount * 80) {
    attempts++;
    const arm = rng.int(0, arms - 1);
    const t = Math.pow(rng.next(), 0.55);
    const armOffset = (arm * Math.PI * 2) / arms;
    const angle = armOffset + t * twist + rng.gauss() * armSpread * (1 - t * 0.4);
    const r = innerRadius + t * (radius - innerRadius);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = rng.gauss() * thickness * (1 - t * 0.5);

    let tooClose = false;
    for (const s of systems) {
      const dx = s.position[0] - x;
      const dz = s.position[2] - z;
      if (dx * dx + dz * dz < minDistance * minDistance) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    systems.push(makeSystem(rng, [x, y, z]));
  }

  return { systems, radius };
}
