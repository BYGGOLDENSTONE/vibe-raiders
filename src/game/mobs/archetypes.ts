// Archetype definitions for DUSK mobs.
// Each archetype declares stats, AI tuning, and a mesh factory.

import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import { COLORS } from '../constants';

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
  // Bobbing animation tuning
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
  // Build the visual rig — returns an Object3D centered on entity origin.
  // Also returns the materials we want to flash red on hit.
  buildMesh: () => { rig: Object3D; flashMaterials: MeshStandardMaterial[] };
}

const BONE = 0xe6e0c8;
const BONE_DARK = 0x4a4438;
const ZOMBIE_SKIN = 0x6a8060;
const ZOMBIE_DARK = 0x3a4830;
const WRAITH_BLUE = 0x70a8ff;
const WRAITH_EMISSIVE = 0x305088;
const BRUTE_RED = 0x803020;
const BRUTE_DARK = 0x401010;

function buildSkeletonWarrior(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();
  const torsoMat = new MeshStandardMaterial({ color: BONE, roughness: 0.7, metalness: 0.05 });
  const armMat = new MeshStandardMaterial({ color: BONE, roughness: 0.7, metalness: 0.05 });
  const headMat = new MeshStandardMaterial({ color: BONE, roughness: 0.55, metalness: 0.05 });

  const torso = new Mesh(new CapsuleGeometry(0.32, 0.7, 4, 8), torsoMat);
  torso.position.y = 0.75;
  rig.add(torso);

  const head = new Mesh(new SphereGeometry(0.25, 12, 10), headMat);
  head.position.y = 1.45;
  rig.add(head);

  const armL = new Mesh(new CylinderGeometry(0.08, 0.08, 0.7, 8), armMat);
  armL.position.set(-0.4, 0.85, 0);
  armL.rotation.z = 0.25;
  rig.add(armL);

  const armR = new Mesh(new CylinderGeometry(0.08, 0.08, 0.7, 8), armMat);
  armR.position.set(0.4, 0.85, 0);
  armR.rotation.z = -0.25;
  rig.add(armR);

  // Sword (small dark cylinder)
  const swordMat = new MeshStandardMaterial({ color: BONE_DARK, roughness: 0.4, metalness: 0.6 });
  const sword = new Mesh(new CylinderGeometry(0.04, 0.04, 0.9, 6), swordMat);
  sword.position.set(0.5, 0.9, 0.15);
  sword.rotation.x = -0.4;
  rig.add(sword);

  return { rig, flashMaterials: [torsoMat, armMat, headMat] };
}

function buildSkeletonArcher(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();
  const torsoMat = new MeshStandardMaterial({ color: BONE, roughness: 0.7, metalness: 0.05 });
  const cloakMat = new MeshStandardMaterial({ color: BONE_DARK, roughness: 0.85, metalness: 0.0 });
  const headMat = new MeshStandardMaterial({ color: BONE, roughness: 0.55, metalness: 0.05 });
  const armMat = new MeshStandardMaterial({ color: BONE, roughness: 0.7, metalness: 0.05 });

  const torso = new Mesh(new CapsuleGeometry(0.3, 0.65, 4, 8), torsoMat);
  torso.position.y = 0.7;
  rig.add(torso);

  // Dark cloak — slightly bigger capsule overlay
  const cloak = new Mesh(new CapsuleGeometry(0.36, 0.55, 4, 8), cloakMat);
  cloak.position.y = 0.55;
  rig.add(cloak);

  const head = new Mesh(new SphereGeometry(0.23, 12, 10), headMat);
  head.position.y = 1.35;
  rig.add(head);

  const armL = new Mesh(new CylinderGeometry(0.07, 0.07, 0.65, 8), armMat);
  armL.position.set(-0.36, 0.8, 0);
  armL.rotation.z = 0.2;
  rig.add(armL);

  const armR = new Mesh(new CylinderGeometry(0.07, 0.07, 0.65, 8), armMat);
  armR.position.set(0.36, 0.8, 0);
  armR.rotation.z = -0.2;
  rig.add(armR);

  // Bow — thin cylinder on the side
  const bowMat = new MeshStandardMaterial({ color: BONE_DARK, roughness: 0.6, metalness: 0.05 });
  const bow = new Mesh(new CylinderGeometry(0.03, 0.03, 0.9, 6), bowMat);
  bow.position.set(-0.45, 0.85, 0);
  bow.rotation.x = 0.1;
  rig.add(bow);

  return { rig, flashMaterials: [torsoMat, cloakMat, headMat, armMat] };
}

