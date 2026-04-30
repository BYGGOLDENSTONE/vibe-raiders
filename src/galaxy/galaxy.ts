import * as THREE from 'three';
import type { GalaxyData } from './types';
import { makeSystem, updateSystem, setSystemDetail, type SystemHandle } from './system';
import { makeBlackHole, updateBlackHole, type BlackHoleHandle } from './blackhole';
import { buildBackground, type BackgroundHandle } from './starfield';

export interface GalaxyHandle {
  data: GalaxyData;
  root: THREE.Group;
  systems: Map<string, SystemHandle>;
  blackHole: BlackHoleHandle;
  background: BackgroundHandle;
}

export function buildGalaxy(scene: THREE.Scene, data: GalaxyData): GalaxyHandle {
  const root = new THREE.Group();
  scene.add(root);

  const bg = buildBackground();
  scene.add(bg.skydome);
  for (const layer of bg.starLayers) scene.add(layer);

  const bh = makeBlackHole();
  root.add(bh.group);

  const systems = new Map<string, SystemHandle>();
  for (const s of data.systems) {
    const h = makeSystem(s);
    systems.set(s.id, h);
    root.add(h.group);
    setSystemDetail(h, false); // start with planets hidden
  }

  return { data, root, systems, blackHole: bh, background: bg };
}

export function updateGalaxy(
  g: GalaxyHandle,
  dt: number,
  cameraPos: THREE.Vector3,
  activeSystemId: string | null,
): void {
  updateBlackHole(g.blackHole, dt, cameraPos);

  for (const [id, sys] of g.systems) {
    const isActive = id === activeSystemId;
    updateSystem(sys, dt, cameraPos, isActive);
  }
}

export function setActiveSystem(g: GalaxyHandle, activeSystemId: string | null): void {
  for (const [id, sys] of g.systems) {
    setSystemDetail(sys, id === activeSystemId);
  }
}
