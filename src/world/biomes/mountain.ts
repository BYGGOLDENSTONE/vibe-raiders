// Mountain ridge biome — eastern strip, terraced rock plateaus, observatory landmark.

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
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

import type { Collider } from '../colliders';
import { PALETTE } from '../palette';
import type { BiomeOpts, BiomeResult } from './types';
import { addBox, flushBucket, makeBucket, type GeoBucket } from './_common';

type MatKey = 'rock' | 'rockDark' | 'rockLight' | 'observatoryShell' | 'bark' | 'distant';

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const _m = new Matrix4();

function makeBuckets(): Record<MatKey, GeoBucket> {
  return {
    rock: makeBucket(),
    rockDark: makeBucket(),
    rockLight: makeBucket(),
    observatoryShell: makeBucket(),
    bark: makeBucket(),
    distant: makeBucket(),
  };
}

export function buildMountainBiome(opts: BiomeOpts): BiomeResult {
  const { scene, rng, region, groundHeight: gh } = opts;
  const colliders: Collider[] = [];
  const buckets = makeBuckets();
  const lights: PointLight[] = [];

  const group = new Group();
  group.name = 'biome-mountain';

  // Scatter big tilted rock blocks across the strip — partly buried.
  const ROCKS = 150;
  for (let i = 0; i < ROCKS; i++) {
    const px = rng.range(region.minX, region.maxX);
    const pz = rng.range(region.minZ + 4, region.maxZ - 4);
    const ground = gh(px, pz);
    const rw = rng.range(3, 12);
    const rh = rng.range(3, 10);
    const rd = rng.range(3, 12);
    const yaw = rng.next() * Math.PI * 2;
    const tilt = rng.range(-0.18, 0.18);
    const tilt2 = rng.range(-0.18, 0.18);
    // Partly bury — center at ground + h/2 - rng buried amount.
    const buried = rng.range(0.5, 2.5);
    const cy = ground + rh / 2 - buried;
    const variant = rng.chance(0.3) ? (rng.chance(0.5) ? buckets.rockDark : buckets.rockLight) : buckets.rock;
    addBox(variant, rw, rh, rd, px, cy, pz, yaw, tilt, tilt2);
    colliders.push({
      min: [px - rw / 2 + 0.5, ground, pz - rd / 2 + 0.5],
      max: [px + rw / 2 - 0.5, ground + rh - buried, pz + rd / 2 - 0.5],
    });
  }

  // Wind-bent dead trees on the ridge.
  for (let i = 0; i < 18; i++) {
    const tx = rng.range(region.minX + 4, region.maxX - 4);
    const tz = rng.range(region.minZ + 4, region.maxZ - 4);
    const ground = gh(tx, tz);
    if (ground < 8) continue; // only on higher plateaus
    const h = rng.range(3, 6);
    const r = rng.range(0.2, 0.4);
    const bend = rng.range(-0.3, 0.3);
    const tg = new CylinderGeometry(r * 0.4, r, h, 8);
    tg.applyMatrix4(new Matrix4().makeRotationZ(bend));
    tg.applyMatrix4(new Matrix4().makeTranslation(tx, ground + h / 2, tz));
    buckets.bark.geos.push(tg);
    // 1-2 broken branches
    for (let b = 0; b < rng.int(1, 2); b++) {
      const angle = rng.next() * Math.PI * 2;
      const blen = rng.range(0.8, 1.5);
      addBox(buckets.bark, blen, 0.12, 0.12, tx + Math.cos(angle) * blen / 2, ground + rng.range(h * 0.5, h * 0.9), tz + Math.sin(angle) * blen / 2, angle);
    }
  }

  // ----------------------------------------------------------
  // Observatory on top plateau (x ~ 195, z ~ 0).
  // ----------------------------------------------------------
  const obsX = region.maxX - 6;
  const obsZ = (region.minZ + region.maxZ) / 2;
  const obsG = gh(obsX, obsZ);
  // Cylindrical shell — represented by stacked box ring? Use 8-sided ring via boxes for low draw cost.
  // Simpler: a tall box base then dome.
  const obsBaseR = 3;
  const obsBaseH = 12;
  // Cylinder geometry for observatory base.
  const cylG = new CylinderGeometry(obsBaseR, obsBaseR + 0.4, obsBaseH, 16);
  cylG.applyMatrix4(new Matrix4().makeTranslation(obsX, obsG + obsBaseH / 2, obsZ));
  buckets.observatoryShell.geos.push(cylG);
  colliders.push({
    min: [obsX - obsBaseR, obsG, obsZ - obsBaseR],
    max: [obsX + obsBaseR, obsG + obsBaseH, obsZ + obsBaseR],
  });
  // Dome (hemisphere via halved sphere — but flushBucket merges all geometry into one material so we need it in a bucket).
  const domeG = new SphereGeometry(obsBaseR + 0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  domeG.applyMatrix4(new Matrix4().makeTranslation(obsX, obsG + obsBaseH, obsZ));
  buckets.observatoryShell.geos.push(domeG);

  // Glowing top — emissive sphere added separately as its own mesh (so emissive is preserved).
  const glowMat = new MeshStandardMaterial({
    color: 0x300010,
    emissive: new Color(PALETTE.observatoryGlow),
    emissiveIntensity: 2.2,
    roughness: 0.6,
  });
  const glowGeo = new SphereGeometry(1.0, 16, 12);
  const glowMesh = new Mesh(glowGeo, glowMat);
  glowMesh.position.set(obsX, obsG + obsBaseH + 1.2, obsZ);
  group.add(glowMesh);

  // Red beacon PointLight.
  const beacon = new PointLight(0xff2030, 3.0, 60, 1.5);
  beacon.position.set(obsX, obsG + obsBaseH + 1.5, obsZ);
  lights.push(beacon);

  // ----------------------------------------------------------
  // Distant mountain silhouettes BEYOND the play area (z = +500 or so).
  // No colliders, no shadows.
  // ----------------------------------------------------------
  const farMountains: Mesh[] = [];
  const farMat = new MeshStandardMaterial({ color: PALETTE.distantMountain, roughness: 1.0, fog: false });
  for (let i = 0; i < 7; i++) {
    const fx = rng.range(-300, 300);
    const fz = rng.range(280, 480);
    const fh = rng.range(70, 130);
    const fw = rng.range(80, 180);
    const fG = new BoxGeometry(fw, fh, 30);
    const m = new Mesh(fG, farMat);
    m.position.set(fx, fh / 2 - 5, fz);
    m.rotation.y = rng.range(-0.5, 0.5);
    m.castShadow = false;
    m.receiveShadow = false;
    farMountains.push(m);
    group.add(m);
  }
  // Mountains on -Z (north) side.
  for (let i = 0; i < 5; i++) {
    const fx = rng.range(-300, 300);
    const fz = rng.range(-480, -280);
    const fh = rng.range(60, 110);
    const fw = rng.range(80, 160);
    const fG = new BoxGeometry(fw, fh, 30);
    const m = new Mesh(fG, farMat);
    m.position.set(fx, fh / 2 - 5, fz);
    m.rotation.y = rng.range(-0.5, 0.5);
    m.castShadow = false;
    m.receiveShadow = false;
    farMountains.push(m);
    group.add(m);
  }

  // ----------------------------------------------------------
  // Materials & flush.
  // ----------------------------------------------------------
  const mats: Record<MatKey, MeshStandardMaterial> = {
    rock:      new MeshStandardMaterial({ color: PALETTE.mountainRock,      roughness: 1.0 }),
    rockDark:  new MeshStandardMaterial({ color: PALETTE.mountainRockDark,  roughness: 1.0 }),
    rockLight: new MeshStandardMaterial({ color: PALETTE.mountainRockLight, roughness: 1.0 }),
    observatoryShell: new MeshStandardMaterial({ color: PALETTE.observatoryShell, roughness: 0.95 }),
    bark:      new MeshStandardMaterial({ color: PALETTE.forestBark, roughness: 1.0 }),
    distant:   farMat,
  };
  const ownedGeos: BufferGeometry[] = [glowGeo];
  const ownedMats: MeshStandardMaterial[] = [...Object.values(mats), glowMat];

  flushBucket(group, buckets.rock, mats.rock, ownedGeos);
  flushBucket(group, buckets.rockDark, mats.rockDark, ownedGeos);
  flushBucket(group, buckets.rockLight, mats.rockLight, ownedGeos);
  flushBucket(group, buckets.observatoryShell, mats.observatoryShell, ownedGeos);
  flushBucket(group, buckets.bark, mats.bark, ownedGeos);

  // Instanced small rocks (gravel scatter).
  const GRAVEL = 200;
  const gGeo = new BoxGeometry(1, 1, 1);
  const gMat = new MeshStandardMaterial({ color: PALETTE.mountainRockDark, roughness: 1.0 });
  ownedGeos.push(gGeo);
  ownedMats.push(gMat);
  const gravel = new InstancedMesh(gGeo, gMat, GRAVEL);
  gravel.castShadow = false;
  gravel.receiveShadow = true;
  gravel.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < GRAVEL; i++) {
    const px = rng.range(region.minX, region.maxX);
    const pz = rng.range(region.minZ, region.maxZ);
    const sx = rng.range(0.2, 0.7), sy = rng.range(0.15, 0.5), sz = rng.range(0.2, 0.7);
    const ry = rng.next() * Math.PI * 2;
    const py = gh(px, pz) + sy * 0.5;
    _q.setFromEuler(_e.set(rng.range(-0.3, 0.3), ry, rng.range(-0.3, 0.3)));
    _p.set(px, py, pz);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    gravel.setMatrixAt(i, _m);
  }
  _s.set(1, 1, 1);
  gravel.instanceMatrix.needsUpdate = true;
  group.add(gravel);

  for (const l of lights) group.add(l);

  scene.add(group);

  const update = (t: number) => {
    // Pulse the observatory glow.
    const pulse = 1.8 + 0.6 * Math.sin(t * 1.4);
    glowMat.emissiveIntensity = pulse;
    beacon.intensity = 2.4 + 1.0 * Math.sin(t * 1.4);
  };

  return {
    colliders,
    shelterCandidates: [],
    landmarks: [{ kind: 'observatory', position: [obsX, obsG + obsBaseH + 1.2, obsZ] }],
    update,
  };
}
