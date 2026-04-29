// Archetype definitions for DUSK mobs.
// Each archetype declares stats, AI tuning, and a mesh factory.
//
// Visual rigs are Groups with NAMED child meshes (head, torso, armL, armR,
// legL, legR, sword, axe, bow, cape, etc.) so mobs/animation.ts can find them
// without hunting through the hierarchy. Hitbox (capsule) dimensions stay the
// same as Wave 1 — only the visual silhouette changes.

import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { COLORS } from '../constants';
import { applyIridescence, applyRimLight, makeMobCapeMaterial } from './shaders';

export type ArchetypeId =
  | 'skeleton-warrior'
  | 'skeleton-archer'
  | 'zombie'
  | 'wraith'
  | 'brute';

export type AttackKind = 'melee' | 'ranged';

export interface ArchetypeDef {
  id: ArchetypeId;
  hp: number;
  speed: number;
  damage: number;
  attackRange: number;
  aggroRadius: number;
  attackSpeed: number; // attacks per second
  attackKind: AttackKind;
  // Wraith / archer kite when low HP and at range
  kiter: boolean;
  // Archer maintains distance — flees if player closer than this
  minPreferredRange: number;
  // Brute does AoE melee within this radius — 0 means single-target only
  meleeAoeRadius: number;
  // Bobbing animation tuning (used by ai.ts)
  bobAmplitude: number;
  bobFrequency: number;
  // Floats (no legs, hovers off ground)
  floats: boolean;
  // Uniform Y offset for the whole rig (e.g. wraith hovers)
  yOffset: number;
  // Hitbox
  hitboxRadius: number;
  hitboxHeight: number;
  // Resource kind for ranged casters
  resourceKind: 'mana' | 'energy';
  // XP awarded on kill
  xpReward: number;
  // Spawn weight (must sum to 1.0 across all)
  spawnWeight: number;
  // Hard cap (e.g. brute=3)
  spawnCap: number;
  // Names of the child meshes the animation system should snapshot for "rest".
  animatedParts: string[];
  // Build the visual rig — returns an Object3D centered on entity origin.
  // Also returns the materials we want to flash red on hit.
  buildMesh: () => { rig: Object3D; flashMaterials: MeshStandardMaterial[] };
}

// ---------- palette ----------

const BONE = 0xe8dfc8;
const BONE_DARK = 0x4a4438;
const BONE_RIB = 0xd6cbb0;
const SKULL_EYE = 0xff3030;
const ZOMBIE_SKIN = 0x556633;
const ZOMBIE_PATCH = 0x6a4828;
const ZOMBIE_DARK = 0x33402a;
const WRAITH_BLUE = 0x70a8ff;
const WRAITH_PURPLE = 0x2a1a4a;
const WRAITH_EMISSIVE = 0x305088;
const WRAITH_EYE = 0x5090ff;
const BRUTE_RED = 0x4a2818;
const BRUTE_DARK = 0x2c160a;
const BRUTE_METAL = 0x707078;
const BRUTE_EYE = 0xffa030;

// ---------- skeleton warrior ----------

