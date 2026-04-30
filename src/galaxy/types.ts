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
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  orbitTilt: number;
  color: [number, number, number];
}

export interface PlanetData {
  id: string;
  name: string;
  type: PlanetType;
  radius: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
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

export interface GalaxyData {
  systems: SystemData[];
  radius: number;
}

export type LayerKind = 'galaxy' | 'system' | 'planet';

export interface LayerState {
  kind: LayerKind;
  systemId: string | null;
  planetId: string | null;
}
