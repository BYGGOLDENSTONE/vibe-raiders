// Procgen item names: prefix + base + suffix.
// Base names are picked from a per-slot pool. Prefix/suffix pools widen with rarity.

import type { ItemRarity, ItemSlot } from '../../core/components';

const BASES: Record<ItemSlot, string[]> = {
  weapon: [
    'Greatsword', 'Longsword', 'Warblade', 'Cleaver', 'Mace', 'Maul', 'Hatchet',
    'Spear', 'Halberd', 'Glaive', 'Scythe', 'Dagger', 'Stiletto', 'Kris',
    'Shortbow', 'Longbow', 'Crossbow', 'Arbalest',
    'Rod', 'Wand', 'Sceptre', 'Staff', 'Tome', 'Orb', 'Focus',
  ],
  head: [
    'Helm', 'Greathelm', 'Sallet', 'Coif', 'Cowl', 'Hood', 'Mask',
    'Circlet', 'Diadem', 'Crown', 'Mitre', 'Skullcap',
  ],
  chest: [
    'Plate', 'Cuirass', 'Hauberk', 'Brigandine', 'Mail', 'Robe', 'Vestment',
    'Tunic', 'Jerkin', 'Coat', 'Garb', 'Wraps', 'Carapace',
  ],
  accessory: [
    'Ring', 'Band', 'Signet', 'Loop', 'Amulet', 'Pendant', 'Talisman',
    'Charm', 'Idol', 'Relic', 'Sigil', 'Token',
  ],
};

const PREFIX_COMMON = ['Iron', 'Steel', 'Stone', 'Bone', 'Hide', 'Worn', 'Crude', 'Plain'];
const PREFIX_MAGIC = ['Sharp', 'Heavy', 'Swift', 'Sturdy', 'Vital', 'Keen', 'Cruel', 'Glinting', 'Warstone', 'Brutal'];
const PREFIX_RARE = ['Doomforged', 'Stormcalled', 'Bloodbound', 'Ashen', 'Voidsteel', 'Suncast', 'Moonsilver', 'Shadeweave', 'Direwrought', 'Hexbound'];
const PREFIX_LEGENDARY = ['Apocalyptic', 'Worldbreaker', 'Godslayer', 'Soulrender', 'Eternal', 'Primordial', 'Cataclysmic', 'Empyreal'];

const SUFFIX_MAGIC = ['of Power', 'of Vigor', 'of Speed', 'of the Bear', 'of the Wolf', 'of the Hawk', 'of Ruin', 'of Embers', 'of Frost'];
const SUFFIX_RARE = [
  'of the Moon', 'of the Sun', 'of the Abyss', 'of Storms', 'of the Forgotten',
  'of the Crimson Dawn', 'of Hollow Echoes', 'of Pale Flame', 'of Iron Will', 'of the Dread Veil',
];
const SUFFIX_LEGENDARY = [
  'of the Last King', 'of the Ninth Hour', 'of the Black Tide', 'of Ten Thousand Embers',
  'of the Sundered Sky', 'of the World Wound', 'of the Final Verse', 'of Endless Dusk',
];

function pick<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function generateItemName(slot: ItemSlot, rarity: ItemRarity): string {
  const base = pick(BASES[slot]);
  switch (rarity) {
    case 'common':
      // Maybe a plain prefix.
      if (Math.random() < 0.6) return `${pick(PREFIX_COMMON)} ${base}`;
      return base;
    case 'magic': {
      const wantPrefix = Math.random() < 0.7;
      const wantSuffix = !wantPrefix || Math.random() < 0.5;
      const p = wantPrefix ? `${pick(PREFIX_MAGIC)} ` : '';
      const s = wantSuffix ? ` ${pick(SUFFIX_MAGIC)}` : '';
      return `${p}${base}${s}`;
    }
    case 'rare':
      return `${pick(PREFIX_RARE)} ${base} ${pick(SUFFIX_RARE)}`;
    case 'legendary':
      return `${pick(PREFIX_LEGENDARY)} ${base} ${pick(SUFFIX_LEGENDARY)}`;
  }
}

export function pickRandomSlot(): ItemSlot {
  const slots: ItemSlot[] = ['weapon', 'head', 'chest', 'accessory'];
  return slots[Math.floor(Math.random() * slots.length)] as ItemSlot;
}

export function baseIdFor(slot: ItemSlot, name: string): string {
  // Strip prefix/suffix to find the base word — best-effort, no guarantees.
  const bases = BASES[slot];
  for (const b of bases) {
    if (name.includes(b)) return `${slot}-${b.toLowerCase().replace(/\s+/g, '-')}`;
  }
  return `${slot}-unknown`;
}
