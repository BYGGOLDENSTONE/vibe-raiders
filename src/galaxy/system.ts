import * as THREE from 'three';
import type { SystemData } from './types';
import { makeStar, updateStar, type StarHandle } from './star';
import { makePlanet, updatePlanet, type PlanetHandle } from './planet';

export interface SystemHandle {
  data: SystemData;
  group: THREE.Group;
  star: StarHandle;
  planets: PlanetHandle[];
  orbitLines: THREE.Line[];
}

function buildOrbitLine(radius: number, tilt: number): THREE.Line {
  const segs = 128;
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
    opacity: 0.12,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.rotation.x = tilt;
  return line;
}

export function makeSystem(data: SystemData): SystemHandle {
  const group = new THREE.Group();
  group.position.set(...data.position);

  const star = makeStar(data);
  group.add(star.group);

  const planets: PlanetHandle[] = [];
  const orbitLines: THREE.Line[] = [];
  for (const p of data.planets) {
    const ph = makePlanet(p);
    group.add(ph.group);
    planets.push(ph);
    const line = buildOrbitLine(p.orbitRadius, p.orbitTilt);
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
