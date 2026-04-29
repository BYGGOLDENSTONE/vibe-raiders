// Procedural ruined city generator.
// Pure procedural geometry. Deterministic given a seed. No Math.random.
//
// Strategy for low draw-call count:
// - Group all opaque static building/debris geometry by material and merge into one
//   BufferGeometry per material (one Mesh, one draw call).
// - Use a single InstancedMesh for rubble (~400+ instances, one draw call).
// - Fires, shelters, landmark, cars, dust, ground are individual but small in count.

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
  BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { Collider } from './colliders';
import { PALETTE } from './palette';
import { createRng, type Rng } from './rng';

export interface CityResult {
  colliders: Collider[];
  shelters: { id: 'NW' | 'NE' | 'SW' | 'SE'; position: [number, number, number] }[];
  landmark: { kind: 'tower' | 'cathedral'; position: [number, number, number] };
  /** Optional update hook — call each frame with the elapsed time in seconds. */
  update?: (t: number) => void;
  dispose(): void;
}

interface GenOpts {
  scene: Scene;
  seed: number;
  bounds?: number;
  blockSize?: number;
}

// Reusable accumulators, keyed by palette material name.
type MatKey = 'concrete' | 'asphalt' | 'rust' | 'brick' | 'metal' | 'debris';

interface GeoBucket {
  geos: BufferGeometry[];
}

function makeBuckets(): Record<MatKey, GeoBucket> {
  return {
    concrete: { geos: [] },
    asphalt: { geos: [] },
    rust: { geos: [] },
    brick: { geos: [] },
    metal: { geos: [] },
    debris: { geos: [] },
  };
}

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();
const _m = new Matrix4();

/** Push a box (size + position + rotationY) into the bucket as transformed BufferGeometry. */
function addBox(
  bucket: GeoBucket,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rotY: number = 0,
  rotX: number = 0,
  rotZ: number = 0,
): void {
  const g = new BoxGeometry(w, h, d);
  _e.set(rotX, rotY, rotZ);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  bucket.geos.push(g);
}

/** Generate one ruined building inside a block footprint. Returns colliders. */
function genBuilding(
  rng: Rng,
  buckets: Record<MatKey, GeoBucket>,
  cx: number, cz: number,
  maxW: number, maxD: number,
  out: Collider[],
): void {
  const w = rng.range(4, Math.min(14, maxW));
  const d = rng.range(4, Math.min(14, maxD));
  const totalH = rng.range(5, 25);

  // Base material — pick from concrete/brick.
  const baseKey: MatKey = rng.chance(0.55) ? 'concrete' : 'brick';

  // Stack 2-4 floor sections, each slightly smaller and offset.
  const sections = rng.int(2, 4);
  let yCursor = 0;
  let curW = w, curD = d, curX = cx, curZ = cz;

  for (let i = 0; i < sections; i++) {
    const sectionH = (totalH / sections) * rng.range(0.7, 1.2);
    const tilt = i === sections - 1 && rng.chance(0.45) ? rng.range(-0.18, 0.18) : 0;
    const offX = rng.range(-0.5, 0.5);
    const offZ = rng.range(-0.5, 0.5);

    const matKey = i === 0 ? baseKey : (rng.chance(0.7) ? baseKey : (rng.chance(0.5) ? 'rust' : 'metal'));

    addBox(
      buckets[matKey],
      curW, sectionH, curD,
      curX + offX, yCursor + sectionH / 2, curZ + offZ,
      0, 0, tilt,
    );

    // Add to colliders only when not heavily tilted (otherwise it's leaning rubble).
    if (Math.abs(tilt) < 0.08) {
      out.push({
        min: [curX + offX - curW / 2, yCursor, curZ + offZ - curD / 2],
        max: [curX + offX + curW / 2, yCursor + sectionH, curZ + offZ + curD / 2],
      });
    }

    yCursor += sectionH;
    // Each next section shrinks a bit and may shift.
    curW *= rng.range(0.55, 0.9);
    curD *= rng.range(0.55, 0.9);
    curX += rng.range(-0.6, 0.6);
    curZ += rng.range(-0.6, 0.6);
    if (curW < 1.5 || curD < 1.5) break;
  }

  // Exposed beams sticking up out of the top section.
  const beamCount = rng.int(1, 3);
  for (let b = 0; b < beamCount; b++) {
    const bw = rng.range(0.18, 0.32);
    const bh = rng.range(1.5, 3.5);
    const bx = cx + rng.range(-w / 2 + 0.5, w / 2 - 0.5);
    const bz = cz + rng.range(-d / 2 + 0.5, d / 2 - 0.5);
    addBox(buckets.metal, bw, bh, bw, bx, yCursor + bh / 2, bz, 0, rng.range(-0.15, 0.15), rng.range(-0.15, 0.15));
  }

  // A debris chunk leaning against the base on one side.
  if (rng.chance(0.6)) {
    const cw = rng.range(1.2, 2.5);
    const ch = rng.range(1.5, 3.0);
    const cd = rng.range(1.2, 2.5);
    const angle = rng.next() * Math.PI * 2;
    const r = Math.max(w, d) * 0.5 + cw * 0.4;
    addBox(
      buckets.debris,
      cw, ch, cd,
      cx + Math.cos(angle) * r,
      ch / 2,
      cz + Math.sin(angle) * r,
      angle,
      0,
      rng.range(-0.4, 0.4),
    );
  }
}

