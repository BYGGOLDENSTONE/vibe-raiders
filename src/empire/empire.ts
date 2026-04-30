// Empire — runtime state, production tick, save/load, and node purchases.

import type { GalaxyData, PlanetData, SystemData } from '../galaxy/types';
import {
  PLANET_TYPE_RESOURCE,
  RESOURCE_KEYS,
  STORAGE_KEY,
  emptyBag,
} from './types';
import type { EmpireState, ResourceBag, UnlockFlag, UpgradeNode } from './types';
import { CORE_NODE_ID, NODES_BY_ID, UPGRADE_NODES, canAfford, subtractCost } from './upgrades';

// Tunables for the Phase-1 starter trickle. Picked so the very first node
// (~8 metal / water) is reachable in ~10 seconds.
const TRICKLE_PER_OWNED_PLANET = 0.8;
const BASE_STORAGE_CAP = 200;

export interface EmpireMetrics {
  rates: ResourceBag;
  caps: ResourceBag;
  droneCount: number;
  droneSpeed: number;
  droneCargo: number;
  globalMul: number;
  ownership: ResourceBag;
}

export class Empire {
  state: EmpireState;
  private galaxy: GalaxyData;
  private seed: number;
  private listeners = new Set<() => void>();
  private saveAccum = 0;

  constructor(galaxy: GalaxyData, seed: number) {
    this.galaxy = galaxy;
    this.seed = seed;
    const loaded = loadFromStorage(seed);
    if (loaded) {
      this.state = loaded;
      // Heal old saves by backfilling missing fields.
      if (!this.state.unlockedNodes) this.state.unlockedNodes = [];
      if (!this.state.unlocks) this.state.unlocks = [];
      if (!this.state.ownedPlanets) this.state.ownedPlanets = [this.state.homePlanetId];
    } else {
      this.state = createFreshEmpire(galaxy, seed);
      this.save();
    }
    // The Empire Core is the always-owned root of the skill tree. Make sure it
    // is in unlockedNodes regardless of save vintage.
    if (!this.state.unlockedNodes.includes(CORE_NODE_ID)) {
      this.state.unlockedNodes.unshift(CORE_NODE_ID);
    }
  }

  // --- Read-only getters ----------------------------------------------------

  homeSystem(): SystemData | null {
    return this.galaxy.systems.find((s) => s.id === this.state.homeSystemId) ?? null;
  }
  homePlanet(): PlanetData | null {
    const sys = this.homeSystem();
    return sys?.planets.find((p) => p.id === this.state.homePlanetId) ?? null;
  }
  hasUnlock(flag: UnlockFlag): boolean {
    return this.state.unlocks.includes(flag);
  }
  hasNode(id: string): boolean {
    return this.state.unlockedNodes.includes(id);
  }

  // --- Visibility & purchasability -----------------------------------------

  // A node is *visible* when its hard gates are met. Visibility means it's
  // shown in the tree — the player might still need a prereq node to actually
  // buy it (which is reflected in canBuy / state classes, not visibility).
  isVisible(node: UpgradeNode): boolean {
    if (node.requiresUnlock && !this.hasUnlock(node.requiresUnlock)) return false;
    if (node.requiresResource) {
      const own = this.computeOwnership();
      if (own[node.requiresResource] === 0) return false;
    }
    return true;
  }

  // Node is unlocked = already bought. Once unlocked it's owned forever.
  // Available = visible + prereq met + not yet owned + can afford.
  // Locked-but-visible = visible + (prereq missing OR can't afford yet).
  nodeStatus(node: UpgradeNode): 'owned' | 'available' | 'locked' | 'hidden' {
    if (!this.isVisible(node)) return 'hidden';
    if (this.hasNode(node.id)) return 'owned';
    if (node.prereq && !this.hasNode(node.prereq)) return 'locked';
    return canAfford(this.state.resources, node.cost) ? 'available' : 'locked';
  }

  canBuy(node: UpgradeNode): boolean {
    return this.nodeStatus(node) === 'available';
  }

  buy(nodeId: string): boolean {
    const node = NODES_BY_ID.get(nodeId);
    if (!node) return false;
    if (!this.canBuy(node)) return false;
    subtractCost(this.state.resources, node.cost);
    this.state.unlockedNodes.push(node.id);
    if (node.effect.kind === 'unlock' && !this.hasUnlock(node.effect.flag)) {
      this.state.unlocks.push(node.effect.flag);
    }
    this.save();
    this.emit();
    return true;
  }

  // --- Metric computation ---------------------------------------------------

