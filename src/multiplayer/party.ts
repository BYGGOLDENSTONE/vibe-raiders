// Party panel — top-left HUD widget showing connection status, self, and remotes.
// Self-contained: builds its own container in uiRoot. Local-only "party" tagging.

import { gameState } from '../game/state';
import type { PlayerState } from '../net/protocol';

const STYLE_ID = 'mp-party-style';
const PANEL_CLASS = 'mp-party-panel';

const CSS = `
.${PANEL_CLASS} {
  position: fixed;
  top: 12px;
  left: 12px;
  min-width: 180px;
  max-width: 240px;
  max-height: 360px;
  overflow-y: auto;
  background: rgba(8,10,14,0.78);
  border: 1px solid rgba(120,130,150,0.25);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  pointer-events: auto;
  z-index: 20;
}
.mp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: #d8dde4;
  padding: 3px 4px;
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 120ms;
}
.mp-row:hover { background: rgba(200,200,220,0.08); }
.mp-row.mp-self { cursor: default; color: #c8a060; }
.mp-row.mp-self:hover { background: transparent; }
.mp-row.mp-party { color: #f0d080; }
.mp-swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid rgba(0,0,0,0.6);
  flex-shrink: 0;
}
.mp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-tag {
  font-size: 8px;
  letter-spacing: 0.2em;
  color: #6a7480;
  text-transform: uppercase;
}
.mp-row.mp-party .mp-tag { color: #f0d080; }
.mp-row.mp-self .mp-tag { color: #c8a060; }
.mp-status {
  font-size: 9px;
  letter-spacing: 0.25em;
  color: #6a7480;
  text-transform: uppercase;
  padding: 2px 4px 6px;
}
.mp-status.mp-status-on { color: #8a9080; }
.mp-status.mp-status-off { color: #4a5060; }
.mp-status.mp-status-fail { color: #c04040; }
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

  const body = document.createElement('div');
  body.className = PANEL_CLASS;
  uiRoot.appendChild(body);

  const statusEl = document.createElement('div');
  statusEl.className = 'mp-status mp-status-off';
  statusEl.textContent = 'Solo';
  body.appendChild(statusEl);

  const selfRow = document.createElement('div');
  selfRow.className = 'mp-row mp-self';
  const selfSwatch = document.createElement('span');
  selfSwatch.className = 'mp-swatch';
  const selfName = document.createElement('span');
  selfName.className = 'mp-name';
  selfName.textContent = '—';
  const selfTag = document.createElement('span');
  selfTag.className = 'mp-tag';
  selfTag.textContent = 'You';
  selfRow.appendChild(selfSwatch);
  selfRow.appendChild(selfName);
  selfRow.appendChild(selfTag);
  body.appendChild(selfRow);

  const remoteList = document.createElement('div');
  remoteList.style.display = 'flex';
  remoteList.style.flexDirection = 'column';
  remoteList.style.gap = '2px';
  body.appendChild(remoteList);

  function rebuildRoster(remotes: PlayerState[]): void {
    remoteList.innerHTML = '';
    if (remotes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mp-status mp-status-off';
      empty.textContent = '— alone in the hub —';
      empty.style.fontSize = '9px';
      remoteList.appendChild(empty);
      return;
    }
    const partySet = new Set(gameState.partyMemberIds);
    for (const p of remotes) {
      const row = document.createElement('div');
      row.className = 'mp-row';
      if (partySet.has(p.id)) row.classList.add('mp-party');
      row.dataset.ghostId = p.id;
      row.title = 'Click to toggle party';

      const swatch = document.createElement('span');
      swatch.className = 'mp-swatch';
      swatch.style.background = '#' + p.color.toString(16).padStart(6, '0');

      const nameEl = document.createElement('span');
      nameEl.className = 'mp-name';
      nameEl.textContent = p.name;

      const tag = document.createElement('span');
      tag.className = 'mp-tag';
      tag.textContent = partySet.has(p.id) ? 'Party' : 'Follow';

      row.appendChild(swatch);
      row.appendChild(nameEl);
      row.appendChild(tag);

      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        togglePartyMember(p.id);
        rebuildRoster(remotes);
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
      statusEl.classList.remove('mp-status-on', 'mp-status-off', 'mp-status-fail');
      switch (status) {
        case 'open':
          statusEl.textContent = 'Online';
          statusEl.classList.add('mp-status-on');
          break;
        case 'connecting':
          statusEl.textContent = 'Connecting…';
          statusEl.classList.add('mp-status-off');
          break;
        case 'closed':
          statusEl.textContent = 'Reconnecting…';
          statusEl.classList.add('mp-status-off');
          break;
        case 'failed':
          statusEl.textContent = 'Offline';
          statusEl.classList.add('mp-status-fail');
          break;
        case 'solo':
        default:
          statusEl.textContent = 'Solo';
          statusEl.classList.add('mp-status-off');
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
      try { body.remove(); } catch { /* noop */ }
    },
  };
}
