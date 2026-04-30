// PartyKit room — Portal Empires shared galaxy authority.
//
// Three-tier state model (see docs/MULTIPLAYER_ECONOMY.md):
//   A — Galaxy seed       (server-authored once, persisted in room.storage)
//   B — Empire snapshots  (client-authored, server clamps)
//   C — Cargo ships       (trajectory-broadcast — server only relays the launch event)
//
// Wave 0 lays down the skeleton:
//   - galaxy seed init + persist
//   - empire snapshot map (in DO memory)
//   - 256-entry event ring buffer with monotonic eventId
//   - Cristian time-sync ping/pong handler
//   - sector assignment on connect
//   - backward-compat with the existing hello/input ghost flow
//
// Hibernation is intentionally NOT enabled — the room stays warm with avatar
// ticks at 10 Hz, and disabling hibernation removes a rehydration footgun.

import type * as Party from 'partykit/server';

import {
  decodeMsg,
  encodeMsg,
  type ClientMessage,
  type GameEvent,
  type PlayerState,
  type RoomSnapshot,
  type ServerMessage,
  type Vec3,
  type WelcomePayload,
} from '../src/net/protocol';
import {
  GALAXY,
  LIMITS,
  type EmpireSnapshot,
  type GalacticEvent,
  type ShipTrajectory,
} from '../src/game/economy/types';

const BROADCAST_INTERVAL_MS = 100;       // 10 Hz avatar tick fanout
const EVENT_RING_CAPACITY = 256;
const EVICTION_GRACE_MS = 60_000;        // dormant -> evict
const SEED_STORAGE_KEY = 'galaxySeed';
const EMPIRE_STORAGE_PREFIX = 'empire:';

function clampNum(n: unknown, min: number, max: number, fallback = 0): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampVec3(v: unknown, lim = 10_000): Vec3 {
  if (Array.isArray(v) && v.length === 3) {
    return [clampNum(v[0], -lim, lim), clampNum(v[1], -lim, lim), clampNum(v[2], -lim, lim)];
  }
  return [0, 0, 0];
}

