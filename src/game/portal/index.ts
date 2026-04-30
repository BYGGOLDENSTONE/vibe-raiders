// Vibe Jam 2026 webring portal — entry/exit arches.
// Self-contained: builds its own torus + label, no dependency on game modules.
// Reads ?portal=true&ref=...&username=...&color=... so visitors arriving from
// another jam game land near the return arch with their identity carried over.

import {
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  TorusGeometry,
  Vector3,
} from 'three';
import type { GameContext } from '../state';
import { gameState } from '../state';

const VIBE_JAM_BASE = 'https://vibej.am/portal/2026';
const TRIGGER_RADIUS = 1.8;
const PORTAL_Y = 1.4;
const NAME_KEY = 'gamejam:name';

const OUTBOUND_COLOR = 0xffc040;
const RETURN_COLOR = 0x40e0ff;

const SLOT_A = new Vector3(-15, PORTAL_Y, -15);
const SLOT_B = new Vector3(15, PORTAL_Y, -15);

interface PortalArrival {
  arrived: boolean;
  ref: string | null;
  username: string | null;
  color: string | null;
}

function parseArrival(): PortalArrival {
  const out: PortalArrival = { arrived: false, ref: null, username: null, color: null };
  try {
    const params = new URLSearchParams(window.location.search);
    out.arrived = params.get('portal') === 'true';
    const ref = params.get('ref');
    if (ref && isValidUrl(ref)) out.ref = ref;
    const u = params.get('username');
    if (u) out.username = u.slice(0, 24);
    const c = params.get('color');
    if (c) out.color = c;
  } catch {
    // ignore
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
  void el.offsetWidth;
  el.style.opacity = '0.85';
  window.setTimeout(() => {
    el.style.transition = 'opacity 0.15s ease-in';
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), 200);
  }, Math.max(0, durationMs - 150));
}

interface PortalRig {
  group: Object3D;
  ring: Mesh;
  light: PointLight;
  label: HTMLElement;
}

function buildPortalRig(pos: Vector3, color: number, name: string, uiRoot: HTMLElement): PortalRig {
  const group = new Object3D();
  group.position.copy(pos);

  const mat = new MeshBasicMaterial({ color });
  const ring = new Mesh(new TorusGeometry(1.4, 0.18, 16, 48), mat);
  group.add(ring);

  const light = new PointLight(color, 1.4, 8);
  group.add(light);

  const label = document.createElement('div');
  label.textContent = name;
  label.style.cssText = [
    'position: absolute',
    'transform: translate(-50%, -100%)',
    'pointer-events: auto',
    'cursor: pointer',
    "font-family: 'JetBrains Mono', monospace",
    'font-size: 11px',
    'letter-spacing: 0.22em',
    'padding: 4px 10px',
    `color: #${hexToCssHex(color)}`,
    'background: rgba(0,0,0,0.6)',
    `border: 1px solid #${hexToCssHex(color)}`,
    'border-radius: 2px',
    'z-index: 10',
    'white-space: nowrap',
    'user-select: none',
  ].join(';');
  uiRoot.appendChild(label);

  return { group, ring, light, label };
}

interface PortalSlot {
  rig: PortalRig;
  pos: Vector3;
  onTrigger: () => void;
  triggered: boolean;
}

export function initPortal(ctx: GameContext): void {
  const arrival = parseArrival();

  if (arrival.arrived && arrival.username) {
    try { localStorage.setItem(NAME_KEY, arrival.username); } catch { /* ignore */ }
  }

  const useReturn = arrival.arrived && arrival.ref !== null;
  const outboundPos = useReturn ? SLOT_B : SLOT_A;
  const returnPos = SLOT_A;

  const slots: PortalSlot[] = [];

  const outboundRig = buildPortalRig(outboundPos, OUTBOUND_COLOR, 'VIBE JAM', ctx.uiRoot);
  ctx.scene.add(outboundRig.group);

  const outboundSlot: PortalSlot = {
    rig: outboundRig,
    pos: outboundPos,
    triggered: false,
    onTrigger: () => {
      if (outboundSlot.triggered) return;
      outboundSlot.triggered = true;
      let name = 'Wanderer';
      try {
        const stored = localStorage.getItem(NAME_KEY);
        if (stored) name = stored;
      } catch { /* ignore */ }
      const colorHex = OUTBOUND_COLOR;
      const ourUrl = window.location.origin + window.location.pathname;
      const url =
        VIBE_JAM_BASE +
        '?username=' + encodeURIComponent(name) +
        '&color=' + encodeURIComponent(hexToCssHex(colorHex)) +
        '&speed=8' +
        '&ref=' + encodeURIComponent(ourUrl);
      flashScreen(300, '#ffc040');
      window.setTimeout(() => { window.location.href = url; }, 280);
    },
  };
  slots.push(outboundSlot);
  outboundRig.label.addEventListener('click', outboundSlot.onTrigger);

  if (useReturn && arrival.ref) {
    const refHost = hostnameOf(arrival.ref);
    const returnRig = buildPortalRig(returnPos, RETURN_COLOR, 'BACK TO ' + refHost.toUpperCase(), ctx.uiRoot);
    ctx.scene.add(returnRig.group);

    const returnSlot: PortalSlot = {
      rig: returnRig,
      pos: returnPos,
      triggered: false,
      onTrigger: () => {
        if (returnSlot.triggered) return;
        returnSlot.triggered = true;
        flashScreen(300, '#40e0ff');
        window.setTimeout(() => { window.location.href = arrival.ref as string; }, 280);
      },
    };
    slots.push(returnSlot);
    returnRig.label.addEventListener('click', returnSlot.onTrigger);
  }

  // Per-frame: spin rings, project labels, proximity-trigger if a player exists.
  const tmp = new Vector3();
  const tintColor = new Color();
  ctx.world.addSystem((_w, frameCtx) => {
    const w = ctx.canvas.clientWidth || window.innerWidth;
    const h = ctx.canvas.clientHeight || window.innerHeight;
    const pulse = 0.85 + Math.sin(frameCtx.elapsed * 2.4) * 0.15;
    const player = gameState.player;
    const ppos = player ? player.object3d.position : null;

    for (const slot of slots) {
      slot.rig.ring.rotation.z += frameCtx.dt * 0.6;
      slot.rig.light.intensity = 1.2 + pulse * 0.6;

      tmp.copy(slot.pos);
      tmp.y += 1.6;
      tmp.project(ctx.camera);
      const onScreen =
        tmp.z > -1 && tmp.z < 1 &&
        tmp.x > -1.2 && tmp.x < 1.2 &&
        tmp.y > -1.2 && tmp.y < 1.2;
      if (!onScreen) {
        slot.rig.label.style.display = 'none';
      } else {
        slot.rig.label.style.display = '';
        const sx = (tmp.x * 0.5 + 0.5) * w;
        const sy = (1 - (tmp.y * 0.5 + 0.5)) * h;
        slot.rig.label.style.left = sx.toFixed(1) + 'px';
        slot.rig.label.style.top = sy.toFixed(1) + 'px';
      }

      if (!slot.triggered && ppos) {
        const dx = ppos.x - slot.pos.x;
        const dz = ppos.z - slot.pos.z;
        if (dx * dx + dz * dz <= TRIGGER_RADIUS * TRIGGER_RADIUS) {
          slot.onTrigger();
        }
      }
    }
    void tintColor;
  });
}
