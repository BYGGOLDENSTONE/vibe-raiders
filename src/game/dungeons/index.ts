// Wave 3: procgen dungeon prefab + zone transition system.
//
// Builds an underground dungeon at DUNGEON_ORIGIN that lives in the scene
// alongside the open world. Two portals (entry in open-world, exit in dungeon)
// teleport the player between zones, emit zone:enter/zone:exit events, spawn
// dungeon mobs on entry, and clean up dungeon-tagged entities on exit.

import { Group, Raycaster, Vector2, Vector3 } from 'three';
import { createEntity, setComponent } from '../../core/entity';
import {
  C,
  type AIBrainComponent,
  type CombatantComponent,
  type FactionComponent,
  type HealthComponent,
  type HitboxComponent,
  type MoveTargetComponent,
  type ResourceComponent,
  type TransformComponent,
} from '../../core/components';
import type { Entity } from '../../core/types';
import { CAMERA } from '../constants';
import { gameState, type GameContext } from '../state';
import { ARCHETYPE_LIST, type ArchetypeDef } from '../mobs';
import { MOB_RUNTIME, type MobRuntime } from '../mobs/ai';
import { generateLayout, type DungeonLayout, type RoomDef } from './layout';
import { buildDungeonGeometry } from './geometry';
import { buildDungeonLighting, tickTorches, type DungeonLightingRig } from './lighting';
import {
  buildPortal,
  setPortalState,
  tickPortal,
  updatePortalLabel,
  type PortalRig,
} from './portals';
import { makeRng } from './rng';

// Underground offset so the dungeon doesn't visually overlap the open world.
const DUNGEON_ORIGIN = new Vector3(0, -500, 0);

// Open-world spawn point we return to.
const OPEN_WORLD_SPAWN = new Vector3(0, 0, 0);

// Entry portal location in the open world.
const ENTRY_PORTAL_POS = new Vector3(15, 0, 15);

// Trigger radius for proximity-based portal use.
const PORTAL_PROXIMITY = 1.8;

// Mobs per dungeon run.
const MOBS_PER_FIGHT_ROOM_MIN = 2;
const MOBS_PER_FIGHT_ROOM_MAX = 3;

interface DungeonRig {
  zoneId: string;
  layout: DungeonLayout;
  group: Group;
  lighting: DungeonLightingRig;
  exitPortal: PortalRig;
  bossAlive: boolean;
}

interface PortalRuntime {
  rig: PortalRig;
  // Zone the portal teleports to (entry: 'dungeon-1', exit: 'open-world').
  destinationZone: 'open-world' | 'dungeon-1';
  // Where in the world we land.
  worldPos: Vector3;
}

let ctxRef: GameContext | null = null;
let dungeon: DungeonRig | null = null;
let entryPortal: PortalRuntime | null = null;
let exitPortalRuntime: PortalRuntime | null = null;
// Cooldown so a teleport doesn't immediately re-trigger on the destination portal.
let portalCooldownUntil = 0;
// Latest world elapsed seconds (set every tick) so click handler can use it.
let lastElapsed = 0;

export function initDungeons(ctx: GameContext): void {
  ctxRef = ctx;

  // Build the dungeon prefab once. It stays in the scene for the session.
  dungeon = createDungeonPrefab(ctx, 'dungeon-1');

  // Build entry portal in the open world.
  const entryRig = buildPortal(
    {
      position: ENTRY_PORTAL_POS,
      color: 0x6a40ff, // blue/purple
      name: 'ABYSSAL CRYPT',
      state: 'active',
      facingY: Math.PI, // face -Z toward origin
    },
    ctx.uiRoot,
  );
  ctx.scene.add(entryRig.group);
  entryPortal = {
    rig: entryRig,
    destinationZone: 'dungeon-1',
    worldPos: ENTRY_PORTAL_POS.clone(),
  };

  // Wire up click handler on the canvas (raycast against portal groups).
  installPortalClickHandler(ctx);

  // Per-frame system: portal anims, label projection, proximity detection,
  // torch flicker, boss-death watching for exit portal activation.
  ctx.world.addSystem((_w, frameCtx) => tick(frameCtx));

  // Boss tracking — if/when an entity tagged 'boss' dies, activate exit portal.
  ctx.world.on('entity:died', (payload) => {
    if (!dungeon) return;
    const dead = ctx.world.get(payload.entityId);
    if (!dead) return;
    if (!dead.tags.has('boss')) return;
    if (!dead.tags.has('dungeon')) return;
    dungeon.bossAlive = false;
    setPortalState(dungeon.exitPortal, 'active');
    ctx.world.emit('audio:sfx', { id: 'portal-open' });
  });
}

