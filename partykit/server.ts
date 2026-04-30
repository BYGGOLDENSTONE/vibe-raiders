// PartyKit relay for The Vibecoder's Guide to the Galaxy.
//
// One shared room ("galaxy"). At most MAX_PLAYERS players. The server holds
// the authoritative ownership table — who has claimed which spawn system,
// which planets they've annexed, etc. — and broadcasts changes to everyone
// connected. Resources and upgrade trees are NOT relayed (private per-player).
//
// Persistence: room.storage durably persists the player table across hibernation
// and Cloudflare Worker restarts, so reconnects keep the same spawn system and
// owned planets even after a brief drop. Players idle for STALE_MS get evicted
// on the next sweep so their slot frees up.

import type * as Party from 'partykit/server';
import type {
  ClientMessage,
  PlayerProfile,
  PublicEmpireState,
  PublicPlayer,
  ServerMessage,
} from '../src/multiplayer/protocol';

const MAX_PLAYERS = 16;
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours offline → slot freed
const PLAYERS_KEY = 'players.v1';

type PlayerTable = Record<string, PublicPlayer>;

export default class GalaxyServer implements Party.Server {
  private players: PlayerTable = {};
  private loaded = false;

  constructor(readonly room: Party.Room) {}

  // PartyKit calls onStart once when the room is first created or rehydrated
  // from storage after a hibernation. Pulling players up-front means every
  // subsequent connection sees consistent state without an extra await.
  async onStart() {
    const stored = await this.room.storage.get<PlayerTable>(PLAYERS_KEY);
    this.players = stored ?? {};
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
    (conn.state as ConnState | null) ?? null;
    conn.setState({ playerId } satisfies ConnState);

    const now = Date.now();
    const existing = this.players[playerId];
    if (existing) {
      existing.lastSeen = now;
    }

    // If the player exists but the room is over capacity (sweep failed to
    // free a slot, e.g. all 16 are active), reject. New players also rejected.
    if (!existing && Object.keys(this.players).length >= MAX_PLAYERS) {
      conn.close(4429, 'room full');
      return;
    }

    const welcome: ServerMessage = {
      kind: 'welcome',
      you: existing ?? makePlaceholder(playerId, now),
      players: Object.values(this.players),
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
          };
        });
        break;
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

    const taken = new Set<string>();
    for (const p of Object.values(this.players)) {
      if (p.state.systemId) taken.add(p.state.systemId);
    }

    let chosen: string | null = null;
    for (const candidate of preferred) {
      if (!candidate) continue;
      if (taken.has(candidate)) continue;
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
  };
  return { id: playerId, profile, state, lastSeen: now };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function send(conn: Party.Connection, msg: ServerMessage) {
  conn.send(JSON.stringify(msg));
}
