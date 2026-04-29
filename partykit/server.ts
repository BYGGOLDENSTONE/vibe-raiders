// PartyKit room for Vibe Raiders.
// Authoritative-ish: clients drive their own movement; the room owns bots, shelters, and damage reconciliation.
// Runs on Cloudflare Workers — no Node-only APIs.

import type * as Party from 'partykit/server';

import {
  decodeMsg,
  encodeMsg,
  type BotState,
  type ClientMessage,
  type PlayerState,
  type RoomSnapshot,
  type ServerEvent,
  type ServerMessage,
  type ShelterState,
  type Vec3,
} from '../src/net/protocol';

const MAX_PLAYERS = 12;
const BROADCAST_INTERVAL_MS = 100; // 10 Hz
const SHELTER_TICK_MS = 1000; // 1 Hz
const SHELTER_CYCLE_MS = 180_000; // 180 s rotation
const SHELTER_OPEN_MS = 60_000; // 60 s window

const SHELTER_IDS = ['NW', 'NE', 'SW', 'SE'] as const;

function clampNum(n: unknown, min: number, max: number, fallback = 0): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampVec3(v: unknown, lim = 10_000): Vec3 {
  if (Array.isArray(v) && v.length === 3) {
    return [
      clampNum(v[0], -lim, lim),
      clampNum(v[1], -lim, lim),
      clampNum(v[2], -lim, lim),
    ];
  }
  return [0, 0, 0];
}

interface RoomState {
  players: Map<string, PlayerState>;
  bots: BotState[];
  shelters: ShelterState[];
  tickN: number;
  startedAt: number;
  pendingEvents: ServerEvent[];
}

export default class VibeRaidersServer implements Party.Server {
  readonly state: RoomState;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private shelterTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    const now = Date.now();
    this.state = {
      players: new Map(),
      bots: [],
      shelters: SHELTER_IDS.map((id, i) => ({
        id,
        isOpen: false,
        // Stagger so each shelter opens at a different point in the cycle.
        opensAt: now + i * (SHELTER_CYCLE_MS / SHELTER_IDS.length),
        closesAt: now + i * (SHELTER_CYCLE_MS / SHELTER_IDS.length) + SHELTER_OPEN_MS,
      })),
      tickN: 0,
      startedAt: now,
      pendingEvents: [],
    };

    this.broadcastTimer = setInterval(() => this.tickBroadcast(), BROADCAST_INTERVAL_MS);
    this.shelterTimer = setInterval(() => this.tickShelters(), SHELTER_TICK_MS);
  }

  // ---------- lifecycle ----------

  onConnect(conn: Party.Connection): void | Promise<void> {
    if (this.state.players.size >= MAX_PLAYERS) {
      const kicked: ServerMessage = { type: 'kicked', reason: 'full' };
      conn.send(encodeMsg(kicked));
      conn.close();
      return;
    }
    // Player record is created on `hello`; we just keep the socket open here.
  }

  onMessage(rawMessage: string, sender: Party.Connection): void | Promise<void> {
    const msg = decodeMsg<ClientMessage>(rawMessage);
    if (!msg) return;

    switch (msg.type) {
      case 'hello':
        this.handleHello(sender, msg);
        break;
      case 'input':
        this.handleInput(sender, msg);
        break;
      case 'shoot':
        this.handleShoot(sender, msg);
        break;
      case 'pickup':
        console.log(`[room ${this.room.id}] pickup request from ${sender.id} loot=${msg.lootNetId}`);
        break;
      case 'extract':
        console.log(`[room ${this.room.id}] extract request from ${sender.id} shelter=${msg.shelterId}`);
        break;
      case 'chat':
        // Stub: not relayed yet.
        break;
    }
  }

  onClose(conn: Party.Connection): void | Promise<void> {
    if (this.state.players.delete(conn.id)) {
      console.log(`[room ${this.room.id}] player left ${conn.id} (${this.state.players.size} remain)`);
    }
  }

  // ---------- handlers ----------

  private handleHello(
    sender: Party.Connection,
    msg: Extract<ClientMessage, { type: 'hello' }>,
  ): void {
    const player: PlayerState = {
      id: sender.id,
      name: typeof msg.name === 'string' ? msg.name.slice(0, 24) : 'Raider',
      color: clampNum(msg.color, 0, 0xffffff, 0xffffff),
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      vel: [0, 0, 0],
      hp: 100,
      score: 0,
      alive: true,
      squadId: msg.squadId ?? null,
      mode: msg.mode === 'pvp' ? 'pvp' : 'pve',
    };
    this.state.players.set(sender.id, player);

    const welcome: ServerMessage = {
      type: 'welcome',
      selfId: sender.id,
      room: this.room.id,
      snapshot: this.snapshot(),
    };
    sender.send(encodeMsg(welcome));
  }

  private handleInput(
    sender: Party.Connection,
    msg: Extract<ClientMessage, { type: 'input' }>,
  ): void {
    const p = this.state.players.get(sender.id);
    if (!p) return;
    p.pos = clampVec3(msg.pos, 5_000);
    p.rot = clampVec3(msg.rot, Math.PI * 2);
    p.vel = clampVec3(msg.vel, 200);
  }

  private handleShoot(
    sender: Party.Connection,
    msg: Extract<ClientMessage, { type: 'shoot' }>,
  ): void {
    const p = this.state.players.get(sender.id);
    if (!p || !p.alive) return;
    // Broadcast as a hit-less event for now; combat resolution lands later.
    this.state.pendingEvents.push({
      type: 'playerHit',
      src: sender.id,
      tgt: '',
      point: clampVec3(msg.origin, 5_000),
    });
  }

  // ---------- ticks ----------

  private tickBroadcast(): void {
    this.state.tickN += 1;
    const events = this.state.pendingEvents;
    this.state.pendingEvents = [];
    const out: ServerMessage = {
      type: 'state',
      snapshot: this.snapshot(),
      events: events.length > 0 ? events : undefined,
    };
    this.room.broadcast(encodeMsg(out));
  }

  private tickShelters(): void {
    const now = Date.now();
    for (const s of this.state.shelters) {
      if (!s.isOpen && now >= s.opensAt && now < s.closesAt) {
        s.isOpen = true;
      } else if (s.isOpen && now >= s.closesAt) {
        s.isOpen = false;
        // Schedule its next opening one full cycle later.
        s.opensAt += SHELTER_CYCLE_MS;
        s.closesAt = s.opensAt + SHELTER_OPEN_MS;
      }
    }
  }

  private snapshot(): RoomSnapshot {
    return {
      tick: this.state.tickN,
      serverTime: Date.now(),
      players: Array.from(this.state.players.values()),
      bots: this.state.bots,
      shelters: this.state.shelters,
    };
  }
}
