// W9 — galaxy "bulge" billboard. Each playable galaxy gets one of these placed
// at its world position so it reads as a procedural spiral disc when viewed
// from universe distance. As the camera approaches, the bulge fades out and
// the actual star systems take over.
//
// W10 perf — the heavy procedural spiral shader is baked ONCE at startup to
// an offscreen 512×512 texture (`prebakeBulgeTexture(renderer)`). Every galaxy
// then uses a cheap per-pixel shader: 1 texture sample × tint color × fade
// intensity. Fragment cost drops from ~30 ops/pixel to ~5 ops/pixel, which
// matters a lot when 100 bulges stack with additive blending in universe view
// or when the active bulge covers the full screen in galaxy view.

import * as THREE from 'three';
import type { GalaxyData } from './types';

export interface BulgeHandle {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  pickProxy: THREE.Mesh;
  galaxyId: string;
  galaxyRadius: number;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Bake-time fragment shader — the original procedural spiral. Runs ONCE per
// template into a render target. Output is a luminance-style texture that
// every galaxy then samples cheaply.
const BAKE_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;

  uniform float uArms;
  uniform float uTwist;
  uniform float uSeed;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv - 0.5;
    float r2 = uv.x * uv.x + uv.y * uv.y;
    if (r2 > 0.25) { gl_FragColor = vec4(0.0); return; }
    float r = sqrt(r2);

    float core = 1.0 / (1.0 + r2 * 38.0);
    float halo = 1.0 / (1.0 + r2 * 12.0) * 0.35;

    float angle = atan(uv.y, uv.x);
    float spiralAngle = angle + uTwist * (r * 8.0 - 1.0);
    float armBand = sin(spiralAngle * uArms) * 0.5 + 0.5;
    float armBand2 = armBand * armBand;
    armBand = armBand2 * armBand2 * armBand2;

    float armRing = smoothstep(0.05, 0.18, r) * smoothstep(0.5, 0.22, r);
    float arms = armBand * armRing;

    float jitter = hash(vec2(floor(spiralAngle * 12.0 + uSeed), floor(r * 24.0)));
    arms *= 0.55 + jitter * 0.85;

    // Pack: R = core+halo (centre brightness), G = arms (rim brightness),
    // B = unused, A = combined alpha for the disc-shaped fade.
    float coreLum = core * 1.6 + halo;
    float armLum  = arms * 1.2;
    float alpha = (core * 1.4 + arms * 0.95 + halo * 0.5);
    alpha *= smoothstep(0.5, 0.42, r);

    gl_FragColor = vec4(coreLum, armLum, 0.0, alpha);
  }
`;

// Runtime fragment shader — cheap. 1 texture sample + per-galaxy tint blend.
const FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;

  uniform sampler2D uTex;
  uniform vec3 uCoreColor;
  uniform vec3 uArmColor;
  uniform float uIntensity;
  uniform float uRotation;

  void main() {
    // Per-galaxy UV rotation so each baked template doesn't read identically.
    vec2 c = vUv - 0.5;
    float ca = cos(uRotation);
    float sa = sin(uRotation);
    vec2 uv = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) + 0.5;

    vec4 t = texture2D(uTex, uv);
    vec3 col = uCoreColor * t.r + uArmColor * t.g;
    float alpha = t.a * uIntensity;
    gl_FragColor = vec4(col * uIntensity, alpha);
  }
`;

const BULGE_GEO = new THREE.PlaneGeometry(1, 1, 1, 1);

// Cached baked texture — built once on first prebake call, reused for every
// galaxy bulge. Variants by arm count keep the templates feeling distinct.
const TEMPLATES: { arms: number; twist: number; seed: number; texture: THREE.Texture | null }[] = [
  { arms: 3, twist: 4.5, seed: 11, texture: null },
  { arms: 4, twist: 5.5, seed: 47, texture: null },
  { arms: 5, twist: 6.0, seed: 83, texture: null },
];

export function prebakeBulgeTextures(renderer: THREE.WebGLRenderer): void {
  if (TEMPLATES[0]!.texture) return; // already baked

  const SIZE = 512;
  const bakeScene = new THREE.Scene();
  const bakeCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 10);
  bakeCam.position.z = 1;

  const prevTarget = renderer.getRenderTarget();
  for (const tpl of TEMPLATES) {
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: {
        uArms:  { value: tpl.arms },
        uTwist: { value: tpl.twist },
        uSeed:  { value: tpl.seed },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(BULGE_GEO, mat);
    bakeScene.clear();
    bakeScene.add(mesh);

    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(bakeScene, bakeCam);

    mat.dispose();
    tpl.texture = target.texture;
  }
  renderer.setRenderTarget(prevTarget);
}

