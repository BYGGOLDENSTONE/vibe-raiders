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

  // Tighter fog feels more oppressive. Slightly cooler hue.
  scene.fog = new FogExp2(COLORS.bgFog, 0.018);

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

  // Lighting.
  const ambient = new AmbientLight(COLORS.ambient, 0.55);
  scene.add(ambient);

  const moonLight = new DirectionalLight(COLORS.moonlight, 0.65);
  moonLight.position.set(50, 80, 30);
  moonLight.name = 'moon-directional';
  scene.add(moonLight);

  const hemi = new HemisphereLight(0x6066a0, 0x1a1820, 0.35);
  scene.add(hemi);
}