/** Add street/sidewalk surface inside a single block footprint. */
function addPlazaRubble(rng: Rng, buckets: Record<MatKey, GeoBucket>, cx: number, cz: number, blockSize: number): void {
  // A few low-profile rubble piles on plaza ground.
  const piles = rng.int(2, 5);
  const half = blockSize * 0.5 - 1.5;
  for (let i = 0; i < piles; i++) {
    const pw = rng.range(0.8, 2.0);
    const ph = rng.range(0.4, 1.2);
    const pd = rng.range(0.8, 2.0);
    addBox(
      buckets.debris,
      pw, ph, pd,
      cx + rng.range(-half, half),
      ph / 2,
      cz + rng.range(-half, half),
      rng.next() * Math.PI * 2,
      0,
      rng.range(-0.2, 0.2),
    );
  }
}

/** Build the four corner shelters. Adds geometry to buckets; returns shelter info + colliders + lights. */
function genShelters(
  buckets: Record<MatKey, GeoBucket>,
  bounds: number,
  out: Collider[],
): { shelters: CityResult['shelters']; lights: PointLight[] } {
  const inset = 18;
  const halfB = bounds * 0.5;
  const corners: { id: 'NW' | 'NE' | 'SW' | 'SE'; x: number; z: number }[] = [
    { id: 'NW', x: -halfB + inset, z: -halfB + inset },
    { id: 'NE', x:  halfB - inset, z: -halfB + inset },
    { id: 'SW', x: -halfB + inset, z:  halfB - inset },
    { id: 'SE', x:  halfB - inset, z:  halfB - inset },
  ];

  const shelters: CityResult['shelters'] = [];
  const lights: PointLight[] = [];

  for (const c of corners) {
    const w = 6, h = 3, d = 4;
    // Concrete bunker (shell with a hollow front-face represented by a thinner door).
    addBox(buckets.concrete, w, h, d, c.x, h / 2, c.z);

    // Door (metal). Sits on the +Z face slightly proud.
    addBox(buckets.metal, 1.4, 2.2, 0.25, c.x, 1.1, c.z + d / 2 + 0.05);

    // Rooftop accent block (small, will host the green light above).
    addBox(buckets.metal, 0.8, 0.4, 0.8, c.x, h + 0.2, c.z);

    out.push({
      min: [c.x - w / 2, 0, c.z - d / 2],
      max: [c.x + w / 2, h, c.z + d / 2],
    });

    // Green emissive PointLight hanging above.
    const light = new PointLight(PALETTE.shelterAccent, 1.6, 14, 2);
    light.position.set(c.x, h + 1.4, c.z);
    light.userData.shelterId = c.id;
    lights.push(light);

    shelters.push({ id: c.id, position: [c.x, 0, c.z] });
  }

  return { shelters, lights };
}

