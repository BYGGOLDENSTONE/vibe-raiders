// Buy VFX — particle bursts, ring shockwave, drain flashes.
// Renders into a portal layer (#fx-layer) so it's always on top and never
// clipped by overflow:hidden parents.

import type { Empire } from './empire';
import { RESOURCE_COLOR, type ResourceKey, type UpgradeNode } from './types';
import { sfxBuy, sfxError } from '../audio/sfx';

function ensureFxLayer(): HTMLDivElement {
  let el = document.getElementById('fx-layer') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx-layer';
    el.className = 'fx-layer';
    document.body.appendChild(el);
  }
  return el;
}

function spawnEl(
  parent: HTMLElement,
  className: string,
  styles: Record<string, string>,
  lifetimeMs: number,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  for (const k in styles) el.style.setProperty(k, styles[k]!);
  parent.appendChild(el);
  setTimeout(() => el.remove(), lifetimeMs);
  return el;
}

// Spawn a full burst at viewport coordinates (x, y) with a given accent color.
export function spawnBurst(x: number, y: number, color = '#7ec8ff'): void {
  const layer = ensureFxLayer();
  const burst = document.createElement('div');
  burst.className = 'fx-burst';
  burst.style.left = `${x}px`;
  burst.style.top = `${y}px`;
  burst.style.setProperty('--c', color);
  layer.appendChild(burst);

  spawnEl(burst, 'fx-flash', { '--c': color }, 520);
  spawnEl(burst, 'fx-ring', { '--c': color }, 800);
  spawnEl(burst, 'fx-ring delay', { '--c': color }, 880);

  for (let i = 0; i < 8; i++) {
    const rot = (i * 360) / 8 + (Math.random() * 30 - 15);
    spawnEl(burst, 'fx-spark', { '--c': color, '--rot': `${rot}deg` }, 700);
  }

  const N = 18;
  for (let i = 0; i < N; i++) {
    const ang = (i * Math.PI * 2) / N + Math.random() * 0.4;
    const dist = 60 + Math.random() * 80;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    const dur = 600 + Math.random() * 500;
    const size = (3 + Math.random() * 3).toFixed(2);
    spawnEl(
      burst,
      'fx-particle',
      {
        '--c': color,
        '--dx': `${dx}px`,
        '--dy': `${dy}px`,
        '--dur': `${dur}ms`,
        width: `${size}px`,
        height: `${size}px`,
      },
      dur + 50,
    );
  }

  setTimeout(() => burst.remove(), 1200);
}

// Floating text (e.g. "UNLOCKED").
export function spawnFloatText(x: number, y: number, text: string, color = '#fff'): void {
  const layer = ensureFxLayer();
  const el = document.createElement('div');
  el.className = 'fx-text';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty('--c', color);
  el.textContent = text;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// Drain pulse — flies a single particle from a HUD chip toward the buy button.
export function spawnDrain(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color = '#fff',
): void {
  const layer = ensureFxLayer();
  const burst = document.createElement('div');
  burst.className = 'fx-burst';
  burst.style.left = `${fromX}px`;
  burst.style.top = `${fromY}px`;
  burst.style.setProperty('--c', color);
  layer.appendChild(burst);
  const dx = toX - fromX;
  const dy = toY - fromY;
  spawnEl(
    burst,
    'fx-particle',
    {
      '--c': color,
      '--dx': `${dx}px`,
      '--dy': `${dy}px`,
      '--dur': '700ms',
      width: '6px',
      height: '6px',
    },
    800,
  );
  setTimeout(() => burst.remove(), 800);
}

// Flash a HUD chip (resource bar shake + tint).
export function flashHudChip(resourceKey: ResourceKey): void {
  const chip = document.querySelector<HTMLElement>(`.em-chip[data-resource="${resourceKey}"]`);
  if (!chip) return;
  chip.classList.remove('fx-drain');
  // force reflow so animation restarts
  void chip.offsetWidth;
  chip.classList.add('fx-drain');
  setTimeout(() => chip.classList.remove('fx-drain'), 600);
}

// Mark a tier card as just-bought (CSS animation).
export function flashTierCard(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.classList.remove('fx-bought');
  void el.offsetWidth;
  el.classList.add('fx-bought');
  setTimeout(() => el.classList.remove('fx-bought'), 950);
}

// Standard wrapper: instant buy, then play VFX in parallel (non-blocking).
// The actual purchase fires synchronously so the player never feels lag —
// drain particles, burst, and tier flash run purely as visuals afterwards.
export function buyWithVfx(
  empire: Empire,
  node: UpgradeNode,
  anchorEl: HTMLElement | null,
  color: string,
): void {
  if (!anchorEl) {
    empire.buy(node.id);
    return;
  }
  const r = anchorEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  // Drain particles + chip shake from each consumed resource.
  for (const k in node.cost) {
    const key = k as ResourceKey;
    const chip = document.querySelector<HTMLElement>(`.em-chip[data-resource="${key}"]`);
    if (chip) {
      const cr = chip.getBoundingClientRect();
      spawnDrain(cr.left + cr.width / 2, cr.top + cr.height / 2, cx, cy, RESOURCE_COLOR[key]);
      flashHudChip(key);
    }
  }

  // Buy now — this triggers the panel to rebuild via empire.subscribe.
  const ok = empire.buy(node.id);
  if (!ok) {
    sfxError();
    return;
  }
  sfxBuy();

  // Burst + UNLOCKED text fire immediately at the click point. The tier card
  // gets rebuilt by the panel refresh, so we look up the new card by node id
  // on the next frame and flash that one instead of the now-detached anchor.
  spawnBurst(cx, cy, color);
  spawnFloatText(cx, cy - 8, 'UNLOCKED', color);
  requestAnimationFrame(() => {
    const newCard = document.querySelector<HTMLElement>(
      `.bb-tier[data-node-id="${node.id}"]`,
    );
    flashTierCard(newCard);
  });
}
