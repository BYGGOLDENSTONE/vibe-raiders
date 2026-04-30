# Portal Empires — Game Design

## Core loop (with incremental depth)

The shared galaxy and multiplayer interaction are the *spectacle*. The incremental progression is what keeps the player clicking long enough to feel the spectacle. Both have to be good.

The full loop:

1. **Produce** — base resources (Credits, Ore) tick up from owned planets.
2. **Upgrade** — spend on a branching upgrade tree with meaningful choices, not just `level++`.
3. **Specialize** — pick a role for each planet at level 5; specializations create synergies with other planet kinds.
4. **Expand** — unlock new planets in your sector; race neighbors for contested neutral planets.
5. **Trade** — open internal routes, then bilateral cross-player routes that unlock the **Data** resource.
6. **Research** — spend Data on a tech tree that unlocks new upgrade branches, automations, and ship classes.
7. **Refine** — late-mid game introduces a **refined resource tier** (Capital, Alloy) produced by consuming base resources, gating the next upgrade band.
8. **React** — galactic demand fluctuates; events shift prices; players reposition production.
9. **Climb** — leaderboard, neutral-planet captures, cross-player route count.

The number-go-up loop must work even with the player mostly clicking UI. The 3D galaxy must reflect every decision. **And** every 30–90 seconds the player should unlock or discover something new — the standard incremental dopamine cadence.

## Galaxy structure (unchanged from earlier rev)

- One PartyKit room (`hub-1`) → one galaxy seed.
- 16 sectors, each ~6–8 planets. 1 home + 5–7 unlockable + 1–2 contested neutral.
- Galactic center: Vibe Jam wormhole.

## Resources — three tiers

### Tier 1 (base)

**Credits.** Main currency. Sources: planet production, internal route deliveries, Cross-player route share, gifts. Uses: production upgrades, planet unlocks, route slots, refining.

**Ore.** Material. Sources: rocky planets, mining drones, incoming cross-player cargo, neutral-planet capture rewards. Uses: cross-player route setup, ship capacity, refining, infrastructure.

### Tier 2 (refined — unlocks ~6–8 minutes in)

**Capital** (refined Credits). Produced by **Refinery** structures that consume Credits + Ore at a slower rate. Capital is the only currency that buys **Tier 3 upgrades** and **Tech research**.

**Alloy** (refined Ore). Produced by **Foundry** structures consuming Ore + Credits. Alloy is required for advanced ship classes, neutral-planet capture beyond the first, and elite cross-player route tiers.

The refining tier is the standard incremental "you've maxed Tier 1, here's a bigger lever" wall. Conversion ratios start unfavorable (10 Credits + 5 Ore = 1 Capital) and improve via Refinery upgrades — classic incremental optimization puzzle.

### Tier 3 (multiplayer-gated)

**Data.** Sources: **cross-player route deliveries only** (small drip), galactic-event participation, claiming neutral planets, daily login bonus (stretch). Uses: tech research tree, automation upgrades, Singularity Jump (stretch).

Data being **only** earnable via multiplayer interaction is what makes the incremental progression force the player into the spectacle. A solo player hits a hard ceiling without Data, can't unlock the tech tree, can't compete on the leaderboard.

## Planet model (with specializations)

```ts
interface PlanetState {
  id: string;
  name: string;
  kind: 'home' | 'rocky' | 'gas' | 'ice' | 'neutral';
  ownerId: string | null;
  unlocked: boolean;
  level: number;                                  // 1..20
  specialization: PlanetSpec | null;              // chosen at level 5
  buildings: BuildingId[];                        // up to 3 slots, unlocked at lvl 3, 8, 14
  position: Vec3;
  sectorId: number;
  cityIntensity: number;                          // shader uniform 0..1
}

type PlanetSpec =
  | 'industrial'   // +50% Credits production, -25% Ore production
  | 'mining'       // +50% Ore production, +10% Capital from refining
  | 'hub'          // +1 internal route slot, route values +20%
  | 'research'     // generates a small Data trickle, +10% tech speed
  | 'refinery';    // doubles refining throughput on this planet
```

**Choice matters.** A `hub` planet next to two `industrial` planets is far better than a fourth `industrial`. The synergy system (below) makes specialization a real strategic decision, not a flavor pick.

