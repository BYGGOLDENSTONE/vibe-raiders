// Procedural ambient: detuned drone + sparse aeolian bells + wind + combat-reactive rumble.
// Single persistent graph; we modulate gain/filter/pitch over time.

import type { AudioGraph } from './context';
import { gameState } from '../state';

interface AmbientGraph {
  // Drone layer
  droneGain: GainNode;
  droneOscs: OscillatorNode[];
  droneLp: BiquadFilterNode;
  droneLfo: OscillatorNode;
  // Bell layer
  bellGain: GainNode;
  // Wind layer
  windGain: GainNode;
  // Combat layer
  combatGain: GainNode;
  combatOsc: OscillatorNode;
  combatNoiseSrc: AudioBufferSourceNode;
  combatNoiseFilter: BiquadFilterNode;
  // State
  baseFreq: number;
  nextBellTime: number;
  nextWindTime: number;
}

let ambient: AmbientGraph | null = null;
let lastCombatTime = -Infinity;
let currentZone: string = 'open-world';

function noiseLoopBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function initAmbient(g: AudioGraph): void {
  if (ambient) return;
  const { ctx, ambientBus } = g;

  // ---- Drone (~A1 = 55Hz, 3 detuned sawtooths through LP w/ LFO cutoff) ----
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.15;
  const droneLp = ctx.createBiquadFilter();
  droneLp.type = 'lowpass';
  droneLp.frequency.value = 220;
  droneLp.Q.value = 4;

  const droneOscs: OscillatorNode[] = [];
  const detunes = [-7, 0, 5];
  for (const d of detunes) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    o.detune.value = d;
    o.connect(droneLp);
    o.start();
    droneOscs.push(o);
  }

  // LFO modulating filter cutoff for movement
  const droneLfo = ctx.createOscillator();
  droneLfo.type = 'sine';
  droneLfo.frequency.value = 0.08;
  const droneLfoGain = ctx.createGain();
  droneLfoGain.gain.value = 80; // +/-80Hz around base
  droneLfo.connect(droneLfoGain);
  droneLfoGain.connect(droneLp.frequency);
  droneLfo.start();

  droneLp.connect(droneGain);
  droneGain.connect(ambientBus);

  // ---- Bell layer bus ----
  const bellGain = ctx.createGain();
  bellGain.gain.value = 0.1;
  bellGain.connect(ambientBus);

  // ---- Wind layer bus ----
  const windGain = ctx.createGain();
  windGain.gain.value = 0.0;
  windGain.connect(ambientBus);

  // ---- Combat layer (persistent rumble, gain-driven) ----
  const combatGain = ctx.createGain();
  combatGain.gain.value = 0.0001;
  combatGain.connect(ambientBus);

  const combatOsc = ctx.createOscillator();
  combatOsc.type = 'sawtooth';
  combatOsc.frequency.value = 38;
  const combatLp = ctx.createBiquadFilter();
  combatLp.type = 'lowpass';
  combatLp.frequency.value = 180;
  combatOsc.connect(combatLp);
  combatLp.connect(combatGain);
  combatOsc.start();

  // Noise wash for combat (low-passed pink-ish)
  const combatNoiseSrc = ctx.createBufferSource();
  combatNoiseSrc.buffer = noiseLoopBuffer(ctx, 4);
  combatNoiseSrc.loop = true;
  const combatNoiseFilter = ctx.createBiquadFilter();
  combatNoiseFilter.type = 'lowpass';
  combatNoiseFilter.frequency.value = 250;
  combatNoiseSrc.connect(combatNoiseFilter);
  combatNoiseFilter.connect(combatGain);
  combatNoiseSrc.start();

  ambient = {
    droneGain,
    droneOscs,
    droneLp,
    droneLfo,
    bellGain,
    windGain,
    combatGain,
    combatOsc,
    combatNoiseSrc,
    combatNoiseFilter,
    baseFreq: 55,
    nextBellTime: ctx.currentTime + 2 + Math.random() * 3,
    nextWindTime: ctx.currentTime + 4 + Math.random() * 4,
  };
}

