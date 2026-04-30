// Empire — runtime state, production tick, save/load, and node purchases.

import type { GalaxyData, PlanetData, SystemData } from '../galaxy/types';
import {
  BASE_STORAGE_CAP,
  MOON_OUTPOST_INCOME,
  PLANET_INCOME,
  RESOURCE_KEYS,
  SYNERGY_PER_PLANET,
  SYSTEM_TIER_BASE,
  emptyBag,
  storageKeyFor,
} from './types';
import type { EmpireState, GameMode, PlanetIncome, ResourceBag, ResourceKey, UnlockFlag, UpgradeNode } from './types';
import { CORE_NODE_ID, NODES_BY_ID, UPGRADE_NODES, canAfford, subtractCost } from './upgrades';

// W5 — claim cost for annexing a planet in the home system. Scales with how
// many home-system planets the empire has already claimed (excluding the
// homeworld itself), giving the curve the player feels: thousands → tens of
// thousands as the home system fills up.
const SYSTEM_PLANET_CLAIM_BASE: Partial<ResourceBag> = { metal: 5000, water: 3000, crystal: 2000 };
const SYSTEM_PLANET_CLAIM_GROWTH = 1.6;

export interface EmpireMetrics {
  rates: ResourceBag;
  caps: ResourceBag;
  droneCount: number;
  droneSpeed: number;
  droneCargo: number;
  globalMul: number;
  synergy: number;
  // Resources the empire is currently producing (any positive contribution
  // from planet income or moon outposts). Replaces the old per-type ownership
  // bag so secondary-resource production is correctly reflected.
  produces: Set<ResourceKey>;
  planetCount: number;
}

export class Empire {
  state: EmpireState;
  mode: GameMode;
  private galaxy: GalaxyData;
  private seed: number;
  private storageKey: string;
  private listeners = new Set<() => void>();
  private saveAccum = 0;

  constructor(galaxy: GalaxyData, seed: number, mode: GameMode = 'solo') {
    this.galaxy = galaxy;
    this.seed = seed;
    this.mode = mode;
    this.storageKey = storageKeyFor(mode);
    const loaded = loadFromStorage(this.storageKey, seed);
    if (loaded) {
      this.state = loaded;
      // Heal old saves by backfilling missing fields.
      if (!this.state.unlockedNodes) this.state.unlockedNodes = [];
      if (!this.state.unlocks) this.state.unlocks = [];
      if (!this.state.ownedPlanets) this.state.ownedPlanets = [];
      if (!this.state.claimedSystems) this.state.claimedSystems = {};
      if (this.state.outpostMoonId === undefined) this.state.outpostMoonId = null;
      if (this.state.homeClaimed === undefined) {
        this.state.homeClaimed = !!this.state.homePlanetId;
      }
      // W5: dormant solo saves (W4-D era, homeClaimed=false) get bootstrapped
      // to an auto-picked homeworld. In MP we never auto-pick — the spawn
      // system comes from the relay (W6-D), so an unclaimed MP save stays
      // dormant until App calls bootstrapInSystem().
      if (!this.state.homeClaimed && mode === 'solo') {
        this.bootstrapHomeworld();
      }
    } else {
      this.state = createEmptyEmpire(seed);
      if (mode === 'solo') {
        this.bootstrapHomeworld();
        this.save();
      }
    }
    if (!this.state.unlockedNodes.includes(CORE_NODE_ID)) {
      this.state.unlockedNodes.unshift(CORE_NODE_ID);
    }
  }

  // Pick a deterministic eligible homeworld (rocky + at least one moon) from
  // the galaxy and write the home/owned/system fields. Solo only — MP uses
  // bootstrapInSystem() with a server-assigned spawn system instead.
  private bootstrapHomeworld(): void {
    const pick = pickStartingPlanet(this.galaxy);
    if (!pick) return; // ~impossible with ~200 systems, but keep dormant if it happens
    this.state.homeClaimed = true;
    this.state.homeSystemId = pick.system.id;
    this.state.homePlanetId = pick.planet.id;
    this.state.ownedPlanets = [pick.planet.id];
    this.state.claimedSystems = { [pick.system.id]: 1 };
  }

