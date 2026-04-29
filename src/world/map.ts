// World orchestrator. Builds the heightmap + all biomes + shelters + distant silhouettes.
// Returns one combined WorldResult with colliders, shelter list, landmarks, ground sampler,
// per-frame update closure, and dispose.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  Vector3,
} from 'three';

import type { Collider } from './colliders';
import { buildHeightmap, REGIONS } from './heightmap';
import { PALETTE } from './palette';
import { createRng } from './rng';
import { buildCityBiome } from './biomes/city';
import { buildDamBiome } from './biomes/dam';
import { buildForestBiome } from './biomes/forest';
import { buildIndustrialBiome } from './biomes/industrial';
import { buildMountainBiome } from './biomes/mountain';

export type ShelterId = 'city' | 'industrial' | 'dam' | 'forest';

export interface WorldShelter {
  id: ShelterId;
  position: [number, number, number];
}

export interface WorldLandmark {
  kind: string;
  biome: string;
  position: [number, number, number];
}

export interface WorldResult {
  colliders: Collider[];
  shelters: WorldShelter[];
  landmarks: WorldLandmark[];
  bounds: { min: [number, number]; max: [number, number] };
  groundHeight: (x: number, z: number) => number;
  update?: (t: number) => void;
  dispose(): void;
}

export interface GenerateWorldOpts {
  scene: Scene;
  seed: number;
  size?: number;
}

export function generateWorld(opts: GenerateWorldOpts): WorldResult {
  const { scene, seed } = opts;
  const size = opts.size ?? 400;
  const half = size / 2;
  const rng = createRng(seed);

  const ownedDispose: Array<() => void> = [];
  const rootGroup = new Group();
  rootGroup.name = 'world-root';
  scene.add(rootGroup);

  // Heightmap.
  const heightmap = buildHeightmap();
  rootGroup.add(heightmap.mesh);

  // Build each biome — pass region from REGIONS.
  const cityBiome = buildCityBiome({
    scene: rootGroup as unknown as Scene,
    rng, region: REGIONS.city, groundHeight: heightmap.groundHeight,
  });
  const industrialBiome = buildIndustrialBiome({
    scene: rootGroup as unknown as Scene,
    rng, region: REGIONS.industrial, groundHeight: heightmap.groundHeight,
  });
  const damBiome = buildDamBiome({
    scene: rootGroup as unknown as Scene,
    rng, region: REGIONS.dam, groundHeight: heightmap.groundHeight,
  });
  const forestBiome = buildForestBiome({
    scene: rootGroup as unknown as Scene,
    rng, region: REGIONS.forest, groundHeight: heightmap.groundHeight,
  });
  const mountainBiome = buildMountainBiome({
    scene: rootGroup as unknown as Scene,
    rng, region: REGIONS.mountain, groundHeight: heightmap.groundHeight,
  });

  // Aggregate.
  const colliders: Collider[] = [
    ...cityBiome.colliders,
    ...industrialBiome.colliders,
    ...damBiome.colliders,
    ...forestBiome.colliders,
    ...mountainBiome.colliders,
  ];

  const landmarks: WorldLandmark[] = [
    ...cityBiome.landmarks.map(l => ({ ...l, biome: 'city' })),
    ...industrialBiome.landmarks.map(l => ({ ...l, biome: 'industrial' })),
    ...damBiome.landmarks.map(l => ({ ...l, biome: 'dam' })),
    ...forestBiome.landmarks.map(l => ({ ...l, biome: 'forest' })),
    ...mountainBiome.landmarks.map(l => ({ ...l, biome: 'mountain' })),
  ];

  // Build shelters from candidates. Each biome contributes one (city/industrial/dam/forest).
  const shelterDefs: { id: ShelterId; pos: [number, number, number] }[] = [];
  if (cityBiome.shelterCandidates[0]) shelterDefs.push({ id: 'city', pos: cityBiome.shelterCandidates[0].position });
  if (industrialBiome.shelterCandidates[0]) shelterDefs.push({ id: 'industrial', pos: industrialBiome.shelterCandidates[0].position });
  if (damBiome.shelterCandidates[0]) shelterDefs.push({ id: 'dam', pos: damBiome.shelterCandidates[0].position });
  if (forestBiome.shelterCandidates[0]) shelterDefs.push({ id: 'forest', pos: forestBiome.shelterCandidates[0].position });

  const { shelterMeshes, shelterLights, shelterColliders, shelterDispose, shelterAccents } = buildShelters(rootGroup, shelterDefs);
  for (const c of shelterColliders) colliders.push(c);
  ownedDispose.push(shelterDispose);

  const shelters: WorldShelter[] = shelterDefs.map(s => ({ id: s.id, position: s.pos }));

  // Distant silhouettes — far ruined city N/W edges.
  const silhouetteDispose = buildDistantSilhouettes(rootGroup, rng);
  ownedDispose.push(silhouetteDispose);

  // Floating dust columns far in the air.
  const dustDispose = buildAtmosphericDust(rootGroup, rng, size);
  ownedDispose.push(dustDispose);

  // Combine update closures.
  const updaters: Array<(t: number) => void> = [];
  if (cityBiome.update) updaters.push(cityBiome.update);
  if (industrialBiome.update) updaters.push(industrialBiome.update);
  if (damBiome.update) updaters.push(damBiome.update);
  if (forestBiome.update) updaters.push(forestBiome.update);
  if (mountainBiome.update) updaters.push(mountainBiome.update);
  // Shelter accents pulse.
  updaters.push((t: number) => {
    for (let i = 0; i < shelterAccents.length; i++) {
      const a = shelterAccents[i];
      a.intensity = a.userData.base + 0.4 * Math.sin(t * 2.0 + i * 1.2);
    }
  });

  const update = (t: number) => {
    for (const u of updaters) u(t);
  };

  function dispose(): void {
    for (const d of ownedDispose) d();
    scene.remove(rootGroup);
    rootGroup.traverse((child: Object3D) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach(mm => mm.dispose());
        else if (m && (m as MeshStandardMaterial).dispose) (m as MeshStandardMaterial).dispose();
      }
    });
    void shelterMeshes; void shelterLights;
  }

  return {
    colliders,
    shelters,
    landmarks,
    bounds: { min: [-half, -half], max: [half, half] },
    groundHeight: heightmap.groundHeight,
    update,
    dispose,
  };
}

