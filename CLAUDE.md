# The Vibecoder's Guide to the Galaxy

> **Game title:** The Vibecoder's Guide to the Galaxy.
> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders
> **Status:** Wave 2 (empire foundation) complete — 7-resource economy, ~150-node skill-tree modal, top resource HUD, deterministic starting planet, localStorage save. Galaxy/system/planet view from earlier waves still works. Surface visuals (drones, factories, space elevators) and multiplayer not yet wired.

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
│       ├── upgrades.ts             ~150-node skill tree catalogue with grid positions
│       ├── empire.ts               state, tick, save/load, starting planet selection
│       ├── hud.ts                  top resource bar + Upgrades launcher button
│       └── panel.ts                pannable skill-tree modal (SVG edges + DOM nodes)
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
| **W4** | Phase 2 — Moon outpost + Space Elevator. Drone shuttles travel along the elevator; visible from system view. |
| **W5** | Phase 3 — System Expansion: colonise other planets in the home system, per-planet-type production, inter-planet drone trails. |
| **W6** | PartyKit relay — replicate each player's public empire state (claimed system, owned planets, owned upgrades). Other players' systems show their progress visually. |
| **W7** | Phase 4 — Wormholes + Trading. Observatory unlocks wormhole rifts, transit lets you visit other systems, trade hub allows resource swaps with other players. |

Tunables that may need rebalancing as gameplay matures: starter trickle (`TRICKLE_PER_OWNED_PLANET = 0.8`), base storage cap (`BASE_STORAGE_CAP = 200`), per-tier rate values in `src/empire/upgrades.ts`.

---

## Workflow notes

- User is non-technical — explain WHAT and WHY, not code internals.
- Plan before implementing; wait for user confirmation before each phase.
- Commit only when user explicitly approves.
- Update this file after each completed phase so future sessions can resume.
- Storage keys to know: `vibecoder.empire.v3` (full empire state), `vibecoder.empire.panelWidth.v2` (legacy panel width — unused after W2 redesign, can be deleted).
