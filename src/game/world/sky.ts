// Starfield dome + billboarded moon disc.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  type PerspectiveCamera,
} from 'three';
import type { World } from '../../core/world';

const STAR_COUNT = 600;
const SKY_RADIUS = 380;

export function buildStarfield(world: World): Points {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const phases = new Float32Array(STAR_COUNT);

  const c = new Color();
  for (let i = 0; i < STAR_COUNT; i++) {
    // Hemisphere dome (y >= 0). Random direction, then push to radius.
    let x = 0;
    let y = 0;
    let z = 0;
    let len = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 0.95 + 0.05;
      z = Math.random() * 2 - 1;
      len = Math.hypot(x, y, z);
    } while (len < 0.001);
    x /= len;
    y /= len;
    z /= len;
    positions[i * 3 + 0] = x * SKY_RADIUS;
    positions[i * 3 + 1] = y * SKY_RADIUS;
    positions[i * 3 + 2] = z * SKY_RADIUS;

    // Color: mostly cool white, occasional pale blue.
    const isBlue = Math.random() < 0.25;
    if (isBlue) c.setRGB(0.7, 0.8, 1.0);
    else c.setRGB(0.95, 0.95, 1.0);
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    phases[i] = Math.random() * Math.PI * 2;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));

  const mat = new PointsMaterial({
    size: 1.4,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });

  const stars = new Points(geom, mat);
  stars.name = 'stars';
  stars.frustumCulled = false;

  // Subtle twinkle by modulating overall opacity.
  world.addSystem((_w, ctx) => {
    mat.opacity = 0.78 + 0.18 * Math.sin(ctx.elapsed * 1.7);
  });

  return stars;
}

export function buildMoon(world: World, camera: PerspectiveCamera): Mesh {
  const geom = new PlaneGeometry(34, 34);
  const mat = new MeshBasicMaterial({
    color: 0xc8d4f0,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
  const moon = new Mesh(geom, mat);
  moon.name = 'moon-disc';
  // Place far in the sky in moonlight direction.
  const dir = { x: 50, y: 80, z: 30 };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const r = SKY_RADIUS * 0.95;
  moon.position.set((dir.x / len) * r, (dir.y / len) * r, (dir.z / len) * r);
  moon.frustumCulled = false;

  // Billboard toward camera.
  world.addSystem(() => {
    moon.lookAt(camera.position);
  });

  return moon;
}