  computeMetrics(): EmpireMetrics {
    const rates = emptyBag();
    const ownership = this.computeOwnership();
    let droneCount = 0;
    let droneSpeedAdd = 0;
    let droneCargoAdd = 0;
    let globalMulAdd = 0;
    let storageMulAdd = 0;
    const rateMulAdd: ResourceBag = emptyBag();

    for (const id of this.state.unlockedNodes) {
      const node = NODES_BY_ID.get(id);
      if (!node) continue;
      const e = node.effect;
      switch (e.kind) {
        case 'rate-add':    rates[e.resource] += e.value; break;
        case 'rate-mul':    rateMulAdd[e.resource] += e.value; break;
        case 'global-mul':  globalMulAdd += e.value; break;
        case 'drone-count': droneCount += e.value; break;
        case 'drone-speed': droneSpeedAdd += e.value; break;
        case 'drone-cargo': droneCargoAdd += e.value; break;
        case 'storage-mul': storageMulAdd += e.value; break;
        case 'unlock':      /* tracked via state.unlocks */ break;
      }
    }

    // Trickle from each owned producing planet so brand-new players see
    // numbers move before any nodes are bought.
    for (const k of RESOURCE_KEYS) {
      if (ownership[k] > 0) rates[k] += TRICKLE_PER_OWNED_PLANET * ownership[k];
    }

    const droneSpeed = 1 + droneSpeedAdd;
    const droneCargo = 1 + droneCargoAdd;
    const globalMul = 1 + globalMulAdd;
    const droneThroughput = (1 + 0.05 * droneCount) * droneCargo * droneSpeed;

    for (const k of RESOURCE_KEYS) {
      if (ownership[k] === 0) {
        rates[k] = 0;
        continue;
      }
      rates[k] *= (1 + rateMulAdd[k]) * globalMul * droneThroughput;
    }

    const cap = BASE_STORAGE_CAP * (1 + storageMulAdd);
    const caps: ResourceBag = {
      metal: cap, water: cap, gas: cap, crystal: cap, plasma: cap, silicon: cap, chemical: cap,
    };
    return { rates, caps, droneCount, droneSpeed, droneCargo, globalMul, ownership };
  }

  private computeOwnership(): ResourceBag {
    const out = emptyBag();
    for (const pid of this.state.ownedPlanets) {
      const p = findPlanet(this.galaxy, pid);
      if (!p) continue;
      out[PLANET_TYPE_RESOURCE[p.type]] += 1;
    }
    return out;
  }

  // --- Tick ----------------------------------------------------------------

  tick(dt: number): void {
    const m = this.computeMetrics();
    for (const k of RESOURCE_KEYS) {
      const cur = this.state.resources[k];
      // Cap acts as a production ceiling — once we're at or above cap (e.g.
      // from a debug grant), tick stops accruing but doesn't claw stock back.
      if (cur >= m.caps[k]) continue;
      const next = cur + m.rates[k] * dt;
      this.state.resources[k] = Math.min(m.caps[k], next);
    }
    this.saveAccum += dt;
    if (this.saveAccum >= 5) {
      this.saveAccum = 0;
      this.save();
    }
  }

  // --- Persistence ---------------------------------------------------------

  save(): void {
    this.state.lastSavedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch { /* quota / private browsing — silent */ }
  }

  reset(): void {
    this.state = createFreshEmpire(this.galaxy, this.seed);
    this.save();
    this.emit();
  }

  // Debug-only: drop `amount` into every resource, bypassing storage caps.
  // Tick treats the cap as a production ceiling (it stops *accruing* at cap)
  // rather than a hard upper bound, so debug-granted excess is preserved.
  grantAll(amount: number): void {
    for (const k of RESOURCE_KEYS) {
      this.state.resources[k] += amount;
    }
    this.save();
    this.emit();
  }

  // --- Subscriptions -------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // Convenience for the renderer.
  allNodes(): UpgradeNode[] { return UPGRADE_NODES; }
}

// --- Factory & helpers ----------------------------------------------------

function loadFromStorage(seed: number): EmpireState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EmpireState;
    if (parsed.seed !== seed) return null;
    return parsed;
  } catch { return null; }
}

function createFreshEmpire(galaxy: GalaxyData, seed: number): EmpireState {
  const start = pickStartingPlanet(galaxy);
  const fallback: { systemId: string; planetId: string } | null =
    start
    ?? (galaxy.systems[0] && galaxy.systems[0].planets[0]
        ? { systemId: galaxy.systems[0].id, planetId: galaxy.systems[0].planets[0].id }
        : null);
  if (!fallback) throw new Error('Galaxy has no planets to bootstrap an empire on.');
  return {
    seed,
    homeSystemId: fallback.systemId,
    homePlanetId: fallback.planetId,
    resources: emptyBag(),
    unlockedNodes: [],
    ownedPlanets: [fallback.planetId],
    unlocks: [],
    lastSavedAt: Date.now(),
  };
}

// Habitable + moon-bearing world. Deterministic given the same galaxy data.
//   1. ocean + moon + temperate (-40..60°C)
//   2. rocky + moon + temperate
//   3. rocky + moon (any temperature)
function pickStartingPlanet(galaxy: GalaxyData): { systemId: string; planetId: string } | null {
  type Cand = { systemId: string; planetId: string; score: number };
  const cands: Cand[] = [];
  for (const s of galaxy.systems) {
    for (const p of s.planets) {
      if (p.moons.length === 0) continue;
      const habitable = p.type === 'ocean' || p.type === 'rocky';
      if (!habitable) continue;
      const temperate = p.temperatureC >= -40 && p.temperatureC <= 60;
      let score = 0;
      if (p.type === 'ocean' && temperate) score = 3;
      else if (p.type === 'rocky' && temperate) score = 2;
      else if (p.type === 'rocky') score = 1;
      else continue;
      cands.push({ systemId: s.id, planetId: p.id, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  return best ? { systemId: best.systemId, planetId: best.planetId } : null;
}

function findPlanet(galaxy: GalaxyData, planetId: string): PlanetData | null {
  for (const s of galaxy.systems) {
    for (const p of s.planets) {
      if (p.id === planetId) return p;
    }
  }
  return null;
}
