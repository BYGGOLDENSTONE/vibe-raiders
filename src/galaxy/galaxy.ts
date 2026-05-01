// W9 — multi-galaxy universe builder. Wraps multiple GalaxyHandles, exposes a
// flat system lookup map (so existing code paths keep working with one .get()),
// and tracks galaxy bulges that double as universe-view billboards + click
// targets. The main galaxy carries the supermassive black hole; the satellites
// just have their procedural systems + bulge LOD.

import * as THREE from 'three';
import type { GalaxyData, UniverseData } from './types';
import { makeSystem, updateSystem, setSystemDetail, type SystemHandle } from './system';
import { makeBlackHole, updateBlackHole, type BlackHoleHandle } from './blackhole';
import { buildBackground, type BackgroundHandle } from './starfield';
import { makeBulge, updateBulge, type BulgeHandle } from './bulge';

export interface GalaxyHandle {
  data: GalaxyData;
  root: THREE.Group;             // positioned at galaxy.position in universe space
  systems: Map<string, SystemHandle>;
  blackHole: BlackHoleHandle | null;  // only main galaxy has one
  bulge: BulgeHandle;
}

export interface UniverseHandle {
  data: UniverseData;
  root: THREE.Group;
  galaxies: Map<string, GalaxyHandle>;
  // Flat lookup across every galaxy — labels, picking, and the empire layer
  // all just .get(systemId). systemToGalaxy reverses the mapping when an
  // ancestor needs to know which galaxy a system belongs to.
  systems: Map<string, SystemHandle>;
  systemToGalaxy: Map<string, string>;
  blackHole: BlackHoleHandle;     // re-exported from main galaxy for convenience
  background: BackgroundHandle;
}

export function buildUniverse(scene: THREE.Scene, data: UniverseData): UniverseHandle {
  const root = new THREE.Group();
  scene.add(root);

  const bg = buildBackground();
  scene.add(bg.skydome);
  for (const layer of bg.starLayers) scene.add(layer);
  // W9 — distant cosmetic galaxies follow the camera (handled in app.ts loop).
  scene.add(bg.distantGalaxies.group);

  const galaxies = new Map<string, GalaxyHandle>();
  const systems = new Map<string, SystemHandle>();
  const systemToGalaxy = new Map<string, string>();
  let mainBlackHole: BlackHoleHandle | null = null;

  for (let i = 0; i < data.galaxies.length; i++) {
    const g = data.galaxies[i]!;
    const isMain = i === 0;
    const handle = buildGalaxy(g, isMain);
    galaxies.set(g.id, handle);
    root.add(handle.root);
    if (handle.blackHole) mainBlackHole = handle.blackHole;
    for (const [id, sys] of handle.systems) {
      systems.set(id, sys);
      systemToGalaxy.set(id, g.id);
    }
  }

  if (!mainBlackHole) {
    throw new Error('Main galaxy must define a black hole');
  }

  return { data, root, galaxies, systems, systemToGalaxy, blackHole: mainBlackHole, background: bg };
}

function buildGalaxy(data: GalaxyData, isMain: boolean): GalaxyHandle {
  const root = new THREE.Group();
  root.position.set(data.position[0], data.position[1], data.position[2]);
  root.userData = { kind: 'galaxy', galaxyId: data.id };

  let blackHole: BlackHoleHandle | null = null;
  if (isMain) {
    blackHole = makeBlackHole();
    root.add(blackHole.group);
  }

  const systems = new Map<string, SystemHandle>();
  for (const s of data.systems) {
    const h = makeSystem(s);
    systems.set(s.id, h);
    root.add(h.group);
    setSystemDetail(h, false); // start with planets hidden
  }

  // W9 — bulge billboard sits at the galaxy origin (in galaxy-local space)
  // and reads as a procedural spiral disc from far away. Fades out when the
  // camera gets close enough to see individual systems.
  const bulge = makeBulge(data);
  root.add(bulge.group);

  return { data, root, systems, blackHole, bulge };
}

export function updateUniverse(
  u: UniverseHandle,
  dt: number,
  cameraPos: THREE.Vector3,
  activeSystemId: string | null,
): void {
  if (u.blackHole) updateBlackHole(u.blackHole, dt, cameraPos);

  const tmpV = new THREE.Vector3();
  for (const [, gh] of u.galaxies) {
    // Bulge fade depends on the galaxy's world centre.
    gh.root.getWorldPosition(tmpV);
    updateBulge(gh.bulge, cameraPos, tmpV);

    for (const [id, sys] of gh.systems) {
      const isActive = id === activeSystemId;
      updateSystem(sys, dt, cameraPos, isActive);
    }
  }
}

// Activate a system (full LOD on its planets) — searches every galaxy so the
// caller doesn't need to know which one owns the system. Passing null clears
// detail on every system across every galaxy.
export function setActiveSystem(u: UniverseHandle, activeSystemId: string | null): void {
  for (const [, gh] of u.galaxies) {
    for (const [id, sys] of gh.systems) {
      setSystemDetail(sys, id === activeSystemId);
    }
  }
}

// Helper for app.ts when navigating: which galaxy contains the given system?
export function galaxyOfSystem(u: UniverseHandle, systemId: string): GalaxyHandle | null {
  const gid = u.systemToGalaxy.get(systemId);
  if (!gid) return null;
  return u.galaxies.get(gid) ?? null;
}
