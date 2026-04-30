# Portal Empires — Multiplayer & Economy Architecture

This is the engineering doc that locks the wow factor. The headline goal: **16 players sharing one visible galaxy in one browser tab, instant load, no perceptible network lag, zero per-frame ship sync**. Every decision below serves that.

The whole game runs on a single PartyKit room (`hub-1`) backed by a Cloudflare Durable Object.

## Server philosophy

PartyKit relay is a **shared-state authority + event log**, not a full simulation server.

- The server owns **galaxy seed** (rare write), **per-player empire snapshots** (mutated on player action), and **a ring buffer of recent events** (used for late-joiner replay).
- The server **never simulates cargo ships**. Trajectories are broadcast once at launch; clients compute positions locally.
- The server **clamps** client-reported values for lazy anti-cheat.

## State model — three tiers

The single most important architectural decision. Wrong tiering = bandwidth disaster. Right tiering = it just works.

| Tier | Mutation rate | Authority | Channel |
|------|---------------|-----------|---------|
| **A — Galaxy seed** | Once per room lifetime | Server (DO `room.storage`) | Sent in `welcome` only |
| **B — Empire state** (planet ownership, levels, resources, route definitions, avatar pos/rot) | Seconds → minutes (mutations); 10 Hz (avatar) | Client-authoritative, server clamps & rebroadcasts | Event-driven deltas + 10 Hz avatar tick |
| **C — Cargo ships in flight** | Visually every frame | Computed locally from a single launch event | One `ship:launched` event, **never** per-frame data |

**Tier A — Galaxy seed.** The DO picks `seed: number` on first boot, persists via `room.storage.put('seed', seed)`. All clients pass it into the same procedural generator and produce identical 100-planet layouts, sector boundaries, planet kinds, and names. Zero per-tick bandwidth.

**Tier B — Empire state.** One JSON snapshot per player kept in DO memory:
```ts
interface EmpireSnapshot {
  playerId: string;
  name: string;
  color: number;       // hex
  sectorId: number;
  planets: { id: string; level: number; cityIntensity: number }[];
  routes: { id: string; from: string; to: string; level: number; partnerId?: string }[];
  resources: { credits: number; ore: number };
  lifetime: { credits: number; ore: number };
  empireValue: number;
  dormant: boolean;
  lastUpdate: number;  // server time
}
```
Diffed and rebroadcast only when the owning client emits a mutation event.

**Tier C — Cargo ships.** Every ship launch emits ONE small event. Every client renders the ship locally from the trajectory. **This is the bandwidth win that makes the game feel impossibly cheap.**

## Three logical channels over one WebSocket

All on one socket, distinguished by `type`. (PartyKit gives you exactly one socket per connection.)

### 1. Tick channel (lossy, 10 Hz, full-replace)

Avatar position/rotation only. Quantized:
```ts
type AvatarTick = {
  type: 'tick';
  seq: number;          // monotonic per client
  px: number;           // int16, position * 100
  py: number;
  pz: number;
  ry: number;           // int16, rotation Y * 1000
};
```
~16 bytes payload. No ack. Out-of-order packets dropped via `seq`.

### 2. Event channel (reliable, sparse)

All empire mutations and gameplay events. Append-only with monotonic `eventId`. Server keeps a ring buffer of the last 256 events.

```ts
type GameEvent =
  | { type: 'planet:upgraded'; eventId: number; playerId: string; planetId: string; level: number; cityIntensity: number }
  | { type: 'planet:unlocked'; eventId: number; playerId: string; planetId: string }
  | { type: 'planet:claimed';  eventId: number; playerId: string; planetId: string }   // neutral planet
  | { type: 'route:created';   eventId: number; route: RouteDef }
  | { type: 'route:upgraded';  eventId: number; routeId: string; level: number }
  | { type: 'route:dissolved'; eventId: number; routeId: string }
  | { type: 'route:proposed';  eventId: number; fromPlayerId: string; toPlayerId: string; proposalId: string; ... }
  | { type: 'route:accepted';  eventId: number; proposalId: string }
  | { type: 'route:rejected';  eventId: number; proposalId: string }
  | { type: 'ship:launched';   eventId: number; ship: ShipTrajectory }
  | { type: 'cargo:gifted';    eventId: number; fromId: string; toId: string; value: number }
  | { type: 'galactic:event';  eventId: number; kind: 'storm' | 'boom' | 'flare'; sectorId: number; durationMs: number }
  | { type: 'player:disconnected'; eventId: number; playerId: string }
  | { type: 'player:left';     eventId: number; playerId: string }
  | { type: 'leaderboard';     eventId: number; entries: LeaderboardEntry[] };  // 0.5 Hz coalesced
```

### 3. Snapshot channel (on-demand)