function buildSkeletonWarrior(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();

  const boneMat = applyRimLight(
    new MeshStandardMaterial({ color: BONE, roughness: 0.7, metalness: 0.05 }),
  );
  const skullMat = applyRimLight(
    new MeshStandardMaterial({ color: BONE, roughness: 0.55, metalness: 0.05 }),
  );
  const eyeMat = new MeshStandardMaterial({
    color: 0x100000,
    emissive: SKULL_EYE,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  const swordMat = applyRimLight(
    new MeshStandardMaterial({ color: BONE_DARK, roughness: 0.4, metalness: 0.6 }),
    0x80a0ff,
    2.5,
    0.5,
  );

  // Torso = capsule (named for animation)
  const torso = new Mesh(new CapsuleGeometry(0.32, 0.7, 4, 8), boneMat);
  torso.name = 'torso';
  torso.position.y = 0.85;
  rig.add(torso);

  // Pelvis box
  const pelvis = new Mesh(new BoxGeometry(0.34, 0.18, 0.22), boneMat);
  pelvis.position.y = 0.55;
  rig.add(pelvis);

  // Skull + eyes
  const head = makeSkull(skullMat, eyeMat, 0.22);
  head.name = 'head';
  head.position.y = 1.55;
  rig.add(head);

  // Arms (named) — pivot at shoulder so we rotate around the top
  const armL = makeLimb(boneMat, 0.07, 0.65, 'armL');
  armL.position.set(-0.4, 1.05, 0);
  rig.add(armL);
  const armR = makeLimb(boneMat, 0.07, 0.65, 'armR');
  armR.position.set(0.4, 1.05, 0);
  rig.add(armR);

  // Legs
  const legL = makeLimb(boneMat, 0.085, 0.6, 'legL');
  legL.position.set(-0.13, 0.45, 0);
  rig.add(legL);
  const legR = makeLimb(boneMat, 0.085, 0.6, 'legR');
  legR.position.set(0.13, 0.45, 0);
  rig.add(legR);

  // Sword — pivot near hilt so rotation looks like a swing
  const sword = new Group();
  sword.name = 'sword';
  const blade = new Mesh(new CylinderGeometry(0.04, 0.04, 0.9, 6), swordMat);
  blade.position.y = -0.45;
  sword.add(blade);
  sword.position.set(0.5, 0.95, 0.15);
  sword.rotation.x = -0.4;
  rig.add(sword);

  return { rig, flashMaterials: [boneMat, skullMat, swordMat] };
}

// ---------- skeleton archer ----------

function buildSkeletonArcher(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();

  const boneMat = applyRimLight(
    new MeshStandardMaterial({ color: BONE, roughness: 0.7, metalness: 0.05 }),
  );
  const skullMat = applyRimLight(
    new MeshStandardMaterial({ color: BONE, roughness: 0.55, metalness: 0.05 }),
  );
  const ribMat = applyRimLight(
    new MeshStandardMaterial({ color: BONE_RIB, roughness: 0.7, metalness: 0.05 }),
  );
  const eyeMat = new MeshStandardMaterial({
    color: 0x100000,
    emissive: SKULL_EYE,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const bowMat = applyRimLight(
    new MeshStandardMaterial({ color: BONE_DARK, roughness: 0.6, metalness: 0.05 }),
  );

  // Torso (slightly slimmer)
  const torso = new Mesh(new CapsuleGeometry(0.28, 0.55, 4, 8), boneMat);
  torso.name = 'torso';
  torso.position.y = 0.85;
  rig.add(torso);

  // Rib cage — 4 thin cylinders wrapping the torso
  for (let i = 0; i < 4; i++) {
    const rib = new Mesh(new CylinderGeometry(0.22, 0.22, 0.04, 12, 1, true), ribMat);
    rib.position.y = 0.78 + i * 0.08;
    rig.add(rib);
  }

  // Pelvis box
  const pelvis = new Mesh(new BoxGeometry(0.3, 0.16, 0.2), boneMat);
  pelvis.position.y = 0.5;
  rig.add(pelvis);

  // Skull
  const head = makeSkull(skullMat, eyeMat, 0.18);
  head.name = 'head';
  head.position.y = 1.45;
  rig.add(head);

  // Arms
  const armL = makeLimb(boneMat, 0.06, 0.6, 'armL');
  armL.position.set(-0.34, 1.0, 0);
  rig.add(armL);
  const armR = makeLimb(boneMat, 0.06, 0.6, 'armR');
  armR.position.set(0.34, 1.0, 0);
  rig.add(armR);

  // Legs (slightly thinner — limp animation handles asymmetry)
  const legL = makeLimb(boneMat, 0.075, 0.55, 'legL');
  legL.position.set(-0.11, 0.4, 0);
  rig.add(legL);
  const legR = makeLimb(boneMat, 0.075, 0.55, 'legR');
  legR.position.set(0.11, 0.4, 0);
  rig.add(legR);

  // Bow — held vertically in left hand
  const bow = new Group();
  bow.name = 'bow';
  const bowShaft = new Mesh(new BoxGeometry(0.05, 0.9, 0.02), bowMat);
  bow.add(bowShaft);
  const bowTipTop = new Mesh(new CylinderGeometry(0.025, 0.04, 0.12, 6), bowMat);
  bowTipTop.position.y = 0.5;
  bowTipTop.rotation.z = 0.3;
  bow.add(bowTipTop);
  const bowTipBot = new Mesh(new CylinderGeometry(0.04, 0.025, 0.12, 6), bowMat);
  bowTipBot.position.y = -0.5;
  bowTipBot.rotation.z = -0.3;
  bow.add(bowTipBot);
  bow.position.set(-0.42, 1.0, 0.05);
  rig.add(bow);

  return { rig, flashMaterials: [boneMat, skullMat, ribMat, bowMat] };
}

// ---------- zombie ----------

function buildZombie(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();

  const skinMat = applyRimLight(
    new MeshStandardMaterial({ color: ZOMBIE_SKIN, roughness: 0.95, metalness: 0.0 }),
  );
  const patchMat = applyRimLight(
    new MeshStandardMaterial({ color: ZOMBIE_PATCH, roughness: 0.95, metalness: 0.0 }),
  );
  const armMat = applyRimLight(
    new MeshStandardMaterial({ color: ZOMBIE_DARK, roughness: 0.95, metalness: 0.0 }),
  );

  // Torso — hunched: leans forward via a tilted parent group
  const hunch = new Group();
  hunch.rotation.x = 0.25; // lean forward
  hunch.position.y = 0.95;
  rig.add(hunch);

  const torso = new Mesh(new CapsuleGeometry(0.42, 0.7, 4, 8), skinMat);
  torso.name = 'torso';
  hunch.add(torso);

  // Skin patches (patches of darker color) attached to torso
  const patch1 = new Mesh(new SphereGeometry(0.18, 6, 6), patchMat);
  patch1.position.set(0.18, 0.05, 0.32);
  patch1.scale.set(1.0, 0.6, 0.4);
  hunch.add(patch1);
  const patch2 = new Mesh(new SphereGeometry(0.14, 6, 6), patchMat);
  patch2.position.set(-0.22, -0.18, 0.3);
  patch2.scale.set(1.0, 0.7, 0.5);
  hunch.add(patch2);

  // Head — tilted further forward
  const head = new Mesh(new SphereGeometry(0.28, 12, 10), skinMat);
  head.name = 'head';
  head.position.set(0, 1.55, 0.18);
  head.rotation.x = 0.3;
  rig.add(head);

  // Arms (long, dangling)
  const armL = makeLimb(armMat, 0.1, 0.95, 'armL');
  armL.position.set(-0.45, 1.05, 0.15);
  armL.rotation.x = -0.5;
  rig.add(armL);
  const armR = makeLimb(armMat, 0.1, 0.95, 'armR');
  armR.position.set(0.45, 1.05, 0.15);
  armR.rotation.x = -0.5;
  rig.add(armR);

  // Legs (one will limp via animation)
  const legL = makeLimb(skinMat, 0.13, 0.7, 'legL');
  legL.position.set(-0.16, 0.55, 0);
  rig.add(legL);
  const legR = makeLimb(skinMat, 0.13, 0.7, 'legR');
  legR.position.set(0.16, 0.55, 0);
  rig.add(legR);

  return { rig, flashMaterials: [skinMat, patchMat, armMat] };
}

// ---------- wraith ----------

function buildWraith(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();

  // Inner ghostly body (hidden under cape but provides emissive glow at edges).
  const ghostMat = applyIridescence(
    new MeshStandardMaterial({
      color: WRAITH_BLUE,
      roughness: 0.4,
      metalness: 0.0,
      emissive: WRAITH_EMISSIVE,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.6,
    }),
    0x80b8ff,
    0x40c0ff,
    0xc060ff,
    0.55,
  );
  const eyeMat = new MeshStandardMaterial({
    color: 0x000000,
    emissive: WRAITH_EYE,
    emissiveIntensity: 2.0,
    roughness: 0.4,
  });
  const cloakMat = makeMobCapeMaterial(WRAITH_PURPLE, 0x80b8ff, 0.18, 2.0);
  const trimMat = applyRimLight(
    new MeshStandardMaterial({
      color: 0x4060c0,
      emissive: 0x4080ff,
      emissiveIntensity: 0.8,
      roughness: 0.5,
      metalness: 0.0,
    }),
    0x80b8ff,
    1.6,
    0.7,
  );

  // Torso (short, tapered) — mostly hidden by cloak
  const torso = new Mesh(new CapsuleGeometry(0.26, 0.42, 4, 8), ghostMat);
  torso.name = 'torso';
  torso.position.y = 0.75;
  rig.add(torso);

  // Hood (cone) — open at the bottom; head is invisible inside it.
  const hood = new Mesh(new ConeGeometry(0.28, 0.5, 12, 1, true), cloakMat);
  hood.position.y = 1.25;
  rig.add(hood);

  // Two glowing eyes deep inside the hood
  const eyeL = new Mesh(new SphereGeometry(0.045, 8, 6), eyeMat);
  eyeL.position.set(-0.07, 1.18, 0.13);
  rig.add(eyeL);
  const eyeR = new Mesh(new SphereGeometry(0.045, 8, 6), eyeMat);
  eyeR.position.set(0.07, 1.18, 0.13);
  rig.add(eyeR);

  // Long dragging cape — a tall plane behind the body, with extra segments for sway.
  const capeGeo = new PlaneGeometry(0.95, 1.5, 6, 8);
  const cape = new Mesh(capeGeo, cloakMat);
  cape.name = 'cape';
  cape.position.set(0, 0.65, -0.05);
  // The cape's local y is centered at origin; we want it hanging down.
  rig.add(cape);

  // A second short cape in front (chest drape) to break silhouette.
  const drapeGeo = new PlaneGeometry(0.55, 0.9, 4, 5);
  const drape = new Mesh(drapeGeo, cloakMat);
  drape.position.set(0, 0.85, 0.18);
  rig.add(drape);

  // Glowing trim along the hood edge
  const trim = new Mesh(new CylinderGeometry(0.28, 0.28, 0.03, 16, 1, true), trimMat);
  trim.position.y = 1.0;
  rig.add(trim);

  // Arms — thin tapered cylinders peeking out of the sleeves
  const armL = makeLimb(ghostMat, 0.05, 0.5, 'armL');
  armL.position.set(-0.3, 0.85, 0);
  armL.rotation.z = 0.3;
  rig.add(armL);
  const armR = makeLimb(ghostMat, 0.05, 0.5, 'armR');
  armR.position.set(0.3, 0.85, 0);
  armR.rotation.z = -0.3;
  rig.add(armR);

  return { rig, flashMaterials: [ghostMat, cloakMat, trimMat] };
}

// ---------- brute ----------

function buildBrute(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();

  const skinMat = applyRimLight(
    new MeshStandardMaterial({
      color: BRUTE_RED,
      roughness: 0.6,
      metalness: 0.1,
      emissive: BRUTE_DARK,
      emissiveIntensity: 0.3,
    }),
    0x80a0ff,
    2.0,
    0.5,
  );
  const headMat = applyRimLight(
    new MeshStandardMaterial({ color: BRUTE_DARK, roughness: 0.5, metalness: 0.2 }),
  );
  const eyeMat = new MeshStandardMaterial({
    color: 0x100000,
    emissive: BRUTE_EYE,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const metalMat = applyRimLight(
    new MeshStandardMaterial({
      color: BRUTE_METAL,
      roughness: 0.35,
      metalness: 0.85,
    }),
    0xa0c0ff,
    1.8,
    0.7,
  );
  const haftMat = applyRimLight(
    new MeshStandardMaterial({ color: BRUTE_DARK, roughness: 0.7, metalness: 0.1 }),
  );

  // Wide shoulders implemented as a flattened box behind the torso
  const shoulders = new Mesh(new BoxGeometry(1.7, 0.45, 0.6), skinMat);
  shoulders.position.y = 1.7;
  rig.add(shoulders);

  // Big torso
  const torso = new Mesh(new CapsuleGeometry(0.62, 0.95, 4, 10), skinMat);
  torso.name = 'torso';
  torso.position.y = 1.2;
  rig.add(torso);

  // Tiny head — short neck, tucked between shoulders
  const head = new Mesh(new SphereGeometry(0.32, 14, 12), headMat);
  head.name = 'head';
  head.position.set(0, 2.0, 0.05);
  rig.add(head);
  const eyeL = new Mesh(new SphereGeometry(0.05, 6, 6), eyeMat);
  eyeL.position.set(-0.1, 2.05, 0.27);
  rig.add(eyeL);
  const eyeR = new Mesh(new SphereGeometry(0.05, 6, 6), eyeMat);
  eyeR.position.set(0.1, 2.05, 0.27);
  rig.add(eyeR);

  // Arms — massive
  const armL = makeLimb(skinMat, 0.22, 1.1, 'armL');
  armL.position.set(-0.85, 1.45, 0);
  armL.rotation.z = 0.15;
  rig.add(armL);
  const armR = makeLimb(skinMat, 0.22, 1.1, 'armR');
  armR.position.set(0.85, 1.45, 0);
  armR.rotation.z = -0.15;
  rig.add(armR);

  // Legs — short and thick
  const legL = makeLimb(skinMat, 0.22, 0.7, 'legL');
  legL.position.set(-0.28, 0.55, 0);
  rig.add(legL);
  const legR = makeLimb(skinMat, 0.22, 0.7, 'legR');
  legR.position.set(0.28, 0.55, 0);
  rig.add(legR);

  // Oversized axe carried over the right shoulder (visible from any angle)
  const axe = new Group();
  axe.name = 'axe';
  const haft = new Mesh(new CylinderGeometry(0.06, 0.06, 1.4, 8), haftMat);
  haft.position.y = 0; // axe pivot at handle midpoint
  axe.add(haft);
  // Big blade (box) attached near the top
  const blade = new Mesh(new BoxGeometry(0.6, 0.05, 0.32), metalMat);
  blade.position.set(0.18, 0.55, 0);
  blade.rotation.z = 0.05;
  axe.add(blade);
  // Counter-weight spike
  const spike = new Mesh(new ConeGeometry(0.1, 0.2, 6), metalMat);
  spike.position.set(-0.18, 0.55, 0);
  spike.rotation.z = -Math.PI / 2;
  axe.add(spike);
  axe.position.set(0.85, 1.6, -0.1);
  axe.rotation.x = -0.3;
  rig.add(axe);

  return { rig, flashMaterials: [skinMat, headMat, metalMat, haftMat] };
}

// ---------- helpers ----------

// Limb = tapered capsule with its origin at the TOP (shoulder/hip).
// We translate the geometry down by half its length so rotation pivots at the top.
function makeLimb(
  mat: MeshStandardMaterial,
  radius: number,
  length: number,
  name: string,
): Group {
  const g = new Group();
  g.name = name;
  const geo = new CapsuleGeometry(radius, length, 4, 8);
  // Capsule is centered at origin along Y; offset down so top of capsule is at g origin.
  geo.translate(0, -(length / 2 + radius * 0.5), 0);
  const m = new Mesh(geo, mat);
  g.add(m);
  return g;
}

// Skull = sphere with two small dark eye sockets sunk into the front face.
function makeSkull(
  skullMat: MeshStandardMaterial,
  eyeMat: MeshStandardMaterial,
  radius: number,
): Group {
  const g = new Group();
  const sphere = new Mesh(new SphereGeometry(radius, 14, 12), skullMat);
  g.add(sphere);
  // Eye sockets: small dark emissive spheres on the front face
  const eyeR = radius * 0.18;
  const eyeZ = radius * 0.85;
  const eyeY = radius * 0.05;
  const eyeXOff = radius * 0.35;
  const eyeL = new Mesh(new SphereGeometry(eyeR, 8, 6), eyeMat);
  eyeL.position.set(-eyeXOff, eyeY, eyeZ);
  g.add(eyeL);
  const eyeRMesh = new Mesh(new SphereGeometry(eyeR, 8, 6), eyeMat);
  eyeRMesh.position.set(eyeXOff, eyeY, eyeZ);
  g.add(eyeRMesh);
  // Subtle jaw box (lower half hint)
  const jaw = new Mesh(new BoxGeometry(radius * 1.1, radius * 0.25, radius * 1.0), skullMat);
  jaw.position.y = -radius * 0.55;
  g.add(jaw);
  return g;
}

// ---------- archetype registry ----------

const COMMON_PARTS = ['torso', 'head', 'armL', 'armR', 'legL', 'legR'];

export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  'skeleton-warrior': {
    id: 'skeleton-warrior',
    hp: 30,
    speed: 5,
    damage: 8,
    attackRange: 1.6,
    aggroRadius: 8,
    attackSpeed: 1.0,
    attackKind: 'melee',
    kiter: false,
    minPreferredRange: 0,
    meleeAoeRadius: 0,
    bobAmplitude: 0.06,
    bobFrequency: 4.5,
    floats: false,
    yOffset: 0,
    hitboxRadius: 0.45,
    hitboxHeight: 1.7,
    resourceKind: 'energy',
    xpReward: 10,
    spawnWeight: 0.35,
    spawnCap: 999,
    animatedParts: [...COMMON_PARTS, 'sword'],
    buildMesh: buildSkeletonWarrior,
  },
  'skeleton-archer': {
    id: 'skeleton-archer',
    hp: 22,
    speed: 4,
    damage: 6,
    attackRange: 12,
    aggroRadius: 14,
    attackSpeed: 0.7,
    attackKind: 'ranged',
    kiter: true,
    minPreferredRange: 4,
    meleeAoeRadius: 0,
    bobAmplitude: 0.05,
    bobFrequency: 4.0,
    floats: false,
    yOffset: 0,
    hitboxRadius: 0.4,
    hitboxHeight: 1.6,
    resourceKind: 'mana',
    xpReward: 10,
    spawnWeight: 0.25,
    spawnCap: 999,
    animatedParts: [...COMMON_PARTS, 'bow'],
    buildMesh: buildSkeletonArcher,
  },
  'zombie': {
    id: 'zombie',
    hp: 60,
    speed: 2.5,
    damage: 12,
    attackRange: 1.6,
    aggroRadius: 6,
    attackSpeed: 0.7,
    attackKind: 'melee',
    kiter: false,
    minPreferredRange: 0,
    meleeAoeRadius: 0,
    bobAmplitude: 0.10,
    bobFrequency: 2.2,
    floats: false,
    yOffset: 0,
    hitboxRadius: 0.55,
    hitboxHeight: 1.9,
    resourceKind: 'energy',
    xpReward: 20,
    spawnWeight: 0.20,
    spawnCap: 999,
    animatedParts: [...COMMON_PARTS],
    buildMesh: buildZombie,
  },
  'wraith': {
    id: 'wraith',
    hp: 25,
    speed: 6,
    damage: 10,
    attackRange: 9,
    aggroRadius: 10,
    attackSpeed: 0.9,
    attackKind: 'ranged',
    kiter: true,
    minPreferredRange: 5,
    meleeAoeRadius: 0,
    bobAmplitude: 0.18,
    bobFrequency: 1.8,
    floats: true,
    yOffset: 0.4,
    hitboxRadius: 0.4,
    hitboxHeight: 1.5,
    resourceKind: 'mana',
    xpReward: 10,
    spawnWeight: 0.15,
    spawnCap: 999,
    animatedParts: ['torso', 'armL', 'armR', 'cape'],
    buildMesh: buildWraith,
  },
  'brute': {
    id: 'brute',
    hp: 200,
    speed: 2,
    damage: 25,
    attackRange: 2.5,
    aggroRadius: 12,
    attackSpeed: 0.5,
    attackKind: 'melee',
    kiter: false,
    minPreferredRange: 0,
    meleeAoeRadius: 2.5,
    bobAmplitude: 0.05,
    bobFrequency: 1.2,
    floats: false,
    yOffset: 0,
    hitboxRadius: 0.85,
    hitboxHeight: 2.4,
    resourceKind: 'energy',
    xpReward: 80,
    spawnWeight: 0.05,
    spawnCap: 3,
    animatedParts: [...COMMON_PARTS, 'axe'],
    buildMesh: buildBrute,
  },
};

export const ARCHETYPE_LIST: ArchetypeDef[] = [
  ARCHETYPES['skeleton-warrior'],
  ARCHETYPES['skeleton-archer'],
  ARCHETYPES['zombie'],
  ARCHETYPES['wraith'],
  ARCHETYPES['brute'],
];

// Pick an archetype by weight, respecting per-archetype caps.
export function pickArchetype(
  spawnedCounts: Record<ArchetypeId, number>,
): ArchetypeDef {
  const eligible = ARCHETYPE_LIST.filter((a) => spawnedCounts[a.id] < a.spawnCap);
  const totalWeight = eligible.reduce((s, a) => s + a.spawnWeight, 0);
  if (totalWeight <= 0) return ARCHETYPES['skeleton-warrior'];
  let r = Math.random() * totalWeight;
  for (const a of eligible) {
    r -= a.spawnWeight;
    if (r <= 0) return a;
  }
  return eligible[eligible.length - 1]!;
}

// Re-export palette helpers for tinting if needed elsewhere.
export const MOB_PALETTE = {
  hostile: COLORS.hostile,
  boss: COLORS.boss,
};
