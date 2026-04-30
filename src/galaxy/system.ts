import * as THREE from 'three';
import type { SystemData } from './types';
import { makeStar, updateStar, type StarHandle } from './star';
import { makePlanet, updatePlanet, type PlanetHandle } from './planet';

export interface SystemHandle {
  data: SystemData;
  group: THREE.Group;
  star: StarHandle;
  planets: PlanetHandle[];
  orbitLines: THREE.Object3D[];
}

// Ellipse focused at origin: parametric (a*cos(E)-c, 0, b*sin(E)).
// omega + tilt baked into a wrapping group so the line shares the planet's orbit frame.
function buildOrbitLine(a: number, e: number, omega: number, tilt: number): THREE.Object3D {
  const c = a * e;
  const b = a * Math.sqrt(Math.max(0, 1 - e * e));
  const segs = 192;
  const pts: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const E = (i / segs) * Math.PI * 2;
    pts.push(Math.cos(E) * a - c, 0, Math.sin(E) * b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12,
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

export function makeSystem(data: SystemData): SystemHandle {
  const group = new THREE.Group();
  group.position.set(...data.position);

  const star = makeStar(data);
  group.add(star.group);

  const planets: PlanetHandle[] = [];
  const orbitLines: THREE.Object3D[] = [];
  for (const p of data.planets) {
    const ph = makePlanet(p);
    group.add(ph.group);
    planets.push(ph);
    const line = buildOrbitLine(p.orbitRadius, p.orbitEccentricity, p.orbitOmega, p.orbitTilt);
    orbitLines.push(line);
    group.add(line);
  }

  group.userData = { kind: 'system', systemId: data.id };
  return { data, group, star, planets, orbitLines };
}

export function updateSystem(
  h: SystemHandle,
  dt: number,
  cameraPos: THREE.Vector3,
  fullDetail: boolean,
): void {
  updateStar(h.star, dt, cameraPos);
  if (fullDetail) {
    const starWorld = new THREE.Vector3();
    h.star.core.getWorldPosition(starWorld);
    for (const p of h.planets) {
      updatePlanet(p, dt, starWorld, h.star.color, cameraPos);
    }
  }
}

export function setSystemDetail(h: SystemHandle, full: boolean): void {
  for (const p of h.planets) {
    p.body.visible = full;
  }
  for (const l of h.orbitLines) {
    l.visible = full;
  }
}
