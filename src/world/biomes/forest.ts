// Burnt forest biome — sparse charred coniferous trees on rolling hills.

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
import { PALETTE } from '../palette';
import type { BiomeOpts, BiomeResult } from './types';
import { addBox, addCylinder, flushBucket, makeBucket, type GeoBucket } from './_common';

type MatKey = 'bark' | 'log' | 'cabinWood' | 'cabinRoof' | 'boulder' | 'moss' | 'ember' | 'neon';

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const _m = new Matrix4();

function makeBuckets(): Record<MatKey, GeoBucket> {
  return {
    bark: makeBucket(),
    log: makeBucket(),
    cabinWood: makeBucket(),
    cabinRoof: makeBucket(),
    boulder: makeBucket(),
    moss: makeBucket(),
    ember: makeBucket(),
    neon: makeBucket(),
  };
}

export function buildForestBiome(opts: BiomeOpts): BiomeResult {
  const { scene, rng, region, groundHeight: gh } = opts;
  const colliders: Collider[] = [];
  const buckets = makeBuckets();
  const lights: PointLight[] = [];
  const flickerLights: { light: PointLight; base: number; phase: number; speed: number }[] = [];

  const group = new Group();
  group.name = 'biome-forest';

  // Place trees by Poisson-ish jittered grid.
  const TARGET = 100;
  const placed: { x: number; z: number }[] = [];
  let attempts = 0;
  const minDist = 4.5;
  while (placed.length < TARGET && attempts < TARGET * 8) {
    attempts++;
    const tx = rng.range(region.minX + 4, region.maxX - 4);
    const tz = rng.range(region.minZ + 4, region.maxZ - 4);
    const ground = gh(tx, tz);
    if (ground < 0.5) continue; // skip valley/dam areas
    let ok = true;
    for (const p of placed) {
      const dx = tx - p.x, dz = tz - p.z;
      if (dx * dx + dz * dz < minDist * minDist) { ok = false; break; }
    }
    if (!ok) continue;
    placed.push({ x: tx, z: tz });

    // Tree: blackened cylinder trunk + 2-4 broken branches.
    const h = rng.range(4, 12);
    const r = rng.range(0.3, 0.6);
    addCylinder(buckets.bark, r * 0.5, r, h, 8, tx, ground + h / 2, tz);
    colliders.push({ min: [tx - r, ground, tz - r], max: [tx + r, ground + h, tz + r] });

    const branches = rng.int(2, 4);
    for (let b = 0; b < branches; b++) {
      const angle = rng.next() * Math.PI * 2;
      const tilt = rng.range(-Math.PI / 3, Math.PI / 3);
      const blen = rng.range(1.5, 3.5);
      const by = ground + rng.range(h * 0.4, h * 0.95);
      addCylinder(
        buckets.bark,
        0.06, 0.18, blen, 6,
        tx + Math.cos(angle) * (blen / 2) * Math.cos(tilt),
        by + Math.sin(tilt) * (blen / 2),
        tz + Math.sin(angle) * (blen / 2) * Math.cos(tilt),
        angle,
        Math.PI / 2 - tilt,
        0,
      );
    }

    // 20% chance of ember glow at base (emissive box only — no PointLight to keep budget).
    // A handful do get a real light below.
    if (rng.chance(0.20)) {
      addBox(buckets.ember, 0.5, 0.18, 0.5, tx, ground + 0.09, tz);
      // Only the first 4 ember trees get a real PointLight.
      if (lights.length < 4) {
        const l = new PointLight(PALETTE.forestEmber, 1.4, 7, 2);
        l.position.set(tx, ground + 0.4, tz);
        lights.push(l);
        flickerLights.push({ light: l, base: 1.4, phase: rng.range(0, Math.PI * 2), speed: rng.range(8, 13) });
      }
    }
  }

  // Fallen logs.
  for (let i = 0; i < 14; i++) {
    const lx = rng.range(region.minX + 4, region.maxX - 4);
    const lz = rng.range(region.minZ + 4, region.maxZ - 4);
    const ground = gh(lx, lz);
    if (ground < 0.5) continue;
    const llen = rng.range(3, 6);
    const lr = rng.range(0.3, 0.5);
    const yaw = rng.next() * Math.PI * 2;
    const lg = new CylinderGeometry(lr, lr, llen, 10);
    lg.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
    lg.applyMatrix4(new Matrix4().makeRotationY(yaw));
    lg.applyMatrix4(new Matrix4().makeTranslation(lx, ground + lr, lz));
    buckets.log.geos.push(lg);
    colliders.push({
      min: [lx - llen / 2, ground, lz - lr],
      max: [lx + llen / 2, ground + lr * 2, lz + lr],
    });
  }

  // Boulders.
  for (let i = 0; i < 30; i++) {
    const bx = rng.range(region.minX + 4, region.maxX - 4);
    const bz = rng.range(region.minZ + 4, region.maxZ - 4);
    const bg = gh(bx, bz);
    if (bg < 0.5) continue;
    const bw = rng.range(1, 3);
    const bh = rng.range(0.8, 2.2);
    const bd = rng.range(1, 3);
    addBox(buckets.boulder, bw, bh, bd, bx, bg + bh / 2, bz, rng.next() * Math.PI * 2, rng.range(-0.2, 0.2), rng.range(-0.2, 0.2));
    colliders.push({ min: [bx - bw / 2, bg, bz - bd / 2], max: [bx + bw / 2, bg + bh, bz + bd / 2] });
  }

  // Mossy rock circles.
  for (let i = 0; i < 5; i++) {
    const cx = rng.range(region.minX + 8, region.maxX - 8);
    const cz = rng.range(region.minZ + 8, region.maxZ - 8);
    const cg = gh(cx, cz);
    if (cg < 0.5) continue;
    const stones = 6;
    const r = 1.6;
    for (let s = 0; s < stones; s++) {
      const a = (s / stones) * Math.PI * 2;
      addBox(buckets.moss, 0.6, 0.4, 0.6, cx + Math.cos(a) * r, cg + 0.2, cz + Math.sin(a) * r, a);
    }
  }

  // ----------------------------------------------------------
  // Ranger's cabin — 6x5x3, walkable single room.
  // ----------------------------------------------------------
  // Find a flatish clearing.
  const cabinX = (region.minX + region.maxX) / 2 + 12;
  const cabinZ = (region.minZ + region.maxZ) / 2 + 18;
  const cabinG = gh(cabinX, cabinZ);
  const cw = 6, cd = 5, ch = 3, ct = 0.25;

  // Walls — door on +Z front
  addBox(buckets.cabinWood, cw, ch, ct, cabinX, cabinG + ch / 2, cabinZ - cd / 2);
  colliders.push({ min: [cabinX - cw / 2, cabinG, cabinZ - cd / 2 - ct / 2], max: [cabinX + cw / 2, cabinG + ch, cabinZ - cd / 2 + ct / 2] });
  const csw = (cw - 1.6) / 2;
  addBox(buckets.cabinWood, csw, ch, ct, cabinX - cw / 2 + csw / 2, cabinG + ch / 2, cabinZ + cd / 2);
  addBox(buckets.cabinWood, csw, ch, ct, cabinX + cw / 2 - csw / 2, cabinG + ch / 2, cabinZ + cd / 2);
  addBox(buckets.cabinWood, 1.6, 0.8, ct, cabinX, cabinG + ch - 0.4, cabinZ + cd / 2);
  colliders.push({ min: [cabinX - cw / 2, cabinG, cabinZ + cd / 2 - ct / 2], max: [cabinX - 0.8, cabinG + ch, cabinZ + cd / 2 + ct / 2] });
  colliders.push({ min: [cabinX + 0.8, cabinG, cabinZ + cd / 2 - ct / 2], max: [cabinX + cw / 2, cabinG + ch, cabinZ + cd / 2 + ct / 2] });
  addBox(buckets.cabinWood, ct, ch, cd, cabinX - cw / 2, cabinG + ch / 2, cabinZ);
  addBox(buckets.cabinWood, ct, ch, cd, cabinX + cw / 2, cabinG + ch / 2, cabinZ);
  colliders.push({ min: [cabinX - cw / 2 - ct / 2, cabinG, cabinZ - cd / 2], max: [cabinX - cw / 2 + ct / 2, cabinG + ch, cabinZ + cd / 2] });
  colliders.push({ min: [cabinX + cw / 2 - ct / 2, cabinG, cabinZ - cd / 2], max: [cabinX + cw / 2 + ct / 2, cabinG + ch, cabinZ + cd / 2] });
  // Pitched roof (two angled slabs).
  addBox(buckets.cabinRoof, cw + 0.6, 0.25, cd / 2 + 0.4, cabinX, cabinG + ch + 0.6, cabinZ - cd / 4, 0, -0.4, 0);
  addBox(buckets.cabinRoof, cw + 0.6, 0.25, cd / 2 + 0.4, cabinX, cabinG + ch + 0.6, cabinZ + cd / 4, 0, 0.4, 0);
  colliders.push({ min: [cabinX - cw / 2, cabinG + ch, cabinZ - cd / 2], max: [cabinX + cw / 2, cabinG + ch + 1.4, cabinZ + cd / 2] });
  // Interior boxes.
  addBox(buckets.cabinWood, 1.2, 0.8, 0.6, cabinX - 1.5, cabinG + 0.4, cabinZ - 1.5);
  addBox(buckets.cabinWood, 0.6, 0.6, 0.6, cabinX + 1.5, cabinG + 0.3, cabinZ - 1);
  addBox(buckets.cabinWood, 1.0, 0.4, 1.0, cabinX, cabinG + 0.2, cabinZ + 1);
  // Ceiling emissive cube.
  addBox(buckets.neon, 0.4, 0.12, 0.4, cabinX, cabinG + ch - 0.15, cabinZ);
  // Interior PointLight.
  const cabinLight = new PointLight(0xffd6a0, 1.8, 16, 1.6);
  cabinLight.position.set(cabinX, cabinG + ch - 0.4, cabinZ);
  lights.push(cabinLight);
  flickerLights.push({ light: cabinLight, base: 1.8, phase: rng.range(0, Math.PI * 2), speed: rng.range(2, 4) });

  // ----------------------------------------------------------
  // Materials.
  // ----------------------------------------------------------
  const mats: Record<MatKey, MeshStandardMaterial> = {
    bark:      new MeshStandardMaterial({ color: PALETTE.forestBark,  roughness: 1.0 }),
    log:       new MeshStandardMaterial({ color: PALETTE.forestLog,   roughness: 1.0 }),
    cabinWood: new MeshStandardMaterial({ color: PALETTE.cabinWood,   roughness: 1.0 }),
    cabinRoof: new MeshStandardMaterial({ color: PALETTE.cabinRoof,   roughness: 1.0 }),
    boulder:   new MeshStandardMaterial({ color: PALETTE.boulder,     roughness: 1.0 }),
    moss:      new MeshStandardMaterial({ color: PALETTE.forestMoss, emissive: new Color(0x1a3018), emissiveIntensity: 0.25, roughness: 1.0 }),
    ember:     new MeshStandardMaterial({ color: 0x1a0a04, emissive: new Color(PALETTE.forestEmber), emissiveIntensity: 1.4, roughness: 1.0 }),
    neon:      new MeshStandardMaterial({ color: 0x2a2418, emissive: new Color(0xffc070), emissiveIntensity: 1.6, roughness: 0.6 }),
  };
  const ownedGeos: BufferGeometry[] = [];
  const ownedMats: MeshStandardMaterial[] = Object.values(mats);

  (Object.keys(buckets) as MatKey[]).forEach((k) => flushBucket(group, buckets[k], mats[k], ownedGeos));

  // Instanced small debris (twigs, ash piles).
  const ASHES = 250;
  const ashGeo = new BoxGeometry(1, 1, 1);
  const ashMat = new MeshStandardMaterial({ color: 0x2a2420, roughness: 1.0 });
  ownedGeos.push(ashGeo);
  ownedMats.push(ashMat);
  const ash = new InstancedMesh(ashGeo, ashMat, ASHES);
  ash.castShadow = false;
  ash.receiveShadow = true;
  ash.instanceMatrix.setUsage(DynamicDrawUsage);
  let used = 0;
  for (let i = 0; i < ASHES * 2 && used < ASHES; i++) {
    const px = rng.range(region.minX + 4, region.maxX - 4);
    const pz = rng.range(region.minZ + 4, region.maxZ - 4);
    const ground = gh(px, pz);
    if (ground < 0.5) continue;
    const sx = rng.range(0.2, 0.6), sy = rng.range(0.1, 0.3), sz = rng.range(0.2, 0.6);
    const ry = rng.next() * Math.PI * 2;
    const py = ground + sy * 0.5;
    _q.setFromEuler(_e.set(rng.range(-0.3, 0.3), ry, rng.range(-0.3, 0.3)));
    _p.set(px, py, pz);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    ash.setMatrixAt(used, _m);
    used++;
  }
  _s.set(1, 1, 1);
  ash.count = used;
  ash.instanceMatrix.needsUpdate = true;
  group.add(ash);

  for (const l of lights) group.add(l);

  scene.add(group);

  const update = (t: number) => {
    for (const f of flickerLights) {
      const a = Math.sin(t * f.speed + f.phase);
      const b = Math.sin(t * (f.speed * 0.4 + 0.8) + f.phase * 1.7);
      f.light.intensity = f.base * (1 + 0.18 * a + 0.08 * b);
    }
  };

  // Shelter in a clearing.
  const shelterX = (region.minX + region.maxX) / 2 - 18;
  const shelterZ = (region.minZ + region.maxZ) / 2 + 24;

  return {
    colliders,
    shelterCandidates: [{ position: [shelterX, gh(shelterX, shelterZ), shelterZ] }],
    landmarks: [],
    update,
  };
}
