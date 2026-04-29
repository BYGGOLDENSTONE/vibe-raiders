// Synthesized SFX library. Every effect builds a short oscillator/noise graph,
// schedules an envelope, and stops itself so nodes can GC.

import type { AudioGraph } from './context';
import { gameState } from '../state';

const MAX_CONCURRENT = 24;
let activeCount = 0;

export interface SfxOpts {
  x?: number;
  z?: number;
}

// ---------- helpers --------------------------------------------------------

function noiseBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface VoiceSink {
  input: AudioNode;
  release: () => void;
}

// Build a per-SFX sink: panner → bus → compressor → master.
// Distance attenuation honored if x,z provided. Returns null if cap exceeded.
function makeVoice(g: AudioGraph, opts: SfxOpts, baseGain: number): VoiceSink | null {
  if (activeCount >= MAX_CONCURRENT) return null;
  activeCount++;

  const { ctx } = g;
  const out = ctx.createGain();

  let vol = 1;
  let pan = 0;
  if (opts.x !== undefined && opts.z !== undefined) {
    const p = gameState.player;
    if (p) {
      const dx = opts.x - p.object3d.position.x;
      const dz = opts.z - p.object3d.position.z;
      const dist = Math.hypot(dx, dz);
      vol = Math.max(0, Math.min(1, 1 - dist / 30));
      pan = Math.max(-1, Math.min(1, dx / 10));
    }
  }
  out.gain.value = baseGain * vol;

  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;

  out.connect(panner);
  panner.connect(g.sfxBus);

  let released = false;
  return {
    input: out,
    release: (): void => {
      if (released) return;
      released = true;
      activeCount = Math.max(0, activeCount - 1);
      // Disconnect on next tick — by then sources have stopped.
      setTimeout(() => {
        try { panner.disconnect(); } catch { /* */ }
        try { out.disconnect(); } catch { /* */ }
      }, 50);
    },
  };
}

function expEnv(param: AudioParam, ctx: AudioContext, attack: number, peak: number, decay: number): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(0.0001, now);
  param.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + attack);
  param.exponentialRampToValueAtTime(0.0001, now + attack + decay);
}

// ---------- individual SFX -------------------------------------------------

export function playHitLight(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.5);
  if (!v) return;
  const { ctx } = g;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.08);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 800;
  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.002, 1, 0.06);
  src.connect(hp);
  hp.connect(env);
  env.connect(v.input);
  src.start();
  src.stop(ctx.currentTime + 0.1);
  src.onended = v.release;
}

export function playHitHeavy(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.7);
  if (!v) return;
  const { ctx } = g;
  // Low rumble
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  const oscEnv = ctx.createGain();
  expEnv(oscEnv.gain, ctx, 0.005, 0.9, 0.16);
  osc.connect(lp);
  lp.connect(oscEnv);
  oscEnv.connect(v.input);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);

  // Transient noise
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.05);
  const nlp = ctx.createBiquadFilter();
  nlp.type = 'lowpass';
  nlp.frequency.value = 1200;
  const nEnv = ctx.createGain();
  expEnv(nEnv.gain, ctx, 0.001, 0.5, 0.04);
  n.connect(nlp);
  nlp.connect(nEnv);
  nEnv.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 0.06);

  osc.onended = v.release;
}

export function playHitMagic(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.55);
  if (!v) return;
  const { ctx } = g;
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(500, ctx.currentTime);
  carrier.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1);

  // Ringmod via a multiplier (gain modulated by another sine)
  const ringMod = ctx.createOscillator();
  ringMod.type = 'sine';
  ringMod.frequency.value = 80;
  const ringGain = ctx.createGain();
  ringGain.gain.value = 0;
  ringMod.connect(ringGain.gain);

  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.003, 0.8, 0.1);
  carrier.connect(ringGain);
  ringGain.connect(env);
  env.connect(v.input);

  carrier.start();
  ringMod.start();
  carrier.stop(ctx.currentTime + 0.12);
  ringMod.stop(ctx.currentTime + 0.12);
  carrier.onended = v.release;
}

export function playDeathMob(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.6);
  if (!v) return;
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.3);
  const oEnv = ctx.createGain();
  expEnv(oEnv.gain, ctx, 0.005, 0.9, 0.32);
  osc.connect(oEnv);
  oEnv.connect(v.input);
  osc.start();
  osc.stop(ctx.currentTime + 0.34);

  // Crackle tail
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.2);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500;
  bp.Q.value = 0.8;
  const nEnv = ctx.createGain();
  nEnv.gain.setValueAtTime(0.0001, ctx.currentTime);
  nEnv.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.1);
  nEnv.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
  n.connect(bp);
  bp.connect(nEnv);
  nEnv.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 0.32);

  osc.onended = v.release;
}

