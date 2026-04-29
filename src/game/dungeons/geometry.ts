// Builds the dungeon mesh hierarchy: floors, walls, ceilings, pillars, rubble, dais.
// All geometry is parented under one Group; the caller positions it at DUNGEON_ORIGIN.
//
// Polish pass:
//  - Floor: subdivided plane with FBM-noise vertex displacement (cracked stone feel).
//  - Boss-room floor: crimson-vein procedural shader on a wider darker base.
//  - Boss arena extras: blood pool decal, scattered bones, broken columns, raised dais.
//  - Wall sconces: bigger emissive flame plumes added beside each torch slot
//    (handled inside lighting.ts; here we leave hooks).

import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  SphereGeometry,
  type BufferAttribute,
  type Material,
} from 'three';
import type { DungeonLayout, RoomDef, CorridorSegment } from './layout';
import { rangeRng, intRangeRng } from './rng';

const STONE = 0x3a3a42;
const STONE_LIGHT = 0x4d4a52;
const FLOOR = 0x24222a;
const FLOOR_DARK = 0x1a181f;
const RUBBLE = 0x2a2830;
const DAIS = 0x4a3030;
const BLOOD = 0x5a0a0a;
const BONE = 0xb8a890;

const stoneMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: STONE, roughness: 0.95, metalness: 0.02 });
const stoneLightMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: STONE_LIGHT, roughness: 0.9, metalness: 0.04 });
const ceilingMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.95, metalness: 0.0 });
const rubbleMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: RUBBLE, roughness: 0.95, metalness: 0.02 });
const daisMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: DAIS,
    roughness: 0.6,
    metalness: 0.15,
    emissive: 0x401510,
    emissiveIntensity: 0.2,
  });
const boneMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: BONE, roughness: 0.7, metalness: 0.05 });
const bloodMat = (): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color: BLOOD,
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
    depthWrite: false,
  });

const WALL_THICK = 0.5;
const FLOOR_SEGS = 32;

// ─── Procedural floor shaders ─────────────────────────────────────────────

// Standard cracked-stone floor: dark base with subtle mossy/dust speckle and
// crimson hairline veins where damage="0" — uses a light fragment shader on
// top of MeshStandardMaterial via onBeforeCompile would clash with mood;
// we use a custom ShaderMaterial that approximates lit stone (n.dot(L) +
// ambient term) so the dungeon ambient + torches still read.
//
// To keep cost low we use MeshStandardMaterial with vertex-color "vein"
// pre-bake for normal floors, and a bespoke ShaderMaterial for the boss
// floor where the veins should pulse.

function buildBossFloorMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: new Color(0x10080a) },
      uVein: { value: new Color(0x8a1010) },
      uGlow: { value: new Color(0xff3020) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vNormal;
      uniform float uTime;
      uniform vec3 uBase;
      uniform vec3 uVein;
      uniform vec3 uGlow;

      // Hash + value noise — cheap.
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vUv * 8.0;
        float n = fbm(p);
        // Vein mask: ridged noise.
        float r = abs(fbm(p * 1.3 + vec2(0.0, uTime * 0.05)) - 0.5) * 2.0;
        float vein = smoothstep(0.55, 0.05, r);
        float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + n * 6.0);
        vec3 base = mix(uBase, uBase * 1.4, n);
        vec3 col = mix(base, uVein, vein * 0.85);
        col += uGlow * vein * pulse * 0.7;
        // Cheap directional shading from up-axis (floor faces +Y in world).
        float ndotl = clamp(vNormal.y * 0.5 + 0.5, 0.0, 1.0);
        col *= 0.55 + 0.45 * ndotl;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function buildFloorMaterial(isBoss: boolean): MeshStandardMaterial | ShaderMaterial {
  if (isBoss) return buildBossFloorMaterial();
  return new MeshStandardMaterial({
    color: FLOOR,
    roughness: 0.95,
    metalness: 0.05,
    vertexColors: true,
    emissive: 0x180404,
    emissiveIntensity: 0.15,
  });
}

