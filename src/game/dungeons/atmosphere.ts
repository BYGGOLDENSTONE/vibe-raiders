// Dungeon atmosphere — crimson fog tint applied on zone:enter, restored on zone:exit.
// Saves the previous fog state so we don't permanently overwrite the open-world look.

import { Color, FogExp2, type Scene } from 'three';

const DUNGEON_FOG_COLOR = 0x2a0a0a;
const DUNGEON_FOG_DENSITY = 0.045;

interface SavedFog {
  color: number;
  density: number;
  bgColor: number;
}

let saved: SavedFog | null = null;

export function applyDungeonAtmosphere(scene: Scene): void {
  if (saved) return; // already tinted
  // Save existing fog (FogExp2 expected from main.ts).
  const fog = scene.fog as FogExp2 | null;
  const bg = scene.background as Color | null;
  saved = {
    color: fog ? fog.color.getHex() : 0x000000,
    density: fog && 'density' in fog ? fog.density : 0.012,
    bgColor: bg && bg.isColor ? bg.getHex() : 0x000000,
  };
  if (fog) {
    fog.color.setHex(DUNGEON_FOG_COLOR);
    fog.density = DUNGEON_FOG_DENSITY;
  } else {
    scene.fog = new FogExp2(DUNGEON_FOG_COLOR, DUNGEON_FOG_DENSITY);
  }
  if (bg && bg.isColor) bg.setHex(DUNGEON_FOG_COLOR);
}

export function restoreOpenWorldAtmosphere(scene: Scene): void {
  if (!saved) return;
  const fog = scene.fog as FogExp2 | null;
  if (fog && 'density' in fog) {
    fog.color.setHex(saved.color);
    fog.density = saved.density;
  }
  const bg = scene.background as Color | null;
  if (bg && bg.isColor) bg.setHex(saved.bgColor);
  saved = null;
}
