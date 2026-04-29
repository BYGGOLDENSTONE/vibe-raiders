// Loot module entry. Wires drop on mob death, pickup near player, and exposes
// rollItem + formatItemTooltip for inventory/UI to consume.

import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
} from 'three';
import { createEntity, setComponent, getComponent } from '../../core/entity';
import {
  C,
  type InventoryComponent,
  type ItemInstance,
  type ItemRarity,
  type ItemSlot,
  type LootDropComponent,
} from '../../core/components';
import type { Entity } from '../../core/types';
import type { GameContext } from '../state';
import { TUNING } from '../constants';
import { gameState } from '../state';
import { rollItem } from './roll';

const LOOT_RUNTIME = 'lootRuntime';

interface LootRuntime {
  spawnTime: number;
  bobPhase: number;
  rotation: number;
  rarity: ItemRarity;
  // Mesh handles we animate every frame.
  iconMesh: Mesh;
  glowMesh: Mesh | null;
  light: PointLight | null;
  baseY: number;
}

// Default drop chances (mob may have a hook later — for now read tags).
const BASE_DROP_CHANCE = 0.35;
const ELITE_DROP_CHANCE = 0.7;
const BOSS_DROP_CHANCE = 1.0;

export function initLoot(ctx: GameContext): void {
  const world = ctx.world;

  // Drop on mob:killed (preferred — carries xpReward, killerId).
  // Fall back to entity:died if killer hits something we tagged 'hostile'
  // before the mob module flips it. We only act on mob:killed to avoid
  // double-drops.
  world.on('mob:killed', (payload) => {
    const ent = world.get(payload.entityId);
    if (!ent) return;
    handleMobDeath(ctx, ent);
  });

  // Pickup loop — runs every tick.
  world.addSystem((w) => {
    const player = gameState.player;
    if (!player || !player.alive) return;
    const inventory = getComponent<InventoryComponent>(player, C.Inventory);
    if (!inventory) return;

    const radiusSq = TUNING.playerPickupRadius * TUNING.playerPickupRadius;
    const px = player.object3d.position.x;
    const pz = player.object3d.position.z;

    for (const drop of w.query('loot')) {
      const dx = drop.object3d.position.x - px;
      const dz = drop.object3d.position.z - pz;
      if (dx * dx + dz * dz > radiusSq) continue;

      const lootComp = getComponent<LootDropComponent>(drop, C.LootDrop);
      if (!lootComp) continue;

      // Inventory full? Skip — leave on ground.
      if (inventory.items.length >= inventory.capacity) continue;

      inventory.items.push(lootComp.item);

      const dropPos = drop.object3d.position;
      w.emit('item:picked', { pickerId: player.id, itemId: lootComp.item.id });
      w.emit('fx:floatingText', {
        x: dropPos.x,
        y: dropPos.y + 1.0,
        z: dropPos.z,
        text: lootComp.item.name,
        color: lootComp.item.iconColor,
      });
      w.emit('audio:sfx', { id: 'item-pickup', x: dropPos.x, z: dropPos.z });

      w.despawn(drop.id);
    }
  });

  // Visual animation system — bob + spin loot drops, soft pulse on glow.
  world.addSystem((w, frame) => {
    for (const drop of w.query('loot')) {
      const rt = getComponent<LootRuntime>(drop, LOOT_RUNTIME);
      if (!rt) continue;
      rt.rotation += frame.dt * 1.4;
      const bob = Math.sin(frame.elapsed * 2.2 + rt.bobPhase) * 0.12;
      drop.object3d.position.y = rt.baseY + 0.35 + bob;
      rt.iconMesh.rotation.y = rt.rotation;
      rt.iconMesh.rotation.x = rt.rotation * 0.3;
      if (rt.light) {
        rt.light.intensity = 1.4 + Math.sin(frame.elapsed * 3.5 + rt.bobPhase) * 0.25;
      }
    }
  });
}

