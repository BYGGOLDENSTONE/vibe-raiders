// Ruined urban biome — refactored & densified from the original city.ts.
// 8x8 block grid, taller average buildings, walkable interiors in two
// hero buildings, billboards / neon, tipped trams.

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
  Vector3,
} from 'three';

import type { Collider } from '../colliders';
import { PALETTE } from '../palette';
import type { Rng } from '../rng';
import type { BiomeOpts, BiomeResult } from './types';
import { addBox, flushBucket, makeBucket, type GeoBucket } from './_common';

type MatKey = 'concrete' | 'asphalt' | 'rust' | 'brick' | 'metal' | 'debris' | 'neonRed' | 'neonCyan' | 'lobbyFloor';

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const _m = new Matrix4();

function makeBuckets(): Record<MatKey, GeoBucket> {
  return {
    concrete: makeBucket(),
    asphalt: makeBucket(),
    rust: makeBucket(),
    brick: makeBucket(),
    metal: makeBucket(),
    debris: makeBucket(),
    neonRed: makeBucket(),
    neonCyan: makeBucket(),
    lobbyFloor: makeBucket(),
  };
}

function genBuilding(
  rng: Rng,
  buckets: Record<MatKey, GeoBucket>,
  cx: number, cz: number,
  maxW: number, maxD: number,
  groundY: number,
  out: Collider[],
): void {
  const w = rng.range(5, Math.min(15, maxW));
  const d = rng.range(5, Math.min(15, maxD));
  const totalH = rng.range(8, 30);

  const baseKey: MatKey = rng.chance(0.55) ? 'concrete' : 'brick';

  const sections = rng.int(2, 5);
  let yCursor = groundY;
  let curW = w, curD = d, curX = cx, curZ = cz;

  for (let i = 0; i < sections; i++) {
    const sectionH = (totalH / sections) * rng.range(0.7, 1.2);
    const tilt = i === sections - 1 && rng.chance(0.4) ? rng.range(-0.18, 0.18) : 0;
    const offX = rng.range(-0.5, 0.5);
    const offZ = rng.range(-0.5, 0.5);

    const matKey: MatKey = i === 0 ? baseKey : (rng.chance(0.7) ? baseKey : (rng.chance(0.5) ? 'rust' : 'metal'));

    addBox(
      buckets[matKey],
      curW, sectionH, curD,
      curX + offX, yCursor + sectionH / 2, curZ + offZ,
      0, 0, tilt,
    );

    if (Math.abs(tilt) < 0.08) {
      out.push({
        min: [curX + offX - curW / 2, yCursor, curZ + offZ - curD / 2],
        max: [curX + offX + curW / 2, yCursor + sectionH, curZ + offZ + curD / 2],
      });
    }

    yCursor += sectionH;
    curW *= rng.range(0.55, 0.92);
    curD *= rng.range(0.55, 0.92);
    curX += rng.range(-0.6, 0.6);
    curZ += rng.range(-0.6, 0.6);
    if (curW < 1.5 || curD < 1.5) break;
  }

  // Beams sticking up.
  const beamCount = rng.int(1, 3);
  for (let b = 0; b < beamCount; b++) {
    const bw = rng.range(0.18, 0.32);
    const bh = rng.range(1.5, 3.5);
    const bx = cx + rng.range(-w / 2 + 0.5, w / 2 - 0.5);
    const bz = cz + rng.range(-d / 2 + 0.5, d / 2 - 0.5);
    addBox(buckets.metal, bw, bh, bw, bx, yCursor + bh / 2, bz, 0, rng.range(-0.15, 0.15), rng.range(-0.15, 0.15));
  }

  // Sometimes a billboard sign on the side.
  if (rng.chance(0.18)) {
    const bw = rng.range(3, 6);
    const bh = rng.range(1.5, 2.5);
    const sx = cx + (rng.chance(0.5) ? w / 2 + 0.3 : -w / 2 - 0.3);
    const sy = yCursor - 1 - bh / 2;
    addBox(buckets.metal, 0.4, bh, bw, sx, sy, cz, 0, 0, 0);
    // emissive panel
    const matK: MatKey = rng.chance(0.5) ? 'neonRed' : 'neonCyan';
    addBox(buckets[matK], 0.18, bh - 0.4, bw - 0.4, sx + (sx > cx ? 0.25 : -0.25), sy, cz, 0, 0, 0);
  }
}

