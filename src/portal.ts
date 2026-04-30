// Vibe Jam 2026 portal integration. Two flows:
//
//   Outgoing — clicking the central black hole redirects to the Vibe Jam hub
//     with our profile + a `ref` pointing back at this page. The hub then
//     routes the player onward to the next webring game.
//
//   Incoming — a player who arrived via another webring game lands here with
//     `?portal=true` plus their username/color/ref query params. We use those
//     to skip the start screen, save a session, and surface a "↩ return"
//     button that sends them back to the originating game.
//
// Reference: vibej.am/2026 portal contract (May 2026).

import type { GameMode } from './empire/types';
import type { PlayerProfile } from './multiplayer/protocol';
import { saveSession, type SessionConfig } from './multiplayer/profile';

const VIBE_JAM_HUB = 'https://vibej.am/portal/2026';

export interface IncomingPortalParams {
  username?: string;
  color?: string;
  ref?: string;        // URL of the originating game — drives the return portal
  speed?: string;
  // Other fields specified in the spec — captured so they can be forwarded
  // unchanged when this player exits via our outgoing portal:
  team?: string;
  hp?: string;
  avatar_url?: string;
  speed_x?: string;
  speed_y?: string;
  speed_z?: string;
  rotation_x?: string;
  rotation_y?: string;
  rotation_z?: string;
}

export function parseIncomingPortal(): IncomingPortalParams | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get('portal') !== 'true') return null;
  const out: IncomingPortalParams = {};
  for (const k of [
    'username', 'color', 'ref', 'speed',
    'team', 'hp', 'avatar_url',
    'speed_x', 'speed_y', 'speed_z',
    'rotation_x', 'rotation_y', 'rotation_z',
  ] as (keyof IncomingPortalParams)[]) {
    const v = params.get(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

// Strip portal query params from the address bar so a refresh doesn't
// re-trigger the incoming flow. Uses replaceState to avoid a navigation.
export function clearPortalUrlParams(): void {
  const url = new URL(window.location.href);
  const keep = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (k === 'portal' || k === 'username' || k === 'color' || k === 'ref'
      || k === 'speed' || k === 'team' || k === 'hp' || k === 'avatar_url'
      || k.startsWith('speed_') || k.startsWith('rotation_')) continue;
    keep.append(k, v);
  }
  url.search = keep.toString();
  window.history.replaceState(null, '', url.toString());
}

// Build a SessionConfig from incoming portal params. Defaults:
// - mode = 'mp' so the incoming player joins the shared galaxy (the whole
//   point of the webring — they meet other empires).
// - color falls back to a neutral cyan if the param is malformed.
// - name caps at 20 chars to match the start-screen rules.
export function sessionFromPortal(p: IncomingPortalParams): SessionConfig {
  const profile: PlayerProfile = {
    name: (p.username ?? 'Traveller').slice(0, 20) || 'Traveller',
    color: sanitizeColor(p.color),
  };
  const mode: GameMode = 'mp';
  const config: SessionConfig & { portalRef?: string } = { mode, profile };
  if (p.ref) config.portalRef = p.ref;
  return config;
}

// Persist the session AND the optional portal ref. The ref lives on the
// session record so a refresh keeps the return portal visible until the
// player explicitly resets via "↻ change profile".
export function persistPortalSession(config: SessionConfig & { portalRef?: string }): void {
  saveSession(config);
}

// Construct the outgoing redirect URL. `gameUrl` is our own canonical URL
// (used by the next game's `ref` so they can build a return portal back
// to us). The Vibe Jam spec forwards every parameter to the next game.
export function buildOutgoingPortalUrl(profile: PlayerProfile, gameUrl: string): string {
  const params = new URLSearchParams();
  params.set('username', profile.name);
  params.set('color', profile.color);
  params.set('speed', '1');                 // we don't track speed; spec wants any positive
  params.set('ref', gameUrl);
  return `${VIBE_JAM_HUB}?${params.toString()}`;
}

export function goToVibeJamHub(profile: PlayerProfile): void {
  const gameUrl = window.location.origin + window.location.pathname;
  window.location.href = buildOutgoingPortalUrl(profile, gameUrl);
}

// Render a small fixed pill at the top-left of the screen that returns the
// player to wherever they came from. Hidden when no incoming ref is set.
export function mountReturnPortal(host: HTMLElement, ref: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'portal-return-btn';
  btn.type = 'button';
  let label: string;
  try { label = new URL(ref).hostname; } catch { label = 'sender'; }
  btn.innerHTML = `<span class="portal-return-ico">↩</span><span class="portal-return-text">return to ${escapeHtml(label)}</span>`;
  btn.addEventListener('click', () => {
    window.location.href = ref;
  });
  host.appendChild(btn);
  return btn;
}

function sanitizeColor(c: string | undefined): string {
  if (!c) return '#9be8ff';
  if (/^#([0-9a-fA-F]{3}){1,2}$/.test(c)) return c;
  // Accept named colours by passing them through a temporary element so
  // CSS does the parsing. Falls back to the default if the browser rejects.
  const probe = document.createElement('div');
  probe.style.color = c;
  if (probe.style.color) return probe.style.color;
  return '#9be8ff';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
