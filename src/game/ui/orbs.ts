// D4-style HP / Resource orbs. SVG-based render with a "liquid surface" wave,
// gothic metal outer ring, and class-tinted resource fluid. Replaces the old
// horizontal bars in the HUD without touching anything else.
//
// Each orb is a self-contained SVG element. Update is cheap: we set CSS variables
// and rebuild only the wave path each frame.

import type { ResourceKind, ClassId } from '../../core/components';

const ORB_PX = 124; // outer SVG box
const ORB_R = 48;   // inner liquid circle radius
const ORB_CX = 62;  // center x (matches viewBox 0..124)
const ORB_CY = 62;

export type OrbKind = 'hp' | 'resource';

export interface Orb {
  root: HTMLDivElement;
  /** Set fill ratio 0..1 + numeric label (e.g. "240 / 250"). */
  set(ratio: number, text: string): void;
  /** Per-frame wave + flicker animation. dt in seconds. */
  tick(realDt: number): void;
  /** Apply class colors to a resource orb (no-op for hp orbs). */
  setClass(classId: ClassId, kind: ResourceKind): void;
}

interface ColorPair {
  liquid: string;
  liquidDark: string;
  glow: string;
  ringTint: string;
}

const HP_COLORS: ColorPair = {
  liquid: '#ff3030',
  liquidDark: '#7a0a10',
  glow: 'rgba(255, 80, 80, 0.65)',
  ringTint: '#5a1414',
};

const RES_COLORS: Record<ClassId, ColorPair> = {
  rogue: { liquid: '#40ff70', liquidDark: '#0a4818', glow: 'rgba(80,255,128,0.6)', ringTint: '#143218' },
  barbarian: { liquid: '#ff8030', liquidDark: '#5a2008', glow: 'rgba(255,140,60,0.65)', ringTint: '#3a1808' },
  sorcerer: { liquid: '#4080ff', liquidDark: '#0a1a5a', glow: 'rgba(80,140,255,0.65)', ringTint: '#142048' },
};

const RES_FALLBACK: Record<ResourceKind, ColorPair> = {
  mana: RES_COLORS.sorcerer,
  energy: RES_COLORS.rogue,
  rage: RES_COLORS.barbarian,
  fury: RES_COLORS.barbarian,
};

let _stylesInjected = false;
function injectOrbStyles(): void {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'dusk-orb-style';
  style.textContent = `
.dusk-orb-wrap {
  position: fixed;
  bottom: 18px;
  width: ${ORB_PX}px;
  height: ${ORB_PX + 22}px;
  pointer-events: none;
  user-select: none;
  font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif;
}
.dusk-orb-hp { left: 22px; }
.dusk-orb-res { right: 22px; }
.dusk-orb-svg {
  width: ${ORB_PX}px;
  height: ${ORB_PX}px;
  display: block;
  filter: drop-shadow(0 0 14px var(--orb-glow, rgba(0,0,0,0.4)))
          drop-shadow(0 4px 8px rgba(0,0,0,0.7));
}
.dusk-orb-text {
  position: absolute;
  top: ${ORB_PX - 10}px;
  left: 0; right: 0;
  text-align: center;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: #f0d080;
  text-shadow: 0 1px 0 #000, 0 0 6px rgba(0,0,0,0.9), 0 0 10px rgba(200,160,96,0.35);
}
.dusk-orb-low .dusk-orb-svg {
  animation: dusk-orb-low-pulse 0.55s ease-in-out infinite;
}
@keyframes dusk-orb-low-pulse {
  0%, 100% { filter: drop-shadow(0 0 12px rgba(255,80,80,0.55)) drop-shadow(0 4px 8px rgba(0,0,0,0.7)); }
  50%      { filter: drop-shadow(0 0 22px rgba(255,220,80,0.85)) drop-shadow(0 4px 8px rgba(0,0,0,0.7)); }
}
`;
  document.head.appendChild(style);
}

interface OrbInternals {
  wavePath: SVGPathElement;
  liquidGroup: SVGGElement;
  liquidGradStops: [SVGStopElement, SVGStopElement];
  outerGlow: SVGCircleElement;
  text: HTMLDivElement;
  ratio: number;
  phase: number;
  kind: OrbKind;
  colors: ColorPair;
  wrap: HTMLDivElement;
}

