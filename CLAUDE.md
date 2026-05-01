# The Vibecoder's Guide to the Galaxy

> **Game title:** The Vibecoder's Guide to the Galaxy
> **Submission:** Cursor Vibe Jam 2026
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders
> **Live:** https://vibecoders-guide-to-the-galaxy.byggoldenstone.partykit.dev
> **Status:** Game complete. Only minor additions / polish from here on.

---

## What it is

**Incremental space empire — multiplayer.** A procedural 100-galaxy universe (~20,000 star systems) built on a 3-layer scene (Universe → Galaxy → System → Planet). Sits on top is a resource economy with a ~150-node skill tree, fully automated planet/system annexation, wormhole and intergalactic bridge claims, and a Trade Hub. Up to 64 players share one PartyKit room with a server-authoritative ownership map and a 30-min round-reset cycle so cohorts can rotate.

Full simulation/visual reference: **`docs/GALAXY.md`**. Balance audit: **`docs/balance.csv`**.

---

## Locked tech rules

- **3D** — Three.js (WebGL only). 100% procedural — NO Blender / external assets / textures. Geometry + GLSL shaders + lighting only.
- **Multiplayer** — PartyKit relay (Cloudflare Workers). Single shared room, ≤64 players. Server is authoritative for ownership; round resets every 30 min on UTC :00 / :30.
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`. Do not remove.
- **Public repo, commits land on `main`.**
- **Instant-load** — no loading screens, no asset downloads. Only exception: `public/music/conquerer.mp3` (background music, streamed). All SFX are WebAudio-synthesised.
- **90% AI** — gameplay logic written by Claude under user direction.
- **Language** — all docs, code comments, commit messages, and runtime UI strings are English.

---

## Project tree

```
gamejam/
├── CLAUDE.md
├── partykit.json                   PartyKit config (serves dist/ + relay from one domain)
├── partykit/
│   └── server.ts                   relay — slot allocation, ownership broadcast, trade matchmaking, idle sweep
├── docs/
│   ├── GALAXY.md                   galaxy/system/planet simulation reference
│   └── balance.csv                 economy balance audit
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.production                 VITE_PARTYKIT_HOST for production build
├── public/
│   ├── favicon.svg
│   └── music/conquerer.mp3
├── src/
│   ├── main.ts                     boot — incoming portal? saved session? start screen?
│   ├── start-screen.ts             Solo / Multiplayer chooser + profile picker
│   ├── portal.ts                   Vibe Jam webring in/out + return-portal pill
│   ├── style.css
│   ├── galaxy/
│   │   ├── app.ts                  orchestrator + render loop (empire tick + MP wiring + universe nav)
│   │   ├── camera-controller.ts
│   │   ├── types.ts                LayerKind / GalaxyData / UniverseData / GalaxyPalette
│   │   ├── rng.ts
│   │   ├── generation.ts           generateUniverse — main galaxy + 99 procedurals on Fibonacci shell
│   │   ├── shaders.ts
│   │   ├── starfield.ts            skydome
│   │   ├── blackhole.ts            per-galaxy black hole (radius-scaled)
│   │   ├── star.ts / planet.ts / system.ts
│   │   ├── galaxy.ts               UniverseHandle, per-galaxy systemsGroup, LOD via setActiveGalaxy
│   │   ├── bulge.ts                horizontal bulge billboard, fades by camera distance
│   │   ├── labels.ts               lazy per-galaxy label rebuild, home/owner markers
│   │   ├── picking.ts              raycast → galaxy / system / planet / moon / portal kinds
│   │   ├── wormhole.ts             vortex shader at connected systems
│   │   ├── map-overlay.ts          Wave-11 fullscreen 2D map (Universe / Galaxy / System tabs)
│   │   └── ui.ts                   breadcrumb / layer switcher / detail panel / annex banners
│   ├── empire/
│   │   ├── types.ts                ResourceKey, EmpireState, UpgradeNode, GameMode, storage keys
│   │   ├── upgrades.ts             ~150-node skill tree catalogue
│   │   ├── empire.ts               state, tick, save/load, bootstrap, annex / wormhole / intergalactic / trade
│   │   ├── hud.ts                  resource chips + Upgrades launcher + Trade button + drone summary
│   │   ├── panel.ts                Branch Browser modal — chain rail + tier-card detail pane
│   │   ├── vfx.ts                  buy effects: drain particles, burst, UNLOCKED text
│   │   ├── surface.ts              factory towers + drone swarm on home planet
│   │   └── moon-outpost.ts         dome on chosen moon + tether + shuttles
│   ├── multiplayer/
│   │   ├── protocol.ts             wire types shared with partykit/server.ts
│   │   ├── client.ts               partysocket wrapper — connection state, queueing, players cache
│   │   ├── profile.ts              SessionConfig + 8-colour palette + auto-name
│   │   └── leaderboard.ts          remote players chip list
│   └── audio/
│       ├── audio.ts                AudioManager — context, gain buses, settings persist
│       ├── sfx.ts                  procedural WebAudio SFX
│       ├── music.ts                MP3 streamed through music bus
│       └── settings-modal.ts       gear button + Master / Music / SFX sliders
└── node_modules/
```

---

## Build commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on localhost:5173 |
| `npm run build` | Strict tsc + vite production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run party:dev` | PartyKit relay on `localhost:1999`. Run alongside `npm run dev` for full MP. |
| `npm run party:deploy` | Deploy relay + `dist/` to PartyKit (production) |
| `npx tsc --noEmit` | Type-check only |

