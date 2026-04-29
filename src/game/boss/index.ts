// Wave 3 — GRAVELORD MORTHEN: 2-phase telegraphed boss for the end of dungeon-1.
// THE cinematic showpiece of DUSK. Every attack is telegraphed for fairness + clip-ability.
//
// Spawned on 'zone:enter' with payload.zone === 'dungeon-1' at fixed world position
// (0, -498, -30) — the dungeons module aligns its boss room there.
//
// AI design choice: boss spawns WITHOUT AIBrainComponent so the default mob AI ignores it.
// Our local bossAISystem fully drives the boss instead.

import {
  AdditiveBlending,
  BackSide,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
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
import type { World } from '../../core/world';
import type { GameContext } from '../state';
import { gameState } from '../state';
import { applyStatus } from '../combat';
import {
  ARCHETYPES,
  type ArchetypeDef,
} from '../mobs/archetypes';
import { MOB_RUNTIME, type MobRuntime } from '../mobs/ai';

// ============================================================================
// CONSTANTS
// ============================================================================

const BOSS_SPAWN_POS = new Vector3(0, -498, -30);
const BOSS_NAME = 'Gravelord Morthen';
const BOSS_HP = 600;
const BOSS_MANA = 200;
const BOSS_SPEED = 3;
const BOSS_HITBOX_R = 1.6;
const BOSS_HITBOX_H = 4;
const BOSS_XP = 200;

const PHASE_2_THRESHOLD = 0.5; // hp ratio
const PHASE_TRANSITION_INVULN = 1.5;

const BOSS_PHASE_KEY = 'boss:phase';
const BOSS_RUNTIME_KEY = 'boss:runtime';

const COLOR_CRIMSON = 0x8a0a18;
const COLOR_EMBER = 0xff5020;
const COLOR_BONE = 0xc8b8a0;
const COLOR_DARK = 0x1a0608;
const COLOR_TELEGRAPH = 0xff2030;

// ============================================================================
// RUNTIME STATE TYPES
// ============================================================================

type AttackId =
  | 'cleave'
  | 'bone-spikes'
  | 'summon-skeletons'
  | 'charge'
  | 'death-wave'
  | 'meteor-rain'
  | 'reapers-embrace';

interface BossRuntime {
  phase: 1 | 2;
  hpRatio: number;
  // Attack scheduling
  cooldowns: Map<AttackId, number>; // attackId -> earliest-allowed time
  nextAttackTime: number;
  currentAttack: AttackId | null;
  attackEndTime: number;
  lastAttack: AttackId | null;
  // Active attack state (anonymous bag — each attack reads what it needs)
  attackState: AttackInstanceState | null;
  // Visual rig refs for animation
  rig: Group;
  cloakPlanes: Mesh[];
  flashMaterials: MeshStandardMaterial[];
  origColors: number[];
  flashEndTime: number;
  // Phase + intro/death
  intro: { active: boolean; startTime: number; duration: number; targetY: number };
  invulnUntil: number;
  hasTriggeredPhase2: boolean;
  death: { active: boolean; startTime: number; duration: number; emittedDefeated: boolean };
  // Telegraph meshes by id
  telegraphs: Set<TelegraphHandle>;
  // For passing wave damage tracking (death wave)
  waveLastHitTime: number;
}

type AttackInstanceState =
  | { kind: 'cleave'; windupEnd: number; aimYaw: number; telegraph: TelegraphHandle }
  | { kind: 'bone-spikes'; windupEnd: number; positions: Vector3[]; telegraphs: TelegraphHandle[] }
  | { kind: 'summon-skeletons'; windupEnd: number }
  | { kind: 'charge'; windupEnd: number; chargeEnd: number; dir: Vector3; hit: boolean }
  | { kind: 'death-wave'; nextEmitTime: number; endTime: number; pulses: ActiveWave[] }
  | { kind: 'meteor-rain'; impacts: MeteorImpact[]; endTime: number }
  | { kind: 'reapers-embrace'; teleportTime: number; landTime: number; impactPos: Vector3 | null; telegraph: TelegraphHandle | null };

interface ActiveWave {
  startTime: number;
  origin: Vector3;
  mesh: Mesh;
  hitPlayer: boolean;
}

interface MeteorImpact {
  spawnTime: number;
  impactTime: number;
  pos: Vector3;
  telegraph: TelegraphHandle;
  meteor: Mesh | null;
  resolved: boolean;
}

interface TelegraphHandle {
  obj: Object3D;
  startTime: number;
  endTime: number;
  // For animated fill — one of these will be a flat ring/plane material we tween
  fillMat: MeshBasicMaterial;
  removed: boolean;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function initBoss(ctx: GameContext): void {
  const { world } = ctx;

  injectBossUI(ctx.uiRoot);
  let bossEntity: Entity | null = null;

  // ===== Zone enter → spawn boss =====
  world.on('zone:enter', (payload) => {
    if (payload.zone !== 'dungeon-1') return;
    if (bossEntity && bossEntity.alive) return; // already alive
    bossEntity = spawnBoss(ctx);
    // Cinematic intro cues
    world.emit('audio:sfx', { id: 'boss-intro' });
    world.emit('fx:screenshake', { amplitude: 0.3, duration: 0.6 });
    showBossBar(BOSS_NAME);
  });

  world.on('zone:exit', (_payload) => {
    // If we ever leave the dungeon, hide the bar (boss is despawned by death anyway).
    hideBossBar();
  });

  // ===== Track damage to drive flash + phase transition =====
  world.on('damage:dealt', (payload) => {
    if (!bossEntity || !bossEntity.alive) return;
    if (payload.targetId !== bossEntity.id) return;
    const rt = bossEntity.components.get(BOSS_RUNTIME_KEY) as BossRuntime | undefined;
    if (!rt) return;
    flashBoss(rt);
  });

  // ===== Boss death =====
  world.on('entity:died', (payload) => {
    if (!bossEntity) return;
    if (payload.entityId !== bossEntity.id) return;
    const rt = bossEntity.components.get(BOSS_RUNTIME_KEY) as BossRuntime | undefined;
    if (!rt) return;
    triggerBossDeath(world, bossEntity, rt);
  });

  // ===== Per-frame boss system =====
  world.addSystem((w, frameCtx) => {
    if (!bossEntity) return;
    if (!bossEntity.alive) {
      bossEntity = null;
      hideBossBar();
      return;
    }
    bossAISystem(w, bossEntity, frameCtx.elapsed, frameCtx.dt);
  });
}

// ============================================================================
// SPAWN
// ============================================================================

function spawnBoss(ctx: GameContext): Entity {
  const { rig, cloakPlanes, flashMaterials } = buildBossRig();
  rig.position.copy(BOSS_SPAWN_POS);
  rig.position.y -= 1; // start sunken (1m below floor) — intro raises it

  // NOTE: tags include 'mob' so loot module's mob:killed handler triggers a
  // legendary drop (combat treats mob-tagged entities as mobs and emits the
  // mob:killed event with our xpReward).
  const entity = createEntity({
    object3d: rig,
    tags: ['mob', 'hostile', 'combatant', 'boss', 'dungeon'],
  });

  setComponent<TransformComponent>(entity, C.Transform, {
    velocity: new Vector3(),
    grounded: true,
  });
  setComponent<HealthComponent>(entity, C.Health, {
    hp: BOSS_HP,
    maxHp: BOSS_HP,
    lastHitTime: 0,
    invulnUntil: 0,
  });
  setComponent<ResourceComponent>(entity, C.Resource, {
    kind: 'mana',
    current: BOSS_MANA,
    max: BOSS_MANA,
    regenPerSec: 6,
  });
  setComponent<FactionComponent>(entity, C.Faction, { faction: 'hostile' });
  setComponent<CombatantComponent>(entity, C.Combatant, {
    baseDamage: 30,
    attackRange: 4,
    attackSpeed: 0.5,
    lastAttackTime: 0,
    critChance: 0,
    critMult: 1,
  });
  // NO AIBrainComponent — our bossAISystem owns control. Default mob AI skips entities without it.
  setComponent<MoveTargetComponent>(entity, C.MoveTarget, {
    target: null,
    speed: BOSS_SPEED,
  });
  setComponent<HitboxComponent>(entity, C.Hitbox, {
    radius: BOSS_HITBOX_R,
    height: BOSS_HITBOX_H,
  });

  entity.components.set('mobXpReward', BOSS_XP);
  entity.components.set(BOSS_PHASE_KEY, 1);

  const runtime: BossRuntime = {
    phase: 1,
    hpRatio: 1,
    cooldowns: new Map(),
    nextAttackTime: 0,
    currentAttack: null,
    attackEndTime: 0,
    lastAttack: null,
    attackState: null,
    rig,
    cloakPlanes,
    flashMaterials,
    origColors: flashMaterials.map((m) => m.color.getHex()),
    flashEndTime: 0,
    intro: {
      active: true,
      startTime: performance.now() / 1000,
      duration: 1.5,
      targetY: BOSS_SPAWN_POS.y,
    },
    invulnUntil: performance.now() / 1000 + 1.5, // intro invuln
    hasTriggeredPhase2: false,
    death: { active: false, startTime: 0, duration: 2, emittedDefeated: false },
    telegraphs: new Set(),
    waveLastHitTime: 0,
  };
  setComponent<BossRuntime>(entity, BOSS_RUNTIME_KEY, runtime);

  ctx.world.spawn(entity);
  return entity;
}

// ============================================================================
// VISUAL RIG
// ============================================================================

function buildBossRig(): {
  rig: Group;
  cloakPlanes: Mesh[];
  flashMaterials: MeshStandardMaterial[];
} {
  const rig = new Group();
  const flashMaterials: MeshStandardMaterial[] = [];
  const cloakPlanes: Mesh[] = [];

  // Skeletal torso (huge capsule, gaunt)
  const torsoMat = new MeshStandardMaterial({
    color: COLOR_BONE,
    roughness: 0.6,
    metalness: 0.05,
    emissive: 0x200810,
    emissiveIntensity: 0.4,
  });
  const torso = new Mesh(new CapsuleGeometry(0.9, 1.8, 6, 12), torsoMat);
  torso.position.y = 2.0;
  rig.add(torso);
  flashMaterials.push(torsoMat);

  // Spine ribs (a few cylinders sticking out the front)
  const ribMat = new MeshStandardMaterial({ color: COLOR_BONE, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const rib = new Mesh(new CylinderGeometry(0.06, 0.06, 1.4, 6), ribMat);
    rib.position.set(0, 1.5 + i * 0.25, 0.6);
    rib.rotation.x = Math.PI / 2;
    rig.add(rib);
  }

  // Head (skull-like)
  const headMat = new MeshStandardMaterial({
    color: COLOR_BONE,
    roughness: 0.5,
    metalness: 0.05,
  });
  const head = new Mesh(new SphereGeometry(0.55, 14, 12), headMat);
  head.position.y = 3.6;
  head.scale.set(0.95, 1.1, 1.05);
  rig.add(head);
  flashMaterials.push(headMat);

  // Glowing eyes (two small spheres with emissive)
  const eyeMat = new MeshBasicMaterial({ color: COLOR_EMBER });
  const eyeL = new Mesh(new SphereGeometry(0.09, 8, 8), eyeMat);
  eyeL.position.set(-0.2, 3.7, 0.45);
  rig.add(eyeL);
  const eyeR = new Mesh(new SphereGeometry(0.09, 8, 8), eyeMat);
  eyeR.position.set(0.2, 3.7, 0.45);
  rig.add(eyeR);

  // Massive arms
  const armMat = new MeshStandardMaterial({ color: COLOR_BONE, roughness: 0.65 });
  flashMaterials.push(armMat);
  const armL = new Mesh(new CylinderGeometry(0.22, 0.18, 1.6, 10), armMat);
  armL.position.set(-1.05, 2.3, 0);
  armL.rotation.z = 0.3;
  rig.add(armL);
  const armR = new Mesh(new CylinderGeometry(0.22, 0.18, 1.6, 10), armMat);
  armR.position.set(1.05, 2.3, 0);
  armR.rotation.z = -0.3;
  rig.add(armR);

  // Claws (cones at end of arms — left)
  const clawMat = new MeshStandardMaterial({
    color: COLOR_DARK,
    roughness: 0.4,
    metalness: 0.7,
    emissive: 0x501010,
    emissiveIntensity: 0.5,
  });
  for (let i = 0; i < 3; i++) {
    const claw = new Mesh(new ConeGeometry(0.07, 0.35, 6), clawMat);
    claw.position.set(-1.4 + i * 0.08, 1.5, 0.05);
    claw.rotation.x = Math.PI;
    rig.add(claw);
  }

  // Oversized scythe in right hand
  const scytheMat = new MeshStandardMaterial({
    color: 0x202020,
    roughness: 0.4,
    metalness: 0.8,
  });
  const scytheShaft = new Mesh(new CylinderGeometry(0.06, 0.06, 3.2, 8), scytheMat);
  scytheShaft.position.set(1.4, 2.4, 0.1);
  scytheShaft.rotation.z = -0.25;
  rig.add(scytheShaft);

  const bladeMat = new MeshStandardMaterial({
    color: 0x303030,
    roughness: 0.3,
    metalness: 0.9,
    emissive: COLOR_CRIMSON,
    emissiveIntensity: 0.6,
  });
  const blade = new Mesh(new ConeGeometry(0.55, 1.5, 4), bladeMat);
  blade.position.set(1.7, 4.0, 0.1);
  blade.rotation.z = Math.PI / 2;
  blade.rotation.y = Math.PI / 4;
  rig.add(blade);

  // Tattered cloak — several plane meshes around the body
  const cloakMat = new MeshStandardMaterial({
    color: COLOR_CRIMSON,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
    transparent: true,
    opacity: 0.85,
    emissive: 0x300000,
    emissiveIntensity: 0.3,
  });
  flashMaterials.push(cloakMat);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const plane = new Mesh(new PlaneGeometry(0.7, 2.6), cloakMat);
    plane.position.set(Math.cos(angle) * 0.95, 1.6, Math.sin(angle) * 0.95);
    plane.rotation.y = -angle + Math.PI / 2;
    plane.rotation.x = (Math.random() - 0.5) * 0.2;
    rig.add(plane);
    cloakPlanes.push(plane);
  }

  // Inner aura — back-side sphere giving a faint dark crimson glow
  const auraMat = new MeshBasicMaterial({
    color: COLOR_CRIMSON,
    transparent: true,
    opacity: 0.12,
    side: BackSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const aura = new Mesh(new SphereGeometry(2.6, 16, 12), auraMat);
  aura.position.y = 2.0;
  rig.add(aura);

  return { rig, cloakPlanes, flashMaterials };
}

// ============================================================================
// PER-FRAME BOSS AI
// ============================================================================

function bossAISystem(world: World, boss: Entity, now: number, dt: number): void {
  const rt = boss.components.get(BOSS_RUNTIME_KEY) as BossRuntime | undefined;
  const health = boss.components.get(C.Health) as HealthComponent | undefined;
  if (!rt || !health) return;

  // Always: cloak motion, eye pulse
  animateCloak(rt, now);
  animateTelegraphs(now, rt);

  // Damage flash decay
  if (rt.flashEndTime > 0 && now >= rt.flashEndTime) {
    for (let i = 0; i < rt.flashMaterials.length; i++) {
      rt.flashMaterials[i]!.color.setHex(rt.origColors[i]!);
    }
    rt.flashEndTime = 0;
  }

  // ===== Death animation =====
  if (rt.death.active) {
    advanceDeath(world, boss, rt, now);
    return;
  }

  if (health.hp <= 0) {
    // entity:died handler will trigger triggerBossDeath; here we just freeze
    return;
  }

  // ===== Intro animation =====
  if (rt.intro.active) {
    const t = (now - rt.intro.startTime) / rt.intro.duration;
    if (t >= 1) {
      rt.intro.active = false;
      rt.rig.position.y = rt.intro.targetY;
      rt.nextAttackTime = now + 0.6; // small breath after intro
    } else {
      // Ease-out cubic rise from -1 to targetY
      const e = 1 - Math.pow(1 - t, 3);
      rt.rig.position.y = rt.intro.targetY - 1 + e * 1;
    }
    // Update HP bar regardless
    updateBossBar(health.hp, health.maxHp, rt.phase);
    return;
  }

  // ===== Phase transition trigger =====
  rt.hpRatio = health.hp / Math.max(1, health.maxHp);
  if (!rt.hasTriggeredPhase2 && rt.hpRatio < PHASE_2_THRESHOLD) {
    triggerPhaseTransition(world, boss, rt, now);
  }

  // ===== Update HP bar each frame =====
  updateBossBar(health.hp, health.maxHp, rt.phase);

  // ===== Invuln check =====
  const invulnerable = now < rt.invulnUntil;
  if (invulnerable) {
    health.invulnUntil = rt.invulnUntil;
  }

  // ===== Active attack execution =====
  if (rt.currentAttack && rt.attackState) {
    const completed = updateAttack(world, boss, rt, now, dt);
    if (completed) {
      rt.lastAttack = rt.currentAttack;
      rt.cooldowns.set(rt.currentAttack, now + cooldownFor(rt.currentAttack, rt.phase));
      rt.currentAttack = null;
      rt.attackState = null;
      rt.nextAttackTime = now + 0.4 + Math.random() * 0.6;
    }
    return;
  }

  // ===== Pick next attack =====
  if (now >= rt.nextAttackTime) {
    const player = gameState.player;
    if (!player || !player.alive) return;
    const pick = pickNextAttack(rt, now);
    if (!pick) {
      rt.nextAttackTime = now + 0.3;
      return;
    }
    startAttack(world, boss, rt, pick, now);
  } else {
    // Slow drift toward player while waiting (massive boss, slow)
    const player = gameState.player;
    if (player) {
      const moveT = boss.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
      const dx = player.object3d.position.x - boss.object3d.position.x;
      const dz = player.object3d.position.z - boss.object3d.position.z;
      const dist = Math.hypot(dx, dz);
      if (moveT && dist > 5) {
        // Manual move (boss has no default mob AI)
        const inv = (BOSS_SPEED * dt) / Math.max(0.001, dist);
        boss.object3d.position.x += dx * inv;
        boss.object3d.position.z += dz * inv;
      }
      boss.object3d.rotation.y = Math.atan2(dx, dz);
    }
  }
}

// ============================================================================
// ATTACK SELECTION
// ============================================================================

const PHASE_1_POOL: AttackId[] = ['cleave', 'bone-spikes', 'summon-skeletons', 'charge'];
const PHASE_2_POOL: AttackId[] = [
  'cleave',
  'bone-spikes',
  'summon-skeletons',
  'charge',
  'death-wave',
  'meteor-rain',
  'reapers-embrace',
];

const ATTACK_WEIGHTS: Record<AttackId, number> = {
  'cleave': 1.0,
  'bone-spikes': 0.9,
  'summon-skeletons': 0.55,
  'charge': 0.85,
  'death-wave': 0.85,
  'meteor-rain': 0.85,
  'reapers-embrace': 0.55,
};

function cooldownFor(id: AttackId, phase: 1 | 2): number {
  const base: Record<AttackId, number> = {
    'cleave': 5,
    'bone-spikes': 6,
    'summon-skeletons': 12,
    'charge': 10,
    'death-wave': 14,
    'meteor-rain': 16,
    'reapers-embrace': 25,
  };
  const v = base[id];
  return phase === 2 ? v * 0.7 : v;
}

function pickNextAttack(rt: BossRuntime, now: number): AttackId | null {
  const pool = rt.phase === 2 ? PHASE_2_POOL : PHASE_1_POOL;
  const eligible: AttackId[] = [];
  const weights: number[] = [];
  for (const id of pool) {
    const cd = rt.cooldowns.get(id) ?? 0;
    if (now < cd) continue;
    if (id === rt.lastAttack) continue; // no immediate repeat
    eligible.push(id);
    weights.push(ATTACK_WEIGHTS[id]);
  }
  if (eligible.length === 0) {
    // Fall back to anything off cooldown even if it's the last attack used.
    for (const id of pool) {
      const cd = rt.cooldowns.get(id) ?? 0;
      if (now >= cd) {
        eligible.push(id);
        weights.push(ATTACK_WEIGHTS[id]);
      }
    }
    if (eligible.length === 0) return null;
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return eligible[i]!;
  }
  return eligible[eligible.length - 1]!;
}

// ============================================================================
// ATTACK START
// ============================================================================

function startAttack(world: World, boss: Entity, rt: BossRuntime, id: AttackId, now: number): void {
  rt.currentAttack = id;
  switch (id) {
    case 'cleave':           startCleave(world, boss, rt, now); break;
    case 'bone-spikes':      startBoneSpikes(world, boss, rt, now); break;
    case 'summon-skeletons': startSummon(world, boss, rt, now); break;
    case 'charge':           startCharge(world, boss, rt, now); break;
    case 'death-wave':       startDeathWave(world, boss, rt, now); break;
    case 'meteor-rain':      startMeteorRain(world, boss, rt, now); break;
    case 'reapers-embrace':  startReapers(world, boss, rt, now); break;
  }
  world.emit('audio:sfx', { id: `boss-cast-${id}` });
}

function updateAttack(world: World, boss: Entity, rt: BossRuntime, now: number, dt: number): boolean {
  const st = rt.attackState;
  if (!st) return true;
  switch (st.kind) {
    case 'cleave':           return updateCleave(world, boss, rt, st, now);
    case 'bone-spikes':      return updateBoneSpikes(world, boss, rt, st, now);
    case 'summon-skeletons': return updateSummon(world, boss, rt, st, now);
    case 'charge':           return updateCharge(world, boss, rt, st, now, dt);
    case 'death-wave':       return updateDeathWave(world, boss, rt, st, now, dt);
    case 'meteor-rain':      return updateMeteorRain(world, boss, rt, st, now);
    case 'reapers-embrace':  return updateReapers(world, boss, rt, st, now);
  }
}

// ============================================================================
// ATTACK 1 — CLEAVE (90deg arc telegraph)
// ============================================================================

function startCleave(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  const player = gameState.player;
  if (!player) { rt.currentAttack = null; return; }
  // Aim toward player
  const dx = player.object3d.position.x - boss.object3d.position.x;
  const dz = player.object3d.position.z - boss.object3d.position.z;
  const yaw = Math.atan2(dx, dz);
  boss.object3d.rotation.y = yaw;

  const tg = spawnArcTelegraph(world.scene, boss.object3d.position, yaw, 4, Math.PI / 2, now, now + 1.0);
  rt.telegraphs.add(tg);
  rt.attackState = { kind: 'cleave', windupEnd: now + 1.0, aimYaw: yaw, telegraph: tg };
}

function updateCleave(world: World, boss: Entity, rt: BossRuntime, st: AttackInstanceState, now: number): boolean {
  if (st.kind !== 'cleave') return true;
  if (now < st.windupEnd) return false;

  // Execute
  const player = gameState.player;
  removeTelegraph(world.scene, rt, st.telegraph);
  if (player && player.alive) {
    const dx = player.object3d.position.x - boss.object3d.position.x;
    const dz = player.object3d.position.z - boss.object3d.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 4) {
      const playerYaw = Math.atan2(dx, dz);
      let delta = playerYaw - st.aimYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) <= Math.PI / 4) {
        world.emit('damage:dealt', {
          sourceId: boss.id, targetId: player.id, amount: 30, isCrit: false,
        });
        world.emit('fx:hit', {
          x: player.object3d.position.x, y: player.object3d.position.y + 1,
          z: player.object3d.position.z, color: COLOR_TELEGRAPH, isCrit: false,
        });
        world.emit('fx:hitstop', { duration: 0.06 });
      }
    }
  }
  world.emit('fx:screenshake', { amplitude: 0.25, duration: 0.2 });
  world.emit('audio:sfx', { id: 'boss-cleave' });
  return true;
}

// ============================================================================
// ATTACK 2 — BONE SPIKES (3 telegraphed circles in a line)
// ============================================================================

function startBoneSpikes(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  const player = gameState.player;
  if (!player) { rt.currentAttack = null; return; }
  const origin = boss.object3d.position;
  const dir = new Vector3(
    player.object3d.position.x - origin.x,
    0,
    player.object3d.position.z - origin.z,
  );
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();

  const positions: Vector3[] = [];
  const tgs: TelegraphHandle[] = [];
  for (let i = 0; i < 3; i++) {
    const offset = 3 + i * 2.2; // 3, 5.2, 7.4 m
    const p = new Vector3(
      origin.x + dir.x * offset,
      0,
      origin.z + dir.z * offset,
    );
    positions.push(p);
    const tg = spawnCircleTelegraph(world.scene, p, 2, now, now + 1.2);
    rt.telegraphs.add(tg);
    tgs.push(tg);
  }
  rt.attackState = { kind: 'bone-spikes', windupEnd: now + 1.2, positions, telegraphs: tgs };
}

function updateBoneSpikes(world: World, _boss: Entity, rt: BossRuntime, st: AttackInstanceState, now: number): boolean {
  if (st.kind !== 'bone-spikes') return true;
  if (now < st.windupEnd) return false;

  const player = gameState.player;
  for (let i = 0; i < st.positions.length; i++) {
    const p = st.positions[i]!;
    const tg = st.telegraphs[i]!;
    spawnSpikeBurst(world.scene, p, now);
    removeTelegraph(world.scene, rt, tg);
    if (player && player.alive) {
      const dx = player.object3d.position.x - p.x;
      const dz = player.object3d.position.z - p.z;
      if (Math.hypot(dx, dz) <= 2) {
        world.emit('damage:dealt', {
          sourceId: 0, targetId: player.id, amount: 25, isCrit: false,
        });
        world.emit('fx:hit', {
          x: player.object3d.position.x, y: player.object3d.position.y + 1,
          z: player.object3d.position.z, color: COLOR_TELEGRAPH, isCrit: false,
        });
      }
    }
  }
  world.emit('fx:screenshake', { amplitude: 0.2, duration: 0.18 });
  world.emit('audio:sfx', { id: 'boss-spikes' });
  return true;
}

// ============================================================================
// ATTACK 3 — SUMMON SKELETONS (3 minions)
// ============================================================================

function startSummon(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  // Brief windup with a circle telegraph at boss feet
  const tg = spawnCircleTelegraph(world.scene, boss.object3d.position, 2.5, now, now + 0.8);
  rt.telegraphs.add(tg);
  rt.attackState = { kind: 'summon-skeletons', windupEnd: now + 0.8 };
  // Stash telegraph into attackState by reusing the bone-spikes pattern? No — we'll just let it
  // animate and remove on completion via the telegraph TTL.
}

function updateSummon(world: World, boss: Entity, _rt: BossRuntime, st: AttackInstanceState, now: number): boolean {
  if (st.kind !== 'summon-skeletons') return true;
  if (now < st.windupEnd) return false;

  // Spawn 3 skeleton-warrior minions at boss position with default mob AI.
  const arch = ARCHETYPES['skeleton-warrior'];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const offset = 1.6;
    const pos = new Vector3(
      boss.object3d.position.x + Math.cos(angle) * offset,
      0,
      boss.object3d.position.z + Math.sin(angle) * offset,
    );
    spawnMinion(world, arch, pos);
  }
  world.emit('audio:sfx', { id: 'boss-summon' });
  world.emit('fx:screenshake', { amplitude: 0.12, duration: 0.15 });
  return true;
}

