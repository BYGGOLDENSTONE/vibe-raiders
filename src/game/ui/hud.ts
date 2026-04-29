// Core HUD module — D4-style HP / Resource orbs (replaces old horizontal bars),
// XP strip, level, top-right FPS/zone, level-up overlay, kill feed, skill toast.
// Also owns the skill-point badge, hotbar lock overlays, rank dots, and skill-point
// pulse, plus the per-frame SVG cooldown sweep for hotbar slots.
//
// HudRefs is preserved for backward compatibility — old `hpFill`/`hpText`/`hpBar`
// (and the resource counterparts) are still present but now point to detached
// throwaway DOM nodes that no longer attach to the page. New consumers should
// read `hpOrb` / `resOrb` instead. flashHpDamage continues to work via the
// orb root node's class toggle.

import type { GameContext } from '../state';
import type { Entity } from '../../core/types';
import type {
  HealthComponent,
  ResourceComponent,
  PlayerComponent,
  SkillUserComponent,
  ClassId,
} from '../../core/components';
import { C } from '../../core/components';
import { gameState } from '../state';
import { MAX_SKILL_RANK, slotUnlockLevel } from '../skills';
import { createOrb, type Orb } from './orbs';
import { initDamageNumbers } from './damageNumbers';

export interface HudRefs {
  // Legacy bar refs retained so any external dependents do not crash.
  hpFill: HTMLElement;
  hpText: HTMLElement;
  hpBar: HTMLElement;
  resFill: HTMLElement;
  resText: HTMLElement;
  resBar: HTMLElement;
  // New orb refs.
  hpOrb: Orb;
  resOrb: Orb;
  xpFill: HTMLElement;
  levelLabel: HTMLElement;
  fpsText: HTMLElement;
  zoneText: HTMLElement;
  levelUpOverlay: HTMLElement;
  levelUpSubtitle: HTMLElement;
  killFeed: HTMLElement;
  skillToast: HTMLElement;
  skillPointBadge: HTMLElement;
  skillPointCount: HTMLElement;
}

function detachedDiv(): HTMLDivElement {
  // A throwaway DOM node so old code paths that mutate hpFill/etc don't NPE.
  return document.createElement('div');
}

export function buildHud(ctx: GameContext): HudRefs {
  injectHudExtraStyles();
  injectSkillProgressionStyles();
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

  // ---- Bottom-left: HP orb (replaces dusk-bar) ----
  const hpOrb = createOrb('hp', root);

  // ---- Bottom-right: Resource orb ----
  const resOrb = createOrb('resource', root);

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
  const levelUpTitle = document.createElement('div');
  levelUpTitle.className = 'dusk-levelup-title';
  levelUpTitle.textContent = 'LEVEL UP';
  const levelUpSubtitle = document.createElement('div');
  levelUpSubtitle.className = 'dusk-levelup-sub';
  levelUpSubtitle.textContent = '';
  levelUpOverlay.appendChild(levelUpTitle);
  levelUpOverlay.appendChild(levelUpSubtitle);
  root.appendChild(levelUpOverlay);

  // Track the most recent skill-unlock so the next level-up overlay can
  // surface "Skill unlocked!" instead of the default "+1 Skill Point".
  ctx.world.on('skill:unlocked', () => {
    pendingUnlockSubtitle = 'Skill Unlocked!';
  });

  // ---- Skill-point badge (next to bottom XP strip) ----
  const skillPointBadge = document.createElement('div');
  skillPointBadge.className = 'dusk-sp-badge';
  const spLabel = document.createElement('span');
  spLabel.className = 'dusk-sp-label';
  spLabel.textContent = 'SKILL POINTS';
  const skillPointCount = document.createElement('span');
  skillPointCount.className = 'dusk-sp-count';
  skillPointCount.textContent = '0';
  skillPointBadge.appendChild(spLabel);
  skillPointBadge.appendChild(skillPointCount);
  root.appendChild(skillPointBadge);

  // ---- Damage numbers (D4 arc trajectory, crit thump) ----
  initDamageNumbers(ctx);

  // React to class changes for orb tinting.
  ctx.world.on('player:classChanged', ({ classId }) => {
    applyClassColors(resOrb, classId);
  });
  // Initial tint based on selected class.
  applyClassColors(resOrb, gameState.selectedClass as ClassId);

  // Detached legacy refs.
  const hpFill = detachedDiv();
  const hpText = detachedDiv();
  const hpBar = detachedDiv();
  const resFill = detachedDiv();
  const resText = detachedDiv();
  const resBar = detachedDiv();

  return {
    hpFill, hpText, hpBar,
    resFill, resText, resBar,
    hpOrb, resOrb,
    xpFill,
    levelLabel,
    fpsText,
    zoneText,
    levelUpOverlay,
    levelUpSubtitle,
    killFeed,
    skillToast,
    skillPointBadge,
    skillPointCount,
  };
}

