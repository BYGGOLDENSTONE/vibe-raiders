// PartyKit client connection wrapper.
//
// Wraps `partysocket` with:
// - environment-aware host detection (dev vs prod)
// - retry-on-failure with capped attempts (then silently gives up)
// - typed onMessage dispatch via the shared protocol
// - try/catch around every callback so a malformed message can never crash the game
//
// The relay is generic. Anything chat/party-related is layered locally on top.

import PartySocket from 'partysocket';
import { decodeMsg, encodeMsg, type ClientMessage, type ServerMessage } from '../net/protocol';

const ROOM = 'hub-1';
const RETRY_INTERVAL_MS = 5000;
const MAX_RETRIES = 6;

// TODO(deploy): swap this for the real PartyKit deploy URL once partykit deploy lands.
// Format will be something like: 'gamejam.<account>.partykit.dev'.
const PROD_HOST_FALLBACK = 'gamejam.example.partykit.dev';

function pickHost(): string {
  try {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'localhost:1999';
  } catch {
    // SSR / no window — shouldn't happen in this context but be safe.
  }
  return PROD_HOST_FALLBACK;
}

export interface ConnectionEvents {
  onWelcome: (msg: Extract<ServerMessage, { type: 'welcome' }>) => void;
  onState: (msg: Extract<ServerMessage, { type: 'state' }>) => void;
  onKicked: (msg: Extract<ServerMessage, { type: 'kicked' }>) => void;
  onStatus: (status: 'connecting' | 'open' | 'closed' | 'failed') => void;
}

export class Connection {
  private socket: PartySocket | null = null;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private explicitlyClosed = false;
  private readonly events: ConnectionEvents;

  constructor(events: ConnectionEvents) {
    this.events = events;
  }

  connect(): void {
    if (this.destroyed) return;
    this.events.onStatus('connecting');

    let sock: PartySocket;
    try {
      sock = new PartySocket({ host: pickHost(), room: ROOM });
    } catch (err) {
      console.warn('[multiplayer] partysocket construction failed', err);
      this.scheduleRetry();
      return;
    }

    this.socket = sock;

    const safe = <T>(label: string, fn: (arg: T) => void) => (arg: T) => {
      try { fn(arg); } catch (err) { console.warn(`[multiplayer] ${label} handler threw`, err); }
    };

    sock.addEventListener('open', safe('open', () => {
      this.retries = 0;
      this.events.onStatus('open');
    }));

    sock.addEventListener('message', safe<MessageEvent>('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = decodeMsg<ServerMessage>(ev.data);
      if (!msg) return;
      switch (msg.type) {
        case 'welcome': this.events.onWelcome(msg); break;
        case 'state':   this.events.onState(msg); break;
        case 'kicked':  this.events.onKicked(msg); break;
      }
    }));

    sock.addEventListener('close', safe('close', () => {
      this.events.onStatus('closed');
      if (!this.explicitlyClosed && !this.destroyed) this.scheduleRetry();
    }));

    sock.addEventListener('error', safe('error', (ev: Event) => {
      console.warn('[multiplayer] socket error', ev);
      // ReconnectingWebSocket itself reconnects, but partysocket's behavior here
      // can vary; we rely on `close` to schedule a retry.
    }));
  }

  private scheduleRetry(): void {
    if (this.destroyed) return;
    if (this.retries >= MAX_RETRIES) {
      console.warn(`[multiplayer] giving up after ${this.retries} retries; running solo.`);
      this.events.onStatus('failed');
      return;
    }
    this.retries++;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      try { this.socket?.close(); } catch { /* noop */ }
      this.socket = null;
      this.connect();
    }, RETRY_INTERVAL_MS);
  }

  send(msg: ClientMessage): void {
    const sock = this.socket;
    if (!sock) return;
    try {
      // partysocket buffers when not yet open; readyState check still useful to skip
      // sends on a fully-dead socket.
      if (sock.readyState === 3 /* CLOSED */) return;
      sock.send(encodeMsg(msg));
    } catch (err) {
      console.warn('[multiplayer] send failed', err);
    }
  }

  close(): void {
    this.explicitlyClosed = true;
    this.destroyed = true;
    if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    try { this.socket?.close(); } catch { /* noop */ }
    this.socket = null;
  }
}

export const HUB_ROOM = ROOM;
export function debugHost(): string { return pickHost(); }
