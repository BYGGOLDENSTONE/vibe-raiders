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
  // Resize hook (e.g. EffectComposer.setSize). Invoked after renderer.setSize.
  resizeHook: ((w: number, h: number) => void) | null;
}

export interface GameState {
  player: Entity | null;
  multiplayerConnected: boolean;
  partyMemberIds: string[];
  paused: boolean;
  timeScale: number;
  // Cristian time sync offset: shared time = performance.now() + serverTimeOffsetMs.
  // Set after first ping/pong round; 0 means "not yet synced, treat as local time".
  serverTimeOffsetMs: number;
  // Galaxy seed authoritative from server. 0 = not yet welcomed.
  galaxySeed: number;
  // Self player id assigned by server. Empty until welcome.
  selfPlayerId: string;
  // Self sector assignment (0..15). -1 = not yet assigned.
  selfSectorId: number;
}

export const gameState: GameState = {
  player: null,
  multiplayerConnected: false,
  partyMemberIds: [],
  paused: false,
  timeScale: 1,
  serverTimeOffsetMs: 0,
  galaxySeed: 0,
  selfPlayerId: '',
  selfSectorId: -1,
};

// Shared time helper. Always use this for trajectory math, never Date.now().
export function sharedNow(): number {
  return performance.now() + gameState.serverTimeOffsetMs;
}
