// Start menu overlay: pauses the world via gameState.timeScale = 0 until the
// player clicks PLAY. Includes a how-to-play hint and a master-volume slider.

import { gameState, type GameContext } from '../state';
import { setMasterVolume } from '../audio/context';

const STYLE_ID = 'dusk-menu-styles';

const CSS = `
.dusk-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at center, rgba(20, 14, 22, 0.55), rgba(0, 0, 0, 0.92) 75%),
    linear-gradient(180deg, rgba(10, 8, 12, 0.6), rgba(0, 0, 0, 0.85));
  pointer-events: auto;
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  color: #d8dde4;
  user-select: none;
  transition: opacity 320ms ease-out;
  opacity: 1;
}
.dusk-menu-overlay.closing { opacity: 0; pointer-events: none; }
.dusk-menu-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  padding: 38px 56px 30px 56px;
  border: 1px solid rgba(200, 160, 96, 0.4);
  border-radius: 6px;
  background:
    linear-gradient(180deg, rgba(20, 16, 24, 0.92), rgba(8, 6, 10, 0.96));
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.7),
    0 30px 80px rgba(0,0,0,0.85),
    inset 0 1px 0 rgba(200, 160, 96, 0.25);
  min-width: 380px;
  max-width: 480px;
}
.dusk-menu-title {
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
  font-size: 56px;
  letter-spacing: 0.42em;
  color: #c8a060;
  text-shadow: 0 0 16px rgba(200, 160, 96, 0.5), 0 2px 0 rgba(0, 0, 0, 0.8);
  margin: 0;
  padding-left: 0.42em;
}
.dusk-menu-sub {
  font-size: 11px;
  letter-spacing: 0.32em;
  color: #8a6a40;
  text-transform: uppercase;
  margin-top: -14px;
}
.dusk-menu-hint {
  font-size: 12px;
  line-height: 1.7;
  color: #a8a0a8;
  text-align: center;
  letter-spacing: 0.04em;
  max-width: 380px;
}
.dusk-menu-hint b { color: #c8a060; font-weight: 600; }
.dusk-menu-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  font-size: 11px;
  letter-spacing: 0.18em;
  color: #8a8088;
  text-transform: uppercase;
}
.dusk-menu-row input[type=range] {
  flex: 1;
  accent-color: #c8a060;
  cursor: pointer;
}
.dusk-menu-row .vol-num {
  width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #c8a060;
}
.dusk-menu-play {
  width: 220px;
  padding: 12px 0;
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
  font-size: 18px;
  letter-spacing: 0.32em;
  color: #1a1418;
  background: linear-gradient(180deg, #d8b070, #b88840);
  border: 1px solid #e8c890;
  border-radius: 3px;
  cursor: pointer;
  text-transform: uppercase;
  font-weight: 700;
  box-shadow:
    0 4px 12px rgba(200, 160, 96, 0.3),
    inset 0 1px 0 rgba(255, 240, 200, 0.4);
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
}
.dusk-menu-play:hover {
  transform: translateY(-1px);
  box-shadow:
    0 6px 16px rgba(200, 160, 96, 0.45),
    inset 0 1px 0 rgba(255, 240, 200, 0.55);
}
.dusk-menu-play:active { transform: translateY(0); }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function initMenu(_ctx: GameContext): void {
  injectStyles();

  // Freeze the world while the menu is up.
  gameState.timeScale = 0;
  gameState.paused = true;

  const overlay = document.createElement('div');
  overlay.className = 'dusk-menu-overlay';

  const card = document.createElement('div');
  card.className = 'dusk-menu-card';

  const title = document.createElement('h1');
  title.className = 'dusk-menu-title';
  title.textContent = 'DUSK';
  card.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'dusk-menu-sub';
  sub.textContent = 'an arpg ritual';
  card.appendChild(sub);

  const hint = document.createElement('div');
  hint.className = 'dusk-menu-hint';
  hint.innerHTML = [
    '<b>LMB</b> to move · <b>1</b> <b>2</b> <b>3</b> skills · <b>Q</b> ultimate · <b>SHIFT</b> dash',
    '<b>I</b> inventory · walk into the <b>ABYSSAL CRYPT</b> to enter the dungeon',
    'find the <b>VIBE JAM</b> arch to leap to other jam games',
  ].join('<br>');
  card.appendChild(hint);

  // Volume slider
  const volRow = document.createElement('div');
  volRow.className = 'dusk-menu-row';
  const volLabel = document.createElement('span');
  volLabel.textContent = 'volume';
  const volInput = document.createElement('input');
  volInput.type = 'range';
  volInput.min = '0';
  volInput.max = '100';
  volInput.value = '25';
  const volNum = document.createElement('span');
  volNum.className = 'vol-num';
  volNum.textContent = '25';
  volInput.addEventListener('input', () => {
    const v = parseInt(volInput.value, 10) / 100;
    volNum.textContent = volInput.value;
    setMasterVolume(v);
  });
  volRow.appendChild(volLabel);
  volRow.appendChild(volInput);
  volRow.appendChild(volNum);
  card.appendChild(volRow);

  // Play button
  const play = document.createElement('button');
  play.className = 'dusk-menu-play';
  play.textContent = 'play';
  play.addEventListener('click', () => {
    gameState.timeScale = 1;
    gameState.paused = false;
    overlay.classList.add('closing');
    window.setTimeout(() => overlay.remove(), 360);
    // Apply current slider value once at start (also bootstraps audio context
    // since clicking PLAY counts as a user gesture for autoplay policy).
    setMasterVolume(parseInt(volInput.value, 10) / 100);
  });
  card.appendChild(play);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Esc also starts (handy for quick testing).
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      window.removeEventListener('keydown', onKey);
      play.click();
    }
  };
  window.addEventListener('keydown', onKey);
}
