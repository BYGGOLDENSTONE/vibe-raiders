// Wave 1: mob spawning + AI brain (idle/aggro/chase/attack/flee/dead).
// Visual: primitive composite (capsule torso + sphere head + cylinder arms) per archetype.
//
// Wave-1 behaviour notes:
// - HP loss is applied here in response to 'damage:dealt' events whose target is
//   one of OUR mobs. This is a stub so that we can actually kill mobs while
//   the dedicated combat module is still being built. Once Wave 2 lands, the
//   combat module will own damage application — search for `WAVE2_OWNS_DAMAGE`
//   and remove that block.
// - Mob-on-player damage events ARE emitted from the AI; whoever wires player
//   health (Wave 2 combat) is responsible for applying them.

import { Vector3 } from 'three';
import { createEntity, setComponent } from '../../core/entity';
import {
  C,
  type AIBrainComponent,
  type CombatantComponent,
  type FactionComponent,
  type HealthComponent,
  type HitboxComponent,
  type MoveTargetComponent,
  type ResourceComponent,
  type TransformComponent,
} from '../../core/components';
import type { Entity } from '../../core/types';
import type { GameContext } from '../state';
import { ARCHETYPE_LIST, pickArchetype, type ArchetypeDef, type ArchetypeId } from './archetypes';
import { mobAISystem, MOB_RUNTIME, type MobRuntime } from './ai';
import { projectileSystem } from './projectiles';

const SPAWN_RING_RADIUS = 100;
const PLAYER_CLEAR_ZONE = 12;
const TOTAL_MOBS = 40;

export function initMobs(ctx: GameContext): void {
  const world = ctx.world;

  const counts: Record<ArchetypeId, number> = {
    'skeleton-warrior': 0,
    'skeleton-archer': 0,
    'zombie': 0,
    'wraith': 0,
    'brute': 0,
  };

  let attempts = 0;
  while (countTotal(counts) < TOTAL_MOBS && attempts < TOTAL_MOBS * 8) {
    attempts++;
    const arch = pickArchetype(counts);
    if (counts[arch.id] >= arch.spawnCap) continue;
    const pos = randomSpawnPos();
    if (!pos) continue;
    spawnMob(ctx, arch, pos);
    counts[arch.id]++;
  }

  // Visual feedback for hits on our mobs. Combat owns HP application — we just
  // render the floating damage number and red flash here.
  world.on('damage:dealt', (payload) => {
    const target = world.get(payload.targetId);
    if (!target || !target.tags.has('mob')) return;
    const runtime = target.components.get(MOB_RUNTIME) as MobRuntime | undefined;
    if (!runtime) return;

    // Floating damage text
    world.emit('fx:floatingText', {
      x: target.object3d.position.x,
      y: target.object3d.position.y + 1.6,
      z: target.object3d.position.z,
      text: String(Math.round(payload.amount)),
      color: payload.isCrit ? 0xffd040 : 0xff8060,
    });

    // Red flash
    flashRed(runtime);
  });

  // Systems
  world.addSystem((w, frameCtx) => mobAISystem(w, frameCtx));
  world.addSystem((w, frameCtx) => projectileSystem(w, frameCtx));
}

function countTotal(counts: Record<ArchetypeId, number>): number {
  let n = 0;
  for (const k of Object.keys(counts) as ArchetypeId[]) n += counts[k];
  return n;
}

function randomSpawnPos(): Vector3 | null {
  // Reject samples in the clear zone.
  for (let i = 0; i < 6; i++) {
    const r = PLAYER_CLEAR_ZONE + Math.random() * (SPAWN_RING_RADIUS - PLAYER_CLEAR_ZONE);
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (Math.hypot(x, z) >= PLAYER_CLEAR_ZONE) return new Vector3(x, 0, z);
  }
  return null;
}

function spawnMob(ctx: GameContext, arch: ArchetypeDef, pos: Vector3): Entity {
  const { rig, flashMaterials } = arch.buildMesh();
  rig.position.copy(pos);
  rig.position.y = arch.yOffset;
  rig.name = `mob-${arch.id}`;

  const tags = ['mob', 'hostile', 'combatant'];
  if (arch.id === 'brute') tags.push('elite');

  const entity = createEntity({ object3d: rig, tags });

  setComponent<TransformComponent>(entity, C.Transform, {
    velocity: new Vector3(),
    grounded: !arch.floats,
  });
  setComponent<HealthComponent>(entity, C.Health, {
    hp: arch.hp,
    maxHp: arch.hp,
    lastHitTime: 0,
    invulnUntil: 0,
  });
  setComponent<ResourceComponent>(entity, C.Resource, {
    kind: arch.resourceKind,
    current: 100,
    max: 100,
    regenPerSec: arch.attackKind === 'ranged' ? 8 : 4,
  });
  setComponent<FactionComponent>(entity, C.Faction, { faction: 'hostile' });
  setComponent<CombatantComponent>(entity, C.Combatant, {
    baseDamage: arch.damage,
    attackRange: arch.attackRange,
    attackSpeed: arch.attackSpeed,
    lastAttackTime: 0,
    critChance: 0,
    critMult: 1,
  });
  setComponent<AIBrainComponent>(entity, C.AIBrain, {
    state: 'idle',
    targetId: null,
    leashOrigin: pos.clone(),
    leashRadius: 16,
    aggroRadius: arch.aggroRadius,
    attackRange: arch.attackRange,
    nextThinkTime: Math.random() * 0.1, // stagger initial thinks
  });
  setComponent<MoveTargetComponent>(entity, C.MoveTarget, {
    target: null,
    speed: arch.speed,
  });
  setComponent<HitboxComponent>(entity, C.Hitbox, {
    radius: arch.hitboxRadius,
    height: arch.hitboxHeight,
  });

  const runtime: MobRuntime = {
    archetype: arch,
    flashMaterials,
    flashEndTime: 0,
    origColors: flashMaterials.map((m) => m.color.getHex()),
    origOpacities: flashMaterials.map((m) => m.opacity),
    nextWanderTime: 0,
    wanderOrigin: pos.clone(),
    fleeUntil: 0,
    bobPhase: Math.random() * Math.PI * 2,
    deathStartTime: 0,
    hasEmittedKilled: false,
  };
  setComponent<MobRuntime>(entity, MOB_RUNTIME, runtime);

  // Per-archetype XP reward — combat reads this string-keyed component when
  // crediting kills via mob:killed.
  entity.components.set('mobXpReward', arch.xpReward);

  ctx.world.spawn(entity);
  return entity;
}

function flashRed(runtime: MobRuntime): void {
  const now = performance.now() / 1000;
  runtime.flashEndTime = now + 0.15;
  for (const m of runtime.flashMaterials) {
    m.color.setHex(0xff3030);
  }
}

// Re-export for diagnostic / future extension.
export { ARCHETYPE_LIST };
export type { ArchetypeDef };
