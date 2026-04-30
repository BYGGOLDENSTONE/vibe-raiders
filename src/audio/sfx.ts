// Procedural sound effects — every voice is built from oscillators + biquad
// filters + envelopes routed into the shared SFX bus. Zero external assets,
// in line with the project's "100% procedural" rule.
//
// Each SFX function is short, self-contained, and bails cleanly if the audio
// context isn't live yet (pre-gesture). Callers don't need to gate on state.

import { audio } from './audio';

// Cooldown so rapid-fire calls (e.g. mouse-spam on a button) don't stack into
// a wall of overlapping voices. Keyed by SFX name → next allowed `currentTime`.
const cooldowns = new Map<string, number>();

function gate(name: string, ms: number): boolean {
  const ctx = audio.context();
  if (!ctx) return false;
  const now = ctx.currentTime;
  const next = cooldowns.get(name) ?? 0;
  if (now < next) return false;
  cooldowns.set(name, now + ms / 1000);
  return true;
}

interface VoiceParams {
  freq: number;
  freqEnd?: number;
  type?: OscillatorType;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  duration?: number;
  peak?: number;       // peak amplitude into the SFX bus (≤ 1)
  detune?: number;
  filterFreq?: number; // optional lowpass on the voice
  filterQ?: number;
  startOffset?: number;
}

// One voice = osc + envelope (+ optional lowpass). Returns the scheduled
// stop time so callers can chain delays from it.
function voice(p: VoiceParams): number {
  const ctx = audio.context();
  const out = audio.sfxOutput();
  if (!ctx || !out) return 0;

  const start = ctx.currentTime + (p.startOffset ?? 0);
  const attack = p.attack ?? 0.005;
  const decay = p.decay ?? 0.05;
  const sustain = p.sustain ?? 0.0;
  const release = p.release ?? 0.12;
  const duration = p.duration ?? 0.18;
  const peak = p.peak ?? 0.6;

  const osc = ctx.createOscillator();
  osc.type = p.type ?? 'sine';
  osc.frequency.setValueAtTime(p.freq, start);
  if (p.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.freqEnd), start + duration);
  }
  if (p.detune) osc.detune.setValueAtTime(p.detune, start);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + attack);
  env.gain.linearRampToValueAtTime(peak * sustain + peak * 0.0001, start + attack + decay);
  const stopAt = start + attack + decay + duration + release;
  env.gain.linearRampToValueAtTime(0, stopAt);

  let tail: AudioNode = env;
  if (p.filterFreq !== undefined) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(p.filterFreq, start);
    lp.Q.value = p.filterQ ?? 0.7;
    env.connect(lp);
    tail = lp;
  }

  osc.connect(env);
  tail.connect(out);
  osc.start(start);
  osc.stop(stopAt + 0.02);
  return stopAt;
}

// Short noise burst (hi-hat-ish) for clicks / sparkle layers. Re-uses a single
// noise buffer per session to avoid allocating per-shot.
let cachedNoise: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedNoise && cachedNoise.sampleRate === ctx.sampleRate) return cachedNoise;
  const len = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  cachedNoise = buf;
  return buf;
}

interface NoiseParams {
  duration?: number;
  peak?: number;
  filterFreq?: number;
  filterType?: BiquadFilterType;
  filterQ?: number;
  attack?: number;
  release?: number;
  startOffset?: number;
}

function noise(p: NoiseParams = {}): void {
  const ctx = audio.context();
  const out = audio.sfxOutput();
  if (!ctx || !out) return;
  const start = ctx.currentTime + (p.startOffset ?? 0);
  const dur = p.duration ?? 0.12;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = p.filterType ?? 'highpass';
  filter.frequency.value = p.filterFreq ?? 2000;
  filter.Q.value = p.filterQ ?? 0.7;

  const env = ctx.createGain();
  const peak = p.peak ?? 0.4;
  const attack = p.attack ?? 0.005;
  const release = p.release ?? 0.08;
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + attack);
  env.gain.linearRampToValueAtTime(0, start + dur + release);

  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.start(start);
  src.stop(start + dur + release + 0.02);
}

// ---- Public SFX -----------------------------------------------------------

// Tiny UI click — used for HUD button presses, modal toggles, layer-switcher.
export function sfxClick(): void {
  if (!gate('click', 30)) return;
  voice({
    freq: 920,
    freqEnd: 760,
    type: 'triangle',
    duration: 0.05,
    attack: 0.003,
    release: 0.05,
    peak: 0.18,
  });
}

// Slightly meatier hover/secondary tick. Currently unused but cheap to keep.
export function sfxHover(): void {
  if (!gate('hover', 60)) return;
  voice({
    freq: 1240,
    type: 'sine',
    duration: 0.03,
    attack: 0.002,
    release: 0.04,
    peak: 0.08,
  });
}

