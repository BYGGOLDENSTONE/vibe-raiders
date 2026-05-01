// Wire protocol shared by the PartyKit relay (partykit/server.ts) and the
// browser client (src/multiplayer/client.ts). Keep this file dependency-free —
// no DOM, no Three.js — so the server bundle stays clean.

export interface PlayerProfile {
  name: string;
  color: string;
}

// Public, broadcastable slice of EmpireState. Resources, unlockedNodes and
// upgrade tree state are intentionally NOT here — those stay private per W6
// design ("upgrade'ler gözükmesin, claim'ler gözüksün").
//
// W9 — system / planet IDs are now galaxy-prefixed ("milky-way:sys-...",
// "andromeda:sys-..."). claimedSystems keys can carry tier 1-4: 1 = home,
// 2 = in-galaxy wormhole, 3 = intergalactic bridge, 4 = wormhole within an
// extra galaxy (deferred). Schema unchanged from W7.
export interface PublicEmpireState {
  systemId: string | null;
  ownedPlanets: string[];
  outpostMoonId: string | null;
  claimedSystems: Record<string, number>;
  // W7 — true once the player has unlocked the Trade Hub upgrade. Used by
  // the relay to match trade-requests with eligible counterparts. Resources
  // themselves stay private; the relay only knows "this player can trade."
  tradeHubReady: boolean;
}

export interface PublicPlayer {
  id: string;
  profile: PlayerProfile;
  state: PublicEmpireState;
  // Server-stamped wall clock; useful for sweeping idle players client-side.
  lastSeen: number;
}

// --- Client → Server ---------------------------------------------------------

export type ClientMessage =
  | { kind: 'hello'; profile: PlayerProfile }
  // Ask the server to assign a spawn system. The client sends its own
  // priority list (deterministic order of eligible rocky+moon systems),
  // server picks the first one that isn't taken. Reconnects with an
  // already-assigned system get that same system back regardless of the list.
  | { kind: 'claim-system'; preferred: string[] }
  | { kind: 'update-profile'; profile: PlayerProfile }
  | { kind: 'update-state'; state: PublicEmpireState }
  // W7 — Trade Hub matchmaking. Server picks an eligible counterpart (any
  // other player with tradeHubReady=true) and informs both sides. The actual
  // resource swap is computed locally per side since resources are private.
  | { kind: 'trade-request' };

// --- Server → Client ---------------------------------------------------------

export type ServerMessage =
  | { kind: 'welcome'; you: PublicPlayer; players: PublicPlayer[] }
  | { kind: 'system-assigned'; systemId: string }
  | { kind: 'system-claim-failed'; reason: 'no-systems-available' | 'invalid' }
  | { kind: 'player-joined'; player: PublicPlayer }
  | { kind: 'player-updated'; player: PublicPlayer }
  | { kind: 'player-left'; playerId: string }
  // W7 — Trade Hub matchmaking. Sent to BOTH parties (requester +
  // counterpart) so each can render an "informed" banner with the other's
  // identity. Resource math is local per side.
  | {
      kind: 'trade-matched';
      counterpartId: string;
      counterpartName: string;
      counterpartColor: string;
      // Whether the local player initiated this trade (true) or was the
      // counterpart somebody else picked (false). Drives the banner copy.
      asInitiator: boolean;
    }
  | { kind: 'trade-failed'; reason: 'no-counterpart' | 'cooldown' };
