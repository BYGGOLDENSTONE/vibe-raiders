# Vibe Raiders — Project State

> **Submission:** Cursor Vibe Jam 2026. Deadline **2026-05-01 13:37 UTC**. Today: **2026-04-29**.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (public)
> **One-liner:** Browser extraction shooter inspired by Arc Raiders — multi-biome procedural world, push-your-luck loot loop, atmosphere-as-mechanic, grappling hook, hack-and-flip robots.

This file is the source of truth for resuming the session. **Read it first.** Then read `ARCHITECTURE.md` for module boundaries before touching code.

---

## How to resume in a new session

1. Read this file end-to-end.
2. Read `ARCHITECTURE.md`.
3. Glance at `git log --oneline -20` to see the recent commit trail.
4. The dev server may be stopped — start it with `npm run dev`.
5. Pick up at the **"Next session priority list"** below.

---

## Current phase

**P3 — Polish world + start mechanics.** Massive 5-biome world is live. Core gameplay (combat, AI, loot, extraction, lobby, multiplayer) still to build.

## Game design — decisions locked

### Core loop (unchanged)
Spawn at random shelter → loot the world + fight bots → next shelter window opens every 3 min for 60s → reach + 5s hold = extract → score banks. Die = run inventory gone, banked safe.

### Modes (unchanged)
PvE-EZ (bots only) and PvP-HOT (bots + players). Solo or 3-person squads via 6-digit room code. Up to 12 per room. Empty rooms allowed.

### **Three locked-in differentiator hooks** (confirmed 2026-04-29 evening)

These are the mechanics that separate us from a generic Arc Raiders demake. The submission story is built around them.

1. **Atmosphere = Mechanic** ⭐ brand hook. The 4 atmosphere phases are gameplay rules, not just visuals:
   - **GOLDEN HOUR** — baseline. (Phase 1)
   - **DUST STORM** — visibility halved (heavy fog), but **all loot value × 1.5**. Bots' aggro range halved. *Risk-reward window for greedy players.*
   - **ASHEN HAZE** — bots become dormant / much less aggressive, BUT **extraction shelters are disabled** (no extracting). *Move freely but you can't bank — pressure to keep looting.*
   - **BLOOD VEIL** — the **Predator Hunter** boss spawns and stalks the player carrying the most loot value. *Apex tension phase.*
   - Each phase change gets a screen-banner announcement ("DUST STORM INCOMING — 10s") and an audio sting. Phase clock runs server-side in PartyKit so all players agree.
   - We may eventually add a 5th **NOON DAYLIGHT** phase per user request — see priority list.

2. **Grappling hook** — universal movement tool, every player has one.
   - Range: 30-40 m. Cooldown: 6-8 s. Bound to **Q** (or right-click).
   - Raycast from camera; if hit, pull player toward hit point at high speed.
   - Visual: thin glowing line from player to anchor, animated.
   - **No fall damage** anywhere in the game (per user, 2026-04-29).
   - Pairs perfectly with our verticality (dam top, mountain plateau, factory catwalk, building rooftops).

3. **Hack-and-flip robots** — combat ritmi kırıcı.
   - Approach a bot whose HP is below 20% (downed but not destroyed) and hold **E**.
   - The bot becomes friendly: follows the player, shoots at hostiles, identifiable by a green outline / glow.
   - Friendly bots fade out after ~30 s OR when killed. Player can have up to 2 friendly bots simultaneously.
   - In PvP, friendly bots can be re-flipped by the enemy.
   - Implementation order: build bot AI first, then add the flip behavior on top.

### Other locked design

- **Map:** 400×400m procedural world, 5 biomes (city / industrial / dam / forest / mountain). 4 shelters one per non-mountain biome. **Map size may be slightly reduced** if grappling hook + sprint don't make travel feel fast enough — defer the call until grapple is in.
- **Combat:** 1 weapon (laser rifle), hitscan, mag 20 / reserve 40 start. Ammo crates as loot.
- **Backpack:** 20 kg capacity. Common 1kg/+1pt · Uncommon 2kg/+5 · Rare 4kg/+20 · Legendary 8kg/+100. Medkit 3kg, ammo crate 2kg.
- **Bots:** drone (+5), sentry (+5), hunter boss (+50). Player kill +30 in PvP.
- **Extract bonus:** +50 % of run loot value at extraction.
- **Vibe Jam portals:** lobby has exit (green) + arrival (red, only if `?portal=true` was passed).

