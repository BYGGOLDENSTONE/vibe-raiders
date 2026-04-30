// Upgrade catalogue — organic skill-tree layout in the spirit of incremental
// games (Path of Exile-style passive trees, Synergism, Idle Slayer). Instead
// of placing each category in its own band, chains are interleaved so the
// canvas reads as one sprawling network. Cross-category prerequisites bridge
// between branches (e.g. Industrial Doctrine requires Storage Bays II).
//
// Coordinate system: integer grid where each step = 140 px. The catalogue
// emits real pixel coordinates by multiplying.
//
// Key axes:
//   CORE         (col=0,  row=0)
//   UP column    Expansion chain at col=0, rows -1..-7
//   EAST half    Resource mining + optimisation chains
//   WEST half    Logistics, Drones, Tech (all interleaved across rows)
// Edges are rendered as straight or L-shaped paths by the panel renderer.

import {
  RESOURCE_KEYS,
  type ResourceBag,
  type ResourceKey,
  type UnlockFlag,
  type UpgradeEffect,
  type UpgradeNode,
} from './types';

const TIER_LABEL = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const TIERS = 6;
const STEP = 140;
const grid = (col: number, row: number): { x: number; y: number } => ({ x: col * STEP, y: row * STEP });

// --- Cost helpers ----------------------------------------------------------

function blendedCost(p: ResourceKey, pb: number, s: ResourceKey, sb: number, growth: number, t: number): Partial<ResourceBag> {
  const m = Math.pow(growth, t);
  const c: Partial<ResourceBag> = {};
  c[p] = Math.round(pb * m * 10) / 10;
  // When the secondary resource matches the primary, accumulate instead of
  // overwriting (otherwise sb=0 would zero out the primary cost).
  if (sb > 0) {
    c[s] = (c[s] ?? 0) + Math.round(sb * m * 10) / 10;
  }
  return c;
}

// Tier-aware cost for west chains. Every player starts with rocky home
// (metal + water income), so Tier I-III costs are payable from the home
// resources alone. Tier IV-VI add crystal — by then the player has bought
// Phase 2 (Moon Outpost), and moons drip crystal income.
function tieredCost(metalBase: number, growth: number, t: number): Partial<ResourceBag> {
  const m = Math.pow(growth, t);
  const out: Partial<ResourceBag> = {
    metal: Math.round(metalBase * m * 10) / 10,
    water: Math.round(metalBase * 0.5 * m * 10) / 10,
  };
  if (t >= 3) {
    out.crystal = Math.round(metalBase * 0.3 * m * 10) / 10;
  }
  return out;
}

interface ProdRecipe {
  resource: ResourceKey;
  name: string;
}
const PRODUCTION_RECIPES: ProdRecipe[] = [
  { resource: 'metal',    name: 'Metal Refinery'   },
  { resource: 'water',    name: 'Water Pumping'    },
  { resource: 'gas',      name: 'Gas Compression'  },
  { resource: 'crystal',  name: 'Crystal Lab'      },
  { resource: 'plasma',   name: 'Plasma Extraction'},
  { resource: 'silicon',  name: 'Silicon Works'    },
  { resource: 'chemical', name: 'Chemical Plant'   },
];

// Big multipliers — the new economy has planet income as the flat baseline,
// so production upgrades are pure boost. Sum of tiers ≈ ×16.5 per resource.
const PROD_MUL_PER_TIER  = [0.25, 0.50, 1.00, 2.00, 4.00, 8.00];

// Per-resource row position on the legacy x/y canvas (still used for save data
// and the optional spatial layout). Resources alternate above and below row 0.
const PROD_ROWS: Record<ResourceKey, number> = {
  metal:    0,
  water:   -1,
  gas:      1,
  crystal: -2,
  plasma:   2,
  silicon: -3,
  chemical: 3,
};

// --- Build the catalogue ---------------------------------------------------

