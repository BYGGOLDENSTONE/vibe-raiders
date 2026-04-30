// Wave 4-B — moon outpost + space elevator visuals.
//
// Renders three optional artefacts on the home planet's primary moon:
//   1. Dome   — appears when the `moon-outpost` flag is unlocked. Sits on the
//               moon surface and rotates with the moon (parented to moon.mesh).
//   2. Tether — appears when `space-elevator` is also unlocked. Drawn between
//               the planet centre and the moon, parented to planet.pivot so it
//               follows the planet's orbit but ignores axial spin.
//   3. Shuttles — small emissive points that lerp along the tether.
//
// Endpoints are recomputed each frame because the moon orbits the planet, so
// the tether direction and length change continuously. Geometries are unit-
// height and scaled per frame to avoid rebuilds.
//
// Visibility is toggled externally (only shown while the home system is the
// active layer view, see app.ts) — heavy work is gated by an early-return
// inside updateMoonOutpost when the group is hidden.

import * as THREE from 'three';
import type { PlanetHandle, MoonHandle } from '../galaxy/planet';
import type { Empire } from './empire';
import { RESOURCE_COLOR, MOON_OUTPOST_INCOME } from './types';

const DOME_DIAMETER_FRAC = 0.5;     // dome diameter relative to moon radius (unit-radius mesh)
const DOME_HEIGHT_FRAC = 0.25;      // dome height (radius of half-sphere)
const ANTENNA_LENGTH_FRAC = 0.35;
const TETHER_RADIUS_FRAC = 0.012;   // tether thickness vs planet radius
const SHUTTLE_COUNT = 3;
const SHUTTLE_BASE_SPEED = 0.25;    // fraction of tether length per second
const SHUTTLE_RADIUS_FRAC = 0.018;  // shuttle size vs planet radius

interface ShuttleState {
  t: number;
  speed: number;
  dir: 1 | -1;
}

