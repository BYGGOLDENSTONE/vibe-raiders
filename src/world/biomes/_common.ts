// Common helpers for biome geometry merging.

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface GeoBucket {
  geos: BufferGeometry[];
}

export function makeBucket(): GeoBucket {
  return { geos: [] };
}

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const _m = new Matrix4();

/** Push a transformed Box into a bucket. */
export function addBox(
  bucket: GeoBucket,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotY: number = 0,
  rotX: number = 0,
  rotZ: number = 0,
): void {
  const g = new BoxGeometry(w, h, d);
  _e.set(rotX, rotY, rotZ);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  bucket.geos.push(g);
}

/** Push a transformed cylinder (vertical by default — orient via rotations). */
export function addCylinder(
  bucket: GeoBucket,
  rTop: number, rBot: number, h: number, segs: number,
  x: number, y: number, z: number,
  rotY: number = 0,
  rotX: number = 0,
  rotZ: number = 0,
): void {
  const g = new CylinderGeometry(rTop, rBot, h, segs);
  _e.set(rotX, rotY, rotZ);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  bucket.geos.push(g);
}

/** Merge a bucket and add the resulting Mesh to `parent`. Disposes input geos. */
export function flushBucket(
  parent: { add: (m: Mesh) => unknown },
  bucket: GeoBucket,
  mat: MeshStandardMaterial,
  ownedGeos: BufferGeometry[],
  cast = true,
  receive = true,
): Mesh | null {
  if (bucket.geos.length === 0) return null;
  const merged = mergeGeometries(bucket.geos, false);
  for (const g of bucket.geos) g.dispose();
  bucket.geos.length = 0;
  if (!merged) return null;
  ownedGeos.push(merged);
  const mesh = new Mesh(merged, mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}
