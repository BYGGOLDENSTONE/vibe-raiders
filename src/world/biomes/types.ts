// Shared types for biome modules.

import type { Scene } from 'three';
import type { Collider } from '../colliders';
import type { Rng } from '../rng';

export interface BiomeRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BiomeOpts {
  scene: Scene;
  rng: Rng;
  region: BiomeRegion;
  groundHeight: (x: number, z: number) => number;
}

export interface BiomeResult {
  colliders: Collider[];
  shelterCandidates: { position: [number, number, number] }[];
  landmarks: { kind: string; position: [number, number, number] }[];
  update?: (t: number) => void;
}
