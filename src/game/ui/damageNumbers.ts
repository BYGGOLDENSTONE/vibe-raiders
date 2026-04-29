// D4-style floating damage numbers with arc trajectory + crit thump.
// Spawns from world position, projects to screen, simulates 2D physics in
// screen space (initial vy upward, vx horizontal jitter, gravity decay).
// Crit hits are bigger, gold-shimmer, and emit a screenshake "thump" cue.
//
// Subscribes to 'fx:floatingText' on the world bus (the same event the
// existing fx/floatingText already handles). Both layers render — this one
// is a higher-z, chunkier overlay.

import type { GameContext } from '../state';
import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { ELEMENT_COLORS, type ElementKind } from '../fx/elements';

const MAX_LIVE = 24;
const POOL_PRESET = 28;
const LIFETIME = 0.9;
const CRIT_LIFETIME = 1.05;
const GRAVITY_PX_S2 = 280;

interface Slot {
  el: HTMLDivElement;
  active: boolean;
  age: number;
  life: number;
  // Anchor in world space (so it follows the camera correctly).
  world: Vector3;
  // Screen-space velocity (px/s) applied after projection.
  vx: number;
  vy: number;
  // Cached screen-space offset accumulated from velocity each frame.
  offX: number;
  offY: number;
  isCrit: boolean;
  baseSize: number;
  hue: string;
  altHue: string;
}

export interface DamageNumbers {
  update(realDt: number, camera: PerspectiveCamera, viewportW: number, viewportH: number): void;
  dispose(): void;
}

function hexToCss(hex: number): string {
  return '#' + (hex & 0xffffff).toString(16).padStart(6, '0');
}

function injectStyles(): void {
  const ID = 'dusk-dmg-style';
  if (document.getElementById(ID)) return;
  const s = document.createElement('style');
  s.id = ID;
  s.textContent = `
.dusk-dmg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 8;
}
.dusk-dmg-num {
  position: absolute;
  left: 0; top: 0;
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
  font-weight: 900;
  letter-spacing: 0.02em;
  white-space: nowrap;
  will-change: transform, opacity;
  transform: translate(-9999px,-9999px);
  text-shadow:
    0 0 4px rgba(0,0,0,0.95),
    0 2px 4px rgba(0,0,0,0.95),
    0 0 12px var(--dmg-halo, rgba(0,0,0,0.7));
}
.dusk-dmg-crit {
  font-style: italic;
  animation: dusk-dmg-crit-shimmer 0.5s ease-out;
}
@keyframes dusk-dmg-crit-shimmer {
  0%   { filter: brightness(2.4) saturate(1.6); transform-origin: center; }
  40%  { filter: brightness(1.6) saturate(1.3); }
  100% { filter: brightness(1) saturate(1); }
}
`;
  document.head.appendChild(s);
}

function pickElementForColor(hex: number): ElementKind | null {
  // Reverse-lookup the closest element from ELEMENT_COLORS so callers passing
  // a generic damage color still get an element-themed overlay halo.
  const target = hex & 0xffffff;
  let best: ElementKind | null = null;
  let bestD = Infinity;
  for (const k in ELEMENT_COLORS) {
    const v = ELEMENT_COLORS[k as ElementKind];
    const dr = ((v >> 16) & 0xff) - ((target >> 16) & 0xff);
    const dg = ((v >> 8) & 0xff) - ((target >> 8) & 0xff);
    const db = (v & 0xff) - (target & 0xff);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = k as ElementKind; }
  }
  return best;
}

