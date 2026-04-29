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
├── world/         Procedural city, shelters, lighting, sky, fog, portals
├── entities/      Factories: createPlayer, createBot, createLoot, ...
├── systems/       Per-frame logic: movement, combat, ai, loot, extraction
├── net/           PartyKit client + room schemas + sync
├── ui/            Lobby, HUD, leaderboard, announcements (DOM/CSS)
├── audio/         Web Audio context + sound bank
└── main.ts        Bootstrap: build world, register systems, run loop
```

**Rules:**
- `core/` knows about nothing else.
- `entities/` builds Three.js meshes + attaches components, returns an `Entity`. Pure factories — they don't subscribe to events.
- `systems/` only touch entities through `World.query` and `World.emit`. They don't reach into other systems.
- `ui/` reacts to events from `World`. UI never mutates game state directly — it sends intents through events.
- `net/` translates between local entities and remote messages. It owns `netId`s.

## Component reference

| Component | Owners | Fields |
|---|---|---|
| `transform` | players, bots, projectiles | velocity, grounded |
| `health` | players, bots | current, max |
| `weapon` | players | mag, magSize, reserve, damage, fireRateMs, reloadMs, range |
| `backpack` | players | capacityKg, weightKg, items[], pendingScore |
| `player` | players | name, color, isLocal, squadId, netId |
| `bot` | bots | kind, state, targetId, patrolPath, scoreReward |
| `loot` | loot pickups | rarity, weightKg, points, itemId |
| `ammoCrate` | ammo pickups | rounds, weightKg |
| `medkit` | medkit pickups | heal, weightKg |
| `shelter` | shelter zones | shelterId, isOpen, opensAt, closesAt |
| `net` | networked entities | netId, lastSyncAt, authoritative |

## Tag reference

`player`, `localPlayer`, `remotePlayer`, `bot`, `boss`, `loot`, `pickup`, `shelter`, `projectile`, `alive`, `dead`, `hostile`, `friendly`.

## Event bus

Typed events on `World`. Producers `world.emit('damage', { ... })`, consumers `world.on('damage', h)`. See `core/types.ts` for the full `EventMap`.

Use events for cross-module communication. **Never** import a system from another system; talk through events.

## Network model

Client-authoritative. Each client sends its own state to the PartyKit room; the room broadcasts. Bots are simulated on the room itself (single source of truth) so all clients see the same drone shoot the same player. Damage is reconciled on the room.

This is jam-grade: cheating exists in theory, no one cares. We trade robustness for shipping in 48 hours.

## Sync schema (preliminary)

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

- 60 FPS target on mid-range laptop (integrated GPU acceptable)
- Draw distance: 200m, fog from 80m
- Instanced meshes for repeated geometry (rubble, debris, building blocks)
- One ambient + ≤6 dynamic lights, baked-feel via emissive materials
- Total payload < 5 MB (no 3D assets — procedural geometry only; small audio samples)

## Subagent strategy

Independent modules get spun out as subagents with a clear contract:
- Input: world API, component definitions, target file path
- Output: implemented file + brief description of public API
- Constraint: only writes inside its assigned module folder

Used for: `world/city.ts`, `systems/ai.ts`, `net/room.ts` (server side), `world/portals.ts`.

Glue (entry point, lobby, scene setup, integration) stays in main context.
