import type { Vector3 } from 'three';

export interface TransformComponent {
  velocity: Vector3;
  grounded: boolean;
}

export interface HealthComponent {
  current: number;
  max: number;
}

export interface WeaponComponent {
  magazine: number;
  magazineSize: number;
  reserve: number;
  damage: number;
  fireRateMs: number;
  reloadMs: number;
  lastShotAt: number;
  reloading: boolean;
  reloadStartedAt: number;
  range: number;
}

export interface BackpackComponent {
  capacityKg: number;
  weightKg: number;
  items: BackpackItem[];
  pendingScore: number;
}

export interface BackpackItem {
  id: string;
  rarity: LootRarity;
  weightKg: number;
  points: number;
}

export type LootRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface PlayerComponent {
  name: string;
  color: number;
  isLocal: boolean;
  squadId: string | null;
  netId: string | null;
}

export interface BotComponent {
  kind: BotKind;
  state: BotState;
  targetId: number | null;
  patrolPath: [number, number, number][];
  patrolIndex: number;
  nextThinkAt: number;
  scoreReward: number;
}

export type BotKind = 'drone' | 'sentry' | 'hunter';
export type BotState = 'idle' | 'patrol' | 'chase' | 'attack' | 'dead';

export interface LootComponent {
  rarity: LootRarity;
  weightKg: number;
  points: number;
  itemId: string;
}

export interface AmmoCrateComponent {
  rounds: number;
  weightKg: number;
}

export interface MedkitComponent {
  heal: number;
  weightKg: number;
}

export interface ShelterComponent {
  shelterId: string;
  isOpen: boolean;
  opensAt: number;
  closesAt: number;
  position: [number, number, number];
}

export interface NetComponent {
  netId: string;
  lastSyncAt: number;
  authoritative: boolean;
}

export const C = {
  Transform: 'transform',
  Health: 'health',
  Weapon: 'weapon',
  Backpack: 'backpack',
  Player: 'player',
  Bot: 'bot',
  Loot: 'loot',
  AmmoCrate: 'ammoCrate',
  Medkit: 'medkit',
  Shelter: 'shelter',
  Net: 'net',
} as const;

export const T = {
  Player: 'player',
  LocalPlayer: 'localPlayer',
  RemotePlayer: 'remotePlayer',
  Bot: 'bot',
  Boss: 'boss',
  Loot: 'loot',
  Pickup: 'pickup',
  Shelter: 'shelter',
  Projectile: 'projectile',
  Alive: 'alive',
  Dead: 'dead',
  Hostile: 'hostile',
  Friendly: 'friendly',
} as const;
