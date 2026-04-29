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
export type SelectableClass = 'rogue' | 'barbarian' | 'sorcerer';

export interface GameState {
  player: Entity | null;
  currentZone: ZoneKind;
  multiplayerConnected: boolean;
  partyMemberIds: string[]; // remote PartyKit IDs
  paused: boolean;
  // FX/combat mutate this during hit-stop. main.ts multiplies dt by it before world.tick.
  timeScale: number;
  // Class chosen on the start menu. initPlayer reads this; menu emits 'player:classChanged' on PLAY.
  selectedClass: SelectableClass;
}

export const gameState: GameState = {
  player: null,
  currentZone: 'open-world',
  multiplayerConnected: false,
  partyMemberIds: [],
  paused: false,
  timeScale: 1,
  selectedClass: 'rogue',
};

export function setClass(classId: SelectableClass): void {
  gameState.selectedClass = classId;
}
