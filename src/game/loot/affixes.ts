// Affix templates — the procgen heart of DUSK loot.
// Each AffixTemplate describes one possible roll. `rollItem` consults this list,
// filters by slot, picks N (depending on rarity), rolls a tier, and resolves
// a value from `rangeAt(iLevel, tier)`.
//
// Stat application is intentionally NOT wired here. The combat / inventory
// modules read `ItemAffix.stat` and decide what to do with it. For the jam,
// the depth + tooltip text is the showpiece.

import type { ItemSlot } from '../../core/components';

export interface AffixTemplate {
  key: string;
  stat: string; // matches ItemAffix.stat — combat/inventory consume this
  slotMask: ReadonlyArray<ItemSlot>;
  // tier 0 weakest, 5 mightiest. Higher rarity weights toward higher tiers.
  // value = lerp(min, max, rng) * tierMul, where tierMul ~ 1 + tier*0.4
  baseAt(iLevel: number): { min: number; max: number };
  tierMul?: (tier: number) => number; // defaults to 1 + tier * 0.4
  // displayFormat: '{value}' is replaced with the rolled number.
  // Round/format hint: 'int' (default), 'pct' (single decimal), 'flt' (1 decimal).
  format: 'int' | 'pct' | 'flt';
  display: string;
  // Optional: tag affixes that only roll on legendary+. Used by `unique` slot.
  unique?: boolean;
  // Optional: weight for selection (default 1). Rare/exotic affixes can be downweighted.
  weight?: number;
}

const ALL: ReadonlyArray<ItemSlot> = ['weapon', 'head', 'chest', 'accessory'];
const WEAPON: ReadonlyArray<ItemSlot> = ['weapon'];
const CHEST: ReadonlyArray<ItemSlot> = ['chest'];
const ACCESSORY: ReadonlyArray<ItemSlot> = ['accessory'];
const WEAPON_ACCESSORY: ReadonlyArray<ItemSlot> = ['weapon', 'accessory'];
const HEAD_ACCESSORY: ReadonlyArray<ItemSlot> = ['head', 'accessory'];
const HEAD_CHEST: ReadonlyArray<ItemSlot> = ['head', 'chest'];
const CHEST_ACCESSORY: ReadonlyArray<ItemSlot> = ['chest', 'accessory'];

const lin = (a: number, b: number) => (i: number) => ({ min: a + i * 0.4, max: b + i * 0.8 });
const pct = (a: number, b: number) => (i: number) => ({ min: a + i * 0.05, max: b + i * 0.12 });
const flat = (a: number, b: number) => (_i: number) => ({ min: a, max: b });