function applyClassColors(resOrb: Orb, classId: ClassId): void {
  const player = gameState.player;
  const res = player ? (player.components.get(C.Resource) as ResourceComponent | undefined) : undefined;
  resOrb.setClass(classId, res?.kind ?? 'energy');
}

// FPS rolling sample state — kept module-local.
let fpsAcc = 0;
let fpsFrames = 0;

// Set by skill:unlocked subscription; consumed (and cleared) by showLevelUp.
let pendingUnlockSubtitle: string | null = null;

// Real-time accumulator for orb wave animation (independent of paused world tick).
let _lastOrbTime = performance.now();

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

  // Real-time orb wave step (uses wall-clock dt so wave never freezes during pause).
  const now = performance.now();
  const realDt = Math.min(0.1, (now - _lastOrbTime) / 1000);
  _lastOrbTime = now;
  refs.hpOrb.tick(realDt);
  refs.resOrb.tick(realDt);

  const player = gameState.player;
  if (!player) return;

  const hp = player.components.get(C.Health) as HealthComponent | undefined;
  if (hp) {
    const ratio = hp.maxHp > 0 ? Math.max(0, Math.min(1, hp.hp / hp.maxHp)) : 0;
    refs.hpOrb.set(ratio, `${Math.ceil(hp.hp)} / ${Math.ceil(hp.maxHp)}`);
  }

  const res = player.components.get(C.Resource) as ResourceComponent | undefined;
  if (res) {
    const ratio = res.max > 0 ? Math.max(0, Math.min(1, res.current / res.max)) : 0;
    refs.resOrb.set(ratio, `${Math.ceil(res.current)} / ${Math.ceil(res.max)}`);
  }

  const pc = player.components.get(C.Player) as PlayerComponent | undefined;
  if (pc) {
    refs.levelLabel.textContent = `LV ${pc.level}`;
    const ratio = pc.xpToNext > 0 ? Math.max(0, Math.min(1, pc.xp / pc.xpToNext)) : 0;
    refs.xpFill.style.width = `${(ratio * 100).toFixed(1)}%`;
  }

  // Skill-point badge + per-slot lock / rank decorations.
  updateSkillProgressionHud(refs, player, pc?.level ?? 1);

  // Cleanup expired feed lines (stamped via dataset.expires).
  const lines = refs.killFeed.children;
  for (let i = lines.length - 1; i >= 0; i--) {
    const el = lines[i] as HTMLElement;
    const exp = Number(el.dataset.expires ?? '0');
    if (elapsed > exp) refs.killFeed.removeChild(el);
  }
}

export function flashHpDamage(refs: HudRefs): void {
  const wrap = refs.hpOrb.root;
  wrap.classList.remove('dusk-orb-flash');
  void wrap.offsetWidth;
  wrap.classList.add('dusk-orb-flash');
}

export function pulseXp(refs: HudRefs): void {
  refs.xpFill.classList.remove('dusk-xp-pulse');
  void refs.xpFill.offsetWidth;
  refs.xpFill.classList.add('dusk-xp-pulse');
}