function pickInitialSeed(): number {
  // 31-bit unsigned so it survives JSON / mulberry32 cleanly.
  return (Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

export default class GameServer implements Party.Server {
  // --- Tier A: galaxy ---
  private seed = 0;
  private seedReady = false;

  // --- Tier B: empires + presence ---
  private readonly players = new Map<string, PlayerState>();   // legacy ghost presence
  private readonly empires = new Map<string, EmpireSnapshot>();
  private readonly sectorAssignments = new Map<string, number>(); // playerId -> sectorId
  private readonly takenSectors = new Set<number>();

  // --- Tier C: cargo ships in flight (cleaned by departTime + duration) ---
  private readonly shipsInFlight = new Map<string, ShipTrajectory>();

  // --- Active galactic events ---
  private readonly activeEvents = new Map<string, GalacticEvent>();

  // --- Event log: 256-entry ring buffer ---
  private readonly eventRing: GameEvent[] = [];
  private nextEventId = 1;

  // --- Soft-eviction state ---
  private readonly pendingEvictions = new Map<string, number>(); // playerId -> evictAt

  private tickN = 0;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    this.broadcastTimer = setInterval(() => this.tickBroadcast(), BROADCAST_INTERVAL_MS);
    void this.boot();
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  private async boot(): Promise<void> {
    try {
      const stored = await this.room.storage.get<number>(SEED_STORAGE_KEY);
      if (typeof stored === 'number' && Number.isFinite(stored)) {
        this.seed = stored >>> 0;
      } else {
        this.seed = pickInitialSeed();
        await this.room.storage.put(SEED_STORAGE_KEY, this.seed);
      }
      this.seedReady = true;
      console.log(`[server] galaxy seed = ${this.seed}`);
    } catch (err) {
      // Storage failure is non-fatal in dev; keep a transient seed.
      this.seed = pickInitialSeed();
      this.seedReady = true;
      console.warn('[server] storage.get failed, using transient seed', err);
    }
  }

  onConnect(conn: Party.Connection): void {
    if (this.players.size >= LIMITS.maxRoomPlayers) {
      conn.send(encodeMsg({ type: 'kicked', reason: 'full' } satisfies ServerMessage));
      conn.close();
      return;
    }
    // Note: we don't send `welcome` here — the client must `hello` first so we
    // know name/color. Welcome is sent inside onMessage('hello').
  }

  async onMessage(raw: string, sender: Party.Connection): Promise<void> {
    const msg = decodeMsg<ClientMessage>(raw);
    if (!msg) return;

    switch (msg.type) {
      case 'hello':
        await this.handleHello(msg, sender);
        return;
      case 'input':
        this.handleInput(msg, sender);
        return;
      case 'ping':
        this.handlePing(msg, sender);
        return;
      case 'event':
        this.handleEvent(msg, sender);
        return;
      case 'route:propose':
      case 'route:respond':
      case 'gift':
      case 'resync':
        // Wave 1+ handlers will land here; logged for now to confirm the channel.
        console.log(`[server] (wave-pending) received ${msg.type}`);
        return;
    }
  }

  onClose(conn: Party.Connection): void {
    const p = this.players.get(conn.id);
    if (p) {
      this.players.delete(conn.id);
      const empire = this.empires.get(conn.id);
      if (empire) {
        empire.dormant = true;
        this.appendEvent({ type: 'player:disconnected', playerId: conn.id });
        this.pendingEvictions.set(conn.id, Date.now() + EVICTION_GRACE_MS);
      }
    }
  }

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------

  private async handleHello(
    msg: Extract<ClientMessage, { type: 'hello' }>,
    sender: Party.Connection,
  ): Promise<void> {
    if (!this.seedReady) {
      // Boot still racing storage; spin briefly. In practice this resolves in <50ms.
      await new Promise((r) => setTimeout(r, 30));
    }

    const name = typeof msg.name === 'string' ? msg.name.slice(0, 24) : 'Player';
    const color = clampNum(msg.color, 0, 0xffffff, 0xffffff);

    // Legacy presence record (drives ghost rendering).
    const player: PlayerState = { id: sender.id, name, color, pos: [0, 0, 0], rot: [0, 0, 0] };
    this.players.set(sender.id, player);

    // Empire: rehydrate or create.
    let empire = this.empires.get(sender.id);
    if (!empire) {
      const restored = await this.tryRestoreEmpire(sender.id);
      empire = restored ?? this.createEmpire(sender.id, name, color);
      this.empires.set(sender.id, empire);
    } else {
      // Reconnect: clear dormancy + cancel pending eviction.
      empire.dormant = false;
      empire.name = name;
      empire.color = color;
      this.pendingEvictions.delete(sender.id);
    }

    // Welcome payload: legacy snapshot for ghosts + game snapshot for galaxy.
    const welcome: WelcomePayload = {
      type: 'welcome',
      selfId: sender.id,
      room: this.room.id,
      snapshot: this.legacySnapshot(),
      game: {
        seed: this.seed,
        serverTimeMs: Date.now(),
        yourSectorId: empire.sectorId,
        empires: Array.from(this.empires.values()),
        shipsInFlight: this.activeShips(),
        activeGalacticEvents: Array.from(this.activeEvents.values()),
        lastEventId: this.nextEventId - 1,
      },
    };
    sender.send(encodeMsg(welcome satisfies ServerMessage));

    // Notify others so they can render the new empire/sector tint without
    // waiting for the next legacy snapshot tick.
    this.broadcast({
      type: 'player:joined',
      playerId: sender.id,
      sectorId: empire.sectorId,
      name,
      color,
    });
  }

  private handleInput(
    msg: Extract<ClientMessage, { type: 'input' }>,
    sender: Party.Connection,
  ): void {
    const p = this.players.get(sender.id);
    if (!p) return;
    p.pos = clampVec3(msg.pos, 5_000);
    p.rot = clampVec3(msg.rot, Math.PI * 2);
  }

  private handlePing(
    msg: Extract<ClientMessage, { type: 'ping' }>,
    sender: Party.Connection,
  ): void {
    sender.send(encodeMsg({
      type: 'pong',
      t0: clampNum(msg.t0, 0, Number.MAX_SAFE_INTEGER, 0),
      tServer: Date.now(),
    } satisfies ServerMessage));
  }

  private handleEvent(
    msg: Extract<ClientMessage, { type: 'event' }>,
    sender: Party.Connection,
  ): void {
    // Wave 0: trust + relay. Wave 4 will validate ownership/cost/etc per event type.
    const e = msg.event;
    if (!e || typeof (e as { type?: string }).type !== 'string') return;
    // Tag with server time + monotonic id, then append + broadcast.
    const tagged = { ...e, eventId: this.nextEventId, timestamp: Date.now() } as GameEvent;
    void sender;
    this.appendEvent(tagged);
  }

  // -------------------------------------------------------------------
  // Event ring buffer
  // -------------------------------------------------------------------

  private appendEvent(evt: Omit<GameEvent, 'eventId' | 'timestamp'> | GameEvent): void {
    const tagged: GameEvent = ('eventId' in evt && 'timestamp' in evt)
      ? (evt as GameEvent)
      : ({ ...(evt as Omit<GameEvent, 'eventId' | 'timestamp'>), eventId: this.nextEventId, timestamp: Date.now() } as GameEvent);
    if (tagged.eventId !== this.nextEventId) {
      // Re-tag if caller used a stale id; preserves monotonicity.
      (tagged as { eventId: number }).eventId = this.nextEventId;
    }
    this.nextEventId++;
    this.eventRing.push(tagged);
    if (this.eventRing.length > EVENT_RING_CAPACITY) this.eventRing.shift();
    this.broadcast({ type: 'event', event: tagged });
  }

  private broadcast(msg: ServerMessage | { type: GameEvent['type']; [k: string]: unknown }): void {
    if ((msg as ServerMessage).type === 'event' || (msg as ServerMessage).type === 'welcome'
        || (msg as ServerMessage).type === 'state' || (msg as ServerMessage).type === 'kicked'
        || (msg as ServerMessage).type === 'pong' || (msg as ServerMessage).type === 'correction') {
      this.room.broadcast(encodeMsg(msg as ServerMessage));
      return;
    }
    // Treat as a raw GameEvent to be wrapped + appended.
    this.appendEvent(msg as unknown as GameEvent);
  }

  // -------------------------------------------------------------------
  // Empire helpers
  // -------------------------------------------------------------------

  private async tryRestoreEmpire(playerId: string): Promise<EmpireSnapshot | null> {
    try {
      const stored = await this.room.storage.get<EmpireSnapshot>(EMPIRE_STORAGE_PREFIX + playerId);
      if (stored && typeof stored === 'object') {
        // Reclaim sector slot.
        if (typeof stored.sectorId === 'number') this.takenSectors.add(stored.sectorId);
        return stored;
      }
    } catch (err) {
      console.warn('[server] empire restore failed', err);
    }
    return null;
  }

  private createEmpire(playerId: string, name: string, color: number): EmpireSnapshot {
    const sectorId = this.assignSector();
    this.sectorAssignments.set(playerId, sectorId);
    const now = Date.now();
    const empire: EmpireSnapshot = {
      playerId,
      name,
      color,
      sectorId,
      planets: [],
      routes: [],
      resources: { credits: 0, ore: 0, capital: 0, alloy: 0, data: 0 },
      lifetime: { credits: 0, ore: 0, capital: 0, alloy: 0, data: 0 },
      upgradeLevels: {},
      empireValue: 0,
      dormant: false,
      lastUpdate: now,
    };
    return empire;
  }

  private assignSector(): number {
    // Pick the lowest unused sector index. With 16 cap and 16 sectors this is fine.
    for (let i = 0; i < GALAXY.totalSectors; i++) {
      if (!this.takenSectors.has(i)) {
        this.takenSectors.add(i);
        return i;
      }
    }
    // Defensive: should never happen because of MAX_PLAYERS gate.
    return 0;
  }

  private activeShips(): ShipTrajectory[] {
    const now = Date.now();
    const out: ShipTrajectory[] = [];
    for (const ship of this.shipsInFlight.values()) {
      if (ship.departTimeMs + ship.durationMs > now) out.push(ship);
    }
    // Prune expired.
    for (const [id, ship] of this.shipsInFlight) {
      if (ship.departTimeMs + ship.durationMs + 5000 < now) this.shipsInFlight.delete(id);
    }
    return out;
  }

  // -------------------------------------------------------------------
  // 10 Hz legacy presence broadcast (drives ghost capsules)
  // -------------------------------------------------------------------

  private tickBroadcast(): void {
    this.tickN += 1;
    // Process pending evictions (cheap, runs at 10 Hz).
    const now = Date.now();
    for (const [playerId, evictAt] of this.pendingEvictions) {
      if (evictAt <= now) {
        const empire = this.empires.get(playerId);
        if (empire?.dormant) {
          // Persist final state, drop from memory, free sector.
          void this.room.storage.put(EMPIRE_STORAGE_PREFIX + playerId, empire);
          this.empires.delete(playerId);
          this.takenSectors.delete(empire.sectorId);
          this.sectorAssignments.delete(playerId);
          this.appendEvent({ type: 'player:left', playerId });
        }
        this.pendingEvictions.delete(playerId);
      }
    }

    this.room.broadcast(encodeMsg({
      type: 'state',
      snapshot: this.legacySnapshot(),
    } satisfies ServerMessage));
  }

  private legacySnapshot(): RoomSnapshot {
    return {
      tick: this.tickN,
      serverTime: Date.now(),
      players: Array.from(this.players.values()),
    };
  }
}
