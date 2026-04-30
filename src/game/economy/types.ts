// Portal Empires — economy types.
// Locked at Wave 0. All gameplay subagents import from here.
// Keep this file dependency-free (no Three.js imports) so server can mirror types.

export type Vec3Tuple = [number, number, number];

// ---------- Resources ----------

export type ResourceId = 'credits' | 'ore' | 'capital' | 'alloy' | 'data';

export interface ResourceState {
  credits: number;
  ore: number;
  capital: number;
  alloy: number;
  data: number;
}

export interface ResourceLifetime {
  credits: number;
  ore: number;
  capital: number;
  alloy: number;
  data: number;
}

// ---------- Galactic demand ----------

export interface GalacticDemand {
  credits: number;   // 0.7..1.3 multiplier
  ore: number;
  capital: number;
  alloy: number;
  data: number;
  expiresAtMs: number;
}

// ---------- Planets ----------

export type PlanetKind = 'home' | 'rocky' | 'gas' | 'ice' | 'neutral';

export type PlanetSpecialization =
  | 'industrial'
  | 'mining'
  | 'hub'
  | 'research'
  | 'refinery';

export type BuildingId =
  | 'refinery'
  | 'foundry'
  | 'lab'
  | 'beacon'
  | 'silo'
  | 'autoDispatcher'
  | 'defenseGrid';

export interface PlanetDef {
  id: string;
  name: string;
  kind: PlanetKind;
  sectorId: number;
  position: Vec3Tuple;
  // Whether this planet is the default home for its sector.
  isHomeOfSector: boolean;
  // True if this is a contested neutral planet between sectors.
  isNeutral: boolean;
  // Generator-side seed for procedural surface details.
  surfaceSeed: number;
}

export interface PlanetState {
  id: string;
  ownerId: string | null;
  unlocked: boolean;
  level: number;                                  // 1..20
  specialization: PlanetSpecialization | null;    // chosen at level 5
  buildings: BuildingId[];                        // up to 3 slots
  cityIntensity: number;                          // 0..1, shader uniform
}

// ---------- Routes ----------

export type RouteKind = 'internal' | 'cross';

export interface RouteDef {
  id: string;
  kind: RouteKind;
  fromPlanetId: string;
  toPlanetId: string;
  ownerId: string;          // for internal: route owner; for cross: the proposer
  partnerId?: string;       // present iff kind === 'cross'
  level: number;
  capacity: number;
  travelTimeMs: number;
  valuePerDelivery: number;
}

// ---------- Ships (trajectory broadcast) ----------

export interface ShipTrajectory {
  shipId: string;
  ownerId: string;
  routeId: string;
  fromPlanetId: string;
  toPlanetId: string;
  departTimeMs: number;     // shared clock domain (server time)
  durationMs: number;
  arcSeed: number;
  payload: number;          // resource amount
  payloadKind: ResourceId;
}

// ---------- Upgrade tree ----------

export type UpgradeBranch = 'production' | 'material' | 'logistics' | 'infrastructure' | 'research';

export type UpgradeScope = 'empire' | 'planet';

export interface UpgradeDef {
  id: string;
  branch: UpgradeBranch;
  scope: UpgradeScope;
  label: string;
  description: string;
  prereqs: string[];        // upgrade ids that must be > 0
  maxLevel: number;
  baseCost: ResourceCost;
  costGrowth: number;       // multiplicative per level (1.45 / 1.6 / 1.85)
  tier: 1 | 2 | 3;
}

export interface ResourceCost {
  credits?: number;
  ore?: number;
  capital?: number;
  alloy?: number;
  data?: number;
}

// ---------- Empire snapshot (what flows over the wire) ----------

export interface EmpireSnapshot {
  playerId: string;
  name: string;
  color: number;            // hex
  sectorId: number;
  planets: PlanetState[];
  routes: RouteDef[];
  resources: ResourceState;
  lifetime: ResourceLifetime;
  upgradeLevels: Record<string, number>;
  empireValue: number;
  dormant: boolean;
  lastUpdate: number;       // server time ms
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  color: number;
  empireValue: number;
  online: boolean;
}

// ---------- Galactic events ----------

export type GalacticEventKind = 'storm' | 'boom' | 'flare' | 'demandSpike';

export interface GalacticEvent {
  id: string;
  kind: GalacticEventKind;
  sectorId: number;
  startedAtMs: number;
  durationMs: number;
  // For demandSpike, which resource is spiking.
  resource?: ResourceId;
  multiplier?: number;
}

// ---------- Limits (mirrored on server) ----------

export interface EconomyLimits {
  maxEmpireValue: number;
  maxCreditsPerSecond: number;
  maxPlanetsOwned: number;
  maxRoutes: number;
  maxShipSpeed: number;
  maxRoomPlayers: number;
  maxPlanetLevel: number;
}

export const LIMITS: EconomyLimits = {
  maxEmpireValue: 1e15,
  maxCreditsPerSecond: 1e12,
  maxPlanetsOwned: 10,
  maxRoutes: 30,
  maxShipSpeed: 80,
  maxRoomPlayers: 16,
  maxPlanetLevel: 20,
};

// Galaxy structural constants used by both seed generator and rendering.
export const GALAXY = {
  totalPlanets: 100,
  totalSectors: 16,
  // Wormhole sits at galactic center.
  wormholePos: [0, 0, 0] as Vec3Tuple,
  // Galactic disc radius (units in scene space).
  discRadius: 80,
  // Vertical jitter for planets.
  discThickness: 6,
} as const;
