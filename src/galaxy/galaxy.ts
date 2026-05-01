// W9/W10 — multi-galaxy universe builder. Each galaxy starts as just a bulge
// billboard + empty root group; system meshes (200 systems × 5 planets ×
// shaders + orbit lines) are built lazily when the player flies into that
// galaxy and disposed when they leave. Pre-W10 we built every galaxy's
// systems upfront — that hits ~1.5 GB of GPU/CPU memory across 100 galaxies
// and OOMs the browser. With lazy build only 1-2 galaxies are mesh-resident
// at a time (~30 MB combined).

import * as THREE from 'three';
import type { GalaxyData, UniverseData } from './types';
import { makeSystem, updateSystem, setSystemDetail, disposeSystem, type SystemHandle } from './system';
import { makeBlackHole, updateBlackHole, type BlackHoleHandle } from './blackhole';
import { buildBackground, type BackgroundHandle } from './starfield';
import { makeBulge, updateBulge, type BulgeHandle } from './bulge';

// W10 perf — single Points cloud per galaxy carries every star's position
// and colour, so galaxy view renders 200 stars in one draw call instead of
// 400 (sphere core + glow billboard per system). The active system in system
// view temporarily hides its own point and lets the full StarHandle render.
interface StarPointsHandle {
  points: THREE.Points;
  index: Map<string, number>;
  baseSizes: Float32Array;
  sizeAttribute: THREE.BufferAttribute;
}