function addPlazaRubble(
  rng: Rng,
  buckets: Record<MatKey, GeoBucket>,
  cx: number, cz: number, blockSize: number,
  groundY: number,
): void {
  const piles = rng.int(2, 5);
  const half = blockSize * 0.5 - 1.5;
  for (let i = 0; i < piles; i++) {
    const pw = rng.range(0.8, 2.0);
    const ph = rng.range(0.4, 1.2);
    const pd = rng.range(0.8, 2.0);
    addBox(
      buckets.debris,
      pw, ph, pd,
      cx + rng.range(-half, half),
      groundY + ph / 2,
      cz + rng.range(-half, half),
      rng.next() * Math.PI * 2,
      0,
      rng.range(-0.2, 0.2),
    );
  }
}

// Walkable interior building — open lobby with stairs to a 2nd floor.
// Exterior shell with door cutouts, interior posts, staircase, second-floor slab.
function genWalkableBuilding(
  rng: Rng,
  buckets: Record<MatKey, GeoBucket>,
  cx: number, cz: number,
  groundY: number,
  out: Collider[],
  lights: PointLight[],
): void {
  const w = 14;
  const d = 12;
  const floorH = 4;
  const wallT = 0.4;

  // Walls — split each wall into segments to leave a doorway opening on +Z (front)
  // Floor 1 + Floor 2 + Roof
  for (let f = 0; f < 2; f++) {
    const yBase = groundY + f * floorH;
    const yTop = yBase + floorH;
    const yMid = yBase + floorH / 2;

    // Back wall (-Z)
    addBox(buckets.concrete, w, floorH, wallT, cx, yMid, cz - d / 2, 0, 0, 0);
    out.push({ min: [cx - w / 2, yBase, cz - d / 2 - wallT / 2], max: [cx + w / 2, yTop, cz - d / 2 + wallT / 2] });

    // Front wall (+Z) — doorway 2.4 m wide centered (only floor 1 has the doorway)
    if (f === 0) {
      const segW = (w - 2.4) / 2;
      addBox(buckets.concrete, segW, floorH, wallT, cx - (w / 2 - segW / 2), yMid, cz + d / 2, 0, 0, 0);
      addBox(buckets.concrete, segW, floorH, wallT, cx + (w / 2 - segW / 2), yMid, cz + d / 2, 0, 0, 0);
      // lintel
      addBox(buckets.concrete, 2.4, 0.6, wallT, cx, yBase + floorH - 0.3, cz + d / 2, 0, 0, 0);
      out.push({ min: [cx - w / 2, yBase, cz + d / 2 - wallT / 2], max: [cx - 1.2, yTop, cz + d / 2 + wallT / 2] });
      out.push({ min: [cx + 1.2, yBase, cz + d / 2 - wallT / 2], max: [cx + w / 2, yTop, cz + d / 2 + wallT / 2] });
    } else {
      addBox(buckets.concrete, w, floorH, wallT, cx, yMid, cz + d / 2, 0, 0, 0);
      out.push({ min: [cx - w / 2, yBase, cz + d / 2 - wallT / 2], max: [cx + w / 2, yTop, cz + d / 2 + wallT / 2] });
    }

    // Side walls (-X, +X)
    addBox(buckets.concrete, wallT, floorH, d, cx - w / 2, yMid, cz, 0, 0, 0);
    addBox(buckets.concrete, wallT, floorH, d, cx + w / 2, yMid, cz, 0, 0, 0);
    out.push({ min: [cx - w / 2 - wallT / 2, yBase, cz - d / 2], max: [cx - w / 2 + wallT / 2, yTop, cz + d / 2] });
    out.push({ min: [cx + w / 2 - wallT / 2, yBase, cz - d / 2], max: [cx + w / 2 + wallT / 2, yTop, cz + d / 2] });
  }

  // Second-floor slab (with a 2.5m wide opening for the stairs at -X side).
  const slabY = groundY + floorH;
  // Main slab
  addBox(buckets.concrete, w - 3, 0.3, d, cx + 1.5, slabY, cz, 0, 0, 0);
  out.push({ min: [cx + 1.5 - (w - 3) / 2, slabY - 0.15, cz - d / 2], max: [cx + 1.5 + (w - 3) / 2, slabY + 0.15, cz + d / 2] });
  // Strip slab on other side at back
  addBox(buckets.concrete, 3, 0.3, d * 0.4, cx - w / 2 + 1.5, slabY, cz - d / 2 + d * 0.2, 0, 0, 0);
  out.push({ min: [cx - w / 2, slabY - 0.15, cz - d / 2], max: [cx - w / 2 + 3, slabY + 0.15, cz - d / 2 + d * 0.4] });

  // Roof slab.
  const roofY = groundY + floorH * 2;
  addBox(buckets.concrete, w, 0.3, d, cx, roofY, cz, 0, 0, 0);
  out.push({ min: [cx - w / 2, roofY - 0.15, cz - d / 2], max: [cx + w / 2, roofY + 0.15, cz + d / 2] });

  // Stairs — from floor 1 (-X side) up to floor 2 opening.
  // Series of stepping boxes.
  const stairCount = 8;
  const stairRise = floorH / stairCount;
  const stairRun = 0.6;
  const stairW = 1.8;
  const stairXBase = cx - w / 2 + stairW / 2 + 0.3;
  const stairZStart = cz + 1;
  for (let i = 0; i < stairCount; i++) {
    const sy = groundY + (i + 0.5) * stairRise;
    const sz = stairZStart - i * stairRun;
    addBox(buckets.concrete, stairW, stairRise, stairRun, stairXBase, sy, sz, 0, 0, 0);
    out.push({
      min: [stairXBase - stairW / 2, groundY, sz - stairRun / 2],
      max: [stairXBase + stairW / 2, groundY + (i + 1) * stairRise, sz + stairRun / 2],
    });
  }

  // Lobby furniture — a few boxes (broken desks).
  for (let i = 0; i < 4; i++) {
    const fx = cx + rng.range(-w / 2 + 2, w / 2 - 2);
    const fz = cz + rng.range(-d / 2 + 2, d / 2 - 2);
    if (Math.abs(fx - stairXBase) < stairW && Math.abs(fz - stairZStart) < 4) continue;
    const fw = rng.range(0.8, 1.6);
    const fh = rng.range(0.4, 1.0);
    const fd = rng.range(0.8, 1.6);
    addBox(buckets.debris, fw, fh, fd, fx, groundY + fh / 2, fz, rng.next() * Math.PI * 2, 0, 0);
  }

  // Interior ceiling cube emissive (visible light source).
  addBox(buckets.neonCyan, 0.6, 0.18, 0.6, cx, groundY + floorH - 0.2, cz, 0, 0, 0);
  addBox(buckets.neonCyan, 0.6, 0.18, 0.6, cx, groundY + floorH * 2 - 0.2, cz, 0, 0, 0);

  // Interior PointLights (2 per walkable building — kept lean for the light budget).
  const l1 = new PointLight(0xffd6a8, 2.6, 24, 1.6);
  l1.position.set(cx, groundY + floorH - 0.5, cz);
  lights.push(l1);
  const l2 = new PointLight(0xffd6a8, 2.4, 22, 1.6);
  l2.position.set(cx + 3, groundY + floorH * 2 - 0.5, cz - 2);
  lights.push(l2);
}

