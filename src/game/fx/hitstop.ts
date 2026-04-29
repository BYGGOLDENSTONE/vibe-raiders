// Hit-stop: drop gameState.timeScale to a near-zero value briefly to sell impact.
// Uses real-time (performance.now) so it restores even though world.tick is paused.

import { gameState } from '../state';

const STOP_SCALE = 0.05;

export interface HitStop {
  trigger(duration: number): void;
  update(): void;
}

export function createHitStop(): HitStop {
  let pendingRestoreAt = 0; // performance.now() ms
  let active = false;

  return {
    trigger(duration: number) {
      if (duration <= 0) return;
      const now = performance.now();
      const newRestore = now + duration * 1000;
      // Don't shorten an existing stop — pick the later restore time.
      if (newRestore > pendingRestoreAt) pendingRestoreAt = newRestore;
      if (!active) {
        active = true;
        gameState.timeScale = STOP_SCALE;
      }
    },
    update() {
      if (!active) return;
      if (performance.now() >= pendingRestoreAt) {
        active = false;
        pendingRestoreAt = 0;
        gameState.timeScale = 1;
      }
    },
  };
}