// ─── Public helpers ───────────────────────────────────────────────────────

export function teleportToOpenWorld(): void {
  if (!ctxRef || !dungeon) return;
  changeZone('open-world');
}

export function teleportToDungeon(zone: string): void {
  if (!ctxRef || !dungeon) return;
  if (zone !== dungeon.zoneId) return;
  changeZone('dungeon-1');
}

// ─── Build dungeon prefab ─────────────────────────────────────────────────

function createDungeonPrefab(ctx: GameContext, zoneId: string): DungeonRig {
  // Stable seed per session — uses Math.random so it varies between runs but
  // is deterministic during the run (handed to one rng instance).
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const rng = makeRng(seed);
  const layout = generateLayout(rng);

  const group = new Group();
  group.name = 'dungeon-root';
  group.position.copy(DUNGEON_ORIGIN);
  ctx.scene.add(group);

  const geom = buildDungeonGeometry(layout, rng);
  group.add(geom);

  const lighting = buildDungeonLighting(layout, rng);
  group.add(lighting.group);

  // Exit portal at the boss room far end (behind the dais).
  const boss = layout.rooms[layout.rooms.length - 1]!;
  const exitPos = new Vector3(
    boss.cx,
    0,
    boss.cz + boss.hz - 1.2, // tucked near far wall
  );
  const exitRig = buildPortal(
    {
      position: exitPos.clone().add(DUNGEON_ORIGIN),
      color: 0xff5020, // red/orange — dungeon palette
      name: 'EXIT',
      state: 'inactive',
      facingY: Math.PI, // face -Z (back toward player approach)
    },
    ctx.uiRoot,
  );
  ctx.scene.add(exitRig.group);

  const rig: DungeonRig = {
    zoneId,
    layout,
    group,
    lighting,
    exitPortal: exitRig,
    bossAlive: true,
  };

  exitPortalRuntime = {
    rig: exitRig,
    destinationZone: 'open-world',
    // Where in world space the player lands when exiting.
    worldPos: OPEN_WORLD_SPAWN.clone(),
  };

  return rig;
}

// ─── Per-frame tick ───────────────────────────────────────────────────────

function tick(frameCtx: { dt: number; elapsed: number; frame: number }): void {
  if (!ctxRef || !dungeon) return;
  lastElapsed = frameCtx.elapsed;

  // Animate both portals (always — they look pretty even when player is far).
  if (entryPortal) tickPortal(entryPortal.rig, frameCtx.elapsed, frameCtx.dt);
  tickPortal(dungeon.exitPortal, frameCtx.elapsed, frameCtx.dt);

  // Project labels into screen space.
  if (entryPortal) updatePortalLabel(entryPortal.rig, ctxRef.camera, ctxRef.canvas);
  updatePortalLabel(dungeon.exitPortal, ctxRef.camera, ctxRef.canvas);

  // Torch flicker — only when player is in dungeon (cheap optimization, also
  // prevents distant torches from flickering visibly through the floor).
  if (gameState.currentZone === 'dungeon') {
    tickTorches(dungeon.lighting, frameCtx.elapsed, frameCtx.dt);
  }

  // Proximity-based teleport.
  const now = frameCtx.elapsed;
  if (now < portalCooldownUntil) return;

  const player = gameState.player;
  if (!player) return;
  const ppos = player.object3d.position;

  if (gameState.currentZone === 'open-world' && entryPortal) {
    const d = ppos.distanceTo(entryPortal.worldPos);
    if (d < PORTAL_PROXIMITY) {
      changeZone('dungeon-1');
    }
  } else if (gameState.currentZone === 'dungeon' && exitPortalRuntime) {
    if (dungeon.exitPortal.state === 'active') {
      const d = ppos.distanceTo(dungeon.exitPortal.worldPos);
      if (d < PORTAL_PROXIMITY) {
        changeZone('open-world');
      }
    }
  }
}

// ─── Zone transitions ─────────────────────────────────────────────────────