**Buildings** (up to 3 slots per planet, unlocked at planet levels 3, 8, 14):
- **Refinery** (Tier 2 unlock) — converts Credits+Ore to Capital.
- **Foundry** (Tier 2 unlock) — converts Ore+Credits to Alloy.
- **Research Lab** (Tier 3 unlock) — generates Data trickle on any planet (synergy with `research` spec).
- **Beacon Array** — boosts cross-player route capacity by +1 (empire cap +1 per Beacon).
- **Storage Silo** — multiplies storage cap by 3× for that planet.
- **Auto-Dispatcher** — automatically launches cargo ships on routes touching this planet.
- **Defense Grid** — protects planet from galactic events (50% mitigation).

Buildings give **per-planet decisions** on top of upgrades — another layer of clicker depth.

## Upgrade tree

The tree has **5 branches**, each with 4–5 nodes that unlock progressively. Nodes have prerequisites. This replaces the flat 7-upgrade list and gives the proper "expanding tree" feel.

### Branch I — Production

```
PROD-1: Planet Core         (per-planet, +25% credits/lvl, max 10)
  └ PROD-2: Industrial Loop  (empire, +5% all credit production/lvl, max 8)
       └ PROD-3: Smart Grid   (empire, idle credit production +10%/lvl, max 5)
            └ PROD-4: Hyperdense Cores (empire, every 5th planet level grants +1 free upgrade)
                 └ PROD-5: Capital Engine (Tier 3) (empire, ×1.5 to Capital refining)
```

### Branch II — Material

```
MAT-1:  Mining Drones        (per-planet rocky, +30% ore/lvl, max 10)
  └ MAT-2: Deep-Vein Survey   (empire, every rocky planet finds +1 ore vein, max 5)
       └ MAT-3: Cargo Compression (empire, +20% route value/lvl, max 6)
            └ MAT-4: Alloy Press      (Tier 2 building unlock — Foundry)
                 └ MAT-5: Stellar Alloys  (Tier 3) (empire, all routes carry double payload)
```

### Branch III — Logistics

```
LOG-1: Docking Ring          (empire, +1 internal route slot/lvl, max 5)
  └ LOG-2: Wormhole Beacon    (empire, +1 cross-player route slot/lvl, max 4)
       └ LOG-3: Auto Broker    (empire automation, auto-dispatches cargo)
            └ LOG-4: Trade Singularity (Tier 3) (cross-player routes split 70/30 instead of 60/40 in your favor on accepted proposals)
                 └ LOG-5: Black Channel   (Tier 3) (one anonymous cross-player route — partner sees your color but not name)
```

### Branch IV — Infrastructure

```
INF-1: Atmosphere Processor  (per-planet, +5% all production/lvl, max 8, visibly thickens atmosphere shell)
  └ INF-2: Storage Expansion  (empire, ×2 storage caps/lvl, max 4)
       └ INF-3: Defense Grid   (per-planet, mitigates galactic events on that planet)
            └ INF-4: Sector Shield (empire, halves galactic-event severity in your home sector)
                 └ INF-5: Wormhole Anchor (Tier 3) (planets within 20% of wormhole get +25% production)
```

### Branch V — Research (Tier 3, requires Data)

```
RSCH-1: Telemetry           (empire, generates 0.1 Data/s/lvl, max 5)
  └ RSCH-2: Adaptive Markets (empire, you see all galactic-demand prices live)
       └ RSCH-3: Predictive Trade (empire, +10% to all route values, +1 free Auto-Broker)
            └ RSCH-4: Cargo Lattice   (empire, ×2 ships per route)
                 └ RSCH-5: Singularity Theory (stretch) — unlocks Singularity Jump prestige
```

**Pacing rule:** every node unlocked should change the visible game (a new building option, a new resource flow, a new ship visual). The tree is also a **discovery cascade** — players see locked nodes and chase them.

Cost formula: `baseCost * pow(1.45, level)` for Tier 1 upgrades; Tier 2 uses `pow(1.6, level)`; Tier 3 uses `pow(1.85, level)`. Each tier is a meaningful jump.

## Synergies (multiplicative, the heart of optimization)

