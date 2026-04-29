// Dried reservoir biome — 25 m concrete dam wall + walkable bridge top + dry valley.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector3,
} from 'three';

import type { Collider } from '../colliders';
import { DAM_PARAMS } from '../heightmap';
import { PALETTE } from '../palette';
import type { BiomeOpts, BiomeResult } from './types';
import { addBox, addCylinder, flushBucket, makeBucket, type GeoBucket } from './_common';

type MatKey = 'concrete' | 'concreteDark' | 'metal' | 'rust' | 'pipe' | 'pumpHouse' | 'boatPaint' | 'boatHull' | 'pole' | 'neon';

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const _m = new Matrix4();

function makeBuckets(): Record<MatKey, GeoBucket> {
  return {
    concrete: makeBucket(),
    concreteDark: makeBucket(),
    metal: makeBucket(),
    rust: makeBucket(),
    pipe: makeBucket(),
    pumpHouse: makeBucket(),
    boatPaint: makeBucket(),
    boatHull: makeBucket(),
    pole: makeBucket(),
    neon: makeBucket(),
  };
}

export function buildDamBiome(opts: BiomeOpts): BiomeResult {
  const { scene, rng, region, groundHeight: gh } = opts;
  const colliders: Collider[] = [];
  const buckets = makeBuckets();
  const lights: PointLight[] = [];
  const flickerLights: { light: PointLight; base: number; phase: number; speed: number }[] = [];

  const group = new Group();
  group.name = 'biome-dam';

  // Dam wall is at z = DAM_PARAMS.wallZ, spanning x = [-160 .. -20].
  const wallZ = DAM_PARAMS.wallZ;
  const damXMin = DAM_PARAMS.xMin;
  const damXMax = DAM_PARAMS.xMax;
  const damCX = (damXMin + damXMax) / 2;
  const damWidthX = damXMax - damXMin;
  const damWallH = 25;
  const damWallT = 8; // thickness/walkable bridge top

  // The wall sits with its front face at wallZ. The back of the wall (+Z) drops into the valley.
  // Build as a 100m horizontal arc represented by 5 segmented boxes for slight curve.
  const segments = 7;
  const segLen = damWidthX / segments;
  const arcOff = 6; // arc into +Z slightly
  for (let i = 0; i < segments; i++) {
    const sx = damXMin + segLen * (i + 0.5);
    const t = i / (segments - 1) - 0.5;
    const sz = wallZ + arcOff * (1 - 4 * t * t); // parabola arc into +Z
    // Wall top sits at world Y = damWallH (since front side ground ~0, back side -15).
    addBox(buckets.concrete, segLen + 0.2, damWallH, damWallT, sx, damWallH / 2, sz, 0, 0, 0);
    colliders.push({
      min: [sx - segLen / 2 - 0.1, 0, sz - damWallT / 2],
      max: [sx + segLen / 2 + 0.1, damWallH, sz + damWallT / 2],
    });
  }
  // Wall top walkable bridge — broken railings.
  for (let i = 0; i < 30; i++) {
    if (rng.chance(0.25)) continue; // some missing — broken
    const rx = damXMin + (i / 30) * damWidthX;
    const t = (i / 30) - 0.5;
    const offset = arcOff * (1 - 4 * t * t);
    addBox(buckets.metal, 0.1, 1.0, 0.1, rx, damWallH + 0.5, wallZ - damWallT / 2 + offset);
    addBox(buckets.metal, 0.1, 1.0, 0.1, rx, damWallH + 0.5, wallZ + damWallT / 2 + offset);
  }
  // Top rails (intermittent).
  for (let i = 0; i < segments; i++) {
    if (rng.chance(0.4)) continue;
    const rx0 = damXMin + i * segLen + 1;
    const rx1 = rx0 + segLen - 2;
    const t = (i / (segments - 1)) - 0.5;
    const off = arcOff * (1 - 4 * t * t);
    addBox(buckets.metal, segLen - 2, 0.1, 0.1, (rx0 + rx1) / 2, damWallH + 1.0, wallZ - damWallT / 2 + off);
    if (rng.chance(0.7)) {
      addBox(buckets.metal, segLen - 2, 0.1, 0.1, (rx0 + rx1) / 2, damWallH + 1.0, wallZ + damWallT / 2 + off);
    }
  }
  // Lamp posts on the bridge — 5 posts but only 2 actual PointLights (rest emissive only).
  for (let i = 0; i < 5; i++) {
    const lx = damXMin + (i + 0.5) * (damWidthX / 5);
    addCylinder(buckets.metal, 0.12, 0.12, 4, 8, lx, damWallH + 2, wallZ);
    addBox(buckets.neon, 0.6, 0.4, 0.6, lx, damWallH + 4, wallZ);
    if (i === 1 || i === 3) {
      const light = new PointLight(0xfff0c8, 1.8, 22, 1.5);
      light.position.set(lx, damWallH + 4, wallZ);
      lights.push(light);
      flickerLights.push({ light, base: 1.8, phase: rng.range(0, Math.PI * 2), speed: rng.range(2, 4) });
    }
  }

  // Staircase carved into the dam side — descends from bridge top down to valley floor.
  // Place at x near damXMax (east-most end of the dam).
  const stairX = damXMax - 4;
  const stairCount = 22;
  const stairTopY = damWallH;
  const stairBotY = -8; // floor in the bowl roughly
  const stairRise = (stairTopY - stairBotY) / stairCount;
  const stairRun = 0.9;
  for (let i = 0; i < stairCount; i++) {
    const sy = stairTopY - (i + 0.5) * stairRise;
    const sz = wallZ + damWallT / 2 + 1 + i * stairRun;
    addBox(buckets.concreteDark, 3.0, stairRise, stairRun, stairX, sy, sz);
    colliders.push({
      min: [stairX - 1.5, stairTopY - (i + 1) * stairRise, sz - stairRun / 2],
      max: [stairX + 1.5, stairTopY - i * stairRise, sz + stairRun / 2],
    });
  }

  // ----------------------------------------------------------
  // Pump house — 8x6x5 m walkable structure at the dam base (in front of wall).
  // ----------------------------------------------------------
  const phX = damCX + 14;
  const phZ = wallZ - 10;
  const phG = gh(phX, phZ);
  const phW = 8, phD = 6, phH = 5;
  const phT = 0.3;
  // Walls — leaving doorway on +Z front.
  addBox(buckets.pumpHouse, phW, phH, phT, phX, phG + phH / 2, phZ - phD / 2);
  colliders.push({ min: [phX - phW / 2, phG, phZ - phD / 2 - phT / 2], max: [phX + phW / 2, phG + phH, phZ - phD / 2 + phT / 2] });
  // Front wall split for door (door 2m wide centered)
  const sw = (phW - 2) / 2;
  addBox(buckets.pumpHouse, sw, phH, phT, phX - phW / 2 + sw / 2, phG + phH / 2, phZ + phD / 2);
  addBox(buckets.pumpHouse, sw, phH, phT, phX + phW / 2 - sw / 2, phG + phH / 2, phZ + phD / 2);
  addBox(buckets.pumpHouse, 2, 1.4, phT, phX, phG + phH - 0.7, phZ + phD / 2);
  colliders.push({ min: [phX - phW / 2, phG, phZ + phD / 2 - phT / 2], max: [phX - 1, phG + phH, phZ + phD / 2 + phT / 2] });
  colliders.push({ min: [phX + 1, phG, phZ + phD / 2 - phT / 2], max: [phX + phW / 2, phG + phH, phZ + phD / 2 + phT / 2] });
  // Side walls
  addBox(buckets.pumpHouse, phT, phH, phD, phX - phW / 2, phG + phH / 2, phZ);
  addBox(buckets.pumpHouse, phT, phH, phD, phX + phW / 2, phG + phH / 2, phZ);
  colliders.push({ min: [phX - phW / 2 - phT / 2, phG, phZ - phD / 2], max: [phX - phW / 2 + phT / 2, phG + phH, phZ + phD / 2] });
  colliders.push({ min: [phX + phW / 2 - phT / 2, phG, phZ - phD / 2], max: [phX + phW / 2 + phT / 2, phG + phH, phZ + phD / 2] });
  // Roof
  addBox(buckets.pumpHouse, phW, 0.3, phD, phX, phG + phH, phZ);
  colliders.push({ min: [phX - phW / 2, phG + phH - 0.15, phZ - phD / 2], max: [phX + phW / 2, phG + phH + 0.15, phZ + phD / 2] });
  // Interior machinery — a few boxes + pipe.
  addBox(buckets.rust, 1.2, 1.6, 1.2, phX - 2, phG + 0.8, phZ - 1);
  addBox(buckets.metal, 1.6, 0.8, 0.8, phX + 2, phG + 0.4, phZ);
  addCylinder(buckets.pipe, 0.3, 0.3, phH - 0.5, 12, phX + 2, phG + (phH - 0.5) / 2, phZ - 2);
  // Emissive ceiling cubes
  addBox(buckets.neon, 0.5, 0.15, 0.5, phX - 1.5, phG + phH - 0.2, phZ);
  addBox(buckets.neon, 0.5, 0.15, 0.5, phX + 1.5, phG + phH - 0.2, phZ);
  // Interior PointLights.
  const phl1 = new PointLight(0xffd6a0, 2.4, 22, 1.5);
  phl1.position.set(phX - 1.5, phG + phH - 0.5, phZ);
  lights.push(phl1);
  flickerLights.push({ light: phl1, base: 2.4, phase: rng.range(0, Math.PI * 2), speed: rng.range(2, 4) });
  const phl2 = new PointLight(0xffd6a0, 2.2, 22, 1.5);
  phl2.position.set(phX + 1.5, phG + phH - 0.5, phZ);
  lights.push(phl2);
  flickerLights.push({ light: phl2, base: 2.2, phase: rng.range(0, Math.PI * 2), speed: rng.range(2, 4) });

  // ----------------------------------------------------------
  // Valley floor decorations.
  // ----------------------------------------------------------
  // Beached boats.
  for (let i = 0; i < 4; i++) {
    const bx = damCX + rng.range(-damWidthX * 0.35, damWidthX * 0.35);
    const bz = wallZ + 35 + rng.range(0, 35);
    const bg = gh(bx, bz);
    const yaw = rng.next() * Math.PI * 2;
    const tilt = rng.range(-0.25, 0.25);
    // Hull
    const hullW = 2.4, hullH = 1.6, hullL = 6;
    const hullG = new BoxGeometry(hullW, hullH, hullL);
    _e.set(0, yaw, tilt);
    _q.setFromEuler(_e);
    _p.set(bx, bg + 0.6, bz);
    _m.compose(_p, _q, _s);
    hullG.applyMatrix4(_m);
    buckets.boatHull.geos.push(hullG);
    // Cabin
    const cabG = new BoxGeometry(1.6, 1.2, 2.0);
    _e.set(0, yaw, tilt);
    _q.setFromEuler(_e);
    _p.set(bx, bg + 1.8, bz - 0.5);
    _m.compose(_p, _q, _s);
    cabG.applyMatrix4(_m);
    buckets.boatPaint.geos.push(cabG);
    colliders.push({ min: [bx - 3.5, bg, bz - 3.5], max: [bx + 3.5, bg + 2.4, bz + 3.5] });
  }

  // Rusted pipes along the dry bed.
  for (let i = 0; i < 6; i++) {
    const px1 = damCX + rng.range(-damWidthX * 0.4, damWidthX * 0.4 - 20);
    const px2 = px1 + rng.range(15, 30);
    const pz = wallZ + 25 + i * 8 + rng.range(-3, 3);
    const pg = gh((px1 + px2) / 2, pz);
    const len = px2 - px1;
    const pipe = new CylinderGeometry(0.7, 0.7, len, 14);
    pipe.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
    pipe.applyMatrix4(new Matrix4().makeTranslation((px1 + px2) / 2, pg + 0.9, pz));
    buckets.pipe.geos.push(pipe);
    // Broken end — small ring missing? Just add some debris boxes near.
    if (rng.chance(0.6)) {
      addBox(buckets.rust, 1.2, 0.8, 0.8, px2 + 1.5, gh(px2, pz) + 0.4, pz, rng.range(0, Math.PI * 2));
    }
    colliders.push({ min: [px1, pg, pz - 0.7], max: [px2, pg + 1.6, pz + 0.7] });
  }

  // Fallen power-line poles.
  for (let i = 0; i < 3; i++) {
    const px = damCX + rng.range(-damWidthX * 0.4, damWidthX * 0.4);
    const pz = wallZ + 50 + i * 18;
    const pg = gh(px, pz);
    const yaw = rng.next() * Math.PI * 2;
    const tilt = Math.PI * 0.4 + rng.range(-0.2, 0.2);
    addCylinder(buckets.pole, 0.25, 0.3, 12, 10, px, pg + 1.2, pz, yaw, tilt, 0);
    addBox(buckets.pole, 4, 0.18, 0.18, px + Math.cos(yaw) * 4, pg + 4, pz + Math.sin(yaw) * 4, yaw, tilt, 0);
  }

  // Cracked concrete slabs scattered (faking dam bed).
  for (let i = 0; i < 18; i++) {
    const sx = damCX + rng.range(-damWidthX * 0.45, damWidthX * 0.45);
    const sz = wallZ + 20 + rng.range(0, 70);
    const sg = gh(sx, sz);
    const sw = rng.range(2, 5);
    const sd = rng.range(2, 5);
    addBox(buckets.concreteDark, sw, 0.2, sd, sx, sg + 0.1, sz, rng.next() * Math.PI * 2, rng.range(-0.05, 0.05), rng.range(-0.05, 0.05));
  }

  // ----------------------------------------------------------
  // Materials.
  // ----------------------------------------------------------
  const mats: Record<MatKey, MeshStandardMaterial> = {
    concrete:     new MeshStandardMaterial({ color: PALETTE.damConcrete,     roughness: 0.95 }),
    concreteDark: new MeshStandardMaterial({ color: PALETTE.damConcreteDark, roughness: 1.0 }),
    metal:        new MeshStandardMaterial({ color: PALETTE.metal,           roughness: 0.85, metalness: 0.15 }),
    rust:         new MeshStandardMaterial({ color: PALETTE.rust,            roughness: 0.95, metalness: 0.1 }),
    pipe:         new MeshStandardMaterial({ color: PALETTE.pipeRust,        roughness: 0.95, metalness: 0.1 }),
    pumpHouse:    new MeshStandardMaterial({ color: PALETTE.pumpHouse,       roughness: 0.95 }),
    boatPaint:    new MeshStandardMaterial({ color: PALETTE.boatPaint,       roughness: 0.95 }),
    boatHull:     new MeshStandardMaterial({ color: PALETTE.boatHull,        roughness: 0.95 }),
    pole:         new MeshStandardMaterial({ color: PALETTE.powerPole,       roughness: 1.0 }),
    neon:         new MeshStandardMaterial({ color: 0x2a2418, emissive: new Color(0xffc070), emissiveIntensity: 1.6, roughness: 0.6 }),
  };
  const ownedGeos: BufferGeometry[] = [];
  const ownedMats: MeshStandardMaterial[] = Object.values(mats);

  (Object.keys(buckets) as MatKey[]).forEach((k) => flushBucket(group, buckets[k], mats[k], ownedGeos));

  // Instanced rocks scattered in the valley.
  const RUBBLE = 180;
  const rubbleGeo = new BoxGeometry(1, 1, 1);
  const rubbleMat = new MeshStandardMaterial({ color: PALETTE.boulder, roughness: 1.0 });
  ownedGeos.push(rubbleGeo);
  ownedMats.push(rubbleMat);
  const rubble = new InstancedMesh(rubbleGeo, rubbleMat, RUBBLE);
  rubble.castShadow = false;
  rubble.receiveShadow = true;
  rubble.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < RUBBLE; i++) {
    const px = rng.range(region.minX + 4, region.maxX - 4);
    const pz = rng.range(wallZ + 5, region.maxZ - 4);
    const sx = rng.range(0.4, 1.4), sy = rng.range(0.3, 1.0), sz = rng.range(0.4, 1.4);
    const ry = rng.next() * Math.PI * 2;
    const py = gh(px, pz) + sy * 0.5;
    _q.setFromEuler(_e.set(rng.range(-0.3, 0.3), ry, rng.range(-0.3, 0.3)));
    _p.set(px, py, pz);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    rubble.setMatrixAt(i, _m);
  }
  _s.set(1, 1, 1);
  rubble.instanceMatrix.needsUpdate = true;
  group.add(rubble);

  for (const l of lights) group.add(l);

  scene.add(group);

  const update = (t: number) => {
    for (const f of flickerLights) {
      const flick = 1 + 0.06 * Math.sin(t * f.speed + f.phase);
      f.light.intensity = f.base * flick;
    }
  };

  // Shelter in the dry valley.
  const shelterX = damCX;
  const shelterZ = wallZ + 60;

  return {
    colliders,
    shelterCandidates: [{ position: [shelterX, gh(shelterX, shelterZ), shelterZ] }],
    landmarks: [{ kind: 'dam_wall', position: [damCX, 0, wallZ] }],
    update,
  };
}
