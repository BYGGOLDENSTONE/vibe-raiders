// Item roller. Pick rarity → pick slot → pick affix count → pick affixes → roll values → name.
import type { ItemAffix, ItemInstance, ItemRarity, ItemSlot } from '../../core/components';
import { COLORS } from '../constants';
import {
  AFFIX_TABLE,
  affixesForSlot,
  formatAffixValue,
  pickWeighted,
  rollAffixValue,
  type AffixTemplate,
} from './affixes';
import { baseIdFor, generateItemName, pickRandomSlot } from './naming';

const RARITY_WEIGHTS: ReadonlyArray<{ rarity: ItemRarity; weight: number }> = [
  { rarity: 'common', weight: 70 },
  { rarity: 'magic', weight: 22 },
  { rarity: 'rare', weight: 7 },
  { rarity: 'legendary', weight: 1 },
];

function rollRarity(): ItemRarity {
  let total = 0;
  for (const r of RARITY_WEIGHTS) total += r.weight;
  let n = Math.random() * total;
  for (const r of RARITY_WEIGHTS) {
    n -= r.weight;
    if (n <= 0) return r.rarity;
  }
  return 'common';
}

function affixCountFor(rarity: ItemRarity): number {
  switch (rarity) {
    case 'common': return 0;
    case 'magic': return 1 + Math.floor(Math.random() * 2);   // 1-2
    case 'rare': return 3 + Math.floor(Math.random() * 2);    // 3-4
    case 'legendary': return 4 + Math.floor(Math.random() * 2); // 4-5 + 1 unique
  }
}

function rollTier(rarity: ItemRarity): number {
  // Higher rarity weights toward higher tiers.
  // Use a triangular-ish skew. Each rarity has a baseline minimum tier.
  const r = Math.random();
  switch (rarity) {
    case 'common': return Math.floor(r * 2);                   // 0-1
    case 'magic': return 1 + Math.floor(r * 3);                // 1-3
    case 'rare': return 2 + Math.floor(r * 3);                 // 2-4
    case 'legendary': return 3 + Math.floor(r * 3);            // 3-5
  }
}

function makeId(): string {
  // Small dependency-free unique-ish id. Good enough for a jam.
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 9) +
    Math.random().toString(36).slice(2, 5)
  );
}

function colorFor(rarity: ItemRarity): number {
  return COLORS.loot[rarity];
}

export function rollItem(iLevel: number, slot?: ItemSlot, rarityHint?: ItemRarity): ItemInstance {
  const finalSlot: ItemSlot = slot ?? pickRandomSlot();
  const rarity: ItemRarity = rarityHint ?? rollRarity();
  const count = affixCountFor(rarity);

  // Build candidate pools.
  const normalPool = affixesForSlot(finalSlot, false);
  const used = new Set<string>();
  const affixes: ItemAffix[] = [];

  for (let i = 0; i < count; i++) {
    const remaining = normalPool.filter((a) => !used.has(a.key));
    if (remaining.length === 0) break;
    const tmpl = pickWeighted(remaining);
    if (!tmpl) break;
    used.add(tmpl.key);
    pushRolled(affixes, tmpl, iLevel, rarity);
  }

  // Legendary: tack on one unique affix.
  if (rarity === 'legendary') {
    const uniquePool = AFFIX_TABLE.filter(
      (a) => a.unique === true && a.slotMask.indexOf(finalSlot) !== -1 && !used.has(a.key),
    );
    if (uniquePool.length > 0) {
      const tmpl = pickWeighted(uniquePool);
      if (tmpl) {
        used.add(tmpl.key);
        pushRolled(affixes, tmpl, iLevel, rarity);
      }
    }
  }

  const name = generateItemName(finalSlot, rarity);

  return {
    id: makeId(),
    baseId: baseIdFor(finalSlot, name),
    rarity,
    name,
    slot: finalSlot,
    affixes,
    iLevel: Math.max(1, Math.floor(iLevel)),
    iconColor: colorFor(rarity),
  };
}

function pushRolled(
  out: ItemAffix[],
  tmpl: AffixTemplate,
  iLevel: number,
  rarity: ItemRarity,
): void {
  const tier = rollTier(rarity);
  const raw = rollAffixValue(tmpl, iLevel, tier);
  const valueStr = formatAffixValue(tmpl, raw);
  // Store as number; format-aware rendering happens in tooltip.ts
  const numeric = parseFloat(valueStr);
  out.push({
    stat: tmpl.stat,
    value: Number.isFinite(numeric) ? numeric : 0,
  });
}
