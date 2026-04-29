import { Object3D, Vector3 } from 'three';
import { createEntity } from '../core/entity';
import { C, T, type TransformComponent, type HealthComponent, type WeaponComponent, type BackpackComponent, type PlayerComponent } from '../core/components';

export interface CreateLocalPlayerOpts {
  name?: string;
  color?: number;
  spawn?: { x: number; y: number; z: number };
}

export function createLocalPlayer(opts: CreateLocalPlayerOpts = {}) {
  const obj = new Object3D();
  obj.position.set(opts.spawn?.x ?? 0, opts.spawn?.y ?? 0, opts.spawn?.z ?? 0);

  const transform: TransformComponent = {
    velocity: new Vector3(),
    grounded: true,
  };

  const health: HealthComponent = {
    current: 100,
    max: 100,
  };

  const weapon: WeaponComponent = {
    magazine: 20,
    magazineSize: 20,
    reserve: 40,
    damage: 25,
    fireRateMs: 110,
    reloadMs: 1500,
    lastShotAt: 0,
    reloading: false,
    reloadStartedAt: 0,
    range: 120,
  };

  const backpack: BackpackComponent = {
    capacityKg: 20,
    weightKg: 0,
    items: [],
    pendingScore: 0,
  };

  const player: PlayerComponent = {
    name: opts.name ?? 'Raider',
    color: opts.color ?? 0xf3b35a,
    isLocal: true,
    squadId: null,
    netId: null,
  };

  const entity = createEntity({
    tags: [T.Player, T.LocalPlayer, T.Alive],
    object3d: obj,
    components: [
      [C.Transform, transform],
      [C.Health, health],
      [C.Weapon, weapon],
      [C.Backpack, backpack],
      [C.Player, player],
    ],
  });

  return entity;
}
