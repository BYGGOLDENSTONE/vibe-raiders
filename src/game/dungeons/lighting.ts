// Dungeon lighting — flickering torches per room + soft ambient. Adds atmosphere.

import {
  AmbientLight,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
} from 'three';
import type { DungeonLayout, RoomDef } from './layout';
import { rangeRng } from './rng';

export interface TorchRig {
  light: PointLight;
  flameMat: MeshStandardMaterial;
  baseIntensity: number;
  baseEmissive: number;
  flickerPhase: number;
  flickerSpeed: number;
}

export interface DungeonLightingRig {
  group: Group;
  torches: TorchRig[];
  ambient: AmbientLight;
}

export function buildDungeonLighting(layout: DungeonLayout, rng: () => number): DungeonLightingRig {
  const group = new Group();
  group.name = 'dungeon-lighting';

  // Ambient: very dim red-orange for the whole dungeon.
  const ambient = new AmbientLight(0x402015, 0.18);
  group.add(ambient);

  const torches: TorchRig[] = [];

  for (const room of layout.rooms) {
    const torchPositions = pickTorchPositions(room, rng);
    for (const pos of torchPositions) {
      const rig = buildTorch(rng);
      rig.light.position.set(pos.x, pos.y, pos.z);
      // Move the visual sconce too:
      const visual = rig.light.userData.visual as Group | undefined;
      if (visual) {
        visual.position.set(pos.x, pos.y - 0.4, pos.z);
        // Face the wall it's on (orient the bracket).
        visual.rotation.y = pos.facingY;
        group.add(visual);
      }
      group.add(rig.light);
      torches.push(rig);
    }
  }

  return { group, torches, ambient };
}

interface TorchSlot {
  x: number;
  y: number;
  z: number;
  facingY: number;
}

function pickTorchPositions(room: RoomDef, rng: () => number): TorchSlot[] {
  const slots: TorchSlot[] = [];
  const y = Math.min(room.height - 0.8, 2.4);
  const inset = 0.6;
  const isBoss = room.kind === 'boss';
  const count = isBoss ? 6 : room.kind === 'entrance' ? 2 : 3;

  // Slots along east + west walls.
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const t = (i + 1) / (count + 1);
    const z = -room.hz + (room.hz * 2) * t;
    slots.push({
      x: room.cx + side * (room.hx - inset),
      y,
      z: room.cz + z + rangeRng(rng, -0.5, 0.5),
      facingY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  }
  return slots;
}

function buildTorch(rng: () => number): TorchRig {
  const visual = new Group();

  // Bracket.
  const bracketMat = new MeshStandardMaterial({ color: 0x202020, roughness: 0.6, metalness: 0.4 });
  const bracket = new Mesh(new CylinderGeometry(0.04, 0.04, 0.5, 6), bracketMat);
  bracket.rotation.z = Math.PI / 2;
  bracket.position.set(0, 0, 0);
  visual.add(bracket);

  // Wood handle.
  const handleMat = new MeshStandardMaterial({ color: 0x3a2010, roughness: 0.95 });
  const handle = new Mesh(new CylinderGeometry(0.05, 0.05, 0.35, 6), handleMat);
  handle.position.set(0.18, 0.1, 0);
  visual.add(handle);

  // Flame — emissive sphere.
  const flameMat = new MeshStandardMaterial({
    color: 0xffb060,
    emissive: 0xff7020,
    emissiveIntensity: 2.4,
    roughness: 0.4,
  });
  const flame = new Mesh(new SphereGeometry(0.13, 10, 8), flameMat);
  flame.position.set(0.18, 0.32, 0);
  visual.add(flame);

  const baseIntensity = 1.6 + rangeRng(rng, -0.2, 0.2);
  const light = new PointLight(0xff8040, baseIntensity, 9, 1.7);
  light.userData.visual = visual;

  return {
    light,
    flameMat,
    baseIntensity,
    baseEmissive: 2.4,
    flickerPhase: rng() * Math.PI * 2,
    flickerSpeed: rangeRng(rng, 5, 10),
  };
}

export function tickTorches(rig: DungeonLightingRig, elapsed: number, dt: number): void {
  for (const t of rig.torches) {
    t.flickerPhase += dt * t.flickerSpeed;
    const noise = Math.sin(t.flickerPhase) * 0.5 + Math.sin(t.flickerPhase * 2.3 + 1.4) * 0.3;
    const j = 1 + noise * 0.18;
    t.light.intensity = t.baseIntensity * j;
    t.flameMat.emissiveIntensity = t.baseEmissive * (0.85 + noise * 0.25);
  }
  // Suppress unused param warning for elapsed (kept for API symmetry).
  void elapsed;
}
