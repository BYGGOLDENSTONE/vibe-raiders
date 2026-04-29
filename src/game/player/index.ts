// Spawns the player entity with the full component stack and a baseline
// click-to-move locomotion system. Wave 2 (skills/combat) layers on top.
//
// The visual rig is a Group of primitives (head/torso/arms/legs/cape/weapon)
// rather than a single capsule. All consumers that touched player.object3d
// previously only used .position and .rotation — both of which a Group
// supports identically — so this is backward-compatible.

import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { createEntity, setComponent } from '../../core/entity';
import {
  C,
  type ClassId,
  type CombatantComponent,
  type EquipmentComponent,
  type FactionComponent,
  type HealthComponent,
  type HitboxComponent,
  type InventoryComponent,
  type MoveTargetComponent,
  type PlayerComponent,
  type ResourceComponent,
  type SkillUserComponent,
  type StatusEffectsComponent,
  type TransformComponent,
} from '../../core/components';
import { TUNING } from '../constants';
import { gameState, type GameContext } from '../state';
import {
  applyRimLight,
  makeCapeMaterial,
  resetShaderRegistry,
  tickShaderUniforms,
} from './shaders';
import {
  createAnimState,
  setAlive,
  triggerAttackSwing,
  updatePlayerAnimation,
  type PlayerRig,
  type PlayerAnimState,
} from './animation';

// Per-class visual + resource defaults. Centralised so menu/init/hot-swap stay aligned.
interface ClassProfile {
  bodyColor: number;
  trimColor: number;       // emissive accent on head / weapon
  capeColor: number;
  resource: ResourceComponent['kind'];
  resourceMax: number;
  regen: number;
  weapon: 'daggers' | 'greataxe' | 'staff';
}

const CLASS_PROFILE: Record<ClassId, ClassProfile> = {
  rogue: {
    bodyColor: 0x4f6a4a,
    trimColor: 0x80c0a0,
    capeColor: 0x2a3530,
    resource: 'energy',
    resourceMax: 100,
    regen: 12,
    weapon: 'daggers',
  },
  barbarian: {
    bodyColor: 0x6a3a2a,
    trimColor: 0xc06030,
    capeColor: 0x4a2218,
    resource: 'rage',
    resourceMax: 100,
    regen: 0,
    weapon: 'greataxe',
  },
  sorcerer: {
    bodyColor: 0x4a3a6a,
    trimColor: 0x90a0ff,
    capeColor: 0x2a2050,
    resource: 'mana',
    resourceMax: 100,
    regen: 8,
    weapon: 'staff',
  },
};

// References we hold onto across the player lifetime so class-swap can rebuild
// the visual rig without re-spawning the entity.
let currentRig: PlayerRig | null = null;
let animState: PlayerAnimState | null = null;
let prevPos = new Vector3();

