import type { Object3D } from 'three';
import type {
  EmpireSnapshot,
  GalacticEvent,
  LeaderboardEntry,
  PlanetState,
  ResourceId,
  RouteDef,
  ShipTrajectory,
} from '../game/economy/types';

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

// Game-agnostic event bus. Modules emit + subscribe via World.emit/on.
// Locked at Wave 0 — adding new events later is fine, but keep payloads minimal
// and serializable so multiplayer subagents can pipe events directly to the bus.
export interface EventMap {
  // Core ECS lifecycle.
  'entity:spawn': { entity: Entity };
  'entity:despawn': { entity: Entity };

  // Galaxy / world building (Wave 1).
  'galaxy:seedSet': { seed: number };
  'galaxy:planetUpdated': { planetId: string; state: PlanetState };

  // Local economy (Wave 2+).
  'economy:resourceChanged': { resource: ResourceId; amount: number; perSecond: number };
  'economy:upgradeBought': { upgradeId: string; level: number; planetId?: string };
  'economy:planetUnlocked': { planetId: string };
  'economy:planetClaimed': { planetId: string; ownerId: string };
  'economy:routeCreated': { route: RouteDef };
  'economy:routeUpgraded': { routeId: string; level: number };
  'economy:routeDissolved': { routeId: string };
  'economy:routeDelivered': { routeId: string; payload: number; resource: ResourceId };
  'economy:saveLoaded': { offlineMs: number };

  // Multiplayer replication (Wave 1+).
  'multiplayer:welcome': {
    seed: number;
    yourPlayerId: string;
    yourSectorId: number;
    serverTimeMs: number;
    empires: EmpireSnapshot[];
    shipsInFlight: ShipTrajectory[];
    activeGalacticEvents: GalacticEvent[];
    lastEventId: number;
  };
  'multiplayer:empireUpdated': { empire: EmpireSnapshot };
  'multiplayer:empireDormant': { playerId: string };
  'multiplayer:empireLeft': { playerId: string };
  'multiplayer:proposalReceived': {
    proposalId: string;
    fromPlayerId: string;
    toPlayerId: string;
    fromPlanetId: string;
    toPlanetId: string;
  };
  'multiplayer:proposalResolved': { proposalId: string; accepted: boolean };
  'multiplayer:leaderboard': { entries: LeaderboardEntry[] };
  'multiplayer:tradeGiftReceived': { fromId: string; value: number };
  'multiplayer:galacticEvent': { event: GalacticEvent };
  'multiplayer:shipLaunched': { ship: ShipTrajectory };

  // UI surface (Wave 3+).
  'ui:event': { kind: string; text: string; color?: number };
  'ui:milestoneCompleted': { milestoneId: string };
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;
