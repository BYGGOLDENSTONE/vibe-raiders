// Channeled skill state: whirlwind, storm-of-blades, meteor wind-up, black-hole.
// One generic ticker drives all active channels each frame.

import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import { C, type MoveTargetComponent } from '../../core/components';

export interface ActiveChannel {
  id: string;
  caster: Entity;
  endTime: number;
  nextTickTime: number;
  tickInterval: number; // seconds; 0 means no per-tick callback (only finish)
  // Per-tick callback (called every `tickInterval`).
  onTick?: (caster: Entity, world: World, now: number) => void;
  // One-shot callback when channel completes naturally.
  onFinish?: (caster: Entity, world: World) => void;
  // If true, cancel the channel when caster moves (move target set).
  cancelOnMove: boolean;
  // If true, store and clear caster MoveTarget so the player roots in place.
  rootCaster: boolean;
}

const CHANNELS: ActiveChannel[] = [];

export function startChannel(c: ActiveChannel): void {
  // Cancel any prior channel from this caster — only one at a time.
  for (let i = CHANNELS.length - 1; i >= 0; i--) {
    if (CHANNELS[i]!.caster.id === c.caster.id) {
      CHANNELS.splice(i, 1);
    }
  }
  if (c.rootCaster) {
    const mt = c.caster.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (mt) mt.target = null;
  }
  CHANNELS.push(c);
}

export function isChanneling(casterId: number): boolean {
  for (const c of CHANNELS) if (c.caster.id === casterId) return true;
  return false;
}

// Tick all channels. Removes finished ones; calls onTick at intervals.
export function tickChannels(world: World): void {
  const now = performance.now() / 1000;
  for (let i = CHANNELS.length - 1; i >= 0; i--) {
    const ch = CHANNELS[i]!;
    if (!ch.caster.alive) {
      CHANNELS.splice(i, 1);
      continue;
    }
    // Cancel if caster started moving (and channel cares).
    if (ch.cancelOnMove) {
      const mt = ch.caster.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
      if (mt && mt.target !== null) {
        CHANNELS.splice(i, 1);
        continue;
      }
    }
    // If channel rooted caster, ensure they stay rooted (clear move target re-issued).
    if (ch.rootCaster) {
      const mt = ch.caster.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
      if (mt) mt.target = null;
    }

    if (ch.tickInterval > 0 && now >= ch.nextTickTime) {
      ch.nextTickTime = now + ch.tickInterval;
      if (ch.onTick) ch.onTick(ch.caster, world, now);
    }

    if (now >= ch.endTime) {
      if (ch.onFinish) ch.onFinish(ch.caster, world);
      CHANNELS.splice(i, 1);
    }
  }
}
