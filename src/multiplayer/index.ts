// Wave 4: PartyKit client — "vibey hub".
//
// Responsibilities:
//   - open a websocket to the PartyKit relay (room "hub-1")
//   - send local player position/rotation at 10 Hz
//   - render every other player as a translucent capsule + floating name tag
//   - host a party panel (top-left HUD) and a click-to-invite raycast
//
// Failure mode: if anything in the multiplayer stack throws or the relay is
// unreachable, the game keeps running in single-player. Multiplayer is
// strictly additive.
//
// Protocol limitation: server messages are `welcome | state | kicked` and
// client messages are `hello | input`. There is no chat or party broadcast.
// Party state is therefore a LOCAL visual treatment only.

import { Raycaster, Vector2 } from 'three';
import type { GameContext } from '../game/state';
import { gameState } from '../game/state';
import type { PlayerState } from '../net/protocol';
import { Connection, HUB_ROOM, debugHost } from './connection';
import { GhostManager } from './ghost';
import { buildPartyPanel } from './party';
import {
  colorForName,
  generateRandomName,
  loadStoredName,
  persistName,
} from './identity';
import { promptForName } from './namePrompt';

const SEND_INTERVAL_MS = 100; // 10 Hz, matches server broadcast cadence.

interface MpRuntime {
  selfId: string | null;
  selfName: string;
  selfColor: number;
  remotes: Map<string, PlayerState>;
}