---

## Storage keys

| Key | Purpose |
|---|---|
| `vibecoder.empire.v10` | Solo empire state |
| `vibecoder.empire.mp.v5` | Multiplayer empire state (separate slot) |
| `vibecoder.mp.session.v1` | Mode + profile + optional `portalRef`. Cleared by "↻ change profile" link. |
| `vibecoder.mp.playerId.v1` | Stable per-browser identity for the relay (refresh keeps the same spawn) |
| `vibecoder.audio.v1` | Master / Music / SFX volume + mute flags |

---

## Key tunables

Live constants the player will feel:

- **Per-planet income** — `PLANET_INCOME` table in `src/empire/types.ts`. Ocean → metal+water, rocky → crystal+metal, etc.
- **Synergy** — `SYNERGY_PER_PLANET = 0.2` (each owned planet adds +20% global, compound).
- **System tier** — `SYSTEM_TIER_BASE = 100`. Home T1 ×1, wormhole-claimed T2 ×100, intergalactic T3 ×10K.
- **Moon outpost** — `MOON_OUTPOST_INCOME = 5/s crystal`, scaled by system tier.
- **Storage** — `BASE_STORAGE_CAP = 1500`.
- **Upgrade tiers** — `PROD_MUL_PER_TIER` and milestone `expSteps` in `src/empire/upgrades.ts`.
- **Auto-expand drones** (W13, `src/empire/empire.ts`) — base interval `AUTO_CLAIM_BASE_INTERVAL_S = 1.0` s, halved per `Auto-Annex Drones` tier (×8 at full upgrade). Server-authoritative claim handshake: client sends `claim-request`, relay first-come-first-served allocates ownership.
- **Home gezegen claim** — `SYSTEM_PLANET_CLAIM_BASE = {metal:5000, water:3000, crystal:2000}`, `SYSTEM_PLANET_CLAIM_GROWTH = 1.6`.
- **T2 anchor** (W13 repeatable) — `WORMHOLE_CLAIM_BASE = {metal:600K, water:300K, crystal:100K}`, `WORMHOLE_CLAIM_GROWTH = 1.4` per claim. Anchor sets tier; planets fill via `T2_PLANET_CLAIM_BASE = {metal:50K, water:30K, crystal:20K}` × 1.6ⁿ.
- **T3 anchor** (W13 repeatable) — `INTERGALACTIC_CLAIM_BASE = {metal:60M, water:30M, crystal:10M}`, `INTERGALACTIC_CLAIM_GROWTH = 1.6` per claim. Planets fill via `T3_PLANET_CLAIM_BASE = {metal:5M, water:3M, crystal:2M}` × 1.6ⁿ.
- **Round cycle** — `partykit/server.ts`, `ROUND_PERIOD_MS = 30 * 60 * 1000`. Wipes ownership map every UTC :00 / :30. Players keep resources + upgrades, lose territory.
- **Trade Hub** — 20% give of most-abundant → 50% return on least-abundant (2:1). 60 s client cooldown / 30 s server (`TRADE_COOLDOWN_MS` in `partykit/server.ts`).
- **Player cap** — `MAX_PLAYERS = 64` in `partykit/server.ts` (W13).
- **Moon outpost visuals** — `DOME_DIAMETER_FRAC`, `TETHER_RADIUS_FRAC`, `SHUTTLE_COUNT`, `SHUTTLE_BASE_SPEED` in `src/empire/moon-outpost.ts`.
- **Universe** — main galaxy (Milky Way) at origin + 99 procedural galaxies on Fibonacci shell 250k–900k. Per-galaxy radius 7k–22k. Camera far plane 2M; universe view 1.2M. Bulge fade band ~0.4×–4× radius (`src/galaxy/bulge.ts`).

---

## Workflow notes

- User is non-technical — explain WHAT and WHY, not code internals.
- Plan before implementing; wait for user confirmation before each phase.
- Commit only when user explicitly approves; commit AND push together.
- Update this file if structure, tunables, or storage keys meaningfully change.
