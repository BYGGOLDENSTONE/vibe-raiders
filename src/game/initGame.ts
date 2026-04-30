// initGame — the one place every wave hooks itself in. Called from main.ts after
// scaffolding (scene, world, multiplayer, portal) is wired.
//
// Wave 0 only sets up the post-processing render hook. Subsequent waves register
// their systems / scene additions / UI panels here, ordered so that contracts
// are available before consumers run.

import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { HalfFloatType } from 'three';
import type { GameContext } from './state';

export function initGame(ctx: GameContext): void {
  setupPostprocessing(ctx);
  // Future: initGalaxy(ctx)  — Wave 1
  //         initEconomy(ctx) — Wave 2
  //         initUI(ctx)      — Wave 3
  //         …
}

function setupPostprocessing(ctx: GameContext): void {
  const composer = new EffectComposer(ctx.renderer, { frameBufferType: HalfFloatType });
  composer.addPass(new RenderPass(ctx.scene, ctx.camera));

  const bloom = new SelectiveBloomEffect(ctx.scene, ctx.camera, {
    mipmapBlur: true,
    luminanceThreshold: 0.85,
    luminanceSmoothing: 0.2,
    intensity: 1.2,
    radius: 0.7,
  });
  // Wave 0: bloom selection is empty. Wave 1+ adds emissive meshes (planets, wormhole)
  // via composer.passes... or by exposing a helper. For now we rely on the global
  // luminance threshold so existing content (gold portal) catches the bloom.
  bloom.inverted = false;

  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const smaa = new SMAAEffect();

  composer.addPass(new EffectPass(ctx.camera, bloom, tone, smaa));

  ctx.renderHook = () => composer.render();
  ctx.resizeHook = (w, h) => composer.setSize(w, h);

  console.log('[initGame] postprocessing chain ready (bloom + ACES + SMAA)');
}
