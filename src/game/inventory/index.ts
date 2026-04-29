// Wave 2: pickup detection + inventory grid UI + equipment slots + tooltip + comparison + drop.
//
// Press I (or Escape) to toggle a gothic-themed panel that overlays the right side of the
// screen. Top of panel = 4 equipment slots (weapon/head/chest/accessory). Below = a 6x4
// inventory grid. Click an inventory item to equip (auto-swap with whatever is there).
// Click an equipped slot to unequip back to inventory. Right-click an inventory item to
// drop it into the world (spawns a small bobbing loot pickup at the player's position).
//
// All visuals injected via a single <style> tag — does not collide with the HUD module.

import { Mesh, BoxGeometry, MeshStandardMaterial, Object3D } from 'three';
import type { GameContext } from '../state';
import { gameState } from '../state';
import { COLORS } from '../constants';
import {
  C,
  type InventoryComponent,
  type EquipmentComponent,
  type ItemInstance,
  type ItemSlot,
  type ItemRarity,
  type LootDropComponent,
} from '../../core/components';
import type { Entity } from '../../core/types';
import { createEntity, getComponent } from '../../core/entity';

// ---------- Tooltip line builder ----------

interface TooltipLine {
  text: string;
  color: string;
  bold?: boolean;
  dim?: boolean;
}

const RARITY_HEX: Record<ItemRarity, string> = {
  common: '#b8b8b8',
  magic: '#4080ff',
  rare: '#ffd040',
  legendary: '#ff6020',
};

const SLOT_LABEL: Record<ItemSlot, string> = {
  weapon: 'Weapon',
  head: 'Head',
  chest: 'Chest',
  accessory: 'Accessory',
};

const SLOT_GLYPH: Record<ItemSlot, string> = {
  weapon: '⚔',
  head: '◈',
  chest: '▣',
  accessory: '◉',
};

// "fireDamage" -> "Fire Damage"; "critChance" -> "% Crit Chance"
function humanizeStat(stat: string): string {
  const isPct = /chance|mult|multiplier|crit|attackSpeed/i.test(stat);
  const spaced = stat
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim();
  const titled = spaced
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
  return isPct ? `% ${titled}` : titled;
}

function abbreviation(name: string): string {
  const parts = name.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return '??';
}

function colorIntToHex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

// Local builder (loot module is in parallel and may not export this yet).
function formatItemTooltip(item: ItemInstance): TooltipLine[] {
  const lines: TooltipLine[] = [];
  lines.push({ text: item.name, color: RARITY_HEX[item.rarity], bold: true });
  lines.push({
    text: `${SLOT_LABEL[item.slot]} · iLvl ${item.iLevel}`,
    color: '#7a818d',
    dim: true,
  });
  for (const aff of item.affixes) {
    const v = aff.value;
    const stat = humanizeStat(aff.stat);
    const sign = v >= 0 ? '+' : '';
    lines.push({ text: `${sign}${v} ${stat}`, color: '#d8dde4' });
  }
  return lines;
}

// ---------- Style ----------