Full state, sent only on connect or explicit `resync`:

```ts
type Welcome = {
  type: 'welcome';
  serverTimeMs: number;
  seed: number;
  yourPlayerId: string;
  yourSectorId: number;
  empires: EmpireSnapshot[];
  shipsInFlight: ShipTrajectory[];   // only ships whose t<1
  activeGalacticEvents: GalacticEvent[];
  lastEventId: number;
};
```

## Trajectory broadcast (the cargo-ship trick)

Every cargo ship is described by a single event. Every client computes its position locally each frame.

```ts
interface ShipTrajectory {
  shipId: string;        // ULID
  ownerId: string;
  routeId: string;
  fromPlanetId: string;
  toPlanetId: string;
  departTimeMs: number;  // shared clock domain (see § Time sync)
  durationMs: number;
  arcSeed: number;       // determines control-point offset for non-collinear arcs
  payload: number;       // resource amount
}
```

Per frame on every client:
```ts
const t = clamp01((now() - ship.departTimeMs) / ship.durationMs);
const pos = bezier3(fromPos, ctrl(arcSeed), toPos, t);
```
When `t >= 1`:
- The **owner's client** fires the actual resource transfer (+credits, +ore) and emits a `route:delivered` event for the leaderboard/event-feed channel.
- All other clients just despawn the visual.

500 ships in flight → zero ongoing bandwidth.

### Failure modes

| Failure | Mitigation |
|---------|------------|
| Clock drift (~200 ms worst-case across regions) | Sync once on connect (§ Time sync). 200 ms drift on a 30-s ship trip is ~0.7% position error — invisible. |
| Late joiner missed launch event | `welcome` includes `shipsInFlight` (ships with `t<1`). |
| Lost message during reconnect | Event log replay since `lastEventId`. WebSocket itself is reliable. |
| Owner disconnects mid-flight | Keep ship visible until `departTimeMs + durationMs + 5s grace`, then despawn. Owner's resource is credited on their next reconnect by replaying `route:delivered` events from the log. |
| Visual arrival slightly off across clients | Acceptable. Resource transfer fires owner-side only; visual timing is cosmetic. |

## Time synchronization

PartyKit has no built-in `serverTime`. We implement Cristian's algorithm — ample precision for galaxy-scale visuals.

```ts
// On connect, run 5 pings 200ms apart. Take median offset.
const t0 = performance.now();
ws.send({ type: 'ping', t0 });
// server returns: { type: 'pong', t0, tServer: Date.now() }
// on receive:
const t1 = performance.now();
const offset = tServer + (t1 - t0) / 2 - t1;
// shared time: now() = performance.now() + offset
```

Re-run every 60 s. Expected accuracy: ±20 ms broadband, ±100 ms bad mobile. Both invisible.

**Use `performance.now() + offset` everywhere.** Never `Date.now()` for timing — the user's OS clock can jump.

## Late-joiner handshake

```ts
// In partykit/server.ts
async onConnect(conn, ctx) {
  const playerId = ulid();
  const sectorId = this.assignSector();
  const empire = this.createOrRehydrateEmpire(playerId, sectorId);

  conn.setState({ playerId, name: '?', color: 0 });

  conn.send({
    type: 'welcome',
    serverTimeMs: Date.now(),
    seed: this.seed,
    yourPlayerId: playerId,
    yourSectorId: sectorId,
    empires: [...this.empires.values()],
    shipsInFlight: this.activeShips(),
    activeGalacticEvents: this.activeEvents(),
    lastEventId: this.eventLog.head,
  });

  this.broadcast({ type: 'player:joined', playerId, sectorId, ... }, [playerId]);
}
```

Client steps to avoid flicker:
1. Show "Connecting…" overlay immediately on page load.
2. On `welcome`, build all 100 planets + 16 empires + ships-in-flight in a single frame (Three.js builds 100 simple meshes in <30 ms).
3. Drop overlay only after one full `requestAnimationFrame` has rendered the populated scene.

**Reconnect:** client persists `lastEventId` in memory. On reconnect, sends `{ type: 'resync', lastEventId }`. Server replays events from the ring buffer; if the client is further behind than the buffer, sends a fresh `welcome`. Same code path.

## Validation / clamping (lazy anti-cheat)

Goal: stop a curious devtools user from breaking the leaderboard. Not real anti-cheat.

Server in `onMessage`:

- **Schema validation** — hand-written validator per message type. Reject bad shapes silently.
- **Rate limit per connection**:
  - Tick channel: ≤ 15 msg/s.
  - Event channel: ≤ 30 msg/s.
