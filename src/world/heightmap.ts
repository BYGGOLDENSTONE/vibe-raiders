// Procedural heightmap for the 400x400m world.
// Defines biome regions, a sampleable groundHeight(x,z), and a vertex-colored
// terrain mesh. Smooth transitions between regions via smoothstep blends.

import {
  BufferAttribute,
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { PALETTE } from './palette';

// World layout (size 400):
//   X axis: -200 .. +200 (east is +X)
//   Z axis: -200 .. +200 (south is +Z)
//
// Quadrants (approx), all centered around 0:
//   NW (city)        : x < 0, z < 0
//   NE (industrial)  : x > 0, z < 0
//   SW (dam)         : x < 0, z > 0  (river bed dips below ground level)
//   SE (forest)      : x > 0, z > 0
//   E ridge (mountain): x near +200, full z range, on top of NE/SE
//
// The mountain strip sits on the eastern edge x > +130, terraced.

const SIZE = 400;
const HALF = SIZE / 2;

// ----------------- helpers -----------------

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Cheap deterministic value-noise from x,z (no Math.random — uses sin hashing).
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  const ux = xf * xf * (3 - 2 * xf);
  const uz = zf * zf * (3 - 2 * zf);
  return (
    a * (1 - ux) * (1 - uz) +
    b * ux * (1 - uz) +
    c * (1 - ux) * uz +
    d * ux * uz
  );
}

function fbm(x: number, z: number, octaves: number): number {
  let total = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / norm;
}

// ----------------- region masks -----------------

// Each region returns a [0..1] mask. They need not sum to 1 — we use them as
// weights and combine the heights additively with falloffs.

function maskCity(x: number, z: number): number {
  // NW quadrant, smooth fade away from the corner.
  const ix = smoothstep(20, -120, x);   // 1 deep in west, 0 east of x=20
  const iz = smoothstep(20, -120, z);
  return ix * iz;
}

function maskIndustrial(x: number, z: number): number {
  const ix = smoothstep(-20, 100, x);
  const iz = smoothstep(20, -120, z);
  return ix * iz;
}

function maskDam(x: number, z: number): number {
  const ix = smoothstep(20, -120, x);
  const iz = smoothstep(-20, 100, z);
  return ix * iz;
}

function maskForest(x: number, z: number): number {
  const ix = smoothstep(-20, 100, x);
  const iz = smoothstep(-20, 100, z);
  return ix * iz;
}

// Mountain ridge on the east edge — overrides the eastern slice.
function maskMountain(x: number, _z: number): number {
  return smoothstep(120, 180, x);
}

// ----------------- per-biome heights -----------------

function heightCity(x: number, z: number): number {
  return (valueNoise(x * 0.05, z * 0.05) - 0.5) * 0.6;
}

function heightIndustrial(x: number, z: number): number {
  // Mostly flat with subtle bumps near factory center (~ x=80, z=-80).
  const bump = Math.exp(-(((x - 80) ** 2 + (z + 80) ** 2) / (60 * 60))) * 0.4;
  return (valueNoise(x * 0.05, z * 0.05) - 0.5) * 0.4 + bump;
}

// Dam wall sits at z = +30 spanning x=[-100..-20]. Behind it (z>30) is the dry valley.
const DAM_WALL_Z = 30;
const DAM_FLOOR_DEPTH = -15;
const DAM_X_MIN = -160;
const DAM_X_MAX = -20;

function heightDam(x: number, z: number): number {
  // In front of the dam (z < DAM_WALL_Z): mostly flat low ground.
  // Behind (z > DAM_WALL_Z + ~3): bowl-like valley going to -15 m.
  if (z < DAM_WALL_Z) {
    return (valueNoise(x * 0.05, z * 0.05) - 0.5) * 0.6;
  }
  // In the valley.
  const valleyT = smoothstep(DAM_WALL_Z + 2, DAM_WALL_Z + 35, z);
  // X-direction bowl: deeper near center of x range.
  const xMid = (DAM_X_MIN + DAM_X_MAX) * 0.5;
  const xWidth = (DAM_X_MAX - DAM_X_MIN) * 0.5;
  const xFromCenter = Math.abs(x - xMid) / xWidth;
  const xBowl = 1 - Math.min(1, xFromCenter * xFromCenter);
  const depth = DAM_FLOOR_DEPTH * valleyT * (0.4 + 0.6 * xBowl);
  // small noise.
  return depth + (valueNoise(x * 0.07, z * 0.07) - 0.5) * 0.4;
}

function heightForest(x: number, z: number): number {
  // Rolling 0..3 m hills.
  return fbm(x * 0.025, z * 0.025, 3) * 3.0;
}

