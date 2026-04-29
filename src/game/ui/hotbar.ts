// Hotbar — dash slot + 4 ability slots. Cooldown overlays driven by SkillUser.slots[i].cooldownEnd.
// Layout: [SHIFT dash] | [1] [2] [3] [Q]

import type { GameContext } from '../state';
import type { SkillUserComponent } from '../../core/components';
import { C } from '../../core/components';
import { gameState } from '../state';

export interface HotbarSlotRefs {
  root: HTMLElement;
  cooldown: HTMLElement;
  cooldownText: HTMLElement;
  glyph: HTMLElement;
}

export interface HotbarRefs {
  root: HTMLElement;
  slots: HotbarSlotRefs[]; // index matches SkillUser.slots layout
}

// Layout config: slot index, key label, glyph color, glyph symbol, group ('dash' | 'main')
interface SlotDef {
  idx: number;
  key: string;
  color: string;
  glyph: string;
  group: 'dash' | 'main';
}

// SkillUser.slots: [0]=basic, [1-3]=actives, [4]=ult, [5]=dash
// Visual order: [SHIFT (5)] | [1] [2] [3] [Q (4)]
// (Slot 0 is the basic auto-attack — no hotbar tile, players just left-click.)
const LAYOUT: SlotDef[] = [
  { idx: 5, key: 'SHIFT', color: '#7898c0', glyph: '»', group: 'dash' },
  { idx: 1, key: '1', color: '#c87060', glyph: '◆', group: 'main' },
  { idx: 2, key: '2', color: '#60a8c8', glyph: '✦', group: 'main' },
  { idx: 3, key: '3', color: '#c8a060', glyph: '✺', group: 'main' },
  { idx: 4, key: 'Q', color: '#d040d0', glyph: '★', group: 'main' },
];

export function buildHotbar(ctx: GameContext): HotbarRefs {
  const bar = document.createElement('div');
  bar.className = 'dusk-hotbar';

  const slots: HotbarSlotRefs[] = [];

  // Dash slot (left, separate group)
  const dashGroup = document.createElement('div');
  dashGroup.className = 'dusk-hotbar-group dusk-hotbar-dash';
  // Main 4-slot group (right)
  const mainGroup = document.createElement('div');
  mainGroup.className = 'dusk-hotbar-group dusk-hotbar-main';

  for (const def of LAYOUT) {
    const slot = document.createElement('div');
    slot.className = 'dusk-slot';
    slot.dataset.idx = String(def.idx);

    const key = document.createElement('div');
    key.className = 'dusk-slot-key';
    key.textContent = def.key;
    slot.appendChild(key);

    const glyph = document.createElement('div');
    glyph.className = 'dusk-slot-glyph';
    glyph.textContent = def.glyph;
    glyph.style.background = `radial-gradient(circle at 35% 30%, ${def.color} 0%, ${tint(def.color, -50)} 90%)`;
    slot.appendChild(glyph);

    const cooldown = document.createElement('div');
    cooldown.className = 'dusk-slot-cd';
    slot.appendChild(cooldown);

    const cooldownText = document.createElement('div');
    cooldownText.className = 'dusk-slot-cd-text';
    slot.appendChild(cooldownText);

    if (def.group === 'dash') dashGroup.appendChild(slot);
    else mainGroup.appendChild(slot);

    // Pre-fill array sized to max idx so we can index by slot.idx directly.
    while (slots.length <= def.idx) {
      slots.push(null as unknown as HotbarSlotRefs);
    }
    slots[def.idx] = { root: slot, cooldown, cooldownText, glyph };
  }

  bar.appendChild(dashGroup);
  bar.appendChild(mainGroup);
  ctx.uiRoot.appendChild(bar);

  return { root: bar, slots };
}

export function updateHotbar(refs: HotbarRefs, elapsed: number): void {
  const player = gameState.player;
  if (!player) return;
  const su = player.components.get(C.SkillUser) as SkillUserComponent | undefined;
  if (!su) return;

  for (const def of LAYOUT) {
    const slotRefs = refs.slots[def.idx];
    if (!slotRefs) continue;
    const slot = su.slots[def.idx];
    if (!slot) continue;

    const remaining = Math.max(0, slot.cooldownEnd - elapsed);
    if (remaining > 0) {
      // Approximate cooldown total via lookup so we can render a clockwise sweep.
      // We don't have the original cooldown duration stored; use a soft 1s cap so
      // overlays still animate visibly even when we can't read the duration.
      // Visual sweep: full at start, empties as cooldown nears 0.
      const ratio = Math.min(1, remaining / Math.max(remaining + 0.01, 1));
      const angle = ratio * 360;
      slotRefs.cooldown.style.background = `conic-gradient(rgba(0,0,0,0.72) 0deg, rgba(0,0,0,0.72) ${angle}deg, transparent ${angle}deg, transparent 360deg)`;
      slotRefs.cooldown.style.opacity = '1';
      slotRefs.cooldownText.textContent = remaining >= 1
        ? `${Math.ceil(remaining)}`
        : remaining.toFixed(1);
      slotRefs.cooldownText.style.opacity = '1';
      slotRefs.root.classList.remove('dusk-slot-ready');
    } else {
      slotRefs.cooldown.style.opacity = '0';
      slotRefs.cooldownText.textContent = '';
      slotRefs.cooldownText.style.opacity = '0';
      slotRefs.root.classList.add('dusk-slot-ready');
    }
  }
}

// Tint helper: blends a hex color toward black (negative) or white (positive) by amount [-100..100].
function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount) / 100;
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `rgb(${r}, ${g}, ${b})`;
}
