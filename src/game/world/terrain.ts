// Displaced ground plane with vertex colors. Heights queried later by props.

import {
  BufferAttribute,
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { COLORS, TUNING } from '../constants';
import { fbm2D } from './rng';

export interface Terrain {
  mesh: Mesh;
  heightAt: (x: number, z: number) => number;
}

const TERRAIN_SEED = 1337;
const NOISE_SCALE = 0.012;
const AMPLITUDE = 1.6;

function rawHeight(x: number, z: number): number {
  // Base rolling hills.
  const big = fbm2D(x * NOISE_SCALE, z * NOISE_SCALE, TERRAIN_SEED, 3);
  // Subtle high-freq grit.
  const small = fbm2D(x * NOISE_SCALE * 4, z * NOISE_SCALE * 4, TERRAIN_SEED + 91, 2) * 0.25;
  return (big + small) * AMPLITUDE;
}

export function buildTerrain(): Terrain {
  const size = TUNING.worldRadius * 2;
  const segs = 96;
  const geom = new PlaneGeometry(size, size, segs, segs);
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  const valley = new Color(0x0d0c14);
  const mid = new Color(COLORS.ground);
  const peak = new Color(0x2a2030);

  let minH = Infinity;
  let maxH = -Infinity;

  // First pass: displacement.
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = rawHeight(x, z);
    heights[i] = h;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
    pos.setY(i, h);
  }

  // Second pass: vertex colors based on relative height.
  const range = maxH - minH || 1;
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (heights[i] - minH) / range; // 0..1
    if (t < 0.5) {
      const k = t * 2;
      tmp.copy(valley).lerp(mid, k);
    } else {
      const k = (t - 0.5) * 2;
      tmp.copy(mid).lerp(peak, k);
    }
    // Slight per-vertex grain so it doesn't feel banded.
    const grain = 0.92 + 0.16 * ((Math.sin(heights[i] * 7.7) + 1) * 0.5);
    colors[i * 3 + 0] = tmp.r * grain;
    colors[i * 3 + 1] = tmp.g * grain;
    colors[i * 3 + 2] = tmp.b * grain;
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeVertexNormals();

  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });

  const mesh = new Mesh(geom, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = false;

  return {
    mesh,
    heightAt: (x: number, z: number) => rawHeight(x, z),
  };
}
