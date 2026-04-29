// Click-to-move (LMB hold) + skill hotbar (1-4, Q for ultimate, SHIFT for dash).
// D4-style click intent: LMB raycast picks enemy > loot > ground; intent state is
// kept module-local and re-evaluated every frame so the engage/pickup target keeps
// driving the player while LMB is held.

import { Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { C, type MoveTargetComponent } from '../../core/components';
import { gameState, type GameContext } from '../state';
import { basicAttackRangeForPlayer } from '../skills';
import { TUNING } from '../constants';

const HOTBAR_KEY_TO_SLOT: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  q: 4, // ultimate
  Q: 4,
  shift: 5, // dash (handled via shiftKey, but also accept space)
  ' ': 5, // space dash alt
};

type IntentKind = 'engage' | 'pickup' | 'move';
interface Intent {
  kind: IntentKind;
  targetId?: number;
  // For 'move' intent: cached destination so we don't re-issue moveCommand events
  // every single frame while LMB is held.
  groundX?: number;
  groundZ?: number;
}

let currentIntent: Intent | null = null;

// Read by skills/index.ts auto-fire so the engaged target gets priority and the
// player only fires when actually within their basic-attack range.
export function getEngageTargetId(): number | null {
  return currentIntent?.kind === 'engage' && currentIntent.targetId !== undefined
    ? currentIntent.targetId
    : null;
}

// Read by skills/index.ts so it knows to keep auto-firing while a non-engage
// intent is active but the player is idle in range.
export function hasMoveOrPickupIntent(): boolean {
  return currentIntent?.kind === 'move' || currentIntent?.kind === 'pickup';
}

function clearIntent(): void {
  currentIntent = null;
}

