import { Color, Vector3, type DirectionalLight, type HemisphereLight, type Fog, type WebGLRenderer } from 'three';
import type { SceneBundle } from './scene';

export interface AtmospherePhase {
  name: string;
  durationSec: number;
  skyHorizon: number;
  skyZenith: number;
  sunGlow: number;
  sunGlowStrength: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  background: number;
}

// Four moods that loop. Each tweens smoothly into the next.
// Brightness raised across the board so interiors stay readable; fog far
// pushed to clear the 400m world.
export const PHASES: AtmospherePhase[] = [
  {
    name: 'GOLDEN HOUR',
    durationSec: 75,
    skyHorizon: 0xff8a3c,
    skyZenith: 0x2d1a3a,
    sunGlow: 0xff8c33,
    sunGlowStrength: 0.35,
    sunColor: 0xffd28a,
    sunIntensity: 1.7,
    hemiSky: 0xff8a3c,
    hemiGround: 0x5a4858,
    hemiIntensity: 1.05,
    fogColor: 0xb8723a,
    fogNear: 60,
    fogFar: 380,
    exposure: 1.30,
    background: 0x1a0e06,
  },
  {
    name: 'DUST STORM',
    durationSec: 75,
    skyHorizon: 0xc5421a,
    skyZenith: 0x3a1a18,
    sunGlow: 0xff5a1a,
    sunGlowStrength: 0.5,
    sunColor: 0xff9050,
    sunIntensity: 1.35,
    hemiSky: 0xc04830,
    hemiGround: 0x5a3024,
    hemiIntensity: 1.20,
    fogColor: 0x9a4a26,
    fogNear: 35,
    fogFar: 220,
    exposure: 1.25,
    background: 0x1a0a04,
  },
  {
    name: 'ASHEN HAZE',
    durationSec: 75,
    skyHorizon: 0xa89aa0,
    skyZenith: 0x32303a,
    sunGlow: 0xb8a8a0,
    sunGlowStrength: 0.22,
    sunColor: 0xd8d2d4,
    sunIntensity: 1.20,
    hemiSky: 0x9a90a0,
    hemiGround: 0x4a4248,
    hemiIntensity: 1.05,
    fogColor: 0x7a7078,
    fogNear: 45,
    fogFar: 290,
    exposure: 1.22,
    background: 0x18161a,
  },
  {
    name: 'BLOOD VEIL',
    durationSec: 75,
    skyHorizon: 0x8a2028,
    skyZenith: 0x1c0a18,
    sunGlow: 0xd83456,
    sunGlowStrength: 0.5,
    sunColor: 0xff6878,
    sunIntensity: 1.20,
    hemiSky: 0x9c2030,
    hemiGround: 0x381828,
    hemiIntensity: 1.10,
    fogColor: 0x5a161e,
    fogNear: 38,
    fogFar: 260,
    exposure: 1.28,
    background: 0x0e0306,
  },
];

export interface AtmosphereSystem {
  update: (dt: number) => void;
  currentPhaseName: () => string;
  setTime: (sec: number) => void;
  totalCycleSec: () => number;
}

export function createAtmosphere(bundle: SceneBundle): AtmosphereSystem {
  const totalCycle = PHASES.reduce((s, p) => s + p.durationSec, 0);
  let elapsed = 0;

  const tmpColor = new Color();
  const tmpA = new Color();
  const tmpB = new Color();

  function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

  function lerpHexInto(target: Color, hexA: number, hexB: number, t: number): Color {
    tmpA.setHex(hexA);
    tmpB.setHex(hexB);
    target.copy(tmpA).lerp(tmpB, t);
    return target;
  }

  function applyVec3(target: { value: Vector3 }, hexA: number, hexB: number, t: number): void {
    lerpHexInto(tmpColor, hexA, hexB, t);
    target.value.set(tmpColor.r, tmpColor.g, tmpColor.b);
  }

  function findPhase(time: number): { from: AtmospherePhase; to: AtmospherePhase; t: number } {
    let cursor = time % totalCycle;
    for (let i = 0; i < PHASES.length; i++) {
      const p = PHASES[i];
      if (cursor < p.durationSec) {
        const next = PHASES[(i + 1) % PHASES.length];
        const t = cursor / p.durationSec;
        const eased = t * t * (3 - 2 * t);
        return { from: p, to: next, t: eased };
      }
      cursor -= p.durationSec;
    }
    return { from: PHASES[0], to: PHASES[1], t: 0 };
  }

  function apply(time: number) {
    const { from, to, t } = findPhase(time);
    const u = bundle.skyUniforms;
    applyVec3(u.uHorizon, from.skyHorizon, to.skyHorizon, t);
    applyVec3(u.uZenith, from.skyZenith, to.skyZenith, t);
    applyVec3(u.uSunGlow, from.sunGlow, to.sunGlow, t);
    u.uSunGlowStrength.value = lerp(from.sunGlowStrength, to.sunGlowStrength, t);

    const sun = bundle.sun as DirectionalLight;
    lerpHexInto(sun.color, from.sunColor, to.sunColor, t);
    sun.intensity = lerp(from.sunIntensity, to.sunIntensity, t);

    const hemi = bundle.hemi as HemisphereLight;
    lerpHexInto(hemi.color, from.hemiSky, to.hemiSky, t);
    lerpHexInto(hemi.groundColor, from.hemiGround, to.hemiGround, t);
    hemi.intensity = lerp(from.hemiIntensity, to.hemiIntensity, t);

    const fog = bundle.fog as Fog;
    lerpHexInto(fog.color, from.fogColor, to.fogColor, t);
    fog.near = lerp(from.fogNear, to.fogNear, t);
    fog.far = lerp(from.fogFar, to.fogFar, t);

    const renderer = bundle.renderer as WebGLRenderer;
    renderer.toneMappingExposure = lerp(from.exposure, to.exposure, t);

    const bgA = tmpA.setHex(from.background);
    const bgB = tmpB.setHex(to.background);
    if (bundle.scene.background instanceof Color) {
      bundle.scene.background.copy(bgA).lerp(bgB, t);
    }
  }

  return {
    update: (dt: number) => {
      elapsed += dt;
      apply(elapsed);
    },
    currentPhaseName: () => findPhase(elapsed).from.name,
    setTime: (s: number) => { elapsed = s; apply(elapsed); },
    totalCycleSec: () => totalCycle,
  };
}