function changeZone(target: 'open-world' | 'dungeon-1'): void {
  if (!ctxRef || !dungeon) return;
  const player = gameState.player;
  if (!player) return;

  const world = ctxRef.world;

  if (target === 'dungeon-1' && gameState.currentZone !== 'dungeon') {
    // ENTERING the dungeon.
    const spawnLocal = dungeon.layout.spawn;
    const spawnWorld = new Vector3(
      DUNGEON_ORIGIN.x + spawnLocal.x,
      DUNGEON_ORIGIN.y + 0,
      DUNGEON_ORIGIN.z + spawnLocal.y, // layout uses xz in Vector2 (y=z)
    );
    teleportPlayer(spawnWorld);
    snapCameraToPlayer(spawnWorld);

    // Cancel any pending move target so player doesn't immediately walk away.
    const mt = player.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (mt) mt.target = null;

    gameState.currentZone = 'dungeon';
    portalCooldownUntil = lastElapsed + 1.2;

    // Reset run state — boss is alive again, exit portal inactive.
    dungeon.bossAlive = true;
    setPortalState(dungeon.exitPortal, 'inactive');

    // Spawn dungeon mobs now (per-run).
    spawnDungeonMobs(dungeon, ctxRef);

    world.emit('zone:enter', { zone: dungeon.zoneId });
    world.emit('audio:sfx', { id: 'zone-enter' });
  } else if (target === 'open-world' && gameState.currentZone !== 'open-world') {
    // EXITING the dungeon.
    const exitTarget = OPEN_WORLD_SPAWN.clone();
    teleportPlayer(exitTarget);
    snapCameraToPlayer(exitTarget);

    const mt = player.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (mt) mt.target = null;

    gameState.currentZone = 'open-world';
    portalCooldownUntil = lastElapsed + 1.2;

    // Cleanup all dungeon-tagged entities (mobs, projectiles, loot, boss).
    cleanupDungeonEntities();

    world.emit('zone:exit', { zone: dungeon.zoneId });
    world.emit('audio:sfx', { id: 'zone-exit' });
  }
}

function teleportPlayer(pos: Vector3): void {
  const player = gameState.player;
  if (!player) return;
  player.object3d.position.set(pos.x, pos.y + 0.9, pos.z);
  const t = player.components.get(C.Transform) as TransformComponent | undefined;
  if (t) t.velocity.set(0, 0, 0);
}

function snapCameraToPlayer(pos: Vector3): void {
  if (!ctxRef) return;
  const cam = ctxRef.camera;
  cam.position.set(pos.x, pos.y + CAMERA.offsetY, pos.z + CAMERA.offsetZ);
  cam.lookAt(pos.x, pos.y, pos.z);
}

function cleanupDungeonEntities(): void {
  if (!ctxRef) return;
  const world = ctxRef.world;
  const ids: number[] = [];
  for (const e of world.query('dungeon')) ids.push(e.id);
  for (const id of ids) world.despawn(id);
}

// ─── Dungeon mob spawning ─────────────────────────────────────────────────

function spawnDungeonMobs(rig: DungeonRig, ctx: GameContext): void {
  const player = gameState.player;
  const playerLevel =
    player &&
    typeof (player.components.get(C.Player) as { level?: number } | undefined)?.level === 'number'
      ? ((player.components.get(C.Player) as { level: number }).level)
      : 1;

  const scale = 1 + 0.2 * (playerLevel - 1);

  const fightRooms = rig.layout.rooms.filter((r) => r.kind === 'fight');
  let total = 0;
  for (const room of fightRooms) {
    const count =
      MOBS_PER_FIGHT_ROOM_MIN +
      Math.floor(Math.random() * (MOBS_PER_FIGHT_ROOM_MAX - MOBS_PER_FIGHT_ROOM_MIN + 1));
    for (let i = 0; i < count; i++) {
      const arch = pickWeightedArchetype();
      const localPos = pickRoomSpawnPoint(room);
      const worldPos = new Vector3(
        DUNGEON_ORIGIN.x + localPos.x,
        DUNGEON_ORIGIN.y + arch.yOffset,
        DUNGEON_ORIGIN.z + localPos.y,
      );
      spawnDungeonMob(ctx, arch, worldPos, scale);
      total++;
    }
  }
  // Suppress unused warning for total in production; useful for debugging.
  void total;
}

