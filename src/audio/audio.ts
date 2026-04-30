// Audio manager — single AudioContext + master / music / SFX gain stages,
// settings persistence, and lazy resume on the first user gesture (browser
// autoplay policy blocks any AudioContext until then).
//
// Volume values are stored as 0..1 linear sliders. We square them when
// applying to gain so the slider feels perceptually linear (loudness ∝ v²).
//
// Audio graph:
//   sfxBus  ─┐
//            ├──► masterBus ──► destination
//   musicBus┘

const STORAGE_KEY = 'vibecoder.audio.v1';

export interface AudioSettings {
  masterVolume: number; // 0..1
  musicVolume: number;  // 0..1
  sfxVolume: number;    // 0..1
  masterMuted: boolean;
  musicMuted: boolean;
  sfxMuted: boolean;
}

const DEFAULTS: AudioSettings = {
  masterVolume: 0.7,
  musicVolume: 0.45,
  sfxVolume: 0.7,
  masterMuted: false,
  musicMuted: false,
  sfxMuted: false,
};

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      masterVolume: clamp01(parsed.masterVolume ?? DEFAULTS.masterVolume),
      musicVolume:  clamp01(parsed.musicVolume  ?? DEFAULTS.musicVolume),
      sfxVolume:    clamp01(parsed.sfxVolume    ?? DEFAULTS.sfxVolume),
      masterMuted:  !!parsed.masterMuted,
      musicMuted:   !!parsed.musicMuted,
      sfxMuted:     !!parsed.sfxMuted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private settings: AudioSettings;
  private listeners = new Set<(s: AudioSettings) => void>();
  private resumePending = false;

  constructor() {
    this.settings = loadSettings();
    // First user gesture unlocks the audio context. Listening on capture so
    // it fires regardless of which child element gets the actual click.
    const unlock = () => {
      this.resume();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchstart', unlock, true);
  }

  // Lazy init — building the graph on the first user gesture. Returns the
  // context so callers can schedule against it; null when the browser doesn't
  // expose WebAudio at all (extremely old / locked-down environments).
  ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const masterBus = ctx.createGain();
    const musicBus = ctx.createGain();
    const sfxBus = ctx.createGain();
    musicBus.connect(masterBus);
    sfxBus.connect(masterBus);
    masterBus.connect(ctx.destination);
    this.ctx = ctx;
    this.masterBus = masterBus;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.applyGains();
    return ctx;
  }

  // Called from the unlock listener; safe to call repeatedly. Browsers start
  // contexts in 'suspended' state until a gesture, so we resume() after init.
  resume(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* user might still need another gesture */ });
    }
    if (this.resumePending) {
      this.resumePending = false;
      this.notify();
    } else {
      // Notify so music subscriber can attempt to start now that the context
      // is live; cheap, no-op for components that don't care.
      this.notify();
    }
  }

  context(): AudioContext | null { return this.ctx; }
  sfxOutput(): GainNode | null   { return this.sfxBus; }
  musicOutput(): GainNode | null { return this.musicBus; }

  getSettings(): AudioSettings { return { ...this.settings }; }

  setSettings(patch: Partial<AudioSettings>): void {
    let changed = false;
    const next: AudioSettings = { ...this.settings };
    if (patch.masterVolume !== undefined) next.masterVolume = clamp01(patch.masterVolume);
    if (patch.musicVolume  !== undefined) next.musicVolume  = clamp01(patch.musicVolume);
    if (patch.sfxVolume    !== undefined) next.sfxVolume    = clamp01(patch.sfxVolume);
    if (patch.masterMuted  !== undefined) next.masterMuted  = patch.masterMuted;
    if (patch.musicMuted   !== undefined) next.musicMuted   = patch.musicMuted;
    if (patch.sfxMuted     !== undefined) next.sfxMuted     = patch.sfxMuted;
    for (const k of Object.keys(next) as (keyof AudioSettings)[]) {
      if (this.settings[k] !== next[k]) { changed = true; break; }
    }
    if (!changed) return;
    this.settings = next;
    this.persist();
    this.applyGains();
    this.notify();
  }

  subscribe(fn: (s: AudioSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Perceptual loudness ≈ amplitude², so square the slider value. Mute flags
  // multiply in cleanly so sliders keep their position while muted.
  private applyGains(): void {
    if (!this.masterBus || !this.musicBus || !this.sfxBus || !this.ctx) return;
    const t = this.ctx.currentTime;
    const master = this.settings.masterMuted ? 0 : this.settings.masterVolume ** 2;
    const music  = this.settings.musicMuted  ? 0 : this.settings.musicVolume  ** 2;
    const sfx    = this.settings.sfxMuted    ? 0 : this.settings.sfxVolume    ** 2;
    // Short ramp avoids zipper noise on slider drags.
    this.masterBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.cancelScheduledValues(t);
    this.sfxBus.gain.cancelScheduledValues(t);
    this.masterBus.gain.linearRampToValueAtTime(master, t + 0.04);
    this.musicBus.gain.linearRampToValueAtTime(music,   t + 0.04);
    this.sfxBus.gain.linearRampToValueAtTime(sfx,       t + 0.04);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch { /* quota / private mode; settings still work for the session */ }
  }

  private notify(): void {
    const snap = this.getSettings();
    for (const fn of this.listeners) fn(snap);
  }
}

// Singleton — every part of the game shares the same audio context.
export const audio = new AudioManager();
