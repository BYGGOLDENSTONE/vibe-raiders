# Vibe Raiders — Project State

> **Submission:** Cursor Vibe Jam 2026. Deadline **2026-05-01 13:37 UTC**. Today: **2026-04-29**.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (public)
> **One-liner:** Browser extraction shooter inspired by Arc Raiders — procedural ruined city, push-your-luck loot loop, multiplayer rooms.

This file is the source of truth for resuming the session. Read it first.

---

## Current phase

**P2 — Gameplay systems.** World skeleton is in. Next: combat, AI, loot, shelters, lobby.

## What is done

- [x] GitHub repo + remote
- [x] Vite + TypeScript + Three.js scaffold
- [x] Modular layout: `src/{core,world,entities,systems,net,ui,audio}`
- [x] **ECS-lite core** (`src/core/`): Entity, World, components, tags, typed event bus
- [x] **Scene** (`src/world/scene.ts`): renderer, camera, sun, hemi, fog, sky shader (returns uniforms for atmosphere mutation)
- [x] **Atmosphere cycle** (`src/world/atmosphere.ts`): 4 phases (Golden Hour → Dust Storm → Ashen Haze → Blood Veil) lerping over 5 min loop.
- [x] **Procedural city** (`src/world/{rng,palette,colliders,city}.ts`): seeded mulberry32 RNG, mid-tone palette, AABB collider list with `pushOutXZ` + `raycastColliders`, 250×250m ruined city via merged geometries (~17 draw calls), 480 instanced rubble pieces, 4 corner shelters, tilted-truss central landmark, 7 flickering fires, dust particles. `update(t)` drives flicker.
- [x] **Vibe Jam portals** (`src/world/portals.ts`): ESM port of `vibej.am` sample. `createVibeJamPortals` returns `{ update, arrivedViaPortal, arrivalParams, dispose }`. NOT yet placed in the world (will land with the lobby).
- [x] **PartyKit server skeleton** (`partykit/server.ts`, `src/net/{protocol,client}.ts`): room caps 12, 10Hz state broadcast, `setInterval` shelter rotation. `package.json` scripts: `party:dev`, `party:deploy`. NOT yet hooked into the game loop. `npx partykit dev` boots locally on `:1999`.
- [x] **FPS controller** (`src/systems/fps-controller.ts`): pointer lock, WASD, sprint, crouch toggle, jump, gravity, world bounds, **AABB collision via `pushOutXZ`** (radius 0.45m, height-aware vertical overlap test). `setColliders(c)` to swap at runtime.
- [x] **Player entity** (`src/entities/player.ts`): factory with transform/health/weapon/backpack/player components.
- [x] **Debug panel** (`src/ui/debug.ts`): toggleable with backquote, plugin sections + key bindings, stub in prod via `import.meta.env.DEV`. Built-in sections: PERF, ATMOSPHERE, PLAYER, WORLD (city seed/colliders/landmark). Atmosphere keys: B/P/[/]/R. World keys: T (tp to next shelter).
- [x] **main.ts** wires: scene + atmosphere + city + FPS + colliders + debug. Player spawns at random shelter. City update closure runs each frame for fire flicker + dust drift.
- [x] `index.html`: mandatory Vibe Jam widget script, OG meta, mobile gate, boot screen.
- [x] Docs: `CLAUDE.md`, `ARCHITECTURE.md`, `README.md`.
- [x] Production build verified: 141KB gzip total. No loading screen.

## What is next

