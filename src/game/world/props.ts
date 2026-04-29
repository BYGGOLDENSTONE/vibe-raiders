// Instanced gothic props: tombstones, walls, dead trees, pillars, mausoleums, paths.
// Every prop type uses InstancedMesh to keep draw calls under budget.

import {
  BoxGeometry,
  CylinderGeometry,
  ConeGeometry,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Group,
  BufferGeometry,
  type Material,
} from 'three';
import { TUNING } from '../constants';
import { fbm2D, makeRng, rangeFn } from './rng';

const PROPS_SEED = 4242;
const CLEAR_RADIUS = 6; // around origin (player spawn)
const WORLD_R = TUNING.worldRadius;

interface PlacementOpts {
  count: number;
  minDist: number;
  // density bias: regions where fbm > threshold get density boost.
  clusterBias?: number; // 0..1
  rng: () => number;
}

interface Placement {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  tilt: number;
}

function generatePlacements(opts: PlacementOpts): Placement[] {
  const { count, minDist, clusterBias = 0 } = opts;
  const rng = opts.rng;
  const range = rangeFn(rng);
  const out: Placement[] = [];
  const cellSize = minDist;
  const grid = new Map<string, Placement[]>();
  const key = (gx: number, gz: number) => `${gx},${gz}`;
  const minDist2 = minDist * minDist;

  let attempts = 0;
  const maxAttempts = count * 60;
  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    // Random radial position.
    const r = Math.sqrt(rng()) * (WORLD_R - 8);
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x, z) < CLEAR_RADIUS) continue;

    // Cluster bias via noise.
    if (clusterBias > 0) {
      const n = fbm2D(x * 0.02, z * 0.02, PROPS_SEED + 7, 2); // [-1,1]
      const accept = (n + 1) * 0.5; // 0..1
      if (rng() > accept * clusterBias + (1 - clusterBias)) continue;
    }

    // Spatial reject for spacing.
    const gx = Math.floor(x / cellSize);
    const gz = Math.floor(z / cellSize);
    let tooClose = false;
    for (let dx = -1; dx <= 1 && !tooClose; dx++) {
      for (let dz = -1; dz <= 1 && !tooClose; dz++) {
        const list = grid.get(key(gx + dx, gz + dz));
        if (!list) continue;
        for (const p of list) {
          const ddx = p.x - x;
          const ddz = p.z - z;
          if (ddx * ddx + ddz * ddz < minDist2) { tooClose = true; break; }
        }
      }
    }
    if (tooClose) continue;

    const placement: Placement = {
      x,
      z,
      rotY: rng() * Math.PI * 2,
      scale: range(0.7, 1.4),
      tilt: (rng() - 0.5) * 0.4, // ±0.2 rad
    };
    out.push(placement);
    let bucket = grid.get(key(gx, gz));
    if (!bucket) { bucket = []; grid.set(key(gx, gz), bucket); }
    bucket.push(placement);
  }
  return out;
}

// Merge a hierarchy of meshes into a single combined geometry by baking transforms.
// We're not using BufferGeometryUtils to avoid deps; instead, we build composite as a
// Group->bake into a single InstancedMesh per child mesh and accept multiple draw calls.
//
// For simplicity, we use ONE InstancedMesh per sub-shape, sharing the same instance
// transform per logical prop. This keeps visual variety and stays within budget.

interface CompositeShape {
  geom: BufferGeometry;
  mat: Material;
  // local transform relative to prop origin (ground at y=0).
  offset: Object3D;
}

function makeCompositeInstancedMeshes(
  shapes: CompositeShape[],
  placements: Placement[],
  heightAt: (x: number, z: number) => number,
): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  const tmp = new Object3D();
  for (const shape of shapes) {
    const im = new InstancedMesh(shape.geom, shape.mat, placements.length);
    im.frustumCulled = true;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const y = heightAt(p.x, p.z);
      tmp.position.set(p.x, y, p.z);
      tmp.rotation.set(p.tilt, p.rotY, 0);
      tmp.scale.set(p.scale, p.scale, p.scale);
      tmp.updateMatrix();

      // Apply local offset by composing matrices.
      shape.offset.updateMatrix();
      const m = tmp.matrix.clone().multiply(shape.offset.matrix);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    meshes.push(im);
  }
  return meshes;
}

function stoneMat(hex: number, rough = 0.95): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(hex),
    roughness: rough,
    metalness: 0,
  });
}