// Tipped tram: long box body + wheels.
function addTram(
  rng: Rng,
  body: GeoBucket,
  rust: GeoBucket,
  metal: GeoBucket,
  cx: number, cz: number,
  groundY: number,
  out: Collider[],
): void {
  const tiltZ = rng.range(-0.3, 0.3);
  const tiltX = rng.range(-0.15, 0.15);
  const yaw = rng.next() * Math.PI * 2;
  const yLift = groundY + 1.2 + Math.abs(tiltZ) * 0.5;

  // Main body 2.6 x 2.6 x 9 m
  const g = new BoxGeometry(2.6, 2.6, 9);
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _p.set(cx, yLift, cz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  body.geos.push(g);

  // Roof strip
  const r = new BoxGeometry(2.4, 0.4, 8.6);
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _p.set(cx, yLift + 1.5, cz);
  _m.compose(_p, _q, _s);
  r.applyMatrix4(_m);
  rust.geos.push(r);

  // Windows (emissive-ish dark)
  for (let i = -3; i <= 3; i++) {
    const wg = new BoxGeometry(0.1, 1.0, 0.9);
    _e.set(tiltX, yaw, tiltZ);
    _q.setFromEuler(_e);
    const localOffset = new Vector3(1.31, 0.4, i * 1.2).applyEuler(_e);
    _p.set(cx + localOffset.x, yLift + localOffset.y, cz + localOffset.z);
    _m.compose(_p, _q, _s);
    wg.applyMatrix4(_m);
    metal.geos.push(wg);
  }

  out.push({
    min: [cx - 4.7, groundY, cz - 4.7],
    max: [cx + 4.7, groundY + 3.5, cz + 4.7],
  });
}

function addCar(
  rng: Rng,
  body: GeoBucket,
  rust: GeoBucket,
  wheels: GeoBucket,
  cx: number, cz: number,
  groundY: number,
  out: Collider[],
): void {
  const tiltZ = rng.range(-0.5, 0.5);
  const tiltX = rng.range(-0.3, 0.3);
  const yaw = rng.next() * Math.PI * 2;
  const yLift = groundY + Math.abs(tiltZ) * 0.5 + 0.5;

  const g = new BoxGeometry(1.8, 1.0, 4.0);
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _p.set(cx, yLift, cz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  body.geos.push(g);

  const r = new BoxGeometry(1.6, 0.6, 2.0);
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _p.set(cx, yLift + 0.7, cz);
  _m.compose(_p, _q, _s);
  r.applyMatrix4(_m);
  rust.geos.push(r);

  const wheelLocal: [number, number, number][] = [
    [ 0.9, -0.4,  1.4],
    [-0.9, -0.4,  1.4],
    [ 0.9, -0.4, -1.4],
    [-0.9, -0.4, -1.4],
  ];
  const carM = new Matrix4().compose(_p.set(cx, yLift, cz), _q.setFromEuler(_e.set(tiltX, yaw, tiltZ)), _s);
  for (const local of wheelLocal) {
    const wg = new CylinderGeometry(0.4, 0.4, 0.3, 10);
    const rot = new Matrix4().makeRotationZ(Math.PI / 2);
    wg.applyMatrix4(rot);
    const trans = new Matrix4().makeTranslation(local[0], local[1], local[2]);
    wg.applyMatrix4(trans);
    wg.applyMatrix4(carM);
    wheels.geos.push(wg);
  }

  out.push({
    min: [cx - 1.2, groundY, cz - 2.2],
    max: [cx + 1.2, groundY + 1.6, cz + 2.2],
  });
}

export function buildCityBiome(opts: BiomeOpts): BiomeResult {
  const { scene, rng, region, groundHeight: gh } = opts;
  const colliders: Collider[] = [];
  const buckets = makeBuckets();
  const carBody = makeBucket();
  const carRust = makeBucket();
  const carWheel = makeBucket();
  const lights: PointLight[] = [];

  const cityGroup = new Group();
  cityGroup.name = 'biome-city';

  const minX = region.minX, maxX = region.maxX;
  const minZ = region.minZ, maxZ = region.maxZ;
  const span = Math.min(maxX - minX, maxZ - minZ);

  // 8x8 block grid filling the region.
  const gridN = 8;
  const street = 6;
  const blockSize = (span - (gridN - 1) * street) / gridN;
  const stride = blockSize + street;
  const startX = minX + 4 + blockSize / 2;
  const startZ = minZ + 4 + blockSize / 2;

  // Walkable hero buildings — choose two block coords up front.
  const walkableA = { gx: 2, gz: 5 };
  const walkableB = { gx: 5, gz: 2 };

  for (let gx = 0; gx < gridN; gx++) {
    for (let gz = 0; gz < gridN; gz++) {
      const cx = startX + gx * stride;
      const cz = startZ + gz * stride;
      const groundY = gh(cx, cz);

      // Reserve a block for the cathedral landmark (offset from corner).
      if (gx === 4 && gz === 4) continue;

      // Walkable hero buildings
      if ((gx === walkableA.gx && gz === walkableA.gz) || (gx === walkableB.gx && gz === walkableB.gz)) {
        genWalkableBuilding(rng, buckets, cx, cz, groundY, colliders, lights);
        continue;
      }

      // 12% plazas (lower than original — more density)
      if (rng.chance(0.12)) {
        addPlazaRubble(rng, buckets, cx, cz, blockSize, groundY);
        continue;
      }

      const count = rng.int(1, 3);
      for (let b = 0; b < count; b++) {
        const subW = blockSize / (count >= 2 ? 2 : 1);
        const subD = blockSize / (count >= 3 ? 2 : 1);
        const slotX = cx + (count >= 2 ? rng.range(-blockSize * 0.25, blockSize * 0.25) : 0);
        const slotZ = cz + (count >= 3 ? rng.range(-blockSize * 0.25, blockSize * 0.25) : 0);
        const groundLocal = gh(slotX, slotZ);
        genBuilding(rng, buckets, slotX, slotZ, subW - 2, subD - 2, groundLocal, colliders);
      }
    }
  }

  // Cathedral spire landmark in the middle of the city.
  const cathedralX = startX + 4 * stride;
  const cathedralZ = startZ + 4 * stride;
  const cathedralGround = gh(cathedralX, cathedralZ);
  // Big base
  addBox(buckets.brick, 12, 12, 12, cathedralX, cathedralGround + 6, cathedralZ);
  colliders.push({ min: [cathedralX - 6, cathedralGround, cathedralZ - 6], max: [cathedralX + 6, cathedralGround + 12, cathedralZ + 6] });
  // Tilted spire — broken
  addBox(buckets.concrete, 6, 18, 6, cathedralX, cathedralGround + 12 + 9, cathedralZ, 0, 0, 0.18);
  // Tip cross
  addBox(buckets.metal, 0.4, 4, 0.4, cathedralX + 2.5, cathedralGround + 32, cathedralZ, 0, 0, 0.18);
  addBox(buckets.metal, 2, 0.4, 0.4, cathedralX + 2.3, cathedralGround + 31, cathedralZ, 0, 0, 0.18);

  // Crashed cars + tipped trams scattered.
  const carCount = rng.int(8, 12);
  for (let i = 0; i < carCount; i++) {
    const gx = rng.int(0, gridN - 1);
    const gz = rng.int(0, gridN - 1);
    const cx = startX + gx * stride + rng.range(-blockSize * 0.4, blockSize * 0.4);
    const cz = startZ + gz * stride + rng.range(-blockSize * 0.4, blockSize * 0.4);
    addCar(rng, carBody, carRust, carWheel, cx, cz, gh(cx, cz), colliders);
  }
  const tramCount = 3;
  for (let i = 0; i < tramCount; i++) {
    const tx = minX + rng.range(blockSize, span - blockSize);
    const tz = minZ + rng.range(blockSize, span - blockSize);
    addTram(rng, carBody, carRust, buckets.metal, tx, tz, gh(tx, tz), colliders);
  }

  // Fallen radio tower (the original landmark) — placed near city center but offset.
  const towerCX = startX + 3 * stride;
  const towerCZ = startZ + 3 * stride;
  const towerGround = gh(towerCX, towerCZ);
  const tilt = 0.22;
  const segments = 8;
  const segH = 4;
  const baseSize = 4;
  for (let i = 0; i < segments; i++) {
    const y = towerGround + i * segH + segH / 2;
    const lateral = Math.sin((i / segments) * Math.PI * 0.5) * tilt * (segH * segments) * 0.4;
    const sx = towerCX + lateral;
    const sz = towerCZ;
    const size = baseSize * (1 - i * 0.05);
    const half = size * 0.5;
    addBox(buckets.metal, 0.4, segH, 0.4, sx + half, y, sz + half, 0, 0, tilt);
    addBox(buckets.metal, 0.4, segH, 0.4, sx - half, y, sz + half, 0, 0, tilt);
    addBox(buckets.metal, 0.4, segH, 0.4, sx + half, y, sz - half, 0, 0, tilt);
    addBox(buckets.metal, 0.4, segH, 0.4, sx - half, y, sz - half, 0, 0, tilt);
    if (i % 2 === 0) {
      addBox(buckets.rust, size * 1.2, 0.18, 0.18, sx, y, sz, 0, Math.PI * 0.25, 0);
    }
  }
  colliders.push({ min: [towerCX - 3, towerGround, towerCZ - 3], max: [towerCX + 3, towerGround + 6, towerCZ + 3] });

  // Materials.
  const mats: Record<MatKey, MeshStandardMaterial> = {
    concrete: new MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95, metalness: 0.05 }),
    asphalt:  new MeshStandardMaterial({ color: PALETTE.asphalt,  roughness: 1.0,  metalness: 0.0  }),
    rust:     new MeshStandardMaterial({ color: PALETTE.rust,     roughness: 0.9,  metalness: 0.1  }),
    brick:    new MeshStandardMaterial({ color: PALETTE.brick,    roughness: 1.0,  metalness: 0.0  }),
    metal:    new MeshStandardMaterial({ color: PALETTE.metal,    roughness: 0.85, metalness: 0.1  }),
    debris:   new MeshStandardMaterial({ color: PALETTE.debris,   roughness: 1.0,  metalness: 0.0  }),
    neonRed:  new MeshStandardMaterial({ color: 0x300808, emissive: new Color(0xff2030), emissiveIntensity: 1.6, roughness: 0.6 }),
    neonCyan: new MeshStandardMaterial({ color: 0x081830, emissive: new Color(0x40d8ff), emissiveIntensity: 1.6, roughness: 0.6 }),
    lobbyFloor: new MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 1.0 }),
  };

  const ownedGeos: BufferGeometry[] = [];
  const ownedMats: MeshStandardMaterial[] = Object.values(mats);

  (Object.keys(buckets) as MatKey[]).forEach((k) => flushBucket(cityGroup, buckets[k], mats[k], ownedGeos));
  flushBucket(cityGroup, carBody, mats.metal, ownedGeos);
  flushBucket(cityGroup, carRust, mats.rust, ownedGeos);
  flushBucket(cityGroup, carWheel, mats.metal, ownedGeos);

  // Rubble — InstancedMesh covering the city footprint.
  const RUBBLE_COUNT = 700;
  const rubbleGeo = new BoxGeometry(1, 1, 1);
  const rubbleMat = new MeshStandardMaterial({ color: PALETTE.debris, roughness: 1.0, metalness: 0.0 });
  ownedGeos.push(rubbleGeo);
  ownedMats.push(rubbleMat);
  const rubble = new InstancedMesh(rubbleGeo, rubbleMat, RUBBLE_COUNT);
  rubble.castShadow = false;
  rubble.receiveShadow = true;
  rubble.instanceMatrix.setUsage(DynamicDrawUsage);

  for (let i = 0; i < RUBBLE_COUNT; i++) {
    const px = rng.range(minX + 2, maxX - 2);
    const pz = rng.range(minZ + 2, maxZ - 2);
    const sx = rng.range(0.3, 0.9);
    const sy = rng.range(0.2, 0.7);
    const sz = rng.range(0.3, 0.9);
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
  cityGroup.add(rubble);

  // Lights.
  for (const l of lights) cityGroup.add(l);

  // Fires.
  interface FireRec { light: PointLight; mesh: Mesh; base: number; phase: number; speed: number; }
  const fires: FireRec[] = [];
  const fireMat = new MeshStandardMaterial({
    color: 0x1a0d04,
    emissive: new Color(PALETTE.fireGlow),
    emissiveIntensity: 1.4,
    roughness: 1.0,
  });
  ownedMats.push(fireMat);
  const fireGeo = new BoxGeometry(0.4, 0.3, 0.4);
  ownedGeos.push(fireGeo);

  const fireCount = 3;
  for (let i = 0; i < fireCount; i++) {
    const fx = rng.range(minX + 10, maxX - 10);
    const fz = rng.range(minZ + 10, maxZ - 10);
    const fy = gh(fx, fz);
    const baseI = rng.range(1.6, 2.8);
    const light = new PointLight(PALETTE.fireGlow, baseI, 14, 2);
    light.position.set(fx, fy + 1.0, fz);
    cityGroup.add(light);
    const mesh = new Mesh(fireGeo, fireMat);
    mesh.position.set(fx, fy + 0.15, fz);
    cityGroup.add(mesh);
    fires.push({ light, mesh, base: baseI, phase: rng.range(0, Math.PI * 2), speed: rng.range(7, 11) });
  }

  scene.add(cityGroup);

  const update = (t: number) => {
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      const a = Math.sin(t * f.speed + f.phase);
      const b = Math.sin(t * (f.speed * 0.4 + 1) + f.phase * 1.7);
      const flick = 1 + 0.22 * a + 0.12 * b;
      f.light.intensity = f.base * flick;
      (f.mesh.material as MeshStandardMaterial).emissiveIntensity = 1.1 + 0.4 * a;
    }
    // Subtle interior light flicker.
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      const flick = 1 + 0.04 * Math.sin(t * 6 + i * 1.3);
      l.userData.baseIntensity = l.userData.baseIntensity ?? l.intensity / flick;
      // store baseline once
      l.intensity = (l.userData.baseIntensity as number) * flick;
    }
  };

  const landmarks: BiomeResult['landmarks'] = [
    { kind: 'tower', position: [towerCX, towerGround, towerCZ] },
    { kind: 'cathedral', position: [cathedralX, cathedralGround, cathedralZ] },
  ];

  // Shelter candidate — NW corner of city.
  const shelterX = minX + 14;
  const shelterZ = minZ + 14;
  const shelterCandidates: BiomeResult['shelterCandidates'] = [
    { position: [shelterX, gh(shelterX, shelterZ), shelterZ] },
  ];

  return { colliders, shelterCandidates, landmarks, update };
}
