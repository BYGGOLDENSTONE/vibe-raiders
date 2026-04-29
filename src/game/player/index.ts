// Spawns the player entity with the full component stack and a baseline
// click-to-move locomotion system. Wave 2 (skills/combat) will layer on top.

import { CapsuleGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { createEntity, setComponent } from '../../core/entity';
import {
  C,
  type CombatantComponent,
  type EquipmentComponent,
  type FactionComponent,
  type HealthComponent,
  type HitboxComponent,
  type InventoryComponent,
  type MoveTargetComponent,
  type PlayerComponent,
  type ResourceComponent,
  type SkillUserComponent,
  type StatusEffectsComponent,
  type TransformComponent,
} from '../../core/components';
import { COLORS, TUNING } from '../constants';
import { gameState, type GameContext } from '../state';

export function initPlayer(ctx: GameContext): void {
  const mesh = new Mesh(
    new CapsuleGeometry(0.4, 1.0, 4, 8),
    new MeshStandardMaterial({ color: COLORS.player, roughness: 0.5, metalness: 0.3 }),
  );
  mesh.position.set(0, 0.9, 0);
  mesh.name = 'player-mesh';

  const player = createEntity({ object3d: mesh, tags: ['player', 'combatant'] });
  setComponent<TransformComponent>(player, C.Transform, { velocity: new Vector3(), grounded: true });
  setComponent<HealthComponent>(player, C.Health, {
    hp: TUNING.playerBaseHp,
    maxHp: TUNING.playerBaseHp,
    lastHitTime: 0,
    invulnUntil: 0,
  });
  setComponent<ResourceComponent>(player, C.Resource, {
    kind: 'energy',
    current: 100,
    max: 100,
    regenPerSec: 12,
  });
  setComponent<FactionComponent>(player, C.Faction, { faction: 'player' });
  setComponent<PlayerComponent>(player, C.Player, {
    classId: 'rogue',
    name: 'Hero',
    color: COLORS.player,
    level: 1,
    xp: 0,
    xpToNext: 100,
  });
  setComponent<CombatantComponent>(player, C.Combatant, {
    baseDamage: 10,
    attackRange: 1.6,
    attackSpeed: 2.0,
    lastAttackTime: 0,
    critChance: 0.1,
    critMult: 2.0,
  });
  setComponent<SkillUserComponent>(player, C.SkillUser, { slots: [] });
  setComponent<MoveTargetComponent>(player, C.MoveTarget, {
    target: null,
    speed: TUNING.playerBaseSpeed,
  });
  setComponent<HitboxComponent>(player, C.Hitbox, { radius: 0.5, height: 1.8 });
  setComponent<InventoryComponent>(player, C.Inventory, { items: [], capacity: 24 });
  setComponent<EquipmentComponent>(player, C.Equipment, {
    weapon: null,
    head: null,
    chest: null,
    accessory: null,
  });
  setComponent<StatusEffectsComponent>(player, C.StatusEffects, { effects: [] });

  ctx.world.spawn(player);
  gameState.player = player;

  // Baseline click-to-move locomotion. Wave 2 will add skill movement (dash/blink).
  ctx.world.addSystem((w, frameCtx) => {
    for (const e of w.queryWith(C.MoveTarget)) {
      const mt = e.components.get(C.MoveTarget) as MoveTargetComponent;
      if (!mt.target) continue;
      const px = e.object3d.position.x;
      const pz = e.object3d.position.z;
      const dx = mt.target.x - px;
      const dz = mt.target.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        mt.target = null;
        continue;
      }
      const step = mt.speed * frameCtx.dt;
      if (step >= dist) {
        e.object3d.position.x = mt.target.x;
        e.object3d.position.z = mt.target.z;
        mt.target = null;
      } else {
        const inv = 1 / dist;
        e.object3d.position.x += dx * inv * step;
        e.object3d.position.z += dz * inv * step;
        e.object3d.rotation.y = Math.atan2(dx, dz);
      }
    }
  });
}
