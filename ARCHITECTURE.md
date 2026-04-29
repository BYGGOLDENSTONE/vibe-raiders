# Architecture

A small, opinionated layout. Optimized for a 2-day jam: simple to reason about, hard to spaghettify.

## Core idea: ECS-lite

Every gameplay object is an `Entity`. An entity is a thin wrapper around a Three.js `Object3D`:

```ts
interface Entity {
  id: number;
  tags: Set<string>;             // 'player' | 'bot' | 'loot' | ...
  components: Map<string, any>;  // 'health' | 'weapon' | 'backpack' | ...
  object3d: Object3D;            // visual + transform
  alive: boolean;
}
```

The `World` owns all entities and runs registered `System`s each frame. Systems query entities by tag/component:

```ts
for (const e of world.query('bot', 'alive')) { ... }
for (const e of world.queryWith('weapon')) { ... }
```

No deep inheritance. No singletons leaking through the codebase. State lives on entities, behavior lives in systems, communication goes through the world's typed event bus.

## Module boundaries

```
src/
├── core/          ECS-lite, types, event bus, component/tag enums
├── world/         Scene, atmosphere, multi-biome world, heightmap, portals
│   ├── biomes/    Per-biome generators (city/industrial/dam/forest/mountain)
│   ├── map.ts     Top-level world orchestrator (generateWorld)
│   ├── heightmap.ts  Terrain mesh + groundHeight(x,z) sampler
│   └── ...
├── entities/      Factories: createPlayer, createBot, createLoot, ...
├── systems/       Per-frame logic: fps-controller, combat, ai, loot, extraction, grapple
├── net/           PartyKit client + room schemas + sync
├── ui/            Debug panel, lobby, HUD, minimap, leaderboard, announcements
├── audio/         Web Audio context + sound bank
├── render/        Post-processing pipeline (composer + passes)
├── main.ts        Bootstrap: build world, register systems, run loop
└── partykit/      (sibling to src/) Cloudflare Workers room implementation
```

**Rules:**
- `core/` knows about nothing else.
- `world/` modules build / mutate the scene; they don't subscribe to gameplay events.
- `entities/` are pure factories — build mesh + components, return Entity. No subscriptions.
- `systems/` only touch entities through `World.query` and `World.emit`. They don't import each other.
- `ui/` reacts to events; it never mutates game state directly. It sends intents through events.
- `net/` translates between local entities and remote messages. It owns `netId`s.

## Module APIs (current)

### `world/scene.ts` → `createSceneBundle(canvas)`
Returns `{ renderer, scene, camera, sun, hemi, fog, skyUniforms, resize }`. The bundle exposes the raw uniforms/lights so the atmosphere system can mutate them.

### `world/atmosphere.ts` → `createAtmosphere(bundle)`
4-phase color cycle. Tween skies, sun, hemi, fog, exposure, and clear color smoothly. Phases (`PHASES`): GOLDEN HOUR · DUST STORM · ASHEN HAZE · BLOOD VEIL. 75 s each, 5 min total. Returns `{ update(dt), currentPhaseName(), setTime(s), totalCycleSec() }`.

### `world/map.ts` → `generateWorld({ scene, seed, size? })`
Orchestrates the full 400×400 m multi-biome world. Builds the heightmap, calls each biome (`biomes/{city,industrial,dam,forest,mountain}.ts`), aggregates colliders + shelters + landmarks, places 4 shelters (one per biome), spawns distant silhouettes. Returns `{ colliders, shelters, landmarks, bounds, groundHeight, update, dispose }`. AABB collider list is consumed by the FPS controller and combat raycasts; `groundHeight(x,z)` is sampled by the FPS controller every frame.

### `world/heightmap.ts`
Defines the procedural heightmap. Exposes `groundHeight(x,z)`, `buildHeightmap()` (returns the vertex-colored Mesh + sampler), and `REGIONS` (per-biome rectangular regions used by the orchestrator).

### `world/biomes/*`
Per-biome generators. Each exports a `buildXxxBiome(opts)` that returns `{ colliders, shelterCandidates, landmarks, update? }`. They share `_common.ts` (geometry merge helpers) and never import outside `world/`.

### `world/portals.ts` (in progress, subagent)
`createVibeJamPortals({ scene, getPlayer, spawnPoint, exitPosition, hostName })` → `{ update() }`. ESM port of vibej.am sample. Detects `?portal=true`, draws green exit + red arrival, handles redirect logic.

### `systems/fps-controller.ts` → `createFpsController({ camera, domElement, player, colliders, getGroundHeight })`
Pointer lock + WASD + sprint + crouch + jump + gravity + planar-bounded movement + AABB collision (via `pushOutXZ`) + heightmap ground sampling (per frame, via the optional `getGroundHeight` callback).