const STYLE_ID = 'inv-styles';
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const accent = colorIntToHex(COLORS.ui.accent);
  const text = colorIntToHex(COLORS.ui.text);
  const dim = colorIntToHex(COLORS.ui.dim);
  const css = `
.inv-overlay {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 50;
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
  color: ${text};
}
.inv-overlay.open { pointer-events: none; }
.inv-overlay .inv-backdrop {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at right, rgba(8,6,12,0.55), rgba(0,0,0,0.0) 60%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.inv-overlay.open .inv-backdrop { opacity: 1; }

.inv-panel {
  position: absolute;
  top: 50%;
  right: 24px;
  transform: translateY(-50%) scale(0.95);
  width: 380px;
  max-height: 86vh;
  padding: 18px 20px 22px 20px;
  background:
    linear-gradient(180deg, rgba(20,16,24,0.96), rgba(10,8,12,0.96)),
    radial-gradient(ellipse at top, rgba(${hexToRgb(accent)},0.08), transparent 70%);
  border: 1px solid rgba(${hexToRgb(accent)}, 0.45);
  border-radius: 6px;
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.6),
    0 24px 60px rgba(0,0,0,0.7),
    inset 0 1px 0 rgba(${hexToRgb(accent)}, 0.18);
  pointer-events: auto;
  opacity: 0;
  transition: opacity 160ms ease-out, transform 200ms cubic-bezier(.2,.7,.3,1);
  display: flex;
  flex-direction: column;
  gap: 14px;
  user-select: none;
}
.inv-overlay.open .inv-panel { opacity: 1; transform: translateY(-50%) scale(1); }

.inv-title {
  font-size: 15px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: ${accent};
  text-align: center;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(${hexToRgb(accent)}, 0.25);
  text-shadow: 0 0 8px rgba(${hexToRgb(accent)}, 0.35);
}

.inv-eq-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.inv-eq-cell, .inv-grid-cell {
  position: relative;
  background: linear-gradient(180deg, #15131a, #0c0a10);
  border: 1px solid rgba(${hexToRgb(accent)}, 0.2);
  border-radius: 3px;
  cursor: pointer;
  transition: border-color 90ms, box-shadow 90ms, transform 90ms;
}
.inv-eq-cell { aspect-ratio: 1 / 1; }
.inv-grid-cell { aspect-ratio: 1 / 1; }
.inv-eq-cell:hover, .inv-grid-cell:hover {
  border-color: rgba(${hexToRgb(accent)}, 0.7);
  box-shadow: 0 0 12px rgba(${hexToRgb(accent)}, 0.25), inset 0 0 12px rgba(${hexToRgb(accent)}, 0.06);
}
.inv-eq-cell.empty .inv-icon-empty,
.inv-grid-cell.empty { /* empty look */ }

.inv-section-label {
  font-size: 10px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: ${dim};
  margin: 4px 0 -4px 2px;
}

.inv-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-auto-rows: 1fr;
  gap: 6px;
}

.inv-icon {
  position: absolute; inset: 4px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 3px;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.05em;
  color: #f5f5f5;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  background-clip: padding-box;
}
.inv-icon.rarity-common    { box-shadow: inset 0 0 0 2px ${RARITY_HEX.common}; }
.inv-icon.rarity-magic     { box-shadow: inset 0 0 0 2px ${RARITY_HEX.magic},     0 0 10px rgba(64,128,255,0.25); }
.inv-icon.rarity-rare      { box-shadow: inset 0 0 0 2px ${RARITY_HEX.rare},      0 0 12px rgba(255,208,64,0.30); }
.inv-icon.rarity-legendary { box-shadow: inset 0 0 0 2px ${RARITY_HEX.legendary}, 0 0 14px rgba(255,96,32,0.45); }

.inv-icon-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  color: rgba(${hexToRgb(accent)}, 0.25);
  pointer-events: none;
}
.inv-slot-label {
  position: absolute;
  bottom: 2px; left: 0; right: 0;
  text-align: center;
  font-size: 8px;
  letter-spacing: 0.2em;
  color: rgba(${hexToRgb(accent)}, 0.55);
  text-transform: uppercase;
  pointer-events: none;
}

.inv-tooltip-layer {
  position: fixed;
  top: 0; left: 0;
  pointer-events: none;
  z-index: 60;
  display: flex;
  gap: 10px;
}
.inv-tooltip {
  min-width: 180px;
  max-width: 240px;
  padding: 10px 12px;
  background: linear-gradient(180deg, rgba(18,14,22,0.98), rgba(8,6,10,0.98));
  border: 1px solid rgba(${hexToRgb(accent)}, 0.45);
  border-radius: 4px;
  box-shadow: 0 12px 30px rgba(0,0,0,0.7);
  font-family: 'Cinzel', serif;
  font-size: 12px;
  line-height: 1.45;
}
.inv-tooltip .tt-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.inv-tooltip .tt-name { font-size: 14px; letter-spacing: 0.05em; }
.inv-tooltip .tt-divider { border-top: 1px solid rgba(${hexToRgb(accent)}, 0.18); margin: 6px 0; }
.inv-tooltip .tt-compare-tag {
  font-size: 9px; letter-spacing: 0.3em; text-transform: uppercase;
  color: ${dim}; margin-bottom: 4px;
}

.inv-hint {
  font-size: 10px;
  color: ${dim};
  text-align: center;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding-top: 4px;
  border-top: 1px solid rgba(${hexToRgb(accent)}, 0.12);
}
`;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}

function hexToRgb(hex: string): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

// ---------- DOM build ----------

interface PanelDom {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  eqRow: HTMLDivElement;
  grid: HTMLDivElement;
  tooltipLayer: HTMLDivElement;
}

