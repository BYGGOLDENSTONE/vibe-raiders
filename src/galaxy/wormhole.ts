// Wave 7 — wormhole vortex visual. A spinning swirl billboard placed at the
// star center of every system that is on either end of an active wormhole
// connection (the local empire's T1 home + every T2 system it has claimed,
// plus the same for any remote players in MP). The shader is a simple
// log-spiral pattern modulated by time, additive-blended so it reads as a
// rift in space rather than a solid disk.

import * as THREE from 'three';
import type { SystemHandle } from './system';

export interface WormholeHandle {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

const VORTEX_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 5-arm log spiral. Inner core punched out so the star is still readable, and
// the outer falloff fades to zero so the billboard plane edges don't clip.
const VORTEX_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3  uColorInner;
uniform vec3  uColorOuter;
uniform float uIntensity;
varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;

  float a = atan(p.y, p.x);

  // Two counter-rotating spiral systems for a churn feel.
  float swirlA = sin(a *  5.0 - log(r + 0.05) * 7.5 - uTime * 1.6);
  float swirlB = sin(a *  3.0 + log(r + 0.05) * 4.0 + uTime * 1.1);
  float swirl = (swirlA * 0.65 + swirlB * 0.35) * 0.5 + 0.5;

  // Hollow-centre + soft outer fade.
  float core = smoothstep(0.06, 0.28, r);
  float edge = smoothstep(1.0, 0.62, r);

  // Bright bloomy ring at the lip of the rift.
  float ring = exp(-pow((r - 0.55) * 5.0, 2.0)) * 0.65;

  vec3 col = mix(uColorInner, uColorOuter, r);
  float intensity = (swirl * 1.4 + 0.25 + ring) * core * edge * uIntensity;

  gl_FragColor = vec4(col * intensity, intensity);
}
`;

// Shared geometry — every wormhole uses the same unit plane, scaled per system.
const WORMHOLE_GEO = new THREE.PlaneGeometry(1, 1);

// Build a vortex mesh tinted by the owner color (hex string). The hot-pink /
// magenta tones in the palette desaturate cleanly toward cyan-violet so the
// rift stays readable regardless of who owns the system.
export function makeWormhole(starRadius: number, ownerColor: string): WormholeHandle {
  const group = new THREE.Group();
  const inner = parseColor(ownerColor);
  // Outer color is a cool violet-cyan blend so every rift shares a "deep
  // space" base tone — the inner colour identifies the owner.
  const outer = new THREE.Color(0.45, 0.4, 1.0);

  const mat = new THREE.ShaderMaterial({
    vertexShader: VORTEX_VERT,
    fragmentShader: VORTEX_FRAG,
    uniforms: {
      uTime:       { value: 0 },
      uColorInner: { value: inner },
      uColorOuter: { value: outer },
      uIntensity:  { value: 1.4 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(WORMHOLE_GEO, mat);
  // Vortex sized large enough to wrap the star + read at galaxy distance.
  mesh.scale.setScalar(Math.max(starRadius * 9.0, 6.0));
  group.add(mesh);

  return { group, mesh, material: mat };
}

// Parent the vortex to a system's group at the star core's position. The
// caller is responsible for keeping a reference and disposing on cleanup.
export function attachWormholeToSystem(handle: WormholeHandle, sys: SystemHandle): void {
  // star.core sits at the local origin of the system group; placing the
  // wormhole at (0,0,0) is enough for it to wrap the star.
  handle.group.position.set(0, 0, 0);
  sys.group.add(handle.group);
}

// Per-frame tick — spin the swirl + billboard the plane toward the camera
// so the rift always faces the viewer regardless of view layer.
export function updateWormhole(
  handle: WormholeHandle,
  dt: number,
  cameraPos: THREE.Vector3,
): void {
  handle.material.uniforms.uTime.value += dt;
  handle.mesh.lookAt(cameraPos);
}

export function disposeWormhole(handle: WormholeHandle): void {
  handle.group.removeFromParent();
  handle.material.dispose();
  // Geometry is shared, don't dispose.
}

function parseColor(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  // Boost saturation slightly so the inner core punches through the additive
  // blend without burning to white.
  return c;
}
