// Builds the dungeon mesh hierarchy: floors, walls, ceilings, pillars, rubble, dais.
// All geometry is parented under one Group; the caller positions it at DUNGEON_ORIGIN.

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
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

const stoneMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: STONE, roughness: 0.95, metalness: 0.02 });
const stoneLightMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: STONE_LIGHT, roughness: 0.9, metalness: 0.04 });
const floorMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: FLOOR, roughness: 0.95, metalness: 0.02 });
const floorDarkMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: FLOOR_DARK, roughness: 0.95, metalness: 0.0 });
const rubbleMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: RUBBLE, roughness: 0.95, metalness: 0.02 });
const daisMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: DAIS,
    roughness: 0.7,
    metalness: 0.1,
    emissive: 0x401510,
    emissiveIntensity: 0.15,
  });

const WALL_THICK = 0.5;

export function buildDungeonGeometry(layout: DungeonLayout, rng: () => number): Group {
  const group = new Group();
  group.name = 'dungeon-geometry';

  // Build each room.
  for (const room of layout.rooms) {
    group.add(buildRoom(room, rng));
  }

  // Build corridors between rooms (walls + floor strip).
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

  // Floor.
  const floor = new Mesh(
    new BoxGeometry(w, 0.4, d),
    room.kind === 'boss' ? floorDarkMat() : floorMat(),
  );
  floor.position.y = -0.2;
  g.add(floor);

  // Ceiling.
  const ceiling = new Mesh(new BoxGeometry(w, 0.4, d), stoneMat());
  ceiling.position.y = h + 0.2;
  g.add(ceiling);

  // Walls — N, S, E, W. Doorways are punched by leaving gaps; we model walls
  // as solid blocks for the jam — corridor floor visually masks the gap.
  // Use 4 wall meshes, but break N/S into two segments to leave a doorway gap
  // on the +Z side (entrance is doorway-less).
  const doorwayWidth = 3.6;

  // South wall (toward -Z) — leave doorway except for entrance/boss back.
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

  // North wall — leave doorway except for boss back.
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

  // East / west walls — solid, full length.
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
    addBossDais(g, room);
    addRubble(g, room, rng);
    addBrokenColumns(g, room, rng);
  }

  return g;
}

function addPillars(g: Group, room: RoomDef, rng: () => number): void {
  // 4 pillars in corners-ish, inset from walls.
  const inset = 1.5;
  const positions = [
    [-room.hx + inset, room.hz - inset],
    [room.hx - inset, room.hz - inset],
    [-room.hx + inset, -room.hz + inset],
    [room.hx - inset, -room.hz + inset],
  ];
  for (const [x, z] of positions) {
    if (rng() < 0.25) continue; // sometimes skip a pillar
    const radius = rangeRng(rng, 0.32, 0.42);
    const p = new Mesh(
      new CylinderGeometry(radius, radius * 1.15, room.height, 10),
      stoneLightMat(),
    );
    p.position.set(x!, room.height / 2, z!);
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
    // Spread in inner area, away from doorways.
    const rx = rangeRng(rng, -room.hx + 1, room.hx - 1);
    const rz = rangeRng(rng, -room.hz + 1, room.hz - 1);
    r.position.set(rx, sy / 2, rz);
    r.rotation.y = rng() * Math.PI;
    r.rotation.z = rangeRng(rng, -0.3, 0.3);
    g.add(r);
  }
}

function addBossDais(g: Group, room: RoomDef): void {
  // Raised platform at the far (+Z) end of the boss room.
  const daisDepth = 4.5;
  const daisWidth = room.hx * 1.4;
  const daisHeight = 0.6;
  const dais = new Mesh(new BoxGeometry(daisWidth, daisHeight, daisDepth), daisMat());
  dais.position.set(0, daisHeight / 2, room.hz - daisDepth / 2 - 0.5);
  g.add(dais);

  // Two glowing brazier-like cubes on the dais (tiny emissive beacons).
  const brazierMat = new MeshStandardMaterial({
    color: 0x6a2010,
    roughness: 0.5,
    metalness: 0.2,
    emissive: 0xff5020,
    emissiveIntensity: 1.4,
  });
  for (const side of [-1, 1]) {
    const b = new Mesh(new BoxGeometry(0.5, 0.7, 0.5), brazierMat);
    b.position.set(side * (daisWidth / 2 - 0.6), daisHeight + 0.35, room.hz - 0.9);
    g.add(b);
  }
}

function addBrokenColumns(g: Group, room: RoomDef, rng: () => number): void {
  // 4 broken column stumps along the boss room walls for atmosphere.
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -room.hz + 2 + (i < 2 ? 0 : room.hz);
    const stub = new Mesh(
      new CylinderGeometry(0.5, 0.6, rangeRng(rng, 1.2, 2.2), 10),
      stoneLightMat(),
    );
    stub.position.set(side * (room.hx - 1.2), 0.6, z);
    g.add(stub);
  }
}

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
  const h = 3.5;

  // Floor (oriented along segment).
  const floor = new Mesh(new BoxGeometry(w, 0.4, len), floorMat());
  floor.position.set(cx, -0.2, cz);
  floor.rotation.y = angle;
  g.add(floor);

  // Ceiling.
  const ceiling = new Mesh(new BoxGeometry(w, 0.4, len), stoneMat());
  ceiling.position.set(cx, h + 0.2, cz);
  ceiling.rotation.y = angle;
  g.add(ceiling);

  // Side walls — translate ± half width perpendicular to direction.
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

// Disposes all geometry/materials from a dungeon group. Called if we ever
// regenerate; current zone-exit flow leaves the dungeon resident.
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

