// Procedural ambient: 3-layer drone (deep pad + mid bell strikes + high airy whisper).
// Zone-aware retuning. Combat-reactive sub-bass thrum on top of the base mix.
//
// All persistent oscillators are created once and reused; per-event spawns
// (bells, combat thrum hits) build short-lived nodes and disconnect after release
// so the GC can reclaim them.

import type { AudioGraph } from './context';
import { gameState } from '../state';

interface AmbientGraph {
  // ---------- Layer 1: Deep pad ----------
  deepBus: GainNode;
  deepLp: BiquadFilterNode;
  deepLfo: OscillatorNode;
  deepLfoGain: GainNode;
  deepOscs: OscillatorNode[];

  // ---------- Layer 2: Mid bell strikes ----------
  bellBus: GainNode;
  bellReverb: ConvolverNode;
  bellSendDry: GainNode;
  bellSendWet: GainNode;
  nextBellTime: number;

  // ---------- Layer 3: High airy whisper ----------
  airyBus: GainNode;
  airyLfo: OscillatorNode;
  airyLfoGain: GainNode;
  airyNoiseSrc: AudioBufferSourceNode;
  airyHp: BiquadFilterNode;
  airyBp: BiquadFilterNode;

  // ---------- Combat-reactive sub thrum ----------
  combatBus: GainNode;
  combatOsc: OscillatorNode;
  combatLp: BiquadFilterNode;
  combatLfoGain: GainNode;
  nextCombatPulse: number;

  // ---------- State ----------
  baseFreq: number;
  zoneTone: ZoneTone;
}

type ZoneTone = 'graveyard' | 'dungeon' | 'hub';

interface ZoneToneSpec {
  // Deep pad fundamental + cutoff
  deepFreq: number;
  deepCutoff: number;
  deepLfoRate: number;
  // Bell harmonic root
  bellRoot: number;
  // Bell scale (semitone offsets from root)
  bellScale: number[];
  // Airy bandpass center
  airyBpFreq: number;
}

const TONE_SPECS: Record<ZoneTone, ZoneToneSpec> = {
  // Graveyard: minor key, slow movement
  graveyard: {
    deepFreq: 55,
    deepCutoff: 200,
    deepLfoRate: 0.05,
    bellRoot: 196, // G3
    bellScale: [0, 3, 7, 10], // minor 7
    airyBpFreq: 3500,
  },
  // Dungeon: dissonant cluster, lower fundamental
  dungeon: {
    deepFreq: 41, // E1
    deepCutoff: 160,
    deepLfoRate: 0.035,
    bellRoot: 185, // F#3
    bellScale: [0, 1, 6, 11], // dissonant cluster (b2, tritone, M7)
    airyBpFreq: 2400,
  },
  // Hub: brighter
  hub: {
    deepFreq: 65, // C2
    deepCutoff: 240,
    deepLfoRate: 0.06,
    bellRoot: 220, // A3
    bellScale: [0, 4, 7, 12], // major triad + oct
    airyBpFreq: 4200,
  },
};

let ambient: AmbientGraph | null = null;
let lastCombatTime = -Infinity;
let currentZone: string = 'open-world';
let lastTone: ZoneTone = 'graveyard';

// ---------------------------------------------------------------------------

function noiseLoopBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Cheap convolution IR (decaying noise) for bell tail reverb.
function makeBellReverbIR(ctx: AudioContext, durSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Exponential decay with random texture
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.0);
    }
  }
  return buf;
}

function zoneToTone(zone: string): ZoneTone {
  if (zone === 'dungeon' || zone === 'dungeon-1') return 'dungeon';
  if (zone === 'hub') return 'hub';
  return 'graveyard';
}

// ---------------------------------------------------------------------------

