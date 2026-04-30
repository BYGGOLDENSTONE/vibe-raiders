# The Vibecoder's Guide to the Galaxy

> **Game title:** The Vibecoder's Guide to the Galaxy.
> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders
> **Status:** Wave 4-A complete — economy fully redesigned around per-planet primary+secondary income, planet-count synergy, and a system-tier multiplier (×100 per tier). Home is always rocky (metal+water baseline) so milestone costs gate cleanly. HOME button + breadcrumb/label markers added. Wave 4-B (Moon Outpost + Space Elevator visuals) and multiplayer still pending.

---

## Project direction

**Incremental space empire — multiplayer.**

The galaxy from Wave 1 is the playable map. Wave 2 layered the resource economy and upgrade tree on top. Future waves add planet-surface visuals, system expansion, and the PartyKit relay so other players' empires become visible.

---

## What's done

### Wave 1 — galaxy simulation (carry-over)
A 3-layer procedural galaxy:
1. **Galaxy layer** — ~200 star systems on spiral arms around a supermassive black hole.
2. **System layer** — fly into a system; planets orbit the star with rings, moons, orbit lines.
3. **Planet layer** — focus on a planet; its moons orbit it, sibling planets remain visible.

All bodies are procedural — no textures, no external assets. GLSL fragment shaders for planets, stars, moons, accretion disk, nebula skydome. Full reference in **`docs/GALAXY.md`**.

### Wave 2 — empire foundation (this session)

Gameplay layer that sits on top of the galaxy view:

