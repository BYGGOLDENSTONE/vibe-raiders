// Pooled particle system. One pool per blend mode (additive sparks, normal smoke).
// Uses Points geometry with per-particle color & size attributes for cheap GPU draws.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';
import type { Blending, Scene } from 'three';

const SPARK_POOL_SIZE = 1024;
const SMOKE_POOL_SIZE = 512;
const BURST_POOL_SIZE = 384;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (300.0 / -mv.z);
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float fall = 1.0 - smoothstep(0.0, 0.5, d);
    gl_FragColor = vec4(vColor * fall, vAlpha * fall);
  }
`;

interface ParticleSlot {
  alive: boolean;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  baseSize: number;
  gravity: number;
  drag: number;
  r: number;
  g: number;
  b: number;
}

interface Pool {
  capacity: number;
  positions: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  colors: Float32Array;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  points: Points;
  slots: ParticleSlot[];
  cursor: number;
  liveCount: number;
}

function makePool(scene: Scene, capacity: number, blending: Blending): Pool {
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const colors = new Float32Array(capacity * 3);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new BufferAttribute(alphas, 1));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  // Hide all initially.
  for (let i = 0; i < capacity; i++) sizes[i] = 0;

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 999;
  scene.add(points);

  const slots: ParticleSlot[] = [];
  for (let i = 0; i < capacity; i++) {
    slots.push({
      alive: false,
      vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 0,
      baseSize: 0,
      gravity: 0,
      drag: 0,
      r: 1, g: 1, b: 1,
    });
  }

  return { capacity, positions, sizes, alphas, colors, geometry, material, points, slots, cursor: 0, liveCount: 0 };
}

function acquire(pool: Pool): number {
  // Round-robin cursor; if slot is alive we still overwrite (oldest gets stomped, fine for FX).
  const idx = pool.cursor;
  pool.cursor = (pool.cursor + 1) % pool.capacity;
  if (!pool.slots[idx]!.alive) pool.liveCount++;
  return idx;
}

function spawnAt(
  pool: Pool,
  i: number,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  life: number, size: number,
  r: number, g: number, b: number,
  gravity: number, drag: number,
): void {
  const s = pool.slots[i]!;
  s.alive = true;
  s.vx = vx; s.vy = vy; s.vz = vz;
  s.life = life; s.maxLife = life;
  s.baseSize = size;
  s.gravity = gravity;
  s.drag = drag;
  s.r = r; s.g = g; s.b = b;

  const i3 = i * 3;
  pool.positions[i3] = x;
  pool.positions[i3 + 1] = y;
  pool.positions[i3 + 2] = z;
  pool.sizes[i] = size;
  pool.alphas[i] = 1;
  pool.colors[i3] = r;
  pool.colors[i3 + 1] = g;
  pool.colors[i3 + 2] = b;
}

function tickPool(pool: Pool, dt: number): void {
  if (pool.liveCount === 0) return;
  let posDirty = false;
  let attrDirty = false;
  for (let i = 0; i < pool.capacity; i++) {
    const s = pool.slots[i]!;
    if (!s.alive) continue;
    s.life -= dt;
    if (s.life <= 0) {
      s.alive = false;
      pool.liveCount--;
      pool.sizes[i] = 0;
      pool.alphas[i] = 0;
      attrDirty = true;
      continue;
    }
    // Integrate.
    s.vy -= s.gravity * dt;
    const dragK = Math.max(0, 1 - s.drag * dt);
    s.vx *= dragK;
    s.vy *= dragK;
    s.vz *= dragK;

    const i3 = i * 3;
    pool.positions[i3] += s.vx * dt;
    pool.positions[i3 + 1] += s.vy * dt;
    pool.positions[i3 + 2] += s.vz * dt;

    const t = s.life / s.maxLife;
    pool.alphas[i] = t;
    pool.sizes[i] = s.baseSize * (0.4 + 0.6 * t);
    posDirty = true;
    attrDirty = true;
  }
  if (posDirty) (pool.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  if (attrDirty) {
    (pool.geometry.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
    (pool.geometry.getAttribute('aAlpha') as BufferAttribute).needsUpdate = true;
  }
}

export interface ParticleSystem {
  emitHit(x: number, y: number, z: number, hexColor: number, isCrit: boolean): void;
  emitDeathPuff(x: number, y: number, z: number): void;
  emitLevelUp(x: number, y: number, z: number): void;
  emitSkillCast(x: number, y: number, z: number, hexColor: number): void;
  update(dt: number): void;
}

const _color = new Color();

export function createParticleSystem(scene: Scene): ParticleSystem {
  const sparkPool = makePool(scene, SPARK_POOL_SIZE, AdditiveBlending);
  const smokePool = makePool(scene, SMOKE_POOL_SIZE, NormalBlending);
  const burstPool = makePool(scene, BURST_POOL_SIZE, AdditiveBlending);

  return {
    emitHit(x, y, z, hexColor, isCrit) {
      _color.setHex(hexColor);
      const count = isCrit ? 24 : 12;
      const spread = isCrit ? 7 : 4.5;
      const r = isCrit ? 1.0 : _color.r;
      const g = isCrit ? 0.82 : _color.g;
      const b = isCrit ? 0.25 : _color.b;
      const size = isCrit ? 0.22 : 0.16;
      for (let k = 0; k < count; k++) {
        const i = acquire(sparkPool);
        const theta = Math.random() * Math.PI * 2;
        const phi = (Math.random() - 0.3) * Math.PI * 0.7;
        const speed = spread * (0.5 + Math.random() * 0.8);
        const cphi = Math.cos(phi);
        spawnAt(sparkPool, i,
          x, y, z,
          Math.cos(theta) * cphi * speed,
          Math.sin(phi) * speed + 1.5,
          Math.sin(theta) * cphi * speed,
          0.35 + Math.random() * 0.15,
          size + Math.random() * 0.06,
          r, g, b,
          9.0, 2.5,
        );
      }
    },
    emitDeathPuff(x, y, z) {
      // Dark smoke (normal blending).
      for (let k = 0; k < 20; k++) {
        const i = acquire(smokePool);
        const theta = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 1.5;
        spawnAt(smokePool, i,
          x + (Math.random() - 0.5) * 0.4,
          y + 0.6,
          z + (Math.random() - 0.5) * 0.4,
          Math.cos(theta) * speed * 0.6,
          0.8 + Math.random() * 0.6,
          Math.sin(theta) * speed * 0.6,
          0.7 + Math.random() * 0.4,
          0.5 + Math.random() * 0.3,
          0.18, 0.16, 0.22,
          -1.0, 1.5, // negative gravity = rising smoke
        );
      }
      // Bright pop on top — additive sparks.
      for (let k = 0; k < 8; k++) {
        const i = acquire(sparkPool);
        const theta = Math.random() * Math.PI * 2;
        spawnAt(sparkPool, i,
          x, y + 0.8, z,
          Math.cos(theta) * 3, 1.5 + Math.random() * 1.5, Math.sin(theta) * 3,
          0.25, 0.18,
          1.0, 0.55, 0.25,
          5.0, 3.0,
        );
      }
    },
    emitLevelUp(x, y, z) {
      // ~80 upward gold particles.
      for (let k = 0; k < 80; k++) {
        const i = acquire(burstPool);
        const theta = Math.random() * Math.PI * 2;
        const radial = Math.random() * 1.6;
        spawnAt(burstPool, i,
          x + Math.cos(theta) * radial * 0.3,
          y + 0.2,
          z + Math.sin(theta) * radial * 0.3,
          Math.cos(theta) * radial,
          5 + Math.random() * 4,
          Math.sin(theta) * radial,
          0.9 + Math.random() * 0.5,
          0.18 + Math.random() * 0.08,
          1.0, 0.82, 0.3,
          2.5, 0.8,
        );
      }
    },
    emitSkillCast(x, y, z, hexColor) {
      _color.setHex(hexColor);
      // Small upward swirl at caster.
      for (let k = 0; k < 14; k++) {
        const i = acquire(sparkPool);
        const theta = Math.random() * Math.PI * 2;
        spawnAt(sparkPool, i,
          x + Math.cos(theta) * 0.6,
          y + 0.2 + Math.random() * 0.3,
          z + Math.sin(theta) * 0.6,
          Math.cos(theta) * -0.8,
          1.2 + Math.random() * 1.5,
          Math.sin(theta) * -0.8,
          0.5,
          0.18,
          _color.r, _color.g, _color.b,
          -1.5, 1.5,
        );
      }
    },
    update(dt) {
      tickPool(sparkPool, dt);
      tickPool(smokePool, dt);
      tickPool(burstPool, dt);
    },
  };
}
