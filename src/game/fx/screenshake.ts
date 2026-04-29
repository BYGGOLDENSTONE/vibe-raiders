// Screenshake: maintain a stack of active shakes; perturb camera position each frame.
// Stores the previous frame's offset on the camera so we can subtract it before re-adding.

import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

interface Shake {
  amplitude: number;
  remaining: number;
  total: number;
  seed: number;
}

export interface ScreenShake {
  add(amplitude: number, duration: number): void;
  update(realDt: number, camera: PerspectiveCamera): void;
}

export function createScreenShake(): ScreenShake {
  const active: Shake[] = [];
  const lastOffset = new Vector3();
  const tmp = new Vector3();
  let elapsed = 0;

  return {
    add(amplitude: number, duration: number) {
      if (amplitude <= 0 || duration <= 0) return;
      active.push({
        amplitude,
        remaining: duration,
        total: duration,
        seed: Math.random() * 1000,
      });
    },
    update(realDt: number, camera: PerspectiveCamera) {
      // First: undo last frame's perturbation so camera/system sees the canonical position.
      camera.position.sub(lastOffset);
      lastOffset.set(0, 0, 0);

      if (active.length === 0) return;
      elapsed += realDt;

      let totalX = 0;
      let totalY = 0;
      let totalZ = 0;

      for (let i = active.length - 1; i >= 0; i--) {
        const s = active[i]!;
        s.remaining -= realDt;
        if (s.remaining <= 0) {
          active.splice(i, 1);
          continue;
        }
        // Decay quadratically — more impact early, fades smoothly.
        const decay = (s.remaining / s.total);
        const a = s.amplitude * decay * decay;
        const t = elapsed * 60 + s.seed; // ~60 Hz noise frequency
        totalX += Math.sin(t * 1.7) * a;
        totalY += Math.cos(t * 2.3) * a * 0.6; // less vertical
        totalZ += Math.sin(t * 1.3 + 1.0) * a;
      }

      tmp.set(totalX, totalY, totalZ);
      camera.position.add(tmp);
      lastOffset.copy(tmp);
    },
  };
}
