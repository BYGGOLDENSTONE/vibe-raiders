import * as THREE from 'three';
import type { GalaxyHandle } from './galaxy';
import type { LayerState } from './types';

export type LabelKind = 'system' | 'planet' | 'moon';

interface Label {
  id: string;        // unique within scene: e.g. "sys:abc"
  kind: LabelKind;
  systemId: string;
  planetId: string | null;
  moonId: string | null;
  worldNode: THREE.Object3D;
  el: HTMLDivElement;
  colorDot: HTMLSpanElement;
  textEl: HTMLSpanElement;
  baseText: string;  // unprefixed name, kept so home markers can re-render cleanly
}

export interface HomeMarkerOpts {
  homePlanetId: string;
  homeSystemId: string;
  ownedPlanets: Set<string>;
  homeSystemFullyClaimed: boolean;
  // W5: planets in the home system that are still claimable via System
  // Expansion. Get an "+ ANNEX" prefix so the player sees where to click.
  claimablePlanets: Set<string>;
  // W4-E: planetId whose moons are awaiting outpost selection (single planet
  // — the player's home — for now). Empty string disables the marker.
  awaitingMoonChoiceForPlanet: string;
  outpostMoonId: string | null;
}

function tempVec(): THREE.Vector3 { return new THREE.Vector3(); }

export class LabelManager {
  private container: HTMLDivElement;
  private camera: THREE.Camera;
  private labels: Label[] = [];
  private vTmp = tempVec();

  constructor(container: HTMLDivElement, camera: THREE.Camera) {
    this.container = container;
    this.camera = camera;
  }

  build(galaxy: GalaxyHandle): void {
    // Wipe
    for (const l of this.labels) l.el.remove();
    this.labels = [];

    for (const [, sys] of galaxy.systems) {
      // System label, attached to star core
      this.addLabel({
        id: `sys:${sys.data.id}`,
        kind: 'system',
        systemId: sys.data.id,
        planetId: null,
        moonId: null,
        worldNode: sys.star.core,
        text: sys.data.name,
        color: rgbCss(sys.data.starColor),
      });

      for (const p of sys.planets) {
        this.addLabel({
          id: `pl:${sys.data.id}:${p.data.id}`,
          kind: 'planet',
          systemId: sys.data.id,
          planetId: p.data.id,
          moonId: null,
          worldNode: p.body,
          text: p.data.name,
          color: rgbCss(p.data.primaryColor),
        });
        for (const m of p.moons) {
          this.addLabel({
            id: `mn:${sys.data.id}:${p.data.id}:${m.data.id}`,
            kind: 'moon',
            systemId: sys.data.id,
            planetId: p.data.id,
            moonId: m.data.id,
            worldNode: m.mesh,
            text: m.data.name,
            color: rgbCss(m.data.color),
          });
        }
      }
    }
  }

  private addLabel(p: {
    id: string;
    kind: LabelKind;
    systemId: string;
    planetId: string | null;
    moonId: string | null;
    worldNode: THREE.Object3D;
    text: string;
    color: string;
  }): void {
    const el = document.createElement('div');
    el.className = `gx-label gx-label-${p.kind}`;
    el.dataset.id = p.id;
    el.dataset.kind = p.kind;
    el.dataset.systemId = p.systemId;
    if (p.planetId) el.dataset.planetId = p.planetId;
    if (p.moonId) el.dataset.moonId = p.moonId;

    const dot = document.createElement('span');
    dot.className = 'gx-label-dot';
    dot.style.backgroundColor = p.color;
    el.appendChild(dot);

    const text = document.createElement('span');
    text.className = 'gx-label-text';
    text.textContent = p.text;
    el.appendChild(text);

    this.container.appendChild(el);

    this.labels.push({
      id: p.id,
      kind: p.kind,
      systemId: p.systemId,
      planetId: p.planetId,
      moonId: p.moonId,
      worldNode: p.worldNode,
      el,
      colorDot: dot,
      textEl: text,
      baseText: p.text,
    });
  }

  // Update home/owned markers on existing labels. Idempotent — re-renders the
  // text from cached baseText each call, then re-prefixes per current state.
  // Call this after build() and whenever the empire's owned-planets set changes.
  markHome(opts: HomeMarkerOpts): void {
    for (const l of this.labels) {
      type Kind =
        | 'home-planet'
        | 'home-system-full'
        | 'home-system-partial'
        | 'owned-planet'
        | 'claimable-planet'
        | 'outpost-moon-active'
        | 'outpost-moon-pending'
        | null;
      let kind: Kind = null;

      if (l.kind === 'planet' && l.planetId === opts.homePlanetId && opts.homePlanetId) {
        kind = 'home-planet';
      } else if (l.kind === 'planet' && l.planetId && opts.ownedPlanets.has(l.planetId)) {
        kind = 'owned-planet';
      } else if (l.kind === 'planet' && l.planetId && opts.claimablePlanets.has(l.planetId)) {
        kind = 'claimable-planet';
      } else if (l.kind === 'system' && l.systemId === opts.homeSystemId && opts.homeSystemId) {
        kind = opts.homeSystemFullyClaimed ? 'home-system-full' : 'home-system-partial';
      } else if (
        l.kind === 'moon' &&
        l.planetId === opts.awaitingMoonChoiceForPlanet &&
        opts.awaitingMoonChoiceForPlanet
      ) {
        kind = l.moonId === opts.outpostMoonId ? 'outpost-moon-active' : 'outpost-moon-pending';
      } else if (l.kind === 'moon' && l.moonId && l.moonId === opts.outpostMoonId) {
        kind = 'outpost-moon-active';
      }

      let prefix = '';
      switch (kind) {
        case 'home-planet':         prefix = '★ HOME · '; break;
        case 'home-system-full':    prefix = '★★ HOME SYSTEM · '; break;
        case 'home-system-partial': prefix = '★ HOME · '; break;
        case 'owned-planet':        prefix = '✓ '; break;
        case 'claimable-planet':    prefix = '✦ ANNEX · '; break;
        case 'outpost-moon-pending':prefix = '◌ pick · '; break;
        case 'outpost-moon-active': prefix = '◐ outpost · '; break;
      }
      l.textEl.textContent = prefix + l.baseText;
      l.el.dataset.home = kind ?? '';
    }
  }