/** Build the central landmark — a tilted radio tower made of stacked truss boxes. */
function genLandmark(
  rng: Rng,
  buckets: Record<MatKey, GeoBucket>,
  out: Collider[],
): CityResult['landmark'] {
  // Tower made of stacked beams. Tilted to suggest collapse.
  const tilt = rng.range(0.18, 0.32);
  const segments = 8;
  const segH = 4;
  const baseSize = 4;
  // Apply tilt by shifting each segment in +x as height increases.
  const tiltAxis = rng.next() * Math.PI * 2;
  const tx = Math.cos(tiltAxis);
  const tz = Math.sin(tiltAxis);

  for (let i = 0; i < segments; i++) {
    const y = i * segH + segH / 2;
    const lateral = Math.sin((i / segments) * Math.PI * 0.5) * tilt * (segH * segments) * 0.4;
    const sx = tx * lateral;
    const sz = tz * lateral;
    const size = baseSize * (1 - i * 0.05);

    // Four corner posts of a truss segment.
    const half = size * 0.5;
    addBox(buckets.metal, 0.4, segH, 0.4, sx + half, y, sz + half, tilt * tx, 0, tilt * tz);
    addBox(buckets.metal, 0.4, segH, 0.4, sx - half, y, sz + half, tilt * tx, 0, tilt * tz);
    addBox(buckets.metal, 0.4, segH, 0.4, sx + half, y, sz - half, tilt * tx, 0, tilt * tz);
    addBox(buckets.metal, 0.4, segH, 0.4, sx - half, y, sz - half, tilt * tx, 0, tilt * tz);
    // Cross brace.
    if (i % 2 === 0) {
      addBox(buckets.rust, size * 1.2, 0.18, 0.18, sx, y, sz, 0, Math.PI * 0.25, 0);
    }
  }

  // Base collider (only the lower segments, where the player can plausibly bump it).
  out.push({ min: [-3, 0, -3], max: [3, 6, 3] });

  return { kind: 'tower', position: [0, 0, 0] };
}

/** Crashed cars: box body + 4 wheels (cylinders). */
function addCar(
  rng: Rng,
  body: GeoBucket,
  rust: GeoBucket,
  wheels: GeoBucket,
  cx: number, cz: number,
  out: Collider[],
): void {
  const tiltZ = rng.range(-0.5, 0.5);
  const tiltX = rng.range(-0.3, 0.3);
  const yaw = rng.next() * Math.PI * 2;
  const yLift = Math.abs(tiltZ) * 0.5 + 0.5;

  // Body
  const g = new BoxGeometry(1.8, 1.0, 4.0);
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _p.set(cx, yLift, cz);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  body.geos.push(g);

  // Roof (slightly smaller box on top)
  const r = new BoxGeometry(1.6, 0.6, 2.0);
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _p.set(cx, yLift + 0.7, cz);
  _m.compose(_p, _q, _s);
  r.applyMatrix4(_m);
  rust.geos.push(r);

  // Four wheels — cylinders rotated to lay on their side.
  const wheelLocal: [number, number, number][] = [
    [ 0.9, -0.4,  1.4],
    [-0.9, -0.4,  1.4],
    [ 0.9, -0.4, -1.4],
    [-0.9, -0.4, -1.4],
  ];
  // Apply car transform to each wheel.
  const carM = new Matrix4().compose(_p.set(cx, yLift, cz), _q.setFromEuler(_e.set(tiltX, yaw, tiltZ)), _s);
  for (const local of wheelLocal) {
    const wg = new CylinderGeometry(0.4, 0.4, 0.3, 10);
    // Rotate cylinder so its axis aligns to the car's local X (rotate Z by 90deg).
    const rot = new Matrix4().makeRotationZ(Math.PI / 2);
    wg.applyMatrix4(rot);
    const trans = new Matrix4().makeTranslation(local[0], local[1], local[2]);
    wg.applyMatrix4(trans);
    wg.applyMatrix4(carM);
    wheels.geos.push(wg);
  }

  // Loose AABB collider for the car body.
  out.push({
    min: [cx - 1.2, 0, cz - 2.2],
    max: [cx + 1.2, 1.6, cz + 2.2],
  });
}

