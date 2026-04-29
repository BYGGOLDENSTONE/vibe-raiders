// Procedural boss music — 30s loop with phase-2 intensity ramp.
// Driven by 'audio:sfx' boss-intro / boss-scream (phase2) / boss-death events
// (boss/index.ts emits these via world.emit('audio:sfx', ...)).
//
// Layers:
//   • Pad arpeggio: minor 7th (A2-C3-E3-G3) at 1.5s/note
//   • Kick drum 4/4 @ 100 BPM (sine 60Hz + click)
//   • Distorted lead: pulse wave + chorus + reverb send, minor scale random walk
// Phase 2:
//   • Tempo +20% (BPM 120)
//   • Distortion gain x2
//   • Sub-bass (40Hz pulse)
//   • Lead reverb send reduced (drier)

import type { AudioGraph } from './context';
import { gameState } from '../state';

interface BossMusicGraph {
  // Master bus
  bus: GainNode;
  // Pad arpeggio
  padBus: GainNode;
  padOscs: OscillatorNode[];
  padGains: GainNode[];
  // Kick drum (per-hit transient build, no persistent osc)
  kickBus: GainNode;
  // Lead
  leadBus: GainNode;
  leadDist: WaveShaperNode;
  leadDistAmount: number;
  leadReverb: ConvolverNode;
  leadDry: GainNode;
  leadWet: GainNode;
  leadOsc: OscillatorNode;
  leadGain: GainNode;
  leadFilter: BiquadFilterNode;
  // Sub-bass (phase 2 only)
  subBus: GainNode;
  subOsc: OscillatorNode;
  // Schedule
  bpm: number;
  nextBeatTime: number; // next kick
  beatIndex: number;
  nextArpTime: number;
  arpIndex: number;
  nextLeadTime: number;
  // State
  active: boolean;
  phase: 1 | 2;
  fadeOut: boolean;
  fadeOutAt: number;
}

let music: BossMusicGraph | null = null;

// A natural minor (A2 = 110, C3 = 130.81, E3 = 164.81, G3 = 196)
const ARP_NOTES = [110, 130.81, 164.81, 196];
const ARP_DUR = 1.5;

// Minor scale (A): A B C D E F G — semitone offsets from A2
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// ---------------------------------------------------------------------------

function makeWaveShaperCurve(amount: number): Float32Array {
  const n = 512;
  const buf = new ArrayBuffer(n * 4);
  const curve = new Float32Array(buf);
  const k = amount * 50;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function applyShaperCurve(node: WaveShaperNode, curve: Float32Array): void {
  // The WaveShaper.curve setter wants Float32Array<ArrayBuffer>; some TS lib
  // versions infer Float32Array<ArrayBufferLike>. Cast through unknown to satisfy.
  (node as unknown as { curve: Float32Array }).curve = curve;
}

function makeReverbIR(ctx: AudioContext, durSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
    }
  }
  return buf;
}

function semiToFreq(rootHz: number, semi: number): number {
  return rootHz * Math.pow(2, semi / 12);
}

// ---------------------------------------------------------------------------
// Build (lazy, on first use)

