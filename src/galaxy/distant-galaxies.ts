import * as THREE from 'three';
import { Rng } from './rng';

// W9 — distant background galaxies. A handful of procedural spiral-galaxy
// billboards float in the skydome shell ~55k units from the camera. Each one
// uses a custom log-spiral fragment shader (bright bulge core + N curved
// arms, soft outer fade), tinted with its own palette so the player feels
// like they're inside one galaxy among many. The whole group follows the
// camera every frame so the galaxies never leave the visible shell.

export interface DistantGalaxiesHandle {
  group: THREE.Group;
  meshes: THREE.Mesh[];
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec3 uCoreColor;
  uniform vec3 uArmColor;
  uniform float uArms;       // arm count (2-6)
  uniform float uTwist;      // log-spiral pitch
  uniform float uIntensity;  // overall brightness multiplier
  uniform float uSeed;       // per-galaxy noise seed

  // Cheap hash-based noise — just for arm density jitter, no fbm needed.
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;

    float angle = atan(uv.y, uv.x);

    // Bright bulge core: gaussian falloff from centre.
    float core = exp(-r * r * 38.0);

    // Log-spiral arms: arm intensity peaks where the angle matches the spiral
    // sweep angle. Using sin^k with high exponent gives sharp, narrow arms.
    float spiralAngle = angle + uTwist * log(r * 8.0 + 0.05);
    float armBand = sin(spiralAngle * uArms) * 0.5 + 0.5;
    armBand = pow(armBand, 6.0);

    // Arms fade in past the bulge and fade out toward the edge.
    float armRing = smoothstep(0.05, 0.18, r) * smoothstep(0.5, 0.22, r);
    float arms = armBand * armRing;

    // Add per-arm dust jitter so the arms aren't uniformly bright.
    float jitter = hash(vec2(floor(spiralAngle * 12.0 + uSeed), floor(r * 24.0)));
    arms *= 0.55 + jitter * 0.85;

    // Soft outer halo around the whole galaxy.
    float halo = exp(-r * r * 12.0) * 0.35;

    vec3 col = uCoreColor * (core * 1.6 + halo) + uArmColor * arms * 1.2;
    float alpha = clamp((core * 1.4 + arms * 0.95 + halo * 0.5) * uIntensity, 0.0, 1.0);

    // Edge fade so the disc never reads as a hard circle against the nebula.
    alpha *= smoothstep(0.5, 0.42, r);

    gl_FragColor = vec4(col * uIntensity, alpha);
  }
`;

interface GalaxyPreset {
  size: number;       // world-space width of the billboard
  // Direction from camera. Normalized; we'll multiply by shellRadius.
  dir: [number, number, number];
  // Arbitrary rotation around the look direction so the spiral axis isn't aligned with world up.
  spin: number;
  // Tilt relative to the look direction — a small offset so each disc is
  // angled differently and not perfectly facing the camera.
  tiltX: number;
  tiltY: number;
  coreColor: [number, number, number];
  armColor: [number, number, number];
  arms: number;
  twist: number;
  intensity: number;
  seed: number;
}

const SHELL_RADIUS = 55000;

// Hand-tuned spread on a sphere around the player + variety of palettes so the
// view never feels symmetrical. 6 galaxies is enough to fill roughly a third of
// the sky at any given camera orientation, plus you usually see 2-3 from any
// particular angle.
const PRESETS: GalaxyPreset[] = [
  {
    size: 18000,
    dir: [ 0.92, 0.18, -0.35],
    spin: 0.4,
    tiltX: 0.6, tiltY: -0.2,
    coreColor: [1.00, 0.88, 0.65],
    armColor:  [0.55, 0.78, 1.00],
    arms: 4, twist: 5.0, intensity: 1.4, seed: 11.0,
  },
  {
    size: 14000,
    dir: [-0.78, 0.22,  0.58],
    spin: 1.7,
    tiltX: -0.4, tiltY: 0.8,
    coreColor: [1.00, 0.72, 0.45],
    armColor:  [0.95, 0.55, 0.90],
    arms: 3, twist: 6.5, intensity: 1.2, seed: 27.0,
  },
  {
    size: 11000,
    dir: [ 0.15, -0.65, -0.74],
    spin: 2.4,
    tiltX: 0.9, tiltY: 0.1,
    coreColor: [0.78, 0.92, 1.00],
    armColor:  [0.45, 0.70, 1.00],
    arms: 5, twist: 4.2, intensity: 1.05, seed: 43.0,
  },
  {
    size: 22000,
    dir: [-0.08, 0.55,  0.83],
    spin: 0.2,
    tiltX: 0.2, tiltY: -0.7,
    coreColor: [1.00, 0.80, 0.55],
    armColor:  [1.00, 0.62, 0.42],
    arms: 2, twist: 7.5, intensity: 1.1, seed: 59.0,
  },
  {
    size: 9000,
    dir: [ 0.62, -0.42,  0.66],
    spin: 1.1,
    tiltX: -0.7, tiltY: -0.4,
    coreColor: [0.85, 1.00, 0.92],
    armColor:  [0.50, 0.95, 0.78],
    arms: 6, twist: 3.6, intensity: 0.95, seed: 71.0,
  },
  {
    size: 13000,
    dir: [-0.62, -0.18, -0.76],
    spin: 2.9,
    tiltX: 0.5, tiltY: 0.55,
    coreColor: [1.00, 0.92, 0.78],
    armColor:  [0.85, 0.50, 1.00],
    arms: 4, twist: 5.8, intensity: 1.15, seed: 89.0,
  },
];

export function buildDistantGalaxies(): DistantGalaxiesHandle {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  // Render last so the discs don't punch through nearer geometry; depth write
  // is off anyway, but the order keeps additive blending visually correct.
  group.renderOrder = -1;

  for (const p of PRESETS) {
    const mesh = makeDistantGalaxy(p);
    group.add(mesh);
    meshes.push(mesh);
  }

  return { group, meshes };
}

function makeDistantGalaxy(p: GalaxyPreset): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(p.size, p.size, 1, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCoreColor: { value: new THREE.Color(p.coreColor[0], p.coreColor[1], p.coreColor[2]) },
      uArmColor:  { value: new THREE.Color(p.armColor[0],  p.armColor[1],  p.armColor[2])  },
      uArms:      { value: p.arms },
      uTwist:     { value: p.twist },
      uIntensity: { value: p.intensity },
      uSeed:      { value: p.seed },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  const dir = new THREE.Vector3(p.dir[0], p.dir[1], p.dir[2]).normalize();
  mesh.position.copy(dir).multiplyScalar(SHELL_RADIUS);
  // Orient the plane so its normal roughly points back toward the origin
  // (camera position offset is added at render time), then rotate around that
  // normal so each disc has its own spiral axis. Adding small tilt offsets
  // keeps the spirals from looking like they're all facing the same way.
  mesh.lookAt(0, 0, 0);
  mesh.rotateZ(p.spin);
  mesh.rotateX(p.tiltX);
  mesh.rotateY(p.tiltY);

  return mesh;
}

// Use the silenced parameter so the linter doesn't yell. Future work could
// re-seed the shader uniforms from RNG, but the hand-tuned presets ship today.
void Rng;