// Build a displaced floor plane with vertex-color crimson veins.
function buildDisplacedFloor(w: number, d: number, isBoss: boolean): Mesh {
  const geom = new PlaneGeometry(w, d, FLOOR_SEGS, FLOOR_SEGS);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  // Cheap FBM via 3 sine layers (deterministic, no rng needed).
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Skip jitter at edges so walls flush.
    const edgeX = 1 - Math.min(1, Math.abs(x) / (w / 2 - 0.4));
    const edgeZ = 1 - Math.min(1, Math.abs(z) / (d / 2 - 0.4));
    const edge = Math.min(edgeX, edgeZ);
    const inset = Math.max(0, edge);
    const n =
      Math.sin(x * 0.9 + z * 0.7) * 0.04 +
      Math.sin(x * 1.7 - z * 1.3 + 1.2) * 0.025 +
      Math.sin(x * 3.1 + z * 2.7 + 2.4) * 0.012;
    pos.setY(i, n * inset);

    // Vertex-color veins for non-boss rooms (boss uses ShaderMaterial).
    if (!isBoss) {
      const veinNoise = Math.abs(Math.sin(x * 0.5 + z * 0.3) + Math.sin(z * 0.7 - x * 0.4));
      const v = Math.max(0, 1 - veinNoise * 1.5);
      const r = 0.14 + v * 0.45;
      const g = 0.13 + v * 0.05;
      const b = 0.16;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    } else {
      colors[i * 3] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
    }
  }
  geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const mat = buildFloorMaterial(isBoss);
  const mesh = new Mesh(geom, mat);
  mesh.position.y = 0;
  mesh.userData.dungeonFloorBoss = isBoss;
  return mesh;
}

// ─── Public entry ─────────────────────────────────────────────────────────

export function buildDungeonGeometry(layout: DungeonLayout, rng: () => number): Group {
  const group = new Group();
  group.name = 'dungeon-geometry';

  for (const room of layout.rooms) {
    group.add(buildRoom(room, rng));
  }

  for (const seg of layout.corridors) {
    group.add(buildCorridor(seg));
  }

  return group;
}

function buildRoom(room: RoomDef, rng: () => number): Group {
  const g = new Group();
  g.name = room.id;
  g.position.set(room.cx, 0, room.cz);

  const w = room.hx * 2;
  const d = room.hz * 2;
  const h = room.height;

  // Floor — displaced, vertex-colored. Boss room uses pulsing-vein shader.
  const floor = buildDisplacedFloor(w, d, room.kind === 'boss');
  g.add(floor);

  // Underlay: a flat dark base 0.4m below visible floor — fills the displacement
  // pockets so the player never sees through to nothing.
  const underMat = new MeshStandardMaterial({
    color: room.kind === 'boss' ? FLOOR_DARK : FLOOR,
    roughness: 1.0,
  });
  const under = new Mesh(new BoxGeometry(w, 0.3, d), underMat);
  under.position.y = -0.2;
  g.add(under);

  // Ceiling.
  const ceiling = new Mesh(new BoxGeometry(w, 0.4, d), ceilingMat());
  ceiling.position.y = h + 0.2;
  g.add(ceiling);

  // Walls. Doorway gaps as before; walls scale with new heights.
  const doorwayWidth = 3.6;

  if (room.kind !== 'entrance') {
    const segLen = (w - doorwayWidth) / 2;
    if (segLen > 0) {
      const wL = new Mesh(new BoxGeometry(segLen, h, WALL_THICK), stoneMat());
      wL.position.set(-(doorwayWidth / 2 + segLen / 2), h / 2, -room.hz);
      g.add(wL);
      const wR = new Mesh(new BoxGeometry(segLen, h, WALL_THICK), stoneMat());
      wR.position.set(doorwayWidth / 2 + segLen / 2, h / 2, -room.hz);
      g.add(wR);
    }
  } else {
    const south = new Mesh(new BoxGeometry(w, h, WALL_THICK), stoneMat());
    south.position.set(0, h / 2, -room.hz);
    g.add(south);
  }

  if (room.kind !== 'boss') {
    const segLen = (w - doorwayWidth) / 2;
    if (segLen > 0) {
      const wL = new Mesh(new BoxGeometry(segLen, h, WALL_THICK), stoneMat());
      wL.position.set(-(doorwayWidth / 2 + segLen / 2), h / 2, room.hz);
      g.add(wL);
      const wR = new Mesh(new BoxGeometry(segLen, h, WALL_THICK), stoneMat());
      wR.position.set(doorwayWidth / 2 + segLen / 2, h / 2, room.hz);
      g.add(wR);
    }
  } else {
    const north = new Mesh(new BoxGeometry(w, h, WALL_THICK), stoneMat());
    north.position.set(0, h / 2, room.hz);
    g.add(north);
  }

  const east = new Mesh(new BoxGeometry(WALL_THICK, h, d), stoneLightMat());
  east.position.set(room.hx, h / 2, 0);
  g.add(east);
  const west = new Mesh(new BoxGeometry(WALL_THICK, h, d), stoneLightMat());
  west.position.set(-room.hx, h / 2, 0);
  g.add(west);

  // Decorations.
  if (room.kind === 'fight' || room.kind === 'entrance') {
    addPillars(g, room, rng);
    addRubble(g, room, rng);
  }
  if (room.kind === 'boss') {
    addBossArenaSet(g, room, rng);
  }

  return g;
}

