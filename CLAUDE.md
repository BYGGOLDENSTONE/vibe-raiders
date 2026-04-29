# DUSK — gothic action RPG (Vibe Jam 2026)

> **Submission target:** Cursor Vibe Jam 2026 · deadline **2026-05-01 13:37 UTC** · today **2026-04-30**.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (still named after the previous prototype — rename to `dusk` when convenient).
> **Genre:** Diablo IV-style 3D action RPG. Click-to-move, hub + open world + dungeon, multiplayer hub, procgen loot.
> **Status:** **Polish phase 5 (mechanics + visuals + UI/audio) complete.** Game looks and reads as a D4-clone. Gameplay still feels "early" — combat is shallow because all mob archetypes share one AI, world is static (no respawn, no events, no elite tier), loot is stat-only (no build-defining procs). Next session: **Gameplay Depth phase** — designs incoming from user.

---

## Resume here (start of next session)

1. Read this file end-to-end — especially **"What's done in Polish phase 5"** and **"Gameplay Depth phase (incoming)"**.
2. `git log --oneline -15` — last 3 commits are the polish phase.
3. `npm run dev` (vite, port 5173 / fallbacks to 5175) and optionally `npx partykit dev` (relay at :1999).
4. Hard refresh (Ctrl+Shift+R). On menu pick a class card (Rogue/Barb/Sorc) → PLAY.
5. Smoke test: click ground to walk, click enemy → engages at basic-attack range (Sorcerer stops at 12m and shoots, doesn't melee), click loot → walks to it and auto-picks, `1/2/3/Q/SHIFT` casts (locked slots show 🔒), level up → `+1 Skill Point` toast → right-click hotbar slot to spend (rank-up max 5), `I` opens inventory with 3D item icons, HP/Resource are SVG liquid orbs, dungeon portal `(15,0,15)`, boss fight phase-2 cinematic.
6. **User feedback after polish phase**: "still feels early, doesn't feel like Diablo." User is correct — see the **"Why it doesn't feel like Diablo yet"** section. Next session implements design fixes.

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

## Game design (locked, systems-complete)

**One-liner:** browser-native Diablo IV clone — gothic graveyard open world + procgen dungeon + 2-phase boss, with synced multiplayer hub.

**Core loop:**
1. Spawn in gothic graveyard open world (220 m radius). 40 mobs roam (5 archetypes).
2. Click-to-move, hold-LMB to keep walking. Basic attack auto-fires when stopped near an enemy.
3. Hotbar skills: 1 / 2 / 3 / Q (ult) / SHIFT (dash). Player class (Rogue / Barbarian / Sorcerer) determines kit.
4. Kill mobs → XP + procgen loot drops (rarity-tinted). Walk into drops to pick up.
5. Press `I` to toggle inventory: 4 equipment slots + 6×4 grid + click-to-equip + compare-tooltip + right-click-to-drop.
6. Walk to **ABYSSAL CRYPT** portal at `(15, 0, 15)` → enter procgen dungeon (5 rooms + boss).
7. Final room: **Gravelord Morthen**, 2-phase boss with telegraphed AoEs. Drops legendary, opens **EXIT** portal.
8. Hub multiplayer: see other jam visitors as ghost capsules.
9. **VIBE JAM** webring portal at `(-15,0,-15)` (or `(15,0,-15)` if return arch occupies left slot) exits to vibej.am/portal/2026.

**Class kits (all implemented in `src/game/skills/`):**
- ROGUE (energy): strike / shadow-step / smoke-cloud / volley / storm-of-blades / roll
- BARB (rage): cleave / leap / whirlwind / ground-slam / berserk / charge
- SORC (mana): bolt (homing) / ice-nova / chain-lightning / meteor / black-hole / blink

Default class is `'rogue'`. Class swap UI does not exist yet.

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
│   ├── state.ts         GameContext + gameState (player, currentZone, timeScale, paused, renderHook)
│   ├── constants.ts     COLORS, TUNING, CAMERA — single source of magic numbers
│   ├── menu/            start screen overlay (PLAY + volume slider) — sets timeScale=0 until PLAY
│   ├── world/           procgen gothic biome (terrain heightmap + tombs/walls/trees/pillars/
│   │                    mausoleums + paths + 8 flickering torches + 1500 embers + starfield + moon)
│   ├── player/          player capsule + full component stack + click-to-move locomotion
│   ├── camera/          D4-angled iso, smooth follow
│   ├── input/           click-to-move (LMB hold) + hotbar keys (1/2/3/Q + SHIFT) → emits player:skillCast
│   │                    Listeners on DOCUMENT (not canvas) so UI overlays can't swallow clicks.
│   ├── combat/          DAMAGE / DEATH / XP / LEVEL / RESPAWN / status-effect canonical owner
│   ├── skills/          18 skills (Rogue + Barbarian + Sorcerer × 6 each) +
│   │                    casting pipeline + channels + tweens + player projectiles
│   │                    + basic-attack auto-fire near hostiles
│   ├── mobs/            5 archetypes + AI brain + projectiles + spawn ring
│   ├── loot/            63 affix templates + procgen names + rarity weights + drops
│   │                    on mob:killed + pickup loop + tooltip formatter
│   ├── inventory/       I-toggle panel: 4 equipment + 6×4 grid, equip-swap, drop, compare-tooltip
│   ├── ui/              HUD (HP/Resource/XP bars, hotbar w/ cooldown sweeps, FPS,
│   │                    kill feed, skill toast, party panel slot, LEVEL UP overlay)
│   ├── fx/              EffectComposer (RenderPass + UnrealBloom + vignette/grade ShaderPass +
│   │                    OutputPass) + screenshake + hitstop + 3 particle pools + DOM
│   │                    floating damage numbers + skill-cast ground rings
│   ├── audio/           lazy-boot WebAudio + 20 synthesized SFX (no assets) + procgen ambient
│   │                    drone + combat-reactive rumble + zone:enter retunes
│   ├── dungeons/        procgen dungeon at (0,-500,0): 5 rooms + corridors + lighting +
│   │                    entry/exit portals + zone transition + dungeon mob spawning + cleanup
│   ├── boss/            Gravelord Morthen — 600 HP, 2 phases, 7 telegraphed attacks,
│   │                    cinematic intro/death, top-of-screen boss bar
│   └── portal/          Vibe Jam webring entry/exit (gold outbound, cyan return)
├── multiplayer/         PartyKit client (room hub-1) + ghost players + party panel +
│                        name prompt + 6-retry connection. Click-to-invite REMOVED (was
│                        intercepting canvas mousedown).
└── main.ts              boot Three.js + World, call init* in order, drive render loop
                         with gameState.timeScale + ctx.renderHook (FX composer)

partykit/
└── server.ts            generic 16-player relay, 10 Hz state broadcast (unmodified)
```

---

## What's done in Polish phase 5 (mechanics + visuals + UI/audio)

Three sub-waves shipped — see the 3 "polish-5a/5b/5c" commits.

### Polish-5a — D4 mechanics (input/progression)
- **Click intent system** (`src/game/input/index.ts`) — LMB raycasts hostile group → `player:engageEnemy` (player walks to `range*0.85`, stops, auto-fires; ranged classes like Sorcerer no longer melee). Loot raycast → `player:pickupTarget` (walks to `pickupRadius*0.5`, intent-priority pickup loop in `loot/index.ts`). Ground fallback = legacy walk. Hold-LMB re-evaluates per frame. UI overlays (`[data-ui]`, `.inv-panel`, `gameState.paused`) block input.
- **Class-select UI** (`src/game/menu/index.ts`) — 3 cards (Rogue/Barb/Sorc) with class-tinted icon + resource label; PLAY emits `player:classChanged` → player module rebuilds rig + skill module repopulates hotbar.
- **Skill point + slot unlock** (`combat/index.ts` + `skills/index.ts` + `ui/hud.ts`) — level grants +1 SP; slot 0 (basic) and 5 (dash) start unlocked; slot 1@L2, 2@L4, 3@L7, ult@L10 auto-unlock. Right-click hotbar slot spends a SP to rank-up (max 5). Each rank: +15% damage / -5% cooldown. HUD shows lock overlay + level gate, rank dots, gold "SKILL POINTS" badge, level-up subtitle.
- **EventMap additions** (`src/core/types.ts`): `player:engageEnemy`, `player:pickupTarget`, `player:classChanged`, `skill:unlocked`, `skillpoint:gained`, `skillpoint:spent`.
- **Components** (`src/core/components.ts`): `SkillUserComponent` extended with `skillPoints`, `unlockedSlots[]`, `skillRanks[]`.

### Polish-5b — visual polish (player/mobs/FX/dungeon/boss)
- **Player rig** (`player/index.ts` + `player/animation.ts` + `player/shaders.ts`) — Group hierarchy: head + torso + arms + legs + 3-panel cape + class weapon (rogue daggers / barb greataxe / sorc orb-staff). Procedural walk anim (gait 4-16 rad/s, head bob, limb swing), attack swing 250ms ease-out arc, death anim (z-rot fall + dissolve). Rim-light Fresnel shader (cool blue 0x4060ff) via `onBeforeCompile`. Cape vertex-shader sway. Hot-class-swap rebuilds rig.
- **Mob silhouettes** (`mobs/archetypes.ts` + `mobs/animation.ts` + `mobs/shaders.ts`) — 5 named child rigs: skeleton-warrior (skull + ribs + sword), skeleton-archer (3-piece bow + limp gait), zombie (hunched + skin patches + biting anim), wraith (cone hood + wavy cape + iridescence shader), brute (oversized double-axe + heavy stomp). Per-archetype gait tuning, attack windup detection (via combat.lastAttackTime + brain state polling — no new event), 0.2s hit shake on `damage:dealt`. Root + child meshes stamped with `userData.entityId` (raycast preserved).
- **Skill FX** (`fx/elements.ts` + `fx/trails.ts` + `fx/decals.ts` + `skills/index.ts`) — pool-based trails (24 swing TubeGeometry catmull-rom + 32 projectile ring buffer). Pool decals: 16 AoE rune (rotating wedges + counter-rotating sigil), 32 cracked-star hit, 8 telegraph rings, 6 cones, 6 lines. 8-element palette (fire/ice/lightning/poison/arcane/physical/shadow/holy). `dispatchSkillFx()` switches per skill — skill logic untouched.
- **Dungeon detail** (`dungeons/geometry.ts` + `dungeons/layout.ts` + `dungeons/lighting.ts` + `dungeons/atmosphere.ts`) — per-room ceiling 4-8m, FBM-displaced floor with crimson vertex-color veins, custom pulsing ShaderMaterial for boss-room floor, blood pool + bone scatter + broken columns + dais + brazier. Torches: emissive flame core + additive plume cone + heat-haze placeholder. Crimson fog tint on dungeon enter, restores world fog on exit.
- **Boss polish** (`boss/index.ts` + `boss/cinematic.ts`) — single ribbon cape (vertex shader sway + velocity drag + polar wrap + gradient hem). Scythe wrapped in parent group with emissive blade + edge ring; cleave windup spawns sweep trail; cleave commit spawns crimson burst. Phase-2: DOM crimson overlay flash + scene burst sphere/light + scythe glow boost + cape color shift. Rune-shader telegraphs (circle/arc/line). Death: 8-sliver radial ground crack + delayed soul ascend (rising additive sphere + drift particles + halo + light).

### Polish-5c — UI & audio
- **HUD orbs** (`ui/orbs.ts` + `ui/hud.ts`) — SVG liquid-fill orbs replace bottom-corner bars: HP red, Resource class-tinted (green/orange/blue), gothic-metal radial ring, sin-wave animated liquid surface, breathing outer glow, low-HP flicker pulse.
- **Damage numbers** (`ui/damageNumbers.ts`) — DOM number with arc trajectory (world→screen projection + upward velocity + horizontal jitter + gravity decay), 0.9s lifetime; crit = 1.6x font + gold→white shimmer + screenshake trigger.
- **Hotbar polish** (`ui/hotbar.ts` + `ui/hud.ts`) — per-slot SVG cooldown ring (stroke-dasharray sweep + tinted drop-shadow), 0.45s outward glow keyframe pulse on cooldown ready edge, retains existing locked-slot lock overlay + rank dots + SP pulse.
- **3D item icons** (`inventory/itemIcons.ts` + `inventory/index.ts`) — offscreen Three.js renderer (64×64), mini-meshes per slot/baseId (sword/axe/staff/dagger/mace/helm/chest/amulet/ring), 3-light setup with rarity-tinted rim, lazy + cached as base64. Inventory slots show `<img>` instead of 2-letter disc.
- **Audio layering** (`audio/ambient.ts` + `audio/bossMusic.ts` + `audio/footsteps.ts` + `audio/oneshots.ts`) — 3-layer drone (deep pad 50-80Hz + minor-key bell strikes with reverb tail + filtered airy whisper), zone-aware retuning (graveyard minor / dungeon dissonant / hub bright). Combat-reactive sub-bass thrum, fades 5s after last kill. Boss music: 30s procgen loop (pad arpeggio + 4/4 kick @ 100 BPM + distorted square lead with reverb), 3s riser intro, phase-2 +20% tempo / 2x distortion / 40Hz sub-pulse / drier lead, 4s death fade. Footsteps surface-aware (graveyard pebble vs dungeon stone slap), L/R alternating pan. One-shots 20-40s zone-weighted (howl/raven/thunder/bell graveyard, drip/rumble dungeon).

**Build size after polish:** 850 kB raw / **225 kB gzip** (was 194 kB; +31 kB for all the above is a fine ratio). `npx tsc --noEmit` clean. `npm run build` clean.

---

## Why it doesn't feel like Diablo yet (user feedback after polish phase)

The polish phase made the game **look** like D4 but the **gameplay loop is still shallow**. User played and said: "still feels early." The reasons (from the assistant's honest review, ranked by impact):

1. **Mob AI is single-pattern.** All 5 archetypes share `mobs/ai.ts` — approach + melee/projectile. Visually they look distinct, but skeleton archers don't kite, zombies don't swarm, wraiths don't phase-shift, brutes don't telegraph charges. Combat is one-note.
2. **No mob respawn, no dynamic spawn.** 40 mobs spawn at world init, never replaced. Cleared zones stay dead. World feels static after 5 minutes.
3. **No elite/champion tier.** Every regular mob is the same. D4's "named elite with affix package + golden halo + better loot table" doesn't exist here.
4. **Loot is stat-only.** 63 affixes are all "+15% damage" / "+25 HP" type. No build-defining procs ("on-hit chance to spawn meteor", "explode on kill", "vampire heal"). No collection / set / unique / aspect feel.
5. **Progression caps fast.** Level 10 unlocks all skills, max rank 5 fills by level 20-25. After that — nothing. No paragon / glyph / aspect post-cap.
6. **World is one biome.** Single graveyard, no second zone, no landmarks, no NPCs, no side events, no treasure goblin, no helltide-style rotating events.
7. **Combat juice is mild.** Hit-stop exists but soft. Crits don't freeze the screen, no bone shrapnel, no knockback physics, no hit-spark mesh bursts.

These are the gaps the **next session** must address.

---

## Gameplay Depth phase (incoming — next session)

User will paste a design document from claude.ai design output describing the next batch of features. Implement those.

**Likely candidates** (so the assistant has context when designs arrive):

### High impact (2-3 hours each)
- **Per-archetype AI** (`mobs/ai.ts` extension): kite (archer), swarm (zombie), phase-shift (wraith), charge-telegraph (brute), pack-leader (one-of-each-elite).
- **Elite mob tier**: random ~10% of spawns get `isElite=true` → +50% HP, +25% damage, +1 affix package (ranged, fast, vampire, etc.), gold halo VFX, "Elite Skeleton Captain" name plate, guaranteed magic+ drop.
- **Mob respawn + dynamic spawn**: cleared zone refills after 45s; rare "monster pack" event spawns elite-led group at random graveyard cell.
- **Combat juice +++**: crit = 0.15s timeScale freeze + screen flash + knockback impulse + bone shrapnel particles (use existing fx pools); whirlwind enemies physically pushed; chain-react explosions on overkill.

### Medium impact (3-4 hours each)
- **Legendary "proc" affixes** (8-10 build-defining): meteor-on-hit, explode-on-kill, lifesteal, dodge-turns-ghost, double-strike, freeze-on-crit, etc. Implement via existing affix engine in `loot/`.
- **Treasure goblin event**: rare flee-AI mob, drops 3-5 legendaries on kill.
- **2nd biome**: foggy moors north of graveyard (separate scene group, walked-into reveal), new mob skin variants.
- **NPC + lore bubble**: silent figure at hub, click → text bubble Diablo-style flavor text. Cheap world-life signal.

### Stretch (only if time permits)
- **Aspect / set system** — drop "imprintable powers" from elite kills, user can apply to gear.
- **Paragon mini-board** — post-level-10 each level grants a paragon point with a small node selection.

### Implementation approach when designs arrive
- Treat the design doc as truth. Group by file boundary, then dispatch parallel subagents per group (same wave-based pattern that worked).
- Add new EventMap entries in `src/core/types.ts` upfront so subagents don't collide.
- Always run `npx tsc --noEmit && npm run build` before committing.
- Wave-by-wave commits with detailed bodies (per CLAUDE.md style).

---

## Multiplayer richness (LOW priority for jam)
- Real party state via protocol extension (currently local-only): server-side party rooms.
- Trade UI between hub players.
- Visible damage / class info on remote ghost name tags.

---

## How to run / test

### Solo (no multiplayer)
```bash
npm install   # if you haven't yet
npm run dev   # vite at http://localhost:5173/
```

### With multiplayer
In a SECOND terminal:
```bash
npx partykit dev   # relay at localhost:1999
```
Reload the page. The hub panel (top-left) should show **Online**.

### Controls
- **LMB / hold** — move
- **1 / 2 / 3** — skills
- **Q** — ultimate
- **SHIFT** — dash
- **I** — inventory toggle
- **Esc** — close inventory / start menu (Enter also works on menu)

---

## Known limitations / TODOs (jam-acceptable scope)

- **PartyKit production host is a placeholder.** `src/multiplayer/connection.ts` has a `TODO(deploy)` comment. Replace with the real `*.partykit.dev` URL after `npx partykit deploy`.
- **No wall collision in dungeon.** Click-to-move can clip through walls. Cosmetic for jam.
- **Open-world mobs are static spawns.** No re-spawning. Once cleared, the area stays empty.
- **Dungeon prefab is single-instance per session** — re-entry reuses the same layout.
- **Party state is local-only.** True cross-player party (server-aware) would need protocol extensions — out of jam scope.
- **No save/persistence.** Reload = fresh character.
- **Class is locked to Rogue.** No class-select UI; would need menu update + skills repopulate.
- **Click-to-invite removed.** Multiplayer pointerdown handler was suppressing canvas mousedown via preventDefault. Party panel rows still let you toggle membership.

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

Latest production build size: **~194 kB gzip** (jam-friendly; instant load).

---

## Workflow notes (for future sessions)

- **Wave-based parallel subagent dispatch** worked well: each wave spawned 2-5 focused agents writing into their own folders. Integration was light because contracts (init signatures, EventMap, GameContext) were locked in Wave 0.
- **Cross-module communication is via the event bus** (EventMap in `src/core/types.ts`). Add new events there when extending.
- **TypeScript is strict** — `verbatimModuleSyntax` requires `import type` everywhere; `erasableSyntaxOnly` rules out `enum` / `namespace`.
- Always run `npx tsc --noEmit` and `npm run build` before committing.
- Commit per wave with a detailed body — judges browse the GitHub history.
- **Subagents must write only inside their assigned folder.** Cross-folder edits get integrated by the main context.

### Lessons learned during waves 0-4
- Damage application: mobs/index.ts had a "WAVE2_OWNS_DAMAGE" stub that combat replaced. When taking ownership of an event, also strip producers in dependent modules to avoid double-emit.
- Pointer events: `pointerdown` capture handlers with `preventDefault()` can suppress `mousedown` even when their early-return paths skip the preventDefault. Prefer `mousedown` directly OR don't `preventDefault` in `pointerdown`.
- Lighting: dark vertex colors + dense FogExp2 + dark background = pitch-black scene that LOOKS broken. D4 reference: dark mood, BRIGHT readability. Push ambient + moonlight intensity hard, soften fog density.
- Vite HMR: when in doubt, **hard refresh** (Ctrl+Shift+R). HMR for module-level event listeners can leave zombies, but missing changes usually = browser cache.

---

## Recent commits

Run `git log --oneline -15` for the live list. Most recent first:

```
7273735 fix(input): mouse-click locomotion was suppressed by mp pointerdown capture
d320f53 chore: gitignore partykit dev state
2c11975 fix(visibility): D4-style brightness pass + start menu
db1ded9 docs: lock state for D4-style ARPG demo (waves 0-4 complete)
5d54efe feat(wave-4): PartyKit multiplayer hub + Vibe Jam webring portal
6a83290 feat(wave-3): procgen dungeon + 2-phase boss + procedural audio
93c6c98 feat(wave-2): combat + 18 skills + 63-affix loot + inventory + FX
19cb357 feat(wave-1): procgen gothic biome + 5-mob AI + gothic HUD
26c4348 feat(wave-0): shared scaffolding for D4-style ARPG
816998b chore: wipe prototype, keep scaffold (three.js + partykit + ecs-lite)
```
