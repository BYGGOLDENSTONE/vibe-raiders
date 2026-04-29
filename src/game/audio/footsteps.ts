// Procedural footsteps. Detect player position delta per frame; emit a step SFX
// every ~0.45 m of accumulated travel. Variants per surface (graveyard / dungeon).
//
// Persistent oscillator-free design — each step builds short-lived nodes, releases
// after envelope completes.

import type { AudioGraph } from './context';
import { gameState } from '../state';

const STEP_DISTANCE = 0.45; // meters per step
let lastX = 0;
let lastZ = 0;
let lastInit = false;
let accum = 0;
let altFoot = false; // alternate left/right pan & micro-pitch jitter

function noiseShortBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface SurfaceSpec {
  bassFreq: number;
  bassDecay: number;
  noiseHpFreq: number;
  noiseDecay: number;
  noiseGain: number;
}

const SURFACES: Record<'graveyard' | 'dungeon', SurfaceSpec> = {
  // Soft soil + pebble click
  graveyard: {
    bassFreq: 80,
    bassDecay: 0.06,
    noiseHpFreq: 2000,
    noiseDecay: 0.04,
    noiseGain: 0.3,
  },
  // Stone slap with longer tail
  dungeon: {
    bassFreq: 60,
    bassDecay: 0.08,
    noiseHpFreq: 2400,
    noiseDecay: 0.09,
    noiseGain: 0.5,
  },
};

function pickSurface(): SurfaceSpec {
  const z = gameState.currentZone;
  if (z === 'dungeon') return SURFACES.dungeon;
  return SURFACES.graveyard;
}

function spawnStep(g: AudioGraph, surface: SurfaceSpec, pan: number): void {
  const { ctx, sfxBus } = g;
  const t0 = ctx.currentTime;

  // Master per-step gain (low overall volume per spec).
  const out = ctx.createGain();
  out.gain.value = 0.08;

  const stereo = ctx.createStereoPanner();
  stereo.pan.value = Math.max(-0.6, Math.min(0.6, pan));

  out.connect(stereo);
  stereo.connect(sfxBus);

  // ---- Bass thump (short sine at bassFreq, exp decay) ----
  const bass = ctx.createOscillator();
  bass.type = 'sine';
  // Tiny pitch jitter per foot for variation
  const jitter = (Math.random() * 6) - 3; // ±3 Hz
  bass.frequency.setValueAtTime(surface.bassFreq + jitter, t0);
  bass.frequency.exponentialRampToValueAtTime(Math.max(20, surface.bassFreq * 0.5), t0 + surface.bassDecay);
  const bassEnv = ctx.createGain();
  bassEnv.gain.setValueAtTime(0.0001, t0);
  bassEnv.gain.exponentialRampToValueAtTime(0.7, t0 + 0.005);
  bassEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + surface.bassDecay);
  bass.connect(bassEnv);
  bassEnv.connect(out);
  bass.start(t0);
  bass.stop(t0 + surface.bassDecay + 0.02);

  // ---- Noise click (HP-filtered burst) ----
  const noiseDur = surface.noiseDecay + 0.01;
  const n = ctx.createBufferSource();
  n.buffer = noiseShortBuffer(ctx, noiseDur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = surface.noiseHpFreq;
  const nEnv = ctx.createGain();
  nEnv.gain.setValueAtTime(0.0001, t0);
  nEnv.gain.exponentialRampToValueAtTime(surface.noiseGain, t0 + 0.003);
  nEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + surface.noiseDecay);
  n.connect(hp);
  hp.connect(nEnv);
  nEnv.connect(out);
  n.start(t0);
  n.stop(t0 + noiseDur);

  // GC after the longest tail.
  const releaseAfter = Math.max(surface.bassDecay, surface.noiseDecay) + 0.05;
  bass.onended = (): void => {
    setTimeout(() => {
      try { bass.disconnect(); } catch { /* */ }
      try { bassEnv.disconnect(); } catch { /* */ }
      try { n.disconnect(); } catch { /* */ }
      try { hp.disconnect(); } catch { /* */ }
      try { nEnv.disconnect(); } catch { /* */ }
      try { out.disconnect(); } catch { /* */ }
      try { stereo.disconnect(); } catch { /* */ }
    }, Math.max(0, (releaseAfter * 1000) | 0));
  };
}

export function tickFootsteps(g: AudioGraph): void {
  if (gameState.paused) return;
  const player = gameState.player;
  if (!player || !player.alive) {
    lastInit = false;
    accum = 0;
    return;
  }
  const p = player.object3d.position;
  if (!lastInit) {
    lastX = p.x;
    lastZ = p.z;
    lastInit = true;
    return;
  }
  const dx = p.x - lastX;
  const dz = p.z - lastZ;
  const d = Math.hypot(dx, dz);
  lastX = p.x;
  lastZ = p.z;

  if (d < 1e-4) return; // not moving

  accum += d;
  if (accum >= STEP_DISTANCE) {
    accum -= STEP_DISTANCE;
    const surface = pickSurface();
    altFoot = !altFoot;
    const pan = altFoot ? 0.18 : -0.18;
    spawnStep(g, surface, pan);
  }
}
