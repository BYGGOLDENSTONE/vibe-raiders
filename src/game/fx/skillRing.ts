// Expanding ground ring for skill casts. Pooled ring meshes with shader-driven fade.

import {
  AdditiveBlending,
  DoubleSide,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Color,
} from 'three';
import type { Scene } from 'three';

const POOL_SIZE = 8;
const LIFETIME = 0.55;
const START_RADIUS = 0.4;
const END_RADIUS = 3.2;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uEdge;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(uEdge - 0.15, uEdge, r) * (1.0 - smoothstep(uEdge, uEdge + 0.05, r));
    gl_FragColor = vec4(uColor, ring * uAlpha);
  }
`;

interface RingSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
}

export interface SkillRingFx {
  spawn(x: number, y: number, z: number, hexColor: number): void;
  update(realDt: number): void;
}

const _color = new Color();

export function createSkillRingFx(scene: Scene): SkillRingFx {
  const slots: RingSlot[] = [];
  const geom = new RingGeometry(0, 1, 48); // we'll scale uniformly via mesh.scale

  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xc8a060) },
        uAlpha: { value: 0 },
        uEdge: { value: 0.95 },
      },
    });
    const mesh = new Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    mesh.scale.setScalar(0.001);
    mesh.visible = false;
    mesh.renderOrder = 998;
    scene.add(mesh);
    slots.push({ mesh, mat, active: false, age: 0 });
  }

  function find(): RingSlot {
    for (const s of slots) if (!s.active) return s;
    let oldest = slots[0]!;
    for (const s of slots) if (s.age > oldest.age) oldest = s;
    return oldest;
  }

  return {
    spawn(x, y, z, hexColor) {
      const s = find();
      s.active = true;
      s.age = 0;
      s.mesh.position.set(x, y + 0.05, z);
      s.mesh.scale.setScalar(START_RADIUS);
      s.mesh.visible = true;
      _color.setHex(hexColor);
      (s.mat.uniforms.uColor!.value as Color).copy(_color);
      s.mat.uniforms.uAlpha!.value = 1;
    },
    update(realDt) {
      for (const s of slots) {
        if (!s.active) continue;
        s.age += realDt;
        if (s.age >= LIFETIME) {
          s.active = false;
          s.mesh.visible = false;
          continue;
        }
        const t = s.age / LIFETIME;
        const radius = START_RADIUS + (END_RADIUS - START_RADIUS) * t;
        s.mesh.scale.setScalar(radius);
        s.mat.uniforms.uAlpha!.value = (1 - t) * 0.85;
      }
    },
  };
}
