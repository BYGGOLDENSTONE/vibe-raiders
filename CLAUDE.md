# Game Jam — Vibe Jam 2026 (project scaffold)

> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (rename when convenient).
> **Status:** Wave 0 complete — contracts locked, postprocessing pipeline online, PartyKit shared-galaxy authority booting (seed persisted, empire snapshot map, 256-event ring buffer, ping/pong time sync). No gameplay yet — Wave 1 next.

---

## Resume here (start of next session)

1. Read this file end-to-end. The locked tech rules + what's wired below tell you exactly what already exists.
2. `git log --oneline -10` to see recent history; the latest commit message is the Wave 0 acceptance summary.
3. `npm run dev` (vite, usually http://localhost:5173/ unless ports are busy) and `npx partykit dev` (relay at `localhost:1999`).
4. The page boots into a near-black scene with a gold "VIBE JAM" portal arch glowing via SelectiveBloom + ACES Filmic. Console should log `[initGame] postprocessing chain ready (bloom + ACES + SMAA)` and `[multiplayer] connected to room "hub-1"`.
5. Smoke-test PartyKit with `node` + `ws`: a `hello` returns a `welcome` whose `.game` payload includes `seed`, `serverTimeMs`, `yourSectorId`, `empires[]`, `lastEventId`. A `ping` returns a `pong` with `tServer`.
6. Determinism check: `npx tsx scripts/test-seed.ts` prints 100 planets, 16/16 sectors with homes, same-seed → identical output.
7. **Next up: Wave 1.** Dispatch 4 parallel subagents per the plan in `docs/IMPLEMENTATION_PLAN.md` § Wave 1 — each owns one folder under `src/game/galaxy/` or `src/game/shaders/`. Main context integrates after.

---

## Current game direction (locked after planning)

Build **Portal Empires**: a **shared-galaxy multiplayer incremental** where 16 players grow visible empires inside the same procedural galaxy in one browser tab. The wow factor we are chasing from jurors is **"how is this even running in HTML?"** — driven by shared multiplayer state, AAA-jam procedural visuals (Three.js + postprocessing + custom shaders), and trajectory-broadcast netcode. Incremental gameplay is the substrate, not the headline.

Core fantasy: spawn into a populated galaxy, grow your sector, see other players' empires bloom in real time, open bilateral trade routes with neighbors, and use the Vibe Jam portal as the galactic wormhole and social spawn point.

Read these planning docs before gameplay implementation **in this order**:

1. `docs/VISION.md` — product thesis, the "how is this in HTML?" pitch, scope limits.
2. `docs/GAME_DESIGN.md` — core loop, resources (Credits + Ore), shared sectors, cross-player routes, galactic events.
3. `docs/UI_UX_DESIGN.md` — sector + galactic-map views, panel layout, visual polish rules.
4. `docs/MULTIPLAYER_ECONOMY.md` — three-tier state model, trajectory broadcast, time sync, validation, PartyKit footguns.
5. `docs/TECH_STACK.md` — library list, shader recipes, postprocessing chain, performance budget, AVOID list.
6. `docs/IMPLEMENTATION_PLAN.md` — wave-by-wave order and acceptance checks.

High-level wave order (revised — multiplayer-first):

1. ✅ **Wave 0 (DONE)** — Contracts locked (types, EventMap, protocol channels, time-sync handshake) and the tech stack is installed (postprocessing, three-stdlib, troika-three-text, @three.ez/instanced-mesh, tweakpane, stats-gl, vite-plugin-glsl). Composer pipeline (Bloom + ACES + SMAA) is live. PartyKit serves `welcome.game` with seed/empires/ringbuffer.
2. **Wave 1 (NEXT)** — Shared galaxy 3D: procedural nebula, starfield, 100 planets from seed, planet/wormhole shaders, two tabs see each other's empires before any economy.
3. Wave 2 — Local economy on top: Credits + Ore, upgrade tree, synergies, internal trade routes with cargo trajectory broadcast.
4. Wave 3 — UI shell with visual polish (postprocessing tuned, troika labels, identity-color borders).
5. Wave 4 — Cross-player trade routes (bilateral, gradient arcs, consent flow) + Tier 2/3 unlocks (Refinery, Foundry, Tech tree).
6. Wave 5 — Galactic map view, leaderboard polish, galactic events.
7. Wave 6 — Tune first 10 minutes, synth audio, build/deploy.

---

## Locked-in tech rules

- **3D** — Three.js (WebGL only, no WebGPU). 100% procedural — NO Blender / external assets / textures. Geometry + shaders + lighting only.
- **Multiplayer** — PartyKit relay (Cloudflare Workers). Single shared galaxy in `'hub-1'` room, 16 players. Three-tier state model (galaxy seed = server, empire snapshots = client-authoritative + clamped, cargo ships = trajectory-broadcast computed locally). Disable WebSocket Hibernation for `hub-1`. See `docs/MULTIPLAYER_ECONOMY.md`.
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **ECS-lite** — every gameplay object is an `Entity` (tags + components + Object3D). Systems run per frame on a `World`. Event bus for cross-module communication.
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`. Do not remove.
- **Public repo, commits land on `main`.** Wave-by-wave commits so judges can follow progress.
- **Instant-load** — no loading screens, no asset downloads. Audio (when added) must be WebAudio synthesized.
- **90 % AI requirement** — gameplay logic is in source, written wave-by-wave by parallel subagents under main-context orchestration.

---

## Module map (current state)

```
src/
├── core/                 ECS-lite (game-agnostic)
│   ├── types.ts          Entity, FrameContext, full EventMap (galaxy/economy/multiplayer/ui events)
│   ├── entity.ts         createEntity, setComponent, getComponent
│   ├── world.ts          spawn/despawn, query, addSystem, on/emit, tick
│   └── index.ts          re-exports
├── net/
│   └── protocol.ts       Three-channel protocol: legacy hello/input + welcome.game payload +
│                         GameEvent (planet/route/ship/galactic) + ping/pong + route flow
├── game/
│   ├── state.ts          GameContext + gameState (now includes serverTimeOffsetMs, galaxySeed,
│   │                     selfPlayerId, selfSectorId) + sharedNow() helper. resizeHook added
│   │                     so EffectComposer follows window resize.
│   ├── initGame.ts       Wave dispatcher; Wave 0 wires EffectComposer (SelectiveBloom + ACES + SMAA)
│   ├── economy/          Pure data + balance (no Three.js imports — server safe-imports)
│   │   ├── types.ts      Resource/Planet/Route/Ship/Upgrade/Building/Empire types + LIMITS + GALAXY
│   │   └── seed.ts       Mulberry32 + Mitchell sector placement + donor-rebalanced 100-planet
│   │                     deterministic generator. All 16 sectors guaranteed a home.
│   └── portal/           Vibe Jam webring entry/exit (gold outbound, cyan return arch)
├── multiplayer/          PartyKit client (room hub-1) + ghost players + party panel +
│                         name prompt + 6-retry connection
├── main.ts               boot Three.js renderer (postprocessing-tuned: antialias off,
│                         NoToneMapping, SRGB) + World + initGame(ctx) + portal + multiplayer
└── vite-env.d.ts         glsl/vert/frag module shims for vite-plugin-glsl

partykit/
└── server.ts             16-player relay. Tier-A galaxy seed in room.storage,
                          Tier-B empire snapshots in DO memory, 256-event ring buffer,
                          Cristian ping/pong, soft-eviction grace 60s, sector assignment.

scripts/
└── test-seed.ts          Determinism + sector-coverage check. `npx tsx scripts/test-seed.ts`.
```

---

## What's wired and stable

- **ECS world** — `World.spawn / despawn / query / addSystem / on / emit / tick`.
- **EventMap** locked at Wave 0 with the full galaxy/economy/multiplayer/ui surface. Add new events here when extending; subagents must not redefine the bus.
- **Postprocessing** — `EffectComposer` with `SelectiveBloomEffect` (mipmap blur, threshold 0.85), ACES Filmic tone mapping, SMAA. Wired via `ctx.renderHook` and `ctx.resizeHook`. Existing gold portal arch already blooms.
- **Multiplayer hub** — connects to `localhost:1999` in dev or `gamejam.example.partykit.dev` in prod (placeholder, see deploy checklist). Renders remote players as translucent capsules + name labels. Local-only "party" tagging via the panel rows.
- **PartyKit shared-galaxy authority** — `welcome` payload now includes both the legacy `snapshot.players` (drives ghosts) AND a `game` payload with `seed`, `serverTimeMs`, `yourSectorId`, `empires[]`, `shipsInFlight[]`, `activeGalacticEvents[]`, `lastEventId`. Galaxy seed is persisted in `room.storage` so it survives server restarts. Sector assignment maps each connecting player to a free sector 0..15.
- **Time sync** — `client → server: { type:'ping', t0 }` returns `{ type:'pong', t0, tServer }`. Client should run 5 pings, take median offset, write to `gameState.serverTimeOffsetMs`. All trajectory math should use `sharedNow()` from `src/game/state.ts`.
- **Vibe Jam portal** — outbound to `vibej.am/portal/2026` and return arch when arriving via `?portal=true&ref=...&username=...&color=...`. Trigger by clicking the label OR walking within 1.8m (proximity needs `gameState.player` to be set).
- **Deterministic galaxy generator** — `generateGalaxy(seed)` returns identical 100-planet layout, sector centers, neutral assignments, names, kinds. Every of 16 sectors has at least one planet flagged `isHomeOfSector`. Server picks the seed once, all clients regenerate locally — no per-frame galaxy bandwidth.

---

## How to run / test

### Solo (no multiplayer)
```bash
npm install
npm run dev   # vite at http://localhost:5173/
```

### With multiplayer
In a SECOND terminal:
```bash
npx partykit dev   # relay at localhost:1999
```
Reload the page. The party panel (top-left) should show **Online**.

---

## Build commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on localhost:5173 |
| `npm run build` | Strict tsc + vite production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run party:dev` | PartyKit relay on localhost:1999 |
| `npm run party:deploy` | Deploy relay to Cloudflare |
| `npx tsc --noEmit` | Type-check only |

Always run `npx tsc --noEmit && npm run build` before committing.

---

## Deploy checklist

1. `! vercel login` (user runs interactively).
2. `! npx partykit login`.
3. Update `partykit.json` `name` if desired.
4. Replace prod host placeholder in `src/multiplayer/connection.ts` (`PROD_HOST_FALLBACK`).
5. `npx partykit deploy` → note the returned `*.partykit.dev` host.
6. `vercel deploy --prod` for the static site.
7. Submit URL to Vibe Jam 2026 form.
8. Verify the mandatory `vibej.am/2026/widget.js` is loading on prod.

---

## Workflow notes

- **Wave-based parallel subagent dispatch** has worked well in the past: each wave spawns 2-5 focused agents writing into their own folders. Integration is light when contracts (init signatures, EventMap, GameContext) are locked in Wave 0.
- **Cross-module communication is via the event bus** (EventMap in `src/core/types.ts`). Add new events there when extending.
- **TypeScript is strict** — `verbatimModuleSyntax` requires `import type` everywhere; `erasableSyntaxOnly` rules out `enum` / `namespace`.
- Commit per wave with a detailed body — judges browse the GitHub history.
- **Subagents must write only inside their assigned folder.** Cross-folder edits get integrated by the main context.
