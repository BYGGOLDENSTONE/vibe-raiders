// AI brain for mobs: idle / aggro / chase / attack / flee / dead.
// State transitions throttled to ~10 Hz; movement + facing run every frame.

import { Vector3, type MeshStandardMaterial } from 'three';
import {
  C,
  type AIBrainComponent,
  type CombatantComponent,
  type HealthComponent,
  type HitboxComponent,
  type MoveTargetComponent,
} from '../../core/components';
import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import { gameState } from '../state';
import type { ArchetypeDef } from './archetypes';
import { spawnProjectile } from './projectiles';

// Per-mob runtime state extras (not stored as a typed core component since it's mob-internal).
export const MOB_RUNTIME = 'mob:runtime';

export interface MobRuntime {
  archetype: ArchetypeDef;
  // Mesh-flash on damage
  flashMaterials: MeshStandardMaterial[];
  flashEndTime: number; // when to end red flash (0 = not flashing)
  origColors: number[]; // matched to flashMaterials
  origOpacities: number[]; // for wraith transparency
  // Idle wander
  nextWanderTime: number;
  wanderOrigin: Vector3;
  // Flee timer (when archer/wraith disengages)
  fleeUntil: number;
  // Bobbing animation phase
  bobPhase: number;
  // Death timer (despawn 1s after dying)
  deathStartTime: number;
  hasEmittedKilled: boolean;
}

const TMP_VEC = new Vector3();
const TMP_VEC2 = new Vector3();

