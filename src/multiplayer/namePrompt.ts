// Brief bottom-center "Your name?" prompt shown on first connect when no
// stored name exists. Resolves with whatever the player typed (or a fallback).
// Non-blocking: the rest of the game keeps running while the prompt is up.
// Escape or 2s of inactivity → fallback.

import { generateRandomName, persistName } from './identity';

const STYLE_ID = 'mp-name-style';

const CSS = `
.mp-name-prompt {
  position: fixed;
  bottom: 110px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(8,10,14,0.94);
  border: 1px solid rgba(120,130,150,0.3);
  box-shadow: 0 4px 14px rgba(0,0,0,0.6);
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  color: #d8dde4;
  z-index: 30;
  pointer-events: auto;
  border-radius: 3px;
}
.mp-name-prompt-label {
  font-size: 10px;
  letter-spacing: 0.32em;
  color: #c8a060;
  text-transform: uppercase;
}
.mp-name-prompt input {
  background: #08080a;
  border: 1px solid #2a2f3a;
  color: #e8d8b0;
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.1em;
  padding: 4px 8px;
  width: 200px;
  outline: none;
  text-align: center;
}
.mp-name-prompt input:focus { border-color: #c8a060; }
.mp-name-prompt-hint {
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
    wrap.className = 'mp-name-prompt';
    const label = document.createElement('div');
    label.className = 'mp-name-prompt-label';
    label.textContent = 'Your name?';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'Wanderer';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const hint = document.createElement('div');
    hint.className = 'mp-name-prompt-hint';
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

    setTimeout(() => { try { input.focus(); } catch { /* noop */ } }, 30);

    setTimeout(() => {
      if (!typed) finish('');
    }, timeoutMs);
  });
}
