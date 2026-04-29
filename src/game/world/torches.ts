// Flickering torches: PointLight + emissive cylinder mesh + system to wobble intensity.

import {
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
} from 'three';
import type { World } from '../../core/world';

export interface TorchSpec {
  x: number;
  y: number;
  z: number;
}

interface Torch {
  light: PointLight;
  flameMesh: Mesh; // single emissive sphere (per torch — only ~8 of these)
  baseIntensity: number;
  offset: number;
}

export function buildTorches(world: World, specs: TorchSpec[]): Group {
  const root = new Group();
  root.name = 'torches';

  // Shared post geometry instanced.
  const postGeom = new CylinderGeometry(0.08, 0.1, 1.4, 6);
  const postMat = new MeshBasicMaterial({ color: 0x1a1410 });
  const posts = new InstancedMesh(postGeom, postMat, specs.length);
  const tmp = new Object3D();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    tmp.position.set(s.x, s.y - 0.6, s.z);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.set(1, 1, 1);
    tmp.updateMatrix();
    posts.setMatrixAt(i, tmp.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  root.add(posts);

  const torches: Torch[] = [];
  // Flame sphere geometry shared across torches.
  const flameGeom = new SphereGeometry(0.18, 8, 6);
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const baseIntensity = 2.2;
    const light = new PointLight(0xffaa55, baseIntensity, 9, 1.6);
    light.position.set(s.x, s.y + 0.4, s.z);
    root.add(light);

    const flameMat = new MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.95 });
    const flameMesh = new Mesh(flameGeom, flameMat);
    flameMesh.position.set(s.x, s.y + 0.25, s.z);
    root.add(flameMesh);

    torches.push({
      light,
      flameMesh,
      baseIntensity,
      offset: i * 1.37,
    });
  }

  // Flicker system.
  world.addSystem((_w, ctx) => {
    const t = ctx.elapsed;
    for (const tr of torches) {
      const flick =
        0.78 +
        0.22 * Math.sin(t * 8 + tr.offset) +
        0.12 * Math.sin(t * 19.3 + tr.offset * 2.1);
      tr.light.intensity = tr.baseIntensity * flick;
      tr.flameMesh.scale.setScalar(0.85 + 0.25 * flick);
    }
  });

  return root;
}