export function initMultiplayer(ctx: GameContext): void {
  // Resolve identity. If we already have a stored name, we connect immediately.
  // Otherwise we connect with a random fallback name AND show the prompt — if
  // the player types something, we update locally and re-send `hello` (the
  // server will overwrite the stored name on next join, jam scope ok).
  const stored = loadStoredName();
  const initialName = stored ?? generateRandomName();
  const initialColor = colorForName(initialName);

  const runtime: MpRuntime = {
    selfId: null,
    selfName: initialName,
    selfColor: initialColor,
    remotes: new Map(),
  };

  // ---- DOM: party panel ----
  const partyPanel = buildPartyPanel(ctx.uiRoot);
  partyPanel.setSelf(initialName, initialColor);
  partyPanel.setStatus('connecting');

  // ---- Ghost manager (remote player meshes + labels) ----
  const ghosts = new GhostManager(ctx.scene, ctx.uiRoot, (id) => {
    // Clicking a label or mesh toggles party membership locally.
    togglePartyMember(id);
    refreshRoster();
  });

  // ---- Connection ----
  const conn = new Connection({
    onWelcome: (msg) => {
      runtime.selfId = msg.selfId;
      console.log(`[multiplayer] connected to room "${msg.room}" as ${msg.selfId} (host=${debugHost()})`);
      // The welcome message includes a snapshot of current players. Apply it
      // immediately so the first frame shows everyone already in the hub.
      applySnapshot(msg.snapshot.players);
    },
    onState: (msg) => {
      applySnapshot(msg.snapshot.players);
    },
    onKicked: (msg) => {
      console.warn(`[multiplayer] kicked: ${msg.reason}`);
      gameState.multiplayerConnected = false;
      partyPanel.setStatus('failed');
      ghosts.destroyAll();
      runtime.remotes.clear();
      refreshRoster();
    },
    onStatus: (status) => {
      switch (status) {
        case 'open':
          gameState.multiplayerConnected = true;
          partyPanel.setStatus('open');
          // Send hello on every (re)open. Jam-acceptable: the server will
          // create a fresh PlayerState if one didn't exist.
          conn.send({ type: 'hello', name: runtime.selfName, color: runtime.selfColor });
          break;
        case 'closed':
          gameState.multiplayerConnected = false;
          partyPanel.setStatus('closed');
          break;
        case 'failed':
          gameState.multiplayerConnected = false;
          partyPanel.setStatus('failed');
          break;
        case 'connecting':
          partyPanel.setStatus('connecting');
          break;
      }
    },
  });

  // Best-effort connect. If `partysocket` is unavailable or throws synchronously
  // the Connection class already swallows it.
  try {
    conn.connect();
  } catch (err) {
    console.warn('[multiplayer] initial connect threw', err);
    partyPanel.setStatus('failed');
  }

  // ---- Optional name prompt (only if no stored name yet) ----
  if (!stored) {
    promptForName(ctx.uiRoot).then((finalName) => {
      if (finalName !== runtime.selfName) {
        runtime.selfName = finalName;
        runtime.selfColor = colorForName(finalName);
        persistName(finalName);
        partyPanel.setSelf(finalName, runtime.selfColor);
        // Re-announce identity. The relay accepts `hello` at any point.
        conn.send({ type: 'hello', name: finalName, color: runtime.selfColor });
      }
    }).catch((err) => console.warn('[multiplayer] name prompt failed', err));
  }

  // ---- 10 Hz send loop (decoupled from the render frame) ----
  const sendTimer = setInterval(() => {
    try {
      const player = gameState.player;
      if (!player) return;
      if (!gameState.multiplayerConnected) return;
      const p = player.object3d.position;
      const r = player.object3d.rotation;
      conn.send({
        type: 'input',
        pos: [p.x, p.y, p.z],
        rot: [r.x, r.y, r.z],
      });
    } catch (err) {
      console.warn('[multiplayer] send tick failed', err);
    }
  }, SEND_INTERVAL_MS);

  // ---- Per-frame: lerp ghosts, reproject labels ----
  ctx.world.addSystem(() => {
    try {
      const partySet = new Set(gameState.partyMemberIds);
      ghosts.update(ctx.camera, partySet);
    } catch (err) {
      console.warn('[multiplayer] ghost update failed', err);
    }
  });

  // ---- Click-to-invite (raycast against ghost meshes) ----
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const onPointerDown = (ev: PointerEvent): void => {
    try {
      // Only act on left click.
      if (ev.button !== 0) return;
      const rect = ctx.canvas.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, ctx.camera);
      const meshes = ghosts.meshList();
      if (meshes.length === 0) return;
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length === 0) return;
      const hit = hits[0]!;
      const id = (hit.object.userData as { ghostId?: string }).ghostId;
      if (!id) return;
      // Silent toggle — keeps the click feel snappy. The party panel
      // reflects the change immediately.
      togglePartyMember(id);
      refreshRoster();
      // Stop propagation so the ARPG's click-to-move doesn't fire on the same
      // press. Multiplayer click claims the input.
      ev.stopPropagation();
      ev.preventDefault();
    } catch (err) {
      console.warn('[multiplayer] raycast failed', err);
    }
  };
  // Capture phase so we run before move-handlers attached to canvas/document.
  ctx.canvas.addEventListener('pointerdown', onPointerDown, { capture: true });

  // ---- Window unload: clean shutdown ----
  const onUnload = (): void => {
    try { conn.close(); } catch { /* noop */ }
  };
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('pagehide', onUnload);

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  function applySnapshot(players: PlayerState[]): void {
    const present = new Set<string>();
    runtime.remotes.clear();
    for (const p of players) {
      if (p.id === runtime.selfId) continue; // skip ourselves
      present.add(p.id);
      runtime.remotes.set(p.id, p);
      ghosts.upsert(p);
    }
    ghosts.reconcile(present);
    // Prune party ids whose owners have left.
    const before = gameState.partyMemberIds.length;
    gameState.partyMemberIds = gameState.partyMemberIds.filter((id) => present.has(id));
    if (gameState.partyMemberIds.length !== before) {
      // roster will refresh below
    }
    refreshRoster();
  }

  function refreshRoster(): void {
    partyPanel.setRoster(Array.from(runtime.remotes.values()));
  }

  function togglePartyMember(id: string): void {
    const ids = gameState.partyMemberIds;
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
  }

  // Reference the room name so tooling/dead-code checks don't drop it; useful
  // for future multi-room work.
  void HUB_ROOM;
  // sendTimer captured by closure for unload cleanup — clear on unload too.
  window.addEventListener('beforeunload', () => clearInterval(sendTimer));
}