---

## What is done

- [x] GitHub repo + remote
- [x] Vite + TypeScript + Three.js scaffold
- [x] Modular layout: `src/{core,world,entities,systems,net,ui,audio,render}`
- [x] **ECS-lite core** (`src/core/`): Entity, World, components, tags, typed event bus
- [x] **Scene** (`src/world/scene.ts`): renderer, camera, sun (shadow cam ±180m, 2048 mapSize), hemi, fog (40→380m baseline), sky shader (sphere radius 1000m, returns uniforms for atmosphere mutation)
- [x] **Atmosphere cycle** (`src/world/atmosphere.ts`): 4 phases brightened for the bigger world (Golden Hour → Dust Storm → Ashen Haze → Blood Veil), 75s each, 5 min total. All sky/sun/hemi/fog/exposure tween smoothly via smoothstep.
- [x] **Procedural multi-biome world** (`src/world/{rng,palette,colliders,heightmap,map}.ts` + `src/world/biomes/*`):
  - 400×400m heightmap-based world, vertex-colored terrain, `groundHeight(x,z)` sampler
  - **NW Ruined City** — 8×8 grid, 700 instanced rubble, two walkable hero buildings, fallen radio tower + cathedral spire
  - **NE Industrial Complex** — 70×40m walkable hangar with catwalk, container rows, 45m leaning smokestack, fuel tanks, crane
  - **SW Dried Dam** — 25m dam wall arc with walkable bridge top, dry valley at -15m, walkable pump house
  - **SE Burnt Forest** — 100 charred trees, fallen logs, walkable ranger cabin
  - **E Mountain Ridge** — 150 rock blocks, terraced plateaus to +25m, observatory landmark with red beacon, distant silhouettes
  - 4 shelters (one per non-mountain biome), 5 hero landmarks
- [x] **Vibe Jam portals** (`src/world/portals.ts`): ESM port. `createVibeJamPortals` returns `{ update, arrivedViaPortal, arrivalParams, dispose }`. **NOT yet placed in the world** — will land with the lobby.
- [x] **PartyKit server skeleton** (`partykit/server.ts`, `src/net/{protocol,client}.ts`): room caps 12, 10Hz state broadcast, `setInterval` shelter rotation. **NOT yet hooked into the game loop.** `npx partykit dev` boots locally on `:1999`.
- [x] **FPS controller** (`src/systems/fps-controller.ts`): pointer lock, WASD, sprint, crouch toggle, jump, gravity, world bounds, AABB collision via `pushOutXZ` (radius 0.45m), heightmap ground sampling via `getGroundHeight` option.
- [x] **Player entity** (`src/entities/player.ts`): factory with transform/health/weapon/backpack/player components.
- [x] **Debug panel** (`src/ui/debug.ts`): backquote toggle, plugin sections + key bindings, prod-stub via `import.meta.env.DEV`. Built-in sections: PERF, ATMOSPHERE, PLAYER, WORLD. Keys: B/P/[/]/R atmosphere, T shelter teleport, N post-fx toggle.
- [x] **Post-processing** (`src/render/post.ts`): EffectComposer + UnrealBloomPass + custom ShaderPass (vignette + soft chromatic aberration). Grain disabled by default (was eye-straining). Defaults: bloom 0.55/0.55/0.85, vignette 1.10, chromatic 0.0012.
- [x] **main.ts** wires: scene + atmosphere + multi-biome world + FPS + colliders + debug + post-processing. Player spawns at random shelter (height sampled from heightmap).
- [x] Production build: 154 KB gzipped, instant load, no console errors.
- [x] `index.html`: mandatory Vibe Jam widget script in place.

---

## Next session priority list

These came from the user on 2026-04-29 evening, ordered by their urgency.

