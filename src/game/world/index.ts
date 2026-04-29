// Procgen gothic graveyard biome.
// Terrain (displaced + vertex-colored) + instanced props (tombs, walls, trees, pillars,
// mausoleums, paths) + atmosphere (torches, embers, stars, moon) + lighting.
//
// All distribution is seeded for stable layouts across reloads.

import {
  AmbientLight,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
} from 'three';
import { COLORS } from '../constants';
import type { GameContext } from '../state';
import { buildTerrain } from './terrain';
import { buildProps } from './props';
import { buildTorches } from './torches';
import { buildEmberParticles } from './particles';
import { buildStarfield, buildMoon } from './sky';

export function initWorld(ctx: GameContext): void {
  const { scene, world, camera } = ctx;

  // Light atmospheric fog — D4-style: dark setting, but everything reads clearly.
  scene.fog = new FogExp2(COLORS.bgFog, 0.0035);

  // Terrain.
  const terrain = buildTerrain();
  scene.add(terrain.mesh);

  // Props.
  const { group: propsGroup, torchPositions } = buildProps(terrain.heightAt);
  scene.add(propsGroup);

  // Torches (lights + flickering system).
  const torches = buildTorches(world, torchPositions);
  scene.add(torches);

  // Ember particles drifting upward.
  const embers = buildEmberParticles(world);
  scene.add(embers);

  // Skybox: stars + moon disc.
  const stars = buildStarfield(world);
  scene.add(stars);
  const moon = buildMoon(world, camera);
  scene.add(moon);

  // Lighting — D4 brightness target: dark mood but every surface clearly readable.
  const ambient = new AmbientLight(COLORS.ambient, 1.6);
  scene.add(ambient);

  const moonLight = new DirectionalLight(COLORS.moonlight, 2.0);
  moonLight.position.set(50, 80, 30);
  moonLight.name = 'moon-directional';
  scene.add(moonLight);

  const hemi = new HemisphereLight(0x9aa0d0, 0x4a4555, 1.3);
  scene.add(hemi);
}