function buildZombie(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();
  const torsoMat = new MeshStandardMaterial({ color: ZOMBIE_SKIN, roughness: 0.85, metalness: 0.0 });
  const headMat = new MeshStandardMaterial({ color: ZOMBIE_SKIN, roughness: 0.85, metalness: 0.0 });
  const armMat = new MeshStandardMaterial({ color: ZOMBIE_DARK, roughness: 0.85, metalness: 0.0 });

  const torso = new Mesh(new CapsuleGeometry(0.42, 0.85, 4, 8), torsoMat);
  torso.position.y = 0.85;
  rig.add(torso);

  const head = new Mesh(new SphereGeometry(0.3, 12, 10), headMat);
  head.position.y = 1.65;
  head.position.z = 0.05;
  rig.add(head);

  // Arms hanging forward (lurching pose)
  const armL = new Mesh(new CylinderGeometry(0.11, 0.1, 0.85, 8), armMat);
  armL.position.set(-0.45, 0.85, 0.25);
  armL.rotation.x = -0.7;
  rig.add(armL);

  const armR = new Mesh(new CylinderGeometry(0.11, 0.1, 0.85, 8), armMat);
  armR.position.set(0.45, 0.85, 0.25);
  armR.rotation.x = -0.7;
  rig.add(armR);

  return { rig, flashMaterials: [torsoMat, headMat, armMat] };
}

function buildWraith(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();
  // No legs — torso is shorter and tapered. Floats.
  const torsoMat = new MeshStandardMaterial({
    color: WRAITH_BLUE,
    roughness: 0.4,
    metalness: 0.0,
    emissive: WRAITH_EMISSIVE,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.7,
  });
  const headMat = new MeshStandardMaterial({
    color: WRAITH_BLUE,
    roughness: 0.4,
    metalness: 0.0,
    emissive: WRAITH_EMISSIVE,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.75,
  });
  const armMat = new MeshStandardMaterial({
    color: WRAITH_BLUE,
    roughness: 0.4,
    metalness: 0.0,
    emissive: WRAITH_EMISSIVE,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.6,
  });

  const torso = new Mesh(new CapsuleGeometry(0.3, 0.5, 4, 8), torsoMat);
  torso.position.y = 0.7;
  rig.add(torso);

  const head = new Mesh(new SphereGeometry(0.22, 12, 10), headMat);
  head.position.y = 1.25;
  rig.add(head);

  const armL = new Mesh(new CylinderGeometry(0.06, 0.04, 0.55, 8), armMat);
  armL.position.set(-0.32, 0.7, 0);
  armL.rotation.z = 0.3;
  rig.add(armL);

  const armR = new Mesh(new CylinderGeometry(0.06, 0.04, 0.55, 8), armMat);
  armR.position.set(0.32, 0.7, 0);
  armR.rotation.z = -0.3;
  rig.add(armR);

  return { rig, flashMaterials: [torsoMat, headMat, armMat] };
}

function buildBrute(): { rig: Object3D; flashMaterials: MeshStandardMaterial[] } {
  const rig = new Group();
  const torsoMat = new MeshStandardMaterial({
    color: BRUTE_RED,
    roughness: 0.6,
    metalness: 0.1,
    emissive: BRUTE_DARK,
    emissiveIntensity: 0.3,
  });
  const headMat = new MeshStandardMaterial({ color: BRUTE_DARK, roughness: 0.5, metalness: 0.2 });
  const armMat = new MeshStandardMaterial({ color: BRUTE_RED, roughness: 0.6, metalness: 0.1 });

  // Big torso
  const torso = new Mesh(new CapsuleGeometry(0.7, 1.1, 4, 10), torsoMat);
  torso.position.y = 1.2;
  rig.add(torso);

  // Smaller hunched head
  const head = new Mesh(new SphereGeometry(0.38, 14, 12), headMat);
  head.position.set(0, 2.0, 0.15);
  rig.add(head);

  // Massive arms
  const armL = new Mesh(new CylinderGeometry(0.22, 0.2, 1.2, 10), armMat);
  armL.position.set(-0.85, 1.15, 0);
  armL.rotation.z = 0.15;
  rig.add(armL);

  const armR = new Mesh(new CylinderGeometry(0.22, 0.2, 1.2, 10), armMat);
  armR.position.set(0.85, 1.15, 0);
  armR.rotation.z = -0.15;
  rig.add(armR);

  return { rig, flashMaterials: [torsoMat, headMat, armMat] };
}

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
    yOffset: 0.3,
    hitboxRadius: 0.4,
    hitboxHeight: 1.5,
    resourceKind: 'mana',
    xpReward: 10,
    spawnWeight: 0.15,
    spawnCap: 999,
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
  // Filter list to those still under cap
  const eligible = ARCHETYPE_LIST.filter((a) => spawnedCounts[a.id] < a.spawnCap);
  const totalWeight = eligible.reduce((s, a) => s + a.spawnWeight, 0);
  if (totalWeight <= 0) return ARCHETYPES['skeleton-warrior']; // fallback
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
