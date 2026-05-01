// W9 — galaxy "bulge" billboard. Each playable galaxy gets one of these placed
// at its world position so it reads as a procedural spiral disc when viewed
// from universe distance. As the camera approaches, the bulge fades out and
// the actual star systems take over.
//
// Reuses the same log-spiral fragment shader pattern as distant-galaxies.ts
// but driven by per-galaxy palette uniforms (arms, twist, colours) so each
// galaxy looks distinct.

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

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec3 uCoreColor;
  uniform vec3 uArmColor;
  uniform float uArms;
  uniform float uTwist;
  uniform float uIntensity;
  uniform float uSeed;

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
    float core = exp(-r * r * 38.0);

    float spiralAngle = angle + uTwist * log(r * 8.0 + 0.05);
    float armBand = sin(spiralAngle * uArms) * 0.5 + 0.5;
    armBand = pow(armBand, 6.0);

    float armRing = smoothstep(0.05, 0.18, r) * smoothstep(0.5, 0.22, r);
    float arms = armBand * armRing;

    float jitter = hash(vec2(floor(spiralAngle * 12.0 + uSeed), floor(r * 24.0)));
    arms *= 0.55 + jitter * 0.85;

    float halo = exp(-r * r * 12.0) * 0.35;

    vec3 col = uCoreColor * (core * 1.6 + halo) + uArmColor * arms * 1.2;
    float alpha = clamp((core * 1.4 + arms * 0.95 + halo * 0.5) * uIntensity, 0.0, 1.0);

    alpha *= smoothstep(0.5, 0.42, r);

    gl_FragColor = vec4(col * uIntensity, alpha);
  }
`;

const BULGE_GEO = new THREE.PlaneGeometry(1, 1, 1, 1);

export function makeBulge(galaxy: GalaxyData): BulgeHandle {
  const group = new THREE.Group();

  // Bulge is sized to roughly match the galaxy's actual extent — so as the
  // camera approaches, the procedural disc lines up with the real systems.
  const size = galaxy.radius * 2.4;

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCoreColor: { value: new THREE.Color(galaxy.palette.bulgeColor[0], galaxy.palette.bulgeColor[1], galaxy.palette.bulgeColor[2]) },
      uArmColor:  { value: new THREE.Color(galaxy.palette.armColor[0], galaxy.palette.armColor[1], galaxy.palette.armColor[2]) },
      uArms:      { value: galaxy.palette.arms },
      uTwist:     { value: galaxy.palette.twist },
      uIntensity: { value: 1.4 },
      uSeed:      { value: hash(galaxy.id) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(BULGE_GEO, mat);
  mesh.scale.setScalar(size);
  mesh.frustumCulled = false;
  // Apply tilt so the disc lies on a unique plane — universe view shows real
  // 3D angles between galaxies.
  mesh.rotation.x = galaxy.tilt[0];
  mesh.rotation.y = galaxy.tilt[1];
  mesh.rotation.z = galaxy.tilt[2];
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

// Per-frame: billboard the bulge toward the camera AND fade its intensity
// based on how far the camera is. When the camera is way outside the galaxy
// (universe view), bulge is fully bright. Once camera is inside the galaxy
// (zoom < radius * 1.5), it fades to zero so the real systems take over.
export function updateBulge(b: BulgeHandle, cameraPos: THREE.Vector3, galaxyWorldPos: THREE.Vector3): void {
  // Billboard — preserve the tilt rotation though, so each galaxy keeps its
  // unique-angle look. Cheap trick: lookAt rotates the whole object, so we
  // re-apply the tilt as a child? Simpler: don't billboard. The discs already
  // have 3D tilts that read as different orientations.
  // (No-op here; render order keeps it visible.)

  const dist = cameraPos.distanceTo(galaxyWorldPos);
  // Fade band: full intensity at dist > 6× radius; zero at dist < 1.8× radius.
  // Tuned so the bulge is invisible as soon as the player enters galaxy view
  // of that galaxy (camera ≈ 1.8× radius from centre) and is fully bright in
  // universe view (camera ≈ 14× radius for Milky Way).
  const farD = b.galaxyRadius * 6.0;
  const nearD = b.galaxyRadius * 1.8;
  let intensity = (dist - nearD) / Math.max(0.001, farD - nearD);
  if (intensity > 1) intensity = 1;
  if (intensity < 0) intensity = 0;
  b.material.uniforms.uIntensity.value = intensity * 1.4;
  b.mesh.visible = intensity > 0.02;
  b.pickProxy.visible = intensity > 0.5;  // only clickable from far enough
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
