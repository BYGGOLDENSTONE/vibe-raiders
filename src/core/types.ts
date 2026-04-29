import type { Object3D } from 'three';

export type EntityId = number;
export type Tag = string;
export type ComponentName = string;

export interface Entity {
  id: EntityId;
  tags: Set<Tag>;
  components: Map<ComponentName, unknown>;
  object3d: Object3D;
  alive: boolean;
}

export interface FrameContext {
  dt: number;
  elapsed: number;
  frame: number;
}

export type System = (world: import('./world').World, ctx: FrameContext) => void;

// Base events. Extend per-game by augmenting this map in a project-side .d.ts.
export interface EventMap {
  'entity:spawn': { entity: Entity };
  'entity:despawn': { entity: Entity };
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;
