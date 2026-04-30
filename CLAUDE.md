# The Vibecoder's Guide to the Galaxy

> **Game title:** The Vibecoder's Guide to the Galaxy.
> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders
> **Status:** Wave 2.5 (upgrade UX redesign) complete — pannable graph replaced by a Branch Browser modal with buy VFX. Wave 2 economy/state still in place. Galaxy/system/planet view from earlier waves still works. Surface visuals (drones, factories, space elevators) and multiplayer not yet wired.

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
│   └── empire/                     Wave-2 gameplay layer
│       ├── types.ts                ResourceKey, EmpireState, UpgradeNode
│       ├── upgrades.ts             ~150-node skill tree catalogue (grouped into chains by panel.ts)
│       ├── empire.ts               state, tick, save/load, starting planet selection
│       ├── hud.ts                  top resource bar + Upgrades launcher button (chips carry data-resource)
│       ├── panel.ts                Branch Browser modal — left chain rail + tier-card detail pane
│       └── vfx.ts                  buy effects: drain particles, burst, UNLOCKED text, tier-card flash
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
| **W3** | Planet-surface visuals: procedural factory meshes anchored to the planet (rotate with axial spin), drones zipping between them. System view shows them as emissive glow + connection lines. |
| **W4** | Phase 2 — Moon outpost + Space Elevator. Drone shuttles travel along the elevator; visible from system view. **Bundles a progression rebalance** (see "Known issue" below). |
| **W5** | Phase 3 — System Expansion: colonise other planets in the home system, per-planet-type production, inter-planet drone trails. |
| **W6** | PartyKit relay — replicate each player's public empire state (claimed system, owned planets, owned upgrades). Other players' systems show their progress visually. |
| **W7** | Phase 4 — Wormholes + Trading. Observatory unlocks wormhole rifts, transit lets you visit other systems, trade hub allows resource swaps with other players. |

Tunables that may need rebalancing as gameplay matures: starter trickle (`TRICKLE_PER_OWNED_PLANET = 0.8`), base storage cap (`BASE_STORAGE_CAP = 200`), per-tier rate values in `src/empire/upgrades.ts`.

### Known issue — single-resource progression deadlock (fix in W4)

If the home planet is anything other than rocky (metal-producing), the player can hit a wall where **no upgrade is buyable**:

1. Trickle only produces the resource of planets you own — water-planet players never see metal income.
2. Production chains for unowned planet types are hidden via `requiresResource`, so the player can't grind metal/silicon up by buying mining tiers.
3. West chains (Storage Bays, Drone Fleet, Tech) **are visible** but their costs lean heavily on metal+silicon. A water-only player can't afford any of them.
4. Moon Outpost requires `drone-count-3` (Drone Fleet III) as prereq AND costs 250 metal + 60 silicon — completely unreachable without a metal-producing planet.

Effect: only a rocky-temperate starting roll plays cleanly. Everyone else needs the debug `+10 000 res` grant to make any progress.

Fix plan for W4 (Moon Outpost + Space Elevator visuals are already on the W4 menu — bundle the progression rebalance with them):

1. **Universal seed trickle** — every player gets ~0.2/s of all 7 resources regardless of planet ownership, in addition to the 0.8/s per owned planet. Slow but unblocks every starting roll.
2. **Cost rebalance** — west chains and milestone unlocks shouldn't be metal-pure; spread early-tier costs across resources the player is likely to be producing. Milestone costs (Moon, Elevator, etc.) should require a *mix* but include at least one resource the home planet produces.
3. **More node variety** — currently ~150 nodes; with 7 resources we have headroom to push toward ~250 (per-resource storage chain, per-resource processing chain, per-resource cross-doctrine). Goal: every resource gets its own optimisation arc, not just metal.
4. **Milestone band in panel UI** — pin Expansion-category nodes (Moon Outpost, Space Elevator, System Expansion, Wormhole Observatory, etc.) to a dedicated "Milestones" strip at the top of the modal, visually distinct from the regular tier list — bigger cards, phase-icon, "PHASE 2 / 3 / 4" labels. Expansion chain currently hides under one rail entry; player has to dig for it.

Touched files for the W4 rebalance: `src/empire/empire.ts` (trickle), `src/empire/upgrades.ts` (whole catalogue), `src/empire/panel.ts` (milestone strip), maybe `src/empire/types.ts` (`milestone: true` flag on UpgradeNode).

---

## Workflow notes

- User is non-technical — explain WHAT and WHY, not code internals.
- Plan before implementing; wait for user confirmation before each phase.
- Commit only when user explicitly approves.
- Update this file after each completed phase so future sessions can resume.
- Storage keys to know: `vibecoder.empire.v3` (full empire state), `vibecoder.empire.panelWidth.v2` (legacy panel width — unused after W2 redesign, can be deleted).