- **Value caps** (`LIMITS` table, single source of truth):
  - `empireValue`: 0 to 1e15.
  - `creditsPerSecond`: 0 to 1e12.
  - `planets owned`: 0 to 10.
  - `routes`: 0 to 30.
  - Per-upgrade level ≤ defined max.
  - Ship `durationMs` ≥ `euclideanDistance(from, to) / MAX_SHIP_SPEED`.
- **Suspicious-delta**: if reported `lifetime.credits` jumps by `> expectedRate * elapsedSec * 2`, snap back to last accepted and broadcast a `correction` event.
- **Timestamp sanity**: client `departTimeMs` must be within ±2 s of server `Date.now()`.
- **Cross-player route consent**: server enforces that `route:created` (cross-player) follows a matching `route:proposed` + `route:accepted` pair from the right two players.

All caps in one `LIMITS` constant so balance changes don't churn the validator.

## Cross-player route flow (server-mediated)

1. Player A sends `{ type: 'route:propose', toPlayerId: B, fromPlanetId, toPlanetId, terms }`.
2. Server validates: A owns `fromPlanetId`, B owns `toPlanetId`, A pays setup cost (server clamps).
3. Server emits `route:proposed` with a `proposalId`. A's UI shows "Pending"; B's UI shows a notification.
4. B sends `{ type: 'route:respond', proposalId, accept: true }`.
5. Server emits `route:accepted` (or rejected). On accept, server emits `route:created` with the bilateral route definition and deducts setup costs from both clients (clamped).
6. Both clients now spawn ships periodically along the route. Each `ship:launched` event includes `ownerId` (the planet that produced the cargo); on arrival, the owner credits resources to the **destination owner's** account (split per route terms — typically 60% receiver / 40% sender).

Proposals expire after 60 s if unanswered. Rejected proposals refund.

## Soft-presence on disconnect

When a player tab-closes, do NOT vanish their stuff.

```ts
async onClose(conn) {
  const playerId = conn.state.playerId;
  const empire = this.empires.get(playerId);
  if (!empire) return;
  empire.dormant = true;
  this.broadcast({ type: 'player:disconnected', eventId: this.nextEventId(), playerId });
  await this.storage.setAlarm(Date.now() + 60_000);
  this.pendingEvictions.set(playerId, alarmId);
}

async onAlarm() {
  for (const [playerId, _] of this.pendingEvictions) {
    const empire = this.empires.get(playerId);
    if (!empire?.dormant) continue;
    // Optionally: convert empire planets to neutral/abandoned (stretch).
    this.broadcast({ type: 'player:left', eventId: this.nextEventId(), playerId });
    await this.storage.put(`empire:${playerId}`, empire); // persist final
    this.empires.delete(playerId);
    this.pendingEvictions.delete(playerId);
  }
}
```

UX: dormant empires render desaturated and slightly dimmed in 3D. Their cargo ships stop launching but in-flight ships finish their trips. After 60 s grace, sector becomes claimable (stretch feature) or just persists as "abandoned."

## Persistence

- **DO memory** holds live state. **`room.storage`** persists empire snapshots, debounced to ~5 s after each mutation, so a hibernation/eviction doesn't lose progress.
- **localStorage** on the client holds personal display name + color preference + last-known empire snapshot for visual warm-start before `welcome` arrives.
- No login. Identity is `playerId` (server-issued ULID) + display name (client-chosen). Reconnect loses the playerId on full close — that's fine for a jam.

Save fields locally:
- Display name, color.
- Last welcome's `yourPlayerId` (for fast reconnect attempt — server may have evicted).
- Last empire snapshot (visual warm-start; server reconciles on connect).

## Bandwidth budget

For 16 clients:
- Tick channel: 16 × 10 Hz × ~32 bytes = **5.1 KB/s inbound**, fanout 76 KB/s outbound. Free for outbound.
- Event channel: bursty during upgrades, ~1–10 events/s peak. Each event ≤ ~256 bytes. Negligible.
- Snapshot channel: ~10–20 KB per `welcome`. Once per join.

Worst case sustained inbound: ~80 msg/s × ~50 bytes = **4 KB/s aggregate** to the DO. Cloudflare DO soft cap is 1000 req/s and you're orders of magnitude under it.

PartyKit/CF specifics (current as of 2026):
- Inbound WebSocket message size limit: 32 MiB (raised 2025-10-31).
- Inbound billed at 20:1 against the request meter. Outbound free.
- Per-DO request soft cap: 1000 req/s.
- WebSocket Hibernation: **disable for `hub-1`**. With 10 Hz avatar ticks the room stays warm anyway, and disabling hibernation means we never have to rehydrate state from `room.storage` on cold-from-hibernation wake.

## PartyKit footguns to design around