function distXZ(a: Vector3 | { x: number; z: number }, b: Vector3 | { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export function mobAISystem(world: World, ctx: { dt: number; elapsed: number }): void {
  const now = ctx.elapsed;
  const player = gameState.player;
  const playerPos = player?.object3d.position;

  for (const e of world.query('mob')) {
    const brain = e.components.get(C.AIBrain) as AIBrainComponent | undefined;
    const health = e.components.get(C.Health) as HealthComponent | undefined;
    const moveT = e.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    const combat = e.components.get(C.Combatant) as CombatantComponent | undefined;
    const runtime = e.components.get(MOB_RUNTIME) as MobRuntime | undefined;
    if (!brain || !health || !moveT || !combat || !runtime) continue;

    const arch = runtime.archetype;

    // ===== Bobbing animation (every frame) =====
    runtime.bobPhase += ctx.dt * arch.bobFrequency;
    const bob = Math.sin(runtime.bobPhase) * arch.bobAmplitude;
    e.object3d.position.y = arch.yOffset + bob;

    // Wraith flicker (every frame)
    if (arch.id === 'wraith') {
      const flicker = 0.55 + Math.sin(now * 6 + e.id) * 0.15 + Math.sin(now * 17.3 + e.id * 2) * 0.1;
      for (let i = 0; i < runtime.flashMaterials.length; i++) {
        const m = runtime.flashMaterials[i]!;
        // Don't override during damage flash
        if (runtime.flashEndTime <= now) {
          m.opacity = Math.max(0.25, Math.min(0.9, flicker));
        }
      }
    }

    // ===== Damage flash decay (every frame) =====
    if (runtime.flashEndTime > 0 && now >= runtime.flashEndTime) {
      for (let i = 0; i < runtime.flashMaterials.length; i++) {
        const m = runtime.flashMaterials[i]!;
        m.color.setHex(runtime.origColors[i]!);
      }
      runtime.flashEndTime = 0;
    }

    // ===== Death handling — combat owns mob:killed / entity:died emission and despawn. =====
    // We just play the visual sink/rotate animation while the entity is alive.
    if (brain.state === 'dead') {
      const tDead = now - runtime.deathStartTime;
      e.object3d.position.y = (arch.yOffset + bob) - tDead * 0.5;
      e.object3d.rotation.z = Math.min(Math.PI / 2, tDead * 2.5);
      continue;
    }

    // ===== Health check — transition to dead =====
    if (health.hp <= 0) {
      brain.state = 'dead';
      runtime.deathStartTime = now;
      moveT.target = null;
      continue;
    }

    // Face player when aggressive
    const havePlayer = !!player && !!playerPos;
    let distToPlayer = Infinity;
    if (havePlayer) {
      distToPlayer = distXZ(e.object3d.position, playerPos!);
    }

    // ===== Throttled state thinking (~10 Hz) =====
    if (now >= brain.nextThinkTime) {
      brain.nextThinkTime = now + 0.1;

      // Compute distance to leash origin
      const distToLeash = distXZ(e.object3d.position, brain.leashOrigin);

      switch (brain.state) {
        case 'idle': {
          if (havePlayer && distToPlayer <= brain.aggroRadius) {
            brain.state = 'chase';
            brain.targetId = player!.id;
          } else {
            // wander every 3-5s
            if (now >= runtime.nextWanderTime) {
              runtime.nextWanderTime = now + 3 + Math.random() * 2;
              const angle = Math.random() * Math.PI * 2;
              const r = Math.random() * 3;
              TMP_VEC.set(
                runtime.wanderOrigin.x + Math.cos(angle) * r,
                0,
                runtime.wanderOrigin.z + Math.sin(angle) * r,
              );
              moveT.target = TMP_VEC.clone();
              moveT.speed = arch.speed * 0.4; // slow wander
            }
          }
          break;
        }
        case 'chase': {
          if (!havePlayer) {
            brain.state = 'idle';
            moveT.target = null;
            break;
          }
          if (distToLeash > brain.leashRadius) {
            // Return to leash
            brain.state = 'idle';
            brain.targetId = null;
            moveT.target = brain.leashOrigin.clone();
            moveT.speed = arch.speed * 0.6;
            break;
          }
          // Low HP and kiter → flee
          if (arch.kiter && health.hp / health.maxHp < 0.3) {
            brain.state = 'flee';
            runtime.fleeUntil = now + 2.0;
            break;
          }
          // Archer kiting: if too close to player, back off
          if (arch.kiter && distToPlayer < arch.minPreferredRange) {
            // Move directly away from player
            TMP_VEC.subVectors(e.object3d.position, playerPos!);
            TMP_VEC.y = 0;
            if (TMP_VEC.lengthSq() < 1e-6) TMP_VEC.set(1, 0, 0);
            TMP_VEC.normalize().multiplyScalar(arch.minPreferredRange + 1.5);
            TMP_VEC2.copy(e.object3d.position).add(TMP_VEC);
            moveT.target = TMP_VEC2.clone();
            moveT.speed = arch.speed;
            break;
          }
          // Within attack range → attack
          if (distToPlayer <= arch.attackRange) {
            brain.state = 'attack';
            moveT.target = null;
            break;
          }
          // Otherwise chase
          moveT.target = TMP_VEC.copy(playerPos!).clone();
          moveT.speed = arch.speed;
          break;
        }
        case 'attack': {
          if (!havePlayer) {
            brain.state = 'idle';
            break;
          }
          // If player out of range, resume chase
          if (distToPlayer > arch.attackRange + 0.4) {
            brain.state = 'chase';
            break;
          }
          // Low HP and kiter → flee
          if (arch.kiter && health.hp / health.maxHp < 0.3) {
            brain.state = 'flee';
            runtime.fleeUntil = now + 2.0;
            break;
          }
          // Stop and face player
          moveT.target = null;
          const dx = playerPos!.x - e.object3d.position.x;
          const dz = playerPos!.z - e.object3d.position.z;
          e.object3d.rotation.y = Math.atan2(dx, dz);

          // Swing on cooldown
          const cooldown = 1 / Math.max(0.001, arch.attackSpeed);
          if (now - combat.lastAttackTime >= cooldown) {
            combat.lastAttackTime = now;
            performAttack(world, e, arch);
          }
          break;
        }
        case 'flee': {
          if (now >= runtime.fleeUntil) {
            brain.state = 'chase';
            break;
          }
          if (!havePlayer) {
            brain.state = 'idle';
            break;
          }
          // Move directly away from player
          TMP_VEC.subVectors(e.object3d.position, playerPos!);
          TMP_VEC.y = 0;
          if (TMP_VEC.lengthSq() < 1e-6) TMP_VEC.set(1, 0, 0);
          TMP_VEC.normalize().multiplyScalar(8);
          TMP_VEC2.copy(e.object3d.position).add(TMP_VEC);
          moveT.target = TMP_VEC2.clone();
          moveT.speed = arch.speed * 1.1;
          break;
        }
        case 'aggro': {
          // 'aggro' is a transient state we never park in — promote to chase.
          brain.state = 'chase';
          break;
        }
      }
    }

    // ===== Per-frame facing while moving (chase/flee) =====
    if ((brain.state === 'chase' || brain.state === 'flee') && havePlayer) {
      const dx = playerPos!.x - e.object3d.position.x;
      const dz = playerPos!.z - e.object3d.position.z;
      if (brain.state === 'flee') {
        e.object3d.rotation.y = Math.atan2(-dx, -dz);
      } else {
        e.object3d.rotation.y = Math.atan2(dx, dz);
      }
    }
  }
}

function performAttack(world: World, mob: Entity, arch: ArchetypeDef): void {
  const player = gameState.player;
  if (!player) return;
  const playerPos = player.object3d.position;
  const mobPos = mob.object3d.position;

  if (arch.attackKind === 'melee') {
    // Direct damage event
    world.emit('damage:dealt', {
      sourceId: mob.id,
      targetId: player.id,
      amount: arch.damage,
      isCrit: false,
    });
    world.emit('fx:hit', {
      x: playerPos.x,
      y: playerPos.y + 1.0,
      z: playerPos.z,
      color: arch.id === 'brute' ? 0xff5020 : 0xa03030,
      isCrit: false,
    });

    // Brute AoE: also damage any non-hostile entities within meleeAoeRadius.
    // For Wave 1 the only non-hostile combatant is the player, so this is
    // effectively a wider radius check. We keep the explicit AoE pass so
    // future allies/party-members get hit too.
    if (arch.meleeAoeRadius > 0) {
      // The primary single-target hit above already covered the player if in range.
      // Scan other allied/neutral combatants in radius.
      for (const other of world.query('combatant')) {
        if (other.id === mob.id) continue;
        if (other.id === player.id) continue; // already hit
        const fac = other.components.get(C.Faction) as
          | { faction: 'player' | 'hostile' | 'neutral' | 'boss' }
          | undefined;
        if (!fac || fac.faction === 'hostile' || fac.faction === 'boss') continue;
        const d = distXZ(other.object3d.position, mobPos);
        if (d <= arch.meleeAoeRadius) {
          world.emit('damage:dealt', {
            sourceId: mob.id,
            targetId: other.id,
            amount: arch.damage,
            isCrit: false,
          });
          world.emit('fx:hit', {
            x: other.object3d.position.x,
            y: other.object3d.position.y + 1.0,
            z: other.object3d.position.z,
            color: 0xff5020,
            isCrit: false,
          });
        }
      }
    }
  } else {
    // Ranged: spawn projectile from mob position toward player snapshot
    const hitbox = mob.components.get(C.Hitbox) as HitboxComponent | undefined;
    const originY = (hitbox?.height ?? 1.5) * 0.6 + arch.yOffset;
    const origin = new Vector3(mobPos.x, originY, mobPos.z);
    const target = new Vector3(playerPos.x, playerPos.y + 0.9, playerPos.z);
    const kind = arch.id === 'wraith' ? 'soul-bolt' : 'arrow';
    spawnProjectile(world, kind, mob.id, origin, target, arch.damage);
  }
}
