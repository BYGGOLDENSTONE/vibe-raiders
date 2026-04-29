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
export const PHASES: AtmospherePhase[] = [
  {
    name: 'GOLDEN HOUR',
    durationSec: 75,
    skyHorizon: 0xff8a3c,
    skyZenith: 0x2d1a3a,
    sunGlow: 0xff8c33,
    sunGlowStrength: 0.35,
    sunColor: 0xffd28a,
    sunIntensity: 1.6,
    hemiSky: 0xff8a3c,
    hemiGround: 0x4a3850,
    hemiIntensity: 0.95,
    fogColor: 0xb8723a,
    fogNear: 40,
    fogFar: 220,
    exposure: 1.25,
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
    sunIntensity: 1.2,
    hemiSky: 0xb04020,
    hemiGround: 0x4a2418,
    hemiIntensity: 1.05,
    fogColor: 0x8a3a18,
    fogNear: 18,
    fogFar: 110,
    exposure: 1.15,
    background: 0x1a0a04,
  },
  {
    name: 'ASHEN HAZE',
    durationSec: 75,
    skyHorizon: 0x9a8a90,
    skyZenith: 0x2a2832,
    sunGlow: 0xa89890,
    sunGlowStrength: 0.18,
    sunColor: 0xc8c0c8,
    sunIntensity: 0.95,
    hemiSky: 0x8a8090,
    hemiGround: 0x40383c,
    hemiIntensity: 0.85,
    fogColor: 0x6a6068,
    fogNear: 25,
    fogFar: 150,
    exposure: 1.05,
    background: 0x121014,
  },
  {
    name: 'BLOOD VEIL',
    durationSec: 75,
    skyHorizon: 0x7a1820,
    skyZenith: 0x180818,
    sunGlow: 0xc8284a,
    sunGlowStrength: 0.45,
    sunColor: 0xff5060,
    sunIntensity: 1.0,
    hemiSky: 0x8a1828,
    hemiGround: 0x281020,
    hemiIntensity: 0.9,
    fogColor: 0x4a1018,
    fogNear: 22,
    fogFar: 140,
    exposure: 1.15,
    background: 0x0a0204,
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