export function initDamageNumbers(ctx: GameContext): DamageNumbers {
  injectStyles();

  const layer = document.createElement('div');
  layer.className = 'dusk-dmg-layer';
  ctx.uiRoot.appendChild(layer);

  const slots: Slot[] = [];
  const _proj = new Vector3();

  const makeSlot = (): Slot => {
    const el = document.createElement('div');
    el.className = 'dusk-dmg-num';
    layer.appendChild(el);
    return {
      el, active: false, age: 0, life: LIFETIME,
      world: new Vector3(), vx: 0, vy: 0, offX: 0, offY: 0,
      isCrit: false, baseSize: 18, hue: '#ffffff', altHue: '#ffffff',
    };
  };
  for (let i = 0; i < POOL_PRESET; i++) slots.push(makeSlot());

  const findSlot = (): Slot => {
    for (const s of slots) if (!s.active) return s;
    if (slots.length < MAX_LIVE) {
      const s = makeSlot();
      slots.push(s);
      return s;
    }
    let oldest = slots[0]!;
    for (const s of slots) if (s.active && s.age > oldest.age) oldest = s;
    return oldest;
  };

  const spawn = (
    x: number, y: number, z: number,
    text: string, hexColor: number, isCrit: boolean,
  ): void => {
    const s = findSlot();
    s.active = true;
    s.age = 0;
    s.life = isCrit ? CRIT_LIFETIME : LIFETIME;
    s.world.set(x, y + 0.4, z);
    s.vx = (Math.random() - 0.5) * 60;          // ±30 px/s horizontal
    s.vy = -(140 + Math.random() * 60);         // upward (screen-y is inverted)
    s.offX = 0;
    s.offY = 0;
    s.isCrit = isCrit;
    s.baseSize = isCrit ? 30 : 18;
    s.hue = hexToCss(hexColor);
    const elKind = pickElementForColor(hexColor);
    s.altHue = elKind ? hexToCss(ELEMENT_COLORS[elKind]) : s.hue;

    s.el.textContent = isCrit ? `${text}!` : text;
    s.el.style.color = isCrit ? '#fff5d8' : s.hue;
    s.el.style.fontSize = `${s.baseSize}px`;
    s.el.style.opacity = '1';
    s.el.style.setProperty('--dmg-halo', isCrit
      ? 'rgba(255,210,120,0.9)'
      : `rgba(${parseInt(s.hue.slice(1, 3), 16)},${parseInt(s.hue.slice(3, 5), 16)},${parseInt(s.hue.slice(5, 7), 16)},0.6)`);
    if (isCrit) s.el.classList.add('dusk-dmg-crit');
    else s.el.classList.remove('dusk-dmg-crit');
  };

  // Subscribe to the same event existing fx layer reads — both render but ours
  // is the visually dominant one. fx:floatingText doesn't carry isCrit; we infer
  // from text starting with "!" or being a damage number — for true crit info we
  // also subscribe to damage:dealt and re-spawn ours when a crit lands.
  ctx.world.on('fx:floatingText', ({ x, y, z, text, color }) => {
    spawn(x, y, z, text, color, false);
  });

  ctx.world.on('damage:dealt', (p) => {
    if (!p.isCrit || p.amount <= 0) return;
    const target = ctx.world.get(p.targetId);
    if (!target) return;
    const pos = target.object3d.position;
    // Re-spawn a crit-styled overlay; the regular text was already added above.
    spawn(pos.x, pos.y, pos.z, String(Math.ceil(p.amount)), 0xffe080, true);
    // Trigger a small extra screenshake "thump" — fx already handles isCrit
    // so we keep this gentle.
    ctx.world.emit('fx:screenshake', { amplitude: 0.15, duration: 0.1 });
  });

  const update = (
    realDt: number,
    camera: PerspectiveCamera,
    vw: number, vh: number,
  ): void => {
    for (const s of slots) {
      if (!s.active) continue;
      s.age += realDt;
      if (s.age >= s.life) {
        s.active = false;
        s.el.style.transform = 'translate(-9999px,-9999px)';
        s.el.style.opacity = '0';
        continue;
      }
      // Integrate screen-space velocity with gravity.
      s.vy += GRAVITY_PX_S2 * realDt;
      s.offX += s.vx * realDt;
      s.offY += s.vy * realDt;
      // Drag.
      s.vx *= Math.pow(0.86, realDt * 60);

      // Project world anchor to NDC.
      _proj.copy(s.world).project(camera);
      if (_proj.z > 1) {
        s.el.style.transform = 'translate(-9999px,-9999px)';
        continue;
      }
      const sx = (_proj.x * 0.5 + 0.5) * vw + s.offX;
      const sy = (-_proj.y * 0.5 + 0.5) * vh + s.offY;

      const t = s.age / s.life;
      // Pop-in scale 0.8 → 1.0 in first 12%.
      const popPhase = Math.min(1, t / 0.12);
      const baseScale = s.isCrit ? 1.15 : 1.0;
      const scale = (0.7 + 0.3 * popPhase) * baseScale * (s.isCrit
        ? 1 + Math.sin(s.age * 26) * 0.04
        : 1);
      // Fade out in last 35%.
      const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;

      // Crit color shimmer: lerp gold → white.
      if (s.isCrit) {
        const k = Math.min(1, t * 2.5);
        // Cheap lerp via setting color tone.
        s.el.style.color = k < 0.5 ? '#fff0b0' : '#ffffff';
      }

      s.el.style.transform =
        `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
      s.el.style.opacity = alpha.toFixed(3);
    }
  };

  // Self-driven rAF tick (independent of world tick so crit shimmer stays
  // smooth during hitstop/pause).
  let last = performance.now();
  let raf = 0;
  let disposed = false;
  const tick = (): void => {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    update(dt, ctx.camera, window.innerWidth, window.innerHeight);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    update,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      for (const s of slots) s.el.remove();
      layer.remove();
    },
  };
}
