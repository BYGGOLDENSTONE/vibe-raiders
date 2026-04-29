// Diablo IV-style angled isometric camera.
// Sits behind/above the player and pitches down. Smooth-follows on every tick.
// Wave 1 agent may polish (zoom, edge pan, screenshake hookup).

import { Vector3 } from 'three';
import { CAMERA } from '../constants';
import { gameState, type GameContext } from '../state';

export function initCamera(ctx: GameContext): void {
  ctx.camera.fov = CAMERA.fov;
  ctx.camera.position.set(0, CAMERA.offsetY, CAMERA.offsetZ);
  ctx.camera.lookAt(0, 0, 0);
  ctx.camera.updateProjectionMatrix();

  const desired = new Vector3();

  ctx.world.addSystem((_w, frameCtx) => {
    const p = gameState.player;
    if (!p) return;
    desired.set(
      p.object3d.position.x,
      p.object3d.position.y + CAMERA.offsetY,
      p.object3d.position.z + CAMERA.offsetZ,
    );
    const lerp = Math.min(1, CAMERA.followLerp * frameCtx.dt);
    ctx.camera.position.lerp(desired, lerp);
    ctx.camera.lookAt(p.object3d.position.x, p.object3d.position.y, p.object3d.position.z);
  });
}