// ------------------------------------------------------------------
// Shelter construction (small concrete bunker + green PointLight).
// ------------------------------------------------------------------
function buildShelters(
  parent: Group,
  defs: { id: ShelterId; pos: [number, number, number] }[],
) {
  const colliders: Collider[] = [];
  const lights: PointLight[] = [];
  const meshes: Mesh[] = [];
  const accents: PointLight[] = [];

  const concreteMat = new MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 });
  const metalMat = new MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.85, metalness: 0.15 });
  const accentMat = new MeshStandardMaterial({ color: 0x081a08, emissive: new Color(PALETTE.shelterAccent), emissiveIntensity: 1.5, roughness: 0.6 });

  for (const d of defs) {
    const w = 6, h = 3, dpt = 4;
    const [x, gy, z] = d.pos;

    const bunkerGeo = new BoxGeometry(w, h, dpt);
    const bunker = new Mesh(bunkerGeo, concreteMat);
    bunker.position.set(x, gy + h / 2, z);
    bunker.castShadow = true;
    bunker.receiveShadow = true;
    parent.add(bunker);
    meshes.push(bunker);
    colliders.push({ min: [x - w / 2, gy, z - dpt / 2], max: [x + w / 2, gy + h, z + dpt / 2] });

    const doorGeo = new BoxGeometry(1.4, 2.2, 0.25);
    const door = new Mesh(doorGeo, metalMat);
    door.position.set(x, gy + 1.1, z + dpt / 2 + 0.05);
    parent.add(door);
    meshes.push(door);

    const accentGeo = new BoxGeometry(0.8, 0.4, 0.8);
    const accent = new Mesh(accentGeo, accentMat);
    accent.position.set(x, gy + h + 0.2, z);
    parent.add(accent);
    meshes.push(accent);

    const accentLight = new PointLight(PALETTE.shelterAccent, 2.0, 18, 1.5);
    accentLight.position.set(x, gy + h + 1.4, z);
    accentLight.userData.base = 2.0;
    accentLight.userData.shelterId = d.id;
    parent.add(accentLight);
    lights.push(accentLight);
    accents.push(accentLight);
  }

  return {
    shelterMeshes: meshes,
    shelterLights: lights,
    shelterColliders: colliders,
    shelterAccents: accents,
    shelterDispose: () => {
      concreteMat.dispose();
      metalMat.dispose();
      accentMat.dispose();
      for (const m of meshes) m.geometry.dispose();
    },
  };
}

