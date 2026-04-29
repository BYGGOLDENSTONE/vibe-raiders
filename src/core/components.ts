import type { Vector3 } from 'three';

// Universal — anything that moves in 3D wants this.
export interface TransformComponent {
  velocity: Vector3;
  grounded: boolean;
}

export interface HealthComponent {
  hp: number;
  maxHp: number;
  lastHitTime: number;
  invulnUntil: number;
}

export type ResourceKind = 'mana' | 'rage' | 'energy' | 'fury';
export interface ResourceComponent {
  kind: ResourceKind;
  current: number;
  max: number;
  regenPerSec: number;
}

export type Faction = 'player' | 'hostile' | 'neutral' | 'boss';
export interface FactionComponent {
  faction: Faction;
}

export interface CombatantComponent {
  baseDamage: number;
  attackRange: number;
  attackSpeed: number; // attacks per second
  lastAttackTime: number;
  critChance: number;
  critMult: number;
}

export type ClassId = 'rogue' | 'barbarian' | 'sorcerer';
export interface PlayerComponent {
  classId: ClassId;
  name: string;
  color: number;
  level: number;
  xp: number;
  xpToNext: number;
}

export type AIState = 'idle' | 'aggro' | 'chase' | 'attack' | 'flee' | 'dead';
export interface AIBrainComponent {
  state: AIState;
  targetId: number | null;
  leashOrigin: Vector3;
  leashRadius: number;
  aggroRadius: number;
  attackRange: number;
  nextThinkTime: number;
}

// Click-to-move target.
export interface MoveTargetComponent {
  target: Vector3 | null;
  speed: number;
}

export interface SkillSlot {
  id: string;
  cooldownEnd: number;
}
export interface SkillUserComponent {
  // slots[0]=basic, [1-3]=actives, [4]=ult, [5]=dash
  slots: SkillSlot[];
  // Progression: which slots the player has unlocked. Default: basic + dash open.
  // Index aligns with `slots`. Filled by the skills module on init/respawn.
  unlockedSlots: boolean[];
  // Current rank per slot (0 = base, max 5). Damage / cooldown scale off this.
  skillRanks: number[];
  // Unspent skill points the player can spend by right-clicking a hotbar slot.
  skillPoints: number;
}

export interface HitboxComponent {
  radius: number;
  height: number;
}

export type ItemRarity = 'common' | 'magic' | 'rare' | 'legendary';
export type ItemSlot = 'weapon' | 'head' | 'chest' | 'accessory';

export interface ItemAffix {
  stat: string; // e.g. 'damage', 'critChance', 'maxHp', 'fireDamage'
  value: number;
}

export interface ItemInstance {
  id: string;
  baseId: string;
  rarity: ItemRarity;
  name: string;
  slot: ItemSlot;
  affixes: ItemAffix[];
  iLevel: number;
  iconColor: number;
}

export interface InventoryComponent {
  items: ItemInstance[];
  capacity: number;
}

export interface EquipmentComponent {
  weapon: ItemInstance | null;
  head: ItemInstance | null;
  chest: ItemInstance | null;
  accessory: ItemInstance | null;
}

export interface LootDropComponent {
  item: ItemInstance;
  spawnTime: number;
}

export interface ProjectileComponent {
  ownerEntityId: number;
  damage: number;
  speed: number;
  lifetime: number;
  spawnTime: number;
  hitRadius: number;
  faction: Faction;
}

export interface StatusEffect {
  id: string;
  endTime: number;
  power: number;
}
export interface StatusEffectsComponent {
  effects: StatusEffect[];
}

// Component-name registry. Use these constants instead of raw strings.
export const C = {
  Transform: 'transform',
  Health: 'health',
  Resource: 'resource',
  Faction: 'faction',
  Combatant: 'combatant',
  Player: 'player',
  AIBrain: 'aiBrain',
  MoveTarget: 'moveTarget',
  SkillUser: 'skillUser',
  Hitbox: 'hitbox',
  Inventory: 'inventory',
  Equipment: 'equipment',
  LootDrop: 'lootDrop',
  Projectile: 'projectile',
  StatusEffects: 'statusEffects',
} as const;