export function playPlayerHurt(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.7);
  if (!v) return;
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.18);
  const oEnv = ctx.createGain();
  expEnv(oEnv.gain, ctx, 0.005, 0.7, 0.2);
  osc.connect(oEnv);
  oEnv.connect(v.input);
  osc.start();
  osc.stop(ctx.currentTime + 0.22);

  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.1);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;
  const nEnv = ctx.createGain();
  expEnv(nEnv.gain, ctx, 0.002, 0.5, 0.08);
  n.connect(lp);
  lp.connect(nEnv);
  nEnv.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 0.1);

  osc.onended = v.release;
}

export function playLevelUp(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.45);
  if (!v) return;
  const { ctx } = g;
  // Ascending arpeggio: A4, C5, E5, A5
  const notes = [440, 523.25, 659.25, 880];
  notes.forEach((f, i) => {
    const t0 = ctx.currentTime + i * 0.08;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const harm = ctx.createOscillator();
    harm.type = 'triangle';
    harm.frequency.value = f * 2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.6, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    const harmEnv = ctx.createGain();
    harmEnv.gain.value = 0.2;
    osc.connect(env);
    harm.connect(harmEnv);
    harmEnv.connect(env);
    env.connect(v.input);
    osc.start(t0);
    harm.start(t0);
    osc.stop(t0 + 0.2);
    harm.stop(t0 + 0.2);
    if (i === notes.length - 1) osc.onended = v.release;
  });
}

export function playItemPickup(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.4);
  if (!v) return;
  const { ctx } = g;
  // Two slightly detuned sines = chorus
  const f = 880;
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * (i === 0 ? 1.0 : 1.005);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(env);
    env.connect(v.input);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    if (i === 1) osc.onended = v.release;
  }
}

function lootChime(g: AudioGraph, opts: SfxOpts, baseFreq: number, count: number, gain: number): void {
  const v = makeVoice(g, opts, gain);
  if (!v) return;
  const { ctx } = g;
  const intervals = [1.0, 1.25, 1.5, 2.0, 2.5];
  for (let i = 0; i < count; i++) {
    const t0 = ctx.currentTime + i * 0.06;
    const f = baseFreq * intervals[i % intervals.length];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    osc.connect(env);
    env.connect(v.input);
    osc.start(t0);
    osc.stop(t0 + 0.32);
    if (i === count - 1) osc.onended = v.release;
  }
}

export function playLootCommon(g: AudioGraph, opts: SfxOpts): void {
  lootChime(g, opts, 660, 1, 0.3);
}
export function playLootMagic(g: AudioGraph, opts: SfxOpts): void {
  lootChime(g, opts, 660, 2, 0.4);
}
export function playLootRare(g: AudioGraph, opts: SfxOpts): void {
  lootChime(g, opts, 880, 3, 0.5);
}
export function playLootLegendary(g: AudioGraph, opts: SfxOpts): void {
  lootChime(g, opts, 1100, 5, 0.6);
}

export function playSkillCdBlocked(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.4);
  if (!v) return;
  const { ctx } = g;
  for (let i = 0; i < 2; i++) {
    const t0 = ctx.currentTime + i * 0.06;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 100;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.4, t0 + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    osc.connect(env);
    env.connect(v.input);
    osc.start(t0);
    osc.stop(t0 + 0.04);
    if (i === 1) osc.onended = v.release;
  }
}

export function playSkillNoResource(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.4);
  if (!v) return;
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(330, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.25);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1200;
  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.005, 0.6, 0.27);
  osc.connect(lp);
  lp.connect(env);
  env.connect(v.input);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
  osc.onended = v.release;
}

export function playBossIntro(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.85);
  if (!v) return;
  const { ctx } = g;
  // Deep bass impact
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, ctx.currentTime);
  sub.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.5);
  const subEnv = ctx.createGain();
  expEnv(subEnv.gain, ctx, 0.01, 1.0, 1.5);
  sub.connect(subEnv);
  subEnv.connect(v.input);
  sub.start();
  sub.stop(ctx.currentTime + 1.6);

  // Reverse cymbal swell — noise with rising LP filter
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 1.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(200, ctx.currentTime);
  lp.frequency.exponentialRampToValueAtTime(8000, ctx.currentTime + 1.4);
  const nEnv = ctx.createGain();
  nEnv.gain.setValueAtTime(0.0001, ctx.currentTime);
  nEnv.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.4);
  nEnv.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
  n.connect(lp);
  lp.connect(nEnv);
  nEnv.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 1.55);

  sub.onended = v.release;
}

