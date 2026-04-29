// Shared helpers for skill casts: targeting queries, AoE damage, status effects, FX juice.

import { Vector3 } from 'three';
import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import {
  C,
  type CombatantComponent,
  type StatusEffect,
  type StatusEffectsComponent,
} from '../../core/components';

const tmpA = new Vector3();
const tmpB = new Vector3();

export function nearestHostile(world: World, fromX: number, fromZ: number, maxRange: number): Entity | null {
  let best: Entity | null = null;
  let bestDist = maxRange;
  for (const e of world.query('hostile')) {
    const dx = e.object3d.position.x - fromX;
    const dz = e.object3d.position.z - fromZ;
    const d = Math.hypot(dx, dz);
    if (d <= bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

export function hostilesInRadius(world: World, x: number, z: number, radius: number): Entity[] {
  const out: Entity[] = [];
  const r2 = radius * radius;
  for (const e of world.query('hostile')) {
    const dx = e.object3d.position.x - x;
    const dz = e.object3d.position.z - z;
    if (dx * dx + dz * dz <= r2) out.push(e);
  }
  return out;
}

export function hostilesInCone(
  world: World,
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  range: number,
  halfAngleRad: number,
): Entity[] {
  const out: Entity[] = [];
  const r2 = range * range;
  const dl = Math.hypot(dirX, dirZ) || 1;
  const ndx = dirX / dl;
  const ndz = dirZ / dl;
  const cosLimit = Math.cos(halfAngleRad);
  for (const e of world.query('hostile')) {
    const ex = e.object3d.position.x - originX;
    const ez = e.object3d.position.z - originZ;
    const d2 = ex * ex + ez * ez;
    if (d2 > r2 || d2 < 1e-6) continue;
    const inv = 1 / Math.sqrt(d2);
    const dot = (ex * ndx + ez * ndz) * inv;
    if (dot >= cosLimit) out.push(e);
  }
  return out;
}

export function dealDamage(
  world: World,
  sourceId: number,
  target: Entity,
  amount: number,
  isCrit: boolean,
  hitColor: number,
): void {
  world.emit('damage:dealt', {
    sourceId,
    targetId: target.id,
    amount,
    isCrit,
  });
  world.emit('fx:hit', {
    x: target.object3d.position.x,
    y: target.object3d.position.y + 1.0,
    z: target.object3d.position.z,
    color: hitColor,
    isCrit,
  });
}

export function rollCrit(caster: Entity): boolean {
  const combatant = caster.components.get(C.Combatant) as CombatantComponent | undefined;
  if (!combatant) return false;
  return Math.random() < combatant.critChance;
}

export function critMult(caster: Entity): number {
  const combatant = caster.components.get(C.Combatant) as CombatantComponent | undefined;
  return combatant?.critMult ?? 2;
}

export function applyStatus(target: Entity, effect: StatusEffect): void {
  let bag = target.components.get(C.StatusEffects) as StatusEffectsComponent | undefined;
  if (!bag) {
    bag = { effects: [] };
    target.components.set(C.StatusEffects, bag);
  }
  // Refresh existing effect if same id, else push
  const existing = bag.effects.find((e) => e.id === effect.id);
  if (existing) {
    existing.endTime = Math.max(existing.endTime, effect.endTime);
    existing.power = Math.max(existing.power, effect.power);
  } else {
    bag.effects.push(effect);
  }
}

export function juiceHit(world: World, opts: {
  hitstop?: number;
  shake?: { amplitude: number; duration: number };
  sfx?: string;
  x?: number;
  z?: number;
}): void {
  if (opts.hitstop && opts.hitstop > 0) {
    world.emit('fx:hitstop', { duration: opts.hitstop });
  }
  if (opts.shake) {
    world.emit('fx:screenshake', { amplitude: opts.shake.amplitude, duration: opts.shake.duration });
  }
  if (opts.sfx) {
    world.emit('audio:sfx', { id: opts.sfx, x: opts.x, z: opts.z });
  }
}

// Compute XZ direction from caster to target point. If too close, fall back to caster facing (rotation.y).
export function dirFromCasterToPoint(caster: Entity, tx: number, tz: number, out: Vector3): Vector3 {
  const px = caster.object3d.position.x;
  const pz = caster.object3d.position.z;
  const dx = tx - px;
  const dz = tz - pz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) {
    const yaw = caster.object3d.rotation.y;
    out.set(Math.sin(yaw), 0, Math.cos(yaw));
  } else {
    out.set(dx / len, 0, dz / len);
  }
  return out;
}

// Clamp a target point to be within `maxRange` of caster on XZ plane.
export function clampPointToRange(
  caster: Entity,
  tx: number,
  tz: number,
  maxRange: number,
): { x: number; z: number } {
  const px = caster.object3d.position.x;
  const pz = caster.object3d.position.z;
  const dx = tx - px;
  const dz = tz - pz;
  const d = Math.hypot(dx, dz);
  if (d <= maxRange || d < 1e-6) return { x: tx, z: tz };
  const k = maxRange / d;
  return { x: px + dx * k, z: pz + dz * k };
}

// Briefly mark caster invulnerable (for dashes / dodges).
export function grantInvuln(target: Entity, durationSec: number): void {
  const health = target.components.get(C.Health) as { invulnUntil: number } | undefined;
  if (!health) return;
  const now = performance.now() / 1000;
  health.invulnUntil = Math.max(health.invulnUntil, now + durationSec);
}

// Re-export a couple of work vectors so skill files can avoid allocating.
export const TMP_A = tmpA;
export const TMP_B = tmpB;
