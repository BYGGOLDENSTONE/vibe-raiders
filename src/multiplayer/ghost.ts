// Remote-player rendering — "ghost" capsules with floating name labels.
//
// Each remote player gets:
//   - one transparent capsule mesh, tinted with their color
//   - one absolutely-positioned <div> name tag projected from world space each frame
//
// We lerp position/rotation toward the latest snapshot so 10 Hz updates feel
// smooth. Label color flips to gold for party-tagged ids.
//
// Click → raycast handled in index.ts (this module only owns the visuals).

import {
  CapsuleGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { PlayerState } from '../net/protocol';

const PARTY_LABEL_COLOR = '#f0d080'; // gold for party members
const NORMAL_LABEL_COLOR = '#d8dde4'; // pale text otherwise
const SMOOTHING = 0.15;

const LABEL_STYLE_ID = 'dusk-mp-label-style';

const LABEL_CSS = `
.dusk-mp-label {
  position: absolute;
  transform: translate(-50%, -100%);
  pointer-events: auto;
  cursor: pointer;
  font-family: 'JetBrains Mono', 'Consolas', 'Menlo', monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: ${NORMAL_LABEL_COLOR};
  text-shadow: 0 1px 2px #000, 0 0 4px rgba(0,0,0,0.8);
  padding: 2px 6px;
  background: rgba(8,8,12,0.55);
  border: 1px solid rgba(74,56,32,0.6);
  border-radius: 2px;
  white-space: nowrap;
  user-select: none;
  z-index: 10;
}
.dusk-mp-label.dusk-mp-party {
  color: ${PARTY_LABEL_COLOR};
  border-color: rgba(200,160,96,0.7);
  text-shadow: 0 1px 2px #000, 0 0 6px rgba(200,160,96,0.6);
}
.dusk-mp-label-tag {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 6px;
  border: 1px solid rgba(0,0,0,0.6);
}
`;

function injectLabelStyles(): void {
  if (document.getElementById(LABEL_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = LABEL_STYLE_ID;
  s.textContent = LABEL_CSS;
  document.head.appendChild(s);
}

export interface Ghost {
  id: string;
  name: string;
  color: number;
  mesh: Mesh;
  label: HTMLElement;
  swatch: HTMLElement;
  textNode: HTMLSpanElement;
  targetPos: Vector3;
  targetRot: Vector3;
}

export class GhostManager {
  private readonly ghosts = new Map<string, Ghost>();
  private readonly tmp = new Vector3();
  private readonly scene: Scene;
  private readonly uiRoot: HTMLElement;
  private readonly onGhostClick: (id: string) => void;

  constructor(
    scene: Scene,
    uiRoot: HTMLElement,
    onGhostClick: (id: string) => void,
  ) {
    this.scene = scene;
    this.uiRoot = uiRoot;
    this.onGhostClick = onGhostClick;
    injectLabelStyles();
  }

  /**
   * All meshes — for raycasting in the click-to-invite path.
   * Each mesh has `userData.ghostId` set so the caller can recover the player id.
   */
  meshList(): Mesh[] {
    const arr: Mesh[] = [];
    for (const g of this.ghosts.values()) arr.push(g.mesh);
    return arr;
  }

  has(id: string): boolean { return this.ghosts.has(id); }

  upsert(state: PlayerState): void {
    let g = this.ghosts.get(state.id);
    if (!g) {
      g = this.create(state);
      this.ghosts.set(state.id, g);
    }
    // Update name/color if they changed (could happen on reconnect).
    if (g.name !== state.name) {
      g.name = state.name;
      g.textNode.textContent = state.name;
    }
    if (g.color !== state.color) {
      g.color = state.color;
      const mat = g.mesh.material as MeshStandardMaterial;
      mat.color.setHex(state.color);
      g.swatch.style.background = '#' + state.color.toString(16).padStart(6, '0');
    }
    g.targetPos.set(state.pos[0], state.pos[1], state.pos[2]);
    g.targetRot.set(state.rot[0], state.rot[1], state.rot[2]);
  }

  /** Despawn ghosts whose ids are not in the supplied set. */
  reconcile(present: Set<string>): void {
    for (const [id, g] of this.ghosts) {
      if (!present.has(id)) {
        this.destroy(g);
        this.ghosts.delete(id);
      }
    }
  }

  /** Per-frame: lerp toward target + reproject labels. */
  update(camera: PerspectiveCamera, partyIds: ReadonlySet<string>): void {
    const canvas = this.uiRoot.parentElement?.querySelector('canvas') ?? null;
    const w = canvas?.clientWidth ?? window.innerWidth;
    const h = canvas?.clientHeight ?? window.innerHeight;

    for (const g of this.ghosts.values()) {
      // Smooth toward latest target.
      g.mesh.position.lerp(g.targetPos, SMOOTHING);
      // Mesh's pivot is at hip — keep it sane if pos.y arrives near 0.
      g.mesh.rotation.x += (g.targetRot.x - g.mesh.rotation.x) * SMOOTHING;
      g.mesh.rotation.y += (g.targetRot.y - g.mesh.rotation.y) * SMOOTHING;
      g.mesh.rotation.z += (g.targetRot.z - g.mesh.rotation.z) * SMOOTHING;

      // Project label position. Add a head-height offset so the tag floats above.
      this.tmp.copy(g.mesh.position);
      this.tmp.y += 1.6;
      this.tmp.project(camera);

      // Cull labels that are behind the camera or far off-screen.
      const onScreen =
        this.tmp.z > -1 && this.tmp.z < 1 &&
        this.tmp.x > -1.2 && this.tmp.x < 1.2 &&
        this.tmp.y > -1.2 && this.tmp.y < 1.2;

      if (!onScreen) {
        g.label.style.display = 'none';
        continue;
      }
      g.label.style.display = '';
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (1 - (this.tmp.y * 0.5 + 0.5)) * h;
      g.label.style.left = sx.toFixed(1) + 'px';
      g.label.style.top = sy.toFixed(1) + 'px';

      const isParty = partyIds.has(g.id);
      if (isParty) g.label.classList.add('dusk-mp-party');
      else g.label.classList.remove('dusk-mp-party');
    }
  }

  destroyAll(): void {
    for (const g of this.ghosts.values()) this.destroy(g);
    this.ghosts.clear();
  }

  private create(state: PlayerState): Ghost {
    const mat = new MeshStandardMaterial({
      color: state.color,
      roughness: 0.5,
      metalness: 0.2,
      transparent: true,
      opacity: 0.78,
    });
    const mesh = new Mesh(new CapsuleGeometry(0.4, 1.0, 4, 8), mat);
    mesh.position.set(state.pos[0], state.pos[1], state.pos[2]);
    mesh.rotation.set(state.rot[0], state.rot[1], state.rot[2]);
    mesh.userData.ghostId = state.id;
    mesh.userData.remotePlayer = true;
    mesh.name = `ghost:${state.id}`;
    this.scene.add(mesh);

    const label = document.createElement('div');
    label.className = 'dusk-mp-label';
    label.dataset.ghostId = state.id;

    const swatch = document.createElement('span');
    swatch.className = 'dusk-mp-label-tag';
    swatch.style.background = '#' + state.color.toString(16).padStart(6, '0');
    label.appendChild(swatch);

    const txt = document.createElement('span');
    txt.textContent = state.name;
    label.appendChild(txt);

    label.addEventListener('click', (ev) => {
      ev.stopPropagation();
      try { this.onGhostClick(state.id); } catch (err) { console.warn('[multiplayer] label click failed', err); }
    });

    this.uiRoot.appendChild(label);

    return {
      id: state.id,
      name: state.name,
      color: state.color,
      mesh,
      label,
      swatch,
      textNode: txt,
      targetPos: new Vector3(state.pos[0], state.pos[1], state.pos[2]),
      targetRot: new Vector3(state.rot[0], state.rot[1], state.rot[2]),
    };
  }

  private destroy(g: Ghost): void {
    try { this.scene.remove(g.mesh); } catch { /* noop */ }
    try {
      const mat = g.mesh.material as MeshStandardMaterial;
      mat.dispose();
      g.mesh.geometry.dispose();
    } catch { /* noop */ }
    try { g.label.remove(); } catch { /* noop */ }
  }
}