export function initAmbient(g: AudioGraph): void {
  if (ambient) return;
  const { ctx, ambientBus } = g;
  const t = ctx.currentTime;

  // ============================================================
  // Layer 1 — Deep pad (50–80 Hz, 3 detuned saws → LP@200Hz Q=4)
  // ============================================================
  const deepBus = ctx.createGain();
  deepBus.gain.value = 0.25;
  deepBus.connect(ambientBus);

  const deepLp = ctx.createBiquadFilter();
  deepLp.type = 'lowpass';
  deepLp.frequency.value = 200;
  deepLp.Q.value = 4;
  deepLp.connect(deepBus);

  const deepLfo = ctx.createOscillator();
  deepLfo.type = 'sine';
  deepLfo.frequency.value = 0.05;
  const deepLfoGain = ctx.createGain();
  deepLfoGain.gain.value = 80; // ±80 Hz around base cutoff
  deepLfo.connect(deepLfoGain);
  deepLfoGain.connect(deepLp.frequency);
  deepLfo.start();

  const deepOscs: OscillatorNode[] = [];
  const detunes = [-9, 0, 7];
  for (const d of detunes) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    o.detune.value = d;
    o.connect(deepLp);
    o.start();
    deepOscs.push(o);
  }

  // ============================================================
  // Layer 2 — Mid bell strikes (200–400 Hz, sparse triggers)
  // ============================================================
  const bellBus = ctx.createGain();
  bellBus.gain.value = 1.0;
  bellBus.connect(ambientBus);

  // Reverb send/return
  const bellReverb = ctx.createConvolver();
  bellReverb.buffer = makeBellReverbIR(ctx, 2.0);
  const bellSendDry = ctx.createGain();
  bellSendDry.gain.value = 0.6;
  const bellSendWet = ctx.createGain();
  bellSendWet.gain.value = 0.55;
  bellReverb.connect(bellSendWet);
  bellSendDry.connect(bellBus);
  bellSendWet.connect(bellBus);

  // ============================================================
  // Layer 3 — High airy whisper (filtered noise, slow LFO amp)
  // ============================================================
  const airyBus = ctx.createGain();
  airyBus.gain.value = 0.0001;
  airyBus.connect(ambientBus);

  const airyNoiseSrc = ctx.createBufferSource();
  airyNoiseSrc.buffer = noiseLoopBuffer(ctx, 8);
  airyNoiseSrc.loop = true;

  const airyHp = ctx.createBiquadFilter();
  airyHp.type = 'highpass';
  airyHp.frequency.value = 2000;
  const airyBp = ctx.createBiquadFilter();
  airyBp.type = 'bandpass';
  airyBp.frequency.value = 3500;
  airyBp.Q.value = 0.7;

  airyNoiseSrc.connect(airyHp);
  airyHp.connect(airyBp);
  airyBp.connect(airyBus);
  airyNoiseSrc.start();

  // Slow amplitude LFO on airy bus (depth 0.7 around 0.08 base = 0.024..0.136)
  const airyLfo = ctx.createOscillator();
  airyLfo.type = 'sine';
  airyLfo.frequency.value = 0.1;
  const airyLfoGain = ctx.createGain();
  airyLfoGain.gain.value = 0.056; // 0.08 * 0.7
  airyLfo.connect(airyLfoGain);
  airyLfoGain.connect(airyBus.gain);
  // Set base offset (ramp from 0)
  airyBus.gain.cancelScheduledValues(t);
  airyBus.gain.setValueAtTime(0.0001, t);
  airyBus.gain.exponentialRampToValueAtTime(0.08, t + 4);
  airyLfo.start();

  // ============================================================
  // Combat reactive — rhythmic sub-bass thrum (60 Hz @ 120 BPM, half-swing)
  // Persistent osc, gain pulsed by trigger spawns.
  // ============================================================
  const combatBus = ctx.createGain();
  combatBus.gain.value = 0.0001;
  combatBus.connect(ambientBus);

  const combatOsc = ctx.createOscillator();
  combatOsc.type = 'sine';
  combatOsc.frequency.value = 60;
  const combatLp = ctx.createBiquadFilter();
  combatLp.type = 'lowpass';
  combatLp.frequency.value = 140;
  combatOsc.connect(combatLp);
  combatLp.connect(combatBus);
  combatOsc.start();

  // Tremolo LFO modulating combat bus (gives the pulse "thrum" feel)
  const combatLfo = ctx.createOscillator();
  combatLfo.type = 'sine';
  combatLfo.frequency.value = 4; // 4 Hz tremolo (subtle)
  const combatLfoGain = ctx.createGain();
  combatLfoGain.gain.value = 0; // off until combat
  combatLfo.connect(combatLfoGain);
  combatLfoGain.connect(combatBus.gain);
  combatLfo.start();

  ambient = {
    deepBus,
    deepLp,
    deepLfo,
    deepLfoGain,
    deepOscs,
    bellBus,
    bellReverb,
    bellSendDry,
    bellSendWet,
    nextBellTime: t + 4 + Math.random() * 4,
    airyBus,
    airyLfo,
    airyLfoGain,
    airyNoiseSrc,
    airyHp,
    airyBp,
    combatBus,
    combatOsc,
    combatLp,
    combatLfoGain,
    nextCombatPulse: 0,
    baseFreq: 55,
    zoneTone: 'graveyard',
  };

  // Slow fade-in for the deep pad too (avoid pop on boot).
  deepBus.gain.cancelScheduledValues(t);
  deepBus.gain.setValueAtTime(0.0001, t);
  deepBus.gain.exponentialRampToValueAtTime(0.25, t + 3);
}