export function initInput(ctx: GameContext): void {
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  function setNdcFromClient(clientX: number, clientY: number): void {
    const rect = ctx.canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, ctx.camera);
  }

  function pickGround(clientX: number, clientY: number): Vector3 | null {
    setNdcFromClient(clientX, clientY);
    const dir = raycaster.ray.direction;
    const origin = raycaster.ray.origin;
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (0 - origin.y) / dir.y;
    if (t <= 0) return null;
    return new Vector3(origin.x + dir.x * t, 0, origin.z + dir.z * t);
  }

  // Walk up the parent chain looking for an Object3D that carries userData.entityId.
  // Mob/boss/loot rigs put the id on the root only (createEntity does this).
  function findEntityIdFromHit(obj: Object3D): number | null {
    let cur: Object3D | null = obj;
    while (cur) {
      const id = cur.userData?.entityId;
      if (typeof id === 'number') return id;
      cur = cur.parent;
    }
    return null;
  }

  // Raycast against all hostile + loot entity meshes. Returns the closest hit
  // by intent priority: enemy beats loot, ties broken by ray distance.
  function pickIntentTarget(
    clientX: number,
    clientY: number,
  ): { kind: 'engage' | 'pickup'; entityId: number } | null {
    setNdcFromClient(clientX, clientY);

    const candidates: Object3D[] = [];
    for (const e of ctx.world.query('hostile')) candidates.push(e.object3d);
    for (const e of ctx.world.query('loot')) candidates.push(e.object3d);
    if (candidates.length === 0) return null;

    const hits = raycaster.intersectObjects(candidates, true);
    if (hits.length === 0) return null;

    // Prefer enemy hits (any) over loot hits (any), then nearest.
    let bestEnemy: { entityId: number; dist: number } | null = null;
    let bestLoot: { entityId: number; dist: number } | null = null;
    for (const h of hits) {
      const id = findEntityIdFromHit(h.object);
      if (id === null) continue;
      const ent = ctx.world.get(id);
      if (!ent || !ent.alive) continue;
      if (ent.tags.has('hostile')) {
        if (!bestEnemy || h.distance < bestEnemy.dist) {
          bestEnemy = { entityId: id, dist: h.distance };
        }
      } else if (ent.tags.has('loot')) {
        if (!bestLoot || h.distance < bestLoot.dist) {
          bestLoot = { entityId: id, dist: h.distance };
        }
      }
    }
    if (bestEnemy) return { kind: 'engage', entityId: bestEnemy.entityId };
    if (bestLoot) return { kind: 'pickup', entityId: bestLoot.entityId };
    return null;
  }

  ctx.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let mouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Apply a fresh click intent: enemy > loot > ground. Called on initial press
  // and re-evaluated each frame while LMB is held (D4 hold-LMB feel — drag the
  // cursor onto a mob and the intent flips to engage).
  function applyClickIntent(clientX: number, clientY: number): void {
    const player = gameState.player;
    if (!player) return;

    const picked = pickIntentTarget(clientX, clientY);
    if (picked) {
      if (picked.kind === 'engage') {
        if (currentIntent?.kind !== 'engage' || currentIntent.targetId !== picked.entityId) {
          currentIntent = { kind: 'engage', targetId: picked.entityId };
          ctx.world.emit('player:engageEnemy', {
            entityId: player.id,
            targetId: picked.entityId,
          });
        }
      } else {
        if (currentIntent?.kind !== 'pickup' || currentIntent.targetId !== picked.entityId) {
          currentIntent = { kind: 'pickup', targetId: picked.entityId };
          ctx.world.emit('player:pickupTarget', {
            entityId: player.id,
            lootEntityId: picked.entityId,
          });
        }
      }
      return;
    }

    // Ground click — preserve existing behavior: emit moveCommand with the point.
    const point = pickGround(clientX, clientY);
    if (!point) return;
    const mt = player.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (!mt) return;
    mt.target = point;
    // Only re-emit when destination meaningfully changes — avoids event spam.
    const prev = currentIntent;
    if (
      prev?.kind !== 'move' ||
      prev.groundX === undefined ||
      prev.groundZ === undefined ||
      Math.hypot(prev.groundX - point.x, prev.groundZ - point.z) > 0.25
    ) {
      currentIntent = { kind: 'move', groundX: point.x, groundZ: point.z };
      ctx.world.emit('player:moveCommand', {
        entityId: player.id,
        targetX: point.x,
        targetZ: point.z,
      });
    }
  }

  // True if the mouse event landed on UI / inventory / start menu — we should
  // ignore it so the DOM can handle it normally.
  function isUiEvent(target: HTMLElement | null): boolean {
    if (!target) return false;
    if (target.tagName === 'CANVAS') return false;
    if (target.closest('[data-ui]')) return true;
    // Inventory panel + backdrop don't carry data-ui; guard them by class.
    if (target.closest('.inv-overlay.open')) return true;
    if (target.closest('.inv-panel')) return true;
    return false;
  }

  function isInputBlocked(): boolean {
    // Start menu / paused state — don't accept move/intent input.
    return gameState.paused;
  }

  // Listen on document so any overlay that wasn't pointer-events:none doesn't
  // swallow the click. Canvas was the original target but proved fragile.
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (isUiEvent(target)) return;
    if (isInputBlocked()) return;
    mouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    applyClickIntent(e.clientX, e.clientY);
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

  // Per-frame intent driver:
  //  - re-evaluate hold-LMB clicks (so drag-onto-enemy promotes to engage)
  //  - keep the player's MoveTarget in sync with the active intent
  //  - clear intents whose targets died/despawned
  ctx.world.addSystem(() => {
    if (isInputBlocked()) return;

    if (mouseDown) {
      applyClickIntent(lastMouseX, lastMouseY);
    }

    const player = gameState.player;
    if (!player || !player.alive) {
      clearIntent();
      return;
    }
    const mt = player.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (!mt) return;

    if (!currentIntent) return;

    if (currentIntent.kind === 'engage' && currentIntent.targetId !== undefined) {
      const target = ctx.world.get(currentIntent.targetId);
      if (!target || !target.alive || !target.tags.has('hostile')) {
        clearIntent();
        mt.target = null;
        return;
      }
      const px = player.object3d.position.x;
      const pz = player.object3d.position.z;
      const tx = target.object3d.position.x;
      const tz = target.object3d.position.z;
      const dx = tx - px;
      const dz = tz - pz;
      const d = Math.hypot(dx, dz);
      const range = basicAttackRangeForPlayer(player);
      // Stop just inside basic-attack range so ranged classes (e.g. sorc bolt
      // at 12m) don't barrel into melee distance.
      const stopAt = Math.max(0.4, range * 0.85);
      if (d > stopAt) {
        // Walk toward target up to the stop distance.
        const k = (d - stopAt) / d;
        const goalX = px + dx * k;
        const goalZ = pz + dz * k;
        if (!mt.target) mt.target = new Vector3();
        mt.target.set(goalX, 0, goalZ);
      } else {
        // In range — let auto-fire take over by clearing the move target.
        mt.target = null;
      }
      return;
    }

    if (currentIntent.kind === 'pickup' && currentIntent.targetId !== undefined) {
      const lootEnt = ctx.world.get(currentIntent.targetId);
      if (!lootEnt || !lootEnt.alive || !lootEnt.tags.has('loot')) {
        clearIntent();
        mt.target = null;
        return;
      }
      const px = player.object3d.position.x;
      const pz = player.object3d.position.z;
      const lx = lootEnt.object3d.position.x;
      const lz = lootEnt.object3d.position.z;
      const dx = lx - px;
      const dz = lz - pz;
      const d = Math.hypot(dx, dz);
      // Get all the way on top so the proximity pickup loop in loot/index.ts
      // also fires (it uses TUNING.playerPickupRadius). Stop slightly inside.
      const stopAt = TUNING.playerPickupRadius * 0.5;
      if (d > stopAt) {
        if (!mt.target) mt.target = new Vector3();
        mt.target.set(lx, 0, lz);
      } else {
        mt.target = null;
      }
      return;
    }

    // 'move' — MoveTarget was set on click; locomotion handles the rest.
    // Clear when arrived (locomotion null's mt.target on arrival).
    if (currentIntent.kind === 'move' && mt.target === null) {
      clearIntent();
    }
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