function heightMountain(x: number, _z: number): number {
  // Terraced steps from x=130 (~+5m) to x=200 (~+25m).
  // Plateaus at: 130-145 (5m), 145-160 (12m), 160-180 (18m), 180-200 (25m).
  const t = smoothstep(130, 200, x);
  // Quantize into 4 steps with smooth ramps between.
  const stepHeights = [5, 12, 18, 25];
  const stepEdges = [130, 145, 160, 180, 200];
  let h = 0;
  for (let i = 0; i < stepHeights.length; i++) {
    const e0 = stepEdges[i];
    const e1 = stepEdges[i + 1];
    const inStep = smoothstep(e0, Math.min(e0 + 8, e1), x) * (1 - smoothstep(e1 - 4, e1, x === e1 ? x : Math.min(x, e1)));
    // simpler: compute height as max contribution
    if (x >= e0) {
      h = Math.max(h, stepHeights[i] * Math.min(1, (x - e0) / 8));
    }
    void inStep;
  }
  // Add some rocky bumpiness.
  h += (valueNoise(x * 0.08, _z * 0.08) - 0.5) * 1.2 * t;
  // Side-to-side variation along z for ridge feel.
  h += Math.sin(_z * 0.04) * 1.0 * t;
  return h;
}

// ----------------- combined height -----------------

export function groundHeight(x: number, z: number): number {
  // Mountain takes over east of x=130.
  const mtnW = maskMountain(x, z);
  if (mtnW > 0.0001) {
    const restW = 1 - mtnW;
    // Pick the secondary region by quadrant for blending into the base.
    // North half = industrial, south half = forest.
    const otherH = z < 0 ? heightIndustrial(x, z) : heightForest(x, z);
    return heightMountain(x, z) * mtnW + otherH * restW;
  }

  // Dam region special-case (negative heights).
  const damW = maskDam(x, z);
  if (damW > 0.5) {
    return heightDam(x, z);
  }

  // Weighted blend of remaining 4.
  const cw = maskCity(x, z);
  const iw = maskIndustrial(x, z);
  const dw = damW;
  const fw = maskForest(x, z);
  const total = cw + iw + dw + fw + 0.0001;

  let h = 0;
  h += heightCity(x, z) * cw;
  h += heightIndustrial(x, z) * iw;
  h += heightDam(x, z) * dw;
  h += heightForest(x, z) * fw;
  return h / total;
}

// ----------------- mesh builder -----------------

export interface HeightmapResult {
  mesh: Mesh;
  groundHeight: (x: number, z: number) => number;
  size: number;
}

export function buildHeightmap(): HeightmapResult {
  const segments = 199; // 200x200 vertex grid
  const geom = new PlaneGeometry(SIZE, SIZE, segments, segments);
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  // Tints based on height + region.
  const tmp = new Color();
  const dirt = new Color(PALETTE.groundDirt);
  const dirtDeep = new Color(PALETTE.groundDirtDeep);
  const dirtPeak = new Color(PALETTE.groundDirtPeak);
  const cConcrete = new Color(PALETTE.groundConcrete);
  const cForest = new Color(PALETTE.groundForest);
  const cMountain = new Color(PALETTE.groundMountain);
  const cDamFloor = new Color(PALETTE.groundDamFloor);

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const h = groundHeight(px, pz);
    pos.setY(i, h);

    // Base color by region weights.
    const cw = maskCity(px, pz);
    const iw = maskIndustrial(px, pz);
    const dw = maskDam(px, pz);
    const fw = maskForest(px, pz);
    const mw = maskMountain(px, pz);
    const total = cw + iw + dw + fw + mw + 0.0001;

    tmp.setRGB(0, 0, 0);
    tmp.r += cConcrete.r * cw + cConcrete.r * iw + cDamFloor.r * dw + cForest.r * fw + cMountain.r * mw;
    tmp.g += cConcrete.g * cw + cConcrete.g * iw + cDamFloor.g * dw + cForest.g * fw + cMountain.g * mw;
    tmp.b += cConcrete.b * cw + cConcrete.b * iw + cDamFloor.b * dw + cForest.b * fw + cMountain.b * mw;
    tmp.r /= total; tmp.g /= total; tmp.b /= total;

    // Mix in dirt with some noise — gives variety.
    const n = valueNoise(px * 0.04, pz * 0.04);
    tmp.lerp(dirt, 0.35 * n);

    // Darken valleys / brighten peaks (fake AO).
    if (h < 0) {
      tmp.lerp(dirtDeep, Math.min(1, -h / 10));
    } else if (h > 5) {
      tmp.lerp(dirtPeak, Math.min(1, (h - 5) / 25));
    }

    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeVertexNormals();

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.02,
  });
  const mesh = new Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'heightmap';

  return { mesh, groundHeight, size: SIZE };
}

// Re-export region helpers for biomes that want to clip to their footprint.
export const REGIONS = {
  city: { minX: -HALF, maxX: 0, minZ: -HALF, maxZ: 0 },
  industrial: { minX: 0, maxX: 130, minZ: -HALF, maxZ: 0 },
  dam: { minX: -HALF, maxX: 0, minZ: 0, maxZ: HALF },
  forest: { minX: 0, maxX: 130, minZ: 0, maxZ: HALF },
  mountain: { minX: 130, maxX: HALF, minZ: -HALF, maxZ: HALF },
} as const;

export const DAM_PARAMS = {
  wallZ: DAM_WALL_Z,
  xMin: DAM_X_MIN,
  xMax: DAM_X_MAX,
  floorDepth: DAM_FLOOR_DEPTH,
};