// ---------------------------------------------------------------------------
// Bell strike (per-trigger transient build)

function pickBellFreq(spec: ZoneToneSpec): number {
  const semi = spec.bellScale[Math.floor(Math.random() * spec.bellScale.length)];
  // 70% same octave, 30% one up
  const oct = Math.random() < 0.7 ? 0 : 1;
  return spec.bellRoot * Math.pow(2, (semi + 12 * oct) / 12);
}

function spawnBell(g: AudioGraph): void {
  if (!ambient) return;
  const spec = TONE_SPECS[ambient.zoneTone];
  const { ctx } = g;
  const t0 = ctx.currentTime;
  const f = pickBellFreq(spec);

  // Triangle osc with sharp envelope (5ms attack, 1.5s exp release).
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = f;
  // Slight inharmonic shimmer at 3.01x
  const harm = ctx.createOscillator();
  harm.type = 'sine';
  harm.frequency.value = f * 3.01;
  const harmGain = ctx.createGain();
  harmGain.gain.value = 0.18;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.15, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);

  // Random stereo pan
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() - 0.5) * 1.6;

  osc.connect(env);
  harm.connect(harmGain);
  harmGain.connect(env);
  env.connect(pan);
  // Send to dry + reverb
  pan.connect(ambient.bellSendDry);
  pan.connect(ambient.bellReverb);

  osc.start(t0);
  harm.start(t0);
  osc.stop(t0 + 1.6);
  harm.stop(t0 + 1.6);
  // GC after release
  osc.onended = (): void => {
    try { osc.disconnect(); } catch { /* */ }
    try { harm.disconnect(); } catch { /* */ }
    try { harmGain.disconnect(); } catch { /* */ }
    try { env.disconnect(); } catch { /* */ }
    try { pan.disconnect(); } catch { /* */ }
  };
}

// ---------------------------------------------------------------------------
// Combat thrum gating

function setCombatGain(target: number, time: number, tau: number): void {
  if (!ambient) return;
  ambient.combatBus.gain.cancelScheduledValues(time);
  ambient.combatBus.gain.setTargetAtTime(target, time, tau);
  // When combat is on, bring tremolo depth up; off → 0
  const tremDepth = target > 0.05 ? Math.min(0.06, target * 0.4) : 0;
  ambient.combatLfoGain.gain.setTargetAtTime(tremDepth, time, tau);
}

// ---------------------------------------------------------------------------
// Public API

export function notifyCombat(g: AudioGraph): void {
  if (!ambient) return;
  lastCombatTime = g.ctx.currentTime;
}

export function notifyZone(g: AudioGraph, zone: string): void {
  if (!ambient) return;
  if (zone === currentZone) return;
  currentZone = zone;

  const tone = zoneToTone(zone);
  if (tone === lastTone && ambient.zoneTone === tone) return;
  lastTone = tone;
  ambient.zoneTone = tone;

  const spec = TONE_SPECS[tone];
  const { ctx } = g;
  const t = ctx.currentTime;

  // Retune deep pad
  for (let i = 0; i < ambient.deepOscs.length; i++) {
    const o = ambient.deepOscs[i];
    o.frequency.cancelScheduledValues(t);
    o.frequency.setTargetAtTime(spec.deepFreq, t, 1.5);
  }
  ambient.deepLfo.frequency.setTargetAtTime(spec.deepLfoRate, t, 1.5);
  ambient.deepLp.frequency.cancelScheduledValues(t);
  ambient.deepLp.frequency.setTargetAtTime(spec.deepCutoff, t, 1.5);
  ambient.baseFreq = spec.deepFreq;

  // Retune airy bandpass
  ambient.airyBp.frequency.setTargetAtTime(spec.airyBpFreq, t, 2.0);
}

export function tickAmbient(g: AudioGraph): void {
  if (!ambient) return;
  if (gameState.paused) {
    // Hard-mute bell + combat triggers while paused; persistent oscs keep humming
    // at very low level. We don't suspend the context so resume is instant.
    return;
  }
  const t = g.ctx.currentTime;

  // Bell strikes every 8–15s
  if (t >= ambient.nextBellTime) {
    spawnBell(g);
    ambient.nextBellTime = t + 8 + Math.random() * 7;
  }

  // Combat layer (peak 0.18 active, fade off)
  const inCombat = (t - lastCombatTime) < 5;
  if (inCombat) {
    setCombatGain(0.18, t, 0.4);
  } else {
    setCombatGain(0.0001, t, 0.5);
  }
}

export function getAmbientZoneTone(): ZoneTone | null {
  return ambient ? ambient.zoneTone : null;
}
