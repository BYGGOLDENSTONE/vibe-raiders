// Party panel — hijacks `.dusk-party-body` (created by the HUD) and renders
// a row per known player in the hub.
//
// Local-only state: `gameState.partyMemberIds` is a list of remote ids the
// local user has tagged as "party". Real cross-player party formation would
// require new protocol messages — out of scope for the jam.

import { gameState } from '../game/state';
import type { PlayerState } from '../net/protocol';

const STYLE_ID = 'dusk-mp-party-style';

const CSS = `
.dusk-party {
  /* Override fixed height from base styles so rows can stack. */
  height: auto !important;
  min-height: 60px;
  max-height: 320px;
  overflow-y: auto;
  pointer-events: auto !important;
}
.dusk-party-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  pointer-events: auto;
}
.dusk-mp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #d8dde4;
  padding: 2px 4px;
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 120ms;
}
.dusk-mp-row:hover { background: rgba(200,160,96,0.08); }
.dusk-mp-row.dusk-mp-self { cursor: default; color: #c8a060; }
.dusk-mp-row.dusk-mp-self:hover { background: transparent; }
.dusk-mp-row.dusk-mp-party { color: #f0d080; }
.dusk-mp-swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.6);
  flex-shrink: 0;
}
.dusk-mp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dusk-mp-tag {
  font-size: 8px;
  letter-spacing: 0.2em;
  color: #6a7480;
  text-transform: uppercase;
}
.dusk-mp-row.dusk-mp-party .dusk-mp-tag { color: #f0d080; }
.dusk-mp-row.dusk-mp-self .dusk-mp-tag { color: #c8a060; }
.dusk-mp-status {
  font-size: 9px;
  letter-spacing: 0.25em;
  color: #6a7480;
  text-transform: uppercase;
  padding: 2px 4px;
}
.dusk-mp-status.dusk-mp-status-on { color: #8a9080; }
.dusk-mp-status.dusk-mp-status-off { color: #4a5060; }
.dusk-mp-status.dusk-mp-status-fail { color: #c04040; }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export interface PartyPanel {
  setSelf(name: string, color: number): void;
  setStatus(status: 'connecting' | 'open' | 'closed' | 'failed' | 'solo'): void;
  setRoster(remotes: PlayerState[]): void;
  togglePartyMember(id: string): void;
  destroy(): void;
}

export function buildPartyPanel(uiRoot: HTMLElement): PartyPanel {
  injectStyles();

  // The HUD module created `.dusk-party-body`; locate it once.
  const body = uiRoot.querySelector<HTMLElement>('.dusk-party-body');
  if (!body) {
    console.warn('[multiplayer] .dusk-party-body not found — party panel disabled');
    return {
      setSelf: () => { /* noop */ },
      setStatus: () => { /* noop */ },
      setRoster: () => { /* noop */ },
      togglePartyMember: () => { /* noop */ },
      destroy: () => { /* noop */ },
    };
  }

  // Replace the placeholder content. We re-render imperatively because the
  // roster updates infrequently (10 Hz upper bound, usually slower).
  body.innerHTML = '';

  const statusEl = document.createElement('div');
  statusEl.className = 'dusk-mp-status dusk-mp-status-off';
  statusEl.textContent = 'Solo';
  body.appendChild(statusEl);

  const selfRow = document.createElement('div');
  selfRow.className = 'dusk-mp-row dusk-mp-self';
  const selfSwatch = document.createElement('span');
  selfSwatch.className = 'dusk-mp-swatch';
  const selfName = document.createElement('span');
  selfName.className = 'dusk-mp-name';
  selfName.textContent = '—';
  const selfTag = document.createElement('span');
  selfTag.className = 'dusk-mp-tag';
  selfTag.textContent = 'You';
  selfRow.appendChild(selfSwatch);
  selfRow.appendChild(selfName);
  selfRow.appendChild(selfTag);
  body.appendChild(selfRow);

  // Container for remote rows. Re-rendered via `setRoster`.
  const remoteList = document.createElement('div');
  remoteList.className = 'dusk-mp-remote-list';
  remoteList.style.display = 'flex';
  remoteList.style.flexDirection = 'column';
  remoteList.style.gap = '2px';
  body.appendChild(remoteList);

  function rebuildRoster(remotes: PlayerState[]): void {
    remoteList.innerHTML = '';
    if (remotes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dusk-mp-status dusk-mp-status-off';
      empty.textContent = '— alone in the dusk —';
      empty.style.fontSize = '9px';
      remoteList.appendChild(empty);
      return;
    }
    const partySet = new Set(gameState.partyMemberIds);
    for (const p of remotes) {
      const row = document.createElement('div');
      row.className = 'dusk-mp-row';
      if (partySet.has(p.id)) row.classList.add('dusk-mp-party');
      row.dataset.ghostId = p.id;
      row.title = 'Click to toggle party';

      const swatch = document.createElement('span');
      swatch.className = 'dusk-mp-swatch';
      swatch.style.background = '#' + p.color.toString(16).padStart(6, '0');

      const nameEl = document.createElement('span');
      nameEl.className = 'dusk-mp-name';
      nameEl.textContent = p.name;

      const tag = document.createElement('span');
      tag.className = 'dusk-mp-tag';
      tag.textContent = partySet.has(p.id) ? 'Party' : 'Follow';

      row.appendChild(swatch);
      row.appendChild(nameEl);
      row.appendChild(tag);

      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        togglePartyMember(p.id);
        rebuildRoster(remotes); // refresh tags inline
      });

      remoteList.appendChild(row);
    }
  }

  function togglePartyMember(id: string): void {
    const idx = gameState.partyMemberIds.indexOf(id);
    if (idx >= 0) gameState.partyMemberIds.splice(idx, 1);
    else gameState.partyMemberIds.push(id);
  }

  return {
    setSelf(name, color) {
      selfName.textContent = name;
      selfSwatch.style.background = '#' + color.toString(16).padStart(6, '0');
    },
    setStatus(status) {
      statusEl.classList.remove('dusk-mp-status-on', 'dusk-mp-status-off', 'dusk-mp-status-fail');
      switch (status) {
        case 'open':
          statusEl.textContent = 'Online';
          statusEl.classList.add('dusk-mp-status-on');
          break;
        case 'connecting':
          statusEl.textContent = 'Connecting…';
          statusEl.classList.add('dusk-mp-status-off');
          break;
        case 'closed':
          statusEl.textContent = 'Reconnecting…';
          statusEl.classList.add('dusk-mp-status-off');
          break;
        case 'failed':
          statusEl.textContent = 'Offline';
          statusEl.classList.add('dusk-mp-status-fail');
          break;
        case 'solo':
        default:
          statusEl.textContent = 'Solo';
          statusEl.classList.add('dusk-mp-status-off');
          break;
      }
    },
    setRoster(remotes) {
      rebuildRoster(remotes);
    },
    togglePartyMember(id) {
      togglePartyMember(id);
    },
    destroy() {
      try { body.innerHTML = ''; } catch { /* noop */ }
    },
  };
}
