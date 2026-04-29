// Core HUD module — HP bar, Resource bar, XP bar, level, top-right FPS/zone, level-up overlay.
// All DOM elements are created and owned here. Numeric updates run via a tick system.

import type { GameContext } from '../state';
import type { Entity } from '../../core/types';
import type { HealthComponent, ResourceComponent, PlayerComponent, ResourceKind } from '../../core/components';
import { C } from '../../core/components';
import { gameState } from '../state';

export interface HudRefs {
  hpFill: HTMLElement;
  hpText: HTMLElement;
  hpBar: HTMLElement;
  resFill: HTMLElement;
  resText: HTMLElement;
  resBar: HTMLElement;
  xpFill: HTMLElement;
  levelLabel: HTMLElement;
  fpsText: HTMLElement;
  zoneText: HTMLElement;
  levelUpOverlay: HTMLElement;
  killFeed: HTMLElement;
  skillToast: HTMLElement;
}

const RESOURCE_GRADIENT: Record<ResourceKind, string> = {
  mana: 'linear-gradient(180deg, #5a78c8 0%, #2a3a78 100%)',
  energy: 'linear-gradient(180deg, #6a4ec8 0%, #3a2278 100%)',
  fury: 'linear-gradient(180deg, #c87a3a 0%, #783218 100%)',
  rage: 'linear-gradient(180deg, #d04020 0%, #701408 100%)',
};

export function buildHud(ctx: GameContext): HudRefs {
  const root = ctx.uiRoot;

  // ---- Top-left: Party panel placeholder ----
  const party = document.createElement('div');
  party.className = 'dusk-panel dusk-party';
  party.innerHTML = '<div class="dusk-panel-header">PARTY</div><div class="dusk-party-body"></div>';
  root.appendChild(party);

  // ---- Top-right: FPS + Zone ----
  const topRight = document.createElement('div');
  topRight.className = 'dusk-topright';
  const fpsText = document.createElement('div');
  fpsText.className = 'dusk-fps';
  fpsText.textContent = '— fps';
  const zoneText = document.createElement('div');
  zoneText.className = 'dusk-zone';
  zoneText.textContent = gameState.currentZone;
  topRight.appendChild(zoneText);
  topRight.appendChild(fpsText);
  root.appendChild(topRight);

  // ---- Bottom-left: HP bar ----
  const hpBar = document.createElement('div');
  hpBar.className = 'dusk-bar dusk-hp';
  const hpFrame = document.createElement('div');
  hpFrame.className = 'dusk-bar-frame';
  const hpFill = document.createElement('div');
  hpFill.className = 'dusk-bar-fill dusk-hp-fill';
  hpFrame.appendChild(hpFill);
  const hpText = document.createElement('div');
  hpText.className = 'dusk-bar-text';
  hpText.textContent = '— / —';
  const hpLabel = document.createElement('div');
  hpLabel.className = 'dusk-bar-label';
  hpLabel.textContent = 'LIFE';
  hpBar.appendChild(hpLabel);
  hpBar.appendChild(hpFrame);
  hpBar.appendChild(hpText);
  root.appendChild(hpBar);

  // ---- Bottom-right: Resource bar ----
  const resBar = document.createElement('div');
  resBar.className = 'dusk-bar dusk-res';
  const resFrame = document.createElement('div');
  resFrame.className = 'dusk-bar-frame';
  const resFill = document.createElement('div');
  resFill.className = 'dusk-bar-fill dusk-res-fill';
  resFrame.appendChild(resFill);
  const resText = document.createElement('div');
  resText.className = 'dusk-bar-text';
  resText.textContent = '— / —';
  const resLabel = document.createElement('div');
  resLabel.className = 'dusk-bar-label';
  resLabel.textContent = 'RESOURCE';
  resBar.appendChild(resLabel);
  resBar.appendChild(resFrame);
  resBar.appendChild(resText);
  root.appendChild(resBar);

  // ---- Bottom strip: XP bar + level ----
  const xpStrip = document.createElement('div');
  xpStrip.className = 'dusk-xp-strip';
  const levelLabel = document.createElement('div');
  levelLabel.className = 'dusk-level';
  levelLabel.textContent = 'LV 1';
  const xpTrack = document.createElement('div');
  xpTrack.className = 'dusk-xp-track';
  const xpFill = document.createElement('div');
  xpFill.className = 'dusk-xp-fill';
  xpTrack.appendChild(xpFill);
  xpStrip.appendChild(levelLabel);
  xpStrip.appendChild(xpTrack);
  root.appendChild(xpStrip);

  // ---- Center top: kill / xp feed ----
  const killFeed = document.createElement('div');
  killFeed.className = 'dusk-feed';
  root.appendChild(killFeed);

  // ---- Skill toast (above hotbar) ----
  const skillToast = document.createElement('div');
  skillToast.className = 'dusk-skill-toast';
  root.appendChild(skillToast);

  // ---- Level-up overlay (hidden until needed) ----
  const levelUpOverlay = document.createElement('div');
  levelUpOverlay.className = 'dusk-levelup';
  levelUpOverlay.textContent = 'LEVEL UP';
  root.appendChild(levelUpOverlay);

  return {
    hpFill,
    hpText,
    hpBar,
    resFill,
    resText,
    resBar,
    xpFill,
    levelLabel,
    fpsText,
    zoneText,
    levelUpOverlay,
    killFeed,
    skillToast,
  };
}

