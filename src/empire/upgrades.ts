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

function escalatedCost(resource: ResourceKey, base: number, growth: number, t: number): Partial<ResourceBag> {
  return { [resource]: Math.round(base * Math.pow(growth, t) * 10) / 10 } as Partial<ResourceBag>;
}
function blendedCost(p: ResourceKey, pb: number, s: ResourceKey, sb: number, growth: number, t: number): Partial<ResourceBag> {
  const m = Math.pow(growth, t);
  const c: Partial<ResourceBag> = {};
  c[p] = Math.round(pb * m * 10) / 10;
  c[s] = Math.round(sb * m * 10) / 10;
  return c;
}

interface ProdRecipe {
  resource: ResourceKey;
  miningName: string;
  optName: string;
  flavour: string;
}
const PRODUCTION_RECIPES: ProdRecipe[] = [
  { resource: 'metal',    miningName: 'Metal Mining',      optName: 'Metal Optimisation',      flavour: 'ore'         },
  { resource: 'water',    miningName: 'Water Pumping',     optName: 'Hydro Optimisation',      flavour: 'flow'        },
  { resource: 'gas',      miningName: 'Gas Refining',      optName: 'Gas Optimisation',        flavour: 'pressure'    },
  { resource: 'crystal',  miningName: 'Crystal Lab',       optName: 'Crystal Optimisation',    flavour: 'lattice'     },
  { resource: 'plasma',   miningName: 'Plasma Extraction', optName: 'Plasma Optimisation',     flavour: 'core temp'   },
  { resource: 'silicon',  miningName: 'Silicon Works',     optName: 'Silicon Optimisation',    flavour: 'wafer yield' },
  { resource: 'chemical', miningName: 'Chemical Plant',    optName: 'Chemical Optimisation',   flavour: 'reaction'    },
];

const PROD_RATE_PER_TIER = [0.4, 0.6, 0.9, 1.4, 2.1, 3.2];
const PROD_MUL_PER_TIER  = [0.20, 0.25, 0.30, 0.35, 0.40, 0.50];