  update(layer: LayerState, width: number, height: number): void {
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const camPos = this.camera.position;

    this.camera.updateMatrixWorld();

    // Galaxy view LOD: only the N nearest system labels render — keeps the screen readable.
    let galaxyAllowed: Set<string> | null = null;
    if (layer.kind === 'galaxy') {
      const N = 18;
      const cands: { id: string; d: number }[] = [];
      for (const l of this.labels) {
        if (l.kind !== 'system') continue;
        l.worldNode.getWorldPosition(this.vTmp);
        cands.push({ id: l.id, d: this.vTmp.distanceToSquared(camPos) });
      }
      cands.sort((a, b) => a.d - b.d);
      galaxyAllowed = new Set(cands.slice(0, N).map((c) => c.id));
    }

    for (const l of this.labels) {
      let visible = this.shouldShow(l, layer);
      if (visible && galaxyAllowed && l.kind === 'system' && !galaxyAllowed.has(l.id)) {
        visible = false;
      }
      if (!visible) {
        if (l.el.style.display !== 'none') l.el.style.display = 'none';
        continue;
      }

      // Project world position to screen
      l.worldNode.getWorldPosition(this.vTmp);
      const dist = this.vTmp.distanceTo(camPos);
      this.vTmp.project(this.camera);

      // behind camera
      if (this.vTmp.z > 1) {
        if (l.el.style.display !== 'none') l.el.style.display = 'none';
        continue;
      }

      const sx = this.vTmp.x * halfW + halfW;
      const sy = -this.vTmp.y * halfH + halfH;

      // Distance-based opacity per label kind
      const opacity = this.opacityFor(l, layer, dist);
      if (opacity <= 0.02) {
        if (l.el.style.display !== 'none') l.el.style.display = 'none';
        continue;
      }

      l.el.style.display = '';
      l.el.style.opacity = String(opacity);
      l.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    }
  }

  private shouldShow(l: Label, layer: LayerState): boolean {
    if (layer.kind === 'galaxy') {
      return l.kind === 'system';
    }
    if (layer.kind === 'system') {
      if (l.kind === 'system') return true; // distant + active
      if (l.kind === 'planet') return l.systemId === layer.systemId;
      return false; // moons hidden in system view
    }
    // planet view
    if (l.kind === 'system') return l.systemId === layer.systemId; // single system label, will fade
    if (l.kind === 'planet') return l.systemId === layer.systemId;
    if (l.kind === 'moon') return l.systemId === layer.systemId && l.planetId === layer.planetId;
    return false;
  }

  private opacityFor(l: Label, layer: LayerState, dist: number): number {
    if (layer.kind === 'galaxy') {
      // Visible across the whole galaxy (~12k radius)
      const o = THREE.MathUtils.smoothstep(14000 - dist, 0, 4000);
      return o * 0.95;
    }
    if (layer.kind === 'system') {
      if (l.kind === 'system') {
        if (l.systemId === layer.systemId) {
          // active system label: hide when very close (planet labels take over)
          return THREE.MathUtils.smoothstep(dist, 25, 110) * 0.85;
        }
        // other systems faint, only nearby ones
        return THREE.MathUtils.smoothstep(2500 - dist, 0, 1500) * 0.35;
      }
      if (l.kind === 'planet') {
        return THREE.MathUtils.smoothstep(dist, 2, 8) * 0.95;
      }
    }
    // planet layer
    if (l.kind === 'planet') {
      if (l.planetId === layer.planetId) {
        return THREE.MathUtils.smoothstep(dist, 1.5, 5) * 0.95;
      }
      return THREE.MathUtils.smoothstep(dist, 8, 40) * 0.55;
    }
    if (l.kind === 'moon') {
      return THREE.MathUtils.smoothstep(dist, 0.6, 2.0) * 0.85;
    }
    if (l.kind === 'system') {
      return THREE.MathUtils.smoothstep(dist, 80, 250) * 0.3;
    }
    return 0;
  }
}

function rgbCss(c: [number, number, number]): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return `rgb(${r}, ${g}, ${b})`;
}
