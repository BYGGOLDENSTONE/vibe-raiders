// Ambient one-shots: distant howl, raven caw, thunder roll, church bell (graveyard),
// drip + sub-rumble (dungeon). Random 20-40s interval with zone-weighted picking.

import type { AudioGraph } from './context';
import { gameState } from '../state';

type OneshotId = 'howl' | 'raven' | 'thunder' | 'bell' | 'drip' | 'rumble';

interface ZoneWeights {
  [key: string]: number;
}

// Higher = more likely. Weights need not sum to 1.
const ZONE_WEIGHTS: Record<'graveyard' | 'dungeon' | 'hub', ZoneWeights> = {
  graveyard: { howl: 1.0, raven: 1.0, thunder: 0.5, bell: 0.7 },
  dungeon: { drip: 1.5, rumble: 1.0, howl: 0.3 },
  hub: { raven: 0.6, bell: 0.4, thunder: 0.2 },
};

let nextOneshotTime = 0;

// ---------------------------------------------------------------------------

// Pink-ish noise via simple low-pass shaping
function pinkNoiseBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    data[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  return buf;
}

function gcAfter(nodes: AudioNode[], delaySec: number): void {
  setTimeout(() => {
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* */ }
    }
  }, Math.max(0, (delaySec * 1000) | 0));
}

// ---------------------------------------------------------------------------
// Individual one-shots

function spawnHowl(g: AudioGraph): void {
  const { ctx, ambientBus } = g;
  const t0 = ctx.currentTime;
  const dur = 1.5;
  const out = ctx.createGain();
  out.gain.value = 0.15;
  out.connect(ambientBus);
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() - 0.5) * 1.4;
  out.connect(pan);
  pan.connect(ambientBus);

  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, t0);
  o.frequency.exponentialRampToValueAtTime(420, t0 + dur * 0.5);
  o.frequency.exponentialRampToValueAtTime(140, t0 + dur);
  // Filter sweep
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(400, t0);
  lp.frequency.exponentialRampToValueAtTime(1200, t0 + dur * 0.5);
  lp.frequency.exponentialRampToValueAtTime(300, t0 + dur);
  lp.Q.value = 6;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.4, t0 + 0.3);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(lp);
  lp.connect(env);
  env.connect(pan);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  o.onended = (): void => gcAfter([o, lp, env, pan, out], 0.1);
}

function spawnRaven(g: AudioGraph): void {
  const { ctx, ambientBus } = g;
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.1;
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() - 0.5) * 1.6;
  out.connect(pan);
  pan.connect(ambientBus);

  const chirpCount = 2 + Math.floor(Math.random() * 2); // 2-3 caws
  const oscs: OscillatorNode[] = [];
  const envs: GainNode[] = [];
  for (let i = 0; i < chirpCount; i++) {
    const ts = t0 + i * 0.2;
    const o = ctx.createOscillator();
    o.type = 'square';
    const baseF = 700 + Math.random() * 200;
    o.frequency.setValueAtTime(baseF, ts);
    o.frequency.exponentialRampToValueAtTime(baseF * 0.6, ts + 0.15);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, ts);
    env.gain.exponentialRampToValueAtTime(0.4, ts + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, ts + 0.18);
    o.connect(env);
    env.connect(out);
    o.start(ts);
    o.stop(ts + 0.2);
    oscs.push(o);
    envs.push(env);
  }
  const totalDur = chirpCount * 0.2 + 0.2;
  oscs[oscs.length - 1].onended = (): void => gcAfter([...oscs, ...envs, out, pan], 0.1);
  // safety GC if onended never fires
  void totalDur;
}

function spawnThunder(g: AudioGraph): void {
  const { ctx, ambientBus } = g;
  const t0 = ctx.currentTime;
  const dur = 4.0;
  const out = ctx.createGain();
  out.gain.value = 0.18;
  out.connect(ambientBus);

  const n = ctx.createBufferSource();
  n.buffer = pinkNoiseBuffer(ctx, dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1200, t0);
  lp.frequency.exponentialRampToValueAtTime(120, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.7, t0 + 0.4);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  // Sub-bass emphasis: a 50Hz sine that fades with the noise.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 50;
  const subEnv = ctx.createGain();
  subEnv.gain.setValueAtTime(0.0001, t0);
  subEnv.gain.exponentialRampToValueAtTime(0.6, t0 + 0.5);
  subEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  sub.connect(subEnv);
  subEnv.connect(out);
  n.connect(lp);
  lp.connect(env);
  env.connect(out);
  n.start(t0);
  n.stop(t0 + dur);
  sub.start(t0);
  sub.stop(t0 + dur);
  n.onended = (): void => gcAfter([n, lp, env, sub, subEnv, out], 0.2);
}

