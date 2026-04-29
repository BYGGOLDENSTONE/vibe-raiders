// PartyKit room — generic relay skeleton.
// Clients send `hello` then `input` (position/rotation); room broadcasts a snapshot at 10 Hz.
// Game-specific authority (bots, items, scoring) is layered on top per-game.

import type * as Party from 'partykit/server';

import {
  decodeMsg,
  encodeMsg,
  type ClientMessage,
  type PlayerState,
  type RoomSnapshot,
  type ServerMessage,
  type Vec3,
} from '../src/net/protocol';

const MAX_PLAYERS = 16;
const BROADCAST_INTERVAL_MS = 100; // 10 Hz

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

export default class GameServer implements Party.Server {
  readonly players = new Map<string, PlayerState>();
  private tickN = 0;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    this.broadcastTimer = setInterval(() => this.tickBroadcast(), BROADCAST_INTERVAL_MS);
  }

  onConnect(conn: Party.Connection): void {
    if (this.players.size >= MAX_PLAYERS) {
      conn.send(encodeMsg({ type: 'kicked', reason: 'full' } satisfies ServerMessage));
      conn.close();
    }
  }

  onMessage(raw: string, sender: Party.Connection): void {
    const msg = decodeMsg<ClientMessage>(raw);
    if (!msg) return;

    if (msg.type === 'hello') {
      const player: PlayerState = {
        id: sender.id,
        name: typeof msg.name === 'string' ? msg.name.slice(0, 24) : 'Player',
        color: clampNum(msg.color, 0, 0xffffff, 0xffffff),
        pos: [0, 0, 0],
        rot: [0, 0, 0],
      };
      this.players.set(sender.id, player);
      sender.send(encodeMsg({
        type: 'welcome',
        selfId: sender.id,
        room: this.room.id,
        snapshot: this.snapshot(),
      } satisfies ServerMessage));
      return;
    }

    if (msg.type === 'input') {
      const p = this.players.get(sender.id);
      if (!p) return;
      p.pos = clampVec3(msg.pos, 5_000);
      p.rot = clampVec3(msg.rot, Math.PI * 2);
    }
  }

  onClose(conn: Party.Connection): void {
    this.players.delete(conn.id);
  }

  private tickBroadcast(): void {
    this.tickN += 1;
    this.room.broadcast(encodeMsg({
      type: 'state',
      snapshot: this.snapshot(),
    } satisfies ServerMessage));
  }

  private snapshot(): RoomSnapshot {
    return {
      tick: this.tickN,
      serverTime: Date.now(),
      players: Array.from(this.players.values()),
    };
  }
}
