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

export interface EventMap {
  'entity:spawn': { entity: Entity };
  'entity:despawn': { entity: Entity };
  'damage': { target: Entity; source: Entity | null; amount: number };
  'death': { entity: Entity; killer: Entity | null };
  'loot:pickup': { entity: Entity; itemId: string; weight: number; points: number };
  'extract:start': { entity: Entity; shelterId: string };
  'extract:complete': { entity: Entity; score: number };
  'announce': { message: string; ttlMs: number };
  'shoot': { entity: Entity; origin: [number, number, number]; dir: [number, number, number] };
  'hit': { source: Entity; target: Entity; point: [number, number, number] };
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;