export function playBossDeath(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.9);
  if (!v) return;
  const { ctx } = g;
  // Long boom
  const boom = ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(120, ctx.currentTime);
  boom.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 1.5);
  const bEnv = ctx.createGain();
  expEnv(bEnv.gain, ctx, 0.01, 1.0, 1.6);
  boom.connect(bEnv);
  bEnv.connect(v.input);
  boom.start();
  boom.stop(ctx.currentTime + 1.7);

  // Crashing cymbal (white noise hp filtered)
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 1.2);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const nEnv = ctx.createGain();
  expEnv(nEnv.gain, ctx, 0.01, 0.6, 1.1);
  n.connect(hp);
  hp.connect(nEnv);
  nEnv.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 1.2);

  boom.onended = v.release;
}

export function playFootstep(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.2);
  if (!v) return;
  const { ctx } = g;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.06);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 400;
  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.003, 0.5, 0.05);
  n.connect(lp);
  lp.connect(env);
  env.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 0.07);
  n.onended = v.release;
}

export function playFireballLaunch(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.45);
  if (!v) return;
  const { ctx } = g;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.25);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(400, ctx.currentTime);
  bp.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.2);
  bp.Q.value = 1.5;
  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.005, 0.7, 0.22);
  n.connect(bp);
  bp.connect(env);
  env.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 0.26);
  n.onended = v.release;
}

export function playExplosion(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.7);
  if (!v) return;
  const { ctx } = g;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.6);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2000, ctx.currentTime);
  lp.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.5);
  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.005, 1.0, 0.55);
  n.connect(lp);
  lp.connect(env);
  env.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 0.6);

  // Sub-bass thud
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, ctx.currentTime);
  sub.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.2);
  const sEnv = ctx.createGain();
  expEnv(sEnv.gain, ctx, 0.005, 0.8, 0.25);
  sub.connect(sEnv);
  sEnv.connect(v.input);
  sub.start();
  sub.stop(ctx.currentTime + 0.3);

  n.onended = v.release;
}

export function playSkillWhoosh(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.35);
  if (!v) return;
  const { ctx } = g;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 0.2);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(800, ctx.currentTime);
  bp.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 0.18);
  bp.Q.value = 1.2;
  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.005, 0.6, 0.18);
  n.connect(bp);
  bp.connect(env);
  env.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 0.22);
  n.onended = v.release;
}

export function playPlayerDeath(g: AudioGraph, opts: SfxOpts): void {
  const v = makeVoice(g, opts, 0.85);
  if (!v) return;
  const { ctx } = g;
  // Deep ominous downsweep
  const o1 = ctx.createOscillator();
  o1.type = 'sawtooth';
  o1.frequency.setValueAtTime(180, ctx.currentTime);
  o1.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 1.2);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  const env = ctx.createGain();
  expEnv(env.gain, ctx, 0.01, 0.9, 1.3);
  o1.connect(lp);
  lp.connect(env);
  env.connect(v.input);
  o1.start();
  o1.stop(ctx.currentTime + 1.4);

  // Tail noise wash
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 1.2);
  const nlp = ctx.createBiquadFilter();
  nlp.type = 'lowpass';
  nlp.frequency.value = 300;
  const nEnv = ctx.createGain();
  expEnv(nEnv.gain, ctx, 0.05, 0.4, 1.1);
  n.connect(nlp);
  nlp.connect(nEnv);
  nEnv.connect(v.input);
  n.start();
  n.stop(ctx.currentTime + 1.3);

  o1.onended = v.release;
}

// ---------- dispatcher -----------------------------------------------------

export const SFX_HANDLERS: Record<string, (g: AudioGraph, opts: SfxOpts) => void> = {
  'hit-light': playHitLight,
  'hit-heavy': playHitHeavy,
  'hit-magic': playHitMagic,
  'death-mob': playDeathMob,
  'player-hurt': playPlayerHurt,
  'player-death': playPlayerDeath,
  'levelup': playLevelUp,
  'item-pickup': playItemPickup,
  'loot-drop-common': playLootCommon,
  'loot-drop-magic': playLootMagic,
  'loot-drop-rare': playLootRare,
  'loot-drop-legendary': playLootLegendary,
  'skill-cd-blocked': playSkillCdBlocked,
  'skill-no-resource': playSkillNoResource,
  'boss-intro': playBossIntro,
  'boss-death': playBossDeath,
  'footstep': playFootstep,
  'fireball-launch': playFireballLaunch,
  'explosion': playExplosion,
  'skill-whoosh': playSkillWhoosh,
};

export function dispatchSfx(g: AudioGraph, id: string, opts: SfxOpts): void {
  const fn = SFX_HANDLERS[id];
  if (!fn) return; // silently ignore unknown
  try {
    fn(g, opts);
  } catch {
    // never let a synth bug kill the game
  }
}
