// Wave-3 — planet-surface visuals.
//
// Builds a small group of procedural factories anchored to the planet surface
// (rotates with axial spin because it lives under planet.body) plus a swarm of
// emissive drones that ferry between factories. Surface count is driven by the
// number of unlocked mining-rate tiers for the planet's resource; drone count
// by the empire's drone-count level.

import * as THREE from 'three';
import type { PlanetData } from '../galaxy/types';
import type { Empire, EmpireMetrics } from './empire';
import { PLANET_TYPE_RESOURCE, RESOURCE_COLOR } from './types';
import type { ResourceKey } from './types';
import { Rng } from '../galaxy/rng';

const FACTORY_BASE = 3;
const FACTORY_MAX = 9;
const DRONE_BASE = 8;
const DRONE_PER_LEVEL = 6;
const DRONE_BASE_SPEED = 0.45;            // fraction of arc length per second
const DRONE_LOFT = 0.18;                  // peak altitude (relative to planet radius)
const FACTORY_SCALE = 0.025;              // tower height as fraction of planet radius

interface DroneState {
  fromIdx: number;
  toIdx: number;
  t: number;
  speed: number;
}

export interface SurfaceHandle {
  group: THREE.Group;                     // attached to planet.body
  factoryPositions: THREE.Vector3[];      // unit-sphere directions, length = factoryCount
  factoryMeshes: THREE.Object3D[];
  drones: DroneState[];
  droneMeshes: THREE.Mesh[];
  planetRadius: number;
  resource: ResourceKey;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  rng: Rng;
}

function hashStringToInt(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  }
  return h || 1;
}

// Even-ish point distribution on a sphere using a Fibonacci spiral, jittered
// by the RNG so two equal counts on different planets don't share placements.
function distributePointsOnSphere(count: number, rng: Rng): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  const jitter = 0.18;
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i + rng.range(-jitter, jitter);
    const v = new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
    // small radial jitter so the spiral doesn't read mechanical
    v.x += rng.range(-jitter, jitter) * 0.4;
    v.z += rng.range(-jitter, jitter) * 0.4;
    v.normalize();
    out.push(v);
  }
  return out;
}

// Spherical interpolation between two unit vectors. Falls back to lerp when
// vectors are nearly colinear (avoids sin(0) division).
function slerpUnit(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): void {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  const omega = Math.acos(dot);
  if (omega < 1e-4) {
    out.copy(a).lerp(b, t).normalize();
    return;
  }
  const so = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / so;
  const wb = Math.sin(t * omega) / so;
  out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
}

function buildFactoryMesh(
  resource: ResourceKey,
  radius: number,
  rng: Rng,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
): THREE.Object3D {
  const node = new THREE.Group();
  const towerH = radius * FACTORY_SCALE * rng.range(0.85, 1.4);
  const towerW = radius * FACTORY_SCALE * 0.55;
  const towerD = radius * FACTORY_SCALE * 0.55;

  const bodyGeo = new THREE.BoxGeometry(towerW, towerH, towerD);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x1c1f2a });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = towerH * 0.5;
  node.add(body);
  geometries.push(bodyGeo);
  materials.push(bodyMat);

  // Rooftop emissive cap matches the resource colour. Smaller volume to read
  // as a glowing fixture, not paint on the box.
  const capH = towerH * 0.18;
  const capGeo = new THREE.BoxGeometry(towerW * 0.7, capH, towerD * 0.7);
  const capMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(RESOURCE_COLOR[resource]) });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = towerH + capH * 0.5;
  node.add(cap);
  geometries.push(capGeo);
  materials.push(capMat);

  // Antenna for silhouette
  const antH = towerH * rng.range(0.6, 1.2);
  const antGeo = new THREE.CylinderGeometry(towerW * 0.04, towerW * 0.04, antH, 5);
  const antMat = new THREE.MeshBasicMaterial({ color: 0x88a0bb });
  const ant = new THREE.Mesh(antGeo, antMat);
  ant.position.y = towerH + capH + antH * 0.5;
  node.add(ant);
  geometries.push(antGeo);
  materials.push(antMat);

  return node;
}

function orientToNormal(node: THREE.Object3D, normal: THREE.Vector3): void {
  // The factory's local +Y should point along `normal` (planet outward).
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, normal);
  node.quaternion.copy(q);
}

