import { Object3D } from 'three';
import type { Entity, EntityId, Tag, ComponentName } from './types';

let nextId = 1;

export function createEntity(opts: {
  tags?: Iterable<Tag>;
  object3d?: Object3D;
  components?: Iterable<[ComponentName, unknown]>;
} = {}): Entity {
  const id: EntityId = nextId++;
  const e: Entity = {
    id,
    tags: new Set(opts.tags ?? []),
    components: new Map(opts.components ?? []),
    object3d: opts.object3d ?? new Object3D(),
    alive: true,
  };
  e.object3d.userData.entityId = id;
  return e;
}

export function addTag(e: Entity, tag: Tag): void {
  e.tags.add(tag);
}

export function removeTag(e: Entity, tag: Tag): void {
  e.tags.delete(tag);
}

export function hasTags(e: Entity, ...tags: Tag[]): boolean {
  for (const t of tags) if (!e.tags.has(t)) return false;
  return true;
}

export function setComponent<T>(e: Entity, name: ComponentName, value: T): void {
  e.components.set(name, value);
}

export function getComponent<T>(e: Entity, name: ComponentName): T | undefined {
  return e.components.get(name) as T | undefined;
}

export function requireComponent<T>(e: Entity, name: ComponentName): T {
  const v = e.components.get(name);
  if (v === undefined) throw new Error(`Entity ${e.id} missing component ${name}`);
  return v as T;
}

export function hasComponent(e: Entity, name: ComponentName): boolean {
  return e.components.has(name);
}
