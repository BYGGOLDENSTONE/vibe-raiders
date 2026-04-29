# Vibe Raiders — Project State

> **Submission:** Cursor Vibe Jam 2026. Deadline **2026-05-01 13:37 UTC**. Today: **2026-04-29**.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (public)
> **One-liner:** Browser extraction shooter inspired by Arc Raiders — procedural ruined city, push-your-luck loot loop, multiplayer rooms.

This file is the source of truth for resuming the session. Read it first.

---

## Current phase

**P1 — World & integration.** Bootstrap is done. We are filling in the world (city, portals) and the netcode skeleton in parallel via subagents.

## What is done

- [x] GitHub repo + remote
- [x] Vite + TypeScript + Three.js scaffold
- [x] Modular layout: `src/{core,world,entities,systems,net,ui,audio}`
- [x] **ECS-lite core** (`src/core/`): Entity, World, components, tags, typed event bus
- [x] **Scene** (`src/world/scene.ts`): renderer, camera, sun, hemi, fog, sky shader (returns uniforms for atmosphere mutation)
- [x] **Atmosphere cycle** (`src/world/atmosphere.ts`): 4 phases (Golden Hour → Dust Storm → Ashen Haze → Blood Veil) lerping over 5 min loop. All uniforms/lights/fog/exposure tween smoothly.
- [x] **FPS controller** (`src/systems/fps-controller.ts`): pointer lock, WASD, sprint, crouch toggle, jump, gravity, world bounds. No AABB collision yet.
- [x] **Player entity** (`src/entities/player.ts`): factory with transform/health/weapon/backpack/player components.
- [x] **Debug panel** (`src/ui/debug.ts`): toggleable with backquote, plugin sections + key bindings, stub in prod via `import.meta.env.DEV`. Built-in sections: PERF, ATMOSPHERE, PLAYER. Atmosphere keys: B/P/[/]/R.
- [x] `index.html`: mandatory Vibe Jam widget script, OG meta, mobile gate, boot screen.
- [x] Docs: `CLAUDE.md` (this), `ARCHITECTURE.md`, `README.md`.

## What is in progress (subagents)

- [ ] **City Builder** — `src/world/{rng,palette,city,colliders}.ts`. Seeded RNG, ruined city generator (~250×250m), AABB colliders, 4 shelter positions, central landmark, fires, dust particles.
- [ ] **Portal Integrator** — `src/world/portals.ts`. ESM port of `vibej.am/2026/portal/sample.js`. Lobby green exit + red arrival portals.
- [ ] **PartyKit Server Skeleton** — `partykit/server.ts` + `src/net/{protocol,client}.ts`. Room with player/bot state, 10Hz broadcast, message types. Not yet hooked into the game loop.

## What is next (after subagents return)

In rough order:
1. Integrate city into main loop, replace test boxes
2. Wire AABB colliders into FPS controller
3. Combat: weapon firing, hitscan raycasts, muzzle flash, reload, ammo crates as pickups
4. Loot system: spawn loot in city, pickup interaction, backpack weight enforcement, drop
5. Bot AI: drone (hover + shoot), sentry (ground patrol), hunter boss (center)
6. Shelters: rotating extraction window (3-min cycle), 5-second hold, score banking
7. Lobby + matchmaking UI: name, mode (PvE/PvP), squad code, deploy
8. Multiplayer wire-up: client connects to PartyKit, position sync, remote players, networked bots/loot
9. HUD: ammo, hp, backpack weight, score, extraction timer, announcements
10. Audio: ambient, gunshot, hit, pickup, extraction siren, announce voice
11. Polish: muzzle flash, hit sparks, kill confirms, particle trails, ui flourishes
12. Deploy: Vercel (frontend) + PartyKit (server). Pre-flight: confirm widget present, instant load, no console errors.
13. Submit.

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