function buildOrbDom(kind: OrbKind): OrbInternals {
  injectOrbStyles();
  const wrap = document.createElement('div');
  wrap.className = `dusk-orb-wrap ${kind === 'hp' ? 'dusk-orb-hp' : 'dusk-orb-res'}`;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'dusk-orb-svg');
  svg.setAttribute('viewBox', `0 0 ${ORB_PX} ${ORB_PX}`);

  const defs = document.createElementNS(NS, 'defs');

  // Outer ring radial gradient (gothic metal).
  const ringGrad = document.createElementNS(NS, 'radialGradient');
  ringGrad.setAttribute('id', `orb-ring-${kind}`);
  ringGrad.setAttribute('cx', '50%');
  ringGrad.setAttribute('cy', '38%');
  ringGrad.setAttribute('r', '60%');
  const rstops = [
    ['0%', '#5a4a30'],
    ['45%', '#241c10'],
    ['78%', '#0a0608'],
    ['100%', '#000'],
  ];
  for (const [off, col] of rstops) {
    const s = document.createElementNS(NS, 'stop');
    s.setAttribute('offset', off);
    s.setAttribute('stop-color', col);
    ringGrad.appendChild(s);
  }
  defs.appendChild(ringGrad);

  // Inner glass radial (dark inside, slight rim light).
  const glassGrad = document.createElementNS(NS, 'radialGradient');
  glassGrad.setAttribute('id', `orb-glass-${kind}`);
  glassGrad.setAttribute('cx', '40%');
  glassGrad.setAttribute('cy', '32%');
  glassGrad.setAttribute('r', '70%');
  const gstops = [
    ['0%', '#2a2228'],
    ['55%', '#0a0608'],
    ['100%', '#000'],
  ];
  for (const [off, col] of gstops) {
    const s = document.createElementNS(NS, 'stop');
    s.setAttribute('offset', off);
    s.setAttribute('stop-color', col);
    glassGrad.appendChild(s);
  }
  defs.appendChild(glassGrad);

  // Liquid linear gradient (top -> bottom).
  const liquidGrad = document.createElementNS(NS, 'linearGradient');
  liquidGrad.setAttribute('id', `orb-liquid-${kind}`);
  liquidGrad.setAttribute('x1', '0%'); liquidGrad.setAttribute('y1', '0%');
  liquidGrad.setAttribute('x2', '0%'); liquidGrad.setAttribute('y2', '100%');
  const ls0 = document.createElementNS(NS, 'stop');
  ls0.setAttribute('offset', '0%'); ls0.setAttribute('stop-color', '#ff3030');
  const ls1 = document.createElementNS(NS, 'stop');
  ls1.setAttribute('offset', '100%'); ls1.setAttribute('stop-color', '#7a0a10');
  liquidGrad.appendChild(ls0);
  liquidGrad.appendChild(ls1);
  defs.appendChild(liquidGrad);

  // Specular highlight on top of liquid.
  const sheenGrad = document.createElementNS(NS, 'radialGradient');
  sheenGrad.setAttribute('id', `orb-sheen-${kind}`);
  sheenGrad.setAttribute('cx', '38%'); sheenGrad.setAttribute('cy', '28%');
  sheenGrad.setAttribute('r', '40%');
  const sh0 = document.createElementNS(NS, 'stop');
  sh0.setAttribute('offset', '0%'); sh0.setAttribute('stop-color', 'rgba(255,255,255,0.55)');
  const sh1 = document.createElementNS(NS, 'stop');
  sh1.setAttribute('offset', '100%'); sh1.setAttribute('stop-color', 'rgba(255,255,255,0)');
  sheenGrad.appendChild(sh0); sheenGrad.appendChild(sh1);
  defs.appendChild(sheenGrad);

  // ClipPath that constrains liquid path to the orb circle.
  const clip = document.createElementNS(NS, 'clipPath');
  clip.setAttribute('id', `orb-clip-${kind}`);
  const clipCircle = document.createElementNS(NS, 'circle');
  clipCircle.setAttribute('cx', String(ORB_CX));
  clipCircle.setAttribute('cy', String(ORB_CY));
  clipCircle.setAttribute('r', String(ORB_R));
  clip.appendChild(clipCircle);
  defs.appendChild(clip);

  svg.appendChild(defs);

  // Outer ring (large circle).
  const outerRing = document.createElementNS(NS, 'circle');
  outerRing.setAttribute('cx', String(ORB_CX));
  outerRing.setAttribute('cy', String(ORB_CY));
  outerRing.setAttribute('r', String(ORB_R + 10));
  outerRing.setAttribute('fill', `url(#orb-ring-${kind})`);
  outerRing.setAttribute('stroke', '#000');
  outerRing.setAttribute('stroke-width', '1');
  svg.appendChild(outerRing);

  // Inner glass.
  const innerGlass = document.createElementNS(NS, 'circle');
  innerGlass.setAttribute('cx', String(ORB_CX));
  innerGlass.setAttribute('cy', String(ORB_CY));
  innerGlass.setAttribute('r', String(ORB_R));
  innerGlass.setAttribute('fill', `url(#orb-glass-${kind})`);
  svg.appendChild(innerGlass);

  // Liquid group (clipped).
  const liquidGroup = document.createElementNS(NS, 'g');
  liquidGroup.setAttribute('clip-path', `url(#orb-clip-${kind})`);

  const wavePath = document.createElementNS(NS, 'path');
  wavePath.setAttribute('fill', `url(#orb-liquid-${kind})`);
  wavePath.setAttribute('opacity', '0.92');
  liquidGroup.appendChild(wavePath);

  // Sheen sphere on liquid.
  const sheen = document.createElementNS(NS, 'circle');
  sheen.setAttribute('cx', String(ORB_CX - 2));
  sheen.setAttribute('cy', String(ORB_CY - 4));
  sheen.setAttribute('r', String(ORB_R - 2));
  sheen.setAttribute('fill', `url(#orb-sheen-${kind})`);
  liquidGroup.appendChild(sheen);

  svg.appendChild(liquidGroup);

  // Inner rim (subtle gold annulus around liquid).
  const rim = document.createElementNS(NS, 'circle');
  rim.setAttribute('cx', String(ORB_CX));
  rim.setAttribute('cy', String(ORB_CY));
  rim.setAttribute('r', String(ORB_R + 0.5));
  rim.setAttribute('fill', 'none');
  rim.setAttribute('stroke', '#5a4a28');
  rim.setAttribute('stroke-width', '1.6');
  rim.setAttribute('opacity', '0.85');
  svg.appendChild(rim);

  // Outer hot glow ring (color-tinted, becomes flicker when low).
  const outerGlow = document.createElementNS(NS, 'circle');
  outerGlow.setAttribute('cx', String(ORB_CX));
  outerGlow.setAttribute('cy', String(ORB_CY));
  outerGlow.setAttribute('r', String(ORB_R + 9));
  outerGlow.setAttribute('fill', 'none');
  outerGlow.setAttribute('stroke', '#c8a060');
  outerGlow.setAttribute('stroke-width', '1');
  outerGlow.setAttribute('opacity', '0.35');
  svg.appendChild(outerGlow);

  wrap.appendChild(svg);

  const text = document.createElement('div');
  text.className = 'dusk-orb-text';
  text.textContent = '— / —';
  wrap.appendChild(text);

  const startColors = kind === 'hp' ? HP_COLORS : RES_FALLBACK.energy;
  ls0.setAttribute('stop-color', startColors.liquid);
  ls1.setAttribute('stop-color', startColors.liquidDark);
  wrap.style.setProperty('--orb-glow', startColors.glow);

  return {
    wavePath,
    liquidGroup,
    liquidGradStops: [ls0, ls1],
    outerGlow,
    text,
    ratio: 1,
    phase: 0,
    kind,
    colors: startColors,
    wrap,
  };
}

