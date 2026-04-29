// Tooltip / display helpers exported for the inventory module to render.
import type { ItemInstance } from '../../core/components';
import { COLORS } from '../constants';
import { AFFIX_TABLE, type AffixTemplate } from './affixes';

const BY_STAT: Map<string, AffixTemplate> = (() => {
  const m = new Map<string, AffixTemplate>();
  for (const a of AFFIX_TABLE) {
    // First template wins if multiple affixes share a stat key.
    if (!m.has(a.stat)) m.set(a.stat, a);
  }
  return m;
})();

function rarityColor(item: ItemInstance): number {
  return COLORS.loot[item.rarity];
}

function dimColor(): number {
  return COLORS.ui.dim;
}

function textColor(): number {
  return COLORS.ui.text;
}

function formatValue(template: AffixTemplate, value: number): string {
  switch (template.format) {
    case 'int':
      return String(Math.max(1, Math.round(value)));
    case 'pct':
      return value.toFixed(1);
    case 'flt':
      return value.toFixed(1);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatItemTooltip(item: ItemInstance): { text: string; color: number }[] {
  const lines: { text: string; color: number }[] = [];

  // Line 1: name colored by rarity.
  lines.push({ text: item.name, color: rarityColor(item) });

  // Line 2: rarity · slot · iLevel.
  lines.push({
    text: `${capitalize(item.rarity)} ${capitalize(item.slot)} · iLvl ${item.iLevel}`,
    color: dimColor(),
  });

  // Lines 3+: each affix's display string with value substituted.
  for (const aff of item.affixes) {
    const tmpl = BY_STAT.get(aff.stat);
    if (!tmpl) {
      // Fallback for any custom affix we don't have a template for.
      lines.push({ text: `+${aff.value} ${aff.stat}`, color: textColor() });
      continue;
    }
    const valStr = formatValue(tmpl, aff.value);
    const line = tmpl.display.replace('{value}', valStr);
    lines.push({
      text: line,
      color: tmpl.unique ? COLORS.loot.legendary : textColor(),
    });
  }

  return lines;
}
