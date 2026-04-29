// Start menu overlay: pauses the world via gameState.timeScale = 0 until the
// player clicks PLAY. Includes a how-to-play hint, a class selector, and a
// master-volume slider.

import { gameState, setClass, type GameContext, type SelectableClass } from '../state';
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
  max-width: 760px;
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

.dusk-class-heading {
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
  font-size: 13px;
  letter-spacing: 0.42em;
  color: #c8a060;
  text-transform: uppercase;
  margin: 4px 0 -4px 0;
}
.dusk-class-row {
  display: flex;
  gap: 18px;
  align-items: stretch;
  justify-content: center;
}
.dusk-class-card {
  width: 200px;
  height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 14px 16px 14px;
  border: 1px solid rgba(120, 100, 80, 0.4);
  border-radius: 4px;
  background:
    linear-gradient(180deg, rgba(28, 22, 30, 0.94), rgba(12, 10, 14, 0.98));
  box-shadow: 0 4px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(200,160,96,0.08);
  cursor: pointer;
  transition: transform 120ms ease-out, border-color 160ms ease-out, box-shadow 160ms ease-out;
}
.dusk-class-card:hover {
  transform: translateY(-2px);
  border-color: rgba(200, 160, 96, 0.6);
}
.dusk-class-card.selected {
  border-color: #d8b070;
  box-shadow:
    0 0 0 1px #d8b070,
    0 0 22px var(--accent, rgba(200, 160, 96, 0.55)),
    0 6px 18px rgba(0,0,0,0.6),
    inset 0 1px 0 rgba(255,240,200,0.15);
  transform: translateY(-2px);
}
.dusk-class-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 0 rgba(0,0,0,0.7), 0 0 10px var(--accent, transparent);
  border: 1px solid rgba(255,255,255,0.18);
  background: radial-gradient(circle at 32% 28%, rgba(255,255,255,0.18), rgba(0,0,0,0.35) 70%), var(--accent, #555);
  box-shadow: 0 0 18px var(--accent, transparent), inset 0 0 12px rgba(0,0,0,0.4);
  margin-top: 4px;
}
.dusk-class-name {
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
  font-size: 17px;
  letter-spacing: 0.28em;
  color: #e8d8b0;
  text-transform: uppercase;
}
.dusk-class-resource {
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent, #c8a060);
  font-weight: 700;
}
.dusk-class-desc {
  font-size: 11px;
  line-height: 1.55;
  color: #a8a0a8;
  text-align: center;
  letter-spacing: 0.02em;
  margin-top: 2px;
}

.dusk-menu-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 380px;
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

interface ClassMeta {
  id: SelectableClass;
  name: string;
  letter: string;
  resource: string;
  accent: string; // hex
  desc: string;
}

const CLASSES: ClassMeta[] = [
  {
    id: 'rogue',
    name: 'Rogue',
    letter: 'R',
    resource: 'Energy',
    accent: '#5fc06a',
    desc: 'Strike from the shadows. Blades, smoke, and the storm.',
  },
  {
    id: 'barbarian',
    name: 'Barbarian',
    letter: 'B',
    resource: 'Rage',
    accent: '#e07a30',
    desc: 'Cleave, leap, and whirlwind through the unworthy.',
  },
  {
    id: 'sorcerer',
    name: 'Sorcerer',
    letter: 'S',
    resource: 'Mana',
    accent: '#5aa8ff',
    desc: 'Bolt, ice, lightning. Bend the storm to your will.',
  },
];

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function initMenu(ctx: GameContext): void {
  injectStyles();

  // Freeze the world while the menu is up.
  gameState.timeScale = 0;
  gameState.paused = true;

  const overlay = document.createElement('div');
  overlay.className = 'dusk-menu-overlay';
  overlay.setAttribute('data-ui', '');

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

  // Class selector
  const heading = document.createElement('div');
  heading.className = 'dusk-class-heading';
  heading.textContent = 'choose your class';
  card.appendChild(heading);

  const row = document.createElement('div');
  row.className = 'dusk-class-row';

  const cardEls: Record<SelectableClass, HTMLDivElement> = {} as Record<SelectableClass, HTMLDivElement>;

  for (const meta of CLASSES) {
    const el = document.createElement('div');
    el.className = 'dusk-class-card';
    el.style.setProperty('--accent', meta.accent);
    el.setAttribute('data-class', meta.id);

    const icon = document.createElement('div');
    icon.className = 'dusk-class-icon';
    icon.textContent = meta.letter;
    el.appendChild(icon);

    const name = document.createElement('div');
    name.className = 'dusk-class-name';
    name.textContent = meta.name;
    el.appendChild(name);

    const res = document.createElement('div');
    res.className = 'dusk-class-resource';
    res.textContent = meta.resource;
    el.appendChild(res);

    const desc = document.createElement('div');
    desc.className = 'dusk-class-desc';
    desc.textContent = meta.desc;
    el.appendChild(desc);

    el.addEventListener('click', () => {
      setClass(meta.id);
      refreshSelection();
    });

    cardEls[meta.id] = el;
    row.appendChild(el);
  }
  card.appendChild(row);

  function refreshSelection(): void {
    for (const meta of CLASSES) {
      const el = cardEls[meta.id];
      if (meta.id === gameState.selectedClass) el.classList.add('selected');
      else el.classList.remove('selected');
    }
  }
  refreshSelection();

  const hint = document.createElement('div');
  hint.className = 'dusk-menu-hint';
  hint.innerHTML = [
    '<b>LMB</b> to move &middot; <b>1</b> <b>2</b> <b>3</b> skills &middot; <b>Q</b> ultimate &middot; <b>SHIFT</b> dash',
    '<b>I</b> inventory &middot; walk into the <b>ABYSSAL CRYPT</b> to enter the dungeon',
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
    // Push the chosen class through the event bus so player + skills modules
    // sync color, resource kind, and hotbar slots before the world unpauses.
    ctx.world.emit('player:classChanged', { classId: gameState.selectedClass });

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
