// Click-to-move (LMB hold) + skill hotbar (1-4, Q for ultimate, SHIFT for dash).
// Emits high-level intents through the event bus; combat/skill systems consume them.

import { Raycaster, Vector2, Vector3 } from 'three';
import { C, type MoveTargetComponent } from '../../core/components';
import { gameState, type GameContext } from '../state';

const HOTBAR_KEY_TO_SLOT: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  q: 4, // ultimate
  Q: 4,
  shift: 5, // dash (handled via shiftKey, but also accept space)
  ' ': 5, // space dash alt
};

export function initInput(ctx: GameContext): void {
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  function pickGround(clientX: number, clientY: number): Vector3 | null {
    const rect = ctx.canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, ctx.camera);
    const dir = raycaster.ray.direction;
    const origin = raycaster.ray.origin;
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (0 - origin.y) / dir.y;
    if (t <= 0) return null;
    return new Vector3(origin.x + dir.x * t, 0, origin.z + dir.z * t);
  }

  ctx.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let mouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  function applyMoveCommand(clientX: number, clientY: number): void {
    const player = gameState.player;
    if (!player) return;
    const point = pickGround(clientX, clientY);
    if (!point) return;
    const mt = player.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (!mt) return;
    mt.target = point;
    ctx.world.emit('player:moveCommand', {
      entityId: player.id,
      targetX: point.x,
      targetZ: point.z,
    });
  }

  // Listen on document so any overlay that wasn't pointer-events:none doesn't
  // swallow the click. Canvas was the original target but proved fragile.
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Skip clicks on UI panels (let DOM elements handle them normally).
    const target = e.target as HTMLElement | null;
    if (target && target.tagName !== 'CANVAS' && target.closest('[data-ui]')) return;
    mouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    applyMoveCommand(e.clientX, e.clientY);
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (mouseDown) {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });

  // Re-issue move command while LMB is held (Diablo-style click-and-drag).
  ctx.world.addSystem(() => {
    if (!mouseDown) return;
    applyMoveCommand(lastMouseX, lastMouseY);
  });

  // Hotbar / skill input.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const player = gameState.player;
    if (!player) return;

    let slotIndex: number | null = null;
    if (e.key in HOTBAR_KEY_TO_SLOT) {
      slotIndex = HOTBAR_KEY_TO_SLOT[e.key]!;
    } else if (e.shiftKey && e.key === 'Shift') {
      slotIndex = 5;
    }
    if (slotIndex === null) return;

    const point = pickGround(lastMouseX || window.innerWidth / 2, lastMouseY || window.innerHeight / 2);
    const tx = point ? point.x : player.object3d.position.x;
    const tz = point ? point.z : player.object3d.position.z;
    ctx.world.emit('player:skillCast', {
      entityId: player.id,
      slotIndex,
      targetX: tx,
      targetZ: tz,
    });
  });
}