// FPS rolling sample state — kept module-local.
let fpsAcc = 0;
let fpsFrames = 0;

export function updateHudNumbers(refs: HudRefs, dt: number, elapsed: number): void {
  // FPS — rolling average over ~0.5s windows.
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    const fps = Math.round(fpsFrames / fpsAcc);
    refs.fpsText.textContent = `${fps} fps`;
    fpsAcc = 0;
    fpsFrames = 0;
  }

  refs.zoneText.textContent = gameState.currentZone;

  const player = gameState.player;
  if (!player) return;

  const hp = player.components.get(C.Health) as HealthComponent | undefined;
  if (hp) {
    const ratio = hp.maxHp > 0 ? Math.max(0, Math.min(1, hp.hp / hp.maxHp)) : 0;
    refs.hpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    refs.hpText.textContent = `${Math.ceil(hp.hp)} / ${Math.ceil(hp.maxHp)}`;
    // Critical state — pulse class.
    if (ratio < 0.25) refs.hpBar.classList.add('dusk-critical');
    else refs.hpBar.classList.remove('dusk-critical');
  }

  const res = player.components.get(C.Resource) as ResourceComponent | undefined;
  if (res) {
    const ratio = res.max > 0 ? Math.max(0, Math.min(1, res.current / res.max)) : 0;
    refs.resFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    refs.resText.textContent = `${Math.ceil(res.current)} / ${Math.ceil(res.max)}`;
    refs.resFill.style.background = RESOURCE_GRADIENT[res.kind] ?? RESOURCE_GRADIENT.mana;
  }

  const pc = player.components.get(C.Player) as PlayerComponent | undefined;
  if (pc) {
    refs.levelLabel.textContent = `LV ${pc.level}`;
    const ratio = pc.xpToNext > 0 ? Math.max(0, Math.min(1, pc.xp / pc.xpToNext)) : 0;
    refs.xpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
  }

  // Cleanup expired feed lines (stamped via dataset.expires).
  const lines = refs.killFeed.children;
  for (let i = lines.length - 1; i >= 0; i--) {
    const el = lines[i] as HTMLElement;
    const exp = Number(el.dataset.expires ?? '0');
    if (elapsed > exp) refs.killFeed.removeChild(el);
  }
}

export function flashHpDamage(refs: HudRefs): void {
  refs.hpBar.classList.remove('dusk-flash');
  // Force reflow so re-adding the class restarts the animation.
  void refs.hpBar.offsetWidth;
  refs.hpBar.classList.add('dusk-flash');
}

export function pulseXp(refs: HudRefs): void {
  refs.xpFill.classList.remove('dusk-xp-pulse');
  void refs.xpFill.offsetWidth;
  refs.xpFill.classList.add('dusk-xp-pulse');
}

export function showLevelUp(refs: HudRefs): void {
  refs.levelUpOverlay.classList.remove('dusk-levelup-show');
  void refs.levelUpOverlay.offsetWidth;
  refs.levelUpOverlay.classList.add('dusk-levelup-show');
}

export function pushFeedLine(
  refs: HudRefs,
  elapsed: number,
  text: string,
  color: string,
): void {
  const line = document.createElement('div');
  line.className = 'dusk-feed-line';
  line.textContent = text;
  line.style.color = color;
  line.dataset.expires = String(elapsed + 1.0);
  refs.killFeed.appendChild(line);
}

export function showSkillToast(refs: HudRefs, text: string): void {
  refs.skillToast.textContent = text;
  refs.skillToast.classList.remove('dusk-toast-show');
  void refs.skillToast.offsetWidth;
  refs.skillToast.classList.add('dusk-toast-show');
}

// Helper for event handlers that need the player entity.
export function getPlayer(): Entity | null {
  return gameState.player;
}
