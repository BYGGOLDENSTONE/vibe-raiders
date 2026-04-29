import type { World } from '../core/world';
import type { Scene, PerspectiveCamera, WebGLRenderer } from 'three';
import type { Entity } from '../core/types';

export interface GameContext {
  world: World;
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  uiRoot: HTMLElement;
  canvas: HTMLCanvasElement;
  // FX module sets this when post-processing is wired. main.ts uses it instead of renderer.render.
  renderHook: (() => void) | null;
}

export type ZoneKind = 'open-world' | 'dungeon' | 'hub';

export interface GameState {
  player: Entity | null;
  currentZone: ZoneKind;
  multiplayerConnected: boolean;
  partyMemberIds: string[]; // remote PartyKit IDs
  paused: boolean;
  // FX/combat mutate this during hit-stop. main.ts multiplies dt by it before world.tick.
  timeScale: number;
}

export const gameState: GameState = {
  player: null,
  currentZone: 'open-world',
  multiplayerConnected: false,
  partyMemberIds: [],
  paused: false,
  timeScale: 1,
};
