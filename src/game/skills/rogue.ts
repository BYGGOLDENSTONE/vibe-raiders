// Rogue skills: energy resource, fast tempo, daggers + smoke + storm of blades.

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
import { startSlide, teleportEntity } from './tweens';

const HIT_COLOR_ROGUE = 0xc8c8d8;
const HIT_COLOR_SHADOW = 0x6040a0;

export const ROGUE_SKILLS: Skill[] = [
  // SLOT 0 — basic: quick 2-hit melee, dmg 8+8, range 2m.
  {
    id: 'rogue:strike',
    name: 'Strike',
    classId: 'rogue',
    slotIndex: 0,
    cooldown: 0.4,
    cost: 0,
    range: 2.0,
    cast: (caster, world, target) => {
      // Pick nearest hostile in range and hit it twice (2 quick hits).
      const enemies = hostilesInRadius(world, caster.object3d.position.x, caster.object3d.position.z, 2.0);
      if (enemies.length === 0) return;
      // Face target.
      caster.object3d.rotation.y = Math.atan2(target.dir.x, target.dir.z);
      // Sort by distance, take closest.
      enemies.sort((a, b) => {
        const ax = a.object3d.position.x - caster.object3d.position.x;
        const az = a.object3d.position.z - caster.object3d.position.z;
        const bx = b.object3d.position.x - caster.object3d.position.x;
        const bz = b.object3d.position.z - caster.object3d.position.z;
        return (ax * ax + az * az) - (bx * bx + bz * bz);
      });
      const t1 = enemies[0]!;
      const isCrit1 = rollCrit(caster);
      const dmg1 = isCrit1 ? 8 * critMult(caster) : 8;
      dealDamage(world, caster.id, t1, dmg1, isCrit1, HIT_COLOR_ROGUE);
      // 2nd hit, slight delay via second emission (no scheduler — fine to do same frame).
      const t2 = enemies[0]!;
      const isCrit2 = rollCrit(caster);
      const dmg2 = isCrit2 ? 8 * critMult(caster) : 8;
      dealDamage(world, caster.id, t2, dmg2, isCrit2, HIT_COLOR_ROGUE);
      juiceHit(world, { sfx: 'rogue-strike' });
    },
  },

  // SLOT 1 — Shadow Step: teleport behind nearest enemy in 8m, 25 dmg + 100% crit.
  {
    id: 'rogue:shadow-step',
    name: 'Shadow Step',
    classId: 'rogue',
    slotIndex: 1,
    cooldown: 6,
    cost: 25,
    range: 8,
    cast: (caster, world, _target) => {
      const px = caster.object3d.position.x;
      const pz = caster.object3d.position.z;
      const t = nearestHostile(world, px, pz, 8);
      if (!t) return;
      // Compute "behind" target — direction from caster to target, place caster on far side at distance 1.0.
      const tx = t.object3d.position.x;
      const tz = t.object3d.position.z;
      const dx = tx - px;
      const dz = tz - pz;
      const d = Math.hypot(dx, dz) || 1;
      const nx = dx / d;
      const nz = dz / d;
      const behindX = tx + nx * 1.0;
      const behindZ = tz + nz * 1.0;
      teleportEntity(caster, behindX, behindZ);
      // Face the target.
      caster.object3d.rotation.y = Math.atan2(-nx, -nz);
      // Guaranteed crit.
      const dmg = 25 * critMult(caster);
      dealDamage(world, caster.id, t, dmg, true, HIT_COLOR_SHADOW);
      juiceHit(world, {
        hitstop: 0.06,
        shake: { amplitude: 0.18, duration: 0.16 },
        sfx: 'shadow-step',
        x: t.object3d.position.x,
        z: t.object3d.position.z,
      });
    },
  },

  // SLOT 2 — Smoke Cloud: AoE 4m at target, slow 50% / 3s + brief invis to player.
  {
    id: 'rogue:smoke-cloud',
    name: 'Smoke Cloud',
    classId: 'rogue',
    slotIndex: 2,
    cooldown: 10,
    cost: 30,
    range: 12,
    cast: (caster, world, target) => {
      const p = clampPointToRange(caster, target.x, target.z, 12);
      const enemies = hostilesInRadius(world, p.x, p.z, 4);
      const now = performance.now() / 1000;
      for (const e of enemies) {
        applyStatus(e, { id: 'slow', endTime: now + 3, power: 0.5 });
        world.emit('fx:hit', {
          x: e.object3d.position.x, y: e.object3d.position.y + 0.6, z: e.object3d.position.z,
          color: 0x606060, isCrit: false,
        });
      }
      // Brief invis on player (status flag — other systems read it).
      applyStatus(caster, { id: 'invisible', endTime: now + 2, power: 1 });
      juiceHit(world, { sfx: 'smoke-cloud', x: p.x, z: p.z });
      // Visual puff cue
      world.emit('fx:hit', { x: p.x, y: 0.5, z: p.z, color: 0x808080, isCrit: false });
    },
  },

  // SLOT 3 — Volley: 5 daggers in 60° fan toward target, each 12 dmg.
  {
    id: 'rogue:volley',
    name: 'Volley',
    classId: 'rogue',
    slotIndex: 3,
    cooldown: 8,
    cost: 35,
    range: 18,
    cast: (caster, world, target) => {
      const dir = new Vector3();
      dirFromCasterToPoint(caster, target.x, target.z, dir);
      caster.object3d.rotation.y = Math.atan2(dir.x, dir.z);
      const yawCenter = Math.atan2(dir.x, dir.z);
      const fanHalfRad = (60 * Math.PI / 180) / 2;
      const origin = new Vector3(caster.object3d.position.x, 1.0, caster.object3d.position.z);
      for (let i = 0; i < 5; i++) {
        const t = i / 4; // 0..1
        const yaw = yawCenter - fanHalfRad + t * fanHalfRad * 2;
        const dvec = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const isCrit = rollCrit(caster);
        const dmg = isCrit ? 12 * critMult(caster) : 12;
        spawnPlayerProjectile(world, {
          kind: 'dagger',
          origin,
          dir: dvec,
          speed: 22,
          damage: dmg,
          lifetime: 1.2,
          hitRadius: 0.3,
          ownerId: caster.id,
          hitColor: HIT_COLOR_ROGUE,
          isCrit,
        });
      }
      juiceHit(world, { sfx: 'volley', x: caster.object3d.position.x, z: caster.object3d.position.z });
    },
  },

  // SLOT 4 — Storm of Blades (ult): channel 3s, 4m radius around player, 15 dmg every 0.3s.
  {
    id: 'rogue:storm-of-blades',
    name: 'Storm of Blades',
    classId: 'rogue',
    slotIndex: 4,
    cooldown: 30,
    cost: 60,
    range: 0,
    cast: (caster, world, _target) => {
      const now = performance.now() / 1000;
      startChannel({
        id: 'rogue:storm-of-blades',
        caster,
        endTime: now + 3,
        nextTickTime: now + 0.05,
        tickInterval: 0.3,
        cancelOnMove: false,
        rootCaster: false,
        onTick: (c, w, _now) => {
          const enemies = hostilesInRadius(w, c.object3d.position.x, c.object3d.position.z, 4);
          for (const e of enemies) {
            const isCrit = rollCrit(c);
            const dmg = isCrit ? 15 * critMult(c) : 15;
            dealDamage(w, c.id, e, dmg, isCrit, HIT_COLOR_ROGUE);
          }
          w.emit('fx:hit', {
            x: c.object3d.position.x, y: c.object3d.position.y + 1.0, z: c.object3d.position.z,
            color: 0xb0b0c0, isCrit: false,
          });
          juiceHit(w, { shake: { amplitude: 0.06, duration: 0.1 }, sfx: 'blade-tick' });
        },
      });
      juiceHit(world, { hitstop: 0.05, shake: { amplitude: 0.2, duration: 0.25 }, sfx: 'rogue-ult' });
    },
  },

  // SLOT 5 — Roll (dash): 6m toward target dir, 0.3s invuln.
  {
    id: 'rogue:roll',
    name: 'Roll',
    classId: 'rogue',
    slotIndex: 5,
    cooldown: 4,
    cost: 0,
    range: 6,
    cast: (caster, world, target) => {
      const dir = new Vector3();
      dirFromCasterToPoint(caster, target.x, target.z, dir);
      const px = caster.object3d.position.x;
      const pz = caster.object3d.position.z;
      const tx = px + dir.x * 6;
      const tz = pz + dir.z * 6;
      grantInvuln(caster, 0.3);
      startSlide({ caster, toX: tx, toZ: tz, duration: 0.28 });
      juiceHit(world, { sfx: 'roll' });
    },
  },
];