export function initPlayer(ctx: GameContext): void {
  resetShaderRegistry();

  const startClass = gameState.selectedClass;
  const profile = CLASS_PROFILE[startClass];

  // Root group is what the entity owns. It is what locomotion moves and
  // what every other module references via .object3d.position / .rotation.
  const root = new Group();
  root.name = 'player-root';
  root.position.set(0, 0.9, 0);

  const rig = buildRig(profile);
  currentRig = rig;
  root.add(rig.body);
  rig.root = root;
  animState = createAnimState();
  prevPos.copy(root.position);

  const player = createEntity({ object3d: root, tags: ['player', 'combatant'] });
  setComponent<TransformComponent>(player, C.Transform, { velocity: new Vector3(), grounded: true });
  setComponent<HealthComponent>(player, C.Health, {
    hp: TUNING.playerBaseHp,
    maxHp: TUNING.playerBaseHp,
    lastHitTime: 0,
    invulnUntil: 0,
  });
  setComponent<ResourceComponent>(player, C.Resource, {
    kind: profile.resource,
    current: profile.resourceMax,
    max: profile.resourceMax,
    regenPerSec: profile.regen,
  });
  setComponent<FactionComponent>(player, C.Faction, { faction: 'player' });
  setComponent<PlayerComponent>(player, C.Player, {
    classId: startClass,
    name: 'Hero',
    color: profile.bodyColor,
    level: 1,
    xp: 0,
    xpToNext: 100,
  });
  setComponent<CombatantComponent>(player, C.Combatant, {
    baseDamage: 10,
    attackRange: 1.6,
    attackSpeed: 2.0,
    lastAttackTime: 0,
    critChance: 0.1,
    critMult: 2.0,
  });
  setComponent<SkillUserComponent>(player, C.SkillUser, {
    slots: [],
    unlockedSlots: [],
    skillRanks: [],
    skillPoints: 0,
  });
  setComponent<MoveTargetComponent>(player, C.MoveTarget, {
    target: null,
    speed: TUNING.playerBaseSpeed,
  });
  setComponent<HitboxComponent>(player, C.Hitbox, { radius: 0.5, height: 1.8 });
  setComponent<InventoryComponent>(player, C.Inventory, { items: [], capacity: 24 });
  setComponent<EquipmentComponent>(player, C.Equipment, {
    weapon: null,
    head: null,
    chest: null,
    accessory: null,
  });
  setComponent<StatusEffectsComponent>(player, C.StatusEffects, { effects: [] });

  ctx.world.spawn(player);
  gameState.player = player;

  // Hot-swap class on 'player:classChanged'. Rebuilds the rig so weapon /
  // colours match the new class without despawning the entity.
  ctx.world.on('player:classChanged', ({ classId }) => {
    const p = gameState.player;
    if (!p) return;
    const prof = CLASS_PROFILE[classId];
    const playerComp = p.components.get(C.Player) as PlayerComponent | undefined;
    if (playerComp) {
      playerComp.classId = classId;
      playerComp.color = prof.bodyColor;
    }
    // Rebuild visual rig.
    if (currentRig) {
      p.object3d.remove(currentRig.body);
      disposeRig(currentRig);
    }
    const newRig = buildRig(prof);
    newRig.root = p.object3d as Group;
    p.object3d.add(newRig.body);
    currentRig = newRig;
    if (animState) animState.alive = true;

    const res = p.components.get(C.Resource) as ResourceComponent | undefined;
    if (res) {
      res.kind = prof.resource;
      res.max = prof.resourceMax;
      res.current = prof.resourceMax;
      res.regenPerSec = prof.regen;
    }
  });

  // Death / respawn → animation hooks.
  ctx.world.on('entity:died', ({ entityId }) => {
    if (!gameState.player || entityId !== gameState.player.id) return;
    if (animState) setAlive(animState, false);
  });

  // Attack swing triggers: any player-sourced damage event or skill cast.
  ctx.world.on('damage:dealt', ({ sourceId }) => {
    const p = gameState.player;
    if (!p || !animState) return;
    if (sourceId !== p.id) return;
    triggerAttackSwing(animState, performance.now() / 1000, 250);
  });
  ctx.world.on('skill:cast', ({ casterId }) => {
    const p = gameState.player;
    if (!p || !animState) return;
    if (casterId !== p.id) return;
    triggerAttackSwing(animState, performance.now() / 1000, 280);
  });

  // Respawn detection: when the dead tag is cleared we transition the rig.
  // Combat module clears player.tags 'dead' and snaps position. We watch tags.
  ctx.world.addSystem(() => {
    if (!gameState.player || !animState) return;
    const isDead = gameState.player.tags.has('dead');
    if (animState.alive && isDead) setAlive(animState, false);
    else if (!animState.alive && !isDead) setAlive(animState, true);
  });

  // Animation system — runs per frame after locomotion has updated position.
  ctx.world.addSystem((_w, frameCtx) => {
    if (!gameState.player || !currentRig || !animState) return;
    const pos = gameState.player.object3d.position;
    const dx = pos.x - prevPos.x;
    const dz = pos.z - prevPos.z;
    const moved = Math.hypot(dx, dz);
    const speed = frameCtx.dt > 0 ? moved / frameCtx.dt : 0;
    prevPos.copy(pos);
    updatePlayerAnimation(currentRig, animState, frameCtx.dt, frameCtx.elapsed, speed);
    tickShaderUniforms(frameCtx.elapsed);
  });

  // Baseline click-to-move locomotion. Wave 2 will add skill movement (dash/blink).
  ctx.world.addSystem((w, frameCtx) => {
    for (const e of w.queryWith(C.MoveTarget)) {
      const mt = e.components.get(C.MoveTarget) as MoveTargetComponent;
      if (!mt.target) continue;
      const px = e.object3d.position.x;
      const pz = e.object3d.position.z;
      const dx = mt.target.x - px;
      const dz = mt.target.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        mt.target = null;
        continue;
      }
      const step = mt.speed * frameCtx.dt;
      if (step >= dist) {
        e.object3d.position.x = mt.target.x;
        e.object3d.position.z = mt.target.z;
        mt.target = null;
      } else {
        const inv = 1 / dist;
        e.object3d.position.x += dx * inv * step;
        e.object3d.position.z += dz * inv * step;
        e.object3d.rotation.y = Math.atan2(dx, dz);
      }
    }
  });
}

