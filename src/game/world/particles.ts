// Ambient ember particles: 1500 Points drifting upward with slight wind.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
} from 'three';
import { TUNING } from '../constants';
import type { World } from '../../core/world';

const PARTICLE_COUNT = 1500;
const SPAWN_RADIUS = TUNING.worldRadius * 0.85;
const HEIGHT_MIN = 0.2;
const HEIGHT_MAX = 18;

export function buildEmberParticles(world: World): Points {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * SPAWN_RADIUS;
    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = HEIGHT_MIN + Math.random() * (HEIGHT_MAX - HEIGHT_MIN);
    positions[i * 3 + 2] = Math.sin(a) * r;

    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.3;
    velocities[i * 3 + 1] = 0.25 + Math.random() * 0.6; // upward
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));

  const mat = new PointsMaterial({
    color: 0xff8a40,
    size: 0.18,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new Points(geom, mat);
  points.name = 'embers';
  points.frustumCulled = false;

  // Drift system.
  const posAttr = geom.attributes.position as BufferAttribute;
  world.addSystem((_w, ctx) => {
    const dt = ctx.dt;
    const t = ctx.elapsed;
    const arr = posAttr.array as Float32Array;
    const windX = Math.sin(t * 0.2) * 0.4;
    const windZ = Math.cos(t * 0.17) * 0.3;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ix = i * 3;
      arr[ix + 0] += (velocities[ix + 0] + windX) * dt;
      arr[ix + 1] += velocities[ix + 1] * dt;
      arr[ix + 2] += (velocities[ix + 2] + windZ) * dt;

      // Recycle if above ceiling or out of radius.
      if (arr[ix + 1] > HEIGHT_MAX || arr[ix + 0] * arr[ix + 0] + arr[ix + 2] * arr[ix + 2] > SPAWN_RADIUS * SPAWN_RADIUS) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * SPAWN_RADIUS;
        arr[ix + 0] = Math.cos(a) * r;
        arr[ix + 1] = HEIGHT_MIN;
        arr[ix + 2] = Math.sin(a) * r;
      }
    }
    posAttr.needsUpdate = true;
  });

  return points;
}