export function showLevelUp(refs: HudRefs, subtitle?: string): void {
  // Priority: explicit arg > pending unlock from this tick > default.
  let line: string;
  if (subtitle !== undefined) {
    line = subtitle;
  } else if (pendingUnlockSubtitle !== null) {
    line = pendingUnlockSubtitle;
    pendingUnlockSubtitle = null;
  } else {
    line = '+1 Skill Point';
  }
  refs.levelUpSubtitle.textContent = line;
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

// ============================================================
// Skill progression HUD: skill-point badge + hotbar lock/rank overlays.
// ============================================================

const LOCK_OVERLAY_CLASS = 'dusk-slot-lock';
const RANK_DOTS_CLASS = 'dusk-slot-rank';
const SP_PULSE_CLASS = 'dusk-slot-sp-pulse';

export function updateSkillProgressionHud(
  refs: HudRefs,
  player: Entity,
  _playerLevel: number,
): void {
  const su = player.components.get(C.SkillUser) as SkillUserComponent | undefined;
  if (!su) return;

  const skillPoints = typeof su.skillPoints === 'number' ? su.skillPoints : 0;

  refs.skillPointCount.textContent = String(skillPoints);
  if (skillPoints > 0) {
    refs.skillPointBadge.classList.add('dusk-sp-badge-active');
  } else {
    refs.skillPointBadge.classList.remove('dusk-sp-badge-active');
  }

  const slotEls = document.querySelectorAll<HTMLElement>('.dusk-slot');
  slotEls.forEach((slotEl) => {
    const idxStr = slotEl.dataset.idx;
    if (idxStr === undefined) return;
    const idx = Number(idxStr);
    if (!Number.isFinite(idx)) return;

    const unlocked = (su.unlockedSlots ?? [])[idx] === true;
    const rank = (su.skillRanks ?? [])[idx] ?? 0;

    // ---- Lock overlay ----
    let lock = slotEl.querySelector<HTMLElement>(`.${LOCK_OVERLAY_CLASS}`);
    if (!unlocked) {
      if (!lock) {
        lock = document.createElement('div');
        lock.className = LOCK_OVERLAY_CLASS;
        const icon = document.createElement('div');
        icon.className = 'dusk-slot-lock-icon';
        icon.textContent = '\u{1F512}';
        const lvl = document.createElement('div');
        lvl.className = 'dusk-slot-lock-lvl';
        lock.appendChild(icon);
        lock.appendChild(lvl);
        slotEl.appendChild(lock);
      }
      const lvlEl = lock.querySelector<HTMLElement>('.dusk-slot-lock-lvl');
      if (lvlEl) lvlEl.textContent = `Lvl ${slotUnlockLevel(idx)}`;
    } else if (lock) {
      lock.remove();
    }

    // ---- Rank dots ----
    let dots = slotEl.querySelector<HTMLElement>(`.${RANK_DOTS_CLASS}`);
    if (unlocked) {
      if (!dots) {
        dots = document.createElement('div');
        dots.className = RANK_DOTS_CLASS;
        slotEl.appendChild(dots);
      }
      const want = `${rank}/${MAX_SKILL_RANK}`;
      if (dots.dataset.state !== want) {
        dots.dataset.state = want;
        dots.innerHTML = '';
        for (let i = 0; i < MAX_SKILL_RANK; i++) {
          const d = document.createElement('span');
          d.className = i < rank ? 'dusk-slot-dot dusk-slot-dot-on' : 'dusk-slot-dot';
          dots.appendChild(d);
        }
      }
    } else if (dots) {
      dots.remove();
    }

    const canSpend = unlocked && skillPoints > 0 && rank < MAX_SKILL_RANK;
    if (canSpend) slotEl.classList.add(SP_PULSE_CLASS);
    else slotEl.classList.remove(SP_PULSE_CLASS);
  });
}

const SP_STYLE_ID = 'dusk-skill-progression-style';
function injectSkillProgressionStyles(): void {
  if (document.getElementById(SP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SP_STYLE_ID;
  style.textContent = `
.dusk-sp-badge {
  position: fixed;
  bottom: 100px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 11px;
  letter-spacing: 0.22em;
  color: #6a7480;
  background: linear-gradient(180deg, rgba(10,10,13,0.85) 0%, rgba(6,6,9,0.92) 100%);
  border: 1px solid #2a2014;
  border-radius: 2px;
  pointer-events: none;
  text-shadow: 0 1px 0 #000;
  opacity: 0.55;
  transition: opacity 200ms, border-color 200ms, color 200ms;
}
.dusk-sp-badge .dusk-sp-count {
  font-size: 14px;
  color: #c8a060;
  font-weight: bold;
  min-width: 14px;
  text-align: right;
}
.dusk-sp-badge.dusk-sp-badge-active {
  opacity: 1;
  border-color: #c8a060;
  color: #d8dde4;
  box-shadow:
    inset 0 0 0 1px rgba(240,208,128,0.3),
    0 0 12px rgba(240,208,128,0.4);
  animation: dusk-sp-badge-pulse 1.6s ease-in-out infinite;
}
.dusk-sp-badge.dusk-sp-badge-active .dusk-sp-count {
  color: #f0d080;
  text-shadow: 0 0 6px rgba(240,208,128,0.7), 0 1px 0 #000;
}
@keyframes dusk-sp-badge-pulse {
  0%, 100% { box-shadow: inset 0 0 0 1px rgba(240,208,128,0.3), 0 0 8px rgba(240,208,128,0.3); }
  50%      { box-shadow: inset 0 0 0 1px rgba(240,208,128,0.6), 0 0 18px rgba(240,208,128,0.6); }
}

.dusk-slot-lock {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(8,8,11,0.78);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
  border-radius: 2px;
  filter: grayscale(1);
}
.dusk-slot-lock-icon {
  font-size: 20px;
  color: #6a7480;
  text-shadow: 0 1px 2px #000;
  filter: grayscale(1);
}
.dusk-slot-lock-lvl {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: #c8a060;
  text-shadow: 0 1px 0 #000;
}

.dusk-slot-rank {
  position: absolute;
  right: 3px;
  bottom: 3px;
  display: flex;
  gap: 2px;
  z-index: 4;
  pointer-events: none;
}
.dusk-slot-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(40,40,48,0.9);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.6);
}
.dusk-slot-dot.dusk-slot-dot-on {
  background: #f0d080;
  box-shadow: 0 0 4px rgba(240,208,128,0.8), inset 0 0 0 1px rgba(0,0,0,0.4);
}

.dusk-slot.dusk-slot-sp-pulse {
  animation: dusk-slot-sp-pulse-anim 1.4s ease-in-out infinite;
}
@keyframes dusk-slot-sp-pulse-anim {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 4px rgba(0,0,0,0.6), 0 0 6px rgba(240,208,128,0.25); }
  50%      { box-shadow: inset 0 1px 0 rgba(255,255,255,0.1),  inset 0 -1px 4px rgba(0,0,0,0.6), 0 0 16px rgba(240,208,128,0.7); }
}

.dusk-levelup-title { display: block; }
.dusk-levelup-sub {
  display: block;
  margin-top: 6px;
  font-size: 14px;
  letter-spacing: 0.32em;
  color: #f0d080;
  text-shadow: 0 0 8px rgba(240,208,128,0.6), 0 1px 2px #000;
  font-weight: normal;
}
`;
  document.head.appendChild(style);
}

const HUD_EXTRA_STYLE_ID = 'dusk-hud-extra-style';
function injectHudExtraStyles(): void {
  if (document.getElementById(HUD_EXTRA_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HUD_EXTRA_STYLE_ID;
  style.textContent = `
/* Damage flash on the HP orb (replaces old bar shake animation) */
@keyframes dusk-orb-flash-anim {
  0%   { filter: brightness(2.4) saturate(1.6); transform: scale(1.06); }
  40%  { filter: brightness(1.4) saturate(1.2); transform: scale(1.0); }
  100% { filter: brightness(1) saturate(1); transform: scale(1); }
}
.dusk-orb-wrap.dusk-orb-flash .dusk-orb-svg {
  animation: dusk-orb-flash-anim 360ms ease-out;
}

/* Hotbar SVG cooldown ring (sits on top of conic-gradient via z-index) */
.dusk-slot-cd-ring {
  position: absolute;
  inset: -2px;
  pointer-events: none;
  z-index: 3;
  opacity: 0;
  transition: opacity 120ms;
}
.dusk-slot-cd-ring.dusk-slot-cd-ring-on { opacity: 1; }
.dusk-slot-cd-ring circle {
  fill: none;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
}

/* Ready-pulse: outward expanding glow when cooldown clears */
@keyframes dusk-slot-ready-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(240,208,128,0.85), inset 0 0 0 1px rgba(240,208,128,0.6); }
  60%  { box-shadow: 0 0 0 14px rgba(240,208,128,0), inset 0 0 0 1px rgba(240,208,128,0.0); }
  100% { box-shadow: 0 0 0 0 rgba(240,208,128,0), inset 0 0 0 1px rgba(240,208,128,0.0); }
}
.dusk-slot-ready-flash {
  animation: dusk-slot-ready-pulse 0.45s ease-out;
}
`;
  document.head.appendChild(style);
}
