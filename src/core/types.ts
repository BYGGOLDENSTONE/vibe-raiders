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

// All game events live here. Modules emit + subscribe via World.emit/on.
// IDs are entity IDs; full data is looked up at handle time so payloads stay small.
export interface EventMap {
  'entity:spawn': { entity: Entity };
  'entity:despawn': { entity: Entity };

  // Combat
  'damage:dealt': { sourceId: number; targetId: number; amount: number; isCrit: boolean };
  'entity:died': { entityId: number; killerId: number | null };
  'mob:killed': { entityId: number; killerId: number | null; xpReward: number };

  // Progression
  'xp:gained': { entityId: number; amount: number };
  'level:up': { entityId: number; newLevel: number };

  // Loot / inventory
  'item:dropped': { dropEntityId: number };
  'item:picked': { pickerId: number; itemId: string };
  'item:equipped': { entityId: number; slot: string; itemId: string | null };

  // Skills
  'skill:cast': { casterId: number; skillId: string; targetX: number; targetZ: number };

  // Player input intents (input → game logic)
  'player:moveCommand': { entityId: number; targetX: number; targetZ: number };
  'player:basicAttack': { entityId: number; targetId: number };
  'player:skillCast': { entityId: number; slotIndex: number; targetX: number; targetZ: number };

  // FX cues (any system can request visual feedback)
  'fx:hitstop': { duration: number };
  'fx:screenshake': { amplitude: number; duration: number };
  'fx:hit': { x: number; y: number; z: number; color: number; isCrit: boolean };
  'fx:floatingText': { x: number; y: number; z: number; text: string; color: number };

  // Audio cues
  'audio:sfx': { id: string; x?: number; z?: number };

  // Zone transitions
  'zone:enter': { zone: string };
  'zone:exit': { zone: string };
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;