function spawnMinion(world: World, arch: ArchetypeDef, pos: Vector3): void {
  const { rig, flashMaterials } = arch.buildMesh();
  rig.position.copy(pos);
  rig.position.y = arch.yOffset;

  const tags = ['mob', 'hostile', 'combatant', 'dungeon'];
  const entity = createEntity({ object3d: rig, tags });

  setComponent<TransformComponent>(entity, C.Transform, {
    velocity: new Vector3(),
    grounded: !arch.floats,
  });
  setComponent<HealthComponent>(entity, C.Health, {
    hp: arch.hp, maxHp: arch.hp, lastHitTime: 0, invulnUntil: 0,
  });
  setComponent<ResourceComponent>(entity, C.Resource, {
    kind: arch.resourceKind, current: 100, max: 100,
    regenPerSec: arch.attackKind === 'ranged' ? 8 : 4,
  });
  setComponent<FactionComponent>(entity, C.Faction, { faction: 'hostile' });
  setComponent<CombatantComponent>(entity, C.Combatant, {
    baseDamage: arch.damage, attackRange: arch.attackRange,
    attackSpeed: arch.attackSpeed, lastAttackTime: 0, critChance: 0, critMult: 1,
  });
  setComponent<AIBrainComponent>(entity, C.AIBrain, {
    state: 'idle', targetId: null,
    leashOrigin: pos.clone(), leashRadius: 30,
    aggroRadius: arch.aggroRadius * 1.5, attackRange: arch.attackRange,
    nextThinkTime: Math.random() * 0.1,
  });
  setComponent<MoveTargetComponent>(entity, C.MoveTarget, { target: null, speed: arch.speed });
  setComponent<HitboxComponent>(entity, C.Hitbox, {
    radius: arch.hitboxRadius, height: arch.hitboxHeight,
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
  entity.components.set('mobXpReward', arch.xpReward);

  world.spawn(entity);
}

// ============================================================================
// ATTACK 4 — CHARGE
// ============================================================================

function startCharge(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  const player = gameState.player;
  if (!player) { rt.currentAttack = null; return; }
  const dir = new Vector3(
    player.object3d.position.x - boss.object3d.position.x,
    0,
    player.object3d.position.z - boss.object3d.position.z,
  );
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  boss.object3d.rotation.y = Math.atan2(dir.x, dir.z);

  // Line telegraph: long thin plane along charge path (8m)
  const tg = spawnLineTelegraph(world.scene, boss.object3d.position, dir, 8, 1.6, now, now + 0.6);
  rt.telegraphs.add(tg);
  // We could keep telegraph TTL = 0.6 and stop early — but caller drives removal via TTL anyway.
  rt.attackState = {
    kind: 'charge',
    windupEnd: now + 0.6,
    chargeEnd: now + 0.6 + 0.5, // 8m at 16 m/s = 0.5s
    dir,
    hit: false,
  };
  // Stash telegraph removal hint; we'll just let TTL handle it.
  rt.telegraphs.add(tg);
}

function updateCharge(world: World, boss: Entity, _rt: BossRuntime, st: AttackInstanceState, now: number, dt: number): boolean {
  if (st.kind !== 'charge') return true;
  if (now < st.windupEnd) return false;
  if (now >= st.chargeEnd) {
    return true;
  }
  // Charge — 16 m/s
  const speed = 16;
  boss.object3d.position.x += st.dir.x * speed * dt;
  boss.object3d.position.z += st.dir.z * speed * dt;
  // Hit player if in path (first hit only)
  if (!st.hit) {
    const player = gameState.player;
    if (player && player.alive) {
      const dx = player.object3d.position.x - boss.object3d.position.x;
      const dz = player.object3d.position.z - boss.object3d.position.z;
      if (Math.hypot(dx, dz) < 2.0) {
        st.hit = true;
        world.emit('damage:dealt', {
          sourceId: boss.id, targetId: player.id, amount: 40, isCrit: false,
        });
        world.emit('fx:hit', {
          x: player.object3d.position.x, y: player.object3d.position.y + 1,
          z: player.object3d.position.z, color: COLOR_EMBER, isCrit: false,
        });
        world.emit('fx:hitstop', { duration: 0.08 });
        world.emit('fx:screenshake', { amplitude: 0.35, duration: 0.25 });
        // Knockback: shove the player along charge dir
        const ndx = st.dir.x * 2.5;
        const ndz = st.dir.z * 2.5;
        player.object3d.position.x += ndx;
        player.object3d.position.z += ndz;
      }
    }
  }
  return false;
}

// ============================================================================
// ATTACK 5 — DEATH WAVE (phase 2)
// ============================================================================

function startDeathWave(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  // Quick telegraph at boss position
  const tg = spawnCircleTelegraph(world.scene, boss.object3d.position, 1.5, now, now + 0.3);
  rt.telegraphs.add(tg);
  rt.attackState = {
    kind: 'death-wave',
    nextEmitTime: now + 0.3,
    endTime: now + 0.3 + 3.0,
    pulses: [],
  };
}

function updateDeathWave(world: World, boss: Entity, _rt: BossRuntime, st: AttackInstanceState, now: number, dt: number): boolean {
  if (st.kind !== 'death-wave') return true;

  // Emit pulses every 0.4s while inside window
  if (now < st.endTime && now >= st.nextEmitTime) {
    st.nextEmitTime += 0.4;
    const origin = boss.object3d.position.clone();
    origin.y = 0.05;
    const ringMat = new MeshBasicMaterial({
      color: COLOR_TELEGRAPH,
      transparent: true,
      opacity: 0.85,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(new RingGeometry(0.4, 1.0, 48), ringMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(origin);
    world.scene.add(mesh);
    st.pulses.push({ startTime: now, origin, mesh, hitPlayer: false });
    world.emit('audio:sfx', { id: 'boss-wave' });
  }

  // Advance pulses (8 m/s outward, max radius ~14m)
  const player = gameState.player;
  for (let i = st.pulses.length - 1; i >= 0; i--) {
    const p = st.pulses[i]!;
    const t = now - p.startTime;
    const radius = 0.5 + t * 8;
    const thickness = 0.6;
    p.mesh.geometry.dispose();
    p.mesh.geometry = new RingGeometry(Math.max(0.01, radius - thickness * 0.5), radius + thickness * 0.5, 48);
    (p.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 0.85 - t * 0.15);

    if (!p.hitPlayer && player && player.alive) {
      const dx = player.object3d.position.x - p.origin.x;
      const dz = player.object3d.position.z - p.origin.z;
      const distP = Math.hypot(dx, dz);
      if (Math.abs(distP - radius) < thickness * 0.5) {
        p.hitPlayer = true;
        world.emit('damage:dealt', {
          sourceId: boss.id, targetId: player.id, amount: 12, isCrit: false,
        });
        world.emit('fx:hit', {
          x: player.object3d.position.x, y: player.object3d.position.y + 1,
          z: player.object3d.position.z, color: COLOR_TELEGRAPH, isCrit: false,
        });
      }
    }

    if (radius > 14 || t > 2.5) {
      world.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as MeshBasicMaterial).dispose();
      st.pulses.splice(i, 1);
    }
  }

  // Done when window closed AND no pulses remain
  // (also failsafe time)
  if (now >= st.endTime && st.pulses.length === 0) return true;
  if (now >= st.endTime + 4) {
    // Cleanup remaining
    for (const p of st.pulses) {
      world.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as MeshBasicMaterial).dispose();
    }
    st.pulses.length = 0;
    return true;
  }
  void dt;
  return false;
}

// ============================================================================
// ATTACK 6 — METEOR RAIN (phase 2)
// ============================================================================

function startMeteorRain(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  const impacts: MeteorImpact[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 8;
    const pos = new Vector3(
      boss.object3d.position.x + Math.cos(angle) * r,
      0,
      boss.object3d.position.z + Math.sin(angle) * r,
    );
    const spawnTime = now + i * 0.6;
    const impactTime = spawnTime + 1.0;
    const tg = spawnCircleTelegraph(world.scene, pos, 4, spawnTime, impactTime);
    rt.telegraphs.add(tg);
    impacts.push({ spawnTime, impactTime, pos, telegraph: tg, meteor: null, resolved: false });
  }
  rt.attackState = {
    kind: 'meteor-rain',
    impacts,
    endTime: now + 4.0,
  };
}

function updateMeteorRain(world: World, _boss: Entity, rt: BossRuntime, st: AttackInstanceState, now: number): boolean {
  if (st.kind !== 'meteor-rain') return true;

  const player = gameState.player;
  for (const imp of st.impacts) {
    if (imp.resolved) continue;
    if (now < imp.spawnTime) continue;

    // Spawn falling meteor visual at impact-spawnTime
    if (!imp.meteor) {
      const meteorMat = new MeshStandardMaterial({
        color: COLOR_EMBER,
        emissive: COLOR_EMBER,
        emissiveIntensity: 1.4,
        roughness: 0.4,
      });
      const meteor = new Mesh(new SphereGeometry(0.6, 12, 10), meteorMat);
      meteor.position.set(imp.pos.x, 12, imp.pos.z);
      world.scene.add(meteor);
      imp.meteor = meteor;
    }
    if (imp.meteor) {
      const t = (now - imp.spawnTime) / Math.max(0.001, imp.impactTime - imp.spawnTime);
      imp.meteor.position.y = 12 - 12 * Math.min(1, t);
    }

    if (now >= imp.impactTime) {
      // Resolve
      imp.resolved = true;
      removeTelegraph(world.scene, rt, imp.telegraph);
      if (imp.meteor) {
        world.scene.remove(imp.meteor);
        imp.meteor.geometry.dispose();
        (imp.meteor.material as MeshStandardMaterial).dispose();
        imp.meteor = null;
      }
      world.emit('fx:screenshake', { amplitude: 0.3, duration: 0.25 });
      world.emit('audio:sfx', { id: 'boss-meteor' });

      if (player && player.alive) {
        const dx = player.object3d.position.x - imp.pos.x;
        const dz = player.object3d.position.z - imp.pos.z;
        if (Math.hypot(dx, dz) <= 4) {
          world.emit('damage:dealt', {
            sourceId: 0, targetId: player.id, amount: 35, isCrit: false,
          });
          world.emit('fx:hit', {
            x: player.object3d.position.x, y: player.object3d.position.y + 1,
            z: player.object3d.position.z, color: COLOR_EMBER, isCrit: false,
          });
          // Burn status: tick 4 dmg, 3s
          applyStatus(player, { id: 'burn', endTime: now + 3, power: 4 });
        }
      }
    }
  }

  // Done when all resolved
  for (const imp of st.impacts) {
    if (!imp.resolved) return false;
  }
  return true;
}

// ============================================================================
// ATTACK 7 — REAPER'S EMBRACE (phase 2 ult)
// ============================================================================

function startReapers(world: World, _boss: Entity, rt: BossRuntime, now: number): void {
  // Vanish — hide rig
  rt.rig.visible = false;
  rt.attackState = {
    kind: 'reapers-embrace',
    teleportTime: now + 1.5,
    landTime: now + 1.5,
    impactPos: null,
    telegraph: null,
  };
  world.emit('audio:sfx', { id: 'boss-reapers-vanish' });
}

function updateReapers(world: World, boss: Entity, rt: BossRuntime, st: AttackInstanceState, now: number): boolean {
  if (st.kind !== 'reapers-embrace') return true;

  // Once we cross 1.0s after vanish (0.5s before landing), spawn telegraph at current player pos
  if (!st.telegraph && now >= st.teleportTime - 0.5) {
    const player = gameState.player;
    if (player) {
      const pos = player.object3d.position.clone();
      pos.y = 0;
      st.impactPos = pos;
      const tg = spawnCircleTelegraph(world.scene, pos, 4, now, st.teleportTime);
      rt.telegraphs.add(tg);
      st.telegraph = tg;
    }
  }

  if (now < st.teleportTime) return false;

  // Teleport boss
  if (st.impactPos) {
    boss.object3d.position.x = st.impactPos.x;
    boss.object3d.position.z = st.impactPos.z;
  } else {
    // Fallback: stay where we were
  }
  rt.rig.visible = true;
  rt.rig.position.y = rt.intro.targetY; // reattach to ground

  if (st.telegraph) {
    removeTelegraph(world.scene, rt, st.telegraph);
    st.telegraph = null;
  }

  // AoE 4m, 60 dmg + 1s stun
  const player = gameState.player;
  if (player && player.alive) {
    const dx = player.object3d.position.x - boss.object3d.position.x;
    const dz = player.object3d.position.z - boss.object3d.position.z;
    if (Math.hypot(dx, dz) <= 4) {
      world.emit('damage:dealt', {
        sourceId: boss.id, targetId: player.id, amount: 60, isCrit: false,
      });
      world.emit('fx:hit', {
        x: player.object3d.position.x, y: player.object3d.position.y + 1,
        z: player.object3d.position.z, color: COLOR_TELEGRAPH, isCrit: false,
      });
      applyStatus(player, { id: 'stun', endTime: now + 1, power: 1 });
    }
  }
  world.emit('fx:screenshake', { amplitude: 0.6, duration: 0.5 });
  world.emit('fx:hitstop', { duration: 0.1 });
  world.emit('audio:sfx', { id: 'boss-reapers-land' });
  return true;
}

// ============================================================================
// PHASE TRANSITION
// ============================================================================

function triggerPhaseTransition(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  rt.hasTriggeredPhase2 = true;
  rt.phase = 2;
  boss.components.set(BOSS_PHASE_KEY, 2);
  rt.invulnUntil = now + PHASE_TRANSITION_INVULN;

  // Emissive boost on torso/head/cloak
  for (const m of rt.flashMaterials) {
    m.emissive.setHex(0x802010);
    m.emissiveIntensity = 0.9;
  }

  // Cancel any in-progress attack cleanly
  if (rt.attackState) {
    cancelAttack(world, rt);
  }
  rt.currentAttack = null;
  rt.nextAttackTime = now + PHASE_TRANSITION_INVULN + 0.4;

  world.emit('fx:screenshake', { amplitude: 0.6, duration: 0.8 });
  world.emit('fx:hitstop', { duration: 0.12 });
  world.emit('audio:sfx', { id: 'boss-scream' });

  setBarPhaseMark(2);
}

function cancelAttack(world: World, rt: BossRuntime): void {
  // Remove any active telegraphs
  for (const tg of rt.telegraphs) {
    if (!tg.removed) {
      world.scene.remove(tg.obj);
      tg.removed = true;
    }
  }
  rt.telegraphs.clear();
  rt.attackState = null;
}

// ============================================================================
// DEATH
// ============================================================================

function triggerBossDeath(world: World, _boss: Entity, rt: BossRuntime): void {
  if (rt.death.active) return;
  rt.death.active = true;
  rt.death.startTime = performance.now() / 1000;
  rt.death.duration = 2.0;

  // Cleanup any active visuals
  for (const tg of rt.telegraphs) {
    if (!tg.removed) {
      world.scene.remove(tg.obj);
      tg.removed = true;
    }
  }
  rt.telegraphs.clear();

  world.emit('fx:screenshake', { amplitude: 0.8, duration: 1.0 });
  world.emit('audio:sfx', { id: 'boss-death' });
  world.emit('fx:hitstop', { duration: 0.2 });
}

function advanceDeath(world: World, boss: Entity, rt: BossRuntime, now: number): void {
  const t = (now - rt.death.startTime) / rt.death.duration;
  // Sink + fade
  rt.rig.position.y = rt.intro.targetY - t * 1.2;
  for (const m of rt.flashMaterials) {
    m.transparent = true;
    m.opacity = Math.max(0, 1 - t);
  }
  for (const cp of rt.cloakPlanes) {
    const m = cp.material as MeshStandardMaterial;
    m.opacity = Math.max(0, 0.85 - t);
  }

  if (!rt.death.emittedDefeated && t >= 0.4) {
    rt.death.emittedDefeated = true;
    // Custom events for other modules — emit as audio:sfx fallback since EventMap is fixed.
    // We cannot emit untyped events; instead, use audio:sfx as a signaling channel for these.
    // The dungeons module is expected to listen for entity:died on a 'boss'-tagged entity.
    world.emit('audio:sfx', { id: 'boss:defeated:dungeon-1' });
    world.emit('audio:sfx', {
      id: 'boss:legendary-drop',
      x: boss.object3d.position.x,
      z: boss.object3d.position.z,
    });
  }

  if (t >= 1) {
    hideBossBar();
  }
}

// ============================================================================
// COSMETIC ANIMATION HELPERS
// ============================================================================

function animateCloak(rt: BossRuntime, now: number): void {
  // Cloak planes drift / flutter
  const intensity = rt.phase === 2 ? 1.6 : 1.0;
  for (let i = 0; i < rt.cloakPlanes.length; i++) {
    const cp = rt.cloakPlanes[i]!;
    const phase = i * 0.6;
    cp.rotation.x = Math.sin(now * 1.5 + phase) * 0.15 * intensity;
    cp.rotation.z = Math.sin(now * 1.2 + phase * 1.3) * 0.1 * intensity;
  }
}

function flashBoss(rt: BossRuntime): void {
  const now = performance.now() / 1000;
  rt.flashEndTime = now + 0.1;
  for (const m of rt.flashMaterials) {
    m.color.setHex(0xff5050);
  }
}

// ============================================================================
// TELEGRAPH PRIMITIVES
// ============================================================================

function spawnCircleTelegraph(scene: Object3D, center: Vector3, radius: number, startTime: number, endTime: number): TelegraphHandle {
  const fillMat = new MeshBasicMaterial({
    color: COLOR_TELEGRAPH,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    depthWrite: false,
  });
  const fill = new Mesh(new CircleGeometry(radius, 32), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(center.x, 0.05, center.z);

  const ringMat = new MeshBasicMaterial({
    color: COLOR_TELEGRAPH,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
    depthWrite: false,
  });
  const ring = new Mesh(new RingGeometry(radius - 0.08, radius, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(center.x, 0.06, center.z);

  const group = new Group();
  group.add(fill);
  group.add(ring);
  scene.add(group);

  return { obj: group, startTime, endTime, fillMat, removed: false };
}

function spawnArcTelegraph(scene: Object3D, center: Vector3, yaw: number, radius: number, arc: number, startTime: number, endTime: number): TelegraphHandle {
  // Use a RingGeometry with thetaStart/thetaLength for the arc
  const fillMat = new MeshBasicMaterial({
    color: COLOR_TELEGRAPH,
    transparent: true,
    opacity: 0.22,
    side: DoubleSide,
    depthWrite: false,
  });
  const thetaStart = -arc / 2 + Math.PI / 2 - yaw;
  const fill = new Mesh(new RingGeometry(0.2, radius, 32, 1, thetaStart, arc), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(center.x, 0.05, center.z);

  const edgeMat = new MeshBasicMaterial({
    color: COLOR_TELEGRAPH,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
    depthWrite: false,
  });
  const edge = new Mesh(new RingGeometry(radius - 0.08, radius, 32, 1, thetaStart, arc), edgeMat);
  edge.rotation.x = -Math.PI / 2;
  edge.position.set(center.x, 0.06, center.z);

  const group = new Group();
  group.add(fill);
  group.add(edge);
  scene.add(group);
  return { obj: group, startTime, endTime, fillMat, removed: false };
}

function spawnLineTelegraph(scene: Object3D, origin: Vector3, dir: Vector3, length: number, width: number, startTime: number, endTime: number): TelegraphHandle {
  const fillMat = new MeshBasicMaterial({
    color: COLOR_TELEGRAPH,
    transparent: true,
    opacity: 0.22,
    side: DoubleSide,
    depthWrite: false,
  });
  const plane = new Mesh(new PlaneGeometry(width, length), fillMat);
  plane.rotation.x = -Math.PI / 2;
  // Position center at origin + dir * length/2
  plane.position.set(
    origin.x + dir.x * length * 0.5,
    0.05,
    origin.z + dir.z * length * 0.5,
  );
  plane.rotation.z = Math.atan2(dir.x, dir.z);
  scene.add(plane);
  return { obj: plane, startTime, endTime, fillMat, removed: false };
}

function spawnSpikeBurst(scene: Object3D, pos: Vector3, _now: number): void {
  // 5-7 quick cones bursting upward and falling. Auto-removed after 0.6s.
  const group = new Group();
  const mat = new MeshStandardMaterial({
    color: COLOR_BONE,
    emissive: 0x401010,
    emissiveIntensity: 0.4,
    roughness: 0.6,
  });
  const count = 6;
  for (let i = 0; i < count; i++) {
    const cone = new Mesh(new ConeGeometry(0.18, 1.4, 6), mat);
    const a = (i / count) * Math.PI * 2;
    const r = 0.5 + Math.random() * 0.6;
    cone.position.set(Math.cos(a) * r, 0.7, Math.sin(a) * r);
    cone.rotation.z = (Math.random() - 0.5) * 0.3;
    cone.rotation.x = (Math.random() - 0.5) * 0.3;
    group.add(cone);
  }
  group.position.copy(pos);
  group.position.y = 0;
  scene.add(group);
  // Schedule removal via a userData TTL the telegraph anim picks up — but simpler: setTimeout.
  setTimeout(() => {
    scene.remove(group);
    mat.dispose();
    for (const child of group.children) {
      if ((child as Mesh).geometry) (child as Mesh).geometry.dispose();
    }
  }, 600);
}

function removeTelegraph(scene: Object3D, rt: BossRuntime, tg: TelegraphHandle): void {
  if (tg.removed) return;
  tg.removed = true;
  scene.remove(tg.obj);
  rt.telegraphs.delete(tg);
}

function animateTelegraphs(now: number, rt: BossRuntime): void {
  for (const tg of rt.telegraphs) {
    if (tg.removed) continue;
    const t = (now - tg.startTime) / Math.max(0.01, tg.endTime - tg.startTime);
    // Pulsing fill — base 0.18 to 0.55 ramp + sine flicker
    const baseOpacity = 0.18 + Math.min(1, t) * 0.4;
    const flicker = Math.sin(now * 18) * 0.05;
    tg.fillMat.opacity = Math.max(0, baseOpacity + flicker);
  }
}

// ============================================================================
// BOSS UI BAR
// ============================================================================

let barRoot: HTMLDivElement | null = null;
let barFill: HTMLDivElement | null = null;
let barLabel: HTMLDivElement | null = null;
let barPhaseMark: HTMLDivElement | null = null;

function injectBossUI(uiRoot: HTMLElement): void {
  if (barRoot) return;
  // CSS
  const style = document.createElement('style');
  style.textContent = `
    #boss-bar {
      position: absolute;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      width: 60%;
      max-width: 720px;
      pointer-events: none;
      display: none;
      font-family: 'Cinzel', 'Trajan Pro', serif;
      color: #f0d8d0;
      text-shadow: 0 0 6px #200, 0 0 1px #000;
      user-select: none;
    }
    #boss-bar.visible { display: block; }
    #boss-bar-label {
      text-align: center;
      letter-spacing: 0.4em;
      font-size: 18px;
      text-transform: uppercase;
      margin-bottom: 4px;
      color: #ffd0c8;
    }
    #boss-bar-frame {
      position: relative;
      height: 22px;
      border: 1px solid #802018;
      background: linear-gradient(180deg, #100204 0%, #050102 100%);
      box-shadow: 0 0 18px rgba(255,40,40,0.35), inset 0 0 12px rgba(80,8,8,0.6);
      border-radius: 2px;
      overflow: hidden;
    }
    #boss-bar-fill {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 100%;
      background: linear-gradient(90deg, #500 0%, #c00 35%, #f30 70%, #fa3 100%);
      box-shadow: inset 0 0 8px rgba(255,80,40,0.7);
      transition: width 80ms linear;
    }
    #boss-bar-frame::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        90deg,
        rgba(0,0,0,0.0) 0,
        rgba(0,0,0,0.0) 24px,
        rgba(0,0,0,0.35) 24px,
        rgba(0,0,0,0.35) 25px
      );
    }
    #boss-bar-phase {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 14px;
      font-weight: bold;
      letter-spacing: 0.1em;
      color: #ffe6c8;
      text-shadow: 0 0 4px #000, 0 0 8px #f60;
      display: none;
    }
    #boss-bar-phase.show { display: block; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'boss-bar';
  root.innerHTML = `
    <div id="boss-bar-label">BOSS</div>
    <div id="boss-bar-frame">
      <div id="boss-bar-fill"></div>
      <div id="boss-bar-phase">II</div>
    </div>
  `;
  uiRoot.appendChild(root);

  barRoot = root;
  barLabel = root.querySelector<HTMLDivElement>('#boss-bar-label');
  barFill = root.querySelector<HTMLDivElement>('#boss-bar-fill');
  barPhaseMark = root.querySelector<HTMLDivElement>('#boss-bar-phase');
}

function showBossBar(name: string): void {
  if (!barRoot || !barLabel) return;
  barLabel.textContent = name;
  barRoot.classList.add('visible');
  if (barPhaseMark) barPhaseMark.classList.remove('show');
  if (barFill) barFill.style.width = '100%';
}

function hideBossBar(): void {
  if (!barRoot) return;
  barRoot.classList.remove('visible');
}

function updateBossBar(hp: number, maxHp: number, _phase: 1 | 2): void {
  if (!barFill) return;
  const pct = Math.max(0, Math.min(1, hp / Math.max(1, maxHp))) * 100;
  barFill.style.width = pct.toFixed(2) + '%';
}

function setBarPhaseMark(phase: 1 | 2): void {
  if (!barPhaseMark) return;
  if (phase === 2) barPhaseMark.classList.add('show');
  else barPhaseMark.classList.remove('show');
}