function buildPanel(uiRoot: HTMLElement): PanelDom {
  const overlay = document.createElement('div');
  overlay.className = 'inv-overlay';

  const backdrop = document.createElement('div');
  backdrop.className = 'inv-backdrop';
  overlay.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'inv-panel';

  const title = document.createElement('div');
  title.className = 'inv-title';
  title.textContent = 'Inventory';
  panel.appendChild(title);

  const eqLabel = document.createElement('div');
  eqLabel.className = 'inv-section-label';
  eqLabel.textContent = 'Equipment';
  panel.appendChild(eqLabel);

  const eqRow = document.createElement('div');
  eqRow.className = 'inv-eq-row';
  panel.appendChild(eqRow);

  const invLabel = document.createElement('div');
  invLabel.className = 'inv-section-label';
  invLabel.textContent = 'Bags';
  panel.appendChild(invLabel);

  const grid = document.createElement('div');
  grid.className = 'inv-grid';
  panel.appendChild(grid);

  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = 'Click · Equip / Unequip   Right-Click · Drop';
  panel.appendChild(hint);

  overlay.appendChild(panel);
  uiRoot.appendChild(overlay);

  const tooltipLayer = document.createElement('div');
  tooltipLayer.className = 'inv-tooltip-layer';
  uiRoot.appendChild(tooltipLayer);

  return { overlay, panel, eqRow, grid, tooltipLayer };
}

// ---------- Tooltip rendering ----------

function renderTooltip(item: ItemInstance, compareTag?: string): HTMLDivElement {
  const tt = document.createElement('div');
  tt.className = 'inv-tooltip';

  if (compareTag) {
    const tag = document.createElement('div');
    tag.className = 'tt-compare-tag';
    tag.textContent = compareTag;
    tt.appendChild(tag);
  }

  const lines = formatItemTooltip(item);
  lines.forEach((ln, idx) => {
    if (idx === 2) {
      const div = document.createElement('div');
      div.className = 'tt-divider';
      tt.appendChild(div);
    }
    const row = document.createElement('div');
    row.className = 'tt-line' + (idx === 0 ? ' tt-name' : '');
    row.style.color = ln.color;
    if (ln.bold) row.style.fontWeight = '700';
    if (ln.dim) row.style.opacity = '0.85';
    row.textContent = ln.text;
    tt.appendChild(row);
  });
  return tt;
}

function moveTooltipLayer(layer: HTMLDivElement, x: number, y: number): void {
  // offset from cursor; clamp to viewport
  const offsetX = 18;
  const offsetY = 18;
  const rect = layer.getBoundingClientRect();
  const w = rect.width || 250;
  const h = rect.height || 100;
  let tx = x + offsetX;
  let ty = y + offsetY;
  if (tx + w > window.innerWidth - 8) tx = x - w - offsetX;
  if (ty + h > window.innerHeight - 8) ty = window.innerHeight - h - 8;
  if (ty < 8) ty = 8;
  if (tx < 8) tx = 8;
  layer.style.transform = `translate(${tx}px, ${ty}px)`;
}

// ---------- Loot drop spawning ----------

function spawnLootDrop(ctx: GameContext, item: ItemInstance): void {
  const player = gameState.player;
  if (!player) return;

  const color = item.iconColor;
  const mesh = new Mesh(
    new BoxGeometry(0.4, 0.4, 0.4),
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }),
  );
  const root = new Object3D();
  root.add(mesh);
  // place at player position + small forward offset so it's not on top of them
  const px = player.object3d.position.x;
  const py = player.object3d.position.y;
  const pz = player.object3d.position.z;
  root.position.set(px + (Math.random() - 0.5) * 1.4, py + 0.4, pz + (Math.random() - 0.5) * 1.4);

  const drop: LootDropComponent = { item, spawnTime: performance.now() / 1000 };
  const e = createEntity({
    tags: ['loot'],
    object3d: root,
    components: [[C.LootDrop, drop]],
  });
  ctx.world.spawn(e);
  ctx.world.emit('item:dropped', { dropEntityId: e.id });
}

// ---------- Inventory state helpers ----------

function getInv(player: Entity): InventoryComponent | undefined {
  return getComponent<InventoryComponent>(player, C.Inventory);
}
function getEq(player: Entity): EquipmentComponent | undefined {
  return getComponent<EquipmentComponent>(player, C.Equipment);
}