function pickTemplate(galaxy: GalaxyData): THREE.Texture {
  // Pick by the galaxy's preferred arm count so the silhouette roughly
  // matches the palette setting. Closest match wins; falls back to template 0.
  const targetArms = galaxy.palette.arms;
  let best = TEMPLATES[0]!;
  let bestDiff = Infinity;
  for (const t of TEMPLATES) {
    const d = Math.abs(t.arms - targetArms);
    if (d < bestDiff) { best = t; bestDiff = d; }
  }
  if (!best.texture) {
    throw new Error('Bulge textures not baked — call prebakeBulgeTextures(renderer) before buildUniverse');
  }
  return best.texture;
}

export function makeBulge(galaxy: GalaxyData): BulgeHandle {
  const group = new THREE.Group();

  // Bulge is sized to roughly match the galaxy's actual extent — so as the
  // camera approaches, the procedural disc lines up with the real systems.
  const size = galaxy.radius * 2.4;

  // W10 — every galaxy reuses one of the pre-baked spiral templates with a
  // unique tint colour + UV rotation so they all read as distinct discs.
  const baseTexture = pickTemplate(galaxy);
  const rotation = (hash(galaxy.id) / 999.0) * Math.PI * 2;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTex:       { value: baseTexture },
      uCoreColor: { value: new THREE.Color(galaxy.palette.bulgeColor[0], galaxy.palette.bulgeColor[1], galaxy.palette.bulgeColor[2]) },
      uArmColor:  { value: new THREE.Color(galaxy.palette.armColor[0], galaxy.palette.armColor[1], galaxy.palette.armColor[2]) },
      uIntensity: { value: 1.4 },
      uRotation:  { value: rotation },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(BULGE_GEO, mat);
  mesh.scale.setScalar(size);
  mesh.frustumCulled = false;
  // W10 — base orientation is horizontal (lying on the galaxy-local XZ plane,
  // matching the system disk). The galaxy.root group carries the per-galaxy
  // tilt so the bulge stays coplanar with the actual systems no matter how the
  // galaxy is oriented in universe space.
  mesh.rotation.x = -Math.PI / 2;
  group.add(mesh);

  // Pick proxy: invisible sphere at the galaxy centre, big enough to click
  // comfortably from universe view. Matches the bulge size so the visible
  // billboard is the click target.
  const proxyGeo = new THREE.SphereGeometry(galaxy.radius * 0.8, 12, 12);
  const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const pickProxy = new THREE.Mesh(proxyGeo, proxyMat);
  pickProxy.userData.kind = 'galaxy';
  pickProxy.userData.galaxyId = galaxy.id;
  group.add(pickProxy);

  return { group, mesh, material: mat, pickProxy, galaxyId: galaxy.id, galaxyRadius: galaxy.radius };
}

// Per-frame: fade bulge intensity based on camera distance to this galaxy's
// centre. W10 — the bulge stays visible at galaxy-view distance so the
// player still sees the procedural disc behind the actual systems; only fades
// fully when the camera dives into system / planet view of *this* galaxy.
// Other galaxies (camera always far away) stay at full brightness, doubling
// as their click target.
export function updateBulge(b: BulgeHandle, cameraPos: THREE.Vector3, galaxyWorldPos: THREE.Vector3): void {
  const dist = cameraPos.distanceTo(galaxyWorldPos);
  // Fade band:
  //   - dist > 4× radius → full intensity (universe / other-galaxy view)
  //   - dist ≈ 1.8× radius (galaxy view) → ~30 % intensity (visible glow)
  //   - dist < 0.4× radius → 0 (system view, bulge gone so the local scene
  //     dominates)
  const farD = b.galaxyRadius * 4.0;
  const nearD = b.galaxyRadius * 0.4;
  let intensity = (dist - nearD) / Math.max(0.001, farD - nearD);
  if (intensity > 1) intensity = 1;
  if (intensity < 0) intensity = 0;
  b.material.uniforms.uIntensity.value = intensity * 1.4;
  b.mesh.visible = intensity > 0.02;
  // Pick proxy is reachable whenever the bulge is at least faintly bright —
  // covers universe view and "other galaxy" clicks from inside another galaxy.
  b.pickProxy.visible = intensity > 0.25;
}

export function disposeBulge(b: BulgeHandle): void {
  b.material.dispose();
  // Geometry is shared, don't dispose.
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000;
}
