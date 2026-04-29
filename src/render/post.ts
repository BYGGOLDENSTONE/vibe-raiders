// Post-processing pipeline.
// Bloom for emissive glow (fires, neon, lights), film grain for texture/atmosphere,
// vignette for cinematic framing, subtle chromatic aberration on edges.
//
// All passes are intentionally restrained — the world should still feel readable.
// Tune knobs via the `params` object on the returned controller.

import type { WebGLRenderer, Scene, PerspectiveCamera } from 'three';
import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface PostParams {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  grainStrength: number;
  vignetteStrength: number;
  vignetteRadius: number;
  chromaticStrength: number;
}

export interface PostPipeline {
  composer: EffectComposer;
  params: PostParams;
  render: () => void;
  resize: (w: number, h: number) => void;
  setEnabled: (b: boolean) => void;
  isEnabled: () => boolean;
}

const FILM_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown as null | object },
    uTime: { value: 0 },
    uGrain: { value: 0.07 },
    uVignette: { value: 1.05 },
    uVignetteRadius: { value: 0.78 },
    uChromatic: { value: 0.0018 },
    uResolution: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uVignetteRadius;
    uniform float uChromatic;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 toCenter = uv - 0.5;
      float dist = length(toCenter);

      // Chromatic aberration — radial, stronger at edges
      vec2 caOffset = toCenter * uChromatic * (0.5 + dist);
      vec3 color;
      color.r = texture2D(tDiffuse, uv + caOffset).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - caOffset).b;

      // Film grain — animated noise, additive
      float n = hash(uv * uResolution + uTime * 60.0) - 0.5;
      color += n * uGrain;

      // Vignette — soft falloff, multiplied (darken edges)
      float vig = smoothstep(uVignetteRadius, uVignetteRadius - 0.45, dist);
      color *= mix(1.0, vig, uVignette - 1.0 + 1.0);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export function createPostPipeline(opts: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  initialParams?: Partial<PostParams>;
}): PostPipeline {
  const { renderer, scene, camera } = opts;

  const params: PostParams = {
    bloomStrength: 0.55,
    bloomRadius: 0.55,
    bloomThreshold: 0.85,
    grainStrength: 0.0,
    vignetteStrength: 1.10,
    vignetteRadius: 0.78,
    chromaticStrength: 0.0012,
    ...opts.initialParams,
  };

  const size = new Vector2();
  renderer.getSize(size);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(
    new Vector2(size.x, size.y),
    params.bloomStrength,
    params.bloomRadius,
    params.bloomThreshold,
  );
  composer.addPass(bloom);

  const film = new ShaderPass(FILM_SHADER);
  film.uniforms.uGrain.value = params.grainStrength;
  film.uniforms.uVignette.value = params.vignetteStrength;
  film.uniforms.uVignetteRadius.value = params.vignetteRadius;
  film.uniforms.uChromatic.value = params.chromaticStrength;
  (film.uniforms.uResolution.value as Vector2).set(size.x, size.y);
  composer.addPass(film);

  const output = new OutputPass();
  composer.addPass(output);

  let enabled = true;
  const startTime = performance.now();

  function syncParams(): void {
    bloom.strength = params.bloomStrength;
    bloom.radius = params.bloomRadius;
    bloom.threshold = params.bloomThreshold;
    film.uniforms.uGrain.value = params.grainStrength;
    film.uniforms.uVignette.value = params.vignetteStrength;
    film.uniforms.uVignetteRadius.value = params.vignetteRadius;
    film.uniforms.uChromatic.value = params.chromaticStrength;
  }

  return {
    composer,
    params,
    render: () => {
      if (enabled) {
        film.uniforms.uTime.value = (performance.now() - startTime) / 1000;
        syncParams();
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
    resize: (w: number, h: number) => {
      composer.setSize(w, h);
      bloom.setSize(w, h);
      (film.uniforms.uResolution.value as Vector2).set(w, h);
    },
    setEnabled: (b: boolean) => { enabled = b; },
    isEnabled: () => enabled,
  };
}
