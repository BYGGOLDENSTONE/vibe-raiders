// Tween / scheduled-callback registry for movement skills (leap arc) and delayed effects (meteor).

import { Vector3 } from 'three';
import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import { C, type MoveTargetComponent } from '../../core/components';

interface LeapTween {
  kind: 'leap';
  caster: Entity;
  startTime: number;
  duration: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  baseY: number; // where to land (usually 0.9 player y)
  arcHeight: number;
  onLand?: (caster: Entity, world: World) => void;
}

interface DelayedCall {
  kind: 'delay';
  startTime: number;
  fireAt: number;
  fired: boolean;
  fn: (world: World) => void;
}

type Tween = LeapTween | DelayedCall;
const TWEENS: Tween[] = [];

export function startLeap(opts: {
  caster: Entity;
  toX: number;
  toZ: number;
  duration: number;
  arcHeight: number;
  onLand?: (caster: Entity, world: World) => void;
}): void {
  const now = performance.now() / 1000;
  // Cancel any previous leap on same caster.
  for (let i = TWEENS.length - 1; i >= 0; i--) {
    const t = TWEENS[i]!;
    if (t.kind === 'leap' && t.caster.id === opts.caster.id) TWEENS.splice(i, 1);
  }
  const fromX = opts.caster.object3d.position.x;
  const fromZ = opts.caster.object3d.position.z;
  const baseY = opts.caster.object3d.position.y;
  // Clear any move target so locomotion doesn't fight us.
  const mt = opts.caster.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
  if (mt) mt.target = null;
  TWEENS.push({
    kind: 'leap',
    caster: opts.caster,
    startTime: now,
    duration: opts.duration,
    fromX, fromZ,
    toX: opts.toX, toZ: opts.toZ,
    baseY,
    arcHeight: opts.arcHeight,
    onLand: opts.onLand,
  });
}

export function scheduleAfter(seconds: number, fn: (world: World) => void): void {
  const now = performance.now() / 1000;
  TWEENS.push({
    kind: 'delay',
    startTime: now,
    fireAt: now + seconds,
    fired: false,
    fn,
  });
}

export function tickTweens(world: World): void {
  const now = performance.now() / 1000;
  for (let i = TWEENS.length - 1; i >= 0; i--) {
    const t = TWEENS[i]!;
    if (t.kind === 'leap') {
      if (!t.caster.alive) { TWEENS.splice(i, 1); continue; }
      const k = Math.min(1, (now - t.startTime) / t.duration);
      const x = t.fromX + (t.toX - t.fromX) * k;
      const z = t.fromZ + (t.toZ - t.fromZ) * k;
      const arc = Math.sin(k * Math.PI) * t.arcHeight;
      t.caster.object3d.position.x = x;
      t.caster.object3d.position.z = z;
      t.caster.object3d.position.y = t.baseY + arc;
      // Face direction of leap.
      const dx = t.toX - t.fromX;
      const dz = t.toZ - t.fromZ;
      if (Math.hypot(dx, dz) > 1e-3) {
        t.caster.object3d.rotation.y = Math.atan2(dx, dz);
      }
      if (k >= 1) {
        t.caster.object3d.position.y = t.baseY;
        if (t.onLand) t.onLand(t.caster, world);
        TWEENS.splice(i, 1);
      }
    } else if (t.kind === 'delay') {
      if (!t.fired && now >= t.fireAt) {
        t.fired = true;
        t.fn(world);
        TWEENS.splice(i, 1);
      }
    }
  }
}

// Instant teleport helper (blink, shadow-step). Just sets position, does not animate.
export function teleportEntity(e: Entity, x: number, z: number): void {
  e.object3d.position.x = x;
  e.object3d.position.z = z;
  // Clear any active move target.
  const mt = e.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
  if (mt) mt.target = null;
}

// Slide-style dash: tween caster to point over `duration` (no arc), used for rogue:roll & sorc:blink visual sugar.
export function startSlide(opts: {
  caster: Entity;
  toX: number;
  toZ: number;
  duration: number;
  onLand?: (caster: Entity, world: World) => void;
}): void {
  // Reuse the leap tween machinery with arcHeight 0.
  startLeap({
    caster: opts.caster,
    toX: opts.toX,
    toZ: opts.toZ,
    duration: opts.duration,
    arcHeight: 0,
    onLand: opts.onLand,
  });
}

// Re-export Vector3 for callers that need ad-hoc math.
export { Vector3 };
