// Background music — single MP3 streamed via HTMLAudioElement, routed through
// the music gain bus so the settings sliders take effect immediately. We use
// an <audio> element instead of decoding into a buffer so the file streams
// (1.8 MB never sits in memory all at once) and so the browser handles the
// codec without us shipping decoders.
//
// Autoplay is blocked until a user gesture, so we listen for audio.resume()
// notifications via the settings subscription and (re)try play() each time.

import { audio } from './audio';

const MUSIC_URL = '/music/conquerer.mp3';
const FADE_IN_MS = 1800;

export class MusicPlayer {
  private el: HTMLAudioElement;
  private srcNode: MediaElementAudioSourceNode | null = null;
  private fadeGain: GainNode | null = null;
  private started = false;

  constructor() {
    this.el = new Audio(MUSIC_URL);
    this.el.loop = true;
    this.el.preload = 'auto';
    this.el.crossOrigin = 'anonymous';
    // The element's own volume is left at 1; gain happens in the WebAudio
    // graph via the music bus + a local fade-in node.
    this.el.volume = 1;

    // Fire whenever the audio system resumes (which happens on the first user
    // gesture). We try to start playback on every notify since the very first
    // attempt may pre-date the gesture.
    audio.subscribe(() => this.tryStart());
    // Also try opportunistically — some browsers allow autoplay if muted.
    this.tryStart();
  }

  private tryStart(): void {
    if (this.started) return;
    const ctx = audio.context();
    const out = audio.musicOutput();
    if (!ctx || !out) return; // wait for next gesture
    if (ctx.state === 'suspended') return;

    // Wire the element through the music bus exactly once. Re-entering this
    // method later just retries play() if a previous attempt was rejected.
    if (!this.srcNode) {
      try {
        this.srcNode = ctx.createMediaElementSource(this.el);
      } catch {
        // Browsers throw if the same element is captured twice; we already
        // guarded with this.srcNode === null, so the only path here is a
        // genuine policy/CORS failure. Bail without starting.
        return;
      }
      this.fadeGain = ctx.createGain();
      this.fadeGain.gain.value = 0;
      this.srcNode.connect(this.fadeGain);
      this.fadeGain.connect(out);
    }

    this.el.play().then(() => {
      this.started = true;
      // Soft fade-in so the first note doesn't slap.
      const t = ctx.currentTime;
      const fade = this.fadeGain!.gain;
      fade.cancelScheduledValues(t);
      fade.setValueAtTime(0, t);
      fade.linearRampToValueAtTime(1, t + FADE_IN_MS / 1000);
    }).catch(() => {
      // Autoplay blocked — wait for the next user gesture. audio.resume()
      // will fire another notify, which calls back into tryStart.
    });
  }
}

let singleton: MusicPlayer | null = null;
export function startMusic(): MusicPlayer {
  if (!singleton) singleton = new MusicPlayer();
  return singleton;
}
