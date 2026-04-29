// Style sheet injection for the HUD. Keeping all CSS in one place so the rest
// of the UI module stays lean. Inject once on init.

const STYLE_ID = 'dusk-hud-style';

const CSS = `
/* ============================================================
 * DUSK HUD — gothic browser ARPG overlay
 * Pulled from COLORS.ui: text #d8dde4, dim #6a7480, accent #c8a060, danger #c04040
 * ============================================================ */

#ui-root {
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  color: #d8dde4;
}

/* Generic gothic panel — dark inset with parchment border */
.dusk-panel {
  position: fixed;
  background: linear-gradient(180deg, rgba(10,10,13,0.92) 0%, rgba(6,6,9,0.96) 100%);
  border: 1px solid #4a3820;
  box-shadow:
    inset 0 0 0 1px rgba(200,160,96,0.08),
    inset 0 0 12px rgba(0,0,0,0.6),
    0 2px 8px rgba(0,0,0,0.5);
  pointer-events: none;
}
.dusk-panel-header {
  font-size: 10px;
  letter-spacing: 0.32em;
  color: #c8a060;
  padding: 4px 10px;
  border-bottom: 1px solid #2a2014;
  text-shadow: 0 1px 0 #000;
}

/* ---- Top-left: Party panel ---- */
.dusk-party {
  top: 16px;
  left: 16px;
  width: 200px;
  height: 60px;
}
.dusk-party-body {
  padding: 8px 10px;
  font-size: 10px;
  color: #6a7480;
  letter-spacing: 0.2em;
}

/* ---- Top-right: FPS / Zone ---- */
.dusk-topright {
  position: fixed;
  top: 12px;
  right: 16px;
  text-align: right;
  pointer-events: none;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: #6a7480;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
.dusk-zone {
  text-transform: uppercase;
  color: #8a9080;
  margin-bottom: 2px;
}
.dusk-fps { color: #4a5060; }

/* ---- Bottom bars (HP / Resource) ---- */
.dusk-bar {
  position: fixed;
  bottom: 28px;
  width: 280px;
  pointer-events: none;
}
.dusk-hp { left: 24px; }
.dusk-res { right: 24px; }

.dusk-bar-label {
  font-size: 9px;
  letter-spacing: 0.32em;
  color: #c8a060;
  margin-bottom: 4px;
  text-shadow: 0 1px 0 #000;
}
.dusk-hp .dusk-bar-label { text-align: left; }
.dusk-res .dusk-bar-label { text-align: right; }

.dusk-bar-frame {
  height: 22px;
  background: linear-gradient(180deg, #08080a 0%, #14141a 100%);
  border: 1px solid #4a3820;
  border-radius: 2px;
  box-shadow:
    inset 0 1px 4px rgba(0,0,0,0.9),
    inset 0 0 0 1px rgba(200,160,96,0.06),
    0 1px 0 rgba(255,255,255,0.04);
  overflow: hidden;
  position: relative;
}
.dusk-bar-fill {
  height: 100%;
  width: 100%;
  transition: width 120ms ease-out;
  position: relative;
}
.dusk-hp-fill {
  background: linear-gradient(180deg, #d04848 0%, #6a1818 100%);
  box-shadow: inset 0 0 12px rgba(0,0,0,0.4);
}
.dusk-res-fill {
  background: linear-gradient(180deg, #5a78c8 0%, #2a3a78 100%);
  box-shadow: inset 0 0 12px rgba(0,0,0,0.4);
}
/* Sheen on top of fill — subtle gloss line */
.dusk-bar-fill::after {
  content: '';
  position: absolute;
  inset: 0 0 50% 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%);
  pointer-events: none;
}
.dusk-bar-text {
  position: absolute;
  bottom: 1px;
  left: 0; right: 0;
  text-align: center;
  font-size: 11px;
  color: #e8d8b0;
  text-shadow: 0 1px 2px #000, 0 0 1px #000;
  letter-spacing: 0.05em;
  line-height: 22px;
  pointer-events: none;
}
.dusk-hp .dusk-bar-text,
.dusk-res .dusk-bar-text {
  /* re-anchor inside the frame */
  bottom: auto;
  top: 18px;
}

/* Damage flash + critical pulse */
@keyframes dusk-flash-shake {
  0%   { transform: translateX(0); filter: brightness(1.5) saturate(1.4); }
  20%  { transform: translateX(-4px); }
  40%  { transform: translateX(4px); }
  60%  { transform: translateX(-2px); }
  80%  { transform: translateX(2px); }
  100% { transform: translateX(0); filter: brightness(1) saturate(1); }
}
.dusk-flash { animation: dusk-flash-shake 280ms ease-out; }

@keyframes dusk-critical-pulse {
  0%, 100% { box-shadow: inset 0 1px 4px rgba(0,0,0,0.9), 0 0 0 0 rgba(208,72,72,0.0); }
  50%      { box-shadow: inset 0 1px 4px rgba(0,0,0,0.9), 0 0 16px 2px rgba(208,72,72,0.6); }
}
.dusk-critical .dusk-bar-frame { animation: dusk-critical-pulse 900ms ease-in-out infinite; }

/* ---- XP strip + level (above hotbar, full width) ---- */
.dusk-xp-strip {
  position: fixed;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, 70vw);
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: none;
}
.dusk-level {
  font-size: 11px;
  letter-spacing: 0.25em;
  color: #c8a060;
  text-shadow: 0 1px 0 #000, 0 0 6px rgba(200,160,96,0.4);
  min-width: 48px;
}
.dusk-xp-track {
  flex: 1;
  height: 4px;
  background: #08080a;
  border: 1px solid #2a2014;
  border-radius: 1px;
  overflow: hidden;
  position: relative;
}
.dusk-xp-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #8a6a30 0%, #f0d080 50%, #8a6a30 100%);
  box-shadow: 0 0 8px rgba(200,160,96,0.5);
  transition: width 200ms ease-out;
}
@keyframes dusk-xp-pulse-anim {
  0%   { filter: brightness(1) saturate(1); }
  30%  { filter: brightness(2.0) saturate(1.6); }
  100% { filter: brightness(1) saturate(1); }
}
.dusk-xp-pulse { animation: dusk-xp-pulse-anim 400ms ease-out; }

/* ---- Hotbar ---- */
.dusk-hotbar {
  position: fixed;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: flex-end;
  gap: 16px;
  pointer-events: none;
}
.dusk-hotbar-group {
  display: flex;
  gap: 6px;
  padding: 6px;
  background: linear-gradient(180deg, rgba(10,10,13,0.85) 0%, rgba(6,6,9,0.92) 100%);
  border: 1px solid #4a3820;
  border-radius: 3px;
  box-shadow:
    inset 0 0 0 1px rgba(200,160,96,0.06),
    0 4px 12px rgba(0,0,0,0.5);
}
.dusk-slot {
  position: relative;
  width: 52px;
  height: 52px;
  border: 1px solid #2a2014;
  background: linear-gradient(180deg, #14141a 0%, #08080a 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 4px rgba(0,0,0,0.6);
  border-radius: 2px;
  pointer-events: none;
  transition: box-shadow 120ms;
}
.dusk-slot.dusk-slot-ready {
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.06),
    inset 0 -1px 4px rgba(0,0,0,0.6),
    0 0 8px rgba(200,160,96,0.25);
}
.dusk-slot-key {
  position: absolute;
  top: 2px; left: 4px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: #c8a060;
  text-shadow: 0 1px 0 #000;
  z-index: 3;
}
.dusk-slot-glyph {
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #fff;
  text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,0.6);
  box-shadow: inset 0 1px 2px rgba(255,255,255,0.25), inset 0 -2px 4px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.6);
  z-index: 1;
}
.dusk-slot-cd {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 2px;
  z-index: 2;
  opacity: 0;
  transition: opacity 80ms;
}
.dusk-slot-cd-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  text-shadow: 0 1px 2px #000, 0 0 4px rgba(0,0,0,0.9);
  z-index: 4;
  pointer-events: none;
  opacity: 0;
}

/* ---- Skill cast toast (above hotbar) ---- */
.dusk-skill-toast {
  position: fixed;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  letter-spacing: 0.32em;
  color: #c8a060;
  text-shadow: 0 1px 4px #000, 0 0 8px rgba(200,160,96,0.5);
  opacity: 0;
  pointer-events: none;
  text-transform: uppercase;
}
@keyframes dusk-toast-anim {
  0%   { opacity: 0; transform: translate(-50%, 8px); }
  20%  { opacity: 1; transform: translate(-50%, 0); }
  80%  { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, -10px); }
}
.dusk-toast-show { animation: dusk-toast-anim 1100ms ease-out forwards; }

/* ---- Kill / XP feed ---- */
.dusk-feed {
  position: fixed;
  top: 80px;
  right: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  pointer-events: none;
}
.dusk-feed-line {
  font-size: 12px;
  letter-spacing: 0.1em;
  color: #c8a060;
  text-shadow: 0 1px 2px #000;
  animation: dusk-feed-fade 1000ms ease-out forwards;
}
@keyframes dusk-feed-fade {
  0%   { opacity: 0; transform: translateX(8px); }
  20%  { opacity: 1; transform: translateX(0); }
  80%  { opacity: 1; }
  100% { opacity: 0; transform: translateX(-4px); }
}

/* ---- Level up overlay ---- */
.dusk-levelup {
  position: fixed;
  top: 30%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.8);
  font-size: 48px;
  letter-spacing: 0.5em;
  color: #f0d080;
  text-shadow:
    0 0 20px rgba(240,208,128,0.8),
    0 0 40px rgba(200,160,96,0.6),
    0 2px 4px #000;
  opacity: 0;
  pointer-events: none;
  font-weight: bold;
}
@keyframes dusk-levelup-anim {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  20%  { opacity: 1; transform: translate(-50%, -50%) scale(1.05); }
  40%  { transform: translate(-50%, -50%) scale(1.0); }
  75%  { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.1); }
}
.dusk-levelup-show { animation: dusk-levelup-anim 1500ms ease-out forwards; }
`;

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
