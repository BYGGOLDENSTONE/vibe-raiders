// Wave 3: procedural ambient drone + WebAudio SFX synthesis (no asset downloads).
// Subscribes to 'audio:sfx' events and game events for reactive audio.

import type { GameContext } from '../state';
import { gameState } from '../state';
import { bootAudioOnGesture, getAudio, onAudioReady, type AudioGraph } from './context';
import { dispatchSfx } from './sfx';
import { initAmbient, notifyCombat, notifyZone, tickAmbient } from './ambient';

export function initAudio(ctx: GameContext): void {
  const { world } = ctx;

  // 1. Wire up the gesture-driven boot.
  bootAudioOnGesture();

  // 2. Subscribe to events immediately. They no-op until the audio context
  //    finishes booting (handlers check getAudio() before doing work).
  world.on('audio:sfx', (p) => {
    const g = getAudio();
    if (!g) return;
    dispatchSfx(g, p.id, { x: p.x, z: p.z });
  });

  world.on('damage:dealt', (p) => {
    const g = getAudio();
    if (!g) return;
    const player = gameState.player;
    if (!player) return;
    // Mark combat if the player is involved (as source or target)
    if (p.sourceId === player.id || p.targetId === player.id) {
      notifyCombat(g);
    }
    // Auto-play player-hurt for meaningful incoming damage
    if (p.targetId === player.id && p.amount > 5) {
      const pos = player.object3d.position;
      dispatchSfx(g, 'player-hurt', { x: pos.x, z: pos.z });
    }
  });

  world.on('entity:died', (p) => {
    const g = getAudio();
    if (!g) return;
    const player = gameState.player;
    if (player && p.entityId === player.id) {
      const pos = player.object3d.position;
      dispatchSfx(g, 'player-death', { x: pos.x, z: pos.z });
    }
  });

  world.on('mob:killed', (p) => {
    const g = getAudio();
    if (!g) return;
    const ent = world.get(p.entityId);
    if (ent) {
      const pos = ent.object3d.position;
      dispatchSfx(g, 'death-mob', { x: pos.x, z: pos.z });
    } else {
      dispatchSfx(g, 'death-mob', {});
    }
  });

  world.on('level:up', () => {
    const g = getAudio();
    if (!g) return;
    dispatchSfx(g, 'levelup', {});
  });

  world.on('item:picked', () => {
    const g = getAudio();
    if (!g) return;
    dispatchSfx(g, 'item-pickup', {});
  });

  world.on('skill:cast', (p) => {
    const g = getAudio();
    if (!g) return;
    dispatchSfx(g, 'skill-whoosh', { x: p.targetX, z: p.targetZ });
  });

  world.on('zone:enter', (p) => {
    const g = getAudio();
    if (!g) return;
    notifyZone(g, p.zone);
  });

  // 3. When audio boots, start the ambient layer and register tick.
  onAudioReady((g: AudioGraph) => {
    initAmbient(g);
    notifyZone(g, gameState.currentZone);
  });

  // 4. Per-frame system: pump ambient state machine.
  world.addSystem(() => {
    const g = getAudio();
    if (!g) return;
    tickAmbient(g);
  });
}