function handleMobDeath(ctx: GameContext, mob: Entity): void {
  const isBoss = mob.tags.has('boss');
  const isElite = mob.tags.has('elite');
  const chance = isBoss ? BOSS_DROP_CHANCE : isElite ? ELITE_DROP_CHANCE : BASE_DROP_CHANCE;
  if (Math.random() > chance) return;

  // iLevel grows with kill type. Player level is the better source — use it if present.
  const playerLvl = readPlayerLevel();
  const iLevel = playerLvl + (isBoss ? 3 : isElite ? 1 : 0);

  // Bosses get a slot hint that biases toward weapon/chest. Otherwise random.
  let slotHint: ItemSlot | undefined;
  if (isBoss) slotHint = Math.random() < 0.5 ? 'weapon' : 'chest';

  // Bosses guarantee at least rare; elites bump to magic+.
  let rarityHint: ItemRarity | undefined;
  if (isBoss) rarityHint = Math.random() < 0.4 ? 'legendary' : 'rare';
  else if (isElite && Math.random() < 0.5) rarityHint = 'magic';

  const item = rollItem(iLevel, slotHint, rarityHint);

  spawnLootDrop(ctx, item, mob.object3d.position.x, mob.object3d.position.z);
}

function readPlayerLevel(): number {
  const player = gameState.player;
  if (!player) return 1;
  const pc = player.components.get(C.Player) as { level: number } | undefined;
  return pc?.level ?? 1;
}

function spawnLootDrop(ctx: GameContext, item: ItemInstance, x: number, z: number): Entity {
  const world = ctx.world;
  const rig = new Group();
  rig.position.set(x, 0, z);
  rig.name = `loot-${item.rarity}`;

  // Core icon: small emissive cube tinted by rarity.
  const color = new Color(item.iconColor);
  const iconMat = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: item.rarity === 'common' ? 0.4 : 0.9,
    roughness: 0.4,
    metalness: 0.6,
  });
  const iconGeom = new BoxGeometry(0.3, 0.3, 0.3);
  const iconMesh = new Mesh(iconGeom, iconMat);
  iconMesh.position.y = 0;
  rig.add(iconMesh);

  // Outer glow (semi-transparent shell) for magic+.
  let glowMesh: Mesh | null = null;
  if (item.rarity !== 'common') {
    const glowMat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: item.rarity === 'magic' ? 0.18 : item.rarity === 'rare' ? 0.28 : 0.4,
      depthWrite: false,
    });
    const glowGeom = new BoxGeometry(0.55, 0.55, 0.55);
    glowMesh = new Mesh(glowGeom, glowMat);
    rig.add(glowMesh);
  }

  // Legendary: add a vertical light column.
  let light: PointLight | null = null;
  if (item.rarity === 'legendary') {
    light = new PointLight(item.iconColor, 1.6, 6, 2);
    light.position.set(0, 1.2, 0);
    rig.add(light);

    // Tall thin emissive pillar to suggest a beam without needing shaders.
    const pillarMat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const pillarGeom = new BoxGeometry(0.15, 4.0, 0.15);
    const pillar = new Mesh(pillarGeom, pillarMat);
    pillar.position.y = 2.0;
    rig.add(pillar);
  } else if (item.rarity === 'rare') {
    light = new PointLight(item.iconColor, 0.8, 3.5, 2);
    light.position.set(0, 0.6, 0);
    rig.add(light);
  }

  const entity = createEntity({ object3d: rig, tags: ['loot'] });

  setComponent<LootDropComponent>(entity, C.LootDrop, {
    item,
    spawnTime: performance.now() / 1000,
  });

  const runtime: LootRuntime = {
    spawnTime: performance.now() / 1000,
    bobPhase: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI * 2,
    rarity: item.rarity,
    iconMesh,
    glowMesh,
    light,
    baseY: 0,
  };
  setComponent<LootRuntime>(entity, LOOT_RUNTIME, runtime);

  world.spawn(entity);
  world.emit('item:dropped', { dropEntityId: entity.id });
  // Subtle audio cue per rarity, if there's an audio handler listening.
  world.emit('audio:sfx', { id: `loot-drop-${item.rarity}`, x, z });

  // Burst of floating sparkle for rare+.
  if (item.rarity === 'rare' || item.rarity === 'legendary') {
    world.emit('fx:floatingText', {
      x,
      y: 1.2,
      z,
      text: item.rarity === 'legendary' ? 'LEGENDARY' : 'RARE',
      color: item.iconColor,
    });
  }

  return entity;
}

// === Public API ===
export { rollItem } from './roll';
export { formatItemTooltip } from './tooltip';
export { AFFIX_TABLE } from './affixes';

// Re-export so callers can import everything from one place.
export type { ItemInstance, ItemRarity, ItemSlot } from '../../core/components';