function buildStarPoints(data: GalaxyData): StarPointsHandle {
  const n = data.systems.length;
  const positions = new Float32Array(n * 3);
  const colors    = new Float32Array(n * 3);
  const sizes     = new Float32Array(n);
  const baseSizes = new Float32Array(n);
  const index = new Map<string, number>();

  for (let i = 0; i < n; i++) {
    const s = data.systems[i]!;
    positions[i * 3 + 0] = s.position[0];
    positions[i * 3 + 1] = s.position[1];
    positions[i * 3 + 2] = s.position[2];
    colors[i * 3 + 0] = s.starColor[0];
    colors[i * 3 + 1] = s.starColor[1];
    colors[i * 3 + 2] = s.starColor[2];
    const sz = Math.max(2.0, s.starRadius * 0.6);
    sizes[i] = sz;
    baseSizes[i] = sz;
    index.set(s.id, i);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const sizeAttr = new THREE.BufferAttribute(sizes, 1);
  geo.setAttribute('aSize', sizeAttr);

  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * 220.0 / -mv.z, 1.0, 16.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d2 = dot(c, c);
        if (d2 > 0.25) discard;
        float a = 1.0 - d2 * 4.0;
        gl_FragColor = vec4(vColor * (1.4 + a * 1.2), a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData = { kind: 'galaxy-stars' };
  return { points, index, baseSizes, sizeAttribute: sizeAttr };
}

function disposeStarPoints(s: StarPointsHandle): void {
  s.points.geometry.dispose();
  (s.points.material as THREE.Material).dispose();
}

function setSystemPointHidden(s: StarPointsHandle, systemId: string, hidden: boolean): void {
  const idx = s.index.get(systemId);
  if (idx === undefined) return;
  const arr = s.sizeAttribute.array as Float32Array;
  const next = hidden ? 0 : s.baseSizes[idx]!;
  if (arr[idx] === next) return;
  arr[idx] = next;
  s.sizeAttribute.needsUpdate = true;
}

export interface GalaxyHandle {
  data: GalaxyData;
  root: THREE.Group;             // positioned + tilted in universe space
  systemsGroup: THREE.Group;     // empty until activated
  systems: Map<string, SystemHandle>;  // empty until activated
  // W10 — black hole + Points cloud are lazy too. They live until the galaxy
  // is deactivated (player flies elsewhere). Bulge stays resident always.
  blackHole: BlackHoleHandle | null;
  bulge: BulgeHandle;
  starPoints: StarPointsHandle | null;
}

export interface UniverseHandle {
  data: UniverseData;
  root: THREE.Group;
  galaxies: Map<string, GalaxyHandle>;
  // Flat lookup across every CURRENTLY-built galaxy. Inactive galaxies aren't
  // here, so callers must accept undefined for systems in unbuilt galaxies.
  systems: Map<string, SystemHandle>;
  systemToGalaxy: Map<string, string>;
  // Home galaxy's black hole — also the Vibe Jam portal target. The home
  // galaxy is kept activated permanently so this reference stays valid.
  blackHole: BlackHoleHandle;
  background: BackgroundHandle;
  // Currently-active galaxy id. Drives LOD: only this galaxy's systemsGroup
  // and black hole are visible. Swap via setActiveGalaxy().
  activeGalaxyId: string;
  // W10 — id of the home galaxy. Always kept built so the portal-pick proxy
  // and home-system camera target survive a galaxy switch.
  homeGalaxyId: string;
}

export function buildUniverse(scene: THREE.Scene, data: UniverseData): UniverseHandle {
  const root = new THREE.Group();
  scene.add(root);

  const bg = buildBackground();
  scene.add(bg.skydome);
  for (const layer of bg.starLayers) scene.add(layer);

  const galaxies = new Map<string, GalaxyHandle>();
  const systemToGalaxy = new Map<string, string>();
  // systemToGalaxy is built upfront from data — the map is small (200 × 100
  // = 20 K string pairs, ~2 MB) and lets `which galaxy contains this id`
  // queries answer without walking systems.
  for (const g of data.galaxies) {
    for (const s of g.systems) {
      systemToGalaxy.set(s.id, g.id);
    }
  }

  for (const g of data.galaxies) {
    const handle = buildGalaxyShell(g);
    galaxies.set(g.id, handle);
    root.add(handle.root);
  }

  const homeId = data.galaxies[0]!.id;
  const homeGh = galaxies.get(homeId)!;

  const universe: UniverseHandle = {
    data,
    root,
    galaxies,
    systems: new Map(),
    systemToGalaxy,
    // populated below once home galaxy is activated
    blackHole: null as unknown as BlackHoleHandle,
    background: bg,
    activeGalaxyId: homeId,
    homeGalaxyId: homeId,
  };

  // Activate home galaxy — builds its 200 systems + black hole + points cloud.
  // Other 99 galaxies stay as just-the-bulge until visited.
  activateGalaxySystems(universe, homeGh);
  universe.blackHole = homeGh.blackHole!;
  setActiveGalaxy(universe, homeId);
  return universe;
}

// Build the lightweight shell of a galaxy — root, systemsGroup placeholder,
// bulge billboard. No systems, no black hole, no points cloud (those are built
// on first activation). Cheap enough to do for all 100 galaxies upfront.
function buildGalaxyShell(data: GalaxyData): GalaxyHandle {
  const root = new THREE.Group();
  root.position.set(data.position[0], data.position[1], data.position[2]);
  // W10 — apply the galaxy tilt to the root group so the bulge, black hole
  // and systems all rotate together when the disc is procedurally tilted.
  root.rotation.set(data.tilt[0], data.tilt[1], data.tilt[2]);
  root.userData = { kind: 'galaxy', galaxyId: data.id };

  const systemsGroup = new THREE.Group();
  systemsGroup.visible = false; // empty + hidden until activated
  root.add(systemsGroup);

  const bulge = makeBulge(data);
  root.add(bulge.group);

  return {
    data,
    root,
    systemsGroup,
    systems: new Map(),
    blackHole: null,
    bulge,
    starPoints: null,
  };
}

// W10 — populate this galaxy's heavy meshes (200 systems + black hole + star
// Points cloud). Idempotent: a second call is a no-op so navigation through
// the same galaxy doesn't keep reallocating.
function activateGalaxySystems(u: UniverseHandle, gh: GalaxyHandle): void {
  if (gh.systems.size > 0) return;

  const blackHole = makeBlackHole(gh.data.radius);
  gh.root.add(blackHole.group);
  gh.blackHole = blackHole;

  for (const s of gh.data.systems) {
    const h = makeSystem(s);
    gh.systems.set(s.id, h);
    gh.systemsGroup.add(h.group);
    setSystemDetail(h, false);
    u.systems.set(s.id, h);
  }

  const starPoints = buildStarPoints(gh.data);
  gh.systemsGroup.add(starPoints.points);
  gh.starPoints = starPoints;
}

// Inverse of activateGalaxySystems — drops every per-system mesh + black
// hole + Points cloud and clears the universe-level system map entries.
// Home galaxy is exempt (its black hole is the portal pick target, and the
// home system needs to be camera-resolvable any time the player jumps home).
function deactivateGalaxySystems(u: UniverseHandle, gh: GalaxyHandle): void {
  if (gh.systems.size === 0) return;
  if (gh.data.id === u.homeGalaxyId) return;

  for (const sys of gh.systems.values()) {
    disposeSystem(sys);
    u.systems.delete(sys.data.id);
  }
  gh.systems.clear();

  // Detach + clear systemsGroup children; bulge lives outside it.
  while (gh.systemsGroup.children.length > 0) {
    gh.systemsGroup.remove(gh.systemsGroup.children[0]!);
  }

  if (gh.blackHole) {
    gh.root.remove(gh.blackHole.group);
    gh.blackHole.diskMaterial.dispose();
    (gh.blackHole.haloMesh.material as THREE.Material).dispose();
    gh.blackHole.haloMesh.geometry.dispose();
    gh.blackHole = null;
  }

  if (gh.starPoints) {
    disposeStarPoints(gh.starPoints);
    gh.starPoints = null;
  }
}

export function updateUniverse(
  u: UniverseHandle,
  dt: number,
  cameraPos: THREE.Vector3,
  activeSystemId: string | null,
): void {
  const tmpV = new THREE.Vector3();
  for (const [, gh] of u.galaxies) {
    // Bulge fade depends on the galaxy's world centre — runs for every galaxy
    // since the bulge is always potentially visible.
    gh.root.getWorldPosition(tmpV);
    updateBulge(gh.bulge, cameraPos, tmpV);

    if (gh.data.id !== u.activeGalaxyId) continue;
    if (!gh.blackHole) continue; // not yet activated

    updateBlackHole(gh.blackHole, dt, cameraPos);
    for (const [id, sys] of gh.systems) {
      const isActive = id === activeSystemId;
      updateSystem(sys, dt, cameraPos, isActive);
    }
  }
}

export function setActiveSystem(u: UniverseHandle, activeSystemId: string | null): void {
  const gh = u.galaxies.get(u.activeGalaxyId);
  if (!gh || !gh.starPoints) return;
  for (const [id, sys] of gh.systems) {
    const isActive = id === activeSystemId;
    setSystemDetail(sys, isActive);
    setSystemPointHidden(gh.starPoints, id, isActive);
  }
}

// W10 — activate the target galaxy (lazy-build if needed) and deactivate the
// previously-active one (drop its 200 systems' meshes). Home galaxy is kept
// permanently active so the portal pick + home-jump always work.
export function setActiveGalaxy(u: UniverseHandle, galaxyId: string): void {
  const prev = u.activeGalaxyId;
  u.activeGalaxyId = galaxyId;

  const newGh = u.galaxies.get(galaxyId);
  if (!newGh) return;

  // Lazy-build the new galaxy's systems if it's never been visited.
  activateGalaxySystems(u, newGh);

  // Visibility: only the active galaxy's systemsGroup + black hole show.
  for (const [id, gh] of u.galaxies) {
    const isActive = id === galaxyId;
    gh.systemsGroup.visible = isActive;
    if (gh.blackHole) gh.blackHole.group.visible = isActive;
  }

  // Free meshes for the previously-active galaxy unless it's home.
  if (prev && prev !== galaxyId && prev !== u.homeGalaxyId) {
    const prevGh = u.galaxies.get(prev);
    if (prevGh) deactivateGalaxySystems(u, prevGh);
  }

  // Reset newly-active galaxy: every system back to "no detail" + every
  // point in the Points cloud restored.
  if (newGh.starPoints) {
    for (const [sid, sys] of newGh.systems) {
      setSystemDetail(sys, false);
      setSystemPointHidden(newGh.starPoints, sid, false);
    }
  }
}

// W10 perf — universe view (camera ~1.2M out) doesn't need ANY system meshes
// drawn; the bulge billboards already represent each galaxy from that
// distance. Hide every systemsGroup. Don't deactivate, just hide — so the
// player can dive back into the home galaxy without a rebuild flicker.
export function hideAllSystemsForUniverseView(u: UniverseHandle): void {
  for (const [, gh] of u.galaxies) {
    gh.systemsGroup.visible = false;
    if (gh.blackHole) gh.blackHole.group.visible = false;
  }
}

// Helper for app.ts when navigating: which galaxy contains the given system?
export function galaxyOfSystem(u: UniverseHandle, systemId: string): GalaxyHandle | null {
  const gid = u.systemToGalaxy.get(systemId);
  if (!gid) return null;
  return u.galaxies.get(gid) ?? null;
}

// W10 — compute a system's universe-space world position from raw data, used
// when the system's mesh handle isn't built (other galaxies). Applies the
// galaxy's tilt + offset so connection lines and remote vortexes can render
// without forcing every galaxy to be activated.
export function systemWorldPositionFromData(
  u: UniverseHandle,
  systemId: string,
  out: THREE.Vector3,
): boolean {
  const gid = u.systemToGalaxy.get(systemId);
  if (!gid) return false;
  const galaxyData = u.data.galaxies.find((g) => g.id === gid);
  if (!galaxyData) return false;
  const sys = galaxyData.systems.find((s) => s.id === systemId);
  if (!sys) return false;
  out.set(sys.position[0], sys.position[1], sys.position[2]);
  // Apply galaxy tilt (galaxy.root.rotation), then translate by galaxy.position.
  out.applyEuler(new THREE.Euler(galaxyData.tilt[0], galaxyData.tilt[1], galaxyData.tilt[2]));
  out.x += galaxyData.position[0];
  out.y += galaxyData.position[1];
  out.z += galaxyData.position[2];
  return true;
}