function inventoryAddIfRoom(inv: InventoryComponent, item: ItemInstance): boolean {
  if (inv.items.length >= inv.capacity) return false;
  inv.items.push(item);
  return true;
}
function inventoryRemoveById(inv: InventoryComponent, id: string): ItemInstance | null {
  const idx = inv.items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const [removed] = inv.items.splice(idx, 1);
  return removed ?? null;
}

function equipItem(ctx: GameContext, item: ItemInstance): void {
  const player = gameState.player;
  if (!player) return;
  const inv = getInv(player);
  const eq = getEq(player);
  if (!inv || !eq) return;

  // Remove from inventory if present.
  inventoryRemoveById(inv, item.id);

  // Move currently-equipped to inventory (swap).
  const slot = item.slot;
  const current = eq[slot];
  if (current) inventoryAddIfRoom(inv, current);

  eq[slot] = item;
  ctx.world.emit('item:equipped', { entityId: player.id, slot, itemId: item.id });
}

function unequipSlot(ctx: GameContext, slot: ItemSlot): void {
  const player = gameState.player;
  if (!player) return;
  const inv = getInv(player);
  const eq = getEq(player);
  if (!inv || !eq) return;
  const current = eq[slot];
  if (!current) return;
  if (inv.items.length >= inv.capacity) return; // no room → no-op
  inv.items.push(current);
  eq[slot] = null;
  ctx.world.emit('item:equipped', { entityId: player.id, slot, itemId: null });
}

function dropFromInventory(ctx: GameContext, item: ItemInstance): void {
  const player = gameState.player;
  if (!player) return;
  const inv = getInv(player);
  if (!inv) return;
  if (!inventoryRemoveById(inv, item.id)) return;
  spawnLootDrop(ctx, item);
}

// ---------- Cell renderers ----------

function renderItemIcon(item: ItemInstance): HTMLDivElement {
  const icon = document.createElement('div');
  icon.className = `inv-icon rarity-${item.rarity}`;
  icon.style.background = `radial-gradient(circle at 35% 30%, ${colorIntToHex(item.iconColor)}, ${shade(colorIntToHex(item.iconColor), -0.55)})`;
  icon.textContent = abbreviation(item.name);
  return icon;
}

function shade(hex: string, amount: number): string {
  // amount in [-1,1]; negative darkens
  const m = hex.replace('#', '');
  let r = parseInt(m.slice(0, 2), 16);
  let g = parseInt(m.slice(2, 4), 16);
  let b = parseInt(m.slice(4, 6), 16);
  const f = (c: number): number => {
    if (amount >= 0) return Math.round(c + (255 - c) * amount);
    return Math.round(c * (1 + amount));
  };
  r = Math.max(0, Math.min(255, f(r)));
  g = Math.max(0, Math.min(255, f(g)));
  b = Math.max(0, Math.min(255, f(b)));
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Re-render ----------

interface RenderState {
  hovered: ItemInstance | null;
  hoveredCompareSlot: ItemSlot | null;
  // hash of inventory snapshot to short-circuit redraws
  lastHash: string;
}

function snapshotHash(player: Entity | null): string {
  if (!player) return '';
  const inv = getInv(player);
  const eq = getEq(player);
  if (!inv || !eq) return '';
  const ids = inv.items.map((i) => i.id).join(',');
  const eqIds = (['weapon', 'head', 'chest', 'accessory'] as ItemSlot[])
    .map((s) => (eq[s] ? eq[s]!.id : '_'))
    .join('|');
  return `${ids}__${eqIds}__${inv.items.length}`;
}

function rebuildPanel(
  ctx: GameContext,
  dom: PanelDom,
  state: RenderState,
): void {
  const player = gameState.player;
  dom.eqRow.innerHTML = '';
  dom.grid.innerHTML = '';
  if (!player) return;
  const inv = getInv(player);
  const eq = getEq(player);
  if (!inv || !eq) return;

  // Equipment cells
  const slots: ItemSlot[] = ['weapon', 'head', 'chest', 'accessory'];
  for (const slot of slots) {
    const cell = document.createElement('div');
    cell.className = 'inv-eq-cell';
    const item = eq[slot];
    if (item) {
      cell.appendChild(renderItemIcon(item));
      cell.addEventListener('click', () => {
        unequipSlot(ctx, slot);
      });
      attachHover(cell, () => {
        state.hovered = item;
        state.hoveredCompareSlot = null;
        refreshTooltip(dom, state);
      }, () => {
        state.hovered = null;
        refreshTooltip(dom, state);
      });
    } else {
      cell.classList.add('empty');
      const empty = document.createElement('div');
      empty.className = 'inv-icon-empty';
      empty.textContent = SLOT_GLYPH[slot];
      cell.appendChild(empty);
    }
    const lbl = document.createElement('div');
    lbl.className = 'inv-slot-label';
    lbl.textContent = SLOT_LABEL[slot];
    cell.appendChild(lbl);
    dom.eqRow.appendChild(cell);
  }

  // Grid cells (6x4 = 24)
  const total = inv.capacity;
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('div');
    cell.className = 'inv-grid-cell';
    const item = inv.items[i];
    if (item) {
      cell.appendChild(renderItemIcon(item));
      cell.addEventListener('click', () => {
        equipItem(ctx, item);
      });
      cell.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        dropFromInventory(ctx, item);
      });
      attachHover(cell, () => {
        state.hovered = item;
        state.hoveredCompareSlot = item.slot;
        refreshTooltip(dom, state);
      }, () => {
        state.hovered = null;
        state.hoveredCompareSlot = null;
        refreshTooltip(dom, state);
      });
    } else {
      cell.classList.add('empty');
    }
    dom.grid.appendChild(cell);
  }
}