// Shared geometries (cheap memory, fewer GL uploads).
const G = {
  tombBase: new BoxGeometry(0.9, 0.25, 0.4),
  tombSlab: new BoxGeometry(0.7, 1.2, 0.18),
  tombCap: new BoxGeometry(0.85, 0.18, 0.3),
  wall: new BoxGeometry(3, 4, 0.5),
  wallShort: new BoxGeometry(3, 2.4, 0.5),
  wallTall: new BoxGeometry(3, 5, 0.5),
  trunk: new CylinderGeometry(0.2, 0.3, 4, 6),
  branchA: new CylinderGeometry(0.08, 0.16, 2.2, 5),
  branchB: new CylinderGeometry(0.07, 0.14, 1.8, 5),
  pillar: new BoxGeometry(1, 6, 1),
  pillarCap: new ConeGeometry(0.85, 1.0, 4),
  mausoBase: new BoxGeometry(3, 2, 3),
  mausoRoof: new ConeGeometry(2.4, 1.6, 4),
  mausoDoor: new BoxGeometry(1, 1.4, 0.2),
  pathStone: new BoxGeometry(0.9, 0.1, 0.6),
};

const M = {
  stoneA: stoneMat(0x575260),
  stoneB: stoneMat(0x6a6470),
  stoneDark: stoneMat(0x3d3a44),
  bark: stoneMat(0x2a1e1a, 0.98),
  cobble: stoneMat(0x40404a, 1.0),
};

function offset(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): Object3D {
  const o = new Object3D();
  o.position.set(x, y, z);
  o.rotation.set(0, ry, 0);
  o.scale.set(sx, sy, sz);
  return o;
}

export interface BuiltProps {
  group: Group;
  torchPositions: { x: number; y: number; z: number }[];
}