export interface MoonOutpostHandle {
  planetSideGroup: THREE.Group;     // parented to planet.pivot, holds tether + shuttles
  moonSideGroup: THREE.Group;       // parented to moon.mesh, holds dome
  hasElevator: boolean;
  // Tether artefacts (only present when hasElevator)
  tether: THREE.Mesh | null;
  shuttles: { mesh: THREE.Mesh; state: ShuttleState }[];
  // References needed each frame to recompute tether endpoints
  planet: PlanetHandle;
  moon: MoonHandle;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

// W4-E — outpost moon is the one the player picked via `claimOutpostMoon`.
// Returns null if the chosen moon isn't on this planet (defensive — should not
// happen because we only call into this with a planet that owns the moon).
export function findOutpostMoon(planet: PlanetHandle, moonId: string): MoonHandle | null {
  return planet.moons.find((m) => m.data.id === moonId) ?? null;
}

function buildDome(
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
): THREE.Group {
  const node = new THREE.Group();
  const crystal = new THREE.Color(RESOURCE_COLOR[MOON_OUTPOST_INCOME.resource]);

  // Half-sphere dome (top hemisphere only).
  const domeGeo = new THREE.SphereGeometry(
    DOME_DIAMETER_FRAC * 0.5,
    20,
    14,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.5,
  );
  const domeMat = new THREE.MeshBasicMaterial({
    color: crystal,
    transparent: true,
    opacity: 0.8,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.scale.y = DOME_HEIGHT_FRAC / (DOME_DIAMETER_FRAC * 0.5);
  node.add(dome);
  geometries.push(domeGeo);
  materials.push(domeMat);

  // Dark base ring at the dome's footprint so it reads as planted, not floating.
  const baseGeo = new THREE.CylinderGeometry(
    DOME_DIAMETER_FRAC * 0.55,
    DOME_DIAMETER_FRAC * 0.55,
    DOME_HEIGHT_FRAC * 0.15,
    20,
  );
  const baseMat = new THREE.MeshBasicMaterial({ color: 0x141821 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = DOME_HEIGHT_FRAC * 0.075;
  node.add(base);
  geometries.push(baseGeo);
  materials.push(baseMat);

  // Antenna for silhouette / scale cue.
  const antGeo = new THREE.CylinderGeometry(0.008, 0.008, ANTENNA_LENGTH_FRAC, 5);
  const antMat = new THREE.MeshBasicMaterial({ color: 0xc8d8e8 });
  const ant = new THREE.Mesh(antGeo, antMat);
  ant.position.y = DOME_HEIGHT_FRAC + ANTENNA_LENGTH_FRAC * 0.5;
  node.add(ant);
  geometries.push(antGeo);
  materials.push(antMat);

  return node;
}

function buildTether(
  planetRadius: number,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
): THREE.Mesh {
  // Unit-height cylinder; we set scale.y to the actual length each frame so we
  // never rebuild geometry as the moon orbits.
  const r = planetRadius * TETHER_RADIUS_FRAC;
  const geo = new THREE.CylinderGeometry(r, r, 1, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(RESOURCE_COLOR[MOON_OUTPOST_INCOME.resource]),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  geometries.push(geo);
  materials.push(mat);
  return mesh;
}

function buildShuttle(
  planetRadius: number,
  geometries: THREE.BufferGeometry[],
  materials: THREE.Material[],
): THREE.Mesh {
  const r = planetRadius * SHUTTLE_RADIUS_FRAC;
  const geo = new THREE.SphereGeometry(r, 8, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
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

export function makeMoonOutpost(
  planet: PlanetHandle,
  moon: MoonHandle,
  empire: Empire,
): MoonOutpostHandle | null {

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  // Moon-side: dome attached to moon.mesh. The mesh has scale = moon.radius
  // applied, so geometry sized in unit space ends up correct in world units.
  const moonSideGroup = new THREE.Group();
  const dome = buildDome(geometries, materials);
  // Place dome at the moon's "north pole" relative to the moon mesh's local Y
  // axis. The dome's base sits exactly on the surface (radius = 1 in unit
  // space; we shift the group up by 1).
  dome.position.y = 1;
  moonSideGroup.add(dome);

  // Planet-side: tether + shuttles, parented to planet.pivot (no axial spin).
  const planetSideGroup = new THREE.Group();
  const hasElevator = empire.hasUnlock('space-elevator');
  let tether: THREE.Mesh | null = null;
  const shuttles: { mesh: THREE.Mesh; state: ShuttleState }[] = [];
  if (hasElevator) {
    tether = buildTether(planet.data.radius, geometries, materials);
    planetSideGroup.add(tether);
    for (let i = 0; i < SHUTTLE_COUNT; i++) {
      const sm = buildShuttle(planet.data.radius, geometries, materials);
      planetSideGroup.add(sm);
      shuttles.push({
        mesh: sm,
        state: {
          t: i / SHUTTLE_COUNT,
          speed: SHUTTLE_BASE_SPEED * (0.85 + 0.3 * (i / SHUTTLE_COUNT)),
          dir: i % 2 === 0 ? 1 : -1,
        },
      });
    }
  }

  return {
    planetSideGroup,
    moonSideGroup,
    hasElevator,
    tether,
    shuttles,
    planet,
    moon,
    geometries,
    materials,
  };
}

const _worldM = new THREE.Vector3();
const _localM = new THREE.Vector3();
const _midpoint = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

export function updateMoonOutpost(h: MoonOutpostHandle, dt: number): void {
  // Bail when hidden — both groups share visibility (toggled by host).
  if (!h.planetSideGroup.visible) return;
  if (!h.tether) return;

  // Endpoint A: planet centre = local origin in planet.pivot's frame.
  // Endpoint B: moon mesh world position, transformed into planet.pivot local.
  h.moon.mesh.getWorldPosition(_worldM);
  _localM.copy(_worldM);
  h.planet.pivot.worldToLocal(_localM);

  const length = _localM.length();
  if (length < 1e-4) return;

  // Position cylinder midway, scale to the right length, orient along the
  // direction vector. Cylinder's local +Y must align with (origin → moonLocal).
  _midpoint.copy(_localM).multiplyScalar(0.5);
  h.tether.position.copy(_midpoint);
  h.tether.scale.set(1, length, 1);
  const dir = _localM.clone().normalize();
  _quat.setFromUnitVectors(_up, dir);
  h.tether.quaternion.copy(_quat);

  // Shuttles: bounce between planet (t=0) and moon (t=1) along the tether.
  for (const s of h.shuttles) {
    s.state.t += s.state.speed * s.state.dir * dt;
    if (s.state.t >= 1) {
      s.state.t = 1;
      s.state.dir = -1;
    } else if (s.state.t <= 0) {
      s.state.t = 0;
      s.state.dir = 1;
    }
    s.mesh.position.copy(_localM).multiplyScalar(s.state.t);
  }
}

export function disposeMoonOutpost(h: MoonOutpostHandle): void {
  if (h.planetSideGroup.parent) h.planetSideGroup.parent.remove(h.planetSideGroup);
  if (h.moonSideGroup.parent) h.moonSideGroup.parent.remove(h.moonSideGroup);
  for (const g of h.geometries) g.dispose();
  for (const m of h.materials) m.dispose();
  h.geometries.length = 0;
  h.materials.length = 0;
  h.shuttles.length = 0;
}

export function setMoonOutpostVisible(h: MoonOutpostHandle, visible: boolean): void {
  h.planetSideGroup.visible = visible;
  h.moonSideGroup.visible = visible;
}

// Cheap-skip probe — the host only rebuilds when one of these fields changes,
// so routine purchases don't churn through dispose/build.
export function moonOutpostConfig(empire: Empire): {
  hasOutpost: boolean;
  hasElevator: boolean;
  moonId: string | null;
} {
  return {
    hasOutpost: empire.hasUnlock('moon-outpost'),
    hasElevator: empire.hasUnlock('space-elevator'),
    moonId: empire.state.outpostMoonId,
  };
}