Synergies are how planet specialization decisions matter. They make a strategic player's empire produce 3–5× a casual player's by mid-game without bigger numbers — the classic incremental "find the multiplier stack" feel.

| Synergy | Effect | Why it matters |
|---------|--------|----------------|
| **Industrial × Hub** | Each Hub adjacent to your Industrials adds +5% Credits per adjacent Industrial. | Encourages clustering layouts. |
| **Mining × Refinery building** | Each Mining planet with a Refinery converts 25% more efficiently. | Makes specialization stack with building choice. |
| **Research × Data Lab** | Each Research planet with a Lab generates +50% Data. | Scales Tier 3 income. |
| **All-kinds bonus** | Owning at least one of each planet kind grants +10% to everything. | Discourages monoculture. |
| **Sector saturation** | Owning all unlockable planets in your sector grants a permanent +20% Credits. | Endgame chase. |
| **Cross-player diversity** | Each unique partner you've traded with grants +2% Credits permanently (max +30%). | Forces spreading routes across players, not just one. |

Compute these as multipliers in `selectors.ts` so they're transparent and serializable.

## Demand curve (galactic market)

A passive market fluctuation that gives every minute of play a different optimal strategy.

The galaxy has a **demand vector** at any time:
```ts
interface GalacticDemand {
  credits: number;   // 0.7..1.3 multiplier
  ore: number;
  capital: number;
  alloy: number;
  data: number;
  expires: number;   // ms
}
```

The server picks new demand every 90 seconds (sine-wave + noise), broadcasts to all clients via the event channel. Players see live prices in the resource bar (`Credits +32/s ×1.21 ↑`). Routes that **deliver the in-demand resource** get a real-time multiplier.

This converts the static incremental into something with rhythm. Idle play still earns; active play (re-routing to match demand) earns 1.3–2× as much. Both play styles are valid; reactive play is rewarded.

Galactic events can spike one resource's demand to ×2.5 for 60 seconds (e.g., "Asteroid storm in Sector 7 → Ore demand spike") — this is the *cooperative scramble moment* that ties gameplay to spectacle.

## Automation (the idle layer)

Automations unlock from Branch III and from the tech tree. Each one removes a manual click and is a discrete dopamine moment to unlock.

Tier 1 (early):
- **Auto-Dispatcher** (per-planet building) — auto-launches cargo when capacity reaches 80%.
- **Auto-Broker** (LOG-3) — empire-wide, auto-dispatches all routes.

Tier 2 (mid):
- **Auto-Refiner** — sets a target Capital/Alloy stock and auto-converts.
- **Auto-Unlocker** — buys the cheapest available planet unlock when Credits exceed cost ×2.

Tier 3 (Data tech):
- **Auto-Upgrader** — buys cheapest available upgrade in selected branches.
- **Auto-Negotiator** — auto-accepts cross-player route proposals from players above empireValue threshold N.
- **Auto-Reroute** — re-routes ships toward the highest-demand resource each market cycle.

Automation is the **idle promise**: come back later, your empire grew. Important for a player who tabs away mid-jam-judging — when they come back, things have happened.

## Offline progress

When the player closes the tab, save to `localStorage`. On reopen, compute offline gains capped at 2 hours (jam scope) using the last `creditsPerSecond` × elapsed × 0.5 (offline penalty). Show one event-feed line: `Welcome back. While you were away: +12.4K Credits, +2 routes auto-completed.`

This is jam stretch but a 30-line implementation, worth it for the incremental feel.

## Trade routes (unchanged from earlier rev — kept for reference)

### Internal routes

Connect two of your unlocked planets. Generates Credits over time. Visible cargo ships fly along an arc.

Properties: `source`, `target`, `level`, `capacity`, `travelTime`, `valuePerDelivery`, `laneColor`.

### Cross-player routes (the signature mechanic)

Persistent bilateral route between your planet and another player's planet. Both sides pay setup. Cargo flows both directions on the arc. Each delivery splits credits between sender (40%) and receiver (60%) — Branch IV LOG-4 inverts this. **Each delivery also drips Data** to both sides — this is how Data enters the economy.

Visual: thicker tube, identity-color gradient. Dominant on the galactic map.

