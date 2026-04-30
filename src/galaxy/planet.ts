import * as THREE from 'three';
import type { PlanetData, MoonData } from './types';
import { PLANET_TYPE_INT, PLANET_VERT, PLANET_FRAG, MOON_VERT, MOON_FRAG } from './shaders';

export interface PlanetHandle {
  data: PlanetData;
  group: THREE.Group;        // orbit-plane frame (omega + tilt baked in)
  pivot: THREE.Group;        // body anchor; position recomputed every frame from true anomaly
  body: THREE.Group;         // axial tilt + rotation node
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  ring: THREE.Mesh | null;
  moons: MoonHandle[];
  orbitAngle: number;        // current true anomaly
}

export interface MoonHandle {
  data: MoonData;
  pivot: THREE.Group;        // orbit-plane frame for the moon (omega + tilt baked in)
  mesh: THREE.Mesh;          // position updated each frame
  material: THREE.ShaderMaterial;
  orbitAngle: number;
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

// Ellipse focused at origin, major axis along +X. omega/tilt baked into a wrapping group.
function buildEllipseLine(
  a: number,
  e: number,
  omega: number,
  tilt: number,
  opacity: number,
  segments: number,
): THREE.Object3D {
  const c = a * e;
  const b = a * Math.sqrt(Math.max(0, 1 - e * e));
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const E = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(E) * a - c, 0, Math.sin(E) * b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  const wrap = new THREE.Group();
  wrap.rotation.order = 'YXZ';
  wrap.rotation.y = omega;
  wrap.rotation.x = tilt;
  wrap.add(line);
  return wrap;
}

function ellipseRadius(a: number, e: number, trueAnomaly: number): number {
  return (a * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly));
}

export function makePlanet(data: PlanetData, segments = 48): PlanetHandle {
  const group = new THREE.Group();
  // omega first (rotate major axis within orbit plane), then tilt (tilt the plane).
  group.rotation.order = 'YXZ';
  group.rotation.y = data.orbitOmega;
  group.rotation.x = data.orbitTilt;

  const pivot = new THREE.Group();
  // Initial position from true anomaly = orbitPhase.
  const r0 = ellipseRadius(data.orbitRadius, data.orbitEccentricity, data.orbitPhase);
  pivot.position.set(r0 * Math.cos(data.orbitPhase), 0, r0 * Math.sin(data.orbitPhase));
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
    const mh = makeMoon(m);
    moons.push(mh);
    body.add(mh.pivot);
    body.add(buildEllipseLine(m.orbitRadius, m.orbitEccentricity, m.orbitOmega, m.orbitTilt, 0.18, 96));
  }

  return {
    data,
    group,
    pivot,
    body,
    mesh,
    material,
    ring,
    moons,
    orbitAngle: data.orbitPhase,
  };
}

function makeMoon(data: MoonData): MoonHandle {
  const pivot = new THREE.Group();
  pivot.rotation.order = 'YXZ';
  pivot.rotation.y = data.orbitOmega;
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
  const r0 = ellipseRadius(data.orbitRadius, data.orbitEccentricity, data.orbitPhase);
  mesh.position.set(r0 * Math.cos(data.orbitPhase), 0, r0 * Math.sin(data.orbitPhase));
  mesh.scale.setScalar(data.radius);
  mesh.userData = { kind: 'moon', moonId: data.id };
  pivot.add(mesh);

  return { data, pivot, mesh, material, orbitAngle: data.orbitPhase };
}

// Advance true anomaly with angular-momentum conservation: dν/dt = n * (a/r)².
function advanceOrbit(angle: number, a: number, e: number, n: number, dt: number): number {
  const r = ellipseRadius(a, e, angle);
  const ratio = a / r;
  return angle + n * ratio * ratio * dt;
}

export function updatePlanet(
  h: PlanetHandle,
  dt: number,
  starWorldPos: THREE.Vector3,
  starColor: THREE.Color,
  cameraPos: THREE.Vector3,
): void {
  const d = h.data;
  h.orbitAngle = advanceOrbit(h.orbitAngle, d.orbitRadius, d.orbitEccentricity, d.orbitSpeed, dt);
  const r = ellipseRadius(d.orbitRadius, d.orbitEccentricity, h.orbitAngle);
  h.pivot.position.set(r * Math.cos(h.orbitAngle), 0, r * Math.sin(h.orbitAngle));

  h.body.rotation.y += d.rotationSpeed * dt;
  h.material.uniforms.uTime.value += dt;

  const planetPos = new THREE.Vector3();
  h.body.getWorldPosition(planetPos);
  const dir = starWorldPos.clone().sub(planetPos).normalize();
  h.material.uniforms.uLightDir.value.copy(dir);
  h.material.uniforms.uLightColor.value.copy(starColor);

  if (h.ring) {
    const rmat = h.ring.material as THREE.ShaderMaterial;
    rmat.uniforms.uLightDir.value.copy(dir);
  }

  const moonPos = new THREE.Vector3();
  for (const m of h.moons) {
    const md = m.data;
    m.orbitAngle = advanceOrbit(m.orbitAngle, md.orbitRadius, md.orbitEccentricity, md.orbitSpeed, dt);
    const mr = ellipseRadius(md.orbitRadius, md.orbitEccentricity, m.orbitAngle);
    m.mesh.position.set(mr * Math.cos(m.orbitAngle), 0, mr * Math.sin(m.orbitAngle));
    m.mesh.getWorldPosition(moonPos);
    const moonDir = starWorldPos.clone().sub(moonPos).normalize();
    m.material.uniforms.uLightDir.value.copy(moonDir);
    m.material.uniforms.uLightColor.value.copy(starColor);
  }

  void cameraPos;
}