// Aeolian (natural minor) on A: A B C D E F G — degrees from A4
const AEOLIAN_OFFSETS = [0, 2, 3, 5, 7, 8, 10];
function pickAeolianFreq(base: number): number {
  const semis = AEOLIAN_OFFSETS[Math.floor(Math.random() * AEOLIAN_OFFSETS.length)];
  // Random octave shift +0 / +1 / +2
  const oct = Math.floor(Math.random() * 3);
  return base * Math.pow(2, (semis + 12 * oct) / 12);
}

function spawnBell(g: AudioGraph): void {
  if (!ambient) return;
  const { ctx } = g;
  const f = pickAeolianFreq(220); // A3 base for bells
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = f;
  const harm = ctx.createOscillator();
  harm.type = 'sine';
  harm.frequency.value = f * 3.01; // inharmonic shimmer
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.5);
  const harmEnv = ctx.createGain();
  harmEnv.gain.value = 0.15;
  osc.connect(env);
  harm.connect(harmEnv);
  harmEnv.connect(env);
  env.connect(ambient.bellGain);
  osc.start(t0);
  harm.start(t0);
  osc.stop(t0 + 2.6);
  harm.stop(t0 + 2.6);
}

function spawnWind(g: AudioGraph): void {
  if (!ambient) return;
  const { ctx } = g;
  const dur = 3 + Math.random() * 2;
  const t0 = ctx.currentTime;
  const n = ctx.createBufferSource();
  n.buffer = noiseLoopBuffer(ctx, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 600 + Math.random() * 600;
  bp.Q.value = 0.8;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.18, t0 + dur * 0.4);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  n.connect(bp);
  bp.connect(env);
  env.connect(ambient.windGain);
  n.start(t0);
  n.stop(t0 + dur + 0.05);
}

export function notifyCombat(g: AudioGraph): void {
  if (!ambient) return;
  lastCombatTime = g.ctx.currentTime;
}

export function notifyZone(g: AudioGraph, zone: string): void {
  if (!ambient) return;
  if (zone === currentZone) return;
  currentZone = zone;
  const { ctx } = g;
  // Dungeon: drop drone 5 semitones, slow LFO
  if (zone === 'dungeon') {
    const newFreq = 55 * Math.pow(2, -5 / 12);
    for (const o of ambient.droneOscs) {
      o.frequency.cancelScheduledValues(ctx.currentTime);
      o.frequency.setTargetAtTime(newFreq, ctx.currentTime, 1.5);
    }
    ambient.droneLfo.frequency.setTargetAtTime(0.04, ctx.currentTime, 1.5);
    ambient.droneLp.frequency.cancelScheduledValues(ctx.currentTime);
    ambient.droneLp.frequency.setTargetAtTime(160, ctx.currentTime, 1.5);
  } else {
    for (const o of ambient.droneOscs) {
      o.frequency.cancelScheduledValues(ctx.currentTime);
      o.frequency.setTargetAtTime(55, ctx.currentTime, 1.5);
    }
    ambient.droneLfo.frequency.setTargetAtTime(0.08, ctx.currentTime, 1.5);
    ambient.droneLp.frequency.cancelScheduledValues(ctx.currentTime);
    ambient.droneLp.frequency.setTargetAtTime(220, ctx.currentTime, 1.5);
  }
}

export function tickAmbient(g: AudioGraph): void {
  if (!ambient || gameState.paused) return;
  const t = g.ctx.currentTime;

  if (t >= ambient.nextBellTime) {
    spawnBell(g);
    ambient.nextBellTime = t + 4 + Math.random() * 2;
  }
  if (t >= ambient.nextWindTime) {
    spawnWind(g);
    ambient.nextWindTime = t + 8 + Math.random() * 4;
  }

  // Combat layer fade
  const inCombat = (t - lastCombatTime) < 4;
  const target = inCombat ? 0.18 : 0.0001;
  ambient.combatGain.gain.setTargetAtTime(target, t, inCombat ? 0.4 : 1.2);
}