In rough order:
1. **Combat** (`src/systems/combat.ts`): weapon firing, hitscan via `raycastColliders`, muzzle flash sprite, reload timer, ammo accounting. Listens for `shoot` events.
2. **Bot AI** (`src/systems/ai.ts` + `src/entities/bot.ts`): drone (hover + shoot), sentry (ground patrol), hunter boss (center). Simple state machines: idle → patrol → chase → attack → dead.
3. **Loot** (`src/systems/loot.ts` + `src/entities/loot.ts`): spawn loot in city (seeded), pickup interaction (E key), backpack weight enforcement, drop (G key). Medkits + ammo crates as special loot.
4. **Shelters / extraction** (`src/systems/extraction.ts` + `src/entities/shelter.ts`): rotating window (180s cycle, 60s open), 5s hold, score banking. `announce` events for "Shelter Bravo opening — 180s".
5. **Lobby + portals integration** (`src/ui/lobby.ts`): name input, mode select (PvE/PvP), squad code, deploy button. Place vibej.am portals here. Show leaderboard preview.
6. **HUD** (`src/ui/hud.ts`): ammo, hp, backpack weight, score, extraction timer, announcement banner, crosshair, kill feed.
7. **Multiplayer wire-up**: client connects to PartyKit, sends inputs at 20Hz, receives state at 10Hz, spawns/updates remote players, bots authoritative on server.
8. **Audio** (`src/audio/synth.ts`): procedural Web Audio (gunshot, hit, pickup, extraction siren, announce), small ambient sample.
9. **Polish**: muzzle flash, hit sparks, kill confirm, particle trails, ui flourishes, intro animation.
10. **Deploy**: Vercel (frontend) + PartyKit (server). Pre-flight: widget present, instant load, no console errors.
11. **Submit** to vibej.am/2026.

## Game design (locked unless explicitly changed)

- **Loop:** spawn at random shelter → loot + fight → next shelter opens every 3 min for 60s → reach + 5s hold = extract → score banks. Die = run gone, banked safe.
- **Modes:** PvE-EZ (bots only) and PvP-HOT (bots + players). Solo or 3-person squads via 6-digit room code. Up to 12 per room. Empty rooms allowed.
- **Map:** ~250×250m procedural ruined city. 4 shelters at NW/NE/SW/SE. Boss landmark in center. Golden-hour palette baseline; atmosphere cycles through 4 moods.
- **Combat:** 1 weapon (laser rifle), hitscan, mag 20 / reserve 40 start. Ammo crates as loot.
- **Backpack:** 20 kg. Common 1kg/+1pt · Uncommon 2kg/+5 · Rare 4kg/+20 · Legendary 8kg/+100. Medkit 3kg, ammo crate 2kg.
- **Bots:** drone (+5), sentry (+5), hunter boss (+50). Player kill +30 in PvP.
- **Extract bonus:** +50 % of run loot value.
- **Portals:** lobby has exit (green) + arrival (red, only if `?portal=true` was passed).

## Tech stack (locked)

- Render: Three.js
- Bundler: Vite + TS (strict, verbatimModuleSyntax)
- Multiplayer: PartyKit (Cloudflare Workers)
- Hosting: Vercel (`vibe-raiders.vercel.app`)
- Net model: client-authoritative + server-relay (jam-acceptable)

## Workflow rules

- Component + tag (ECS-lite). Every gameplay object goes through `World`.
- Systems never import other systems — talk through `World.emit/on`.
- Modules own a folder; new code goes in the right folder.
- Subagents for independent modules; main context for glue/integration.
- Public repo. Commits land directly on `main` (no PRs for jam).
- Mandatory `<script async src="https://vibej.am/2026/widget.js"></script>` already present.
- Production build must be instant-load (no loading screen, no heavy assets).
- No commits without user approval (per global CLAUDE.md). User has pre-approved the commit-and-push cadence for this jam workflow but each commit is still confirmed before sending.

## Known TODOs / risks

- Vercel + PartyKit accounts not yet created. User will run `! vercel login` and `! npx partykit login` when we reach deploy step.
- 90 % AI requirement: keep all gameplay logic in source (no copy-paste from Stack Overflow). Document in README.
- Submission widget verified present in `index.html`. Re-verify before final deploy.
- Portal sample uses global `THREE` — we are writing our own ESM port.

## Hot keys (current build)

| Key | Action |
|---|---|
| Click | Pointer lock |
| WASD | Move |
| Shift | Sprint |
| C | Crouch toggle |
| Space | Jump |
| ESC | Release pointer |
| ` (backquote) | Toggle debug panel |
| B | Atmosphere — next phase |
| P | Atmosphere — pause |
| [ / ] | Atmosphere — slow / fast |
| R | Atmosphere — reset |
| T | World — teleport to next shelter |
