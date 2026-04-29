// Wave 3 + Polish: procedural ambient (3-layer drone) + boss music + footsteps
// + ambient one-shots + WebAudio SFX synthesis. No asset downloads.
// Subscribes to 'audio:sfx' and game events for reactive audio.

import type { GameContext } from '../state';
import { gameState } from '../state';
import { bootAudioOnGesture, getAudio, onAudioReady, type AudioGraph } from './context';
import { dispatchSfx } from './sfx';
import { initAmbient, notifyCombat, notifyZone, tickAmbient } from './ambient';
import { startBossMusic, transitionPhase2, endBossMusic, tickBossMusic, isBossMusicActive } from './bossMusic';
import { tickFootsteps } from './footsteps';
import { initOneshots, tickOneshots } from './oneshots';

export function initAudio(ctx: GameContext): void {
  const { world } = ctx;

  // 1. Wire up the gesture-driven boot.
  bootAudioOnGesture();

  // 2. Subscribe to events immediately. Handlers no-op until audio context boots.
  world.on('audio:sfx', (p) => {
    const g = getAudio();
    if (!g) return;

    // Boss music hooks: phase-2 ('boss-scream') / death ('boss-death').
    // 'boss-intro' starts the music — boss/index.ts emits this on zone:enter dungeon-1.
    if (p.id === 'boss-intro') {
      startBossMusic(g);
    } else if (p.id === 'boss-scream') {
      transitionPhase2(g);
    } else if (p.id === 'boss-death') {
      endBossMusic(g);
    }

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
    // Leaving the dungeon: end any boss music that was playing.
    if (p.zone !== 'dungeon-1' && p.zone !== 'dungeon' && isBossMusicActive()) {
      endBossMusic(g);
    }
  });

  // 3. When audio boots, start ambient + one-shots and align to current zone.
  onAudioReady((g: AudioGraph) => {
    initAmbient(g);
    initOneshots(g);
    notifyZone(g, gameState.currentZone);
  });

  // 4. Per-frame audio system: pump ambient + boss music + footsteps + one-shots.
  world.addSystem(() => {
    const g = getAudio();
    if (!g) return;
    tickAmbient(g);
    tickBossMusic(g);
    tickFootsteps(g);
    tickOneshots(g);
  });
}