// Per-resource lane assignment. Mining lane on row N, optimisation on row N+1.
// Resources alternate above and below row 0 for visual balance and so the
// player's eye stays close to Core for early game.
const PROD_ROWS: Record<ResourceKey, { mining: number; opt: number }> = {
  metal:    { mining:  0, opt:  1 },
  water:    { mining: -2, opt: -1 },
  gas:      { mining:  2, opt:  3 },
  crystal:  { mining: -4, opt: -3 },
  plasma:   { mining:  4, opt:  5 },
  silicon:  { mining: -6, opt: -5 },
  chemical: { mining:  6, opt:  7 },
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
  const expSteps: ExpStep[] = [
    { id: 'unlock-moon',        name: 'Moon Outpost',        cost: { metal: 250, silicon: 60 },                  flag: 'moon-outpost',          desc: 'Land on a moon.',                          extraPrereq: 'drone-count-3' },
    { id: 'unlock-elevator',    name: 'Space Elevator',      cost: { metal: 800, silicon: 200, crystal: 50 },     flag: 'space-elevator',        desc: 'Tether the moon to the planet.',           requiresUnlock: 'moon-outpost' },
    { id: 'unlock-shipyard',    name: 'Fleet Shipyard',      cost: { metal: 2000, silicon: 600, gas: 200 },       flag: 'fleet-shipyard',        desc: 'Build interplanetary haulers.',             requiresUnlock: 'space-elevator' },
    { id: 'unlock-system',      name: 'System Expansion',    cost: { metal: 1500, silicon: 400, gas: 200 },       flag: 'system-expansion',      desc: 'Open another planet in your system.',       requiresUnlock: 'fleet-shipyard' },
    { id: 'unlock-observatory', name: 'Wormhole Observatory',cost: { crystal: 600, gas: 600, plasma: 600 },       flag: 'wormhole-observatory',  desc: 'Map seams in hyperspace.' },
    { id: 'unlock-transit',     name: 'Wormhole Transit',    cost: { crystal: 2000, plasma: 1500, chemical: 800 },flag: 'wormhole-transit',      desc: 'Travel to a neighbour system.',             requiresUnlock: 'wormhole-observatory' },
    { id: 'unlock-trade',       name: 'Trade Hub',           cost: { metal: 5000, silicon: 1500, water: 800 },    flag: 'trade-hub',             desc: 'Open the galactic exchange.',               requiresUnlock: 'wormhole-transit' },
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
  // Mining chain: tier 1 hangs off Core, tiers 2-6 march east along the lane.
  // Optimisation chain: branches off Mining-3 onto the row directly below,
  // continuing east further than the mining chain reaches.
  for (const r of PRODUCTION_RECIPES) {
    const rows = PROD_ROWS[r.resource]!;

    let chainPrev: string = 'core';
    for (let t = 0; t < TIERS; t++) {
      const id = `prod-${r.resource}-rate-${t + 1}`;
      const e: UpgradeEffect = { kind: 'rate-add', resource: r.resource, value: PROD_RATE_PER_TIER[t]! };
      out.push({
        id,
        name: r.miningName,
        tierLabel: TIER_LABEL[t]!,
        category: 'production',
        description: `+${PROD_RATE_PER_TIER[t]!.toFixed(1)} ${r.resource}/s`,
        cost: escalatedCost(r.resource, 8, 1.55, t),
        effect: e,
        prereq: chainPrev,
        requiresResource: r.resource,
        ...grid(t + 1, rows.mining),
      });
      chainPrev = id;
    }

    chainPrev = `prod-${r.resource}-rate-3`;
    for (let t = 0; t < TIERS; t++) {
      const id = `prod-${r.resource}-mul-${t + 1}`;
      const e: UpgradeEffect = { kind: 'rate-mul', resource: r.resource, value: PROD_MUL_PER_TIER[t]! };
      out.push({
        id,
        name: r.optName,
        tierLabel: TIER_LABEL[t]!,
        category: 'production',
        description: `+${Math.round(PROD_MUL_PER_TIER[t]! * 100)}% ${r.flavour}`,
        cost: blendedCost(r.resource, 32, r.resource === 'metal' ? r.resource : 'metal', r.resource === 'metal' ? 0 : 12, 1.65, t),
        effect: e,
        prereq: chainPrev,
        requiresResource: r.resource,
        ...grid(t + 3, rows.opt),
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
    // alternating with Drones and Logistics on neighbouring rows.
    {
      baseId: 'storage-cap', name: 'Storage Bays', category: 'logistics', row: 0, headPrereq: 'core',
      effects: [0.5, 0.5, 0.75, 1.0, 1.25, 1.5].map((v): UpgradeEffect => ({ kind: 'storage-mul', value: v })),
      descs:   [0.5, 0.5, 0.75, 1.0, 1.25, 1.5].map((v) => `+${Math.round(v * 100)}% capacity`),
      cost: (t) => escalatedCost('metal', 22, 1.55, t),
    },
    {
      baseId: 'refinery-eff', name: 'Refinery', category: 'logistics', row: 1, headPrereq: 'core',
      effects: [0.05, 0.06, 0.07, 0.08, 0.10, 0.12].map((v): UpgradeEffect => ({ kind: 'global-mul', value: v })),
      descs:   [0.05, 0.06, 0.07, 0.08, 0.10, 0.12].map((v) => `+${Math.round(v * 100)}% all output`),
      cost: (t) => blendedCost('metal', 36, 'silicon', 8, 1.65, t),
    },
    {
      baseId: 'auto-sort', name: 'Auto-Sort', category: 'logistics', row: -1, headPrereq: 'core',
      effects: [0.06, 0.07, 0.08, 0.10, 0.12, 0.15].map((v): UpgradeEffect => ({ kind: 'drone-cargo', value: v })),
      descs:   [0.06, 0.07, 0.08, 0.10, 0.12, 0.15].map((v) => `+${Math.round(v * 100)}% routing`),
      cost: (t) => blendedCost('metal', 60, 'crystal', 6, 1.7, t),
    },

    {
      baseId: 'drone-count', name: 'Drone Fleet', category: 'drones', row: 2, headPrereq: 'core',
      effects: [1, 1, 2, 2, 3, 4].map((v): UpgradeEffect => ({ kind: 'drone-count', value: v })),
      descs:   [1, 1, 2, 2, 3, 4].map((v) => `+${v} drone${v === 1 ? '' : 's'}`),
      cost: (t) => blendedCost('metal', 14, 'silicon', 4, 1.6, t),
    },
    {
      baseId: 'drone-speed', name: 'Drone Engines', category: 'drones', row: -2,
      // Bridges back to the drones cluster across the centre — produces a long
      // visible cross-edge from the drone-count branch up to the engines branch.
      headPrereq: 'drone-count-1',
      effects: [0.10, 0.12, 0.15, 0.18, 0.22, 0.28].map((v): UpgradeEffect => ({ kind: 'drone-speed', value: v })),
      descs:   [0.10, 0.12, 0.15, 0.18, 0.22, 0.28].map((v) => `+${Math.round(v * 100)}% drone speed`),
      cost: (t) => blendedCost('metal', 22, 'plasma', 4, 1.6, t),
    },
    {
      baseId: 'drone-cargo', name: 'Drone Cargo', category: 'drones', row: 3,
      headPrereq: 'drone-count-2',
      effects: [0.15, 0.18, 0.22, 0.27, 0.33, 0.42].map((v): UpgradeEffect => ({ kind: 'drone-cargo', value: v })),
      descs:   [0.15, 0.18, 0.22, 0.27, 0.33, 0.42].map((v) => `+${Math.round(v * 100)}% cargo hold`),
      cost: (t) => blendedCost('metal', 28, 'gas', 4, 1.6, t),
    },

    // Tech tier — gated by mid-game logistics/drone milestones, not by Core.
    {
      baseId: 'tech-global', name: 'Industrial Doctrine', category: 'tech', row: -3,
      headPrereq: 'storage-cap-2',
      effects: [0.08, 0.10, 0.12, 0.14, 0.16, 0.20].map((v): UpgradeEffect => ({ kind: 'global-mul', value: v })),
      descs:   [0.08, 0.10, 0.12, 0.14, 0.16, 0.20].map((v) => `+${Math.round(v * 100)}% global`),
      cost: (t) => blendedCost('metal', 70, 'silicon', 30, 1.85, t),
    },
    {
      baseId: 'tech-drones', name: 'Swarm Doctrine', category: 'tech', row: 4,
      headPrereq: 'drone-count-3',
      effects: [1, 1, 2, 2, 3, 4].map((v): UpgradeEffect => ({ kind: 'drone-count', value: v })),
      descs:   [1, 1, 2, 2, 3, 4].map((v) => `+${v} drone${v === 1 ? '' : 's'}`),
      cost: (t) => blendedCost('metal', 80, 'plasma', 12, 1.85, t),
    },
    {
      baseId: 'tech-storage', name: 'Storage Doctrine', category: 'tech', row: -4,
      headPrereq: 'refinery-eff-2',
      effects: [0.20, 0.25, 0.30, 0.35, 0.40, 0.50].map((v): UpgradeEffect => ({ kind: 'storage-mul', value: v })),
      descs:   [0.20, 0.25, 0.30, 0.35, 0.40, 0.50].map((v) => `+${Math.round(v * 100)}% storage`),
      cost: (t) => blendedCost('metal', 100, 'gas', 20, 1.85, t),
    },
    {
      baseId: 'tech-quantum', name: 'Quantum Compute', category: 'tech', row: 5,
      headPrereq: 'drone-speed-2',
      effects: [0.05, 0.06, 0.08, 0.10, 0.12, 0.15].map((v): UpgradeEffect => ({ kind: 'drone-speed', value: v })),
      descs:   [0.05, 0.06, 0.08, 0.10, 0.12, 0.15].map((v) => `+${Math.round(v * 100)}% drone speed`),
      cost: (t) => blendedCost('crystal', 40, 'silicon', 80, 1.95, t),
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
