// Post-processing pipeline: bloom (picks up emissives) + custom vignette/cool grade.
// Sets ctx.renderHook so main.ts calls composer.render() instead of renderer.render().

import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { GameContext } from '../state';

const VignetteGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignetteStrength: { value: 0.22 },
    uVignetteSoft: { value: 0.55 },
    uCoolTint: { value: new Vector2(0.98, 1.02) }, // r-mul, b-mul (g implicit 1.0)
    uDarkFlash: { value: 0.0 }, // 0..1 darken the screen (player death cue)
    uBrightFlash: { value: 0.0 }, // 0..1 lift toward white (level-up cue)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignetteStrength;
    uniform float uVignetteSoft;
    uniform vec2 uCoolTint;
    uniform float uDarkFlash;
    uniform float uBrightFlash;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // Cool tint: nudge red down, blue up — DUSK twilight feel.
      c.r *= uCoolTint.x;
      c.b *= uCoolTint.y;

      // Subtle contrast lift (S-curve approximation).
      c.rgb = mix(vec3(0.5), c.rgb, 1.06);

      // Vignette: fade to ~uVignetteStrength at the corners.
      float d = length(vUv - 0.5);
      float v = smoothstep(uVignetteSoft * 0.5, 0.9, d);
      c.rgb *= mix(1.0, 1.0 - uVignetteStrength, v);

      // Dark flash (player hurt/death) — multiply down.
      c.rgb *= (1.0 - uDarkFlash * 0.7);

      // Bright flash (level-up) — additive lift toward warm gold.
      c.rgb += vec3(1.0, 0.85, 0.5) * uBrightFlash;

      gl_FragColor = vec4(c.rgb, c.a);
    }
  `,
};

export interface PostFx {
  composer: EffectComposer;
  vignettePass: ShaderPass;
  setSize(w: number, h: number): void;
  triggerDarkFlash(strength: number, duration: number): void;
  triggerBrightFlash(strength: number, duration: number): void;
  update(realDt: number): void;
}

interface FlashState {
  active: boolean;
  peak: number;
  remaining: number;
  total: number;
}

export function createPostFx(ctx: GameContext): PostFx {
  const { renderer, scene, camera } = ctx;
  const size = renderer.getSize(new Vector2());
  const w = size.x || window.innerWidth;
  const h = size.y || window.innerHeight;

  const composer = new EffectComposer(renderer);
  composer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new Vector2(w, h), 0.6, 0.4, 0.8);
  composer.addPass(bloom);

  const vignettePass = new ShaderPass(VignetteGradeShader);
  composer.addPass(vignettePass);

  // OutputPass handles tone mapping / sRGB conversion correctly when renderer uses linear workflow.
  composer.addPass(new OutputPass());

  const dark: FlashState = { active: false, peak: 0, remaining: 0, total: 0 };
  const bright: FlashState = { active: false, peak: 0, remaining: 0, total: 0 };

  return {
    composer,
    vignettePass,
    setSize(width: number, height: number) {
      composer.setSize(width, height);
      bloom.resolution.set(width, height);
    },
    triggerDarkFlash(strength: number, duration: number) {
      dark.active = true;
      dark.peak = strength;
      dark.remaining = duration;
      dark.total = duration;
    },
    triggerBrightFlash(strength: number, duration: number) {
      bright.active = true;
      bright.peak = strength;
      bright.remaining = duration;
      bright.total = duration;
    },
    update(realDt: number) {
      if (dark.active) {
        dark.remaining -= realDt;
        if (dark.remaining <= 0) {
          dark.active = false;
          vignettePass.uniforms.uDarkFlash.value = 0;
        } else {
          const t = dark.remaining / dark.total;
          vignettePass.uniforms.uDarkFlash.value = dark.peak * t;
        }
      }
      if (bright.active) {
        bright.remaining -= realDt;
        if (bright.remaining <= 0) {
          bright.active = false;
          vignettePass.uniforms.uBrightFlash.value = 0;
        } else {
          const t = bright.remaining / bright.total;
          vignettePass.uniforms.uBrightFlash.value = bright.peak * t;
        }
      }
    },
  };
}
