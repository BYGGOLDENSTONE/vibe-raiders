// Procgen dungeon layout — linear chain: entrance → 3 fight rooms → boss room.
// All positions are in dungeon-local space (group-relative).

import { Vector2 } from 'three';
import { intRangeRng, rangeRng } from './rng';

export interface RoomDef {
  id: string;
  kind: 'entrance' | 'fight' | 'boss';
  // Floor center (xz, local).
  cx: number;
  cz: number;
  // Half-extents (xz).
  hx: number;
  hz: number;
  // Wall height.
  height: number;
  // Used by spawn / decoration.
  index: number;
}

export interface CorridorSegment {
  from: Vector2;
  to: Vector2;
  width: number;
}

export interface DungeonLayout {
  rooms: RoomDef[];
  corridors: CorridorSegment[];
  // Player start (in dungeon-local space).
  spawn: Vector2;
  // Where boss arena center is — used by exit portal placement etc.
  bossCenter: Vector2;
}

export function generateLayout(rng: () => number): DungeonLayout {
  const rooms: RoomDef[] = [];
  const corridors: CorridorSegment[] = [];

  // Walk forward along +Z, alternating slight x-jitter.
  let cursorZ = 0;
  let cursorX = 0;

  const ROOM_COUNT = 5;
  const KINDS: RoomDef['kind'][] = ['entrance', 'fight', 'fight', 'fight', 'boss'];

  let prevCenter: Vector2 | null = null;
  let prevHalfZ = 0;

  for (let i = 0; i < ROOM_COUNT; i++) {
    const kind = KINDS[i]!;
    const isBoss = kind === 'boss';
    const isEntrance = kind === 'entrance';

    // Sizes per kind. Ceiling height varies per kind for vertical interest.
    // Polish target: spawn 4m, transition (mid fight) 6m, savaş 5m, geçit 3m, boss 8m.
    let hx: number, hz: number, height: number;
    if (isBoss) {
      hx = rangeRng(rng, 8, 10);
      hz = rangeRng(rng, 8, 10);
      height = 8.0;
    } else if (isEntrance) {
      hx = rangeRng(rng, 4.5, 5.5);
      hz = rangeRng(rng, 4.5, 5.5);
      height = 4.0;
    } else {
      hx = rangeRng(rng, 4, 7);
      hz = rangeRng(rng, 4, 7);
      // Alternate fight rooms: index 1 = high transition, 2 = lower passage, 3 = standard
      if (i === 1) height = 6.0;
      else if (i === 2) height = 3.0;
      else height = 5.0;
    }

    // Corridor between previous room and this one.
    const corridorLen = isEntrance ? 0 : rangeRng(rng, 6, 10);

    // Forward step: half of previous + corridor + half of new.
    cursorZ += prevHalfZ + corridorLen + hz;
    // Slight x jitter so it isn't a perfectly straight line.
    if (!isEntrance) cursorX += rangeRng(rng, -2.5, 2.5);

    const cx = cursorX;
    const cz = cursorZ;

    rooms.push({
      id: `room-${i}-${kind}`,
      kind,
      cx,
      cz,
      hx,
      hz,
      height,
      index: i,
    });

    if (prevCenter && !isEntrance) {
      // 2-3 corridor segments between rooms — winding feel.
      const segCount = intRangeRng(rng, 2, 3);
      const start = new Vector2(prevCenter.x, prevCenter.y + prevHalfZ);
      const end = new Vector2(cx, cz - hz);
      const width = rangeRng(rng, 3, 4);

      if (segCount === 2) {
        // L-shape via mid-Z step
        const midZ = (start.y + end.y) * 0.5;
        const mid = new Vector2(start.x, midZ);
        const mid2 = new Vector2(end.x, midZ);
        corridors.push({ from: start, to: mid, width });
        corridors.push({ from: mid, to: mid2, width });
        corridors.push({ from: mid2, to: end, width });
      } else {
        // 3 small staggered straight segments
        const aZ = start.y + (end.y - start.y) * 0.33;
        const bZ = start.y + (end.y - start.y) * 0.66;
        const ax = start.x + (end.x - start.x) * 0.33;
        const bx = start.x + (end.x - start.x) * 0.66;
        const a = new Vector2(start.x, aZ);
        const a2 = new Vector2(ax, aZ);
        const b = new Vector2(ax, bZ);
        const b2 = new Vector2(bx, bZ);
        corridors.push({ from: start, to: a, width });
        corridors.push({ from: a, to: a2, width });
        corridors.push({ from: a2, to: b, width });
        corridors.push({ from: b, to: b2, width });
        corridors.push({ from: b2, to: end, width });
      }
    }

    prevCenter = new Vector2(cx, cz);
    prevHalfZ = hz;
  }

  const entrance = rooms[0]!;
  const boss = rooms[rooms.length - 1]!;

  return {
    rooms,
    corridors,
    spawn: new Vector2(entrance.cx, entrance.cz),
    bossCenter: new Vector2(boss.cx, boss.cz),
  };
}
