// Browser-side wrapper around partysocket.
// Auto-reconnects, dispatches typed ServerMessage payloads to the right callback.

import PartySocket from 'partysocket';

import {
  decodeMsg,
  encodeMsg,
  type ClientMessage,
  type RoomSnapshot,
  type ServerEvent,
  type ServerMessage,
} from './protocol';

export interface NetClientOptions {
  /** Room id (e.g. a 6-digit lobby code). */
  room: string;
  /** Optional override for the page host. */
  host?: string;
  /** Override for the partykit host. Defaults to `location.host`. */
  partyHost?: string;
  onWelcome?(m: Extract<ServerMessage, { type: 'welcome' }>): void;
  onState?(snapshot: RoomSnapshot, events?: ServerEvent[]): void;
  onAnnounce?(text: string, ttlMs: number): void;
  onScore?(entityId: string, delta: number, reason: string): void;
  onLeaderboard?(rows: { name: string; score: number }[]): void;
  onKicked?(reason: string): void;
  onEvent?(e: ServerEvent): void;
  onOpen?(): void;
  onClose?(): void;
}

export interface NetClient {
  send(m: ClientMessage): void;
  close(): void;
  readonly connected: boolean;
}

export function createNetClient(opts: NetClientOptions): NetClient {
  const host =
    opts.partyHost ??
    opts.host ??
    (typeof location !== 'undefined' ? location.host : 'localhost:1999');

  const socket = new PartySocket({
    host,
    room: opts.room,
    // partysocket handles reconnect by default; tune the backoff for snappier dev UX.
    minUptime: 1000,
  });

  let isOpen = false;

  socket.addEventListener('open', () => {
    isOpen = true;
    opts.onOpen?.();
  });

  socket.addEventListener('close', () => {
    isOpen = false;
    opts.onClose?.();
    // partysocket reconnects automatically; nothing else to do here.
  });

  socket.addEventListener('message', (ev: MessageEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : '';
    if (!data) return;
    const msg = decodeMsg<ServerMessage>(data);
    if (!msg) return;

    switch (msg.type) {
      case 'welcome':
        opts.onWelcome?.(msg);
        break;
      case 'state':
        opts.onState?.(msg.snapshot, msg.events);
        if (msg.events && opts.onEvent) {
          for (const e of msg.events) opts.onEvent(e);
        }
        break;
      case 'announce':
        opts.onAnnounce?.(msg.message, msg.ttlMs);
        break;
      case 'score':
        opts.onScore?.(msg.entityId, msg.delta, msg.reason);
        break;
      case 'leaderboard':
        opts.onLeaderboard?.(msg.rows);
        break;
      case 'kicked':
        opts.onKicked?.(msg.reason);
        break;
    }
  });

  return {
    send(m: ClientMessage) {
      if (!isOpen) return;
      socket.send(encodeMsg(m));
    },
    close() {
      socket.close();
    },
    get connected() {
      return isOpen;
    },
  };
}
