// Shared network protocol — used by both the browser client and the PartyKit room.
// Keep this file dependency-free so it imports cleanly on Cloudflare Workers and the browser.

export type Vec3 = [number, number, number];

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

export type ClientMessage =
  | { type: 'hello'; name: string; color: number }
  | { type: 'input'; pos: Vec3; rot: Vec3 };

export type ServerMessage =
  | { type: 'welcome'; selfId: string; room: string; snapshot: RoomSnapshot }
  | { type: 'state'; snapshot: RoomSnapshot }
  | { type: 'kicked'; reason: string };

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
