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
  // Optional render override (e.g. post-processing). main.ts uses this if set.
  renderHook: (() => void) | null;
}

export interface GameState {
  player: Entity | null;
  multiplayerConnected: boolean;
  partyMemberIds: string[];
  paused: boolean;
  timeScale: number;
}

export const gameState: GameState = {
  player: null,
  multiplayerConnected: false,
  partyMemberIds: [],
  paused: false,
  timeScale: 1,
};
