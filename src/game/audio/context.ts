// WebAudio boot. Lazy AudioContext on first user gesture (autoplay policy).
// Provides master gain + compressor chain shared by all SFX/ambient.

export interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  compressor: DynamicsCompressorNode;
  // Pre-master bus that SFX route into (post-pan, pre-master).
  sfxBus: GainNode;
  ambientBus: GainNode;
}

let graph: AudioGraph | null = null;
let booting = false;
const onReadyHandlers: Array<(g: AudioGraph) => void> = [];

function buildGraph(): AudioGraph {
  const Ctor: typeof AudioContext =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext);
  const ctx = new Ctor();

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-18, ctx.currentTime);
  compressor.knee.setValueAtTime(20, ctx.currentTime);
  compressor.ratio.setValueAtTime(8, ctx.currentTime);
  compressor.attack.setValueAtTime(0.003, ctx.currentTime);
  compressor.release.setValueAtTime(0.18, ctx.currentTime);

  const master = ctx.createGain();
  master.gain.value = 0.6;

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 1.0;

  const ambientBus = ctx.createGain();
  ambientBus.gain.value = 1.0;

  sfxBus.connect(compressor);
  ambientBus.connect(compressor);
  compressor.connect(master);
  master.connect(ctx.destination);

  return { ctx, master, compressor, sfxBus, ambientBus };
}

export function getAudio(): AudioGraph | null {
  return graph;
}

export function onAudioReady(fn: (g: AudioGraph) => void): void {
  if (graph) {
    fn(graph);
    return;
  }
  onReadyHandlers.push(fn);
}

export function bootAudioOnGesture(): void {
  if (graph || booting) return;

  const tryBoot = (): void => {
    if (graph) return;
    booting = true;
    try {
      graph = buildGraph();
    } catch {
      booting = false;
      return;
    }
    // Resume in case context started suspended.
    void graph.ctx.resume().catch(() => {});
    cleanup();
    const g = graph;
    for (const h of onReadyHandlers.splice(0)) {
      try { h(g); } catch { /* swallow */ }
    }
  };

  const cleanup = (): void => {
    window.removeEventListener('mousedown', tryBoot);
    window.removeEventListener('keydown', tryBoot);
    window.removeEventListener('touchstart', tryBoot);
    window.removeEventListener('pointerdown', tryBoot);
  };

  window.addEventListener('mousedown', tryBoot, { once: false });
  window.addEventListener('keydown', tryBoot, { once: false });
  window.addEventListener('touchstart', tryBoot, { once: false, passive: true });
  window.addEventListener('pointerdown', tryBoot, { once: false });
}

export function setMasterVolume(v: number): void {
  if (!graph) return;
  graph.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), graph.ctx.currentTime, 0.05);
}