### P0 — bug fix
1. **Walkable interiors are not actually enterable.** The user reports "interior mekanlara giremiyorum". The two city hero buildings, factory hangar, pump house, and ranger cabin should be walkable, but the AABB colliders likely cover the full building footprint and block doorways. **Fix:** in each biome's interior generator, replace single-AABB colliders with per-wall AABBs, leaving the doorway as a gap. Verify by walking into each interior.
   - Affected files: `src/world/biomes/{city,industrial,dam,forest}.ts`. Check how each builds its interior collider.

### P1 — world & atmosphere finishing touches
2. **Map borders.** Surround the 400×400m playable area with **giant impassable walls and mountain ranges** so players can't walk off. Current world bounds are enforced by an FPS-controller clamp at ±200m, but visually there's nothing there. Want big mountain silhouettes, a perimeter cliff, or a high industrial wall — something diegetic that says "you cannot go beyond here." This goes in `src/world/map.ts` (after biomes are built) or as a new `src/world/biomes/perimeter.ts`.
3. **Add a NOON DAYLIGHT atmosphere phase.** User explicitly requested: "gündüz de yap bakalım gündüz ışığında nasıl olacak". Add a 5th phase to `PHASES` in `src/world/atmosphere.ts` — bright cool blue/cyan sky, white-yellow sun at high noon (intensity ~2.5), exposure ~1.5, low fog (fog far 350+), maybe slightly muted bloom-ready emissives. Position it after Golden Hour or as the first phase. Update debug help text.
4. **Minimap UI** (`src/ui/minimap.ts`). Top-right corner. Shows: player position (centered or marker), 4 shelters as icons, hero landmarks as different icons, currently-open shelter pulsing. Eventually shows player squad-mates and ping events ("legendary loot dropped here", "boss spawned here"). Top-down 2D, 200×200px, semi-transparent panel. Subscribe to `World` events for pings.
5. **Map size reduction (DEFER).** User said "maybe slightly reduce" but only if travel still feels slow after grapple. Hold this until after P2.

### P2 — first mechanic hook (movement)
6. **Grappling hook** (`src/systems/grapple.ts`). Q to fire, raycast forward via `raycastColliders` (max 35m). On hit: lock target, override player velocity to pull toward hit point at ~25 m/s. On arrival (within 1.5m) or release: stop. 7s cooldown. Visual: glowing line from camera position to hit point during pull. **No fall damage** — already not implemented, just keep it that way. Add a `grappling` tag to the player while active so other systems can react. Bind cooldown indicator into the HUD later.

### P3 — gameplay systems (the actual game)
7. **Combat** (`src/systems/combat.ts`). Left-click fires; hitscan via `raycastColliders` + bot collider list (TBD). Muzzle flash sprite. Reload (R key) consumes from reserve. `world.emit('shoot', ...)` and `world.emit('hit', ...)` for sounds and netcode hooks.
8. **Bot AI** (`src/entities/bot.ts` + `src/systems/ai.ts`). Three kinds: drone (hover + lazy strafe + shoot), sentry (ground patrol + chase + shoot), hunter (boss, slow but tanky, only spawns during Blood Veil per the atmosphere=mechanic system). State machines: idle → patrol → chase → attack → wounded(downed-and-flippable) → dead.
9. **Hack-and-flip robots** (`src/systems/flip.ts`). When a bot hits the wounded state (HP < 20%, alive), the player can hold E within 3m to flip it. Friendly bots get a green emissive outline, follow the player, shoot at hostile bots (and PvP enemies in PvP mode).
10. **Loot** (`src/entities/loot.ts` + `src/systems/loot.ts`). Spawn loot in city / industrial / dam / forest biomes (seeded). E to pick up. Backpack weight enforced. G to drop. Medkit (F to use, full heal) + ammo crate as special loot.
11. **Shelters / extraction** (`src/systems/extraction.ts` + `src/entities/shelter.ts`). Rotating window: every 180s, one of the 4 shelters opens for 60s. 5s hold to extract — banks score and sends player back to lobby. Apply atmosphere=mechanic rule: during ASHEN HAZE, all shelters are closed. Announce events for "Shelter Bravo opening — 180s".

