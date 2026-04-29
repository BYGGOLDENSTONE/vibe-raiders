# DUSK — gothic action RPG (Vibe Jam 2026)

> **Submission target:** Cursor Vibe Jam 2026 · deadline **2026-05-01 13:37 UTC** · today **2026-04-29**.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (still named after the previous prototype — rename to `dusk` when convenient).
> **Genre:** Diablo IV-style 3D action RPG. Click-to-move, hub + open world + dungeon, multiplayer hub, procgen loot.

---

## Locked-in tech rules

- **3D** — Three.js (WebGL only, no WebGPU). 100% procedural — NO Blender / external assets / textures. Geometry + shaders + lighting only.
- **Multiplayer** — PartyKit relay (Cloudflare Workers). Client-authoritative position broadcast at 10 Hz. Hub = `'hub-1'` room.
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **ECS-lite** — every gameplay object is an `Entity` (tags + components + Object3D). Systems run per frame on a `World`. Event bus for cross-module communication.
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`. Do not remove.
- **Public repo, commits land on `main`.** Wave-by-wave commits so judges can follow progress.
- **Instant-load** — no loading screens, no asset downloads. Audio is WebAudio synthesized.
- **90 % AI requirement** — gameplay logic is in source, written wave-by-wave by parallel subagents under main-context orchestration.

---

## Game design (locked)

**One-liner:** browser-native Diablo IV clone — gothic graveyard open world + procgen dungeon + 2-phase boss, with synced multiplayer hub.

**Core loop:**
1. Spawn in gothic graveyard open world (220 m radius). 40 mobs roam (5 archetypes).
2. Click-to-move, hold-LMB to keep walking. Basic attack auto-fires when stopped near an enemy.
3. Hotbar skills: 1 / 2 / 3 / Q (ult) / SHIFT (dash). Player class (Rogue / Barbarian / Sorcerer) determines kit.
4. Kill mobs → XP + procgen loot drops (rarity-tinted). Walk into drops to pick up.
5. Press `I` to toggle inventory: 4 equipment slots + 6×4 grid + click-to-equip + compare-tooltip + right-click-to-drop.
6. Walk to **ABYSSAL CRYPT** portal → enter procgen dungeon (5 rooms + boss).
7. Final room: **Gravelord Morthen**, 2-phase boss with telegraphed AoEs. Drops legendary, opens **EXIT** portal.
8. Hub multiplayer: see other jam visitors as ghost capsules, click them to add to your local "party" view.
9. **VIBE JAM** webring portal exits to vibej.am/portal/2026 (other jam games).

**Differentiators (locked layer for jam):** none yet — Diablo-faithful clone is the baseline. "Living Loot" / class-fusion / etc. were considered as Wave 5 but not implemented.

---

## Module map

```
src/
├── core/                ECS-lite (game-agnostic)
│   ├── types.ts         Entity, FrameContext, EventMap (all game events live here)
│   ├── entity.ts        createEntity, setComponent, getComponent
│   ├── world.ts         spawn/despawn, query, addSystem, on/emit, tick
│   └── components.ts    Health, Resource, Faction, Combatant, Player, AIBrain,
│                        MoveTarget, SkillUser, Inventory, Equipment, ItemInstance,
│                        ItemAffix, ProjectileComponent, StatusEffects + C registry
├── net/
│   └── protocol.ts      ClientMessage / ServerMessage (hello + input + welcome + state)
├── game/
│   ├── state.ts         GameContext + gameState (player ref, currentZone, timeScale, renderHook)
│   ├── constants.ts     COLORS, TUNING, CAMERA — single source of magic numbers
│   ├── world/           procgen gothic biome (terrain + tombs/walls/trees/pillars/mausoleums
│   │                    + paths + 8 flickering torches + 1500 embers + starfield + moon)
│   ├── player/          player capsule + full component stack + click-to-move locomotion
│   ├── camera/          D4-angled iso, smooth follow
│   ├── input/           click-to-move (LMB hold) + hotbar (1/2/3/Q + SHIFT) → emits player:skillCast
│   ├── combat/          DAMAGE / DEATH / XP / LEVEL / RESPAWN / status-effect canonical owner
│   ├── skills/          18 skills — Rogue + Barbarian + Sorcerer × 6 each (basic+3+ult+dash)
│   │                    + casting pipeline + channels + tweens + player projectiles
│   │                    + basic-attack auto-fire near hostiles
│   ├── mobs/            5 archetypes (skeleton-warrior/archer/zombie/wraith/brute) + AI brain
│   │                    + projectiles + spawn ring (40 mobs, 12m clear zone)
│   ├── loot/            63 affix templates + procgen names + rarity weights + drops on
│   │                    mob:killed + pickup loop + tooltip formatter
│   ├── inventory/       I-toggle panel: 4 equipment + 6×4 grid, equip-swap, drop, compare-tooltip
│   ├── ui/              HUD (HP/Resource/XP bars, hotbar with cooldown sweeps, FPS, kill feed,
│   │                    skill toast, party panel slot, LEVEL UP overlay)
│   ├── fx/              EffectComposer (RenderPass + UnrealBloom + vignette/grade ShaderPass +
│   │                    OutputPass) + screenshake + hitstop + 3 particle pools + DOM
│   │                    floating damage numbers + skill-cast ground rings
│   ├── audio/           lazy-boot WebAudio + 20 synthesized SFX (no assets) + procgen ambient
│   │                    drone + combat-reactive rumble + zone:enter retunes
│   ├── dungeons/        procgen dungeon at (0, -500, 0): 5 rooms + corridors + lighting +
│   │                    entry/exit portals + zone transition + dungeon mob spawning + cleanup
│   ├── boss/            Gravelord Morthen — 600 HP, 2 phases, 7 telegraphed attacks,
│   │                    cinematic intro/death, top-of-screen boss bar
│   └── portal/          Vibe Jam webring entry/exit (gold outbound, cyan return)
├── multiplayer/         PartyKit client (room hub-1) + ghost players + party panel +
│                        click-to-invite (local-only) + name prompt + 6-retry connection
└── main.ts              boot Three.js + World, call init* in order, drive render loop
                         with gameState.timeScale + ctx.renderHook (FX composer)

