// Empire — runtime state, production tick, save/load, and node purchases.

import type { GalaxyData, PlanetData, SystemData, UniverseData } from '../galaxy/types';
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

// W7 — wormhole annex cost. Fixed (not scaling) since the player only ever
// claims one second system in the current MVP — T2 multiplier is the reward.
// Sized in the millions so it's a real "endgame economy goal" rather than a
// trivial follow-up to buying wormhole-transit.
const WORMHOLE_CLAIM_COST: Partial<ResourceBag> = {
  metal: 5_000_000,
  water: 3_000_000,
  crystal: 2_000_000,
};

// W9 — intergalactic claim cost. Half a billion on the main resources + light
// secondary contribution. T3 multiplier (×10K) is so massive that even one
// planet there will dwarf the home system's output, so the cost has to feel
// like a real achievement.
const INTERGALACTIC_CLAIM_COST: Partial<ResourceBag> = {
  metal:    500_000_000,
  water:    300_000_000,
  crystal:  200_000_000,
  gas:       50_000_000,
  plasma:    50_000_000,
  silicon:   50_000_000,
  chemical:  50_000_000,
};

// W7 — single trade swap. Same shape used by previewTrade (UI hover) and
// executeTrade (the actual mutation), so banner code can render both with
// the same formatter.
export interface TradeSwap {
  give: { resource: ResourceKey; amount: number };
  get:  { resource: ResourceKey; amount: number };
}

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
  // W9 — empire now operates on the full universe (multi-galaxy). The legacy
  // single-galaxy lookups still work because the helper functions transparently
  // walk every galaxy in the universe.
  private universe: UniverseData;
  // Convenience handle to the main galaxy where every player spawns. Used by
  // the spawn-eligibility list so satellite-galaxy systems aren't offered as
  // valid starting positions.
  private mainGalaxy: GalaxyData;
  private seed: number;
  private storageKey: string;
  private listeners = new Set<() => void>();
  private saveAccum = 0;

  constructor(universe: UniverseData, seed: number, mode: GameMode = 'solo') {
    this.universe = universe;
    this.mainGalaxy = universe.galaxies[0]!;
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
      // Self-heal: a save claiming homeClaimed=true must still point to a
      // planet that exists in the current universe AND passes the strict
      // habitable-rocky-with-moon filter. If anything drifted (stale planet
      // ID after a generator change, or a legacy save where the bootstrap
      // landed on a non-rocky world), reset the home so the bootstrap below
      // can repick a proper one.
      if (this.state.homeClaimed) {
        const home = findPlanet(this.universe, this.state.homePlanetId);
        if (!home || !isStartingEligible(home)) {
          console.warn('[empire] home planet failed eligibility check, resetting',
            { homePlanetId: this.state.homePlanetId, type: home?.type, temp: home?.temperatureC, moons: home?.moons.length });
          this.state.homeClaimed = false;
          this.state.homeSystemId = '';
          this.state.homePlanetId = '';
          this.state.ownedPlanets = [];
          this.state.claimedSystems = {};
          this.state.outpostMoonId = null;
        } else {
          // Scrub ownedPlanets and claimedSystems for stale IDs (e.g. a save
          // from before W10.1 globally-unique planet IDs would have entries
          // like "p2" that now resolve to a random other system's planet).
          const keptOwned = this.state.ownedPlanets.filter((pid) => !!findPlanet(this.universe, pid));
          if (keptOwned.length !== this.state.ownedPlanets.length) {
            console.warn('[empire] dropped invalid ownedPlanets entries',
              { before: this.state.ownedPlanets.length, after: keptOwned.length });
            this.state.ownedPlanets = keptOwned;
          }
          const keptClaimed: Record<string, number> = {};
          for (const [sid, tier] of Object.entries(this.state.claimedSystems)) {
            if (findSystem(this.universe, sid)) keptClaimed[sid] = tier;
          }
          this.state.claimedSystems = keptClaimed;
          if (this.state.outpostMoonId) {
            // Outpost moon must belong to an owned planet AND still exist.
            const ctx = this.outpostMoonContext();
            if (!ctx) this.state.outpostMoonId = null;
          }
        }
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
  // the main galaxy and write the home/owned/system fields. Solo only — MP
  // uses bootstrapInSystem() with a server-assigned spawn system instead.
  private bootstrapHomeworld(): void {
    // W9 — every player spawns in the main galaxy regardless of which extras
    // exist. Satellites are intergalactic destinations, not spawn slots.
    const pick = pickStartingPlanet(this.mainGalaxy);
    if (!pick) {
      console.warn('[empire] bootstrap: no eligible rocky+moon+temperate planet found');
      return; // ~impossible with ~200 systems, but keep dormant if it happens
    }
    console.log('[empire] bootstrap → home planet picked',
      { system: pick.system.name, planet: pick.planet.name, type: pick.planet.type, temp: pick.planet.temperatureC, moons: pick.planet.moons.length });
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
    // W9 — only main galaxy systems are valid spawn points.
    const sys = this.mainGalaxy.systems.find((s) => s.id === systemId);
    if (!sys) return false;
    // Strict habitable rocky+moon, no fallback. The eligibleSpawnSystemIds
    // filter already guarantees the relay won't assign us a system that fails
    // this check, so a null here indicates a desynced relay/client universe.
    let planet: PlanetData | null = null;
    for (const p of sys.planets) {
      if (isStartingEligible(p)) { planet = p; break; }
    }
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
  // pick lands on a stable assignment. W9 — main galaxy only.
  eligibleSpawnSystemIds(): string[] {
    const out: string[] = [];
    for (const s of this.mainGalaxy.systems) {
      for (const p of s.planets) {
        if (isStartingEligible(p)) { out.push(s.id); break; }
      }
    }
    // Shuffle so the relay's first-fit pick lands on a different system every
    // session — without this, every fresh client serves the relay the same
    // galaxy-order list and the lowest-index unclaimed system always wins.
    return shuffleInPlace(out);
  }

  // --- Read-only getters ----------------------------------------------------

  homeSystem(): SystemData | null {
    if (!this.state.homeClaimed) return null;
    return findSystem(this.universe, this.state.homeSystemId);
  }
  homePlanet(): PlanetData | null {
    if (!this.state.homeClaimed) return null;
    const sys = this.homeSystem();
    return sys?.planets.find((p) => p.id === this.state.homePlanetId) ?? null;
  }
  // W9 — main galaxy reference, used by app.ts to colour the home galaxy
  // bulge and render galaxy-specific markers.
  homeGalaxyId(): string {
    return this.mainGalaxy.id;
  }
  // True for any rocky planet that has at least one moon AND a temperate
  // climate (-30°C..50°C → "habitable"). Rocky guarantees the metal+water
  // baseline income that the Tier I-III west chain costs assume; the moon
  // requirement keeps Moon Outpost reachable; the temperature window enforces
  // habitability so a frozen / volcanic rocky world can never be the start.
  // Single source of truth: every starting-planet picker (solo + MP) and the
  // MP spawn-eligibility list go through this.
  isHomeworldEligible(planet: PlanetData): boolean {
    return isStartingEligible(planet);
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
    const sys = findSystemOf(this.universe, planet.id);
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

  // --- W7: Wormhole Transit ------------------------------------------------
  //
  // Once `wormhole-transit` is unlocked AND the home system is fully claimed
  // (gate already enforced by isVisible for unlock-observatory et al.), the
  // player can annex one second system at T2 (×100 multiplier). The MVP caps
  // wormhole expansion at a single second system — T3+ deferred to a later
  // wave. After the claim, every planet in the target system is owned in one
  // shot (no per-planet annex flow), and the wormhole banner disappears.

  // True once the player has bought the wormhole-transit upgrade. Visibility
  // of the upgrade itself is already gated by isHomeSystemFullyClaimed via
  // isVisible(), so this is just the "ready to claim a wormhole target" flag.
  canStartWormhole(): boolean {
    if (!this.hasUnlock('wormhole-transit')) return false;
    if (this.hasClaimedWormholeSystem()) return false;
    return true;
  }

  // True once any non-home system has tier ≥ 2 in claimedSystems.
  hasClaimedWormholeSystem(): boolean {
    for (const [sysId, tier] of Object.entries(this.state.claimedSystems)) {
      if (sysId !== this.state.homeSystemId && tier >= 2) return true;
    }
    return false;
  }

  // Pick the unclaimed system closest to the home system (galaxy 3D distance).
  // Returns null when wormhole-transit isn't bought yet, when home isn't set,
  // or when the player has already claimed their second system.
  // W9 — picks within the home galaxy only; intergalactic claims have their
  // own banner / unlock chain.
  nextWormholeTarget(): SystemData | null {
    if (!this.canStartWormhole()) return null;
    const home = this.homeSystem();
    if (!home) return null;
    const homeGalaxy = findGalaxyOfSystem(this.universe, home.id);
    if (!homeGalaxy) return null;
    const [hx, hy, hz] = home.position;
    let best: SystemData | null = null;
    let bestD = Infinity;
    for (const s of homeGalaxy.systems) {
      if (s.id === home.id) continue;
      if (this.state.claimedSystems[s.id]) continue;
      const dx = s.position[0] - hx;
      const dy = s.position[1] - hy;
      const dz = s.position[2] - hz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  wormholeClaimCost(): Partial<ResourceBag> {
    return WORMHOLE_CLAIM_COST;
  }

  // Claim the next wormhole target as a T2 system. Bulk-adds every planet in
  // that system to ownedPlanets so the player's resource pipe immediately
  // benefits from the ×100 tier multiplier. Returns false when not affordable
  // or no target is available.
  claimNextWormhole(): boolean {
    const target = this.nextWormholeTarget();
    if (!target) return false;
    const cost = this.wormholeClaimCost();
    if (!canAfford(this.state.resources, cost)) return false;
    subtractCost(this.state.resources, cost);
    this.state.claimedSystems[target.id] = 2;
    for (const p of target.planets) {
      if (!this.state.ownedPlanets.includes(p.id)) {
        this.state.ownedPlanets.push(p.id);
      }
    }
    this.save();
    this.emit();
    return true;
  }

  // Returns every system this empire has claimed at T2 specifically (in-galaxy
  // wormhole). Excludes T3/T4 — those come from the intergalactic chain and
  // are rendered as separate connections.
  wormholeSystemIds(): string[] {
    const out: string[] = [];
    for (const [sysId, tier] of Object.entries(this.state.claimedSystems)) {
      if (sysId !== this.state.homeSystemId && tier === 2) out.push(sysId);
    }
    return out;
  }

  // --- W9: Intergalactic Bridge --------------------------------------------
  //
  // After Trade Hub, the player can buy `intergalactic-bridge` to access the
  // satellite galaxies. The first claim picks the closest extra galaxy and
  // marks ONE of its rocky+moon systems at T3 (×10K multiplier). All of that
  // system's planets enter ownedPlanets in one shot, which makes T3 feel like
  // an actual milestone. T4 (wormhole within an extra galaxy) deferred.

  canStartIntergalactic(): boolean {
    if (!this.hasUnlock('intergalactic-bridge')) return false;
    if (this.hasClaimedIntergalacticSystem()) return false;
    return true;
  }

  hasClaimedIntergalacticSystem(): boolean {
    for (const tier of Object.values(this.state.claimedSystems)) {
      if (tier >= 3) return true;
    }
    return false;
  }

  // Pick the satellite galaxy closest to the home galaxy AND its best
  // rocky+moon system (so the T3 income lands on a planet whose moons can host
  // the moon-outpost dome and wear the player's home-system visuals well).
  // Returns the (galaxy, system) tuple or null when no claim is available.
  nextIntergalacticTarget(): { galaxy: GalaxyData; system: SystemData } | null {
    if (!this.canStartIntergalactic()) return null;
    const homeGalaxy = this.universe.galaxies[0];
    if (!homeGalaxy) return null;
    const [hx, hy, hz] = homeGalaxy.position;

    let bestGalaxy: GalaxyData | null = null;
    let bestD = Infinity;
    for (let i = 1; i < this.universe.galaxies.length; i++) {
      const g = this.universe.galaxies[i]!;
      // Skip galaxies that already have a T3+ system claimed — a future wave
      // can extend this to multiple T3s; for now one per galaxy.
      const hasT3InG = g.systems.some((s) => (this.state.claimedSystems[s.id] ?? 0) >= 3);
      if (hasT3InG) continue;
      const dx = g.position[0] - hx;
      const dy = g.position[1] - hy;
      const dz = g.position[2] - hz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; bestGalaxy = g; }
    }
    if (!bestGalaxy) return null;

    // Pick best rocky+moon system in that galaxy, falling back to first system.
    let bestSys: SystemData | null = null;
    for (const s of bestGalaxy.systems) {
      const hasRocky = s.planets.some((p) => p.type === 'rocky' && p.moons.length > 0);
      if (hasRocky) { bestSys = s; break; }
    }
    if (!bestSys) bestSys = bestGalaxy.systems[0] ?? null;
    if (!bestSys) return null;
    return { galaxy: bestGalaxy, system: bestSys };
  }

  intergalacticClaimCost(): Partial<ResourceBag> {
    return INTERGALACTIC_CLAIM_COST;
  }

  // Claim the next intergalactic target as a T3 system. Bulk-adds every planet
  // in the target system to ownedPlanets so the ×10K tier multiplier kicks in
  // immediately — by far the biggest single-purchase income jump in the game.
  claimNextIntergalactic(): boolean {
    const target = this.nextIntergalacticTarget();
    if (!target) return false;
    const cost = this.intergalacticClaimCost();
    if (!canAfford(this.state.resources, cost)) return false;
    subtractCost(this.state.resources, cost);
    this.state.claimedSystems[target.system.id] = 3;
    for (const p of target.system.planets) {
      if (!this.state.ownedPlanets.includes(p.id)) {
        this.state.ownedPlanets.push(p.id);
      }
    }
    this.save();
    this.emit();
    return true;
  }

  // Returns every system claimed at T3 or higher — used by the galaxy / universe
  // connection-line renderer to draw intergalactic bridges.
  intergalacticSystemIds(): string[] {
    const out: string[] = [];
    for (const [sysId, tier] of Object.entries(this.state.claimedSystems)) {
      if (tier >= 3) out.push(sysId);
    }
    return out;
  }

  // --- W7: Trade Hub --------------------------------------------------------
  //
  // Trade swaps a chunk of the player's most-abundant resource for half as
  // much of their least-abundant resource (2:1 ratio favouring the rare one,
  // since "rare" is what the player wants from a trade). Resources are
  // private per W6 design — the relay just confirms whether a counterpart
  // exists, and each side runs this swap locally.

  // Returns the swap that *would* happen if the player traded right now.
  // Returns null when the player can't trade (no unlock yet, or doesn't
  // have meaningful stocks to swap).
  previewTrade(): TradeSwap | null {
    if (!this.hasUnlock('trade-hub')) return null;
    const bag = this.state.resources;

    let giveKey: ResourceKey | null = null;
    let giveStock = 0;
    for (const k of RESOURCE_KEYS) {
      if (bag[k] > giveStock) { giveStock = bag[k]; giveKey = k; }
    }
    // Trades smaller than 100 of the abundant resource aren't worth firing.
    if (!giveKey || giveStock < 100) return null;

    let getKey: ResourceKey | null = null;
    let getStock = Infinity;
    for (const k of RESOURCE_KEYS) {
      if (k === giveKey) continue;
      if (bag[k] < getStock) { getStock = bag[k]; getKey = k; }
    }
    if (!getKey) return null;

    const giveAmount = giveStock * 0.2;
    // 2:1 — give X of abundant → gain X/2 of rare. Tilted toward the rare
    // resource so the player feels rewarded even when the give is large.
    const getAmount = giveAmount * 0.5;
    return {
      give: { resource: giveKey, amount: giveAmount },
      get:  { resource: getKey,  amount: getAmount },
    };
  }

  // Apply the trade. Returns the resolved swap (with capped get amount) on
  // success, null if no trade was possible. Caller is responsible for
  // surfacing the banner UI; this method just mutates state + emits.
  executeTrade(): TradeSwap | null {
    const swap = this.previewTrade();
    if (!swap) return null;
    const bag = this.state.resources;
    const m = this.computeMetrics();
    bag[swap.give.resource] -= swap.give.amount;
    if (bag[swap.give.resource] < 0) bag[swap.give.resource] = 0;
    const cap = m.caps[swap.get.resource];
    const targetAmount = bag[swap.get.resource] + swap.get.amount;
    bag[swap.get.resource] = Math.min(cap, targetAmount);
    this.save();
    this.emit();
    return swap;
  }
  // Resolve the chosen outpost moon back to a planet/system pair so income can
  // be tier-scaled and the renderer knows where to attach the dome.
  outpostMoonContext(): { planet: PlanetData; systemId: string } | null {
    if (!this.state.outpostMoonId) return null;
    for (const g of this.universe.galaxies) {
      for (const s of g.systems) {
        for (const p of s.planets) {
          if (!this.state.ownedPlanets.includes(p.id)) continue;
          for (const m of p.moons) {
            if (m.id === this.state.outpostMoonId) {
              return { planet: p, systemId: s.id };
            }
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
      const p = findPlanet(this.universe, pid);
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
      const p = findPlanet(this.universe, pid);
      if (!p) continue;
      planetCount++;
      const sys = findSystemOf(this.universe, pid);
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
  // Returns 1 for unknown / home / unclaimed-but-occupied systems. Tiers run
  // 1 (×1, home) → 2 (×100, in-galaxy wormhole) → 3 (×10K, intergalactic) →
  // 4 (×1M, intra-foreign-galaxy wormhole, deferred for now).
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
      const p = findPlanet(this.universe, pid);
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

// True iff a planet meets every starting-planet rule:
//   - ocean type → green/blue habitable visual + metal+water baseline income
//     (PLANET_INCOME[ocean] now matches the cost catalogue's metal+water assumption)
//   - ≥1 moon → Moon Outpost is reachable from the home planet
//   - temperate (-30°C..50°C) → frozen/scorched ocean worlds are rejected
// Single source of truth shared by solo bootstrap, MP bootstrap, and the MP
// spawn-eligibility list. No fallback path — if no planet qualifies the empire
// stays dormant rather than landing on a non-habitable world.
function isStartingEligible(planet: PlanetData): boolean {
  if (planet.type !== 'ocean') return false;
  if (planet.moons.length === 0) return false;
  if (planet.temperatureC < -30 || planet.temperatureC > 50) return false;
  return true;
}

// Pick a random starting planet from the galaxy — strict habitable rocky+moon
// only, no fallback. Returns null if every planet fails the filter (vanishingly
// rare with ~200 systems but the empire stays dormant cleanly). Randomness is
// per-page-load (Math.random) so each fresh save lands on a different system;
// once persisted, homeSystemId is sticky across reloads.
function pickStartingPlanet(galaxy: GalaxyData): { system: SystemData; planet: PlanetData } | null {
  const eligible: { system: SystemData; planet: PlanetData }[] = [];
  for (const s of galaxy.systems) {
    for (const p of s.planets) {
      if (isStartingEligible(p)) {
        eligible.push({ system: s, planet: p });
        break; // one home per system is enough for the picker
      }
    }
  }
  if (eligible.length === 0) return null;
  const idx = Math.floor(Math.random() * eligible.length);
  return eligible[idx]!;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function findPlanet(universe: UniverseData, planetId: string): PlanetData | null {
  for (const g of universe.galaxies) {
    for (const s of g.systems) {
      for (const p of s.planets) {
        if (p.id === planetId) return p;
      }
    }
  }
  return null;
}

function findSystem(universe: UniverseData, systemId: string): SystemData | null {
  for (const g of universe.galaxies) {
    for (const s of g.systems) {
      if (s.id === systemId) return s;
    }
  }
  return null;
}

function findSystemOf(universe: UniverseData, planetId: string): SystemData | null {
  for (const g of universe.galaxies) {
    for (const s of g.systems) {
      for (const p of s.planets) {
        if (p.id === planetId) return s;
      }
    }
  }
  return null;
}

function findGalaxyOfSystem(universe: UniverseData, systemId: string): GalaxyData | null {
  for (const g of universe.galaxies) {
    for (const s of g.systems) {
      if (s.id === systemId) return g;
    }
  }
  return null;
}