If receiver is offline when proposal arrives, queued in DO event log, surfaces on next connect.

## Multiplayer interactions (unchanged)

- **Empire layer**: every player's owned-planet set rendered with their identity color tint and upgrade-driven `cityIntensity`.
- **Galactic map view** (M key): zoomed-out, all 16 empires color-coded.
- **Leaderboard**: sorted by `empireValue` (formula below), 0.5 Hz updates.
- **Galactic events**: server-picked every ~5 minutes, sector-targeted, rendered identically on all clients. Storm / Boom / Flare / Demand-spike.
- **Trade gifts**: one-shot Credits gift, 60 s cooldown, lighter first-multiplayer-interaction beat.

## Empire value formula

```txt
empireValue =
    creditsLifetimeEarned
  + oreLifetimeEarned * 2
  + capitalLifetimeEarned * 12         // refined tier scales hard
  + alloyLifetimeEarned * 18
  + dataLifetimeEarned * 100           // multiplayer-gated, scarce
  + unlockedPlanets * 500
  + internalRouteLevels * 250
  + crossPlayerRouteLevels * 750
  + neutralPlanetsClaimed * 1500
  + uniqueTradePartnersEver * 300      // rewards spreading
  + techNodesUnlocked * 800
```

Server clamps obvious bad values (see `MULTIPLAYER_ECONOMY.md`).

## Milestone sequence (drives first 10 minutes)

The Milestone strip always shows one near-term goal. Hitting it unlocks the next.

```
0:00–0:15 — Earn 100 Credits.
0:15–0:45 — Buy Planet Core L1.
0:45–1:30 — Unlock the rocky planet in your sector.
1:30–2:30 — Buy Mining Drones L1.
2:30–3:30 — Open your first internal trade route.
3:30–4:30 — Send a trade gift to any online player.       [forces multiplayer beat]
4:30–6:00 — Open a cross-player trade route.              [Data starts dripping]
6:00–7:00 — Reach top 8 in the room.
7:00–8:00 — Specialize a planet (pick first specialization).
8:00–9:30 — Build your first Refinery (Tier 2 unlocked).
9:30–11:00 — Research RSCH-1 Telemetry (Tier 3 unlocked).
11:00–14:00 — Claim a contested neutral planet.
14:00+   — Open routes with 3 different players. (uniqueTradePartners chase)
```

Each milestone is a **discovery moment** — first time the player sees Tier 2 economy, first time they pick a spec, first time the tech tree opens. Standard incremental cadence: a meaningful new mechanic every ~90–120 seconds for the first 10 minutes, then slowing.

## Balancing pace targets

- First click feels good: 5–8 s for first upgrade.
- First ship visible: 15–20 s.
- First internal route: 90–120 s.
- First multiplayer interaction (gift): 2–3 min.
- First cross-player route: 4–6 min.
- First specialization: 7–8 min.
- First Refinery (Tier 2): 8–10 min.
- First Tech research (Tier 3): 10–12 min.
- First neutral capture: 12–15 min.

Faster than typical idle pacing — jam version is a demo, not a Steam build. Tune in Wave 6.

## Win condition

No hard win. Chase loop:
- Bigger empireValue.
- More planets owned + neutral captures.
- Higher leaderboard rank.
- More cross-player routes (and unique partners).
- Full tech tree completion.
- Survive a galactic event better than neighbors.

## AI-made angle (visible to jurors)

- 100 planets, names, sectors all from one seed.
- Planet/wormhole/nebula shaders procedural.
- Ship trajectories shared without per-frame sync.
- Branching upgrade tree, synergies, demand curve, three resource tiers — *visible* incremental depth that proves it isn't a 5-line clicker.
- The fact that 16 players share a galaxy in one tab without lag is the AI-flex.

Optional event feed templates:
- `Dock crews on {planet} report a {pct}% cargo compression gain.`
- `{playerA} ↔ {playerB} opened a {kind} corridor.`
- `Asteroid storm forecast for {sector}.`
- `Capital refinery online at {planet} — Tier 2 economy unlocked.`
- `Galactic demand shifts: {resource} ×{mult}.`
- `Wormhole flare detected — gather at the portal.`
