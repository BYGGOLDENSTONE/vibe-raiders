// Brief bottom-center "Your name?" prompt shown on first connect when no
// stored name exists. Resolves with whatever the player typed (or a fallback).
//
// Non-blocking: the rest of the game keeps running while the prompt is up.
// Escape or 2s of inactivity → fallback.

import { generateRandomName, persistName } from './identity';

const STYLE_ID = 'dusk-mp-name-style';

const CSS = `
.dusk-mp-name {
  position: fixed;
  bottom: 110px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(180deg, rgba(10,10,13,0.94) 0%, rgba(6,6,9,0.98) 100%);
  border: 1px solid #4a3820;
  box-shadow:
    inset 0 0 0 1px rgba(200,160,96,0.08),
    0 4px 14px rgba(0,0,0,0.6);
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  color: #d8dde4;
  z-index: 30;
  pointer-events: auto;
  border-radius: 2px;
}
.dusk-mp-name-label {
  font-size: 10px;
  letter-spacing: 0.32em;
  color: #c8a060;
  text-transform: uppercase;
}
.dusk-mp-name input {
  background: #08080a;
  border: 1px solid #2a2014;
  color: #e8d8b0;
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.1em;
  padding: 4px 8px;
  width: 200px;
  outline: none;
  text-align: center;
}
.dusk-mp-name input:focus { border-color: #c8a060; }
.dusk-mp-name-hint {
  font-size: 9px;
  color: #6a7480;
  letter-spacing: 0.2em;
}
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function promptForName(uiRoot: HTMLElement, timeoutMs = 2000): Promise<string> {
  injectStyles();

  return new Promise<string>((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dusk-mp-name';
    const label = document.createElement('div');
    label.className = 'dusk-mp-name-label';
    label.textContent = 'Your name?';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'Wanderer';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const hint = document.createElement('div');
    hint.className = 'dusk-mp-name-hint';
    hint.textContent = 'Enter to confirm · Esc to skip';
    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(hint);
    uiRoot.appendChild(wrap);

    let resolved = false;
    let typed = false;

    const finish = (name: string): void => {
      if (resolved) return;
      resolved = true;
      try { wrap.remove(); } catch { /* noop */ }
      const cleaned = (name || '').trim();
      const final = cleaned.length > 0 ? cleaned.slice(0, 24) : generateRandomName();
      persistName(final);
      resolve(final);
    };

    const onKey = (e: KeyboardEvent): void => {
      typed = true;
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish('');
      }
    };
    input.addEventListener('keydown', onKey);

    // Auto-focus so the player can just start typing.
    setTimeout(() => { try { input.focus(); } catch { /* noop */ } }, 30);

    // Timeout — if the player hasn't typed anything, fall back silently.
    setTimeout(() => {
      if (!typed) finish('');
    }, timeoutMs);
  });
}
