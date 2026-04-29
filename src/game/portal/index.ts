// Wave 4: Vibe Jam 2026 webring portal entry/exit.
// Renders an "outbound" arch that links to vibej.am/portal/2026 and, when the
// player arrives via ?portal=true, a "return" arch that links back to ?ref.
//
// Reuses the dungeon's portal rig builder (src/game/dungeons/portals.ts) for
// visuals so the jam portals match DUSK's gothic aesthetic with a different
// tint palette.

import { Vector3 } from 'three';
import type { GameContext } from '../state';
import { gameState } from '../state';
import { COLORS } from '../constants';
import {
  buildPortal,
  tickPortal,
  updatePortalLabel,
  type PortalRig,
} from '../dungeons/portals';
import { C, type PlayerComponent } from '../../core/components';

const VIBE_JAM_BASE = 'https://vibej.am/portal/2026';
const TRIGGER_RADIUS = 1.8;
const PORTAL_Y = 0;
const NAME_KEY = 'dusk:name';

// Tints picked to read as "jam exit" (gold/yellow) and "return arch" (cyan).
const OUTBOUND_COLOR = 0xffc040;
const RETURN_COLOR = 0x40e0ff;

// Two candidate slots; we shift the outbound one if the return arch occupies it.
const SLOT_A = new Vector3(-15, PORTAL_Y, -15);
const SLOT_B = new Vector3(15, PORTAL_Y, -15);

interface PortalArrival {
  arrived: boolean;
  ref: string | null;
  username: string | null;
  color: string | null;
  speed: number | null;
}

function parseArrival(): PortalArrival {
  const out: PortalArrival = {
    arrived: false,
    ref: null,
    username: null,
    color: null,
    speed: null,
  };
  try {
    const params = new URLSearchParams(window.location.search);
    out.arrived = params.get('portal') === 'true';
    const ref = params.get('ref');
    if (ref && isValidUrl(ref)) out.ref = ref;
    const u = params.get('username');
    if (u) out.username = u.slice(0, 24);
    const c = params.get('color');
    if (c) out.color = c;
    const s = params.get('speed');
    if (s) {
      const n = Number(s);
      if (Number.isFinite(n)) out.speed = n;
    }
  } catch {
    // ignore — fall through with default empty arrival
  }
  return out;
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostnameOf(s: string): string {
  try {
    return new URL(s).hostname;
  } catch {
    return s;
  }
}

function colorParamToHex(raw: string): number | null {
  let h = raw.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return parseInt(h, 16);
}

function hexToCssHex(n: number): string {
  return n.toString(16).padStart(6, '0');
}

function flashScreen(durationMs: number, tint: string): void {
  const el = document.createElement('div');
  el.style.cssText = [
    'position: fixed',
    'inset: 0',
    'pointer-events: none',
    `background: ${tint}`,
    'opacity: 0',
    'transition: opacity 0.15s ease-out',
    'z-index: 9999',
  ].join(';');
  document.body.appendChild(el);
  // Force reflow then fade in.
  void el.offsetWidth;
  el.style.opacity = '0.85';
  window.setTimeout(() => {
    el.style.transition = 'opacity 0.15s ease-in';
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), 200);
  }, Math.max(0, durationMs - 150));
}

interface PortalSlot {
  rig: PortalRig;
  pos: Vector3;
  onTrigger: () => void;
  triggered: boolean;
}