function buildWavePath(ratio: number, phase: number): string {
  // Compute liquid surface y based on ratio (0 at bottom, 1 at top).
  const r = Math.max(0, Math.min(1, ratio));
  // Liquid "fills" inside circle bounded by [cy - R, cy + R].
  const top = ORB_CY - ORB_R;
  const bottom = ORB_CY + ORB_R;
  const surfaceY = bottom - (bottom - top) * r;

  // Build a wavy top edge across slightly wider than the orb to let clipPath trim.
  const left = ORB_CX - ORB_R - 6;
  const right = ORB_CX + ORB_R + 6;
  const segs = 18;
  const ampMax = 3.6;
  // Damp wave amplitude near full or empty so the surface flattens at extremes.
  const amp = ampMax * (1 - Math.abs(r * 2 - 1));

  let d = `M ${left.toFixed(2)} ${(bottom + 8).toFixed(2)}`;
  d += ` L ${left.toFixed(2)} ${surfaceY.toFixed(2)}`;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = left + (right - left) * t;
    const wave = Math.sin(phase + t * Math.PI * 3.0) * amp
               + Math.sin(phase * 1.7 + t * Math.PI * 5.0) * amp * 0.45;
    d += ` L ${x.toFixed(2)} ${(surfaceY + wave).toFixed(2)}`;
  }
  d += ` L ${right.toFixed(2)} ${(bottom + 8).toFixed(2)} Z`;
  return d;
}

export function createOrb(kind: OrbKind, host: HTMLElement): Orb {
  const internals = buildOrbDom(kind);
  host.appendChild(internals.wrap);

  const applyColors = (c: ColorPair): void => {
    internals.colors = c;
    internals.liquidGradStops[0].setAttribute('stop-color', c.liquid);
    internals.liquidGradStops[1].setAttribute('stop-color', c.liquidDark);
    internals.outerGlow.setAttribute('stroke', c.liquid);
    internals.wrap.style.setProperty('--orb-glow', c.glow);
  };

  if (kind === 'hp') applyColors(HP_COLORS);

  return {
    root: internals.wrap,
    set(ratio, text) {
      internals.ratio = Math.max(0, Math.min(1, ratio));
      internals.text.textContent = text;
      // Low-HP pulse class for HP orbs.
      if (kind === 'hp') {
        if (internals.ratio < 0.3) internals.wrap.classList.add('dusk-orb-low');
        else internals.wrap.classList.remove('dusk-orb-low');
      }
    },
    tick(realDt) {
      internals.phase += realDt * 2.4;
      const d = buildWavePath(internals.ratio, internals.phase);
      internals.wavePath.setAttribute('d', d);
      // Slow breathing on outer glow.
      const glowAlpha = 0.32 + Math.sin(internals.phase * 0.8) * 0.08;
      internals.outerGlow.setAttribute('opacity', glowAlpha.toFixed(3));
    },
    setClass(classId, kindRes) {
      if (kind !== 'resource') return;
      const c = RES_COLORS[classId] ?? RES_FALLBACK[kindRes];
      applyColors(c);
    },
  };
}
