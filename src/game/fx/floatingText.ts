// Floating damage numbers. DOM-based for cheap text. Pooled to cap GC pressure.

import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

const MAX_LIVE = 30;
const POOL_PRESET = 32;
const LIFETIME = 0.85; // seconds
const RISE_DISTANCE = 1.2; // world units rise

interface Slot {
  el: HTMLDivElement;
  active: boolean;
  worldPos: Vector3;
  startWorldY: number;
  age: number;
  baseSize: number;
}

export interface FloatingText {
  spawn(x: number, y: number, z: number, text: string, hexColor: number, magnitude?: number): void;
  update(realDt: number, camera: PerspectiveCamera, viewportW: number, viewportH: number): void;
  dispose(): void;
}

function hexToCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

export function createFloatingText(host: HTMLElement): FloatingText {
  const layer = document.createElement('div');
  layer.style.cssText = [
    'position:absolute',
    'inset:0',
    'pointer-events:none',
    'overflow:hidden',
    'z-index:5',
  ].join(';');
  host.appendChild(layer);

  const slots: Slot[] = [];
  const _proj = new Vector3();

  function makeSlot(): Slot {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'transform:translate(-9999px,-9999px)',
      'font-family:ui-monospace,Menlo,Consolas,monospace',
      'font-weight:800',
      'text-shadow:0 0 4px rgba(0,0,0,0.85),0 1px 2px rgba(0,0,0,0.95)',
      'will-change:transform,opacity',
      'pointer-events:none',
      'white-space:nowrap',
      'letter-spacing:0.02em',
    ].join(';');
    layer.appendChild(el);
    return {
      el,
      active: false,
      worldPos: new Vector3(),
      startWorldY: 0,
      age: 0,
      baseSize: 16,
    };
  }

  for (let i = 0; i < POOL_PRESET; i++) slots.push(makeSlot());

  function findSlot(): Slot {
    for (const s of slots) if (!s.active) return s;
    if (slots.length < MAX_LIVE) {
      const s = makeSlot();
      slots.push(s);
      return s;
    }
    // Steal the oldest active.
    let oldest = slots[0]!;
    for (const s of slots) if (s.active && s.age > oldest.age) oldest = s;
    return oldest;
  }

  return {
    spawn(x, y, z, text, hexColor, magnitude = 1) {
      const s = findSlot();
      s.active = true;
      s.worldPos.set(x, y, z);
      s.startWorldY = y;
      s.age = 0;
      // 14..22 px based on magnitude (0..1+ scale).
      const m = Math.max(0, Math.min(1.5, magnitude));
      s.baseSize = 14 + m * 8;
      s.el.textContent = text;
      s.el.style.color = hexToCss(hexColor);
      s.el.style.fontSize = `${s.baseSize}px`;
      s.el.style.opacity = '1';
    },
    update(realDt, camera, viewportW, viewportH) {
      for (const s of slots) {
        if (!s.active) continue;
        s.age += realDt;
        if (s.age >= LIFETIME) {
          s.active = false;
          s.el.style.transform = 'translate(-9999px,-9999px)';
          s.el.style.opacity = '0';
          continue;
        }
        const t = s.age / LIFETIME;
        // Rise.
        s.worldPos.y = s.startWorldY + RISE_DISTANCE * t;

        // Project.
        _proj.copy(s.worldPos).project(camera);
        if (_proj.z > 1) {
          // Behind camera.
          s.el.style.transform = 'translate(-9999px,-9999px)';
          continue;
        }
        const sx = (_proj.x * 0.5 + 0.5) * viewportW;
        const sy = (-_proj.y * 0.5 + 0.5) * viewportH;

        // Scale: 1 -> 1.2 -> 1.
        const scale = t < 0.25
          ? 1 + (t / 0.25) * 0.2
          : 1.2 - ((t - 0.25) / 0.75) * 0.2;
        // Fade in last 40%.
        const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;

        s.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
        s.el.style.opacity = alpha.toFixed(3);
      }
    },
    dispose() {
      for (const s of slots) s.el.remove();
      layer.remove();
    },
  };
}