### `render/post.ts` → `createPostPipeline({ renderer, scene, camera })`
EffectComposer pipeline. Passes: `RenderPass` → `UnrealBloomPass` → custom `ShaderPass` (vignette + chromatic aberration; grain disabled by default) → `OutputPass`. Returns `{ composer, params, render(), resize(w,h), setEnabled(b), isEnabled() }`. `main.ts` calls `post.render()` instead of `renderer.render(scene, camera)`. Toggle with debug key N.

### `entities/player.ts` → `createLocalPlayer(opts)`
Factory. Tags: `player`, `localPlayer`, `alive`. Components: transform, health (100), weapon (mag 20 / reserve 40 / dmg 25), backpack (20 kg), player.

### `ui/debug.ts` → `createDebugPanel({ enabled })`
Plugin-based debug overlay. `addSection({ id, title, render, order? })` and `addKey({ key, label, group?, fn })`. Rendered at 5 Hz. Stubbed (no-op) when `enabled === false`. Toggle with backquote.

## Component reference

| Component | Owners | Fields |
|---|---|---|
| `transform` | players, bots, projectiles | velocity (Vector3), grounded |
| `health` | players, bots | current, max |
| `weapon` | players | magazine, magazineSize, reserve, damage, fireRateMs, reloadMs, lastShotAt, reloading, reloadStartedAt, range |
| `backpack` | players | capacityKg, weightKg, items[], pendingScore |
| `player` | players | name, color, isLocal, squadId, netId |
| `bot` | bots | kind, state, targetId, patrolPath, scoreReward |
| `loot` | loot pickups | rarity, weightKg, points, itemId |
| `ammoCrate` | ammo pickups | rounds, weightKg |
| `medkit` | medkit pickups | heal, weightKg |
| `shelter` | shelter zones | shelterId, isOpen, opensAt, closesAt, position |
| `net` | networked entities | netId, lastSyncAt, authoritative |

## Tag reference

`player`, `localPlayer`, `remotePlayer`, `bot`, `boss`, `loot`, `pickup`, `shelter`, `projectile`, `alive`, `dead`, `hostile`, `friendly`.

## Event bus

Typed events on `World`. Producers `world.emit('damage', { ... })`, consumers `world.on('damage', h)`. See `core/types.ts` for the full `EventMap`. Events: `entity:spawn`, `entity:despawn`, `damage`, `death`, `loot:pickup`, `extract:start`, `extract:complete`, `announce`, `shoot`, `hit`.

## Network model

Client-authoritative. Each client sends its own state to the PartyKit room; the room broadcasts. Bots are simulated on the room itself (single source of truth) so all clients see the same drone shoot the same player. Damage is reconciled on the room.

This is jam-grade: cheating exists in theory, no one cares. We trade robustness for shipping in 48 hours.

### Sync schema (preliminary)

Client → Room:
- `hello` { name, color, mode }
- `input` { pos, rot, vel, shooting, reloading } @ 20 Hz
- `shoot` { origin, dir, weaponId } (event)
- `pickup` { lootNetId } (request)
- `extract` { shelterId } (request)

Room → Clients:
- `state` { players[], bots[], loot[], shelters[], events[] } @ 10 Hz
- `announce` { message, ttl }
- `score` { entityId, delta, reason }
- `leaderboard` { rows: [{name, score}] }

## Performance budget

- 60 FPS on mid-range laptop (integrated GPU acceptable)
- Draw distance: 380 m baseline, fog kicks in earlier per atmosphere phase
- InstancedMesh for repeated geometry (rubble, debris, trees, rocks)
- ~25 dynamic PointLights total across the world (interior + fires + observatory + shelters)
- Total payload < 5 MB (currently 154 KB gzipped — no 3D assets, procedural geometry only)
- Production build: no debug panel (tree-shaken via `import.meta.env.DEV`)
- Post-processing on by default; can be toggled off per-frame for low-end devices

## Subagent strategy

Independent modules get spun out as subagents with a clear contract:
- Input: project rules, target file paths, public API contract
- Output: implemented files + brief description of what was built
- Constraint: only writes inside its assigned module folder
- Integration: glue happens in main context after the subagent returns

Used so far for: original `world/city.ts`, `world/portals.ts`, `partykit/server.ts` + `net/*`, the full `world/biomes/*` + `world/map.ts` + `world/heightmap.ts` rebuild.

Glue (entry point, lobby, scene wiring, system registration, post-processing wiring) stays in main context.