function spawnBell(g: AudioGraph): void {
  const { ctx, ambientBus } = g;
  const t0 = ctx.currentTime;
  const dur = 3.0;
  const out = ctx.createGain();
  out.gain.value = 0.16;
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() - 0.5) * 1.0;
  out.connect(pan);
  pan.connect(ambientBus);

  // Cheap reverb
  const irLen = Math.max(1, Math.floor(ctx.sampleRate * 1.5));
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  conv.connect(out);

  const fund = 220;
  const harm = 880;
  for (const f of [fund, harm]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(f === fund ? 0.5 : 0.25, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(env);
    env.connect(out);
    env.connect(conv); // reverb send
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    if (f === harm) {
      o.onended = (): void => gcAfter([o, env, conv, pan, out], 0.2);
    }
  }
}

function spawnDrip(g: AudioGraph): void {
  const { ctx, ambientBus } = g;
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.12;
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() - 0.5) * 1.8;
  out.connect(pan);
  pan.connect(ambientBus);

  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(2000, t0);
  o.frequency.exponentialRampToValueAtTime(800, t0 + 0.08);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.6, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
  o.connect(env);
  env.connect(out);
  o.start(t0);
  o.stop(t0 + 0.18);
  o.onended = (): void => gcAfter([o, env, pan, out], 0.05);
}

function spawnRumble(g: AudioGraph): void {
  const { ctx, ambientBus } = g;
  const t0 = ctx.currentTime;
  const dur = 5.0;
  const out = ctx.createGain();
  out.gain.value = 0.14;
  out.connect(ambientBus);

  const n = ctx.createBufferSource();
  n.buffer = pinkNoiseBuffer(ctx, dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 80;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.6, t0 + dur * 0.4);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  n.connect(lp);
  lp.connect(env);
  env.connect(out);
  n.start(t0);
  n.stop(t0 + dur);
  n.onended = (): void => gcAfter([n, lp, env, out], 0.2);
}

// ---------------------------------------------------------------------------
// Picker

function currentZoneTone(): 'graveyard' | 'dungeon' | 'hub' {
  const z = gameState.currentZone;
  if (z === 'dungeon') return 'dungeon';
  if (z === 'hub') return 'hub';
  return 'graveyard';
}

function pickOneshot(): OneshotId | null {
  const weights = ZONE_WEIGHTS[currentZoneTone()];
  const ids = Object.keys(weights) as OneshotId[];
  if (ids.length === 0) return null;
  let total = 0;
  for (const id of ids) total += weights[id];
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const id of ids) {
    r -= weights[id];
    if (r <= 0) return id;
  }
  return ids[ids.length - 1];
}

function spawnOneshot(g: AudioGraph, id: OneshotId): void {
  switch (id) {
    case 'howl': spawnHowl(g); break;
    case 'raven': spawnRaven(g); break;
    case 'thunder': spawnThunder(g); break;
    case 'bell': spawnBell(g); break;
    case 'drip': spawnDrip(g); break;
    case 'rumble': spawnRumble(g); break;
  }
}

export function initOneshots(g: AudioGraph): void {
  // First trigger 10-20s after boot so the player isn't bombarded immediately.
  nextOneshotTime = g.ctx.currentTime + 10 + Math.random() * 10;
}

export function tickOneshots(g: AudioGraph): void {
  if (gameState.paused) return;
  const t = g.ctx.currentTime;
  if (t < nextOneshotTime) return;
  const id = pickOneshot();
  if (id) {
    try { spawnOneshot(g, id); } catch { /* never break loop */ }
  }
  // Random next interval 20-40s
  nextOneshotTime = t + 20 + Math.random() * 20;
}
