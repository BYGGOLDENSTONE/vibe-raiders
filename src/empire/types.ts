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
  | 'trade-hub';

// What buying a single node does. One effect per node — small and simple.
export type UpgradeEffect =
  | { kind: 'rate-add'; resource: ResourceKey; value: number }     // +X/s flat
  | { kind: 'rate-mul'; resource: ResourceKey; value: number }     // +X (e.g. 0.20 = +20%)
  | { kind: 'global-mul'; value: number }                          // +X global production
  | { kind: 'drone-count'; value: number }                         // +N drones
  | { kind: 'drone-speed'; value: number }                         // +X drone speed
  | { kind: 'drone-cargo'; value: number }                         // +X cargo
  | { kind: 'storage-mul'; value: number }                         // +X storage cap
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
  homeSystemId: string;
  homePlanetId: string;
  resources: ResourceBag;
  // Set of node ids the player has purchased. Order doesn't matter; using
  // an array because Set doesn't JSON-serialise without help.
  unlockedNodes: string[];
  ownedPlanets: string[];
  unlocks: UnlockFlag[];
  lastSavedAt: number;
}

export const STORAGE_KEY = 'vibecoder.empire.v3';
