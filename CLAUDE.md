# The Vibecoder's Guide to the Galaxy

> **Game title:** The Vibecoder's Guide to the Galaxy.
> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders
> **Status:** Wave 1 (galaxy map) complete + runtime strings migrated to English + Wave 1.5 polish (elliptical orbits with Kepler 2nd-law motion, extent-aware system packing with cluster bias, smooth chasing camera, 10000-unit disk). Gameplay layer not started — will be built on top of the simulation in the next session.

---

## Project direction

**Incremental space empire — multiplayer.**

The galaxy you see now is the playable map. The game loop, economy, and multiplayer relay haven't been wired yet. The next session will lock the gameplay design and add the game loop on top.

---

## What's done

A 3-layer galaxy simulation:

1. **Galaxy layer** — ~200 star systems on spiral arms around a supermassive black hole.
2. **System layer** — fly into a system; planets orbit the star with rings, moons, orbit lines.
3. **Planet layer** — focus on a planet; its moons orbit it, you can hop between sibling planets.

All bodies are procedural — no textures, no external assets. GLSL fragment shaders for planets, stars, moons, accretion disk, nebula skydome.

Full parameter reference and architecture in **`docs/GALAXY.md`**.

---

## Resume here (start of next session)

1. Read this file end-to-end and `docs/GALAXY.md`.
2. `git log --oneline -10` to see recent history.
3. Lock the gameplay design with the user (incremental empire — economy, build queues, multiplayer relay) before coding any logic.

---

## Locked tech rules

- **3D** — Three.js (WebGL only, no WebGPU). 100% procedural — NO Blender / external assets / textures. Geometry + shaders + lighting only.
- **Multiplayer** — PartyKit relay (Cloudflare Workers). Single shared room, ≤16 players. (Not wired yet.)
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`. Do not remove.
- **Public repo, commits land on `main`.**
- **Instant-load** — no loading screens, no asset downloads. Audio (when added) must be WebAudio synthesized.
- **90% AI** — gameplay logic written by Claude under user direction.
- **Language** — all docs, code comments, commit messages, and runtime UI strings are English. Turkish strings present today are interim.

---

## Current state of the tree

```
gamejam/
├── CLAUDE.md            this file
├── docs/
│   └── GALAXY.md        full parameter reference + architecture
├── index.html           minimal scaffold + mandatory Vibe Jam widget
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/favicon.svg
├── src/
│   ├── main.ts          bootstrap
│   ├── style.css        UI styling
│   └── galaxy/
│       ├── app.ts                  orchestrator + render loop
│       ├── camera-controller.ts    smooth layer transitions, drag/wheel
│       ├── types.ts
│       ├── rng.ts                  seeded mulberry32
│       ├── generation.ts           procgen: galaxy/system/planet/moon + lore
│       ├── shaders.ts              all GLSL: planet/star/moon/disk/nebula
│       ├── starfield.ts            background nebula skydome + 3 star layers
│       ├── blackhole.ts
│       ├── star.ts
│       ├── planet.ts               planets + rings + moons + orbits
│       ├── system.ts               star + planets + orbit lines
│       ├── galaxy.ts               full assembly + LOD switching
│       ├── labels.ts               HTML overlay labels with N-nearest LOD
│       ├── picking.ts              raycaster-based clicks
│       └── ui.ts                   breadcrumb, layer switcher, panel, list
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

## Workflow notes

- User is non-technical — explain WHAT and WHY, not code internals.
- Plan before implementing; wait for user confirmation before each phase.
- Commit only when user explicitly approves.
- Update this file after each completed phase so future sessions can resume.