export function buildProps(heightAt: (x: number, z: number) => number): BuiltProps {
  const root = new Group();
  root.name = 'gothic-props';

  const rng = makeRng(PROPS_SEED);
  const torchPositions: { x: number; y: number; z: number }[] = [];

  // Tombstones — main density.
  const tombs = generatePlacements({ count: 150, minDist: 1.6, clusterBias: 0.4, rng });
  for (const im of makeCompositeInstancedMeshes(
    [
      { geom: G.tombBase, mat: M.stoneA, offset: offset(0, 0.125, 0) },
      { geom: G.tombSlab, mat: M.stoneB, offset: offset(0, 0.85, 0) },
      { geom: G.tombCap, mat: M.stoneA, offset: offset(0, 1.55, 0) },
    ],
    tombs,
    heightAt,
  )) root.add(im);

  // Ruined walls — clustered (use cluster bias).
  const wallRng = makeRng(PROPS_SEED + 1);
  const walls: Placement[] = [];
  // Build clusters of 3-5 segments.
  const clusterCount = 10;
  for (let c = 0; c < clusterCount; c++) {
    // pick a cluster center radially.
    const r = Math.sqrt(wallRng()) * (WORLD_R - 20);
    const a = wallRng() * Math.PI * 2;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    if (Math.hypot(cx, cz) < CLEAR_RADIUS + 4) continue;
    const segs = 3 + Math.floor(wallRng() * 3);
    const baseRot = wallRng() * Math.PI * 2;
    for (let s = 0; s < segs; s++) {
      const angle = baseRot + s * (Math.PI / 4) * (wallRng() - 0.5) + s * 0.4;
      const dist = s * 2.6 + (wallRng() - 0.5) * 0.6;
      const x = cx + Math.cos(angle) * dist;
      const z = cz + Math.sin(angle) * dist;
      walls.push({
        x,
        z,
        rotY: angle + Math.PI / 2,
        scale: 0.85 + wallRng() * 0.4,
        tilt: (wallRng() - 0.5) * 0.1,
      });
    }
  }
  // 3 height variants by subset.
  const wallH: Placement[][] = [[], [], []];
  for (let i = 0; i < walls.length; i++) wallH[i % 3].push(walls[i]);
  const wallGeoms = [G.wall, G.wallShort, G.wallTall];
  const wallYOff = [2, 1.2, 2.5];
  for (let i = 0; i < 3; i++) {
    const im = new InstancedMesh(wallGeoms[i], M.stoneDark, wallH[i].length);
    const tmp = new Object3D();
    for (let j = 0; j < wallH[i].length; j++) {
      const p = wallH[i][j];
      const y = heightAt(p.x, p.z);
      tmp.position.set(p.x, y + wallYOff[i], p.z);
      tmp.rotation.set(p.tilt, p.rotY, 0);
      tmp.scale.set(p.scale, p.scale, p.scale);
      tmp.updateMatrix();
      im.setMatrixAt(j, tmp.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
  }

  // Dead trees — twisted trunks + a few branches.
  const trees = generatePlacements({ count: 60, minDist: 4, clusterBias: 0.3, rng: makeRng(PROPS_SEED + 2) });
  for (const im of makeCompositeInstancedMeshes(
    [
      { geom: G.trunk, mat: M.bark, offset: offset(0, 2, 0) },
      { geom: G.branchA, mat: M.bark, offset: offset(0.4, 3.2, 0.1, 1, 1, 1, 0.6) },
      { geom: G.branchB, mat: M.bark, offset: offset(-0.35, 3.5, -0.15, 1, 1, 1, -0.7) },
    ],
    trees,
    heightAt,
  )) {
    // Trees use longer scale variance.
    root.add(im);
  }

  // Stone pillars / obelisks.
  const pillars = generatePlacements({ count: 25, minDist: 5, rng: makeRng(PROPS_SEED + 3) });
  for (const im of makeCompositeInstancedMeshes(
    [
      { geom: G.pillar, mat: M.stoneA, offset: offset(0, 3, 0) },
      { geom: G.pillarCap, mat: M.stoneB, offset: offset(0, 6.5, 0) },
    ],
    pillars,
    heightAt,
  )) root.add(im);

  // Mausoleums.
  const mausos = generatePlacements({ count: 15, minDist: 8, rng: makeRng(PROPS_SEED + 4) });
  for (const im of makeCompositeInstancedMeshes(
    [
      { geom: G.mausoBase, mat: M.stoneDark, offset: offset(0, 1, 0) },
      { geom: G.mausoRoof, mat: M.stoneA, offset: offset(0, 2.8, 0) },
      { geom: G.mausoDoor, mat: stoneMat(0x14121a), offset: offset(0, 0.7, 1.45) },
    ],
    mausos,
    heightAt,
  )) root.add(im);

  // Cobblestone path strips — radial paths from origin.
  const pathPlacements: Placement[] = [];
  const pathArmCount = 4;
  for (let arm = 0; arm < pathArmCount; arm++) {
    const baseAngle = (arm / pathArmCount) * Math.PI * 2 + 0.3;
    for (let step = 1; step < 28; step++) {
      const r = step * 1.2 + 4;
      // small wobble to feel hand-laid
      const ang = baseAngle + Math.sin(r * 0.18) * 0.06;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      // two stones side by side
      const perp = ang + Math.PI / 2;
      for (let side = -1; side <= 1; side += 2) {
        const ox = x + Math.cos(perp) * 0.45 * side;
        const oz = z + Math.sin(perp) * 0.45 * side;
        pathPlacements.push({
          x: ox,
          z: oz,
          rotY: ang + (Math.random() - 0.5) * 0.15,
          scale: 0.85 + Math.random() * 0.3,
          tilt: 0,
        });
      }
    }
  }
  {
    const im = new InstancedMesh(G.pathStone, M.cobble, pathPlacements.length);
    const tmp = new Object3D();
    for (let i = 0; i < pathPlacements.length; i++) {
      const p = pathPlacements[i];
      const y = heightAt(p.x, p.z) + 0.05;
      tmp.position.set(p.x, y, p.z);
      tmp.rotation.set(0, p.rotY, 0);
      tmp.scale.set(p.scale, 1, p.scale);
      tmp.updateMatrix();
      im.setMatrixAt(i, tmp.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
  }

  // Pick torch positions: 8 spread across landmark-ish points (near a few mausoleums + ring).
  const torchCount = 8;
  for (let i = 0; i < torchCount; i++) {
    let x = 0;
    let z = 0;
    if (i < mausos.length && i < 4) {
      // co-locate with first 4 mausoleums.
      const m = mausos[i];
      const off = 1.8;
      const ang = m.rotY;
      x = m.x + Math.cos(ang) * off;
      z = m.z + Math.sin(ang) * off;
    } else {
      // ring around hub.
      const ang = ((i - 4) / 4) * Math.PI * 2 + 0.4;
      const r = 14;
      x = Math.cos(ang) * r;
      z = Math.sin(ang) * r;
    }
    torchPositions.push({ x, y: heightAt(x, z) + 1.6, z });
  }

  return { group: root, torchPositions };
}