1. **Sending raw floats as JSON.** `0.30000000000000004` is 19 wire bytes. Quantize to int16 (`Math.round(x * 100)`) before send. For event payloads JSON is fine because they're rare; for the tick channel always quantize.
2. **Unbounded event log.** Ring buffer must be a **fixed 256 entries**. A late-joiner whose `lastEventId` is older than the buffer head gets a fresh `welcome` instead of replay. Without a cap an idle 8-hour room balloons memory until eviction.
3. **`room.broadcast` in a hot loop.** Don't call `broadcast` 500× for 500 ship updates per tick. Coalesce — at most one broadcast per logical event, and use the leaderboard channel's 0.5 Hz coalesced cadence for status digests.
4. **Trusting client timestamps for scoring.** Anything that affects leaderboard rank uses server `Date.now()`. Client times are for visuals only.
5. **Hibernation surprise.** If hibernation is on (don't enable it), `onStart` re-fires after every wake and `this.empires` is gone unless rehydrated from `storage`. **Disable hibernation for this room** to avoid the foot.
6. **Cold-start latency.** First connection to a fresh DO: ~50–150 ms. Hide behind "Connecting…" overlay. Subsequent connections to the same warm room: instant.
7. **Single-region DO placement.** The DO lives at one CF PoP near the first connector. ~250 ms RTT worst-case for a player on the opposite side of the planet. Avatar interpolation hides this; trajectory-broadcast cargo is region-independent.
8. **`connection.setState()` is capped at 2 KB.** Use only for `playerId`, name, color. The empire snapshot lives in `this.empires`, not in conn state.

## Local module layout

`src/game/economy/`:
- `types.ts` — Resource, Planet, Route, Upgrade, Ship types.
- `state.ts` — local empire state + save/load helpers.
- `balance.ts` — resource names, upgrade defs, planet kind defs, LIMITS constants (mirrors server).
- `system.ts` — per-frame production tick, route delivery checks (owner-only), ship spawn timing.
- `selectors.ts` — derived: empireValue, per-second rates, milestone progress.
- `seed.ts` — deterministic galaxy generator (planets, names, sectors, neutral assignments).

`src/game/galaxy/`:
- `scene.ts` — root group; instantiates planets, routes, ships, wormhole, nebula, starfield.
- `planet.ts` — PlanetMesh class (procedural shader + atmosphere shell + city-light uniform).
- `routes.ts` — internal + cross-player route tubes with energy-flow shader.
- `ships.ts` — InstancedMesh swarm; per-frame matrix update from trajectories.
- `wormhole.ts` — portal mesh + shader.
- `nebula.ts` — backside sphere shader.
- `materials.ts` — shared shader material factories.

`src/game/multiplayer/`:
- `connection.ts` — WebSocket lifecycle, time sync, welcome handler.
- `events.ts` — event bus mapping server events to local `world.emit` calls.
- `replication.ts` — applies remote empire deltas to local mirror.
- `proposals.ts` — cross-player route proposal/response state machine.

`src/game/ui/`:
- `hud.ts`, `resources.ts`, `planets.ts`, `routes.ts`, `upgrades.ts`, `leaderboard.ts`, `events.ts`, `milestone.ts`, `proposals.ts`, `galacticMap.ts`.

## EventMap additions (locked at Wave 0)

Add to `src/core/types.ts` upfront:

```ts
'galaxy:seedSet'
'galaxy:planetUpdated'
'economy:resourceChanged'
'economy:upgradeBought'
'economy:planetUnlocked'
'economy:planetClaimed'
'economy:routeCreated'
'economy:routeUpgraded'
'economy:routeDissolved'
'economy:routeDelivered'
'economy:saveLoaded'
'multiplayer:welcome'
'multiplayer:empireUpdated'
'multiplayer:empireDormant'
'multiplayer:empireLeft'
'multiplayer:proposalReceived'
'multiplayer:proposalResolved'
'multiplayer:leaderboard'
'multiplayer:tradeGiftReceived'
'multiplayer:galacticEvent'
'multiplayer:shipLaunched'
'ui:event'
'ui:milestoneCompleted'
```

Keep payloads small and serializable.

## Balance formulas (starting point — tune in Wave 6)

- Upgrade cost: `baseCost * pow(1.45, level)`.
- Production: `baseProduction * (1 + level * 0.25) * globalMultiplier`.
- Internal route value/delivery: `(srcLvl + dstLvl) * routeLvl * 10 * cargoMul`.
- Cross-player route value: `1.5x` of equivalent internal route, split 60% receiver / 40% sender.
- Ship `durationMs`: `5000 + euclideanDistance(from, to) * 80 / shipSpeedMul`.
- Cross-player route setup cost: 100 Credits + 50 Ore each side, scaling with both empires' size.
- Galactic event probability: 1 per 5 minutes, weighted (storm 50%, boom 30%, flare 20%).

Don't seek perfect balance on first pass. Tune after Wave 5 once the loop is playable.