/** Dust particle cloud as a single Points object. */
function makeDust(rng: Rng, bounds: number): Points {
  const COUNT = 2000;
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const half = bounds * 0.5;
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3 + 0] = rng.range(-half, half);
    positions[i * 3 + 1] = rng.range(0.5, 30);
    positions[i * 3 + 2] = rng.range(-half, half);
    velocities[i * 3 + 0] = rng.range(-0.05, 0.05);
    velocities[i * 3 + 1] = rng.range(0.05, 0.18);
    velocities[i * 3 + 2] = rng.range(-0.05, 0.05);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('velocity', new BufferAttribute(velocities, 3));
  const mat = new PointsMaterial({
    size: 0.18,
    color: new Color(0xc8b89a),
    transparent: true,
    opacity: 0.35,
    sizeAttenuation: true,
    depthWrite: false,
  });
  const pts = new Points(geom, mat);
  pts.frustumCulled = false;
  // Mark for the update closure.
  pts.userData.isDust = true;
  pts.userData.bounds = bounds;
  return pts;
}

export function generateCity(opts: GenOpts): CityResult {
  const scene = opts.scene;
  const bounds = opts.bounds ?? 240;
  const blockSize = opts.blockSize ?? 32; // 6x6 grid of blocks ~32m, plus 8m streets between.

  const rng = createRng(opts.seed);
  const colliders: Collider[] = [];
  const buckets = makeBuckets();
  const carBody = { geos: [] as BufferGeometry[] };
  const carRust = { geos: [] as BufferGeometry[] };
  const carWheel = { geos: [] as BufferGeometry[] };

  // -----------------------------------------------------------
  // Block grid — ~6x6 blocks. We compute slot positions and stagger streets.
  // -----------------------------------------------------------
  const gridN = 6;
  const street = 8;
  const stride = blockSize + street;
  const totalSpan = gridN * blockSize + (gridN - 1) * street;
  const startCorner = -totalSpan * 0.5 + blockSize * 0.5;

  for (let gx = 0; gx < gridN; gx++) {
    for (let gz = 0; gz < gridN; gz++) {
      const cx = startCorner + gx * stride;
      const cz = startCorner + gz * stride;

      // Skip the center block — landmark goes there.
      const distFromCenter = Math.hypot(cx, cz);
      if (distFromCenter < blockSize * 0.6) continue;

      // Skip corner blocks — shelters live there.
      const halfB = bounds * 0.5;
      const cornerR = 22;
      if (
        Math.hypot(cx - (-halfB + 18), cz - (-halfB + 18)) < cornerR ||
        Math.hypot(cx - ( halfB - 18), cz - (-halfB + 18)) < cornerR ||
        Math.hypot(cx - (-halfB + 18), cz - ( halfB - 18)) < cornerR ||
        Math.hypot(cx - ( halfB - 18), cz - ( halfB - 18)) < cornerR
      ) continue;

      // 30-35% plazas
      if (rng.chance(0.32)) {
        addPlazaRubble(rng, buckets, cx, cz, blockSize);
        continue;
      }

      // 1-3 buildings per populated block.
      const count = rng.int(1, 3);
      for (let b = 0; b < count; b++) {
        // Subdivide block footprint loosely.
        const subW = blockSize / (count >= 2 ? 2 : 1);
        const subD = blockSize / (count >= 3 ? 2 : 1);
        const slotX = cx + (count >= 2 ? rng.range(-blockSize * 0.25, blockSize * 0.25) : 0);
        const slotZ = cz + (count >= 3 ? rng.range(-blockSize * 0.25, blockSize * 0.25) : 0);
        genBuilding(rng, buckets, slotX, slotZ, subW - 2, subD - 2, colliders);
      }
    }
  }

  // -----------------------------------------------------------
  // Shelters at NW/NE/SW/SE
  // -----------------------------------------------------------
  const shelterInfo = genShelters(buckets, bounds, colliders);

  // -----------------------------------------------------------
  // Center landmark
  // -----------------------------------------------------------
  const landmark = genLandmark(rng, buckets, colliders);

  // -----------------------------------------------------------
  // Crashed cars
  // -----------------------------------------------------------
  const carCount = rng.int(4, 6);
  for (let i = 0; i < carCount; i++) {
    // Spread cars near streets — pick a random grid intersection then nudge.
    const gx = rng.int(0, gridN - 1);
    const gz = rng.int(0, gridN - 1);
    const cx = startCorner + gx * stride + rng.range(-blockSize * 0.4, blockSize * 0.4);
    const cz = startCorner + gz * stride + rng.range(-blockSize * 0.4, blockSize * 0.4);
    addCar(rng, carBody, carRust, carWheel, cx, cz, colliders);
  }

  // -----------------------------------------------------------
  // Merge all buckets into materialized meshes.
  // -----------------------------------------------------------
  const cityGroup = new Group();
  cityGroup.name = 'city';

  const matCache: Record<MatKey, MeshStandardMaterial> = {
    concrete: new MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95, metalness: 0.05 }),
    asphalt:  new MeshStandardMaterial({ color: PALETTE.asphalt,  roughness: 1.0,  metalness: 0.0  }),
    rust:     new MeshStandardMaterial({ color: PALETTE.rust,     roughness: 0.9,  metalness: 0.1  }),
    brick:    new MeshStandardMaterial({ color: PALETTE.brick,    roughness: 1.0,  metalness: 0.0  }),
    metal:    new MeshStandardMaterial({ color: PALETTE.metal,    roughness: 0.85, metalness: 0.1  }),
    debris:   new MeshStandardMaterial({ color: PALETTE.debris,   roughness: 1.0,  metalness: 0.0  }),
  };

  const ownedGeometries: BufferGeometry[] = [];
  const ownedMaterials: MeshStandardMaterial[] = Object.values(matCache);

  function flushBucket(key: MatKey, bucket: GeoBucket): void {
    if (bucket.geos.length === 0) return;
    const merged = mergeGeometries(bucket.geos, false);
    // Free per-piece geometries — they were copied into merged.
    for (const g of bucket.geos) g.dispose();
    bucket.geos.length = 0;
    if (!merged) return;
    ownedGeometries.push(merged);
    const mesh = new Mesh(merged, matCache[key]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cityGroup.add(mesh);
  }

  (Object.keys(buckets) as MatKey[]).forEach((k) => flushBucket(k, buckets[k]));

  // Cars: one mesh for body (metal), one for rust roof, one for wheels (metal but darker — share metal mat).
  function flushCarBucket(geos: BufferGeometry[], mat: MeshStandardMaterial): void {
    if (geos.length === 0) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    geos.length = 0;
    if (!merged) return;
    ownedGeometries.push(merged);
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cityGroup.add(mesh);
  }
  flushCarBucket(carBody.geos, matCache.metal);
  flushCarBucket(carRust.geos, matCache.rust);
  flushCarBucket(carWheel.geos, matCache.metal);

  // -----------------------------------------------------------
  // Rubble — InstancedMesh (one draw call).
  // -----------------------------------------------------------
  const RUBBLE_COUNT = 480;
  const rubbleGeo = new BoxGeometry(1, 1, 1);
  const rubbleMat = new MeshStandardMaterial({ color: PALETTE.debris, roughness: 1.0, metalness: 0.0 });
  ownedGeometries.push(rubbleGeo);
  ownedMaterials.push(rubbleMat);
  const rubble = new InstancedMesh(rubbleGeo, rubbleMat, RUBBLE_COUNT);
  rubble.castShadow = false; // small scattered debris — shadow off for perf
  rubble.receiveShadow = true;
  rubble.instanceMatrix.setUsage(DynamicDrawUsage);

  for (let i = 0; i < RUBBLE_COUNT; i++) {
    const halfB = bounds * 0.5 - 2;
    const px = rng.range(-halfB, halfB);
    const pz = rng.range(-halfB, halfB);
    const sx = rng.range(0.3, 0.8);
    const sy = rng.range(0.2, 0.6);
    const sz = rng.range(0.3, 0.8);
    const ry = rng.next() * Math.PI * 2;
    _q.setFromEuler(_e.set(rng.range(-0.3, 0.3), ry, rng.range(-0.3, 0.3)));
    _p.set(px, sy * 0.5, pz);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    rubble.setMatrixAt(i, _m);
  }
  // restore _s
  _s.set(1, 1, 1);
  rubble.instanceMatrix.needsUpdate = true;
  cityGroup.add(rubble);

  // -----------------------------------------------------------
  // Shelter lights
  // -----------------------------------------------------------
  for (const l of shelterInfo.lights) cityGroup.add(l);

  // -----------------------------------------------------------
  // Fires: PointLight + small emissive cube on scorched ground.
  // -----------------------------------------------------------
  interface FireRec { light: PointLight; mesh: Mesh; base: number; phase: number; speed: number; }
  const fires: FireRec[] = [];
  const fireMat = new MeshStandardMaterial({
    color: 0x1a0d04,
    emissive: new Color(PALETTE.fireGlow),
    emissiveIntensity: 1.4,
    roughness: 1.0,
  });
  ownedMaterials.push(fireMat);
  const fireGeo = new BoxGeometry(0.4, 0.3, 0.4);
  ownedGeometries.push(fireGeo);

  const fireCount = 7;
  for (let i = 0; i < fireCount; i++) {
    const half = bounds * 0.5 - 10;
    const fx = rng.range(-half, half);
    const fz = rng.range(-half, half);
    const baseI = rng.range(1.5, 3.0);
    const light = new PointLight(PALETTE.fireGlow, baseI, 12, 2);
    light.position.set(fx, 1.2, fz);
    light.castShadow = false;
    cityGroup.add(light);

    const mesh = new Mesh(fireGeo, fireMat);
    mesh.position.set(fx, 0.15, fz);
    cityGroup.add(mesh);

    fires.push({
      light,
      mesh,
      base: baseI,
      phase: rng.range(0, Math.PI * 2),
      speed: rng.range(7, 11),
    });
  }

  // -----------------------------------------------------------
  // Dust particles
  // -----------------------------------------------------------
  const dust = makeDust(rng, bounds);
  cityGroup.add(dust);

  // -----------------------------------------------------------
  // Add to scene
  // -----------------------------------------------------------
  scene.add(cityGroup);

  // -----------------------------------------------------------
  // Update closure (host calls each frame). Drives flicker + dust drift.
  // -----------------------------------------------------------
  const dustPos = (dust.geometry.getAttribute('position') as BufferAttribute);
  const dustVel = (dust.geometry.getAttribute('velocity') as BufferAttribute);
  let lastT = 0;

  function update(t: number): void {
    const dt = Math.max(0, Math.min(0.1, t - lastT));
    lastT = t;

    // Flicker fires.
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      // Sum two sines + a cheap pseudo-noise from sin(t*large). Range ~ 0.7..1.3 of base.
      const a = Math.sin(t * f.speed + f.phase);
      const b = Math.sin(t * (f.speed * 0.4 + 1) + f.phase * 1.7);
      const flick = 1 + 0.22 * a + 0.12 * b;
      f.light.intensity = f.base * flick;
      // Subtle emissive pulse on the ground cube too.
      (f.mesh.material as MeshStandardMaterial).emissiveIntensity = 1.1 + 0.4 * a;
    }

    // Drift dust upward, recycle when above 32m.
    const arr = dustPos.array as Float32Array;
    const v = dustVel.array as Float32Array;
    const half = bounds * 0.5;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 0] += v[i + 0] * dt;
      arr[i + 1] += v[i + 1] * dt;
      arr[i + 2] += v[i + 2] * dt;
      if (arr[i + 1] > 32) {
        arr[i + 0] = (((arr[i + 0] + half) % (half * 2)) + half * 2) % (half * 2) - half;
        arr[i + 1] = 0.5;
        arr[i + 2] = (((arr[i + 2] + half) % (half * 2)) + half * 2) % (half * 2) - half;
      }
    }
    dustPos.needsUpdate = true;
  }

  // -----------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------
  function dispose(): void {
    scene.remove(cityGroup);
    cityGroup.traverse((child: Object3D) => {
      if ((child as Mesh).isMesh || (child as InstancedMesh).isInstancedMesh) {
        // geometries / materials freed below via ownedGeometries/ownedMaterials
      }
    });
    for (const g of ownedGeometries) g.dispose();
    for (const m of ownedMaterials) m.dispose();
    // Dust geometry/material aren't in owned lists — dispose explicitly.
    dust.geometry.dispose();
    (dust.material as PointsMaterial).dispose();
  }

  return {
    colliders,
    shelters: shelterInfo.shelters,
    landmark,
    update,
    dispose,
  };
}
