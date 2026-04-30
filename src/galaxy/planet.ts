import * as THREE from 'three';
import type { PlanetData, MoonData } from './types';
import { PLANET_TYPE_INT, PLANET_VERT, PLANET_FRAG, MOON_VERT, MOON_FRAG } from './shaders';

export interface PlanetHandle {
  data: PlanetData;
  group: THREE.Group;        // orbit pivot (rotates around star)
  pivot: THREE.Group;        // body anchor (after orbit position)
  body: THREE.Group;         // axial tilt + rotation node
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  ring: THREE.Mesh | null;
  moons: MoonHandle[];
}

export interface MoonHandle {
  data: MoonData;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

const PLANET_GEO_CACHE = new Map<number, THREE.SphereGeometry>();
function planetGeo(segments: number): THREE.SphereGeometry {
  let g = PLANET_GEO_CACHE.get(segments);
  if (!g) {
    g = new THREE.SphereGeometry(1, segments, segments);
    PLANET_GEO_CACHE.set(segments, g);
  }
  return g;
}

const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPosL;
void main() {
  vUv = uv;
  vPosL = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vPosL;
uniform vec3 uColor;
uniform float uInner;
uniform float uOuter;
uniform vec3 uLightDir;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float r = length(vPosL.xy);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);

  // concentric bands of varying density
  float bands = 0.0;
  bands += smoothstep(0.0, 0.02, fract(t * 28.0)) * 0.6;
  bands += hash(floor(t * 14.0)) * 0.7;
  float density = 0.3 + bands * 0.6;
  density *= smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.92, t);

  // simple shadow from planet on the back side (very subtle: dim where light is behind)
  float lit = max(dot(normalize(vec3(0.0, 0.0, 1.0)), uLightDir), 0.2);

  vec3 col = uColor * (0.6 + 0.5 * t);
  gl_FragColor = vec4(col * lit, density);
}
`;

export function makePlanet(data: PlanetData, segments = 48): PlanetHandle {
  const group = new THREE.Group(); // orbit pivot at star
  group.rotation.x = data.orbitTilt;
  // body anchor at orbitRadius
  const pivot = new THREE.Group();
  pivot.position.x = data.orbitRadius;
  group.add(pivot);

  const body = new THREE.Group();
  body.rotation.z = data.axialTilt;
  pivot.add(body);

  const material = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
    uniforms: {
      uTime:       { value: 0 },
      uLightDir:   { value: new THREE.Vector3(1, 0, 0) },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient:    { value: 0.05 },
      uType:       { value: PLANET_TYPE_INT[data.type] },
      uPrimary:    { value: new THREE.Color(...data.primaryColor) },
      uSecondary:  { value: new THREE.Color(...data.secondaryColor) },
      uAccent:     { value: new THREE.Color(...data.accentColor) },
      uSeed:       { value: data.noiseSeed },
    },
  });

  const mesh = new THREE.Mesh(planetGeo(segments), material);
  mesh.scale.setScalar(data.radius);
  mesh.userData = { kind: 'planet', planetId: data.id };
  body.add(mesh);

  let ring: THREE.Mesh | null = null;
  if (data.hasRings) {
    const ringGeo = new THREE.RingGeometry(data.ringInner, data.ringOuter, 96, 1);
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uColor:    { value: new THREE.Color(...data.ringColor) },
        uInner:    { value: data.ringInner },
        uOuter:    { value: data.ringOuter },
        uLightDir: { value: new THREE.Vector3(1, 0, 0) },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    body.add(ring);
  }

  const moons: MoonHandle[] = [];
  for (const m of data.moons) {
    const mh = makeMoon(m, material);
    moons.push(mh);
    body.add(mh.pivot);
    body.add(buildMoonOrbit(m.orbitRadius, m.orbitTilt));
  }

  // Set initial orbit angle
  group.rotation.y = data.orbitPhase;

  return { data, group, pivot, body, mesh, material, ring, moons };
}

function buildMoonOrbit(radius: number, tilt: number): THREE.Line {
  const segs = 64;
  const pts: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.rotation.x = tilt;
  return line;
}

function makeMoon(data: MoonData, _parentMat: THREE.ShaderMaterial): MoonHandle {
  const pivot = new THREE.Group();
  pivot.rotation.x = data.orbitTilt;

  const geo = planetGeo(28);
  const material = new THREE.ShaderMaterial({
    vertexShader: MOON_VERT,
    fragmentShader: MOON_FRAG,
    uniforms: {
      uLightDir:   { value: new THREE.Vector3(1, 0, 0) },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient:    { value: 0.06 },
      uColor:      { value: new THREE.Color(...data.color) },
      uSeed:       { value: (data.orbitPhase + data.orbitRadius) % 100 },
    },
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.x = data.orbitRadius;
  mesh.scale.setScalar(data.radius);
  mesh.userData = { kind: 'moon', moonId: data.id };
  pivot.add(mesh);
  pivot.rotation.y = data.orbitPhase;
  return { data, pivot, mesh, material };
}

export function updatePlanet(
  h: PlanetHandle,
  dt: number,
  starWorldPos: THREE.Vector3,
  starColor: THREE.Color,
  cameraPos: THREE.Vector3,
): void {
  // orbit + spin + animated shaders
  h.group.rotation.y += h.data.orbitSpeed * dt;
  h.body.rotation.y += h.data.rotationSpeed * dt;
  h.material.uniforms.uTime.value += dt;

  // light direction in world space (from planet to star)
  const planetPos = new THREE.Vector3();
  h.body.getWorldPosition(planetPos);
  const dir = starWorldPos.clone().sub(planetPos).normalize();
  h.material.uniforms.uLightDir.value.copy(dir);
  h.material.uniforms.uLightColor.value.copy(starColor);

  if (h.ring) {
    const rmat = h.ring.material as THREE.ShaderMaterial;
    rmat.uniforms.uLightDir.value.copy(dir);
  }

  // moons: orbit + shader light
  const moonPos = new THREE.Vector3();
  for (const m of h.moons) {
    m.pivot.rotation.y += m.data.orbitSpeed * dt;
    m.mesh.getWorldPosition(moonPos);
    const moonDir = starWorldPos.clone().sub(moonPos).normalize();
    m.material.uniforms.uLightDir.value.copy(moonDir);
    m.material.uniforms.uLightColor.value.copy(starColor);
  }

  // suppress unused warnings (camera pos available for future LOD)
  void cameraPos;
}