function pickWeightedArchetype(): ArchetypeDef {
  // Skip 'brute' from random pick (boss room's job to feel epic).
  const candidates = ARCHETYPE_LIST.filter((a) => a.id !== 'brute');
  const totalWeight = candidates.reduce((s, a) => s + a.spawnWeight, 0);
  let r = Math.random() * totalWeight;
  for (const a of candidates) {
    r -= a.spawnWeight;
    if (r <= 0) return a;
  }
  return candidates[0]!;
}

function pickRoomSpawnPoint(room: RoomDef): Vector2 {
  // Random point inside the room's inner area (away from walls).
  const margin = 1.2;
  const x = room.cx + (Math.random() * 2 - 1) * (room.hx - margin);
  const z = room.cz + (Math.random() * 2 - 1) * (room.hz - margin);
  return new Vector2(x, z);
}

function spawnDungeonMob(
  ctx: GameContext,
  arch: ArchetypeDef,
  worldPos: Vector3,
  scale: number,
): Entity {
  const { rig, flashMaterials } = arch.buildMesh();
  rig.position.copy(worldPos);
  rig.name = `dungeon-mob-${arch.id}`;

  const tags = ['mob', 'hostile', 'combatant', 'dungeon'];
  const entity = createEntity({ object3d: rig, tags });

  const scaledHp = Math.round(arch.hp * scale);
  const scaledDmg = arch.damage * scale;

  setComponent<TransformComponent>(entity, C.Transform, {
    velocity: new Vector3(),
    grounded: !arch.floats,
  });
  setComponent<HealthComponent>(entity, C.Health, {
    hp: scaledHp,
    maxHp: scaledHp,
    lastHitTime: 0,
    invulnUntil: 0,
  });
  setComponent<ResourceComponent>(entity, C.Resource, {
    kind: arch.resourceKind,
    current: 100,
    max: 100,
    regenPerSec: arch.attackKind === 'ranged' ? 8 : 4,
  });
  setComponent<FactionComponent>(entity, C.Faction, { faction: 'hostile' });
  setComponent<CombatantComponent>(entity, C.Combatant, {
    baseDamage: scaledDmg,
    attackRange: arch.attackRange,
    attackSpeed: arch.attackSpeed,
    lastAttackTime: 0,
    critChance: 0,
    critMult: 1,
  });
  setComponent<AIBrainComponent>(entity, C.AIBrain, {
    state: 'idle',
    targetId: null,
    leashOrigin: worldPos.clone(),
    leashRadius: 14,
    aggroRadius: arch.aggroRadius,
    attackRange: arch.attackRange,
    nextThinkTime: Math.random() * 0.1,
  });
  setComponent<MoveTargetComponent>(entity, C.MoveTarget, {
    target: null,
    speed: arch.speed,
  });
  setComponent<HitboxComponent>(entity, C.Hitbox, {
    radius: arch.hitboxRadius,
    height: arch.hitboxHeight,
  });

  const runtime: MobRuntime = {
    archetype: arch,
    flashMaterials,
    flashEndTime: 0,
    origColors: flashMaterials.map((m) => m.color.getHex()),
    origOpacities: flashMaterials.map((m) => m.opacity),
    nextWanderTime: 0,
    wanderOrigin: worldPos.clone(),
    fleeUntil: 0,
    bobPhase: Math.random() * Math.PI * 2,
    deathStartTime: 0,
    hasEmittedKilled: false,
  };
  setComponent<MobRuntime>(entity, MOB_RUNTIME, runtime);

  // Per-archetype XP reward — same key as open-world mobs.
  entity.components.set('mobXpReward', arch.xpReward);

  ctx.world.spawn(entity);
  return entity;
}

// ─── Portal click raycaster ───────────────────────────────────────────────

function installPortalClickHandler(ctx: GameContext): void {
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  ctx.canvas.addEventListener('click', (ev) => {
    if (!dungeon) return;
    const rect = ctx.canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, ctx.camera);

    // Only test currently-relevant portal — saves work and avoids cross-zone hits.
    if (gameState.currentZone === 'open-world' && entryPortal) {
      const hits = raycaster.intersectObject(entryPortal.rig.group, true);
      if (hits.length > 0) {
        changeZone('dungeon-1');
      }
    } else if (gameState.currentZone === 'dungeon' && dungeon.exitPortal.state === 'active') {
      const hits = raycaster.intersectObject(dungeon.exitPortal.group, true);
      if (hits.length > 0) {
        changeZone('open-world');
      }
    }
  });
}