function attachHover(el: HTMLElement, onEnter: () => void, onLeave: () => void): void {
  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mouseleave', onLeave);
}

function refreshTooltip(dom: PanelDom, state: RenderState): void {
  dom.tooltipLayer.innerHTML = '';
  if (!state.hovered) return;
  const player = gameState.player;
  const eq = player ? getEq(player) : undefined;

  // Compare mode: hovered item is in inventory AND that slot has an equipped item.
  if (state.hoveredCompareSlot && eq) {
    const equipped = eq[state.hoveredCompareSlot];
    if (equipped && equipped.id !== state.hovered.id) {
      dom.tooltipLayer.appendChild(renderTooltip(equipped, 'Equipped'));
      dom.tooltipLayer.appendChild(renderTooltip(state.hovered, 'Hovered'));
      return;
    }
  }
  dom.tooltipLayer.appendChild(renderTooltip(state.hovered));
}

// ---------- Public entry ----------

export function initInventory(ctx: GameContext): void {
  injectStyles();
  const dom = buildPanel(ctx.uiRoot);
  let isOpen = false;

  const state: RenderState = {
    hovered: null,
    hoveredCompareSlot: null,
    lastHash: '',
  };

  const setOpen = (open: boolean): void => {
    isOpen = open;
    dom.overlay.classList.toggle('open', open);
    if (!open) {
      state.hovered = null;
      state.hoveredCompareSlot = null;
      dom.tooltipLayer.innerHTML = '';
    } else {
      // ensure latest data on open
      state.lastHash = snapshotHash(gameState.player);
      rebuildPanel(ctx, dom, state);
    }
  };

  // Keys: I to toggle, Escape to close.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'i' || e.key === 'I') {
      setOpen(!isOpen);
    } else if (e.key === 'Escape' && isOpen) {
      setOpen(false);
    }
  });

  // Mouse tracking for tooltip layer (only while open).
  window.addEventListener('mousemove', (e) => {
    if (!isOpen) return;
    if (!state.hovered) return;
    moveTooltipLayer(dom.tooltipLayer, e.clientX, e.clientY);
  });

  // Suppress browser context menu over the panel so right-click drop works clean.
  dom.panel.addEventListener('contextmenu', (e) => e.preventDefault());

  // Reactive rebuild on relevant events.
  const triggerRedraw = (): void => {
    if (!isOpen) return;
    state.lastHash = snapshotHash(gameState.player);
    rebuildPanel(ctx, dom, state);
  };
  ctx.world.on('item:picked', triggerRedraw);
  ctx.world.on('item:equipped', triggerRedraw);
  ctx.world.on('entity:spawn', (p) => {
    if (!isOpen) return;
    if (p.entity.tags.has('loot')) triggerRedraw();
  });

  // Cheap per-frame poll to catch silent inventory mutations (e.g. loot pickup
  // system mutating the array directly without firing item:picked yet).
  ctx.world.addSystem(() => {
    if (!isOpen) return;
    const h = snapshotHash(gameState.player);
    if (h !== state.lastHash) {
      state.lastHash = h;
      rebuildPanel(ctx, dom, state);
    }
  });
}
