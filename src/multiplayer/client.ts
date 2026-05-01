// Browser-side wrapper around the PartyKit relay. Owns the WebSocket lifecycle,
// keeps a local cache of public player state, and exposes a tiny
// publish/subscribe API to the rest of the game.
//
// Connection model (Q3 from the W6 design): the game keeps running locally if
// the relay is unreachable. partysocket auto-reconnects; remote state stays
// stale until the next message arrives. A "Disconnected — reconnecting..."
// banner is shown by the UI layer (W6-F) based on `isOnline()`.

import PartySocket from 'partysocket';
import type {
  ClaimKind,
  ClientMessage,
  OwnershipMap,
  PlayerProfile,
  PublicEmpireState,
  PublicPlayer,
  ServerMessage,
} from './protocol';

const PLAYER_ID_KEY = 'vibecoder.mp.playerId.v1';
const ROOM_NAME = 'galaxy';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface MultiplayerEvents {
  // Fires whenever the local cache of remote players changes (someone joined,
  // updated state, left, or our own state was echoed back).
  onPlayersChanged?: () => void;
  // Fires once we know our own assigned system (response to claim-system).
  onSystemAssigned?: (systemId: string) => void;
  // Fires when the server rejects the claim. UI can fall back to "no slots".
  onSystemClaimFailed?: (reason: string) => void;
  // Connection status changes — used to drive the "reconnecting" banner.
  onStatusChanged?: (status: ConnectionStatus) => void;
  // W7 — Trade Hub matchmaking. asInitiator=true when this client requested
  // the trade, false when another player matched with us. Resource swap is
  // computed locally per side regardless.
  onTradeMatched?: (info: {
    counterpartName: string;
    counterpartColor: string;
    asInitiator: boolean;
  }) => void;
  // No counterpart available, or rate-limited. Caller can fall back to the
  // NPC trade flow (W7-D solo path).
  onTradeFailed?: (reason: 'no-counterpart' | 'cooldown') => void;
  // W13 — fires whenever the authoritative ownership map mutates (claim by
  // self, claim by another player, or full round-reset wipe). UI re-reads
  // getOwnership() / roundCountdown() / players to refresh visuals.
  onOwnershipChanged?: () => void;
  // W13 — fires when the server starts a fresh round. Empire layer wipes
  // territory and re-runs the spawn-claim handshake.
  onRoundReset?: (nextResetAt: number) => void;
}

// W13 — pending claim entry. Tracked client-side so duplicate auto-claim
// ticks don't fire the same target twice while the first one is in flight.
interface PendingClaim {
  resolve: (accepted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MultiplayerClient {
  private socket: PartySocket;
  private players = new Map<string, PublicPlayer>();
  private myId: string;
  private status: ConnectionStatus = 'connecting';
  private events: MultiplayerEvents;
  // Pending profile/state that arrived before the socket opened. Flushed
  // on the first 'open' event so the server gets the latest values even if
  // the player picked their name during the brief connecting window.
  private pendingProfile: PlayerProfile | null = null;
  private pendingState: PublicEmpireState | null = null;
  private pendingClaim: string[] | null = null;
  // W13 — server-authoritative ownership map mirrored locally.
  private ownership: OwnershipMap = {};
  private nextResetAt = 0;
  // W13 — pending claim-request promises keyed by targetId. Auto-claim engine
  // awaits these to know whether to apply local state or retarget.
  private pendingClaims = new Map<string, PendingClaim>();

  constructor(host: string, profile: PlayerProfile, events: MultiplayerEvents = {}) {
    this.events = events;
    this.myId = loadOrCreatePlayerId();
    this.pendingProfile = profile;

    this.socket = new PartySocket({
      host,
      room: ROOM_NAME,
      query: { pid: this.myId },
    });

    this.socket.addEventListener('open', () => {
      this.setStatus('open');
      // Re-announce on every (re)connect so the server has fresh profile +
      // state even if it lost everything (storage wipe, dev restart).
      if (this.pendingProfile) {
        this.send({ kind: 'hello', profile: this.pendingProfile });
      }
      if (this.pendingClaim) {
        this.send({ kind: 'claim-system', preferred: this.pendingClaim });
      }
      if (this.pendingState) {
        this.send({ kind: 'update-state', state: this.pendingState });
      }
    });

    this.socket.addEventListener('close', () => this.setStatus('closed'));
    this.socket.addEventListener('error', () => this.setStatus('closed'));

    this.socket.addEventListener('message', (e: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : '') as ServerMessage;
      } catch {
        return;
      }
      this.handleServerMessage(msg);
    });
  }

  // --- Public API ------------------------------------------------------------

  myPlayerId(): string {
    return this.myId;
  }

  isOnline(): boolean {
    return this.status === 'open';
  }

  // Snapshot of every other player. Self is excluded so the UI doesn't render
  // a leaderboard row for the local player twice.
  remotePlayers(): PublicPlayer[] {
    return Array.from(this.players.values()).filter((p) => p.id !== this.myId);
  }

  selfPlayer(): PublicPlayer | null {
    return this.players.get(this.myId) ?? null;
  }

  // Ask the server for a spawn system. `preferred` is the client's own
  // priority list — server picks the first entry not already taken. If we're
  // offline the request is queued and replays on reconnect.
  claimSystem(preferred: string[]): void {
    this.pendingClaim = preferred;
    if (this.isOnline()) {
      this.send({ kind: 'claim-system', preferred });
    }
  }

  // Push the local player's public state to the server. Coalesce-friendly:
  // call as often as you like, only the most recent payload is sent on the
  // next flush. Called from Empire.subscribe() once W6-D wires it up.
  publishState(state: PublicEmpireState): void {
    this.pendingState = state;
    if (this.isOnline()) {
      this.send({ kind: 'update-state', state });
    }
  }

