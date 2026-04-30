// Top-right chip list of every other player currently in the room. Driven by
// MultiplayerClient.remotePlayers() — call refresh() after onPlayersChanged.

import type { PublicPlayer } from './protocol';

export class Leaderboard {
  private root: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'mp-leaderboard';
    host.appendChild(this.root);
  }

  // Render is idempotent — full innerHTML rewrite each call. Player counts
  // change rarely (annex, claim) and the row count is bounded at 15 so the
  // cost is trivial.
  render(players: PublicPlayer[]): void {
    if (players.length === 0) {
      this.root.innerHTML = '';
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = '';
    // Sort: most planets first, then alphabetical for stable order.
    const sorted = players.slice().sort((a, b) => {
      const np = b.state.ownedPlanets.length - a.state.ownedPlanets.length;
      if (np !== 0) return np;
      return a.profile.name.localeCompare(b.profile.name);
    });
    const rows = sorted.map((p) => {
      const planets = p.state.ownedPlanets.length;
      const systems = countSystems(p);
      const name = escapeHtml(p.profile.name);
      const color = sanitizeColor(p.profile.color);
      const offline = !p.state.systemId ? ' offline' : '';
      return (
        `<div class="mp-row${offline}" style="--c:${color}">`
        + `<span class="mp-row-dot"></span>`
        + `<span class="mp-row-name">${name}</span>`
        + `<span class="mp-row-stat">${systems}<span class="mp-row-unit">sys</span> · ${planets}<span class="mp-row-unit">pl</span></span>`
        + `</div>`
      );
    }).join('');
    this.root.innerHTML = `<div class="mp-leaderboard-title">Players</div>${rows}`;
  }

  dispose(): void {
    this.root.remove();
  }
}

function countSystems(p: PublicPlayer): number {
  // A player "has" a system if they were assigned a spawn there. The
  // claimedSystems table also tracks higher-tier systems unlocked via
  // wormholes (W7 territory) — counted here so the chip stays accurate
  // once those land.
  const set = new Set<string>();
  if (p.state.systemId) set.add(p.state.systemId);
  for (const id of Object.keys(p.state.claimedSystems)) set.add(id);
  return set.size;
}

function sanitizeColor(c: string): string {
  // Defensive: a malformed colour from a bad client shouldn't break our
  // CSS. If it doesn't look like #rgb / #rrggbb, fall back to neutral.
  if (/^#([0-9a-fA-F]{3}){1,2}$/.test(c)) return c;
  return '#888888';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
