// Player profile + game-mode persistence. Loaded by main.ts on launch to
// decide whether to show the start screen or jump straight into the game.

import type { GameMode } from '../empire/types';
import type { PlayerProfile } from './protocol';

const KEY = 'vibecoder.mp.session.v1';

export interface SessionConfig {
  mode: GameMode;
  // Always present even in solo (color tints the player's own labels and
  // surface UI; name is unused in solo for now).
  profile: PlayerProfile;
  // W6-H — set when the player arrived via the Vibe Jam portal. Drives the
  // return-portal button so they can hop back to the originating game.
  // Cleared when the player resets via "↻ change profile".
  portalRef?: string;
}

// 8-colour palette. Picked to match the existing resource HUD palette so the
// galaxy and player colours feel like part of the same visual system.
export const PROFILE_COLORS = [
  '#ff5b3a', // red
  '#f0a560', // orange
  '#e6c97a', // yellow
  '#9bd64a', // green
  '#9be8ff', // cyan
  '#4ec3ff', // blue
  '#9d6cff', // purple
  '#ff7eb6', // pink
];

export function loadSession(): SessionConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionConfig>;
    if (parsed.mode !== 'solo' && parsed.mode !== 'mp') return null;
    if (!parsed.profile?.name || !parsed.profile?.color) return null;
    const out: SessionConfig = { mode: parsed.mode, profile: parsed.profile };
    if (typeof parsed.portalRef === 'string') out.portalRef = parsed.portalRef;
    return out;
  } catch { return null; }
}

export function saveSession(config: SessionConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch { /* quota / private mode — silent */ }
}

export function clearSession(): void {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}

// Auto-generated identity used when the player skips the profile picker.
// Deterministic per-browser is NOT desirable here — we want each fresh
// "skip" to produce a different name so multiple anonymous players in the
// same room don't all show up as "Player-0000".
export function autoProfile(): PlayerProfile {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const tag = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const color = PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)] ?? '#9be8ff';
  return { name: `Player-${tag}`, color };
}
