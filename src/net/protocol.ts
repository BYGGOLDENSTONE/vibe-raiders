// Shared network protocol — used by both the browser client and the PartyKit room.
// Keep this file dependency-free so it imports cleanly on Cloudflare Workers and the browser.

export type Vec3 = [number, number, number];
export type Mode = 'pve' | 'pvp';
export type BotKind = 'drone' | 'sentry' | 'hunter';

// ---------- Authoritative state shapes (server -> clients) ----------

export interface PlayerState {
  id: string;
  name: string;
  color: number;
  pos: Vec3;
  rot: Vec3;
  vel: Vec3;
  hp: number;
  score: number;
  alive: boolean;
  squadId: string | null;
  mode: Mode;
}

export interface BotState {
  id: string;
  kind: BotKind;
  pos: Vec3;
  rot: number;
  hp: number;
  targetId: string | null;
}

export interface ShelterState {
  id: string;
  isOpen: boolean;
  opensAt: number;
  closesAt: number;
}

export interface RoomSnapshot {
  tick: number;
  serverTime: number;
  players: PlayerState[];
  bots: BotState[];
  shelters: ShelterState[];
}

// ---------- Server-emitted spotty events ----------

export type ServerEvent =
  | { type: 'playerHit'; src: string; tgt: string; point: Vec3 }
  | { type: 'botKilled'; botId: string; byId: string; reward: number }
  | { type: 'playerKilled'; tgt: string; by: string }
  | { type: 'lootSpawned'; lootNetId: string; pos: Vec3; rarity: string; itemId: string }
  | { type: 'lootPicked'; lootNetId: string; byId: string };

// ---------- Client -> Server messages ----------

export type ClientMessage =
  | {
      type: 'hello';
      name: string;
      color: number;
      mode: Mode;
      squadId?: string | null;
    }
  | {
      type: 'input';
      pos: Vec3;
      rot: Vec3;
      vel: Vec3;
      sprint: boolean;
      crouch: boolean;
      shooting: boolean;
      reloading: boolean;
    }
  | {
      type: 'shoot';
      origin: Vec3;
      dir: Vec3;
      weaponId: string;
    }
  | { type: 'pickup'; lootNetId: string }
  | { type: 'extract'; shelterId: string }
  | { type: 'chat'; text: string };

// ---------- Server -> Client messages ----------

export type ServerMessage =
  | { type: 'welcome'; selfId: string; room: string; snapshot: RoomSnapshot }
  | { type: 'state'; snapshot: RoomSnapshot; events?: ServerEvent[] }
  | { type: 'announce'; message: string; ttlMs: number }
  | { type: 'score'; entityId: string; delta: number; reason: string }
  | { type: 'leaderboard'; rows: { name: string; score: number }[] }
  | { type: 'kicked'; reason: string };

// ---------- Helpers ----------

export function encodeMsg(m: ClientMessage | ServerMessage): string {
  return JSON.stringify(m);
}

export function decodeMsg<T extends ClientMessage | ServerMessage>(s: string): T | null {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === 'object' && 'type' in (parsed as Record<string, unknown>)) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}
