// The empire layer — incremental gameplay built on top of the galaxy simulation.

import type { PlanetType } from '../galaxy/types';

// Seven resources, one per planet type.
export type ResourceKey =
  | 'metal'      // rocky
  | 'water'      // ocean
  | 'gas'        // gas
  | 'crystal'    // ice
  | 'plasma'     // lava
  | 'silicon'    // desert
  | 'chemical';  // toxic

export const RESOURCE_KEYS: ResourceKey[] = [
  'metal', 'water', 'gas', 'crystal', 'plasma', 'silicon', 'chemical',
];

export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  metal:    'Metal',
  water:    'Water',
  gas:      'Gas',
  crystal:  'Crystal',
  plasma:   'Plasma',
  silicon:  'Silicon',
  chemical: 'Chemical',
};

export const RESOURCE_COLOR: Record<ResourceKey, string> = {
  metal:    '#a9b3c4',
  water:    '#4ec3ff',
  gas:      '#f0a560',
  crystal:  '#9be8ff',
  plasma:   '#ff5b3a',
  silicon:  '#e6c97a',
  chemical: '#9bd64a',
};

export const PLANET_TYPE_RESOURCE: Record<PlanetType, ResourceKey> = {
  rocky:  'metal',
  ocean:  'water',
  gas:    'gas',
  ice:    'crystal',
  lava:   'plasma',
  desert: 'silicon',
  toxic:  'chemical',
};

// ---- Income model (W4) -----------------------------------------------------
//
// Every owned planet contributes a primary + secondary baseline income to the
// empire. Numbers are tuned for the incremental curve: starts at a few /s,
// reaches thousands once a system is fully claimed, millions when wormhole-tier
// systems come online, billions across multiple systems.
//
// The same income gets multiplied by:
//   - System tier (T1 = home, ×1; T2 = wormhole-claimed, ×100; ...)
//   - Planet-count synergy (+SYNERGY_PER_PLANET per owned planet, compound)
//   - Per-resource and global upgrade multipliers
//   - Drone throughput
export interface PlanetIncome {
  primary: { resource: ResourceKey; rate: number };
  secondary: { resource: ResourceKey; rate: number };
}

export const PLANET_INCOME: Record<PlanetType, PlanetIncome> = {
  // W10.1 — ocean is the habitable starting planet; rocky shifted to crystal/metal.
  ocean:  { primary: { resource: 'metal',    rate: 3 }, secondary: { resource: 'water',  rate: 1.5 } },
  rocky:  { primary: { resource: 'crystal',  rate: 3 }, secondary: { resource: 'metal',  rate: 1.5 } },
  gas:    { primary: { resource: 'gas',      rate: 3 }, secondary: { resource: 'plasma', rate: 1.5 } },
  ice:    { primary: { resource: 'crystal',  rate: 3 }, secondary: { resource: 'water',  rate: 1.5 } },
  lava:   { primary: { resource: 'plasma',   rate: 3 }, secondary: { resource: 'metal',  rate: 1.5 } },
  desert: { primary: { resource: 'silicon',  rate: 3 }, secondary: { resource: 'metal',  rate: 1.5 } },
  toxic:  { primary: { resource: 'chemical', rate: 3 }, secondary: { resource: 'gas',    rate: 1.5 } },
};

// Phase 2 (Moon Outpost) unlock — only the player-chosen outpost moon
// contributes this rate (scaled by its system tier). Pre-W4-C this was a
// per-moon-of-every-owned-planet flat add, which compounded badly.
export const MOON_OUTPOST_INCOME = { resource: 'crystal' as ResourceKey, rate: 5 };

// Each owned planet adds this much to a global synergy multiplier (compound).
// 7-planet full home system → 1 + 0.2 × 7 = 2.4× global from synergy alone.
export const SYNERGY_PER_PLANET = 0.2;

// Each new system tier multiplies that system's planets by this base.
// Home (T1) ×1, T2 (in-galaxy wormhole) ×100, T3 (intergalactic bridge) ×10,000,
// T4 (wormhole inside an extra galaxy) ×1,000,000.
export const SYSTEM_TIER_BASE = 100;

// W4-C balance: bumped 1000 → 1500 so Phase 3 (Space Elevator @ 1500 metal)
// fits in a fresh save's storage cap without first buying Storage Bays I.
export const BASE_STORAGE_CAP = 1500;

export type ResourceBag = Record<ResourceKey, number>;

