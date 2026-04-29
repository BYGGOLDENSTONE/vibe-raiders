// FX module: post-processing, screenshake, hit-stop, particles, floating text, skill rings.
// Subscribes to fx:* / damage:* / entity:died / mob:killed / level:up / skill:cast.
//
// Runs its own rAF tick so screenshake / hit-stop / particles / FX progress in real-time
// even when world.tick is paused (timeScale near 0). main.ts uses ctx.renderHook to render
// the post-processing composer instead of renderer.render directly.

import type { GameContext } from '../state';
import { gameState } from '../state';
import { COLORS } from '../constants';
import { createPostFx } from './postprocessing';
import { createScreenShake } from './screenshake';
import { createHitStop } from './hitstop';
import { createParticleSystem } from './particles';
import { createFloatingText } from './floatingText';
import { createSkillRingFx } from './skillRing';
import { createTrailPool, type TrailPool } from './trails';
import { createDecalSystem, type DecalSystem } from './decals';

// Singleton handles — populated by initFx, read by skills/index.ts via getters.
// (We don't add new EventMap entries; skills calls these directly.)
let _trails: TrailPool | null = null;
let _decals: DecalSystem | null = null;

export function getTrailPool(): TrailPool | null {
  return _trails;
}
export function getDecalSystem(): DecalSystem | null {
  return _decals;
}

export type { TrailPool } from './trails';
export type { DecalSystem } from './decals';

export function initFx(ctx: GameContext): void {
  const { world, scene, camera, uiRoot } = ctx;

  const post = createPostFx(ctx);
  const shake = createScreenShake();
  const hitstop = createHitStop();
  const particles = createParticleSystem(scene);
  const floating = createFloatingText(uiRoot);
  const rings = createSkillRingFx(scene);
  const trails = createTrailPool(scene);
  const decals = createDecalSystem(scene);

  _trails = trails;
  _decals = decals;

  // Composer drives rendering from now on.
  ctx.renderHook = () => post.composer.render();

  // ───────────── Resize handling ─────────────
  const handleResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    post.setSize(w, h);
  };
  window.addEventListener('resize', handleResize);

  // ───────────── Event subscriptions ─────────────

  world.on('fx:screenshake', ({ amplitude, duration }) => {
    shake.add(amplitude, duration);
  });

  world.on('fx:hitstop', ({ duration }) => {
    hitstop.trigger(duration);
  });

  world.on('fx:hit', ({ x, y, z, color, isCrit }) => {
    particles.emitHit(x, y, z, color, isCrit);
    if (isCrit) shake.add(0.18, 0.18);
  });

  world.on('fx:floatingText', ({ x, y, z, text, color }) => {
    // Magnitude inferred from numeric text length for size scaling.
    const n = parseFloat(text);
    const mag = Number.isFinite(n)
      ? Math.min(1.5, Math.max(0.4, Math.log10(Math.max(1, Math.abs(n))) / 2 + 0.4))
      : 0.6;
    floating.spawn(x, y, z, text, color, mag);
  });

  // Damage cue — let combat already emit fx:hit/fx:floatingText if it wants;
  // we additionally bump a tiny shake on every damage tick for kinaesthetic feel.
  world.on('damage:dealt', ({ amount, isCrit }) => {
    if (amount <= 0) return;
    shake.add(isCrit ? 0.12 : 0.04, isCrit ? 0.12 : 0.06);
  });

  world.on('entity:died', ({ entityId }) => {
    const e = world.get(entityId);
    if (!e) return;
    const p = e.object3d.position;
    particles.emitDeathPuff(p.x, p.y, p.z);
    shake.add(0.15, 0.18);

    // Player death — darker flash and longer.
    const playerEnt = gameState.player;
    if (playerEnt && playerEnt.id === entityId) {
      post.triggerDarkFlash(0.85, 1.2);
      shake.add(0.4, 0.5);
    }
  });

  world.on('mob:killed', ({ entityId }) => {
    // Slight extra crunch on kill confirmation (independent of generic entity:died).
    const e = world.get(entityId);
    if (!e) return;
    hitstop.trigger(0.04);
  });

  world.on('level:up', ({ entityId }) => {
    const e = world.get(entityId);
    if (!e) return;
    const p = e.object3d.position;
    particles.emitLevelUp(p.x, p.y, p.z);
    post.triggerBrightFlash(0.5, 0.45);
    shake.add(0.2, 0.35);
  });

  world.on('skill:cast', ({ casterId, targetX, targetZ }) => {
    const caster = world.get(casterId);
    if (!caster) return;
    const p = caster.object3d.position;
    rings.spawn(p.x, p.y, p.z, COLORS.ui.accent);
    particles.emitSkillCast(p.x, p.y, p.z, COLORS.ui.accent);
    // Tiny telegraph at the target as well.
    rings.spawn(targetX, p.y, targetZ, COLORS.loot.magic);
    shake.add(0.06, 0.1);
  });

  // ───────────── Real-time FX tick ─────────────
  // Independent of world tick — must keep running through hit-stop.
  let lastTime = performance.now();
  const tick = () => {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    hitstop.update();
    shake.update(realDt, camera);
    particles.update(realDt);
    rings.update(realDt);
    trails.update(realDt);
    decals.update(realDt);
    post.update(realDt);

    floating.update(realDt, camera, window.innerWidth, window.innerHeight);

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
