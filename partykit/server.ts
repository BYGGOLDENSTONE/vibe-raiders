// PartyKit relay for The Vibecoder's Guide to the Galaxy.
//
// W13 — server is now AUTHORITATIVE for ownership. Every annex / wormhole /
// intergalactic claim flows through claim-request → claim-ack/reject so two
// empires never own the same planet or system. The relay also runs a 30-min
// round timer (UTC :00 / :30) that wipes the ownership map for everyone, so
// galaxy capacity scales beyond a single 64-player cohort.
//
// Persistence: room.storage durably persists the player table across hibernation
// and Cloudflare Worker restarts, so reconnects keep the same spawn system and
// owned planets even after a brief drop. Players idle for STALE_MS get evicted
// on the next sweep so their slot frees up. Ownership map is persisted too so
// a worker restart mid-round doesn't wipe the round.

import type * as Party from 'partykit/server';
import type {
  ClaimKind,
  ClientMessage,
  OwnershipMap,
  PlayerProfile,
  PublicEmpireState,
  PublicPlayer,
  ServerMessage,
} from '../src/multiplayer/protocol';

const MAX_PLAYERS = 64;
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours offline → slot freed
const PLAYERS_KEY = 'players.v1';
// W13 — round-state storage.
const OWNERSHIP_KEY = 'ownership.v1';
const ROUND_KEY = 'round.v1';
const ROUND_PERIOD_MS = 30 * 60 * 1000;
// W7 — minimum gap between trade requests from the same player, in ms. Light
// rate-limit so a buggy/spammy client can't flood the room. Client also has
// its own 60s cooldown for UX, this is the server's safety net.
const TRADE_COOLDOWN_MS = 30 * 1000;
// W7 — counterpart must have been seen within this window to be considered
// online and eligible for matchmaking. Avoids matching with players who left
// hours ago but haven't been swept yet.
const COUNTERPART_FRESH_MS = 5 * 60 * 1000;

type PlayerTable = Record<string, PublicPlayer>;

interface RoundState {
  nextResetAt: number;
}

export default class GalaxyServer implements Party.Server {
  private players: PlayerTable = {};
  // W13 — master ownership table. Key: targetId (planet or system id). Value:
  // ownerId (playerId). Only mutated by claim-request handler + roundReset.
  private ownership: OwnershipMap = {};
  // W13 — wall-clock ms of the next round reset. Refreshed in onStart from
  // storage and bumped each time a reset fires.
  private nextResetAt = 0;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  // Map of playerId → last trade-request wall-clock ms. Lives in memory only;
  // a server restart drops cooldowns, which is fine — the client cooldown
  // still gates legit usage.
  private lastTradeAt: Record<string, number> = {};

  constructor(readonly room: Party.Room) {}