- **Seven resources, 1:1 with planet types**: Metal (rocky), Water (ocean), Gas (gas), Crystal (ice), Plasma (lava), Silicon (desert), Chemical (toxic). Same global pool for every player; you only earn a resource if you own a planet of that type, so player must spread to access all of them.
- **Top resource HUD**: single straight row of compact chips (`[●] METAL 153 +0.8/s`), seven total + an `Upgrades` launcher button. Locked resources show `—`. Lives top-center, below the layer switcher.
- **Skill-tree modal** (`▦ Upgrades` button → full-screen overlay):
  - ~150 nodes laid out on a 140 px grid, edges drawn as straight or L-shaped SVG paths (no curves, no diagonals).
  - **CORE** node at origin, always owned.
  - **Up column**: Expansion (Moon → Elevator → Shipyard → System Expansion → Wormhole Observatory → Transit → Trade Hub).
  - **East half**: 7 mining lanes + 7 optimisation rows, alternating above and below row 0 so resource lanes are interleaved instead of stacked as one block.
  - **West half**: 10 chains of logistics, drones, and tech mixed across rows. Tech chains have **cross-category prereqs** (Industrial Doctrine ← Storage Bays II, Storage Doctrine ← Refinery II, Swarm Doctrine ← Drone Fleet III, Quantum Compute ← Drone Engines II) so the tree feels woven, not striped.
  - Modal is pannable with mouse drag (capture only acquires after >4 px movement so node clicks aren't swallowed). Esc / backdrop click / × closes.
- **Tick** runs every render frame, dt-driven. Trickle of `0.8/s` per owned producing planet so the very first upgrade is reachable in ~10 s.
- **Deterministic starting planet**: scans the galaxy for habitable + moon-bearing worlds and picks the best (ocean+temperate > rocky+temperate > rocky+any). Persisted across reloads.
- **Save/load**: `localStorage` under `vibecoder.empire.v3`. Empire auto-saves every 5 s of wall clock and on every purchase. No offline progress.
- **Detail panel** lives on the right (top: 132 px so it doesn't collide with the HUD). The old bottom-left "planets in system" list was removed — clicking labels and the system view itself already does that job.

### Wave 2.5 — upgrade panel redesign (this session)

The pannable skill-tree canvas was scrapped in favour of a **Branch Browser** modal. Driven by a Claude Design handoff (`Galaxy Upgrade Tree.html` prototype): the user explicitly preferred the Browser layout over the constellation/orrery alternatives.

- **Left rail**: chains grouped under category headers (Expansion → Production → Drones → Logistics → Tech). Each chain row shows a coloured progress bar, name, `owned/total`, and a pulsing dot when a tier is buyable. Click selects the chain — no panning, no zoom.
- **Right detail pane**: chain header (icon, eyebrow, description, Progress / Next tier / ETA stats) above a vertical list of tier cards. Each card has the tier glyph, effect, cost pills (`have/need`, green when affordable, red when short), and a `Buy` button. Locked tiers show ETA or `Locked`; owned tiers show `✓ Owned` and an `Active` badge.
- **Buy VFX** (`src/empire/vfx.ts`): on click, drain particles fly from each consumed HUD chip toward the buy button (the chips also shake + tint with `--c`), then 280 ms later the actual `empire.buy()` lands and a burst (radial sparks, ring shockwave, soft flash, 18 dots) plus a floating `UNLOCKED` label fires at the button. The tier card flashes with a category-coloured glow. Respects `prefers-reduced-motion`.
- **HUD chips** carry `data-resource="<key>"` so VFX can target them.
- **Modal** still keyboard-friendly: Esc closes, backdrop click closes, × button closes. Scroll inside the rail and detail pane independently.
- **Deleted**: `em-tree-*`, `em-node-*` styles + the panning logic. `panel.ts` is now ~290 lines without any drag/pan code.

### Wave 3 — planet-surface visuals (this session)

Owned home planet now reads as an active industrial world rather than a bare procedural sphere:

- **Factories** (`src/empire/surface.ts`) — 3 baseline + 1 per unlocked mining-rate tier for the planet's resource (cap 9). Procedural towers (BoxGeometry body + cap + antenna), oriented to the surface normal so they stand upright wherever they land. Cap colour matches the resource's HUD chip. Bodies live under `planet.body`, so they rotate with the axial spin like the rest of the planet.
- **Drones** — `8 + 6 × drone-count level` (so the swarm reads as dense even at level 0). Each drone slerp-interpolates between two random factory anchors with a sine-loft so paths arc above the surface. Speed scales with `metrics.droneSpeed`. `MeshBasicMaterial` + additive blending gives an emissive look without needing extra lights.
- **Deterministic placement** — factory positions come from a Fibonacci spiral seeded by `hash(planet.id + '|surface')`, jittered by RNG so the same planet always produces the same skyline.
- **Lifecycle** (`app.ts`) — `rebuildSurfaceIfNeeded()` runs on construction and on every `empire.subscribe` emit, but cheap-skips when both `factoryCount` and `droneCount` are unchanged (no GC churn from unrelated purchases). `disposeSurface` drops geometries/materials when rebuilding.
- **Tick** — `updateSurface(handle, dt, metrics)` advances drone `t` parameters in the main render loop. ~30 drones × tiny sphere mesh, no perf concern.

### Wave 4-A — economy rewrite (this session)

The single-resource progression deadlock and a flat trickle-driven economy were both replaced with a layered, planet-anchored model:

- **Per-planet income** (`PLANET_INCOME` table in `src/empire/types.ts`) — every owned planet contributes a primary + secondary stream (e.g. rocky → 3/s metal + 1.5/s water, ocean → 3/s water + 1.5/s gas, …). Resources you don't own a producing planet for stay at zero — no universal trickle.
- **Moon outposts** (Phase 2 `moon-outpost` unlock) — each owned planet's moons each add +5/s crystal. So a rocky home with 1-3 moons drips crystal as soon as Phase 2 lands, opening the cost lane for Phase 3+.
- **Planet-count synergy** — every owned planet adds +20% to a global multiplier (compound). 7-planet full home system → ×3.4 global from synergy alone.
- **System-tier multiplier** — `SYSTEM_TIER_BASE = 100`, applied per-system: home is T1 (×1), wormhole-claimed systems are T2 (×100), T3 (×10K), T4 (×1M). Stored as `claimedSystems: Record<systemId, tier>` on `EmpireState`. The home system is implicitly T1; the rest is hooked up but no second system claim path exists yet.
- **Rocky-only home start** (`pickStartingPlanet`) — every player begins with a rocky+moon planet so the cost catalogue can assume `metal + water` as the baseline currency. Removes the "ocean home → can't afford metal milestones" dead-end the old picker created.
- **Tiered cost shape** (`tieredCost` helper) — Tier I-III of every west chain (Storage Bays, Drone Fleet, Refinery, Auto-Sort, Drone Engines, Drone Cargo, plus all four Tech doctrines) costs **metal + water** only. Tier IV-VI mix in **crystal** — by then the player has bought Phase 2 / Moon Outpost, so crystal is flowing.
- **Milestone costs** — Phase 2 (Moon) costs metal+water, Phase 3-6 add crystal, Phase 7 (Wormhole Transit) is in millions of M+W+C, Phase 8 (Trade Hub) is the only step that requires the full 7-resource set (50M-10M each — by then the player has wormhole'd to a T2 system that produces other types).
- **Production chains rewrite** — the flat `rate-add` mining chain was deleted. Each resource now has a single `rate-mul` chain (Metal Refinery, Water Pumping, Gas Compression, Crystal Lab, Plasma Extraction, Silicon Works, Chemical Plant), tier values bumped to **+25/50/100/200/400/800%**. Planet income is the flat baseline; upgrades are pure boost.
- **Upgrade boost rebalance** — global-mul tiers max +400% (×6.3), drone-count tiers add up to 18 each, drone-speed/cargo max ×6.6 / ×9.6, Storage Doctrine tier VI is +10,000,000% capacity (×100,001 cap) so big numbers don't truncate at the storage ceiling. Base storage cap also bumped from 200 → 1000.
- **Bug fix** — `blendedCost(p, pb, p, 0, …)` (used by Metal Refinery) was overwriting the primary cost with the secondary's `0`. Now guarded so `sb=0` is a no-op.
- **HOME UX** — top-right gold pill button (`gx-home-btn`) jumps the camera to the home planet from any view (smooth, via the existing `navigateTo` + `CameraController` transition). Home planet's label gets a `★ HOME · ` prefix; home system's label gets `★ HOME · ` (or `★★ HOME SYSTEM · ` if every planet in the system is owned). Other owned planets get a `✓ ` prefix. Breadcrumb mirrors the same star markers. Driven by `LabelManager.markHome` + `UI.setHomeContext`, refreshed on every empire emit.
- **Save key bumped to v5** — old saves (v3, v4) auto-discard so every player picks up the new rocky home and the new economy. State now persists `claimedSystems`.

### Known issue — solved

The "single-resource progression deadlock" from W3 is gone:
- Every player starts rocky → has metal+water from second one.
- Every Tier I-III west chain costs only metal+water.
- Phase 2 (Moon) costs only metal+water and unlocks crystal income.
- Phase 3+ adds crystal to costs, with crystal already arriving from moons.

---

## Resume here (start of next session)

1. Read this file end-to-end and `docs/GALAXY.md`.
2. `git log --oneline -10` to see recent history.
3. Decide which Wave to tackle next — see "Open work" below.

---

## Locked tech rules

- **3D** — Three.js (WebGL only, no WebGPU). 100% procedural — NO Blender / external assets / textures. Geometry + shaders + lighting only.
- **Multiplayer** — PartyKit relay (Cloudflare Workers). Single shared room, ≤16 players. (Not wired yet.)
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`. Do not remove.
- **Public repo, commits land on `main`.**
- **Instant-load** — no loading screens, no asset downloads. Audio (when added) must be WebAudio synthesized.
- **90% AI** — gameplay logic written by Claude under user direction.
- **Language** — all docs, code comments, commit messages, and runtime UI strings are English. Any Turkish strings still present are interim.

---

## Current state of the tree

```
gamejam/
├── CLAUDE.md
├── docs/
│   └── GALAXY.md
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/favicon.svg
├── src/
│   ├── main.ts
│   ├── style.css                   global UI + empire styles
│   ├── galaxy/                     Wave-1 simulation
│   │   ├── app.ts                  orchestrator + render loop (also hosts Empire tick)
│   │   ├── camera-controller.ts
│   │   ├── types.ts
│   │   ├── rng.ts
│   │   ├── generation.ts
│   │   ├── shaders.ts
│   │   ├── starfield.ts
│   │   ├── blackhole.ts
│   │   ├── star.ts
│   │   ├── planet.ts
│   │   ├── system.ts
│   │   ├── galaxy.ts
│   │   ├── labels.ts
│   │   ├── picking.ts
│   │   └── ui.ts                   breadcrumb, layer switcher, detail panel
│   └── empire/                     Wave-2/3 gameplay layer
│       ├── types.ts                ResourceKey, EmpireState, UpgradeNode
│       ├── upgrades.ts             ~150-node skill tree catalogue (grouped into chains by panel.ts)
│       ├── empire.ts               state, tick, save/load, starting planet selection
│       ├── hud.ts                  top resource bar + Upgrades launcher button (chips carry data-resource)
│       ├── panel.ts                Branch Browser modal — left chain rail + tier-card detail pane
│       ├── vfx.ts                  buy effects: drain particles, burst, UNLOCKED text, tier-card flash
│       └── surface.ts              Wave-3 — factory towers + drone swarm anchored to home planet
└── node_modules/
```

---

## Build commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on localhost:5173 |
| `npm run build` | Strict tsc + vite production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run party:dev` | PartyKit relay (no `partykit/server.ts` yet — will fail until written) |
| `npm run party:deploy` | Deploy relay to Cloudflare |
| `npx tsc --noEmit` | Type-check only |

---

## Open work — wave roadmap

| Wave | Goal |
|---|---|
| **W3** | ✅ Complete. Procedural factory meshes + drone swarm on home planet. System-view emissive glow / connection lines deferred to W5 once multi-planet ownership exists. |
| **W4-A** | ✅ Complete. Economy rewrite (planet income, synergy, system tier, rocky-only home, cost rebalance) + HOME button + label markers. |
| **W4-B** | Moon Outpost + Space Elevator visuals. When `moon-outpost` is unlocked, render a small dome on the home planet's primary moon. When `space-elevator` is unlocked, draw a tether from the planet to the moon with shuttle drones travelling along it (visible from system view, detailed from planet view). |
| **W5** | System Expansion mechanic — `system-expansion` unlock currently just sets a flag; needs UI to claim other planets in the home system, then per-claim resource stream addition. Cumulative income jump (the planned "binler/onbinler" curve) lands here. |
| **W6** | PartyKit relay — replicate each player's public empire state (claimed system, owned planets, owned upgrades). Other players' systems show their progress visually. |
| **W7** | Wormhole transit — claim a second system at T2 (×100 multiplier already wired in `claimedSystems`), visualised by a wormhole rift between systems. Trade Hub for inter-player resource swaps. |

Tunables for ongoing balance: `PLANET_INCOME` rates, `SYNERGY_PER_PLANET = 0.2`, `SYSTEM_TIER_BASE = 100`, `MOON_OUTPOST_INCOME = 5/s crystal`, `BASE_STORAGE_CAP = 1000`, milestone costs in `src/empire/upgrades.ts` `expSteps`.

---

## Workflow notes

- User is non-technical — explain WHAT and WHY, not code internals.
- Plan before implementing; wait for user confirmation before each phase.
- Commit only when user explicitly approves.
- Update this file after each completed phase so future sessions can resume.
- Storage keys to know: `vibecoder.empire.v5` (full empire state — bumped this session, old saves auto-discard), `vibecoder.empire.panelWidth.v2` (legacy panel width — unused after W2 redesign, can be deleted).