function buildDroneMesh(resource: ResourceKey, radius: number, geometries: THREE.BufferGeometry[], materials: THREE.Material[]): THREE.Mesh {
  const r = radius * 0.008;
  const geo = new THREE.SphereGeometry(r, 8, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(RESOURCE_COLOR[resource]),
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  geometries.push(geo);
  materials.push(mat);
  return mesh;
}

function pickDroneTarget(rng: Rng, current: number, count: number): number {
  if (count <= 1) return 0;
  let next = rng.int(0, count - 1);
  if (next === current) next = (next + 1) % count;
  return next;
}

export function makeSurface(planet: PlanetData, empire: Empire): SurfaceHandle {
  const resource = PLANET_TYPE_RESOURCE[planet.type];
  const seed = hashStringToInt(`${planet.id}|surface`);
  const rng = new Rng(seed);

  const ownedTiers = countOwnedMiningTiers(empire, resource);
  const factoryCount = Math.min(FACTORY_MAX, FACTORY_BASE + ownedTiers);
  const metrics = empire.computeMetrics();
  const droneCount = DRONE_BASE + DRONE_PER_LEVEL * Math.max(0, metrics.droneCount);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const group = new THREE.Group();
  const positions = distributePointsOnSphere(factoryCount, rng);
  const factoryMeshes: THREE.Object3D[] = [];

  for (let i = 0; i < factoryCount; i++) {
    const dir = positions[i]!;
    const node = buildFactoryMesh(resource, planet.radius, rng, geometries, materials);
    node.position.copy(dir).multiplyScalar(planet.radius);
    orientToNormal(node, dir);
    group.add(node);
    factoryMeshes.push(node);
  }

  // Drones — pre-seed each with a from/to pair and a phase offset so they
  // don't all reach their targets at the same instant.
  const drones: DroneState[] = [];
  const droneMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < droneCount; i++) {
    const fromIdx = rng.int(0, factoryCount - 1);
    const toIdx = pickDroneTarget(rng, fromIdx, factoryCount);
    drones.push({
      fromIdx,
      toIdx,
      t: rng.next(),
      speed: DRONE_BASE_SPEED * rng.range(0.75, 1.3),
    });
    const m = buildDroneMesh(resource, planet.radius, geometries, materials);
    group.add(m);
    droneMeshes.push(m);
  }

  return {
    group,
    factoryPositions: positions,
    factoryMeshes,
    drones,
    droneMeshes,
    planetRadius: planet.radius,
    resource,
    geometries,
    materials,
    rng,
  };
}

export function updateSurface(h: SurfaceHandle, dt: number, metrics: EmpireMetrics): void {
  const speedMul = Math.max(0.2, metrics.droneSpeed);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < h.drones.length; i++) {
    const d = h.drones[i]!;
    d.t += d.speed * speedMul * dt;
    if (d.t >= 1) {
      d.t = 0;
      d.fromIdx = d.toIdx;
      d.toIdx = pickDroneTarget(h.rng, d.fromIdx, h.factoryPositions.length);
    }
    const a = h.factoryPositions[d.fromIdx]!;
    const b = h.factoryPositions[d.toIdx]!;
    slerpUnit(a, b, d.t, tmp);
    const loft = Math.sin(Math.PI * d.t) * DRONE_LOFT;
    const r = h.planetRadius * (1 + loft);
    h.droneMeshes[i]!.position.set(tmp.x * r, tmp.y * r, tmp.z * r);
  }
}

export function disposeSurface(h: SurfaceHandle): void {
  if (h.group.parent) h.group.parent.remove(h.group);
  for (const g of h.geometries) g.dispose();
  for (const m of h.materials) m.dispose();
  h.geometries.length = 0;
  h.materials.length = 0;
  h.factoryMeshes.length = 0;
  h.droneMeshes.length = 0;
  h.drones.length = 0;
}

function countOwnedMiningTiers(empire: Empire, resource: ResourceKey): number {
  let n = 0;
  for (let t = 1; t <= 6; t++) {
    if (empire.hasNode(`prod-${resource}-rate-${t}`)) n++;
  }
  return n;
}

// Cheap probe used by the host to decide whether the surface needs rebuilding
// (i.e. only when factory or drone count actually changed). Re-running
// makeSurface on every empire emit would otherwise leak GC pressure.
export function surfaceConfig(empire: Empire, planet: PlanetData): { factoryCount: number; droneCount: number } {
  const resource = PLANET_TYPE_RESOURCE[planet.type];
  const ownedTiers = countOwnedMiningTiers(empire, resource);
  const factoryCount = Math.min(FACTORY_MAX, FACTORY_BASE + ownedTiers);
  const droneCount = DRONE_BASE + DRONE_PER_LEVEL * Math.max(0, empire.computeMetrics().droneCount);
  return { factoryCount, droneCount };
}