  // W6-D: MP spawn — the relay assigned us a system, pick the best rocky+moon
  // planet within it. Trusts the caller to validate the system id; quietly
  // returns false if the system has no eligible planet (shouldn't happen
  // because the client only nominates systems that pass the same filter).
  bootstrapInSystem(systemId: string): boolean {
    const sys = this.galaxy.systems.find((s) => s.id === systemId);
    if (!sys) return false;
    let temperate: PlanetData | null = null;
    let any: PlanetData | null = null;
    for (const p of sys.planets) {
      if (p.type !== 'rocky') continue;
      if (p.moons.length === 0) continue;
      if (!any) any = p;
      if (!temperate && p.temperatureC >= -30 && p.temperatureC <= 50) {
        temperate = p;
        break;
      }
    }
    const planet = temperate ?? any;
    if (!planet) return false;
    this.state.homeClaimed = true;
    this.state.homeSystemId = sys.id;
    this.state.homePlanetId = planet.id;
    this.state.ownedPlanets = [planet.id];
    this.state.claimedSystems = { [sys.id]: 1 };
    this.save();
    this.emit();
    return true;
  }

  // Eligibility list used by App to build the "preferred systems" list it
  // sends to the relay during a claim handshake. Returns systemIds in galaxy
  // order so every client agrees on the priority order — server's first-fit
  // pick lands on a stable assignment.
  eligibleSpawnSystemIds(): string[] {
    const out: string[] = [];
    for (const s of this.galaxy.systems) {
      for (const p of s.planets) {
        if (p.type === 'rocky' && p.moons.length > 0) { out.push(s.id); break; }
      }
    }
    return out;
  }

  // --- Read-only getters ----------------------------------------------------

  homeSystem(): SystemData | null {
    if (!this.state.homeClaimed) return null;
    return this.galaxy.systems.find((s) => s.id === this.state.homeSystemId) ?? null;
  }
  homePlanet(): PlanetData | null {
    if (!this.state.homeClaimed) return null;
    const sys = this.homeSystem();
    return sys?.planets.find((p) => p.id === this.state.homePlanetId) ?? null;
  }
  // True for any rocky planet that has at least one moon — eligible homeworld.
  // Used by the auto-pick at empire creation and by W6 (multiplayer) to decide
  // which planets are valid claim candidates.
  isHomeworldEligible(planet: PlanetData): boolean {
    return planet.type === 'rocky' && planet.moons.length > 0;
  }

  // --- W5: System Expansion -----------------------------------------------
  //
  // Once `system-expansion` is unlocked, the player can annex other planets in
  // their home system. Each claim deducts a scaling cost and adds the planet
  // to ownedPlanets so its primary+secondary income starts flowing.

  // Eligibility: unlock owned + planet is in the home system + not yet owned.
  canClaimSystemPlanet(planet: PlanetData): boolean {
    if (!this.hasUnlock('system-expansion')) return false;
    if (!this.state.homeClaimed) return false;
    if (this.state.ownedPlanets.includes(planet.id)) return false;
    const sys = findSystemOf(this.galaxy, planet.id);
    return !!sys && sys.id === this.state.homeSystemId;
  }

  // Cost grows with how many *non-home* home-system planets are already owned,
  // so the curve is "thousands → tens of thousands" as the system fills up.
  systemPlanetClaimCost(_planet: PlanetData): Partial<ResourceBag> {
    const home = this.state.homePlanetId;
    const sys = this.homeSystem();
    if (!sys) return {};
    let claimed = 0;
    for (const p of sys.planets) {
      if (p.id === home) continue;
      if (this.state.ownedPlanets.includes(p.id)) claimed++;
    }
    const mul = Math.pow(SYSTEM_PLANET_CLAIM_GROWTH, claimed);
    const out: Partial<ResourceBag> = {};
    for (const k of RESOURCE_KEYS) {
      const base = SYSTEM_PLANET_CLAIM_BASE[k];
      if (base === undefined) continue;
      out[k] = Math.round(base * mul);
    }
    return out;
  }