export function emptyBag(): ResourceBag {
  return { metal: 0, water: 0, gas: 0, crystal: 0, plasma: 0, silicon: 0, chemical: 0 };
}

// --- Upgrades ---------------------------------------------------------------
//
// Each upgrade is a single node in a graph. Tiers are separate sibling nodes
// on a chain (Metal Mining I, II, III, ...) so the player sees concrete
// progress through the tree.

export type UpgradeCategory = 'production' | 'drones' | 'logistics' | 'expansion' | 'tech';

export type UnlockFlag =
  | 'moon-outpost'
  | 'space-elevator'
  | 'fleet-shipyard'
  | 'system-expansion'
  | 'wormhole-observatory'
  | 'wormhole-transit'
  | 'trade-hub'
  | 'intergalactic-bridge';

// What buying a single node does. One effect per node — small and simple.
export type UpgradeEffect =
  | { kind: 'rate-add'; resource: ResourceKey; value: number }     // +X/s flat
  | { kind: 'rate-mul'; resource: ResourceKey; value: number }     // +X (e.g. 0.20 = +20%)
  | { kind: 'global-mul'; value: number }                          // +X global production
  | { kind: 'drone-count'; value: number }                         // +N drones
  | { kind: 'drone-speed'; value: number }                         // +X drone speed
  | { kind: 'drone-cargo'; value: number }                         // +X cargo
  | { kind: 'storage-mul'; value: number }                         // +X storage cap
  // W13 — multiplies the auto-claim attempt rate. Each tier halves the
  // interval (e.g. value=1 → ×2 attempts/sec). Stacks additively across
  // tiers, so the three Auto-Annex Drones nodes give ×8 total.
  | { kind: 'auto-rate'; value: number }
  | { kind: 'unlock'; flag: UnlockFlag };

export interface UpgradeNode {
  id: string;
  name: string;             // e.g. "Metal Mining"
  tierLabel: string;        // "I", "II", "III"...
  category: UpgradeCategory;
  description: string;      // short, e.g. "+0.4 metal/s"
  cost: Partial<ResourceBag>;
  effect: UpgradeEffect;
  // Single prereq node id; node only becomes purchasable once that node is owned.
  prereq?: string;
  // Soft visibility gate — node hidden until the unlock is granted.
  requiresUnlock?: UnlockFlag;
  // Only show if player owns a planet producing this resource (for production chains).
  requiresResource?: ResourceKey;
  // Layout: position on the 2D skill-tree canvas.
  x: number;
  y: number;
}

// --- Empire state -----------------------------------------------------------

export interface EmpireState {
  seed: number;
  // W5: every fresh save auto-bootstraps a homeworld via pickStartingPlanet
  // (single-player flow; W6 multiplayer will swap this for a coordinated
  // claim). homeClaimed=false is now only a fallback if the picker can't find
  // an eligible planet — in that pathological case the empire stays dormant.
  homeClaimed: boolean;
  homeSystemId: string;
  homePlanetId: string;
  resources: ResourceBag;
  unlockedNodes: string[];
  ownedPlanets: string[];
  unlocks: UnlockFlag[];
  claimedSystems: Record<string, number>;
  // Set after the player buys `moon-outpost` AND clicks a moon to host it.
  // Only this moon contributes MOON_OUTPOST_INCOME and renders the dome/tether.
  outpostMoonId: string | null;
  lastSavedAt: number;
}

// W10.1 — bumped from v9: planet IDs are now globally unique (`<systemId>:p<i>`)
// so old saves' homePlanetId / ownedPlanets entries (`p2`, `p3`, …) resolve to
// nothing. Old saves auto-discard so every player picks up a clean homeworld
// keyed against the new ID format.
export const STORAGE_KEY_SOLO = 'vibecoder.empire.v10';
// W6 — multiplayer keeps a separate save so the solo career isn't disturbed
// when the player drops into a shared galaxy and back. Also bumped for W10.1.
export const STORAGE_KEY_MP = 'vibecoder.empire.mp.v5';

// Game mode determines which save slot is used and whether multiplayer state
// is wired up. Selected on the start screen and threaded through Empire +
// upstream UI so neither layer has to import multiplayer code unconditionally.
export type GameMode = 'solo' | 'mp';

export function storageKeyFor(mode: GameMode): string {
  return mode === 'mp' ? STORAGE_KEY_MP : STORAGE_KEY_SOLO;
}