export function initPortal(ctx: GameContext): void {
  const arrival = parseArrival();

  // Apply identity from query params BEFORE mp module reads localStorage.
  if (arrival.arrived) {
    if (arrival.username) {
      try {
        localStorage.setItem(NAME_KEY, arrival.username);
      } catch {
        // ignore
      }
    }

    const player = gameState.player;
    if (player) {
      const pc = player.components.get(C.Player) as PlayerComponent | undefined;
      if (pc) {
        if (arrival.username) pc.name = arrival.username;
        if (arrival.color) {
          const hex = colorParamToHex(arrival.color);
          if (hex !== null) pc.color = hex;
        }
      }
      // Drop player near the return arch slot so they spawn in the welcome area.
      const yKeep = player.object3d.position.y;
      player.object3d.position.set(SLOT_A.x + 3, yKeep, SLOT_A.z + 3);
    }
  }

  // Decide slot positions. Return portal claims SLOT_A; outbound shifts to SLOT_B.
  const useReturn = arrival.arrived && arrival.ref !== null;
  const outboundPos = useReturn ? SLOT_B : SLOT_A;
  const returnPos = SLOT_A;

  const slots: PortalSlot[] = [];

  // Outbound — always present.
  const outboundRig = buildPortal(
    {
      position: outboundPos,
      color: OUTBOUND_COLOR,
      name: 'VIBE JAM',
      state: 'active',
      facingY: Math.PI, // face roughly toward origin
    },
    ctx.uiRoot,
  );
  ctx.scene.add(outboundRig.group);

  const outboundSlot: PortalSlot = {
    rig: outboundRig,
    pos: outboundPos,
    triggered: false,
    onTrigger: () => {
      if (outboundSlot.triggered) return;
      outboundSlot.triggered = true;
      const player = gameState.player;
      let name = 'Wanderer';
      try {
        const stored = localStorage.getItem(NAME_KEY);
        if (stored) name = stored;
      } catch {
        // ignore
      }
      let colorHex: number = COLORS.player;
      if (player) {
        const pc = player.components.get(C.Player) as PlayerComponent | undefined;
        if (pc) {
          if (pc.name) name = pc.name;
          colorHex = pc.color;
        }
      }
      const ourUrl = window.location.origin + window.location.pathname;
      const url =
        VIBE_JAM_BASE +
        '?username=' +
        encodeURIComponent(name) +
        '&color=' +
        encodeURIComponent(hexToCssHex(colorHex)) +
        '&speed=8' +
        '&ref=' +
        encodeURIComponent(ourUrl);
      try {
        ctx.world.emit('audio:sfx', { id: 'portal-travel' });
      } catch {
        // audio module may not be wired; fine.
      }
      flashScreen(300, '#ffc040');
      window.setTimeout(() => {
        window.location.href = url;
      }, 280);
    },
  };
  slots.push(outboundSlot);

  // Make the outbound clickable.
  outboundRig.label.style.pointerEvents = 'auto';
  outboundRig.label.style.cursor = 'pointer';
  outboundRig.label.addEventListener('click', outboundSlot.onTrigger);

  // Return — only if we have a valid ref.
  if (useReturn && arrival.ref) {
    const refHost = hostnameOf(arrival.ref);
    const returnRig = buildPortal(
      {
        position: returnPos,
        color: RETURN_COLOR,
        name: 'BACK TO ' + refHost.toUpperCase(),
        state: 'active',
        facingY: Math.PI,
      },
      ctx.uiRoot,
    );
    ctx.scene.add(returnRig.group);

    const returnSlot: PortalSlot = {
      rig: returnRig,
      pos: returnPos,
      triggered: false,
      onTrigger: () => {
        if (returnSlot.triggered) return;
        returnSlot.triggered = true;
        try {
          ctx.world.emit('audio:sfx', { id: 'portal-travel' });
        } catch {
          // ignore
        }
        flashScreen(300, '#40e0ff');
        window.setTimeout(() => {
          window.location.href = arrival.ref as string;
        }, 280);
      },
    };
    slots.push(returnSlot);

    returnRig.label.style.pointerEvents = 'auto';
    returnRig.label.style.cursor = 'pointer';
    returnRig.label.addEventListener('click', returnSlot.onTrigger);
  }

  // Per-frame: spin discs, pulse glyphs, project labels, check proximity.
  ctx.world.addSystem((_w, frameCtx) => {
    const player = gameState.player;
    const ppos = player ? player.object3d.position : null;
    for (const slot of slots) {
      tickPortal(slot.rig, frameCtx.elapsed, frameCtx.dt);
      updatePortalLabel(slot.rig, ctx.camera, ctx.canvas);
      if (!slot.triggered && ppos) {
        const dx = ppos.x - slot.pos.x;
        const dz = ppos.z - slot.pos.z;
        if (dx * dx + dz * dz <= TRIGGER_RADIUS * TRIGGER_RADIUS) {
          slot.onTrigger();
        }
      }
    }
  });
}
