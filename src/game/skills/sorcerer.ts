// Sorcerer skills: mana resource, ranged casts, freeze + chain + meteor + black hole.

import { Vector3 } from 'three';
import type { Skill } from './types';
import {
  applyStatus,
  clampPointToRange,
  critMult,
  dealDamage,
  dirFromCasterToPoint,
  grantInvuln,
  hostilesInRadius,
  juiceHit,
  nearestHostile,
  rollCrit,
} from './helpers';
import { spawnPlayerProjectile } from './projectiles';
import { startChannel } from './channels';
import { scheduleAfter, teleportEntity } from './tweens';
import type { Entity } from '../../core/types';

const HIT_COLOR_ARCANE = 0x80c8ff;
const HIT_COLOR_FROST = 0xa0f0ff;
const HIT_COLOR_LIGHTNING = 0xfff080;
const HIT_COLOR_FIRE = 0xff8030;

export const SORC_SKILLS: Skill[] = [
  // SLOT 0 — Bolt: homing magic missile, 12 dmg, no cost, CD 0.5s.
  {
    id: 'sorc:bolt',
    name: 'Magic Bolt',
    classId: 'sorcerer',
    slotIndex: 0,
    cooldown: 0.5,
    cost: 0,
    range: 12,
    cast: (caster, world, _target) => {
      const target = nearestHostile(world, caster.object3d.position.x, caster.object3d.position.z, 12);
      if (!target) return;
      const dir = new Vector3();
      dirFromCasterToPoint(caster, target.object3d.position.x, target.object3d.position.z, dir);
      caster.object3d.rotation.y = Math.atan2(dir.x, dir.z);
      const isCrit = rollCrit(caster);
      const dmg = isCrit ? 12 * critMult(caster) : 12;
      const origin = new Vector3(caster.object3d.position.x, 1.0, caster.object3d.position.z);
      spawnPlayerProjectile(world, {
        kind: 'magic-bolt',
        origin,
        dir,
        speed: 18,
        damage: dmg,
        lifetime: 2,
        hitRadius: 0.3,
        ownerId: caster.id,
        homing: true,
        homingEntityId: target.id,
        hitColor: HIT_COLOR_ARCANE,
        isCrit,
      });
      juiceHit(world, { sfx: 'bolt-cast' });
    },
  },

  // SLOT 1 — Ice Nova: AoE 5m around caster, 20 dmg + freeze (stun) 1.5s.
  {
    id: 'sorc:ice-nova',
    name: 'Ice Nova',
    classId: 'sorcerer',
    slotIndex: 1,
    cooldown: 8,
    cost: 30,
    range: 0,
    cast: (caster, world, _target) => {
      const px = caster.object3d.position.x;
      const pz = caster.object3d.position.z;
      const enemies = hostilesInRadius(world, px, pz, 5);
      const now = performance.now() / 1000;
      for (const e of enemies) {
        const isCrit = rollCrit(caster);
        const dmg = isCrit ? 20 * critMult(caster) : 20;
        dealDamage(world, caster.id, e, dmg, isCrit, HIT_COLOR_FROST);
        applyStatus(e, { id: 'stun', endTime: now + 1.5, power: 1 });
        applyStatus(e, { id: 'frozen', endTime: now + 1.5, power: 1 });
      }
      world.emit('fx:hit', { x: px, y: 0.4, z: pz, color: HIT_COLOR_FROST, isCrit: false });
      juiceHit(world, {
        hitstop: 0.06,
        shake: { amplitude: 0.18, duration: 0.2 },
        sfx: 'ice-nova',
        x: px, z: pz,
      });
    },
  },

  // SLOT 2 — Chain Lightning: zap nearest in 10m, chain to 4 within 6m of each previous.
  {
    id: 'sorc:chain-lightning',
    name: 'Chain Lightning',
    classId: 'sorcerer',
    slotIndex: 2,
    cooldown: 6,
    cost: 35,
    range: 10,
    cast: (caster, world, _target) => {
      const px = caster.object3d.position.x;
      const pz = caster.object3d.position.z;
      const first = nearestHostile(world, px, pz, 10);
      if (!first) return;
      const visited = new Set<number>();
      const chain: Entity[] = [];
      chain.push(first);
      visited.add(first.id);
      // Chain up to 4 jumps (5 total hits).
      let prev = first;
      for (let i = 0; i < 4; i++) {
        let next: Entity | null = null;
        let bestD = 6;
        for (const h of world.query('hostile')) {
          if (visited.has(h.id)) continue;
          const dx = h.object3d.position.x - prev.object3d.position.x;
          const dz = h.object3d.position.z - prev.object3d.position.z;
          const d = Math.hypot(dx, dz);
          if (d <= bestD) {
            bestD = d;
            next = h;
          }
        }
        if (!next) break;
        chain.push(next);
        visited.add(next.id);
        prev = next;
      }
      // Apply damage with 80% decay per hop.
      let dmg = 18;
      for (const e of chain) {
        const isCrit = rollCrit(caster);
        const final = isCrit ? dmg * critMult(caster) : dmg;
        dealDamage(world, caster.id, e, final, isCrit, HIT_COLOR_LIGHTNING);
        dmg *= 0.8;
      }
      juiceHit(world, {
        hitstop: 0.05,
        shake: { amplitude: 0.15, duration: 0.18 },
        sfx: 'chain-lightning',
        x: first.object3d.position.x,
        z: first.object3d.position.z,
      });
    },
  },

  // SLOT 3 — Meteor: channel 1s, then meteor falls at point, AoE 5m, 60 dmg + burn 5dps for 4s.
  {
    id: 'sorc:meteor',
    name: 'Meteor',
    classId: 'sorcerer',
    slotIndex: 3,
    cooldown: 12,
    cost: 50,
    range: 18,
    cast: (caster, world, target) => {
      const p = clampPointToRange(caster, target.x, target.z, 18);
      // Telegraph cue at point.
      world.emit('fx:hit', { x: p.x, y: 0.2, z: p.z, color: HIT_COLOR_FIRE, isCrit: false });
      juiceHit(world, { sfx: 'meteor-windup', x: p.x, z: p.z });
      const casterId = caster.id;
      scheduleAfter(1.0, (w) => {
        const enemies = hostilesInRadius(w, p.x, p.z, 5);
        const now = performance.now() / 1000;
        for (const e of enemies) {
          const isCrit = Math.random() < 0.1;
          const dmg = isCrit ? 60 * 2 : 60;
          dealDamage(w, casterId, e, dmg, isCrit, HIT_COLOR_FIRE);
          applyStatus(e, { id: 'burn', endTime: now + 4, power: 5 });
        }
        w.emit('fx:hit', { x: p.x, y: 0.5, z: p.z, color: HIT_COLOR_FIRE, isCrit: false });
        w.emit('fx:hitstop', { duration: 0.12 });
        w.emit('fx:screenshake', { amplitude: 0.5, duration: 0.4 });
        w.emit('audio:sfx', { id: 'meteor-impact', x: p.x, z: p.z });
      });
    },
  },

  // SLOT 4 — Black Hole (ult): pull enemies in 8m toward point, then 4s of 8 dmg/sec in 4m.
  {
    id: 'sorc:black-hole',
    name: 'Black Hole',
    classId: 'sorcerer',
    slotIndex: 4,
    cooldown: 35,
    cost: 70,
    range: 18,
    cast: (caster, world, target) => {
      const p = clampPointToRange(caster, target.x, target.z, 18);
      const now = performance.now() / 1000;
      // Pull all hostiles within 8m at start (simple impulse — teleport them halfway in).
      const pullEnemies = hostilesInRadius(world, p.x, p.z, 8);
      for (const e of pullEnemies) {
        const dx = p.x - e.object3d.position.x;
        const dz = p.z - e.object3d.position.z;
        const d = Math.hypot(dx, dz) || 1;
        // Pull 60% of distance toward p, leaving them clustered near the AoE.
        e.object3d.position.x += (dx / d) * d * 0.6;
        e.object3d.position.z += (dz / d) * d * 0.6;
        applyStatus(e, { id: 'stun', endTime: now + 0.5, power: 1 });
      }
      // Damage every 0.5s for 4s in 4m radius (8 dps = 4 dmg per 0.5s tick).
      // We use a channel without a caster body — emulate via dummy channel rooted to caster but with custom callback that ignores caster pos.
      const casterId = caster.id;
      startChannel({
        id: 'sorc:black-hole-tick',
        caster,
        endTime: now + 4,
        nextTickTime: now + 0.4,
        tickInterval: 0.5,
        cancelOnMove: false,
        rootCaster: false,
        onTick: (_c, w, _t) => {
          const inRange = hostilesInRadius(w, p.x, p.z, 4);
          for (const e of inRange) {
            dealDamage(w, casterId, e, 4, false, 0x6020a0);
          }
          w.emit('fx:hit', { x: p.x, y: 1.0, z: p.z, color: 0x6020a0, isCrit: false });
        },
      });
      juiceHit(world, {
        hitstop: 0.08,
        shake: { amplitude: 0.3, duration: 0.4 },
        sfx: 'black-hole',
        x: p.x,
        z: p.z,
      });
    },
  },

  // SLOT 5 — Blink (dash): teleport 8m toward target, brief invuln 0.2s, costs 10 mana.
  {
    id: 'sorc:blink',
    name: 'Blink',
    classId: 'sorcerer',
    slotIndex: 5,
    cooldown: 4,
    cost: 10,
    range: 8,
    cast: (caster, world, target) => {
      const dir = new Vector3();
      dirFromCasterToPoint(caster, target.x, target.z, dir);
      const px = caster.object3d.position.x;
      const pz = caster.object3d.position.z;
      // Blink up to 8m, but if target point is closer than 8m, blink to it.
      const requestedDist = Math.min(8, Math.hypot(target.x - px, target.z - pz));
      const dist = requestedDist > 0.5 ? requestedDist : 8;
      const tx = px + dir.x * dist;
      const tz = pz + dir.z * dist;
      // Pre-teleport puff
      world.emit('fx:hit', { x: px, y: 1.0, z: pz, color: HIT_COLOR_ARCANE, isCrit: false });
      teleportEntity(caster, tx, tz);
      world.emit('fx:hit', { x: tx, y: 1.0, z: tz, color: HIT_COLOR_ARCANE, isCrit: false });
      grantInvuln(caster, 0.2);
      juiceHit(world, { sfx: 'blink' });
    },
  },
];