// Upgrade purchase. Quick pluck → bright sparkle. The vfx burst lands here
// visually so the audio peaks at the same moment.
export function sfxBuy(): void {
  if (!gate('buy', 50)) return;
  voice({
    freq: 520,
    freqEnd: 880,
    type: 'triangle',
    duration: 0.08,
    attack: 0.005,
    release: 0.18,
    peak: 0.32,
  });
  voice({
    freq: 1320,
    freqEnd: 1760,
    type: 'sine',
    duration: 0.12,
    attack: 0.005,
    release: 0.22,
    peak: 0.18,
    startOffset: 0.04,
  });
  noise({
    duration: 0.06,
    filterFreq: 5400,
    peak: 0.08,
    startOffset: 0.04,
  });
}

// Annex (W6-E) — a deeper "lock-in" thunk + rising whoosh. Heavier than buy
// since it changes the empire's footprint, not just an upgrade tier.
export function sfxAnnex(): void {
  if (!gate('annex', 200)) return;
  voice({
    freq: 140,
    freqEnd: 80,
    type: 'sine',
    duration: 0.16,
    attack: 0.005,
    release: 0.28,
    peak: 0.55,
  });
  voice({
    freq: 320,
    freqEnd: 640,
    type: 'sawtooth',
    duration: 0.22,
    attack: 0.01,
    release: 0.3,
    peak: 0.18,
    filterFreq: 1800,
    filterQ: 1.4,
    startOffset: 0.02,
  });
  noise({
    duration: 0.18,
    filterFreq: 800,
    filterType: 'lowpass',
    peak: 0.18,
    startOffset: 0.02,
  });
}

// Wormhole annex (W7) — the most dramatic SFX. Long bass drop + swirling
// detuned overtones + airy noise tail to suggest space being torn open.
export function sfxWormhole(): void {
  if (!gate('wormhole', 400)) return;
  voice({
    freq: 220,
    freqEnd: 55,
    type: 'sine',
    duration: 0.6,
    attack: 0.02,
    release: 0.5,
    peak: 0.7,
  });
  voice({
    freq: 660,
    freqEnd: 1100,
    type: 'sawtooth',
    duration: 0.5,
    attack: 0.04,
    release: 0.5,
    peak: 0.18,
    detune: 12,
    filterFreq: 2400,
    filterQ: 4.0,
    startOffset: 0.05,
  });
  voice({
    freq: 880,
    freqEnd: 320,
    type: 'sine',
    duration: 0.45,
    attack: 0.02,
    release: 0.6,
    peak: 0.14,
    startOffset: 0.1,
  });
  noise({
    duration: 0.7,
    filterFreq: 1400,
    filterType: 'bandpass',
    filterQ: 2.0,
    peak: 0.22,
    attack: 0.06,
    release: 0.4,
  });
}

// Trade Hub swap — two clean tones, one going down (give), one up (get) —
// so the swap reads as a shape rather than a single hit.
export function sfxTrade(): void {
  if (!gate('trade', 150)) return;
  voice({
    freq: 740,
    freqEnd: 480,
    type: 'triangle',
    duration: 0.1,
    attack: 0.005,
    release: 0.18,
    peak: 0.28,
  });
  voice({
    freq: 540,
    freqEnd: 880,
    type: 'sine',
    duration: 0.14,
    attack: 0.005,
    release: 0.22,
    peak: 0.28,
    startOffset: 0.09,
  });
  noise({
    duration: 0.05,
    filterFreq: 4800,
    peak: 0.06,
    startOffset: 0.04,
  });
}

// Layer transition — soft whoosh, used when zooming galaxy → system →
// planet (and back). Filtered noise sweep so it sits behind the camera move.
export function sfxLayerTransition(): void {
  if (!gate('layer', 250)) return;
  noise({
    duration: 0.45,
    filterFreq: 1100,
    filterType: 'bandpass',
    filterQ: 1.2,
    peak: 0.24,
    attack: 0.05,
    release: 0.35,
  });
  voice({
    freq: 240,
    freqEnd: 520,
    type: 'sine',
    duration: 0.4,
    attack: 0.04,
    release: 0.35,
    peak: 0.16,
    startOffset: 0.02,
  });
}

// Insufficient resources / cooldown / blocked action — a short, low "nope".
export function sfxError(): void {
  if (!gate('error', 120)) return;
  voice({
    freq: 280,
    freqEnd: 180,
    type: 'square',
    duration: 0.08,
    attack: 0.005,
    release: 0.1,
    peak: 0.18,
    filterFreq: 1200,
    filterQ: 0.8,
  });
}
