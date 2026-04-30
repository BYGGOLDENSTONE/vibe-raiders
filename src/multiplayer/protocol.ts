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
export interface PublicEmpireState {
  systemId: string | null;
  ownedPlanets: string[];
  outpostMoonId: string | null;
  claimedSystems: Record<string, number>;
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
  | { kind: 'update-state'; state: PublicEmpireState };

// --- Server → Client ---------------------------------------------------------

export type ServerMessage =
  | { kind: 'welcome'; you: PublicPlayer; players: PublicPlayer[] }
  | { kind: 'system-assigned'; systemId: string }
  | { kind: 'system-claim-failed'; reason: 'no-systems-available' | 'invalid' }
  | { kind: 'player-joined'; player: PublicPlayer }
  | { kind: 'player-updated'; player: PublicPlayer }
  | { kind: 'player-left'; playerId: string };
