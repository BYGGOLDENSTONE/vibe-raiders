export type PlanetType =
  | 'rocky'
  | 'ocean'
  | 'gas'
  | 'ice'
  | 'lava'
  | 'desert'
  | 'toxic';

export type StarClass =
  | 'red-dwarf'
  | 'orange'
  | 'yellow'
  | 'white-blue'
  | 'blue-giant';

export type EconomyKind =
  | 'colony-core'
  | 'science-line'
  | 'trade-hub'
  | 'frontier-mining'
  | 'tourism-belt'
  | 'industrial'
  | 'military'
  | 'lost-colony'
  | 'empty';

export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface MoonData {
  id: string;
  name: string;
  radius: number;
  orbitRadius: number;        // semi-major axis
  orbitEccentricity: number;  // 0 = circular, < 1 = ellipse
  orbitOmega: number;         // argument of periapsis (rotation of major axis around Y)
  orbitSpeed: number;
  orbitPhase: number;         // initial true anomaly
  orbitTilt: number;
  color: [number, number, number];
}

export interface PlanetData {
  id: string;
  name: string;
  type: PlanetType;
  radius: number;
  orbitRadius: number;        // semi-major axis
  orbitEccentricity: number;  // 0 = circular
  orbitOmega: number;         // argument of periapsis
  orbitSpeed: number;
  orbitPhase: number;         // initial true anomaly
  orbitTilt: number;
  axialTilt: number;
  rotationSpeed: number;
  temperatureC: number;
  hasRings: boolean;
  ringInner: number;
  ringOuter: number;
  ringColor: [number, number, number];
  primaryColor: [number, number, number];
  secondaryColor: [number, number, number];
  accentColor: [number, number, number];
  noiseSeed: number;
  moons: MoonData[];
  // Lore
  resource: string;
  risk: RiskLevel;
  description: string;
}

export interface SystemData {
  id: string;
  name: string;
  starClass: StarClass;
  starColor: [number, number, number];
  starRadius: number;
  position: [number, number, number];
  planets: PlanetData[];
  // Lore
  economy: EconomyKind;
  description: string;
}

// W9 — palette drives per-galaxy star/planet weighting + visual disc colours.
// Each entry's weight is multiplied by 1.0 if missing (no penalty), > 1 to
// favour, < 1 to suppress. Lets us bias one galaxy toward red dwarfs and ice
// planets while another is dominated by blue giants and gas giants.
export interface GalaxyPalette {
  starWeights: Partial<Record<StarClass, number>>;
  planetWeights: Partial<Record<PlanetType, number>>;
  systemCount: number;
  arms: number;        // visual disk arms (also drives bulge billboard)
  twist: number;       // log-spiral pitch
  thickness: number;   // disk vertical scatter (smaller = flatter disk)
  bulgeColor: [number, number, number];  // inner colour for distant LOD
  armColor:   [number, number, number];  // outer colour for arms
  innerCutout: number;     // void around galactic centre
  spiralTwist: number;     // generation arm twist
}

export interface GalaxyData {
  id: string;          // 'milky-way', 'andromeda', 'magellan', ...
  name: string;
  position: [number, number, number];  // origin in universe space
  systems: SystemData[];
  radius: number;
  palette: GalaxyPalette;
  // Visual disc orientation in universe space — small offsets so each galaxy
  // sits at a different angle, like the real Local Group.
  tilt: [number, number, number];
}

// W9 — top-level container for everything navigable. galaxies[0] is always the
// main galaxy where new players spawn; subsequent entries are the extras
// reachable through the Intergalactic Bridge unlock.
export interface UniverseData {
  galaxies: GalaxyData[];
}

export type LayerKind = 'universe' | 'galaxy' | 'system' | 'planet';

export interface LayerState {
  kind: LayerKind;
  // W9 — which galaxy the current view belongs to. null only in 'universe' view.
  galaxyId: string | null;
  systemId: string | null;
  planetId: string | null;
}