// ---------- Rig construction ----------

function buildRig(profile: ClassProfile): PlayerRig {
  // The body group sits at y≈0 inside the root (which itself sits at y=0.9
  // in world space). Total visual height ≈ 1.4 units, matching the previous
  // capsule so cameras / colliders stay aligned.
  const body = new Group();
  body.name = 'player-body';

  const skinMat = applyRimLight(
    new MeshStandardMaterial({ color: profile.bodyColor, roughness: 0.55, metalness: 0.25 }),
  );
  const trimMat = applyRimLight(
    new MeshStandardMaterial({
      color: profile.trimColor,
      roughness: 0.4,
      metalness: 0.6,
      emissive: profile.trimColor,
      emissiveIntensity: 0.25,
    }),
  );

  // ---- Torso ----
  const torso = new Mesh(new CapsuleGeometry(0.28, 0.5, 4, 12), skinMat);
  torso.position.y = 0.05;
  body.add(torso);

  // ---- Head ----
  const head = new Mesh(new SphereGeometry(0.18, 14, 12), skinMat);
  head.position.y = 0.55;
  body.add(head);

  // Head trim ring (hood/circlet) for silhouette readability.
  const circlet = new Mesh(new CylinderGeometry(0.21, 0.22, 0.05, 14), trimMat);
  circlet.position.y = 0.42;
  body.add(circlet);

  // ---- Arms ----
  // Pivot groups so rotation happens around the shoulder, not the arm centre.
  const armRestX = 0.05;
  const leftArm = new Group();
  leftArm.position.set(0.32, 0.32, 0);
  leftArm.rotation.x = armRestX;
  const leftArmMesh = new Mesh(new CapsuleGeometry(0.08, 0.4, 4, 8), skinMat);
  leftArmMesh.position.y = -0.22;
  leftArm.add(leftArmMesh);
  body.add(leftArm);

  const rightArm = new Group();
  rightArm.position.set(-0.32, 0.32, 0);
  rightArm.rotation.x = armRestX;
  const rightArmMesh = new Mesh(new CapsuleGeometry(0.08, 0.4, 4, 8), skinMat);
  rightArmMesh.position.y = -0.22;
  rightArm.add(rightArmMesh);
  body.add(rightArm);

  // ---- Legs ----
  const legRestX = 0;
  const leftLeg = new Group();
  leftLeg.position.set(0.14, -0.35, 0);
  const leftLegMesh = new Mesh(new CapsuleGeometry(0.1, 0.5, 4, 8), skinMat);
  leftLegMesh.position.y = -0.27;
  leftLeg.add(leftLegMesh);
  body.add(leftLeg);

  const rightLeg = new Group();
  rightLeg.position.set(-0.14, -0.35, 0);
  const rightLegMesh = new Mesh(new CapsuleGeometry(0.1, 0.5, 4, 8), skinMat);
  rightLegMesh.position.y = -0.27;
  rightLeg.add(rightLegMesh);
  body.add(rightLeg);

  // ---- Cape ----
  // Three slim PlaneGeometries side-by-side feels like a proper cape and keeps
  // each plane simple. Vertex sway in the shader bends the lower half.
  const cape = new Group();
  cape.position.set(0, 0.32, -0.18);
  cape.rotation.x = -0.1;
  const capeMat = makeCapeMaterial(profile.capeColor);
  const capeWidths: Array<[number, number]> = [
    [-0.22, 0.5],
    [0.0, 0.55],
    [0.22, 0.5],
  ];
  for (const [x, len] of capeWidths) {
    const panel = new Mesh(new PlaneGeometry(0.22, len, 1, 4), capeMat);
    panel.position.set(x, -len / 2, 0);
    cape.add(panel);
  }
  body.add(cape);

  // ---- Weapon ----
  const weapon = buildWeapon(profile, trimMat);
  let hasOffhand = false;
  if (weapon) {
    if (profile.weapon === 'daggers') {
      hasOffhand = true;
      // Right-hand dagger
      rightArm.add(weapon);
      // Mirror onto left arm too
      const offhand = buildWeapon(profile, trimMat);
      if (offhand) {
        offhand.position.x *= -1;
        leftArm.add(offhand);
      }
    } else {
      rightArm.add(weapon);
    }
  }

  return {
    root: body, // overwritten by initPlayer to the actual root group
    body,
    head,
    torso,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    cape,
    weapon,
    armRestX,
    legRestX,
    hasOffhand,
  };
}