partykit/
└── server.ts            generic 16-player relay, 10 Hz state broadcast (unmodified)
```

---

## How to run / test

### Solo (no multiplayer)
```bash
npm install   # if you haven't yet
npm run dev   # vite at http://localhost:5173/
```
Open the URL. The game runs solo. No PartyKit needed.

### With multiplayer
In a SECOND terminal:
```bash
npx partykit dev   # relay at localhost:1999
```
Reload the page. The hub panel (top-left) should show **Online**. Open a 2nd browser tab — both players should see each other as translucent capsules.

### What to test
1. **Open world atmosphere** — fog, torches flicker, embers drift, moon disc visible. Mobs scattered.
2. **Movement** — LMB / hold to walk. Camera smooth-follows.
3. **Combat** — walk near a skeleton. Player auto-fires basic attack. Health decreases on red flash. Mob dies → loot drops with rarity-tinted glow.
4. **Skills** — press `1` `2` `3` `Q` `SHIFT` while a target is in range. Cooldowns tick down on hotbar. Resource (energy) drains.
5. **Inventory** — `I` opens panel. Click loot to equip. Right-click to drop. Hover for tooltip.
6. **Dungeon** — walk to the **ABYSSAL CRYPT** portal at `(15, 0, 15)`. Stand in it / click. You land underground. 6-9 mobs, then boss room.
7. **Boss** — phase 1: cleave / spikes / summon / charge. Phase 2 (<50%): + death wave / meteor rain / reaper's embrace. Boss bar at top. Death = legendary loot + EXIT portal lights up.
8. **Vibe Jam portal** — at `(-15, 0, -15)` (or `(15, 0, -15)` if return-arched). Walk into / click → bounces to vibej.am.
9. **Multiplayer** — open 2 tabs. See each other's capsule. Click a remote to add them to your local party (gold name).

### Known limitations / TODOs

- **PartyKit production host is a placeholder.** `src/multiplayer/connection.ts` has a `TODO(deploy)` comment. Replace with the real `*.partykit.dev` URL after `npx partykit deploy`.
- **No wall collision in dungeon.** Click-to-move can clip through walls. Cosmetic for jam.
- **Per-archetype mob HP is what spawn sets** — XP is read from `mobXpReward` component (string-keyed). Combat falls back to 10 if missing.
- **Open-world mobs are static spawns.** No re-spawning. Once cleared, the area stays empty.
- **Dungeon prefab is single-instance per session** — re-entry reuses the same layout.
- **Party state is local-only.** True cross-player party (server-aware) would need protocol extensions — out of jam scope.
- **No save/persistence.** Reload = fresh character.

---

## Deploy checklist (when ready)

1. `! vercel login` (user runs interactively).
2. `! npx partykit login`.
3. Update `partykit.json` `name` from `"gamejam"` to final slug if desired.
4. Replace prod host placeholder in `src/multiplayer/connection.ts`.
5. `npx partykit deploy` → note the returned `*.partykit.dev` host.
6. `vercel deploy --prod` for the static site.
7. Submit URL to Vibe Jam 2026 form.
8. Verify the mandatory `vibej.am/2026/widget.js` is loading on prod.

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

Latest production build size: **~190 kB gzip** (well under jam-friendly limit; instant load).

---

## Workflow notes (for future sessions)

- Wave-based parallel subagent dispatch worked well: each wave spawned 2-5 focused agents writing into their own folders. Integration was light because contracts (init signatures, EventMap, GameContext) were locked in Wave 0.
- Cross-module communication is via the event bus (EventMap in `src/core/types.ts`). Add new events there when extending.
- TypeScript is strict — `verbatimModuleSyntax` requires `import type` everywhere; `erasableSyntaxOnly` rules out `enum` / `namespace`.
- Always run `npx tsc --noEmit` and `npm run build` before committing.
- Commit per wave with a detailed body — judges browse the GitHub history.

---

## Recent commits

Run `git log --oneline -10` for the live list.

```
5d54efe feat(wave-4): PartyKit multiplayer hub + Vibe Jam webring portal
6a83290 feat(wave-3): procgen dungeon + 2-phase boss + procedural audio
93c6c98 feat(wave-2): combat + 18 skills + 63-affix loot + inventory + FX
19cb357 feat(wave-1): procgen gothic biome + 5-mob AI + gothic HUD
26c4348 feat(wave-0): shared scaffolding for D4-style ARPG
816998b chore: wipe prototype, keep scaffold (three.js + partykit + ecs-lite)
```