  publishProfile(profile: PlayerProfile): void {
    this.pendingProfile = profile;
    if (this.isOnline()) {
      this.send({ kind: 'update-profile', profile });
    }
  }

  // W7 — request a trade match. The server picks an eligible counterpart
  // and notifies both sides. Dropped silently when offline; the App layer
  // can fall back to NPC trading without us.
  requestTrade(): void {
    if (this.isOnline()) {
      this.send({ kind: 'trade-request' });
    }
  }

  // W13 — auto-expand engine entry. Resolves true on claim-ack, false on
  // claim-reject (or 2s timeout / offline drop). When offline, resolves
  // false immediately so the engine doesn't lock up — solo-equivalent
  // behaviour can take over while reconnecting.
  requestClaim(targetId: string, claimKind: ClaimKind): Promise<boolean> {
    if (!targetId) return Promise.resolve(false);
    if (!this.isOnline()) return Promise.resolve(false);
    // Server is the source of truth, but skip the round-trip when we already
    // know the target is owned (saves a request/response per tick).
    if (this.ownership[targetId]) {
      return Promise.resolve(this.ownership[targetId] === this.myId);
    }
    // Dedupe: if a request for this target is already in flight, return its
    // promise so the auto-engine doesn't fire twice.
    const inflight = this.pendingClaims.get(targetId);
    if (inflight) {
      return new Promise((res) => {
        const prev = inflight.resolve;
        inflight.resolve = (ok) => { prev(ok); res(ok); };
      });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const entry = this.pendingClaims.get(targetId);
        if (!entry) return;
        this.pendingClaims.delete(targetId);
        entry.resolve(false);
      }, 2000);
      this.pendingClaims.set(targetId, { resolve, timer });
      this.send({ kind: 'claim-request', targetId, claimKind });
    });
  }

  // W13 — read the latest authoritative ownership snapshot. Used by the
  // empire engine to skip already-owned targets in its priority loop and by
  // the visual layer to colour cells by their owner.
  getOwnership(): OwnershipMap {
    return this.ownership;
  }

  // W13 — wall-clock ms remaining until the next round reset. UI surfaces
  // this in the HUD as a MM:SS countdown.
  roundCountdownMs(): number {
    return Math.max(0, this.nextResetAt - Date.now());
  }

  close(): void {
    this.socket.close();
  }

  // --- Internals -------------------------------------------------------------

  private handleServerMessage(msg: ServerMessage) {
    switch (msg.kind) {
      case 'welcome':
        this.players.clear();
        for (const p of msg.players) this.players.set(p.id, p);
        this.players.set(msg.you.id, msg.you);
        // W13 — replace the ownership snapshot wholesale; reconnects rely
        // on this to recover from a missed claim-broadcast.
        this.ownership = { ...msg.ownership };
        this.nextResetAt = msg.nextResetAt;
        this.events.onPlayersChanged?.();
        this.events.onOwnershipChanged?.();
        break;
      case 'player-joined':
      case 'player-updated':
        this.players.set(msg.player.id, msg.player);
        this.events.onPlayersChanged?.();
        break;
      case 'player-left':
        if (this.players.delete(msg.playerId)) {
          this.events.onPlayersChanged?.();
        }
        break;
      case 'system-assigned':
        this.events.onSystemAssigned?.(msg.systemId);
        break;
      case 'system-claim-failed':
        this.events.onSystemClaimFailed?.(msg.reason);
        break;
      case 'trade-matched':
        this.events.onTradeMatched?.({
          counterpartName: msg.counterpartName,
          counterpartColor: msg.counterpartColor,
          asInitiator: msg.asInitiator,
        });
        break;
      case 'trade-failed':
        this.events.onTradeFailed?.(msg.reason);
        break;
      case 'claim-ack': {
        const entry = this.pendingClaims.get(msg.targetId);
        this.ownership[msg.targetId] = this.myId;
        if (entry) {
          clearTimeout(entry.timer);
          this.pendingClaims.delete(msg.targetId);
          entry.resolve(true);
        }
        this.events.onOwnershipChanged?.();
        break;
      }
      case 'claim-reject': {
        const entry = this.pendingClaims.get(msg.targetId);
        this.ownership[msg.targetId] = msg.ownerId;
        if (entry) {
          clearTimeout(entry.timer);
          this.pendingClaims.delete(msg.targetId);
          entry.resolve(false);
        }
        this.events.onOwnershipChanged?.();
        break;
      }
      case 'claim-broadcast':
        this.ownership[msg.targetId] = msg.ownerId;
        this.events.onOwnershipChanged?.();
        break;
      case 'round-reset':
        this.ownership = {};
        this.nextResetAt = msg.nextResetAt;
        // Cancel any pending claims — the targets are gone now.
        for (const entry of this.pendingClaims.values()) {
          clearTimeout(entry.timer);
          entry.resolve(false);
        }
        this.pendingClaims.clear();
        this.events.onRoundReset?.(msg.nextResetAt);
        this.events.onOwnershipChanged?.();
        break;
    }
  }

  private send(msg: ClientMessage) {
    this.socket.send(JSON.stringify(msg));
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.events.onStatusChanged?.(s);
  }
}

// Stable per-browser playerId. Reusing this means a refresh keeps the same
// spawn system and owned planets — server treats reconnects as the same
// player. Cleared only when the user explicitly resets profile.
function loadOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
  } catch { /* private mode etc. */ }
  const fresh = generatePlayerId();
  try { localStorage.setItem(PLAYER_ID_KEY, fresh); } catch { /* no-op */ }
  return fresh;
}

function generatePlayerId(): string {
  // 64 bits of randomness as 16 hex chars. Plenty for ≤16 concurrent players
  // and reads cleanly in dev tools / server logs.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
