// Barbarian skills: rage resource, builds rage on hit (cleave), heavy melee + AoE control.

import { Vector3 } from 'three';
import type { Skill } from './types';
import {
  applyStatus,
  clampPointToRange,
  critMult,
  dealDamage,
  dirFromCasterToPoint,
  hostilesInCone,
  hostilesInRadius,
  juiceHit,
  rollCrit,
} from './helpers';
import { startChannel } from './channels';
import { startLeap, startSlide } from './tweens';
import { C, type ResourceComponent } from '../../core/components';

const HIT_COLOR_BARB = 0xff8060;
const HIT_COLOR_HEAVY = 0xffaa40;

export const BARB_SKILLS: Skill[] = [
  // SLOT 0 — basic: cleave, 90° arc, 2.4m, 14 dmg, generates 8 rage, CD 0.6s.
  {
    id: 'barb:cleave',
    name: 'Cleave',
    classId: 'barbarian',
    slotIndex: 0,
    cooldown: 0.6,
    cost: 0,
    range: 2.4,
    cast: (caster, world, target) => {
      const dir = new Vector3();
      dirFromCasterToPoint(caster, target.x, target.z, dir);
      caster.object3d.rotation.y = Math.atan2(dir.x, dir.z);
      const halfArc = (90 * Math.PI / 180) / 2;
      const enemies = hostilesInCone(
        world,
        caster.object3d.position.x, caster.object3d.position.z,
        dir.x, dir.z,
        2.4, halfArc,
      );
      let hitAny = false;
      for (const e of enemies) {
        const isCrit = rollCrit(caster);
        const dmg = isCrit ? 14 * critMult(caster) : 14;
        dealDamage(world, caster.id, e, dmg, isCrit, HIT_COLOR_BARB);
        hitAny = true;
      }
      if (hitAny) {
        // Generate 8 rage on connect.
        const res = caster.components.get(C.Resource) as ResourceComponent | undefined;
        if (res && res.kind === 'rage') {
          res.current = Math.min(res.max, res.current + 8);
        }
        juiceHit(world, { hitstop: 0.03, shake: { amplitude: 0.06, duration: 0.08 }, sfx: 'cleave' });
      } else {
        juiceHit(world, { sfx: 'cleave-whiff' });
      }
    },
  },

  // SLOT 1 — Leap: leap to point (max 8m), AoE 3m on landing, 30 dmg + knockback.
  {
    id: 'barb:leap',
    name: 'Leap',
    classId: 'barbarian',
    slotIndex: 1,
    cooldown: 8,
    cost: 25,
    range: 8,
    cast: (caster, world, target) => {
      const p = clampPointToRange(caster, target.x, target.z, 8);
      startLeap({
        caster,
        toX: p.x,
        toZ: p.z,
        duration: 0.5,
        arcHeight: 3.0,
        onLand: (c, w) => {
          const enemies = hostilesInRadius(w, c.object3d.position.x, c.object3d.position.z, 3);
          for (const e of enemies) {
            const isCrit = rollCrit(c);
            const dmg = isCrit ? 30 * critMult(c) : 30;
            dealDamage(w, c.id, e, dmg, isCrit, HIT_COLOR_HEAVY);
            // Knockback: nudge enemy 1.5m away from landing point.
            const dx = e.object3d.position.x - c.object3d.position.x;
            const dz = e.object3d.position.z - c.object3d.position.z;
            const d = Math.hypot(dx, dz) || 1;
            e.object3d.position.x += (dx / d) * 1.5;
            e.object3d.position.z += (dz / d) * 1.5;
          }
          juiceHit(w, {
            hitstop: 0.08,
            shake: { amplitude: 0.35, duration: 0.3 },
            sfx: 'leap-impact',
            x: c.object3d.position.x,
            z: c.object3d.position.z,
          });
          w.emit('fx:hit', {
            x: c.object3d.position.x, y: 0.2, z: c.object3d.position.z,
            color: 0xffa040, isCrit: false,
          });
        },
      });
      juiceHit(world, { sfx: 'leap-launch' });
    },
  },

  // SLOT 2 — Whirlwind: channel 2.5s, 3m around player, 8 dmg every 0.25s.
  {
    id: 'barb:whirlwind',
    name: 'Whirlwind',
    classId: 'barbarian',
    slotIndex: 2,
    cooldown: 10,
    cost: 30,
    range: 0,
    cast: (caster, world, _target) => {
      const now = performance.now() / 1000;
      startChannel({
        id: 'barb:whirlwind',
        caster,
        endTime: now + 2.5,
        nextTickTime: now + 0.05,
        tickInterval: 0.25,
        cancelOnMove: false,
        rootCaster: false,
        onTick: (c, w, _t) => {
          // Visual spin.
          c.object3d.rotation.y += Math.PI / 6;
          const enemies = hostilesInRadius(w, c.object3d.position.x, c.object3d.position.z, 3);
          for (const e of enemies) {
            const isCrit = rollCrit(c);
            const dmg = isCrit ? 8 * critMult(c) : 8;
            dealDamage(w, c.id, e, dmg, isCrit, HIT_COLOR_BARB);
          }
        },
      });
      juiceHit(world, { sfx: 'whirlwind-start' });
    },
  },

  // SLOT 3 — Ground Slam: AoE 4m at point, 35 dmg + 1s stun.
  {
    id: 'barb:ground-slam',
    name: 'Ground Slam',
    classId: 'barbarian',
    slotIndex: 3,
    cooldown: 10,
    cost: 30,
    range: 4,
    cast: (caster, world, target) => {
      const p = clampPointToRange(caster, target.x, target.z, 4);
      const enemies = hostilesInRadius(world, p.x, p.z, 4);
      const now = performance.now() / 1000;
      for (const e of enemies) {
        const isCrit = rollCrit(caster);
        const dmg = isCrit ? 35 * critMult(caster) : 35;
        dealDamage(world, caster.id, e, dmg, isCrit, HIT_COLOR_HEAVY);
        applyStatus(e, { id: 'stun', endTime: now + 1, power: 1 });
      }
      world.emit('fx:hit', { x: p.x, y: 0.2, z: p.z, color: 0xffaa40, isCrit: false });
      juiceHit(world, {
        hitstop: 0.1,
        shake: { amplitude: 0.4, duration: 0.35 },
        sfx: 'ground-slam',
        x: p.x,
        z: p.z,
      });
    },
  },

  // SLOT 4 — Berserk (ult): self-buff +50% dmg, +30% movespeed for 8s.
  {
    id: 'barb:berserk',
    name: 'Berserk',
    classId: 'barbarian',
    slotIndex: 4,
    cooldown: 30,
    cost: 50,
    range: 0,
    cast: (caster, world, _target) => {
      const now = performance.now() / 1000;
      applyStatus(caster, { id: 'damage-buff', endTime: now + 8, power: 0.5 });
      applyStatus(caster, { id: 'speed-buff', endTime: now + 8, power: 0.3 });
      juiceHit(world, { hitstop: 0.05, shake: { amplitude: 0.25, duration: 0.3 }, sfx: 'berserk' });
      world.emit('fx:hit', {
        x: caster.object3d.position.x, y: caster.object3d.position.y + 1.0, z: caster.object3d.position.z,
        color: 0xff4020, isCrit: false,
      });
    },
  },

  // SLOT 5 — Charge (dash): 7m toward target dir, push first enemy back 2m + 15 dmg.
  {
    id: 'barb:charge',
    name: 'Charge',
    classId: 'barbarian',
    slotIndex: 5,
    cooldown: 4,
    cost: 0,
    range: 7,
    cast: (caster, world, target) => {
      const dir = new Vector3();
      dirFromCasterToPoint(caster, target.x, target.z, dir);
      const px = caster.object3d.position.x;
      const pz = caster.object3d.position.z;
      const tx = px + dir.x * 7;
      const tz = pz + dir.z * 7;
      // Find first hostile along the path (within 1.0m of caster's swept line).
      let firstHit: { entityId: number; dist: number } | null = null;
      for (const e of world.query('hostile')) {
        const ex = e.object3d.position.x - px;
        const ez = e.object3d.position.z - pz;
        const along = ex * dir.x + ez * dir.z;
        if (along < 0 || along > 7) continue;
        const perp = Math.abs(ex * dir.z - ez * dir.x);
        if (perp > 1.0) continue;
        if (!firstHit || along < firstHit.dist) {
          firstHit = { entityId: e.id, dist: along };
        }
      }
      startSlide({
        caster,
        toX: tx,
        toZ: tz,
        duration: 0.35,
        onLand: (c, w) => {
          if (firstHit) {
            const target = w.get(firstHit.entityId);
            if (target && target.alive) {
              const dmg = 15;
              dealDamage(w, c.id, target, dmg, false, HIT_COLOR_BARB);
              // Push 2m further along charge dir.
              target.object3d.position.x += dir.x * 2;
              target.object3d.position.z += dir.z * 2;
              juiceHit(w, {
                hitstop: 0.06,
                shake: { amplitude: 0.2, duration: 0.18 },
                sfx: 'charge-impact',
                x: target.object3d.position.x,
                z: target.object3d.position.z,
              });
            }
          }
        },
      });
      juiceHit(world, { sfx: 'charge-start' });
    },
  },
];