function addPillars(g: Group, room: RoomDef, rng: () => number): void {
  const inset = 1.5;
  const positions: Array<[number, number]> = [
    [-room.hx + inset, room.hz - inset],
    [room.hx - inset, room.hz - inset],
    [-room.hx + inset, -room.hz + inset],
    [room.hx - inset, -room.hz + inset],
  ];
  for (const [x, z] of positions) {
    if (rng() < 0.25) continue;
    const radius = rangeRng(rng, 0.32, 0.42);
    const p = new Mesh(
      new CylinderGeometry(radius, radius * 1.15, room.height, 10),
      stoneLightMat(),
    );
    p.position.set(x, room.height / 2, z);
    g.add(p);
  }
}

function addRubble(g: Group, room: RoomDef, rng: () => number): void {
  const count = intRangeRng(rng, 3, 6);
  for (let i = 0; i < count; i++) {
    const sx = rangeRng(rng, 0.4, 0.9);
    const sy = rangeRng(rng, 0.25, 0.55);
    const sz = rangeRng(rng, 0.4, 0.9);
    const r = new Mesh(new BoxGeometry(sx, sy, sz), rubbleMat());
    const rx = rangeRng(rng, -room.hx + 1, room.hx - 1);
    const rz = rangeRng(rng, -room.hz + 1, room.hz - 1);
    r.position.set(rx, sy / 2, rz);
    r.rotation.y = rng() * Math.PI;
    r.rotation.z = rangeRng(rng, -0.3, 0.3);
    g.add(r);
  }
}

// ─── Boss arena extras ────────────────────────────────────────────────────

function addBossArenaSet(g: Group, room: RoomDef, rng: () => number): void {
  // Raised dais at +Z end.
  addBossDais(g, room);

  // Blood pool decal at center.
  addBloodPool(g, room);

  // Scattered bones across the floor.
  addBones(g, room, rng);

  // 2 broken columns flanking the dais, plus ambient stub columns.
  addBrokenColumns(g, room, rng);

  // A handful of rubble for chaos.
  addRubble(g, room, rng);
}