  claimSystemPlanet(planetId: string): boolean {
    const sys = this.homeSystem();
    if (!sys) return false;
    const planet = sys.planets.find((p) => p.id === planetId);
    if (!planet) return false;
    if (!this.canClaimSystemPlanet(planet)) return false;
    const cost = this.systemPlanetClaimCost(planet);
    if (!canAfford(this.state.resources, cost)) return false;
    subtractCost(this.state.resources, cost);
    this.state.ownedPlanets.push(planet.id);
    this.save();
    this.emit();
    return true;
  }

  // Returns every still-claimable home-system planet. Drives the label markers
  // that highlight where the player should click.
  claimableHomeSystemPlanets(): PlanetData[] {
    if (!this.hasUnlock('system-expansion')) return [];
    const sys = this.homeSystem();
    if (!sys) return [];
    return sys.planets.filter((p) => this.canClaimSystemPlanet(p));
  }

  // W6-E — single auto-targeted annex flow. Pick the unowned home-system
  // planet whose orbit radius is closest to the home planet's, so claims
  // visibly march outward (or inward) instead of picking randomly. This is
  // the only annex entry point in the new UX — manual per-planet click is
  // gone in favour of one always-on "Annex" button.
  nextAnnexTarget(): PlanetData | null {
    if (!this.hasUnlock('system-expansion')) return null;
    const sys = this.homeSystem();
    if (!sys) return null;
    const home = sys.planets.find((p) => p.id === this.state.homePlanetId);
    if (!home) return null;
    let best: PlanetData | null = null;
    let bestDist = Infinity;
    for (const p of sys.planets) {
      if (p.id === home.id) continue;
      if (this.state.ownedPlanets.includes(p.id)) continue;
      const d = Math.abs(p.orbitRadius - home.orbitRadius);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  nextAnnexCost(): Partial<ResourceBag> | null {
    const target = this.nextAnnexTarget();
    if (!target) return null;
    return this.systemPlanetClaimCost(target);
  }

  claimNextAnnex(): boolean {
    const target = this.nextAnnexTarget();
    if (!target) return false;
    return this.claimSystemPlanet(target.id);
  }
  // Resolve the chosen outpost moon back to a planet/system pair so income can
  // be tier-scaled and the renderer knows where to attach the dome.
  outpostMoonContext(): { planet: PlanetData; systemId: string } | null {
    if (!this.state.outpostMoonId) return null;
    for (const s of this.galaxy.systems) {
      for (const p of s.planets) {
        if (!this.state.ownedPlanets.includes(p.id)) continue;
        for (const m of p.moons) {
          if (m.id === this.state.outpostMoonId) {
            return { planet: p, systemId: s.id };
          }
        }
      }
    }
    return null;
  }
  hasUnlock(flag: UnlockFlag): boolean {
    return this.state.unlocks.includes(flag);
  }
  hasNode(id: string): boolean {
    return this.state.unlockedNodes.includes(id);
  }
  // True only when every planet in the home system is owned. Drives the
  // "HOME SYSTEM" badge upgrade and (later) higher-tier multipliers.
  isHomeSystemFullyClaimed(): boolean {
    const sys = this.homeSystem();
    if (!sys || sys.planets.length === 0) return false;
    return sys.planets.every((p) => this.state.ownedPlanets.includes(p.id));
  }

  // --- Visibility & purchasability -----------------------------------------

  // A node is *visible* when its hard gates are met. Visibility means it's
  // shown in the tree — the player might still need a prereq node to actually
  // buy it (which is reflected in canBuy / state classes, not visibility).
  isVisible(node: UpgradeNode): boolean {
    if (node.requiresUnlock && !this.hasUnlock(node.requiresUnlock)) return false;
    if (node.requiresResource && !this.producesResource(node.requiresResource)) return false;
    // W6-E gate: the wormhole path stays sealed until every home-system
    // planet is annexed. Hides observatory + transit + trade-hub at once
    // because each later node has the previous as its prereq node.
    if (node.id === 'unlock-observatory' && !this.isHomeSystemFullyClaimed()) return false;
    return true;
  }

  // Cheap check for whether the empire produces a given resource. Used by
  // isVisible (called per-node during render) so it skips the full metrics
  // computation. Mirrors the planet-income + moon-outpost logic in computeMetrics.
  private producesResource(k: ResourceKey): boolean {
    for (const pid of this.state.ownedPlanets) {
      const p = findPlanet(this.galaxy, pid);
      if (!p) continue;
      const inc = PLANET_INCOME[p.type];
      if (inc.primary.resource === k || inc.secondary.resource === k) return true;
    }
    // Moon outpost only counts once a moon is actually chosen (W4-E claim).
    if (k === MOON_OUTPOST_INCOME.resource && this.outpostMoonContext()) {
      return true;
    }
    return false;
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
    const produces = new Set<ResourceKey>();
    let planetCount = 0;

    // 1. Per-planet baseline income (primary + secondary), scaled by the
    //    system-tier multiplier of whichever system this planet belongs to.
    for (const pid of this.state.ownedPlanets) {
      const p = findPlanet(this.galaxy, pid);
      if (!p) continue;
      planetCount++;
      const sys = findSystemOf(this.galaxy, pid);
      const tier = sys ? this.tierOf(sys.id) : 1;
      const tierMul = Math.pow(SYSTEM_TIER_BASE, tier - 1);

      const inc: PlanetIncome = PLANET_INCOME[p.type];
      rates[inc.primary.resource]   += inc.primary.rate   * tierMul;
      rates[inc.secondary.resource] += inc.secondary.rate * tierMul;
      produces.add(inc.primary.resource);
      produces.add(inc.secondary.resource);
    }

    // 1b. Moon outpost contribution (W4-E). Only the player-chosen moon
    //     contributes — was per-moon-of-every-owned-planet pre-W4-C, which
    //     compounded badly into late-game crystal floods.
    const outCtx = this.outpostMoonContext();
    if (outCtx) {
      const tier = this.tierOf(outCtx.systemId);
      const tierMul = Math.pow(SYSTEM_TIER_BASE, tier - 1);
      rates[MOON_OUTPOST_INCOME.resource] += MOON_OUTPOST_INCOME.rate * tierMul;
      produces.add(MOON_OUTPOST_INCOME.resource);
    }

    // 2. Tally upgrade contributions.
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

    // 3. Synergy + drone throughput.
    //    droneThroughput is *additive* across (count, cargo, speed) — pre-W4-C
    //    it was multiplicative which compounded to ×4900 at full upgrade. The
    //    new formula tops out around ×7-8 even with everything maxed.
    const synergy = 1 + SYNERGY_PER_PLANET * planetCount;
    const droneSpeed = 1 + droneSpeedAdd;   // surface.ts uses this directly
    const droneCargo = 1 + droneCargoAdd;   // exposed for HUD/tooltips
    const globalMul = 1 + globalMulAdd;
    const droneThroughput = 1 + 0.05 * droneCount + droneCargoAdd + droneSpeedAdd;

    // 4. Apply multipliers only to resources the empire actually produces.
    //    Anything not produced stays at zero — even if a rate-add upgrade
    //    accidentally bumped it (those are gated by requiresResource anyway).
    for (const k of RESOURCE_KEYS) {
      if (!produces.has(k)) {
        rates[k] = 0;
        continue;
      }
      rates[k] *= (1 + rateMulAdd[k]) * globalMul * synergy * droneThroughput;
    }

    const cap = BASE_STORAGE_CAP * (1 + storageMulAdd);
    const caps: ResourceBag = {
      metal: cap, water: cap, gas: cap, crystal: cap, plasma: cap, silicon: cap, chemical: cap,
    };
    return { rates, caps, droneCount, droneSpeed, droneCargo, globalMul, synergy, produces, planetCount };
  }

  // System tier — home is implicit T1, claimed systems carry an explicit tier.
  // Returns 1 for unknown / home / unclaimed-but-occupied systems.
  private tierOf(systemId: string): number {
    const explicit = this.state.claimedSystems[systemId];
    if (explicit && explicit > 0) return explicit;
    if (systemId === this.state.homeSystemId) return 1;
    return 1;
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
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch { /* quota / private browsing — silent */ }
  }

  reset(): void {
    this.state = createEmptyEmpire(this.seed);
    // Solo resets re-pick a homeworld immediately. MP resets stay dormant
    // until App re-claims a spawn system from the relay.
    if (this.mode === 'solo') {
      this.bootstrapHomeworld();
    }
    this.state.unlockedNodes.unshift(CORE_NODE_ID);
    this.save();
    this.emit();
  }

  // W4-E — set the chosen outpost moon. Only valid when `moon-outpost` is
  // unlocked AND the moon belongs to one of the empire's owned planets.
  // Re-clicking another moon moves the outpost (cheap reassignment).
  claimOutpostMoon(moonId: string): boolean {
    if (!this.hasUnlock('moon-outpost')) return false;
    let valid = false;
    for (const pid of this.state.ownedPlanets) {
      const p = findPlanet(this.galaxy, pid);
      if (!p) continue;
      if (p.moons.some((m) => m.id === moonId)) { valid = true; break; }
    }
    if (!valid) return false;
    this.state.outpostMoonId = moonId;
    this.save();
    this.emit();
    return true;
  }

  // True iff Moon Outpost is unlocked but the player hasn't picked a moon
  // yet — the UI uses this to surface the "choose a moon" prompt.
  needsOutpostMoonChoice(): boolean {
    return this.hasUnlock('moon-outpost') && !this.state.outpostMoonId;
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

function loadFromStorage(storageKey: string, seed: number): EmpireState | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EmpireState;
    if (parsed.seed !== seed) return null;
    return parsed;
  } catch { return null; }
}

// W5: the empire layer no longer starts dormant — `bootstrapHomeworld` runs
// right after this and writes the auto-picked home/owned fields. Multiplayer
// (W6) will replace the auto-pick with a per-player coordinated claim.
function createEmptyEmpire(seed: number): EmpireState {
  return {
    seed,
    homeClaimed: false,
    homeSystemId: '',
    homePlanetId: '',
    resources: emptyBag(),
    unlockedNodes: [],
    ownedPlanets: [],
    unlocks: [],
    claimedSystems: {},
    outpostMoonId: null,
    lastSavedAt: Date.now(),
  };
}

// Pick a deterministic starting planet from the galaxy. Prefers temperate
// rocky+moon worlds, falls back to any rocky+moon planet (the catalogue's
// "metal+water baseline" assumption needs both).
function pickStartingPlanet(galaxy: GalaxyData): { system: SystemData; planet: PlanetData } | null {
  let temperateMatch: { system: SystemData; planet: PlanetData } | null = null;
  let anyMatch: { system: SystemData; planet: PlanetData } | null = null;
  for (const s of galaxy.systems) {
    for (const p of s.planets) {
      if (p.type !== 'rocky') continue;
      if (p.moons.length === 0) continue;
      if (!anyMatch) anyMatch = { system: s, planet: p };
      if (!temperateMatch && p.temperatureC >= -30 && p.temperatureC <= 50) {
        temperateMatch = { system: s, planet: p };
      }
      if (temperateMatch) break;
    }
    if (temperateMatch) break;
  }
  return temperateMatch ?? anyMatch;
}

function findPlanet(galaxy: GalaxyData, planetId: string): PlanetData | null {
  for (const s of galaxy.systems) {
    for (const p of s.planets) {
      if (p.id === planetId) return p;
    }
  }
  return null;
}

function findSystemOf(galaxy: GalaxyData, planetId: string): SystemData | null {
  for (const s of galaxy.systems) {
    for (const p of s.planets) {
      if (p.id === planetId) return s;
    }
  }
  return null;
}
