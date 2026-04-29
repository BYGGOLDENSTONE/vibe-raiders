// Player-faction projectile spawner + per-frame tick.
// Each skill that spawns a projectile chooses a `kind` (visual) and behavior knobs.

import {
  ConeGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { createEntity, setComponent } from '../../core/entity';
import {
  C,
  type ProjectileComponent,
} from '../../core/components';
import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import { dealDamage, juiceHit, nearestHostile } from './helpers';

export type PlayerProjectileKind = 'dagger' | 'magic-bolt' | 'fireball';

interface PlayerProjectileExtras {
  kind: PlayerProjectileKind;
  velocity: Vector3;
  hasHit: boolean;
  // Homing target (optional)
  homing: boolean;
  homingEntityId: number | null;
  homingTurnRate: number; // rad/sec
  hitColor: number;
  isCrit: boolean;
}

const PLAYER_PROJ_EXTRAS = 'skills:playerProjectileExtras';
const PLAYER_PROJ_TAG = 'player-projectile';

export interface SpawnPlayerProjectileOpts {
  kind: PlayerProjectileKind;
  origin: Vector3;
  dir: Vector3; // unit XZ
  speed: number;
  damage: number;
  lifetime: number;
  hitRadius: number;
  ownerId: number;
  homing?: boolean;
  homingEntityId?: number | null;
  hitColor?: number;
  isCrit?: boolean;
}

export function spawnPlayerProjectile(world: World, opts: SpawnPlayerProjectileOpts): Entity {
  const mesh = buildProjectileMesh(opts.kind);
  mesh.position.copy(opts.origin);

  // Orient along travel direction.
  if (opts.kind === 'dagger') {
    const yaw = Math.atan2(opts.dir.x, opts.dir.z);
    mesh.rotation.y = yaw;
    mesh.rotation.x = Math.PI / 2;
  }

  const velocity = new Vector3(opts.dir.x, 0, opts.dir.z).normalize().multiplyScalar(opts.speed);

  const entity = createEntity({
    object3d: mesh,
    tags: ['projectile', PLAYER_PROJ_TAG],
  });

  setComponent<ProjectileComponent>(entity, C.Projectile, {
    ownerEntityId: opts.ownerId,
    damage: opts.damage,
    speed: opts.speed,
    lifetime: opts.lifetime,
    spawnTime: performance.now() / 1000,
    hitRadius: opts.hitRadius,
    faction: 'player',
  });

  const extras: PlayerProjectileExtras = {
    kind: opts.kind,
    velocity,
    hasHit: false,
    homing: !!opts.homing,
    homingEntityId: opts.homingEntityId ?? null,
    homingTurnRate: 8.0, // rad/sec
    hitColor: opts.hitColor ?? colorForKind(opts.kind),
    isCrit: !!opts.isCrit,
  };
  setComponent<PlayerProjectileExtras>(entity, PLAYER_PROJ_EXTRAS, extras);

  world.spawn(entity);
  return entity;
}

function colorForKind(kind: PlayerProjectileKind): number {
  switch (kind) {
    case 'dagger': return 0xc8c8d8;
    case 'magic-bolt': return 0x80c8ff;
    case 'fireball': return 0xff8030;
  }
}

function buildProjectileMesh(kind: PlayerProjectileKind): Mesh {
  switch (kind) {
    case 'dagger': {
      const mat = new MeshStandardMaterial({
        color: 0xc8c8d8,
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x202028,
        emissiveIntensity: 0.4,
      });
      return new Mesh(new ConeGeometry(0.07, 0.5, 6), mat);
    }
    case 'magic-bolt': {
      const mat = new MeshStandardMaterial({
        color: 0x80c8ff,
        roughness: 0.2,
        metalness: 0.0,
        emissive: 0x4080ff,
        emissiveIntensity: 1.6,
        transparent: true,
        opacity: 0.9,
      });
      return new Mesh(new SphereGeometry(0.18, 12, 10), mat);
    }
    case 'fireball': {
      const mat = new MeshStandardMaterial({
        color: 0xff8030,
        roughness: 0.5,
        metalness: 0.0,
        emissive: 0xff4010,
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0.95,
      });
      return new Mesh(new SphereGeometry(0.32, 12, 10), mat);
    }
  }
}

// System: tick player projectiles, home (if applicable), collide with hostiles, despawn on hit/lifetime.
export function playerProjectileSystem(world: World, ctx: { dt: number; elapsed: number }): void {
  const now = performance.now() / 1000;

  for (const e of world.queryWith(C.Projectile)) {
    if (!e.tags.has(PLAYER_PROJ_TAG)) continue;
    const proj = e.components.get(C.Projectile) as ProjectileComponent;
    const extras = e.components.get(PLAYER_PROJ_EXTRAS) as PlayerProjectileExtras | undefined;
    if (!extras) continue;

    if (now - proj.spawnTime > proj.lifetime) {
      world.despawn(e.id);
      continue;
    }

    // Homing: bend velocity toward homing target (or pick a new one if old target died).
    if (extras.homing) {
      let target: Entity | undefined;
      if (extras.homingEntityId !== null) {
        target = world.get(extras.homingEntityId);
        if (!target || !target.alive || !target.tags.has('hostile')) {
          // Re-acquire nearest hostile.
          const newT = nearestHostile(world, e.object3d.position.x, e.object3d.position.z, 14);
          target = newT ?? undefined;
          extras.homingEntityId = newT ? newT.id : null;
        }
      }
      if (target) {
        const tx = target.object3d.position.x;
        const tz = target.object3d.position.z;
        const dx = tx - e.object3d.position.x;
        const dz = tz - e.object3d.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) {
          const desiredX = (dx / d) * proj.speed;
          const desiredZ = (dz / d) * proj.speed;
          // Lerp velocity toward desired, parameterized by turn rate.
          const a = Math.min(1, extras.homingTurnRate * ctx.dt);
          extras.velocity.x = extras.velocity.x * (1 - a) + desiredX * a;
          extras.velocity.z = extras.velocity.z * (1 - a) + desiredZ * a;
          // Re-normalize to maintain speed.
          const vlen = Math.hypot(extras.velocity.x, extras.velocity.z) || 1;
          extras.velocity.x = (extras.velocity.x / vlen) * proj.speed;
          extras.velocity.z = (extras.velocity.z / vlen) * proj.speed;
        }
      }
    }

    // Move
    e.object3d.position.x += extras.velocity.x * ctx.dt;
    e.object3d.position.y += extras.velocity.y * ctx.dt;
    e.object3d.position.z += extras.velocity.z * ctx.dt;

    // Re-orient daggers along velocity
    if (extras.kind === 'dagger') {
      const yaw = Math.atan2(extras.velocity.x, extras.velocity.z);
      e.object3d.rotation.y = yaw;
    }

    // Pulse fireballs/bolts
    if (extras.kind === 'magic-bolt' || extras.kind === 'fireball') {
      const m = (e.object3d as Mesh).material as MeshStandardMaterial;
      m.opacity = 0.75 + Math.sin(ctx.elapsed * 22) * 0.2;
    }

    if (extras.hasHit) continue;

    // Collide with hostiles
    const px = e.object3d.position.x;
    const pz = e.object3d.position.z;
    const r2 = (proj.hitRadius + 0.6) * (proj.hitRadius + 0.6); // generous radius (mob hitboxes ~0.45)
    for (const h of world.query('hostile')) {
      const dx = h.object3d.position.x - px;
      const dz = h.object3d.position.z - pz;
      if (dx * dx + dz * dz <= r2) {
        extras.hasHit = true;
        dealDamage(world, proj.ownerEntityId, h, proj.damage, extras.isCrit, extras.hitColor);
        if (extras.kind === 'fireball') {
          juiceHit(world, {
            hitstop: 0.04,
            shake: { amplitude: 0.18, duration: 0.18 },
            sfx: 'fireball-hit',
            x: h.object3d.position.x,
            z: h.object3d.position.z,
          });
        } else {
          juiceHit(world, {
            sfx: extras.kind === 'magic-bolt' ? 'bolt-hit' : 'dagger-hit',
            x: h.object3d.position.x,
            z: h.object3d.position.z,
          });
        }
        world.despawn(e.id);
        break;
      }
    }
  }
}