function buildWeapon(profile: ClassProfile, trimMat: MeshStandardMaterial): Object3D | null {
  // Built as a small group anchored at the wrist. Hierarchy:
  //   weaponRoot (wrist) → handle + blade/head
  // The right arm rotates the whole thing during attack swing.
  const weaponRoot = new Group();
  weaponRoot.position.set(0, -0.42, 0.05);

  const handleMat = new MeshStandardMaterial({
    color: 0x1a1410,
    roughness: 0.85,
    metalness: 0.1,
  });
  const bladeMat = applyRimLight(
    new MeshStandardMaterial({
      color: 0xb0b8c0,
      roughness: 0.25,
      metalness: 0.9,
      emissive: profile.trimColor,
      emissiveIntensity: 0.15,
    }),
    profile.trimColor,
    2.0,
    1.0,
  );

  if (profile.weapon === 'daggers') {
    const handle = new Mesh(new CylinderGeometry(0.025, 0.025, 0.12, 6), handleMat);
    weaponRoot.add(handle);
    const guard = new Mesh(new BoxGeometry(0.1, 0.02, 0.04), trimMat);
    guard.position.y = 0.07;
    weaponRoot.add(guard);
    const blade = new Mesh(new BoxGeometry(0.04, 0.32, 0.015), bladeMat);
    blade.position.y = 0.24;
    weaponRoot.add(blade);
  } else if (profile.weapon === 'greataxe') {
    const haft = new Mesh(new CylinderGeometry(0.04, 0.04, 0.85, 8), handleMat);
    haft.position.y = 0.25;
    weaponRoot.add(haft);
    const head = new Mesh(new ConeGeometry(0.18, 0.32, 4), bladeMat);
    head.rotation.z = Math.PI / 2;
    head.position.set(0.12, 0.55, 0);
    weaponRoot.add(head);
    // Counterweight nub.
    const nub = new Mesh(new BoxGeometry(0.06, 0.12, 0.06), trimMat);
    nub.position.y = -0.15;
    weaponRoot.add(nub);
  } else if (profile.weapon === 'staff') {
    const shaft = new Mesh(new CylinderGeometry(0.03, 0.035, 1.0, 8), handleMat);
    shaft.position.y = 0.25;
    weaponRoot.add(shaft);
    // Glowing orb on top.
    const orbMat = new MeshStandardMaterial({
      color: profile.trimColor,
      emissive: profile.trimColor,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.0,
    });
    const orb = new Mesh(new SphereGeometry(0.1, 12, 10), orbMat);
    orb.position.y = 0.78;
    weaponRoot.add(orb);
    // Ornament prongs.
    const prong = new Mesh(new BoxGeometry(0.02, 0.18, 0.02), trimMat);
    prong.position.set(0.07, 0.7, 0);
    prong.rotation.z = -0.4;
    weaponRoot.add(prong);
    const prong2 = new Mesh(new BoxGeometry(0.02, 0.18, 0.02), trimMat);
    prong2.position.set(-0.07, 0.7, 0);
    prong2.rotation.z = 0.4;
    weaponRoot.add(prong2);
  } else {
    return null;
  }
  return weaponRoot;
}

function disposeRig(rig: PlayerRig): void {
  rig.body.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else if (mat) {
      mat.dispose();
    }
  });
}