function addBossDais(g: Group, room: RoomDef): void {
  // Two-step raised dais at +Z end.
  const daisDepth = 4.5;
  const daisWidth = room.hx * 1.4;
  const baseH = 0.5;
  const topH = 0.4;

  // Wide stepped base.
  const base = new Mesh(new BoxGeometry(daisWidth + 0.6, baseH, daisDepth + 0.6), daisMat());
  base.position.set(0, baseH / 2, room.hz - daisDepth / 2 - 0.5);
  g.add(base);

  // Inner platform on top.
  const top = new Mesh(new BoxGeometry(daisWidth, topH, daisDepth), daisMat());
  top.position.set(0, baseH + topH / 2, room.hz - daisDepth / 2 - 0.5);
  g.add(top);

  // Cylindrical centerpiece — a dark brazier ring on the dais.
  const centerMat = new MeshStandardMaterial({
    color: 0x300810,
    roughness: 0.5,
    metalness: 0.3,
    emissive: 0xff3010,
    emissiveIntensity: 0.7,
  });
  const center = new Mesh(new CylinderGeometry(0.55, 0.7, 0.3, 16), centerMat);
  center.position.set(0, baseH + topH + 0.15, room.hz - daisDepth / 2 - 0.5);
  g.add(center);

  // Two glowing brazier cubes on dais corners.
  const brazierMat = new MeshStandardMaterial({
    color: 0x6a2010,
    roughness: 0.5,
    metalness: 0.2,
    emissive: 0xff5020,
    emissiveIntensity: 1.6,
  });
  for (const side of [-1, 1]) {
    const b = new Mesh(new BoxGeometry(0.5, 0.7, 0.5), brazierMat);
    b.position.set(side * (daisWidth / 2 - 0.6), baseH + topH + 0.35, room.hz - 0.9);
    g.add(b);
  }
}