export const AFFIX_TABLE: ReadonlyArray<AffixTemplate> = [
  // === Damage ===
  { key: 'flat-damage', stat: 'damage', slotMask: WEAPON_ACCESSORY,
    baseAt: lin(2, 6), format: 'int', display: '+{value} Damage' },
  { key: 'pct-damage', stat: 'damagePct', slotMask: WEAPON,
    baseAt: pct(4, 9), format: 'pct', display: '+{value}% Damage' },
  { key: 'min-damage', stat: 'minDamage', slotMask: WEAPON,
    baseAt: lin(1, 3), format: 'int', display: '+{value} Min Damage' },
  { key: 'max-damage', stat: 'maxDamage', slotMask: WEAPON,
    baseAt: lin(2, 5), format: 'int', display: '+{value} Max Damage' },

  // === Crit ===
  { key: 'crit-chance', stat: 'critChance', slotMask: ALL,
    baseAt: pct(1.5, 4), format: 'pct', display: '+{value}% Crit Chance' },
  { key: 'crit-damage', stat: 'critDamage', slotMask: WEAPON_ACCESSORY,
    baseAt: pct(8, 18), format: 'pct', display: '+{value}% Crit Damage' },
  { key: 'crit-vs-low', stat: 'critVsLow', slotMask: WEAPON,
    baseAt: pct(6, 14), format: 'pct', display: '+{value}% Crit Chance vs. injured enemies' },

  // === Speed ===
  { key: 'attack-speed', stat: 'attackSpeed', slotMask: WEAPON_ACCESSORY,
    baseAt: pct(3, 8), format: 'pct', display: '+{value}% Attack Speed' },
  { key: 'movement-speed', stat: 'moveSpeed', slotMask: CHEST,
    baseAt: pct(3, 7), format: 'pct', display: '+{value}% Movement Speed' },
  { key: 'cdr', stat: 'cooldownReduction', slotMask: ALL,
    baseAt: pct(2, 6), format: 'pct', display: '+{value}% Cooldown Reduction' },
  { key: 'projectile-speed', stat: 'projectileSpeed', slotMask: WEAPON,
    baseAt: pct(5, 14), format: 'pct', display: '+{value}% Projectile Speed' },

  // === Survivability ===
  { key: 'max-hp', stat: 'maxHp', slotMask: HEAD_CHEST,
    baseAt: lin(8, 22), format: 'int', display: '+{value} Maximum Life' },
  { key: 'hp-regen', stat: 'hpRegen', slotMask: CHEST_ACCESSORY,
    baseAt: lin(0.5, 2), format: 'flt', display: '+{value} Life Regen / sec' },
  { key: 'armor', stat: 'armor', slotMask: HEAD_CHEST,
    baseAt: lin(6, 16), format: 'int', display: '+{value} Armor' },
  { key: 'block-chance', stat: 'blockChance', slotMask: CHEST,
    baseAt: pct(2, 6), format: 'pct', display: '+{value}% Block Chance' },
  { key: 'dodge-chance', stat: 'dodgeChance', slotMask: HEAD_CHEST,
    baseAt: pct(1.5, 5), format: 'pct', display: '+{value}% Dodge Chance' },
  { key: 'dmg-reduction', stat: 'damageReduction', slotMask: CHEST,
    baseAt: pct(2, 5), format: 'pct', display: '+{value}% Damage Reduction' },
  { key: 'thorns', stat: 'thorns', slotMask: CHEST,
    baseAt: lin(2, 7), format: 'int', display: 'Thorns: reflect {value} damage' },

  // === Sustain ===
  { key: 'life-on-hit', stat: 'lifeOnHit', slotMask: WEAPON_ACCESSORY,
    baseAt: lin(0.5, 2), format: 'flt', display: '+{value} Life on Hit' },
  { key: 'life-leech', stat: 'lifeLeech', slotMask: WEAPON,
    baseAt: pct(0.5, 1.8), format: 'pct', display: '+{value}% Life Leech' },
  { key: 'mana-on-hit', stat: 'resourceOnHit', slotMask: WEAPON_ACCESSORY,
    baseAt: lin(1, 3), format: 'int', display: '+{value} Resource on Hit' },
  { key: 'cost-ignore', stat: 'costIgnoreChance', slotMask: ACCESSORY,
    baseAt: pct(3, 8), format: 'pct', display: '{value}% Chance to ignore Resource cost' },

  // === Conditional damage ===
  { key: 'dmg-vs-elite', stat: 'damageVsElite', slotMask: WEAPON,
    baseAt: pct(5, 12), format: 'pct', display: '+{value}% Damage to Elites' },
  { key: 'dmg-vs-boss', stat: 'damageVsBoss', slotMask: WEAPON_ACCESSORY,
    baseAt: pct(6, 14), format: 'pct', display: '+{value}% Damage to Bosses' },
  { key: 'dmg-full-hp', stat: 'damageWhileFull', slotMask: CHEST,
    baseAt: pct(8, 18), format: 'pct', display: '+{value}% Damage while at Full Life' },
  { key: 'dmg-low-hp', stat: 'damageWhileLow', slotMask: CHEST_ACCESSORY,
    baseAt: pct(10, 22), format: 'pct', display: '+{value}% Damage while below 30% Life' },
  { key: 'dmg-vs-stunned', stat: 'damageVsStunned', slotMask: WEAPON,
    baseAt: pct(8, 18), format: 'pct', display: '+{value}% Damage to Stunned enemies' },
  { key: 'dmg-from-behind', stat: 'damageFromBehind', slotMask: WEAPON,
    baseAt: pct(8, 16), format: 'pct', display: '+{value}% Damage from behind' },

  // === Elemental ===
  { key: 'fire-dmg', stat: 'fireDamage', slotMask: WEAPON,
    baseAt: pct(6, 14), format: 'pct', display: '+{value}% Fire Damage' },
  { key: 'cold-dmg', stat: 'coldDamage', slotMask: WEAPON,
    baseAt: pct(6, 14), format: 'pct', display: '+{value}% Cold Damage (chance to slow)' },
  { key: 'lightning-dmg', stat: 'lightningDamage', slotMask: WEAPON,
    baseAt: pct(6, 14), format: 'pct', display: '+{value}% Lightning Damage (chance to chain)' },
  { key: 'poison-dmg', stat: 'poisonDamage', slotMask: WEAPON,
    baseAt: pct(6, 14), format: 'pct', display: '+{value}% Poison Damage (chance to apply DoT)' },
  { key: 'physical-dmg', stat: 'physicalDamage', slotMask: WEAPON,
    baseAt: pct(5, 12), format: 'pct', display: '+{value}% Physical Damage' },
  { key: 'arcane-dmg', stat: 'arcaneDamage', slotMask: WEAPON,
    baseAt: pct(6, 14), format: 'pct', display: '+{value}% Arcane Damage' },

  // === Resistances ===
  { key: 'fire-res', stat: 'fireResist', slotMask: HEAD_CHEST,
    baseAt: pct(3, 9), format: 'pct', display: '+{value}% Fire Resistance' },
  { key: 'cold-res', stat: 'coldResist', slotMask: HEAD_CHEST,
    baseAt: pct(3, 9), format: 'pct', display: '+{value}% Cold Resistance' },
  { key: 'lightning-res', stat: 'lightningResist', slotMask: HEAD_CHEST,
    baseAt: pct(3, 9), format: 'pct', display: '+{value}% Lightning Resistance' },
  { key: 'poison-res', stat: 'poisonResist', slotMask: HEAD_CHEST,
    baseAt: pct(3, 9), format: 'pct', display: '+{value}% Poison Resistance' },
  { key: 'all-res', stat: 'allResist', slotMask: ACCESSORY,
    baseAt: pct(2, 5), format: 'pct', display: '+{value}% All Resistance', weight: 0.5 },

  // === Utility / find ===
  { key: 'xp-gain', stat: 'xpGain', slotMask: HEAD_ACCESSORY,
    baseAt: pct(3, 8), format: 'pct', display: '+{value}% Experience Gained' },
  { key: 'gold-find', stat: 'goldFind', slotMask: HEAD_ACCESSORY,
    baseAt: pct(8, 22), format: 'pct', display: '+{value}% Gold Find' },
  { key: 'magic-find', stat: 'magicFind', slotMask: HEAD_ACCESSORY,
    baseAt: pct(4, 12), format: 'pct', display: '+{value}% Magic Find' },

  // === Skill modifiers ===
  { key: 'aoe-radius', stat: 'aoeRadius', slotMask: WEAPON_ACCESSORY,
    baseAt: pct(4, 12), format: 'pct', display: '+{value}% Area of Effect' },
  { key: 'extra-projectile', stat: 'extraProjectiles', slotMask: WEAPON,
    baseAt: flat(1, 1), format: 'int', display: '+{value} Projectile fired', weight: 0.4 },
  { key: 'pierce-chance', stat: 'pierceChance', slotMask: WEAPON,
    baseAt: pct(8, 22), format: 'pct', display: '+{value}% Pierce Chance' },
  { key: 'summon-dmg', stat: 'summonDamage', slotMask: ACCESSORY,
    baseAt: pct(6, 16), format: 'pct', display: '+{value}% Summon Damage' },

  // === Procs / on-hit ===
  { key: 'stun-chance', stat: 'stunChance', slotMask: WEAPON,
    baseAt: pct(2, 6), format: 'pct', display: '+{value}% Chance to Stun on Hit' },
  { key: 'bleed-chance', stat: 'bleedChance', slotMask: WEAPON,
    baseAt: pct(4, 10), format: 'pct', display: '+{value}% Chance to apply Bleed' },
  { key: 'knockback-chance', stat: 'knockbackChance', slotMask: WEAPON,
    baseAt: pct(3, 9), format: 'pct', display: '+{value}% Chance to Knockback' },

  // === Niche / accessory flavor ===
  { key: 'pickup-radius', stat: 'pickupRadius', slotMask: ACCESSORY,
    baseAt: pct(10, 30), format: 'pct', display: '+{value}% Pickup Radius' },
  { key: 'reduced-dmg-elite', stat: 'reducedDmgFromElites', slotMask: CHEST,
    baseAt: pct(3, 8), format: 'pct', display: '+{value}% Damage Reduction from Elites' },
  { key: 'reduced-dmg-ranged', stat: 'reducedDmgFromRanged', slotMask: CHEST,
    baseAt: pct(3, 8), format: 'pct', display: '+{value}% Damage Reduction from Ranged' },
  { key: 'reduced-dmg-melee', stat: 'reducedDmgFromMelee', slotMask: CHEST,
    baseAt: pct(3, 8), format: 'pct', display: '+{value}% Damage Reduction from Melee' },

  // === Class flavor (placeholder hooks) ===
  { key: 'rogue-energy-max', stat: 'maxEnergy', slotMask: ACCESSORY,
    baseAt: lin(4, 10), format: 'int', display: '+{value} Maximum Energy' },
  { key: 'barb-rage-gen', stat: 'rageGen', slotMask: WEAPON,
    baseAt: pct(4, 10), format: 'pct', display: '+{value}% Rage Generation' },
  { key: 'sorc-mana-regen', stat: 'manaRegen', slotMask: ACCESSORY,
    baseAt: lin(1, 3), format: 'flt', display: '+{value} Mana Regen / sec' },

  // === Legendary-only "unique" affixes — game-changers ===
  { key: 'unq-double-strike', stat: 'doubleStrikeChance', slotMask: WEAPON,
    baseAt: pct(8, 18), format: 'pct', display: '{value}% Chance to strike twice', unique: true },
  { key: 'unq-explode-on-kill', stat: 'explodeOnKill', slotMask: WEAPON,
    baseAt: lin(5, 18), format: 'int', display: 'Killed enemies explode for {value} damage', unique: true },
  { key: 'unq-shield-on-crit', stat: 'shieldOnCrit', slotMask: ACCESSORY,
    baseAt: lin(8, 24), format: 'int', display: 'Crits grant a {value} life shield (3s)', unique: true },
  { key: 'unq-vampiric', stat: 'vampiric', slotMask: WEAPON,
    baseAt: pct(2, 5), format: 'pct', display: 'Heal for {value}% of damage dealt', unique: true },
  { key: 'unq-second-wind', stat: 'secondWind', slotMask: CHEST,
    baseAt: pct(20, 50), format: 'pct', display: 'Once per fight, revive at {value}% Life', unique: true },
  { key: 'unq-explosive-arrow', stat: 'explosiveProjectiles', slotMask: WEAPON,
    baseAt: pct(20, 60), format: 'pct', display: 'Projectiles explode for {value}% damage', unique: true },
  { key: 'unq-skill-echo', stat: 'skillEcho', slotMask: ACCESSORY,
    baseAt: pct(15, 35), format: 'pct', display: '{value}% Chance to cast skills twice', unique: true },
];

