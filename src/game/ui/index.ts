// Wave 2: HUD — HP/Resource bars, hotbar, XP bar, level, FPS, party panel hooks.
// All DOM under #ui-root. Subscribes to events for reactive transient effects.

import type { GameContext } from '../state';
import { gameState } from '../state';
import {
  buildHud,
  updateHudNumbers,
  flashHpDamage,
  pulseXp,
  showLevelUp,
  pushFeedLine,
  showSkillToast,
} from './hud';
import { buildHotbar, updateHotbar } from './hotbar';
import { injectStyles } from './panels';

// Friendly skill-name lookup for the cast toast. Skill IDs aren't standardized
// across modules yet so we fall back to upper-casing the raw id.
const SKILL_NAMES: Record<string, string> = {
  basic: 'Strike',
  dash: 'Dash',
  ult: 'Ultimate',
};

export function initUI(ctx: GameContext): void {
  injectStyles();

  const hud = buildHud(ctx);
  const hotbar = buildHotbar(ctx);

  // Per-frame numeric updates. Cheap reads from the player entity's components.
  ctx.world.addSystem((_w, frame) => {
    updateHudNumbers(hud, frame.dt, frame.elapsed);
    updateHotbar(hotbar, frame.elapsed);
  });

  const isPlayer = (id: number): boolean =>
    gameState.player !== null && gameState.player.id === id;

  // ---- Event subscriptions ----

  // Player took damage → flash + shake the HP bar.
  ctx.world.on('damage:dealt', (p) => {
    if (isPlayer(p.targetId)) flashHpDamage(hud);
  });

  // XP gained → pulse the XP bar (player only).
  ctx.world.on('xp:gained', (p) => {
    if (isPlayer(p.entityId)) pulseXp(hud);
  });

  // Mob killed → "+N XP" line in the feed (right side, top).
  ctx.world.on('mob:killed', (p) => {
    pushFeedLine(hud, performance.now() / 1000, `+${p.xpReward} XP`, '#c8a060');
  });

  // Player level up → centered overlay.
  ctx.world.on('level:up', (p) => {
    if (isPlayer(p.entityId)) showLevelUp(hud);
  });

  // Skill cast → name toast above hotbar.
  ctx.world.on('skill:cast', (p) => {
    if (!isPlayer(p.casterId)) return;
    const name = SKILL_NAMES[p.skillId] ?? p.skillId.toUpperCase();
    showSkillToast(hud, name);
  });

  // Item picked / equipped → tiny feed line so the player notices loot.
  ctx.world.on('item:picked', (p) => {
    if (!isPlayer(p.pickerId)) return;
    pushFeedLine(hud, performance.now() / 1000, `+ ${p.itemId}`, '#a8c0e0');
  });
  ctx.world.on('item:equipped', (p) => {
    if (!isPlayer(p.entityId) || !p.itemId) return;
    pushFeedLine(hud, performance.now() / 1000, `equipped ${p.itemId}`, '#e0c890');
  });

  // entity:died observed for future hooks (e.g., death overlay).
  ctx.world.on('entity:died', () => { /* hook for future death FX */ });
}