function addBloodPool(g: Group, room: RoomDef): void {
  // 5m radius blood pool decal centered slightly toward dais (so the boss arena
  // feels stained). Disc + outer fuzz ring.
  const diskGeom = new CircleGeometry(2.4, 36);
  diskGeom.rotateX(-Math.PI / 2);
  const disk = new Mesh(diskGeom, bloodMat());
  disk.position.set(0, 0.012, room.hz * 0.15);
  g.add(disk);

  const fuzzMat = new MeshBasicMaterial({
    color: 0x3a0606,
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const fuzzGeom = new CircleGeometry(3.4, 32);
  fuzzGeom.rotateX(-Math.PI / 2);
  const fuzz = new Mesh(fuzzGeom, fuzzMat);
  fuzz.position.copy(disk.position);
  fuzz.position.y = 0.008;
  g.add(fuzz);

  // A few darker droplet spots scattered.
  const dropMat = new MeshBasicMaterial({
    color: 0x200404,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: DoubleSide,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const r = 2.6 + Math.random() * 1.5;
    const dGeom = new CircleGeometry(0.25 + Math.random() * 0.4, 12);
    dGeom.rotateX(-Math.PI / 2);
    const d = new Mesh(dGeom, dropMat);
    d.position.set(Math.cos(a) * r, 0.014, room.hz * 0.15 + Math.sin(a) * r);
    g.add(d);
  }
}

function addBones(g: Group, room: RoomDef, rng: () => number): void {
  const count = intRangeRng(rng, 7, 11);
  const mat = boneMat();
  for (let i = 0; i < count; i++) {
    const cluster = new Group();
    // A simple "bone pile" = elongated capsule + 1-2 spheres.
    const long = new Mesh(new CapsuleGeometry(0.06, rangeRng(rng, 0.45, 0.95), 4, 6), mat);
    long.rotation.x = Math.PI / 2;
    long.rotation.y = rng() * Math.PI;
    cluster.add(long);
    if (rng() < 0.7) {
      const skull = new Mesh(new SphereGeometry(0.14, 8, 8), mat);
      skull.position.set(
        rangeRng(rng, -0.25, 0.25),
        rangeRng(rng, 0.05, 0.18),
        rangeRng(rng, -0.25, 0.25),
      );
      skull.scale.set(1, 0.9, 1.1);
      cluster.add(skull);
    }
    if (rng() < 0.5) {
      const rib = new Mesh(new CylinderGeometry(0.04, 0.04, 0.4, 5), mat);
      rib.rotation.z = Math.PI / 2;
      rib.position.set(rangeRng(rng, -0.2, 0.2), 0.05, rangeRng(rng, -0.2, 0.2));
      cluster.add(rib);
    }
    cluster.position.set(
      rangeRng(rng, -room.hx + 1.5, room.hx - 1.5),
      0.05,
      rangeRng(rng, -room.hz + 1.5, room.hz - 4.5),
    );
    cluster.rotation.y = rng() * Math.PI * 2;
    g.add(cluster);
  }
}

function addBrokenColumns(g: Group, room: RoomDef, rng: () => number): void {
  // 2 prominent broken columns flanking center — visible silhouettes.
  for (const side of [-1, 1]) {
    const colGroup = new Group();
    const baseH = rangeRng(rng, 1.6, 2.4);
    const baseR = 0.55;
    const stub = new Mesh(
      new CylinderGeometry(baseR, baseR * 1.2, baseH, 12),
      stoneLightMat(),
    );
    stub.position.set(0, baseH / 2, 0);
    colGroup.add(stub);
    // Broken-top jagged stone (a tilted wedge box on top).
    const cap = new Mesh(
      new BoxGeometry(baseR * 1.6, 0.6, baseR * 1.6),
      stoneMat(),
    );
    cap.position.set(rangeRng(rng, -0.15, 0.15), baseH + 0.3, rangeRng(rng, -0.15, 0.15));
    cap.rotation.set(rangeRng(rng, -0.25, 0.25), rng() * Math.PI, rangeRng(rng, -0.25, 0.25));
    colGroup.add(cap);
    colGroup.position.set(side * (room.hx * 0.55), 0, room.hz * 0.05);
    g.add(colGroup);
  }

  // Ambient short stubs along the side walls.
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -room.hz + 2 + (i < 2 ? 0 : room.hz);
    const stub = new Mesh(
      new CylinderGeometry(0.5, 0.6, rangeRng(rng, 1.0, 2.0), 10),
      stoneLightMat(),
    );
    stub.position.set(side * (room.hx - 1.2), 0.6, z);
    g.add(stub);
  }
}

// ─── Corridor ─────────────────────────────────────────────────────────────

function buildCorridor(seg: CorridorSegment): Group {
  const g = new Group();
  g.name = 'corridor';

  const dx = seg.to.x - seg.from.x;
  const dz = seg.to.y - seg.from.y;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return g;

  const angle = Math.atan2(dx, dz);
  const cx = (seg.from.x + seg.to.x) / 2;
  const cz = (seg.from.y + seg.to.y) / 2;
  const w = seg.width;
  const h = 3.8;

  const floor = new Mesh(
    new BoxGeometry(w, 0.4, len),
    new MeshStandardMaterial({ color: FLOOR, roughness: 0.95, metalness: 0.02 }),
  );
  floor.position.set(cx, -0.2, cz);
  floor.rotation.y = angle;
  g.add(floor);

  const ceiling = new Mesh(new BoxGeometry(w, 0.4, len), ceilingMat());
  ceiling.position.set(cx, h + 0.2, cz);
  ceiling.rotation.y = angle;
  g.add(ceiling);

  const px = Math.cos(angle);
  const pz = -Math.sin(angle);
  const half = w / 2;

  const wallA = new Mesh(new BoxGeometry(WALL_THICK, h, len), stoneMat());
  wallA.position.set(cx + px * half, h / 2, cz + pz * half);
  wallA.rotation.y = angle;
  g.add(wallA);

  const wallB = new Mesh(new BoxGeometry(WALL_THICK, h, len), stoneMat());
  wallB.position.set(cx - px * half, h / 2, cz - pz * half);
  wallB.rotation.y = angle;
  g.add(wallB);

  return g;
}

// ─── Per-frame: pulse boss-floor shader uTime ─────────────────────────────

export function tickDungeonGeometry(group: Group, elapsed: number): void {
  group.traverse((o) => {
    if (o instanceof Mesh && o.userData.dungeonFloorBoss) {
      const m = o.material as ShaderMaterial;
      if ('uniforms' in m && m.uniforms.uTime) m.uniforms.uTime.value = elapsed;
    }
  });
}

// Disposes all geometry/materials from a dungeon group.
export function disposeDungeonGroup(group: Group): void {
  group.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      const m = obj.material as Material | Material[];
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m.dispose();
    }
  });
}
