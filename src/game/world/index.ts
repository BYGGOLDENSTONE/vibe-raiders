// Wave 0 baseline: empty ground + ambient/moonlight + sky fog.
// Wave 1 agent will replace this with a procgen gothic graveyard biome:
// instanced gravestones, ruined walls, dead trees, ground decals, cobblestone paths.

import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { COLORS, TUNING } from '../constants';
import type { GameContext } from '../state';

export function initWorld(ctx: GameContext): void {
  const ground = new Mesh(
    new PlaneGeometry(TUNING.worldRadius * 2, TUNING.worldRadius * 2, 1, 1),
    new MeshStandardMaterial({ color: COLORS.ground, roughness: 1.0, metalness: 0.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.name = 'ground-base';
  ctx.scene.add(ground);

  const ambient = new AmbientLight(COLORS.ambient, 0.45);
  ctx.scene.add(ambient);

  const moon = new DirectionalLight(COLORS.moonlight, 0.7);
  moon.position.set(50, 80, 30);
  moon.name = 'moon';
  ctx.scene.add(moon);

  const hemi = new HemisphereLight(0x6066a0, 0x1a1820, 0.35);
  ctx.scene.add(hemi);
}