function buildBossMusic(g: AudioGraph): BossMusicGraph {
  const { ctx, ambientBus } = g;
  const t = ctx.currentTime;

  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.connect(ambientBus);

  // ---- Pad arpeggio ----
  const padBus = ctx.createGain();
  padBus.gain.value = 0.18;
  const padLp = ctx.createBiquadFilter();
  padLp.type = 'lowpass';
  padLp.frequency.value = 800;
  padLp.Q.value = 0.7;
  padLp.connect(padBus);
  padBus.connect(bus);

  // 4 voices, one per note. Volume tweened on schedule.
  const padOscs: OscillatorNode[] = [];
  const padGains: GainNode[] = [];
  for (let i = 0; i < ARP_NOTES.length; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = ARP_NOTES[i];
    const det = ctx.createOscillator();
    det.type = 'sawtooth';
    det.frequency.value = ARP_NOTES[i] * 1.005;
    const vg = ctx.createGain();
    vg.gain.value = 0;
    o.connect(vg);
    det.connect(vg);
    vg.connect(padLp);
    o.start();
    det.start();
    padOscs.push(o, det);
    padGains.push(vg);
  }

  // ---- Kick bus ----
  const kickBus = ctx.createGain();
  kickBus.gain.value = 0.7;
  kickBus.connect(bus);

  // ---- Lead chain: osc → filter → distortion → split (dry + reverb) → leadBus → bus ----
  const leadBus = ctx.createGain();
  leadBus.gain.value = 0.3;
  leadBus.connect(bus);

  const leadFilter = ctx.createBiquadFilter();
  leadFilter.type = 'lowpass';
  leadFilter.frequency.value = 2400;
  leadFilter.Q.value = 1.5;

  const leadDistAmount = 6;
  const leadDist = ctx.createWaveShaper();
  applyShaperCurve(leadDist, makeWaveShaperCurve(leadDistAmount));
  leadDist.oversample = '2x';

  const leadReverb = ctx.createConvolver();
  leadReverb.buffer = makeReverbIR(ctx, 1.8);
  const leadDry = ctx.createGain();
  leadDry.gain.value = 0.6;
  const leadWet = ctx.createGain();
  leadWet.gain.value = 0.5;

  // Routing: leadOsc → leadGain (envelope) → leadFilter → leadDist → (leadDry + leadReverb) → leadBus
  const leadOsc = ctx.createOscillator();
  leadOsc.type = 'square'; // pulse-like
  leadOsc.frequency.value = ARP_NOTES[0];

  const leadGain = ctx.createGain();
  leadGain.gain.value = 0; // gated by schedule

  leadOsc.connect(leadGain);
  leadGain.connect(leadFilter);
  leadFilter.connect(leadDist);
  leadDist.connect(leadDry);
  leadDist.connect(leadReverb);
  leadReverb.connect(leadWet);
  leadDry.connect(leadBus);
  leadWet.connect(leadBus);
  leadOsc.start();

  // ---- Sub-bass (phase 2) ----
  const subBus = ctx.createGain();
  subBus.gain.value = 0;
  subBus.connect(bus);
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.value = 40;
  const subGate = ctx.createGain();
  subGate.gain.value = 0; // pulsed on each beat in phase 2
  subOsc.connect(subGate);
  subGate.connect(subBus);
  subOsc.start();

  // We'll modulate subGate via setTargetAtTime per beat below; keep ref in graph state via subBus only — see scheduleBeat which closes over it.
  // To keep the state simple, expose subGate as a property by stashing it on subBus.
  (subBus as unknown as { __subGate: GainNode }).__subGate = subGate;

  const bpm = 100;

  return {
    bus,
    padBus,
    padOscs,
    padGains,
    kickBus,
    leadBus,
    leadDist,
    leadDistAmount,
    leadReverb,
    leadDry,
    leadWet,
    leadOsc,
    leadGain,
    leadFilter,
    subBus,
    subOsc,
    bpm,
    nextBeatTime: t + 0.25,
    beatIndex: 0,
    nextArpTime: t + 0.25,
    arpIndex: 0,
    nextLeadTime: t + 4 + Math.random() * 2,
    active: false,
    phase: 1,
    fadeOut: false,
    fadeOutAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Per-event schedulers (transient nodes built per-trigger)

function scheduleKick(g: AudioGraph, m: BossMusicGraph, when: number): void {
  const { ctx } = g;
  // Sub-thump: sine 60→30Hz exp pitch drop, sharp env.
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(60, when);
  o.frequency.exponentialRampToValueAtTime(30, when + 0.18);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(1.0, when + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
  o.connect(env);
  env.connect(m.kickBus);
  o.start(when);
  o.stop(when + 0.24);
  o.onended = (): void => {
    try { o.disconnect(); } catch { /* */ }
    try { env.disconnect(); } catch { /* */ }
  };

  // Click transient (filtered noise burst)
  const clickLen = Math.max(1, Math.floor(ctx.sampleRate * 0.012));
  const clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
  const clickData = clickBuf.getChannelData(0);
  for (let i = 0; i < clickLen; i++) clickData[i] = Math.random() * 2 - 1;
  const click = ctx.createBufferSource();
  click.buffer = clickBuf;
  const clickHp = ctx.createBiquadFilter();
  clickHp.type = 'highpass';
  clickHp.frequency.value = 1500;
  const clickEnv = ctx.createGain();
  clickEnv.gain.setValueAtTime(0.5, when);
  clickEnv.gain.exponentialRampToValueAtTime(0.0001, when + 0.018);
  click.connect(clickHp);
  clickHp.connect(clickEnv);
  clickEnv.connect(m.kickBus);
  click.start(when);
  click.stop(when + 0.025);
  click.onended = (): void => {
    try { click.disconnect(); } catch { /* */ }
    try { clickHp.disconnect(); } catch { /* */ }
    try { clickEnv.disconnect(); } catch { /* */ }
  };
}

function scheduleSubPulse(_g: AudioGraph, m: BossMusicGraph, when: number): void {
  // Phase-2 sub-bass pulse on each beat
  const subGate = (m.subBus as unknown as { __subGate: GainNode }).__subGate;
  subGate.gain.cancelScheduledValues(when);
  subGate.gain.setValueAtTime(0.0001, when);
  subGate.gain.exponentialRampToValueAtTime(0.7, when + 0.01);
  subGate.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
}

function scheduleArpStep(_g: AudioGraph, m: BossMusicGraph, when: number, idx: number): void {
  // Tween volumes: target voice 0.5, others 0.
  for (let i = 0; i < m.padGains.length; i++) {
    const target = i === idx ? 0.5 : 0.0001;
    m.padGains[i].gain.cancelScheduledValues(when);
    m.padGains[i].gain.setTargetAtTime(target, when, 0.25);
  }
}

function scheduleLeadPhrase(_g: AudioGraph, m: BossMusicGraph, when: number): void {
  // 4-bar random-walk minor scale phrase. Each phrase is ~4 notes over 2-3s.
  // We tween leadOsc.frequency and gate leadGain.
  let cursor = when;
  const noteCount = 4 + Math.floor(Math.random() * 3);
  let semi = MINOR_SCALE[Math.floor(Math.random() * MINOR_SCALE.length)];
  // octave range 0..1 above A3 (220Hz)
  for (let i = 0; i < noteCount; i++) {
    const stepDir = Math.random() < 0.5 ? -1 : 1;
    const stepSize = MINOR_SCALE[Math.floor(Math.random() * 3) + 1] - MINOR_SCALE[0];
    semi += stepDir * stepSize;
    semi = Math.max(-12, Math.min(14, semi));
    const f = semiToFreq(220, semi);
    const dur = 0.25 + Math.random() * 0.35;
    m.leadOsc.frequency.setTargetAtTime(f, cursor, 0.02);
    m.leadGain.gain.setValueAtTime(0.0001, cursor);
    m.leadGain.gain.exponentialRampToValueAtTime(0.4, cursor + 0.01);
    m.leadGain.gain.exponentialRampToValueAtTime(0.0001, cursor + dur);
    cursor += dur + 0.05;
  }
}

// ---------------------------------------------------------------------------
// Public API

export function startBossMusic(g: AudioGraph): void {
  if (!music) music = buildBossMusic(g);
  if (music.active) return;
  music.active = true;
  music.fadeOut = false;
  music.phase = 1;
  music.bpm = 100;
  const t = g.ctx.currentTime;

  // 3s riser sweep before the loop kicks in (sawtooth pitch glide low → high).
  spawnRiser(g, t, 3);

  music.bus.gain.cancelScheduledValues(t);
  music.bus.gain.setValueAtTime(0.0001, t);
  music.bus.gain.exponentialRampToValueAtTime(0.6, t + 3);

  music.nextBeatTime = t + 3;
  music.beatIndex = 0;
  music.nextArpTime = t + 3;
  music.arpIndex = 0;
  music.nextLeadTime = t + 5 + Math.random() * 2;

  // Reset distortion to phase-1 amount
  applyShaperCurve(music.leadDist, makeWaveShaperCurve(music.leadDistAmount));
  music.leadWet.gain.setTargetAtTime(0.5, t, 0.5);
  music.leadDry.gain.setTargetAtTime(0.6, t, 0.5);
  music.subBus.gain.setTargetAtTime(0, t, 0.5);
}

export function transitionPhase2(g: AudioGraph): void {
  if (!music || !music.active) return;
  if (music.phase === 2) return;
  music.phase = 2;
  music.bpm = 120; // +20%
  // 2x distortion
  applyShaperCurve(music.leadDist, makeWaveShaperCurve(music.leadDistAmount * 2));
  // Drier lead
  const t = g.ctx.currentTime;
  music.leadWet.gain.setTargetAtTime(0.18, t, 0.4);
  music.leadDry.gain.setTargetAtTime(0.85, t, 0.4);
  // Bring sub-bus up
  music.subBus.gain.setTargetAtTime(0.5, t, 0.5);
}

export function endBossMusic(g: AudioGraph): void {
  if (!music || !music.active) return;
  // Held chord + slow fade 4s.
  const t = g.ctx.currentTime;
  // Tonic chord on pad
  for (let i = 0; i < music.padGains.length; i++) {
    music.padGains[i].gain.cancelScheduledValues(t);
    music.padGains[i].gain.setTargetAtTime(0.4, t, 0.2);
  }
  music.fadeOut = true;
  music.fadeOutAt = t + 4;
  music.bus.gain.cancelScheduledValues(t);
  music.bus.gain.setTargetAtTime(0.0001, t, 1.2);
}

export function tickBossMusic(g: AudioGraph): void {
  if (!music) return;
  if (gameState.paused) return;
  const t = g.ctx.currentTime;

  if (!music.active) return;

  if (music.fadeOut && t >= music.fadeOutAt) {
    music.active = false;
    return;
  }

  // Beat scheduler — kick + (phase 2) sub pulse.
  const beatPeriod = 60 / music.bpm;
  // Schedule a short way ahead (60ms safety window).
  while (music.nextBeatTime < t + 0.06) {
    scheduleKick(g, music, music.nextBeatTime);
    if (music.phase === 2) {
      scheduleSubPulse(g, music, music.nextBeatTime);
    }
    music.beatIndex++;
    music.nextBeatTime += beatPeriod;
  }

  // Arp scheduler — independent of bpm (1.5s/note).
  while (music.nextArpTime < t + 0.06) {
    scheduleArpStep(g, music, music.nextArpTime, music.arpIndex % ARP_NOTES.length);
    music.arpIndex++;
    music.nextArpTime += ARP_DUR;
  }

  // Lead phrase scheduler (every ~4 bars in beats; varies by bpm).
  if (t >= music.nextLeadTime) {
    scheduleLeadPhrase(g, music, t + 0.05);
    // Phrase length ~2-3s, then breathe 1-2s.
    music.nextLeadTime = t + 3 + Math.random() * 2;
  }
}

export function isBossMusicActive(): boolean {
  return music ? music.active : false;
}

// ---------------------------------------------------------------------------
// Riser intro

function spawnRiser(g: AudioGraph, t0: number, dur: number): void {
  if (!music) return;
  const { ctx } = g;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(55, t0);
  o.frequency.exponentialRampToValueAtTime(880, t0 + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, t0);
  lp.frequency.exponentialRampToValueAtTime(4000, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.4, t0 + dur * 0.9);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.1);
  o.connect(lp);
  lp.connect(env);
  env.connect(music.bus);
  o.start(t0);
  o.stop(t0 + dur + 0.15);
  o.onended = (): void => {
    try { o.disconnect(); } catch { /* */ }
    try { lp.disconnect(); } catch { /* */ }
    try { env.disconnect(); } catch { /* */ }
  };
}