  // PartyKit calls onStart once when the room is first created or rehydrated
  // from storage after a hibernation. Pulling players up-front means every
  // subsequent connection sees consistent state without an extra await.
  async onStart() {
    const stored = await this.room.storage.get<PlayerTable>(PLAYERS_KEY);
    this.players = stored ?? {};
    const ownStored = await this.room.storage.get<OwnershipMap>(OWNERSHIP_KEY);
    this.ownership = ownStored ?? {};
    const round = await this.room.storage.get<RoundState>(ROUND_KEY);
    const computed = computeNextResetAt(Date.now());
    if (round && round.nextResetAt > Date.now()) {
      this.nextResetAt = round.nextResetAt;
    } else {
      // Stale or missing round state → recompute and, if storage said the
      // round had already ended while the worker was hibernated, wipe
      // ownership so the new cohort starts fresh.
      this.nextResetAt = computed;
      if (round && round.nextResetAt <= Date.now()) {
        this.ownership = {};
        await this.room.storage.put(OWNERSHIP_KEY, this.ownership);
      }
      await this.room.storage.put(ROUND_KEY, { nextResetAt: this.nextResetAt });
    }
    this.scheduleResetTimer();
    this.sweepStale();
    this.loaded = true;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    if (!this.loaded) await this.onStart();

    // playerId comes from the client as a query param so reconnects are
    // sticky across page refreshes (client persists it in localStorage).
    const url = new URL(ctx.request.url);
    const playerId = url.searchParams.get('pid');
    if (!playerId) {
      conn.close(4400, 'missing playerId');
      return;
    }

    // Tag the connection with the playerId so onMessage / onClose know who
    // they're dealing with without re-parsing the URL.
    conn.setState({ playerId } satisfies ConnState);

    const now = Date.now();
    const existing = this.players[playerId];
    if (existing) {
      existing.lastSeen = now;
    }

    // If the player exists but the room is over capacity (sweep failed to
    // free a slot, e.g. all 64 are active), reject. New players also rejected.
    if (!existing && Object.keys(this.players).length >= MAX_PLAYERS) {
      conn.close(4429, 'room full');
      return;
    }

    const welcome: ServerMessage = {
      kind: 'welcome',
      you: existing ?? makePlaceholder(playerId, now),
      players: Object.values(this.players),
      ownership: this.ownership,
      nextResetAt: this.nextResetAt,
    };
    conn.send(JSON.stringify(welcome));
  }

  async onMessage(message: string, sender: Party.Connection) {
    const state = sender.state as ConnState | null;
    if (!state?.playerId) return;
    const playerId = state.playerId;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }

    switch (msg.kind) {
      case 'hello':
        await this.upsertPlayer(playerId, (p) => {
          p.profile = msg.profile;
        });
        break;
      case 'update-profile':
        await this.upsertPlayer(playerId, (p) => {
          p.profile = msg.profile;
        });
        break;
      case 'claim-system':
        await this.handleClaimSystem(sender, playerId, msg.preferred);
        break;
      case 'update-state':
        await this.upsertPlayer(playerId, (p) => {
          // systemId can only be set via claim-system. Ignore it from update-state.
          const incoming = msg.state;
          p.state = {
            systemId: p.state.systemId,
            ownedPlanets: dedupe(incoming.ownedPlanets),
            outpostMoonId: incoming.outpostMoonId,
            claimedSystems: incoming.claimedSystems ?? {},
            tradeHubReady: !!incoming.tradeHubReady,
          };
        });
        break;
      case 'trade-request':
        await this.handleTradeRequest(sender, playerId);
        break;
      case 'claim-request':
        await this.handleClaimRequest(sender, playerId, msg.targetId, msg.claimKind);
        break;
    }
  }

  // W13 — server-authoritative annex. First-come-first-served on targetId.
  // No resource validation here (resources are private per W6 design); client
  // is trusted for affordability, server is trusted for uniqueness.
  private async handleClaimRequest(
    conn: Party.Connection,
    playerId: string,
    targetId: string,
    claimKind: ClaimKind,
  ) {
    if (!targetId) return;
    const existingOwner = this.ownership[targetId];
    if (existingOwner) {
      // Already owned. If the requester is the current owner, treat it as
      // an idempotent ack so a delayed/duplicate request doesn't desync.
      if (existingOwner === playerId) {
        send(conn, { kind: 'claim-ack', targetId });
      } else {
        send(conn, { kind: 'claim-reject', targetId, ownerId: existingOwner });
      }
      return;
    }
    this.ownership[targetId] = playerId;
    await this.room.storage.put(OWNERSHIP_KEY, this.ownership);
    // Tell the requester it's theirs, then broadcast to everyone so other
    // clients can update labels / map / bulge tint immediately.
    send(conn, { kind: 'claim-ack', targetId });
    const broadcast: ServerMessage = {
      kind: 'claim-broadcast',
      targetId,
      ownerId: playerId,
      claimKind,
    };
    this.room.broadcast(JSON.stringify(broadcast));
  }

  // W13 — schedule the next round reset. Called from onStart and after each
  // reset fires. PartyKit hibernation will clear the timer; onStart restores
  // state from storage and re-schedules.
  private scheduleResetTimer() {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    const delay = Math.max(1000, this.nextResetAt - Date.now());
    this.resetTimer = setTimeout(() => {
      void this.handleRoundReset();
    }, delay);
  }

  private async handleRoundReset() {
    this.ownership = {};
    this.nextResetAt = computeNextResetAt(Date.now());
    await this.room.storage.put(OWNERSHIP_KEY, this.ownership);
    await this.room.storage.put(ROUND_KEY, { nextResetAt: this.nextResetAt });
    // Clear per-player ownership-derived public state so the leaderboard /
    // labels reset cleanly. Keep profile + lastSeen + systemId so reconnects
    // remember who someone is — empire layer will re-bootstrap territory.
    for (const p of Object.values(this.players)) {
      p.state.ownedPlanets = [];
      p.state.claimedSystems = {};
    }
    await this.persist();
    const message: ServerMessage = { kind: 'round-reset', nextResetAt: this.nextResetAt };
    this.room.broadcast(JSON.stringify(message));
    this.scheduleResetTimer();
  }

  // W7 — pick any other tradeHubReady player and notify both sides that a
  // trade just happened. Each client handles the resource swap locally since
  // resources are private. The room only knows "X traded with Y".
  private async handleTradeRequest(sender: Party.Connection, playerId: string) {
    const requester = this.players[playerId];
    if (!requester || !requester.state.tradeHubReady) {
      send(sender, { kind: 'trade-failed', reason: 'no-counterpart' });
      return;
    }
    const now = Date.now();
    const last = this.lastTradeAt[playerId] ?? 0;
    if (now - last < TRADE_COOLDOWN_MS) {
      send(sender, { kind: 'trade-failed', reason: 'cooldown' });
      return;
    }

    // Eligible counterparts: any other player who has trade-hub ready AND
    // has been seen recently (so we don't match with someone who left).
    const candidates: PublicPlayer[] = [];
    for (const p of Object.values(this.players)) {
      if (p.id === playerId) continue;
      if (!p.state.tradeHubReady) continue;
      if (now - p.lastSeen > COUNTERPART_FRESH_MS) continue;
      candidates.push(p);
    }

    if (candidates.length === 0) {
      send(sender, { kind: 'trade-failed', reason: 'no-counterpart' });
      return;
    }

    const pickedIndex = Math.floor(Math.random() * candidates.length);
    const counterpart = candidates[pickedIndex]!;
    this.lastTradeAt[playerId] = now;

    // Notify the requester. Counterpart also gets a heads-up so their UI
    // can pop a "your hub matched a trade with X" banner — purely cosmetic
    // since their resources don't change here.
    send(sender, {
      kind: 'trade-matched',
      counterpartId: counterpart.id,
      counterpartName: counterpart.profile.name,
      counterpartColor: counterpart.profile.color,
      asInitiator: true,
    });
    for (const conn of this.room.getConnections()) {
      const cs = conn.state as ConnState | null;
      if (cs?.playerId !== counterpart.id) continue;
      send(conn, {
        kind: 'trade-matched',
        counterpartId: requester.id,
        counterpartName: requester.profile.name,
        counterpartColor: requester.profile.color,
        asInitiator: false,
      });
    }
  }

  async onClose(conn: Party.Connection) {
    const state = conn.state as ConnState | null;
    if (!state?.playerId) return;
    const player = this.players[state.playerId];
    if (!player) return;
    // Mark lastSeen so the next connection or sweep can decide whether
    // this slot has gone stale. Don't broadcast a leave — players remain
    // visible until the sweep removes them, which keeps reconnects seamless.
    player.lastSeen = Date.now();
    await this.persist();
  }

  // --- Internals -------------------------------------------------------------

  private async handleClaimSystem(
    conn: Party.Connection,
    playerId: string,
    preferred: string[],
  ) {
    const existing = this.players[playerId];
    if (existing?.state.systemId) {
      // Already assigned. Idempotent: just resend the assignment.
      send(conn, { kind: 'system-assigned', systemId: existing.state.systemId });
      return;
    }
    if (Object.keys(this.players).length >= MAX_PLAYERS && !existing) {
      send(conn, { kind: 'system-claim-failed', reason: 'no-systems-available' });
      return;
    }

    // Build the taken-system set across all known players so two empires
    // never share a starting system. Idempotent reassign for the caller is
    // already handled above (existing.state.systemId short-circuit).
    const taken = new Set<string>();
    for (const p of Object.values(this.players)) {
      if (p.id === playerId) continue;
      if (p.state.systemId) taken.add(p.state.systemId);
    }

    let chosen: string | null = null;
    for (const candidate of preferred) {
      if (!candidate) continue;
      if (taken.has(candidate)) continue;
      // W9 — only main galaxy systems are valid spawn slots. Defensive check
      // since rogue clients could otherwise nominate satellite-galaxy systems
      // that should only be reachable via the Intergalactic Bridge unlock.
      if (!candidate.startsWith('milky-way:')) continue;
      chosen = candidate;
      break;
    }

    if (!chosen) {
      send(conn, { kind: 'system-claim-failed', reason: 'no-systems-available' });
      return;
    }

    await this.upsertPlayer(playerId, (p) => {
      p.state.systemId = chosen;
    });
    send(conn, { kind: 'system-assigned', systemId: chosen });
  }

  // Centralised mutate-and-broadcast. Creates the player row on first touch,
  // applies the mutation, persists, then broadcasts the new public state to
  // everyone in the room.
  private async upsertPlayer(playerId: string, mutate: (p: PublicPlayer) => void) {
    const now = Date.now();
    const isNew = !this.players[playerId];
    const player: PublicPlayer =
      this.players[playerId] ?? makePlaceholder(playerId, now);
    mutate(player);
    player.lastSeen = now;
    this.players[playerId] = player;
    await this.persist();

    const message: ServerMessage = isNew
      ? { kind: 'player-joined', player }
      : { kind: 'player-updated', player };
    this.room.broadcast(JSON.stringify(message));
  }

  private sweepStale() {
    const now = Date.now();
    const removed: string[] = [];
    for (const [id, p] of Object.entries(this.players)) {
      if (now - p.lastSeen > STALE_MS) {
        delete this.players[id];
        removed.push(id);
      }
    }
    if (removed.length > 0) {
      // No need to await — runs on startup before any client is connected,
      // and broadcasts are no-ops with no listeners.
      void this.persist();
      for (const id of removed) {
        const message: ServerMessage = { kind: 'player-left', playerId: id };
        this.room.broadcast(JSON.stringify(message));
      }
    }
  }

  private async persist() {
    await this.room.storage.put(PLAYERS_KEY, this.players);
  }
}

interface ConnState {
  playerId: string;
}

function makePlaceholder(playerId: string, now: number): PublicPlayer {
  const profile: PlayerProfile = { name: '', color: '#888' };
  const state: PublicEmpireState = {
    systemId: null,
    ownedPlanets: [],
    outpostMoonId: null,
    claimedSystems: {},
    tradeHubReady: false,
  };
  return { id: playerId, profile, state, lastSeen: now };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function send(conn: Party.Connection, msg: ServerMessage) {
  conn.send(JSON.stringify(msg));
}

// W13 — round resets every 30 min on UTC :00 and :30. Returns the wall-clock
// ms of the next reset boundary strictly after `now`.
function computeNextResetAt(now: number): number {
  const period = ROUND_PERIOD_MS;
  return Math.floor(now / period) * period + period;
}