export function rollAffixValue(template: AffixTemplate, iLevel: number, tier: number): number {
  const range = template.baseAt(iLevel);
  const t = Math.random();
  const raw = range.min + (range.max - range.min) * t;
  const mul = (template.tierMul ?? defaultTierMul)(tier);
  return raw * mul;
}

function defaultTierMul(tier: number): number {
  return 1 + tier * 0.4;
}

export function formatAffixValue(template: AffixTemplate, value: number): string {
  switch (template.format) {
    case 'int':
      return String(Math.max(1, Math.round(value)));
    case 'pct':
      return value.toFixed(1);
    case 'flt':
      return value.toFixed(1);
  }
}

export function affixesForSlot(slot: ItemSlot, includeUnique: boolean): AffixTemplate[] {
  const out: AffixTemplate[] = [];
  for (const a of AFFIX_TABLE) {
    if (a.unique && !includeUnique) continue;
    if (!a.unique && includeUnique && false) continue; // (no-op kept for clarity)
    if (a.slotMask.indexOf(slot) === -1) continue;
    out.push(a);
  }
  return out;
}

export function pickWeighted<T extends { weight?: number }>(pool: T[], rng: () => number = Math.random): T | null {
  if (pool.length === 0) return null;
  let total = 0;
  for (const p of pool) total += p.weight ?? 1;
  let r = rng() * total;
  for (const p of pool) {
    r -= p.weight ?? 1;
    if (r <= 0) return p;
  }
  return pool[pool.length - 1] ?? null;
}