// ------------------------------------------------------------------
// Distant city silhouettes beyond the play area on N + W edges.
// ------------------------------------------------------------------
function buildDistantSilhouettes(parent: Group, rng: ReturnType<typeof createRng>) {
  const mat = new MeshStandardMaterial({ color: PALETTE.distantSilhouette, roughness: 1.0, fog: false });
  const geos: BufferGeometry[] = [];
  const meshes: Mesh[] = [];

  // North edge (z = -700..-500), spread along x = -400..400.
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-400, 400);
    const z = rng.range(-1000, -550);
    const w = rng.range(15, 50);
    const h = rng.range(20, 80);
    const d = rng.range(15, 50);
    const g = new BoxGeometry(w, h, d);
    const m = new Mesh(g, mat);
    m.position.set(x, h / 2 - 3, z);
    m.castShadow = false;
    m.receiveShadow = false;
    parent.add(m);
    geos.push(g);
    meshes.push(m);
  }
  // West edge.
  for (let i = 0; i < 12; i++) {
    const x = rng.range(-1000, -550);
    const z = rng.range(-400, 400);
    const w = rng.range(15, 50);
    const h = rng.range(20, 80);
    const d = rng.range(15, 50);
    const g = new BoxGeometry(w, h, d);
    const m = new Mesh(g, mat);
    m.position.set(x, h / 2 - 3, z);
    m.castShadow = false;
    m.receiveShadow = false;
    parent.add(m);
    geos.push(g);
    meshes.push(m);
  }
  // South edge — a few too.
  for (let i = 0; i < 8; i++) {
    const x = rng.range(-400, 400);
    const z = rng.range(550, 1000);
    const w = rng.range(15, 50);
    const h = rng.range(20, 80);
    const d = rng.range(15, 50);
    const g = new BoxGeometry(w, h, d);
    const m = new Mesh(g, mat);
    m.position.set(x, h / 2 - 3, z);
    m.castShadow = false;
    m.receiveShadow = false;
    parent.add(m);
    geos.push(g);
    meshes.push(m);
  }

  return () => {
    for (const g of geos) g.dispose();
    mat.dispose();
    void meshes;
  };
}

// ------------------------------------------------------------------
// Atmospheric dust columns (vertical instanced bars far in the air).
// ------------------------------------------------------------------
function buildAtmosphericDust(parent: Group, rng: ReturnType<typeof createRng>, size: number) {
  const COUNT = 24;
  const geo = new CylinderGeometry(2, 5, 60, 8, 1, true);
  const mat = new MeshStandardMaterial({
    color: 0x6a6058,
    transparent: true,
    opacity: 0.18,
    roughness: 1.0,
    depthWrite: false,
    fog: false,
  });
  const inst = new InstancedMesh(geo, mat, COUNT);
  inst.instanceMatrix.setUsage(DynamicDrawUsage);
  inst.castShadow = false;
  inst.receiveShadow = false;

  const _q = new Quaternion();
  const _p = new Vector3();
  const _s = new Vector3();
  const _m = new Matrix4();

  for (let i = 0; i < COUNT; i++) {
    const angle = rng.next() * Math.PI * 2;
    const dist = rng.range(size * 0.8, size * 1.5);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const y = rng.range(20, 80);
    const sy = rng.range(0.6, 1.4);
    const sxz = rng.range(0.5, 1.5);
    _q.identity();
    _p.set(x, y, z);
    _s.set(sxz, sy, sxz);
    _m.compose(_p, _q, _s);
    inst.setMatrixAt(i, _m);
  }
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);

  return () => {
    geo.dispose();
    mat.dispose();
  };
}

// Make TS happy about unused imports.
void PlaneGeometry;
