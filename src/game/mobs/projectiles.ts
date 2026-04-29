// Projectile spawning + per-frame flight/collision system.
// Used by ranged mobs (archer, wraith). Owner-emitted; collides with player.

import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { createEntity, getComponent, setComponent } from '../../core/entity';
import {
  C,
  type HitboxComponent,
  type ProjectileComponent,
} from '../../core/components';
import { gameState } from '../state';
import type { World } from '../../core/world';

export type ProjectileKind = 'arrow' | 'soul-bolt';

interface ProjectileExtras {
  kind: ProjectileKind;
  velocity: Vector3;
  hasHit: boolean;
}

const PROJECTILE_EXTRAS = 'mob:projectileExtras';

export function spawnProjectile(
  world: World,
  kind: ProjectileKind,
  ownerId: number,
  origin: Vector3,
  target: Vector3,
  damage: number,
): void {
  const speed = 18;
  const lifetime = 3;

  let mesh: Mesh;
  if (kind === 'arrow') {
    const mat = new MeshStandardMaterial({
      color: 0xc8b070,
      roughness: 0.5,
      metalness: 0.2,
    });
    mesh = new Mesh(new CylinderGeometry(0.04, 0.04, 0.6, 6), mat);
    // Lay arrow along its travel axis (cylinder defaults along Y; we'll rotate to face dir)
  } else {
    // soul-bolt
    const mat = new MeshStandardMaterial({
      color: 0x80b8ff,
      roughness: 0.3,
      metalness: 0.0,
      emissive: 0x4070d0,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.85,
    });
    mesh = new Mesh(new SphereGeometry(0.18, 10, 8), mat);
  }
  mesh.position.copy(origin);

  // Velocity toward target snapshot
  const dir = new Vector3().subVectors(target, origin);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  const velocity = dir.multiplyScalar(speed);

  // Orient arrow along velocity
  if (kind === 'arrow') {
    // Cylinder default axis is +Y; rotate so its +Y aligns with velocity direction.
    const yaw = Math.atan2(velocity.x, velocity.z);
    mesh.rotation.y = yaw;
    mesh.rotation.x = Math.PI / 2;
  }

  const entity = createEntity({
    object3d: mesh,
    tags: ['projectile', 'hostile-projectile'],
  });

  setComponent<ProjectileComponent>(entity, C.Projectile, {
    ownerEntityId: ownerId,
    damage,
    speed,
    lifetime,
    spawnTime: performance.now() / 1000,
    hitRadius: 0.4,
    faction: 'hostile',
  });

  const extras: ProjectileExtras = {
    kind,
    velocity,
    hasHit: false,
  };
  setComponent<ProjectileExtras>(entity, PROJECTILE_EXTRAS, extras);

  world.spawn(entity);
}

// System: fly projectiles, collide with player, emit damage on hit, despawn after hit/lifetime.
export function projectileSystem(world: World, ctx: { dt: number; elapsed: number }): void {
  const now = performance.now() / 1000;
  const player = gameState.player;
  const playerHitbox = player ? getComponent<HitboxComponent>(player, C.Hitbox) : undefined;
  const playerRadius = playerHitbox?.radius ?? 0.5;

  for (const e of world.queryWith(C.Projectile)) {
    if (!e.tags.has('hostile-projectile')) continue;
    const proj = e.components.get(C.Projectile) as ProjectileComponent;
    const extras = e.components.get(PROJECTILE_EXTRAS) as ProjectileExtras | undefined;
    if (!extras) continue;

    // Lifetime expired
    if (now - proj.spawnTime > proj.lifetime) {
      world.despawn(e.id);
      continue;
    }

    // Move
    e.object3d.position.x += extras.velocity.x * ctx.dt;
    e.object3d.position.y += extras.velocity.y * ctx.dt;
    e.object3d.position.z += extras.velocity.z * ctx.dt;

    // Soul-bolts pulse opacity
    if (extras.kind === 'soul-bolt') {
      const m = (e.object3d as Mesh).material as MeshStandardMaterial;
      m.opacity = 0.7 + Math.sin(ctx.elapsed * 18) * 0.15;
    }

    // Collide with player
    if (player && !extras.hasHit) {
      const dx = e.object3d.position.x - player.object3d.position.x;
      const dy = e.object3d.position.y - (player.object3d.position.y + 0.9);
      const dz = e.object3d.position.z - player.object3d.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const r = proj.hitRadius + playerRadius;
      if (distSq <= r * r) {
        extras.hasHit = true;
        world.emit('damage:dealt', {
          sourceId: proj.ownerEntityId,
          targetId: player.id,
          amount: proj.damage,
          isCrit: false,
        });
        world.emit('fx:hit', {
          x: player.object3d.position.x,
          y: player.object3d.position.y + 1.0,
          z: player.object3d.position.z,
          color: extras.kind === 'soul-bolt' ? 0x80b8ff : 0xc8b070,
          isCrit: false,
        });
        world.despawn(e.id);
      }
    }
  }
}
