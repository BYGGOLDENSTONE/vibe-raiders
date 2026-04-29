# DUSK — gothic action RPG (Vibe Jam 2026)

> **Submission target:** Cursor Vibe Jam 2026 · deadline **2026-05-01 13:37 UTC** · today **2026-04-29**.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (still named after the previous prototype — rename to `dusk` when convenient).
> **Genre:** Diablo IV-style 3D action RPG. Click-to-move, hub + open world + dungeon, multiplayer hub, procgen loot.
> **Status:** systems-complete (waves 0-4) but **visually placeholder**. Next session: polish phase.

---

## Resume here (start of next session)

1. Read this file end-to-end.
2. `git log --oneline -15` — see how the wave-based commits land.
3. `npm run dev` (vite at :5173) and `npx partykit dev` (relay at :1999).
4. Click **PLAY** on the menu, click around the graveyard. Confirm: brighter terrain readable, mouse moves player, hotbar keys cast skills, mobs aggro and die, loot drops, `I` opens inventory, `(15,0,15)` portal warps to dungeon, boss fight works, `(-15,0,-15)` Vibe Jam portal.
5. Read **"Polish phase priorities"** below — that's the next chunk of work.

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

## Current visual state — HONEST assessment (this is the polish target)

What we have now is **functional but placeholder-tier visuals**. Systems all work, but a judge looking for the first 5 seconds will see:

- Player = a tan capsule. No silhouette, no animation.
- Mobs = capsule torsos with sphere heads + cylinder limbs. No walk cycles. They slide on the ground. Tiny bob animation only.
- Boss = composite primitive with cloak Plane-meshes drifting. No skeletal animation, no real swing animation; cloak floats are the main motion cue.
- Terrain = displaced plane with three vertex-color tiers. Flat lighting feel.
- Props = instanced boxes/cylinders. No texture, no decoration variation.
- Particles = simple Points sprites, additive blend, low count.
- Telegraphs = flat ring/circle/plane meshes. Functional but not menacing.
- UI = clean and gothic but text-heavy, no item icons (just colored discs with 2-letter abbreviations).
- Audio = procedural drone + 20 synthesized SFX. Adequate but thin.
- Skills = basic projectile / AoE / particle bursts. No trail meshes, no swing arcs, no impact decals.

**This is currently more "tech demo" than "ARPG showcase".** The polish phase below is what turns it into the WOW jam-winner the user originally asked for.

---

## Polish phase priorities (next session — start here)

Order roughly by impact-per-effort. Each is a candidate for a focused subagent.

### 1. Character readability (HIGH — every frame benefits)
- Player capsule → richer silhouette: head sphere + torso capsule + cloak quads + visible weapon model that swings on attack.
- Class-distinct silhouettes (rogue = slim with daggers, barb = wide with greataxe, sorc = robed with floating staff).
- Procedural walk animation: head/torso bob phased with movement direction; arm swing.
- Attack animation: weapon arc tween on basic / skill cast.
- Death animation: fall-rotate + dissolve (not just sink-in-place).

### 2. Mob silhouettes + anim (HIGH)
- Each archetype gets a more distinct read: skeleton archers visibly hold a bow, zombies visibly slouch + drag a foot, wraiths get a real cloak with vertex-shader sway, brutes get a comically oversized weapon.
- Walk-cycle approximation per archetype (different bob frequencies + step jitter).
- Attack anim: melee mobs do a pre-swing wind-up + commit (telegraph their hit).
- Hit reaction: knockback on heavy hits, brief stumble.

### 3. Material / shader pass (HIGH — cheap, big impact)
- Rim-light shader on characters (Fresnel highlight in cool blue) so they pop against fog.
- Emissive trim on weapons + boss accents.
- Subtle iridescence on wraiths.
- Cracked-stone displacement noise on tombstones / pillars.
- Wet-look reflective patches on dungeon floor (planar reflections via PMREMGenerator or fake with a normal map equivalent).

### 4. Skill FX overhaul (HIGH — gameplay feel)
- Trail meshes on melee swings (TubeGeometry along an arc, fading alpha).
- Projectiles need actual trails (Points emitter behind them, additive).
- Ground decals on AoE skills (a textured ring that fades, not just a flat ring).
- Hit decals on impact (cracked-ground variant).
- Per-element palettes: fire (orange-red plasma), ice (pale blue with refraction), lightning (cyan with branching arcs), poison (sickly green particles).
- Make basic attack visually satisfying — currently it's the weakest link.

### 5. Boss polish (MEDIUM-HIGH — clip moment)
- Replace cloak Planes with a flowing ribbon mesh that physics-sways with movement.
- Scythe gets a visible blade glint + a sweep trail.
- Phase-2 transition needs a real visual tear (screen warp shader pulse + camera dolly + crimson burst).
- Death cinematic: slow-mo, zoom in, soul leaving body, ground crack.
- Telegraph improvements: swirling rune patterns (procedural shader) instead of flat red rings.

### 6. Dungeon atmosphere (MEDIUM)
- Variable ceiling heights per room, cracked floor displacement.
- Rope-bridge style segments between rooms, swaying via vertex shader.
- Wall sconces with bigger flame plumes + heat-haze post-fx.
- Boss arena: blood pool decal, scattered bones, broken pillars, raised dais with hero statue.
- Dungeon-specific fog tint (deep crimson) — currently shares the world fog.

### 7. UI / inventory polish (MEDIUM)
- Item icons: instead of 2-letter abbreviation, render a tiny 3D weapon/armor preview into a canvas (Three.js offscreen).
- Tooltip layout: dividers, comparison arrows (green up / red down), item rarity flavor text line.
- Hotbar: larger, more dramatic cooldown sweep, ready-pulse animation.
- Health/resource orbs (Diablo-style) instead of horizontal bars.
- Damage numbers: chunkier font, color-graded by element, screen-space arc trajectory.

### 8. Audio depth (MEDIUM)
- Replace single-layer drone with 3-layer composition: deep pad + mid harmonic bell strikes + high airy whisper sample.
- Combat layer: stinger when enemies aggro, thrum during fight, fade to ambience after.
- Boss music: dedicated 30s loop (procedural still — no asset downloads) with phase-2 intensity ramp.
- Footsteps: per-surface (stone vs grass-via-noise) at gait rate.
- Ambient one-shots: distant howl, raven caw, thunder roll, every 20-40s.

### 9. Open-world content (LOW-MEDIUM — depth, not first-impression)
- 2-3 named landmarks beyond the spawn area: ruined chapel, cursed obelisk, frozen pond.
- A second biome reachable by walking far: foggy moors with twisted trees.
- Random world events: meteor shower (timed AoE), elite mob roaming, treasure goblin that flees.
- Mob respawn after 60s in cleared areas.

### 10. Multiplayer richness (LOW)
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