### P4 — polish & ship
12. **Atmosphere=mechanic wiring** (`src/systems/atmosphere-rules.ts`). Listen for phase changes; emit announcements, mutate bot aggro globals, gate extractions, spawn the Hunter during Blood Veil. This is what ties the brand hook together.
13. **Lobby + portals integration** (`src/ui/lobby.ts`). Name input, mode select (PvE/PvP), 6-digit squad code, deploy button. Place vibej.am portals here (use `createVibeJamPortals`). Show leaderboard preview. Read URL `?portal=true` to draw return portal.
14. **HUD** (`src/ui/hud.ts`). Ammo, hp, backpack weight, score, run timer, current atmosphere phase indicator, extraction window banner, kill feed, crosshair, grapple cooldown.
15. **Multiplayer wire-up.** Client connects to PartyKit, sends inputs at 20Hz, receives state at 10Hz, spawns/updates remote players. Bots authoritative on the server (already designed in protocol).
16. **Audio** (`src/audio/synth.ts`). Procedural Web Audio (gunshot, hit, pickup, extraction siren, phase announce sting). One small ambient sample.
17. **Polish.** Muzzle flash, hit sparks, kill confirm pop, particle trails on grapple line, intro animation, hot-loot ping (if time).
18. **Deploy.** Vercel (frontend) + PartyKit (server). Pre-flight: widget present, instant load, no console errors. Custom subdomain `vibe-raiders.vercel.app`.
19. **Submit** to vibej.am/2026.

---

## Tech stack (locked)

- Render: Three.js (with `three/examples/jsm` postprocessing + BufferGeometryUtils)
- Bundler: Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnusedLocals/Parameters`)
- Multiplayer: PartyKit (Cloudflare Workers) — package installed, `npx partykit dev` works
- Hosting: Vercel (`vibe-raiders.vercel.app`) — account NOT yet created
- Net model: client-authoritative + server-relay (jam-acceptable)

## Workflow rules

- **Component + tag (ECS-lite).** Every gameplay object goes through `World`.
- **Systems never import other systems** — talk through `World.emit/on`.
- **Modules own a folder.** New code goes in the right folder.
- **Subagents for independent modules.** Main context for glue/integration. Used so far: city builder, portal integrator, partykit skeleton, full multi-biome world rebuild.
- **Public repo.** Commits land directly on `main` (no PRs for jam).
- **Mandatory** `<script async src="https://vibej.am/2026/widget.js"></script>` already in `index.html`.
- **Production build must be instant-load.** No loading screen, no heavy assets. Currently 154 KB gzip.
- **No commits without user approval** (per global CLAUDE.md). User has pre-approved the commit-and-push cadence for this jam, but each commit is still mentioned before sending.

## Known TODOs / risks

- **Vercel account not yet created** — user will run `! vercel login` when we reach deploy.
- **PartyKit account not yet created** — user will run `! npx partykit login` when we deploy the server.
- **90 % AI requirement** — keep all gameplay logic in source; document workflow in README.
- **Submission widget verified present** in `index.html`. Re-verify before final deploy.
- **The `npx partykit dev` boot is verified once.** Server has not been re-tested since the world subagent ran.
- **Walkable interiors are reportedly not enterable** — confirmed P0 fix above.
- **Atmosphere fog far** in `scene.ts` is 380 baseline; phases override. If we add the NOON DAYLIGHT phase, ensure its fog far ≥ 350.

## Atmosphere polish backlog (apply at the very end if time allows)

- Volumetric god rays through buildings
- Heat shimmer near fires
- Distant bird/crow silhouettes flying by
- Falling ash / leaf particles
- Phase transition flash banner ("DUST STORM INCOMING") with siren sting
- Smoke trails from fires
- Faux ambient occlusion gradient on building corners
- Stronger contrast pass during BLOOD VEIL

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
| N | Render — toggle post-fx |

## Recent commits (most recent first, see `git log` for full)

- `feat: 5-biome 400m world + heightmap terrain + post-processing`
- `feat: procedural ruined city, vibe jam portals, partykit skeleton`
- `feat: 4-phase atmosphere cycle + modular debug panel`
- `chore: bootstrap project — Vite + Three.js + ECS-lite core`