function buildCatalogue(): UpgradeNode[] {
  const out: UpgradeNode[] = [];

  // ---------- CORE ----------------------------------------------------------
  out.push({
    id: 'core',
    name: 'Empire Core',
    tierLabel: '◉',
    category: 'expansion',
    description: 'Your empire begins here.',
    cost: {},
    effect: { kind: 'global-mul', value: 0 },
    ...grid(0, 0),
  });

  // ---------- EXPANSION (UP column) ----------------------------------------
  type ExpStep = {
    id: string; name: string; cost: Partial<ResourceBag>;
    flag: UnlockFlag; desc: string;
    extraPrereq?: string; requiresUnlock?: UnlockFlag;
  };
  // Milestones grow geometrically. Pre-Phase 2 the player only has metal +
  // water from the rocky home; Phase 2 adds crystal via moon outposts. Mid
  // milestones stay on those three so progression never gates on a resource
  // the player can't access. Trade Hub (the endgame) requires the full set —
  // by then the player should have claimed multiple planet types via System
  // Expansion + Wormhole transits.
  const expSteps: ExpStep[] = [
    { id: 'unlock-moon',        name: 'Moon Outpost',        cost: { metal: 200,        water: 100 },                                                                                                  flag: 'moon-outpost',          desc: 'Land on a moon (+5/s crystal per moon).',   extraPrereq: 'drone-count-3' },
    { id: 'unlock-elevator',    name: 'Space Elevator',      cost: { metal: 1500,       water: 800,        crystal: 400 },                                                                             flag: 'space-elevator',        desc: 'Tether the moon to the planet.',            requiresUnlock: 'moon-outpost' },
    { id: 'unlock-shipyard',    name: 'Fleet Shipyard',      cost: { metal: 8000,       water: 5000,       crystal: 3000 },                                                                            flag: 'fleet-shipyard',        desc: 'Build interplanetary haulers.',             requiresUnlock: 'space-elevator' },
    { id: 'unlock-system',      name: 'System Expansion',    cost: { metal: 40000,      water: 25000,      crystal: 15000 },                                                                           flag: 'system-expansion',      desc: 'Claim other planets in your system.',       requiresUnlock: 'fleet-shipyard' },
    { id: 'unlock-observatory', name: 'Wormhole Observatory',cost: { metal: 250000,     water: 150000,     crystal: 100000 },                                                                          flag: 'wormhole-observatory',  desc: 'Map seams in hyperspace.',                  requiresUnlock: 'system-expansion' },
    { id: 'unlock-transit',     name: 'Wormhole Transit',    cost: { metal: 2000000,    water: 1500000,    crystal: 1000000 },                                                                         flag: 'wormhole-transit',      desc: 'Travel to a neighbour system.',             requiresUnlock: 'wormhole-observatory' },
    { id: 'unlock-trade',       name: 'Trade Hub',           cost: { metal: 50000000,   water: 30000000,   crystal: 20000000, silicon: 10000000, gas: 10000000, plasma: 10000000, chemical: 10000000 },flag: 'trade-hub',             desc: 'Open the galactic exchange.',               requiresUnlock: 'wormhole-transit' },
  ];
  let prev: string = 'core';
  for (let i = 0; i < expSteps.length; i++) {
    const s = expSteps[i]!;
    out.push({
      id: s.id,
      name: s.name,
      tierLabel: '★',
      category: 'expansion',
      description: s.desc,
      cost: s.cost,
      effect: { kind: 'unlock', flag: s.flag },
      prereq: i === 0 ? (s.extraPrereq ?? prev) : prev,
      requiresUnlock: s.requiresUnlock,
      ...grid(0, -(i + 1)),
    });
    prev = s.id;
  }

  // ---------- PRODUCTION (EAST) --------------------------------------------
  // One chain per resource — pure multiplier (rate-mul). Planets supply flat
  // income; this chain just amplifies it. Tier 1 hangs off Core; subsequent
  // tiers march east along the resource's lane.
  for (const r of PRODUCTION_RECIPES) {
    const row = PROD_ROWS[r.resource]!;
    let chainPrev: string = 'core';
    for (let t = 0; t < TIERS; t++) {
      const id = `prod-${r.resource}-mul-${t + 1}`;
      const e: UpgradeEffect = { kind: 'rate-mul', resource: r.resource, value: PROD_MUL_PER_TIER[t]! };
      out.push({
        id,
        name: r.name,
        tierLabel: TIER_LABEL[t]!,
        category: 'production',
        description: `+${Math.round(PROD_MUL_PER_TIER[t]! * 100)}% ${r.resource} output`,
        cost: blendedCost(r.resource, 24, r.resource === 'metal' ? r.resource : 'metal', r.resource === 'metal' ? 0 : 8, 1.85, t),
        effect: e,
        prereq: chainPrev,
        requiresResource: r.resource,
        ...grid(t + 1, row),
      });
      chainPrev = id;
    }
  }

  // ---------- WEST half ----------------------------------------------------
  // 10 chains across logistics, drones, and tech — interleaved across rows
  // so adjacent rows belong to *different* categories. Every chain runs left
  // (col -1 .. col -6). Several have cross-category prereqs that produce
  // bridge edges across the canvas, weaving the tree together.
  interface WestSpec {
    baseId: string;
    name: string;
    category: 'logistics' | 'drones' | 'tech';
    row: number;
    headPrereq: string;
    effects: UpgradeEffect[];
    descs: string[];
    cost: (t: number) => Partial<ResourceBag>;
  }
  const westChains: WestSpec[] = [
    // Early-game cluster around row 0 — mixed: Storage (logistics), then
    // alternating with Drones and Logistics on neighbouring rows. All west
    // chains share tieredCost so Tier I-III pay in metal+water (rocky-home
    // baseline) and Tier IV-VI add crystal once moons are up.
    {
      baseId: 'storage-cap', name: 'Storage Bays', category: 'logistics', row: 0, headPrereq: 'core',
      effects: [1, 2, 5, 12, 30, 80].map((v): UpgradeEffect => ({ kind: 'storage-mul', value: v })),
      descs:   [1, 2, 5, 12, 30, 80].map((v) => `+${v * 100}% capacity`),
      cost: (t) => tieredCost(30, 1.85, t),
    },
    {
      baseId: 'refinery-eff', name: 'Refinery', category: 'logistics', row: 1, headPrereq: 'core',
      effects: [0.10, 0.20, 0.40, 0.80, 1.60, 3.20].map((v): UpgradeEffect => ({ kind: 'global-mul', value: v })),
      descs:   [0.10, 0.20, 0.40, 0.80, 1.60, 3.20].map((v) => `+${Math.round(v * 100)}% all output`),
      cost: (t) => tieredCost(50, 1.95, t),
    },
    {
      baseId: 'auto-sort', name: 'Auto-Sort', category: 'logistics', row: -1, headPrereq: 'core',
      effects: [0.20, 0.40, 0.80, 1.50, 3.00, 6.00].map((v): UpgradeEffect => ({ kind: 'drone-cargo', value: v })),
      descs:   [0.20, 0.40, 0.80, 1.50, 3.00, 6.00].map((v) => `+${Math.round(v * 100)}% routing`),
      cost: (t) => tieredCost(80, 1.9, t),
    },

    {
      baseId: 'drone-count', name: 'Drone Fleet', category: 'drones', row: 2, headPrereq: 'core',
      effects: [2, 3, 5, 8, 12, 18].map((v): UpgradeEffect => ({ kind: 'drone-count', value: v })),
      descs:   [2, 3, 5, 8, 12, 18].map((v) => `+${v} drones`),
      cost: (t) => tieredCost(18, 1.85, t),
    },
    {
      baseId: 'drone-speed', name: 'Drone Engines', category: 'drones', row: -2,
      // Bridges back to the drones cluster across the centre — produces a long
      // visible cross-edge from the drone-count branch up to the engines branch.
      headPrereq: 'drone-count-1',
      effects: [0.20, 0.40, 0.80, 1.50, 3.00, 6.00].map((v): UpgradeEffect => ({ kind: 'drone-speed', value: v })),
      descs:   [0.20, 0.40, 0.80, 1.50, 3.00, 6.00].map((v) => `+${Math.round(v * 100)}% drone speed`),
      cost: (t) => tieredCost(30, 1.85, t),
    },
    {
      baseId: 'drone-cargo', name: 'Drone Cargo', category: 'drones', row: 3,
      headPrereq: 'drone-count-2',
      effects: [0.30, 0.60, 1.20, 2.40, 4.80, 9.60].map((v): UpgradeEffect => ({ kind: 'drone-cargo', value: v })),
      descs:   [0.30, 0.60, 1.20, 2.40, 4.80, 9.60].map((v) => `+${Math.round(v * 100)}% cargo hold`),
      cost: (t) => tieredCost(40, 1.85, t),
    },

    // Tech tier — gated by mid-game logistics/drone milestones, not by Core.
    {
      baseId: 'tech-global', name: 'Industrial Doctrine', category: 'tech', row: -3,
      headPrereq: 'storage-cap-2',
      effects: [0.20, 0.40, 0.80, 1.50, 3.00, 6.00].map((v): UpgradeEffect => ({ kind: 'global-mul', value: v })),
      descs:   [0.20, 0.40, 0.80, 1.50, 3.00, 6.00].map((v) => `+${Math.round(v * 100)}% global`),
      cost: (t) => tieredCost(100, 2.05, t),
    },
    {
      baseId: 'tech-drones', name: 'Swarm Doctrine', category: 'tech', row: 4,
      headPrereq: 'drone-count-3',
      effects: [3, 5, 8, 12, 18, 25].map((v): UpgradeEffect => ({ kind: 'drone-count', value: v })),
      descs:   [3, 5, 8, 12, 18, 25].map((v) => `+${v} drones`),
      cost: (t) => tieredCost(120, 2.05, t),
    },
    {
      baseId: 'tech-storage', name: 'Storage Doctrine', category: 'tech', row: -4,
      headPrereq: 'refinery-eff-2',
      effects: [50, 200, 1000, 5000, 25000, 100000].map((v): UpgradeEffect => ({ kind: 'storage-mul', value: v })),
      descs:   [50, 200, 1000, 5000, 25000, 100000].map((v) => `×${v + 1} capacity`),
      cost: (t) => tieredCost(150, 2.15, t),
    },
    {
      baseId: 'tech-quantum', name: 'Quantum Compute', category: 'tech', row: 5,
      headPrereq: 'drone-speed-2',
      effects: [0.15, 0.30, 0.60, 1.20, 2.40, 4.80].map((v): UpgradeEffect => ({ kind: 'drone-speed', value: v })),
      descs:   [0.15, 0.30, 0.60, 1.20, 2.40, 4.80].map((v) => `+${Math.round(v * 100)}% drone speed`),
      cost: (t) => tieredCost(180, 2.15, t),
    },
  ];
  for (const ch of westChains) {
    let chainPrev: string = ch.headPrereq;
    for (let t = 0; t < TIERS; t++) {
      const id = `${ch.baseId}-${t + 1}`;
      out.push({
        id,
        name: ch.name,
        tierLabel: TIER_LABEL[t]!,
        category: ch.category,
        description: ch.descs[t]!,
        cost: ch.cost(t),
        effect: ch.effects[t]!,
        prereq: chainPrev,
        ...grid(-(t + 1), ch.row),
      });
      chainPrev = id;
    }
  }

  return out;
}

export const UPGRADE_NODES: UpgradeNode[] = buildCatalogue();
export const NODES_BY_ID: Map<string, UpgradeNode> = new Map(UPGRADE_NODES.map((n) => [n.id, n]));
export const CORE_NODE_ID = 'core';

export function canAfford(have: ResourceBag, cost: Partial<ResourceBag>): boolean {
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined) continue;
    if (have[k] < need) return false;
  }
  return true;
}
export function subtractCost(bag: ResourceBag, cost: Partial<ResourceBag>): void {
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined) continue;
    bag[k] -= need;
  }
}

export function catalogueExtent(): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of UPGRADE_NODES) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  return { minX, maxX, minY, maxY };
}
