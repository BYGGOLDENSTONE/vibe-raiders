// Shared network protocol — used by both the browser client and the PartyKit room.
// Keep this file dependency-free of Three.js / DOM globals so it imports cleanly
// on Cloudflare Workers and the browser. Imports from `src/game/economy/types.ts`
// are allowed because that module is also dep-free.

import type {
  EmpireSnapshot,
  GalacticEvent,
  LeaderboardEntry,
  PlanetState,
  RouteDef,
  ShipTrajectory,
  ResourceId,
} from '../game/economy/types';

export type Vec3 = [number, number, number];

// ---------- Legacy presence (existing scaffold, used by ghosts) ----------

export interface PlayerState {
  id: string;
  name: string;
  color: number;
  pos: Vec3;
  rot: Vec3;
}

export interface RoomSnapshot {
  tick: number;
  serverTime: number;
  players: PlayerState[];
}

// ---------- Three logical channels (locked at Wave 0) ----------
//
// 1. Tick channel    — lossy, ~10 Hz, avatar position only. (Existing `input` covers this for Wave 0.)
// 2. Event channel   — reliable, sparse. All empire mutations + game events.
// 3. Snapshot channel — on-demand. `welcome` after connect, `resync` after reconnect.

// ----- Game events (event channel) -----

export interface BaseGameEvent {
  eventId: number;
  timestamp: number;        // server Date.now()
}

export type GameEvent = BaseGameEvent & (
  | { type: 'planet:upgraded'; playerId: string; planetId: string; level: number; cityIntensity: number }
  | { type: 'planet:unlocked'; playerId: string; planetId: string }
  | { type: 'planet:claimed'; playerId: string; planetId: string }
  | { type: 'planet:specialized'; playerId: string; planetId: string; specialization: string }
  | { type: 'building:placed'; playerId: string; planetId: string; buildingId: string }
  | { type: 'route:created'; route: RouteDef }
  | { type: 'route:upgraded'; routeId: string; level: number }
  | { type: 'route:dissolved'; routeId: string }
  | { type: 'route:proposed'; fromPlayerId: string; toPlayerId: string; proposalId: string; fromPlanetId: string; toPlanetId: string }
  | { type: 'route:accepted'; proposalId: string }
  | { type: 'route:rejected'; proposalId: string }
  | { type: 'route:delivered'; routeId: string; payload: number; resource: ResourceId; ownerId: string }
  | { type: 'ship:launched'; ship: ShipTrajectory }
  | { type: 'cargo:gifted'; fromId: string; toId: string; value: number }
  | { type: 'galactic:event'; event: GalacticEvent }
  | { type: 'galactic:demand'; demand: { credits: number; ore: number; capital: number; alloy: number; data: number; expiresAtMs: number } }
  | { type: 'player:joined'; playerId: string; sectorId: number; name: string; color: number }
  | { type: 'player:disconnected'; playerId: string }
  | { type: 'player:left'; playerId: string }
  | { type: 'empire:snapshot'; empire: EmpireSnapshot }
  | { type: 'empire:planetState'; playerId: string; planetId: string; state: PlanetState }
  | { type: 'leaderboard'; entries: LeaderboardEntry[] }
);

export type GameEventType = GameEvent['type'];

// ----- Snapshot channel -----

export interface WelcomePayload {
  type: 'welcome';
  selfId: string;
  room: string;
  // Legacy snapshot, kept for backward-compat with the existing ghost renderer.
  snapshot: RoomSnapshot;
  // Game-economy snapshot, populated once Wave 1+ comes online.
  // Made optional so the existing scaffold keeps building during Wave 0.
  game?: {
    seed: number;
    serverTimeMs: number;
    yourSectorId: number;
    empires: EmpireSnapshot[];
    shipsInFlight: ShipTrajectory[];
    activeGalacticEvents: GalacticEvent[];
    lastEventId: number;
  };
}

// ----- Client → Server -----

export type ClientMessage =
  // Legacy presence (kept for current ghost system).
  | { type: 'hello'; name: string; color: number }
  | { type: 'input'; pos: Vec3; rot: Vec3 }
  // New game/event channel.
  | { type: 'event'; event: GameEvent }
  // Cross-player route flow.
  | { type: 'route:propose'; toPlayerId: string; fromPlanetId: string; toPlanetId: string }
  | { type: 'route:respond'; proposalId: string; accept: boolean }
  // Trade gift.
  | { type: 'gift'; toPlayerId: string; value: number }
  // Time sync (Cristian's algorithm).
  | { type: 'ping'; t0: number }
  // Reconnect / replay.
  | { type: 'resync'; lastEventId: number };

// ----- Server → Client -----

export type ServerMessage =
  | WelcomePayload
  | { type: 'state'; snapshot: RoomSnapshot }
  | { type: 'kicked'; reason: string }
  | { type: 'event'; event: GameEvent }
  | { type: 'pong'; t0: number; tServer: number }
  | { type: 'correction'; reason: string; empire?: EmpireSnapshot };

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
