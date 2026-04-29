// Industrial complex biome — hero biome.
// Centerpiece: 70x40m walkable hangar with collapsed corner, catwalk, cargo containers.
// Surrounding: leaning smokestack, fuel tanks, crane skeleton, container yard, pipes.

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

type MatKey =
  | 'hangarSteel' | 'hangarRoof' | 'concrete' | 'metal' | 'rust' | 'pipe' | 'soot'
  | 'tank' | 'catwalk' | 'cA' | 'cB' | 'cC' | 'cD' | 'neon';

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const _m = new Matrix4();

function makeBuckets(): Record<MatKey, GeoBucket> {
  return {
    hangarSteel: makeBucket(),
    hangarRoof: makeBucket(),
    concrete: makeBucket(),
    metal: makeBucket(),
    rust: makeBucket(),
    pipe: makeBucket(),
    soot: makeBucket(),
    tank: makeBucket(),
    catwalk: makeBucket(),
    cA: makeBucket(),
    cB: makeBucket(),
    cC: makeBucket(),
    cD: makeBucket(),
    neon: makeBucket(),
  };
}

export function buildIndustrialBiome(opts: BiomeOpts): BiomeResult {
  const { scene, rng, region, groundHeight: gh } = opts;
  const colliders: Collider[] = [];
  const buckets = makeBuckets();
  const lights: PointLight[] = [];
  const flickerLights: { light: PointLight; base: number; phase: number; speed: number }[] = [];

  const group = new Group();
  group.name = 'biome-industrial';

  const cx = (region.minX + region.maxX) * 0.5;
  const cz = (region.minZ + region.maxZ) * 0.5;

  // ----------------------------------------------------------
  // Hangar — 70 x 40 m, 12 m walls. Long axis along X.
  // ----------------------------------------------------------
  const hangarCX = cx - 5;
  const hangarCZ = cz + 8;
  const hangarG = gh(hangarCX, hangarCZ);
  const hangarW = 70;
  const hangarD = 40;
  const wallH = 12;
  const wallT = 0.5;
  const doorW = 8;
  const doorH = 7;

  // Foundation slab
  addBox(buckets.concrete, hangarW + 4, 0.6, hangarD + 4, hangarCX, hangarG + 0.3, hangarCZ);
  colliders.push({
    min: [hangarCX - (hangarW + 4) / 2, hangarG, hangarCZ - (hangarD + 4) / 2],
    max: [hangarCX + (hangarW + 4) / 2, hangarG + 0.6, hangarCZ + (hangarD + 4) / 2],
  });

  const hf = hangarG + 0.6; // hangar floor

  // Side walls (long, along Z) — full
  addBox(buckets.hangarSteel, wallT, wallH, hangarD, hangarCX - hangarW / 2, hf + wallH / 2, hangarCZ);
  colliders.push({
    min: [hangarCX - hangarW / 2 - wallT / 2, hf, hangarCZ - hangarD / 2],
    max: [hangarCX - hangarW / 2 + wallT / 2, hf + wallH, hangarCZ + hangarD / 2],
  });
  addBox(buckets.hangarSteel, wallT, wallH, hangarD, hangarCX + hangarW / 2, hf + wallH / 2, hangarCZ);
  colliders.push({
    min: [hangarCX + hangarW / 2 - wallT / 2, hf, hangarCZ - hangarD / 2],
    max: [hangarCX + hangarW / 2 + wallT / 2, hf + wallH, hangarCZ + hangarD / 2],
  });

  // End walls with vehicle doors. Front (-Z) + back (+Z).
  // Each end wall: two side panels + lintel above the door.
  for (const dir of [-1, 1]) {
    const wallZ = hangarCZ + dir * hangarD / 2;
    const sidePanelW = (hangarW - doorW) / 2;
    addBox(buckets.hangarSteel, sidePanelW, wallH, wallT, hangarCX - hangarW / 2 + sidePanelW / 2, hf + wallH / 2, wallZ);
    addBox(buckets.hangarSteel, sidePanelW, wallH, wallT, hangarCX + hangarW / 2 - sidePanelW / 2, hf + wallH / 2, wallZ);
    addBox(buckets.hangarSteel, doorW, wallH - doorH, wallT, hangarCX, hf + doorH + (wallH - doorH) / 2, wallZ);
    // Colliders for side panels (skip doorway).
    colliders.push({
      min: [hangarCX - hangarW / 2, hf, wallZ - wallT / 2],
      max: [hangarCX - hangarW / 2 + sidePanelW, hf + wallH, wallZ + wallT / 2],
    });
    colliders.push({
      min: [hangarCX + hangarW / 2 - sidePanelW, hf, wallZ - wallT / 2],
      max: [hangarCX + hangarW / 2, hf + wallH, wallZ + wallT / 2],
    });
    // lintel collider
    colliders.push({
      min: [hangarCX - doorW / 2, hf + doorH, wallZ - wallT / 2],
      max: [hangarCX + doorW / 2, hf + wallH, wallZ + wallT / 2],
    });
  }

  // Roof — split into 4 quadrants. One corner caved in (missing or tilted down).
  const roofY = hf + wallH;
  const halfW = hangarW / 2;
  const halfD = hangarD / 2;
  // Q1 (+X +Z) — caved in: tilt and drop.
  addBox(buckets.hangarRoof, halfW, 0.4, halfD, hangarCX + halfW / 2, roofY - 1.5, hangarCZ + halfD / 2, 0, 0.18, -0.22);
  // Other 3 quadrants — flat
  addBox(buckets.hangarRoof, halfW, 0.4, halfD, hangarCX - halfW / 2, roofY, hangarCZ + halfD / 2);
  addBox(buckets.hangarRoof, halfW, 0.4, halfD, hangarCX - halfW / 2, roofY, hangarCZ - halfD / 2);
  addBox(buckets.hangarRoof, halfW, 0.4, halfD, hangarCX + halfW / 2, roofY, hangarCZ - halfD / 2);
  // Hanging beams from caved section.
  for (let i = 0; i < 4; i++) {
    const bx = hangarCX + 5 + i * 4;
    const bz = hangarCZ + 4 + i * 3;
    addBox(buckets.metal, 0.3, rng.range(2, 4), 0.3, bx, roofY - 2 - i * 0.5, bz, 0, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4));
  }

  // Catwalk along -X interior wall: 6 m up, 2 m wide, runs along Z.
  const catwalkY = hf + 6;
  const catwalkX = hangarCX - hangarW / 2 + 1.5;
  addBox(buckets.catwalk, 1.6, 0.2, hangarD - 2, catwalkX, catwalkY, hangarCZ);
  colliders.push({
    min: [catwalkX - 0.8, catwalkY - 0.1, hangarCZ - hangarD / 2 + 1],
    max: [catwalkX + 0.8, catwalkY + 0.1, hangarCZ + hangarD / 2 - 1],
  });
  // Catwalk railing posts.
  for (let i = -8; i <= 8; i++) {
    addBox(buckets.metal, 0.1, 1.2, 0.1, catwalkX + 0.7, catwalkY + 0.7, hangarCZ + i * 2);
  }
  // Catwalk top rail
  addBox(buckets.metal, 0.1, 0.1, hangarD - 2, catwalkX + 0.7, catwalkY + 1.3, hangarCZ);

  // External staircase up to catwalk (on -Z end, outside the wall)
  const stairCount = 12;
  const stairRise = (catwalkY - hf) / stairCount;
  const stairRun = 0.7;
  const stairZBase = hangarCZ - hangarD / 2 - 0.6;
  for (let i = 0; i < stairCount; i++) {
    const sy = hf + (i + 0.5) * stairRise;
    const sz = stairZBase - i * stairRun;
    addBox(buckets.catwalk, 1.6, stairRise, stairRun, hangarCX - hangarW / 2 - 1.2, sy, sz);
    colliders.push({
      min: [hangarCX - hangarW / 2 - 2, hf, sz - stairRun / 2],
      max: [hangarCX - hangarW / 2 - 0.4, hf + (i + 1) * stairRise, sz + stairRun / 2],
    });
  }
  // Stair landing connecting to catwalk.
  addBox(buckets.catwalk, 2, 0.2, 2, hangarCX - hangarW / 2 - 0.5, catwalkY, hangarCZ - hangarD / 2 + 1);
  colliders.push({
    min: [hangarCX - hangarW / 2 - 1.5, catwalkY - 0.1, hangarCZ - hangarD / 2],
    max: [hangarCX - hangarW / 2 + 0.5, catwalkY + 0.1, hangarCZ - hangarD / 2 + 2],
  });

  // Container rows inside hangar (corridors).
  const cKeys: MatKey[] = ['cA', 'cB', 'cC', 'cD'];
  const containerY = hf + 1.3;
  for (let row = 0; row < 3; row++) {
    const rowZ = hangarCZ - 12 + row * 12;
    for (let i = 0; i < 5; i++) {
      const colX = hangarCX - 20 + i * 10;
      const ck = cKeys[(row + i) % cKeys.length];
      addBox(buckets[ck], 6, 2.6, 2.4, colX, containerY, rowZ);
      colliders.push({
        min: [colX - 3, hf, rowZ - 1.2],
        max: [colX + 3, hf + 2.6, rowZ + 1.2],
      });
      // Stack a second container half the time.
      if (rng.chance(0.5)) {
        const ck2 = cKeys[(row + i + 2) % cKeys.length];
        addBox(buckets[ck2], 6, 2.6, 2.4, colX + rng.range(-0.4, 0.4), containerY + 2.6, rowZ + rng.range(-0.4, 0.4), 0, 0, rng.range(-0.06, 0.06));
        colliders.push({
          min: [colX - 3, hf + 2.6, rowZ - 1.2],
          max: [colX + 3, hf + 5.2, rowZ + 1.2],
        });
      }
    }
  }

  // Overturned forklift — boxy.
  const fX = hangarCX + 18;
  const fZ = hangarCZ - 10;
  addBox(buckets.rust, 2.0, 1.6, 3.2, fX, hf + 0.8, fZ, 0, 0.6, 0.8);
  addBox(buckets.metal, 0.2, 1.6, 1.6, fX + 1, hf + 1.6, fZ - 0.8, 0, 0.6, 0.8);
  colliders.push({ min: [fX - 1.5, hf, fZ - 2], max: [fX + 1.5, hf + 2, fZ + 2] });

  // Hangar interior lights — 4 PointLights.
  for (let i = 0; i < 4; i++) {
    const lx = hangarCX - 25 + i * 15;
    const lz = hangarCZ;
    const ly = hf + wallH - 1.5;
    const light = new PointLight(0xffd6a0, 2.6, 28, 1.5);
    light.position.set(lx, ly, lz);
    lights.push(light);
    flickerLights.push({ light, base: 2.6, phase: rng.range(0, Math.PI * 2), speed: rng.range(3, 5) });
    // Emissive ceiling cube (free glow).
    addBox(buckets.neon, 0.8, 0.2, 0.8, lx, ly + 0.3, lz);
  }

  // ----------------------------------------------------------
  // Smokestack — 45 m tall leaning chimney.
  // ----------------------------------------------------------
  const stackX = cx + 35;
  const stackZ = cz - 35;
  const stackG = gh(stackX, stackZ);
  const stackTilt = 0.16;
  // Cylindrical smokestack via stacked tilted segments.
  const stackSegments = 9;
  const segH = 5;
  for (let i = 0; i < stackSegments; i++) {
    const y = stackG + i * segH + segH / 2;
    const lateral = i * 0.8 * stackTilt * 2;
    const r = 2.6 - i * 0.12;
    addCylinder(buckets.soot, r, r + 0.1, segH, 14, stackX + lateral, y, stackZ, 0, 0, stackTilt);
  }
  // Wide base.
  addCylinder(buckets.concrete, 4.2, 5.2, 2, 18, stackX, stackG + 1, stackZ);
  colliders.push({
    min: [stackX - 5.2, stackG, stackZ - 5.2],
    max: [stackX + 5.2, stackG + 2, stackZ + 5.2],
  });
  // Approximate the leaning column collider as a vertical box.
  colliders.push({
    min: [stackX - 3, stackG + 2, stackZ - 3],
    max: [stackX + 3 + stackSegments * 0.8 * stackTilt, stackG + stackSegments * segH, stackZ + 3],
  });

  // ----------------------------------------------------------
  // Fuel tanks — 4 cylindrical tanks 15 m diameter, 8 m tall.
  // ----------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const tx = cx - 50 + (i % 2) * 24;
    const tz = cz - 40 + Math.floor(i / 2) * 22;
    const tg = gh(tx, tz);
    addCylinder(buckets.tank, 7.5, 7.5, 8, 22, tx, tg + 4, tz);
    // Top dome cap (slight squish).
    addCylinder(buckets.tank, 6.5, 7.5, 1.2, 22, tx, tg + 8.6, tz);
    colliders.push({
      min: [tx - 7.5, tg, tz - 7.5],
      max: [tx + 7.5, tg + 9, tz + 7.5],
    });
    // Catwalk encircling — represented as 8 horizontal beams.
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      addBox(buckets.metal, 1.2, 0.15, 0.15, tx + Math.cos(a) * 7.6, tg + 6, tz + Math.sin(a) * 7.6, a);
    }
  }

  // ----------------------------------------------------------
  // Crane — truss tower 25 m tall + horizontal arm.
  // ----------------------------------------------------------
  const craneX = cx + 50;
  const craneZ = cz + 35;
  const craneG = gh(craneX, craneZ);
  const craneH = 25;
  const towerHalf = 1.2;
  // Four corner posts.
  addBox(buckets.metal, 0.3, craneH, 0.3, craneX + towerHalf, craneG + craneH / 2, craneZ + towerHalf);
  addBox(buckets.metal, 0.3, craneH, 0.3, craneX - towerHalf, craneG + craneH / 2, craneZ + towerHalf);
  addBox(buckets.metal, 0.3, craneH, 0.3, craneX + towerHalf, craneG + craneH / 2, craneZ - towerHalf);
  addBox(buckets.metal, 0.3, craneH, 0.3, craneX - towerHalf, craneG + craneH / 2, craneZ - towerHalf);
  // Cross braces every 4 m.
  for (let i = 0; i < 6; i++) {
    const y = craneG + 2 + i * 4;
    addBox(buckets.rust, 0.16, 0.16, towerHalf * 2.8, craneX + towerHalf, y, craneZ);
    addBox(buckets.rust, 0.16, 0.16, towerHalf * 2.8, craneX - towerHalf, y, craneZ);
    addBox(buckets.rust, towerHalf * 2.8, 0.16, 0.16, craneX, y, craneZ + towerHalf);
    addBox(buckets.rust, towerHalf * 2.8, 0.16, 0.16, craneX, y, craneZ - towerHalf);
  }
  colliders.push({
    min: [craneX - towerHalf - 0.3, craneG, craneZ - towerHalf - 0.3],
    max: [craneX + towerHalf + 0.3, craneG + craneH, craneZ + towerHalf + 0.3],
  });
  // Horizontal arm extending +X.
  addBox(buckets.metal, 18, 0.6, 0.5, craneX + 9, craneG + craneH - 1, craneZ);
  addBox(buckets.metal, 18, 0.6, 0.5, craneX + 9, craneG + craneH - 0.4, craneZ);
  // Counterweight.
  addBox(buckets.concrete, 2, 1.4, 1.6, craneX - 3, craneG + craneH - 0.7, craneZ);
  // Hook chain (vertical thin).
  addBox(buckets.rust, 0.15, 6, 0.15, craneX + 16, craneG + craneH - 4, craneZ);
  addBox(buckets.metal, 0.6, 0.6, 0.6, craneX + 16, craneG + craneH - 7.5, craneZ);

  // ----------------------------------------------------------
  // Outdoor container yard — instanced.
  // ----------------------------------------------------------
  const yardCount = 24;
  // Render outdoor containers via instanced boxes? Keep the merged-bucket pattern (mixed colors).
  for (let i = 0; i < yardCount; i++) {
    const yx = cx - 60 + rng.range(-6, 6) + (i % 6) * 8;
    const yz = cz - 5 + rng.range(-6, 6) + Math.floor(i / 6) * 7;
    const yg = gh(yx, yz);
    const stack = rng.int(1, 3);
    const ck = cKeys[i % cKeys.length];
    for (let s = 0; s < stack; s++) {
      addBox(buckets[ck], 6, 2.6, 2.4, yx + rng.range(-0.2, 0.2), yg + 1.3 + s * 2.6, yz + rng.range(-0.2, 0.2), rng.range(-0.05, 0.05), 0, 0);
      colliders.push({
        min: [yx - 3, yg + s * 2.6, yz - 1.2],
        max: [yx + 3, yg + (s + 1) * 2.6, yz + 1.2],
      });
    }
  }

  // ----------------------------------------------------------
  // Ground pipes running across the yard.
  // ----------------------------------------------------------
  for (let i = 0; i < 6; i++) {
    const px1 = cx - 60 + rng.range(0, 10);
    const px2 = px1 + rng.range(20, 60);
    const pz = cz - 50 + i * 12 + rng.range(-2, 2);
    const pg = gh((px1 + px2) / 2, pz);
    const len = px2 - px1;
    const pipe = new CylinderGeometry(0.5, 0.5, len, 12);
    const rot = new Matrix4().makeRotationZ(Math.PI / 2);
    pipe.applyMatrix4(rot);
    pipe.applyMatrix4(new Matrix4().makeTranslation((px1 + px2) / 2, pg + 0.7, pz));
    buckets.pipe.geos.push(pipe);
    // Support stands.
    for (let s = 0; s < Math.floor(len / 8); s++) {
      const sx = px1 + 4 + s * 8;
      addBox(buckets.metal, 0.4, 0.7, 0.4, sx, gh(sx, pz) + 0.35, pz);
    }
  }

  // ----------------------------------------------------------
  // Satellite dishes on hangar roof.
  // ----------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    const dx = hangarCX - 20 + i * 18;
    const dz = hangarCZ - hangarD / 2 + 6 + (i % 2) * 4;
    addCylinder(buckets.metal, 0.2, 0.2, 1.5, 8, dx, roofY + 0.9, dz);
    addCylinder(buckets.tank, 1.6, 0.2, 0.4, 16, dx, roofY + 1.7, dz, 0, 0.5, 0);
  }

  // ----------------------------------------------------------
  // Materials.
  // ----------------------------------------------------------
  const mats: Record<MatKey, MeshStandardMaterial> = {
    hangarSteel: new MeshStandardMaterial({ color: PALETTE.hangarSteel, roughness: 0.85, metalness: 0.2 }),
    hangarRoof:  new MeshStandardMaterial({ color: PALETTE.hangarRoof,  roughness: 0.9,  metalness: 0.15 }),
    concrete:    new MeshStandardMaterial({ color: PALETTE.concrete,    roughness: 0.95, metalness: 0.05 }),
    metal:       new MeshStandardMaterial({ color: PALETTE.metal,       roughness: 0.85, metalness: 0.15 }),
    rust:        new MeshStandardMaterial({ color: PALETTE.rust,        roughness: 0.95, metalness: 0.1 }),
    pipe:        new MeshStandardMaterial({ color: PALETTE.pipeRust,    roughness: 0.95, metalness: 0.1 }),
    soot:        new MeshStandardMaterial({ color: PALETTE.smokestackSoot, roughness: 1.0, metalness: 0.0 }),
    tank:        new MeshStandardMaterial({ color: PALETTE.fuelTank,    roughness: 0.8,  metalness: 0.2 }),
    catwalk:     new MeshStandardMaterial({ color: PALETTE.catwalkMetal, roughness: 0.9, metalness: 0.15 }),
    cA:          new MeshStandardMaterial({ color: PALETTE.containerA, roughness: 0.95, metalness: 0.1 }),
    cB:          new MeshStandardMaterial({ color: PALETTE.containerB, roughness: 0.95, metalness: 0.1 }),
    cC:          new MeshStandardMaterial({ color: PALETTE.containerC, roughness: 0.95, metalness: 0.1 }),
    cD:          new MeshStandardMaterial({ color: PALETTE.containerD, roughness: 0.95, metalness: 0.1 }),
    neon:        new MeshStandardMaterial({ color: 0x2a2418, emissive: new Color(0xffc070), emissiveIntensity: 1.8, roughness: 0.6 }),
  };
  const ownedGeos: BufferGeometry[] = [];
  const ownedMats: MeshStandardMaterial[] = Object.values(mats);

  (Object.keys(buckets) as MatKey[]).forEach((k) => flushBucket(group, buckets[k], mats[k], ownedGeos));

  // Instanced rubble around the industrial site.
  const RUBBLE = 220;
  const rubbleGeo = new BoxGeometry(1, 1, 1);
  const rubbleMat = new MeshStandardMaterial({ color: PALETTE.debris, roughness: 1.0 });
  ownedGeos.push(rubbleGeo);
  ownedMats.push(rubbleMat);
  const rubble = new InstancedMesh(rubbleGeo, rubbleMat, RUBBLE);
  rubble.castShadow = false;
  rubble.receiveShadow = true;
  rubble.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < RUBBLE; i++) {
    const px = rng.range(region.minX + 4, region.maxX - 4);
    const pz = rng.range(region.minZ + 4, region.maxZ - 4);
    // Skip rubble inside the hangar interior (visual cleanliness).
    if (Math.abs(px - hangarCX) < hangarW / 2 - 1 && Math.abs(pz - hangarCZ) < hangarD / 2 - 1) continue;
    const sx = rng.range(0.3, 0.9), sy = rng.range(0.2, 0.7), sz = rng.range(0.3, 0.9);
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

  // Add lights to scene (after group already added).
  for (const l of lights) group.add(l);

  scene.add(group);

  const update = (t: number) => {
    for (const f of flickerLights) {
      const flick = 1 + 0.06 * Math.sin(t * f.speed + f.phase) + 0.03 * Math.sin(t * f.speed * 0.7);
      f.light.intensity = f.base * flick;
    }
  };

  // Shelter near factory (NE edge).
  const shelterX = region.maxX - 14;
  const shelterZ = region.minZ + 14;

  return {
    colliders,
    shelterCandidates: [{ position: [shelterX, gh(shelterX, shelterZ), shelterZ] }],
    landmarks: [
      { kind: 'smokestack', position: [stackX, stackG, stackZ] },
    ],
    update,
  };
}
