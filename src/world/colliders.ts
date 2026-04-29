// Pure AABB collision utilities. No scene access, no Math.random.

import type { Vector3 } from 'three';

export interface Collider {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Resolve an XZ overlap between a vertical capsule (radius, height starting at pos.y)
 * and a list of axis-aligned boxes. Mutates pos in place.
 *
 * "Smallest-axis push out" on the XZ plane only. Vertical overlap is required for
 * a push to occur — the capsule's [pos.y, pos.y + height] must overlap [box.min.y, box.max.y].
 */
export function pushOutXZ(
  pos: Vector3,
  radius: number,
  height: number,
  colliders: Collider[],
): void {
  // Iterate a few times so corner cases settle.
  for (let iter = 0; iter < 3; iter++) {
    let resolved = true;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      // Vertical overlap test
      const yMin = pos.y;
      const yMax = pos.y + height;
      if (yMax < c.min[1] || yMin > c.max[1]) continue;

      // Expanded-box test on XZ for a circle of given radius
      const minX = c.min[0] - radius;
      const maxX = c.max[0] + radius;
      const minZ = c.min[2] - radius;
      const maxZ = c.max[2] + radius;
      if (pos.x < minX || pos.x > maxX || pos.z < minZ || pos.z > maxZ) continue;

      // Compute four penetration distances; pick the smallest.
      const dxLeft = pos.x - minX;     // push -x out the left
      const dxRight = maxX - pos.x;    // push +x out the right
      const dzNear = pos.z - minZ;
      const dzFar = maxZ - pos.z;

      let smallest = dxLeft;
      let axis = 0; // 0=-x, 1=+x, 2=-z, 3=+z
      if (dxRight < smallest) { smallest = dxRight; axis = 1; }
      if (dzNear < smallest) { smallest = dzNear; axis = 2; }
      if (dzFar < smallest) { smallest = dzFar; axis = 3; }

      switch (axis) {
        case 0: pos.x = minX; break;
        case 1: pos.x = maxX; break;
        case 2: pos.z = minZ; break;
        case 3: pos.z = maxZ; break;
      }
      resolved = false;
    }
    if (resolved) break;
  }
}

/**
 * Slab-method raycast against a list of AABBs. Returns the nearest hit within maxDist.
 * dir is expected to be reasonably normalized (we don't re-normalize for speed).
 */
export function raycastColliders(
  origin: Vector3,
  dir: Vector3,
  maxDist: number,
  colliders: Collider[],
): { dist: number; collider: Collider } | null {
  let best: { dist: number; collider: Collider } | null = null;

  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;

  // Precompute inverse direction once per axis. Handle parallel rays via large numbers.
  const invX = dx !== 0 ? 1 / dx : Number.POSITIVE_INFINITY;
  const invY = dy !== 0 ? 1 / dy : Number.POSITIVE_INFINITY;
  const invZ = dz !== 0 ? 1 / dz : Number.POSITIVE_INFINITY;

  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];

    let t1 = (c.min[0] - ox) * invX;
    let t2 = (c.max[0] - ox) * invX;
    let tmin = Math.min(t1, t2);
    let tmax = Math.max(t1, t2);

    t1 = (c.min[1] - oy) * invY;
    t2 = (c.max[1] - oy) * invY;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));

    t1 = (c.min[2] - oz) * invZ;
    t2 = (c.max[2] - oz) * invZ;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));

    if (tmax < 0) continue;          // box behind origin
    if (tmin > tmax) continue;       // no intersection
    const hit = tmin >= 0 ? tmin : tmax; // origin inside -> use exit
    if (hit > maxDist) continue;
    if (best === null || hit < best.dist) {
      best = { dist: hit, collider: c };
    }
  }

  return best;
}
