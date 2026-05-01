import * as THREE from 'three';
import type { UniverseHandle } from './galaxy';
import type { LayerState } from './types';

export type LabelKind = 'system' | 'planet' | 'moon' | 'galaxy';

interface Label {
  id: string;        // unique within scene: e.g. "sys:abc"
  kind: LabelKind;
  // For 'galaxy' labels, systemId is empty and galaxyId carries the link.
  systemId: string;
  galaxyId: string;
  planetId: string | null;
  moonId: string | null;
  worldNode: THREE.Object3D;
  el: HTMLDivElement;
  colorDot: HTMLSpanElement;
  textEl: HTMLSpanElement;
  baseText: string;  // unprefixed name, kept so home markers can re-render cleanly
}

export interface RemoteOwner {
  name: string;
  color: string;
}

export interface HomeMarkerOpts {
  homePlanetId: string;
  homeSystemId: string;
  ownedPlanets: Set<string>;
  homeSystemFullyClaimed: boolean;
  // W6-E: the single planet that the next-annex button currently targets.
  // Empty string when no annex is queued (no unlock yet, or system fully
  // claimed). Replaces the W5 multi-planet claimable pulse — only one
  // planet pulses at a time so the player has an obvious next step.
  nextAnnexPlanetId: string;
  // W4-E: planetId whose moons are awaiting outpost selection (single planet
  // — the player's home — for now). Empty string disables the marker.
  awaitingMoonChoiceForPlanet: string;
  outpostMoonId: string | null;
  // W6-F: planets and systems claimed by other players in the relay. Each
  // entry tints its label and prefixes the owner's name so the local player
  // can tell at a glance who owns what.
  remotePlanetOwners: Map<string, RemoteOwner>;
  remoteSystemOwners: Map<string, RemoteOwner>;
}

export class LabelManager {
  private container: HTMLDivElement;
  private camera: THREE.Camera;
  private labels: Label[] = [];
  private vTmp = new THREE.Vector3();
  // W10 — non-galaxy labels are built lazily per-galaxy (system/planet/moon).
  // 100 galaxies × ~200 systems × ~6 planets × ~1.5 moons would be ~290 K DOM
  // nodes if built upfront — instead we keep galaxy labels (100 nodes) plus
  // the active galaxy's per-system labels and rebuild on galaxy switch.
  private activeGalaxyId: string | null = null;
  private universe: UniverseHandle | null = null;
  // Stash the home-marker options so a galaxy switch can replay them onto the
  // freshly-built labels without losing badges (✓ ANNEX, ★ HOME, etc.).
  private lastHomeOpts: HomeMarkerOpts | null = null;

  constructor(container: HTMLDivElement, camera: THREE.Camera) {
    this.container = container;
    this.camera = camera;
  }

  build(universe: UniverseHandle): void {
    // Wipe everything — both galaxy labels and any previously-active galaxy's
    // per-system labels.
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.universe = universe;
    this.activeGalaxyId = null;

    // Galaxy labels stay resident — there's only ~100 of them and the player
    // sees most of them in universe view.
    for (const [, gh] of universe.galaxies) {
      this.addLabel({
        id: `gx:${gh.data.id}`,
        kind: 'galaxy',
        systemId: '',
        galaxyId: gh.data.id,
        planetId: null,
        moonId: null,
        worldNode: gh.bulge.group,
        text: gh.data.name,
        color: rgbCss(gh.data.palette.bulgeColor),
      });
    }

    // Build per-system labels for the universe's currently active galaxy so
    // there's something to show on the very first frame.
    this.activateGalaxy(universe.activeGalaxyId);
  }

  // W10 — rebuild system / planet / moon labels for the freshly-active galaxy.
  // Drops the old galaxy's labels (if any) and creates the new one's. No-op
  // when the galaxy hasn't actually changed.
  activateGalaxy(galaxyId: string): void {
    if (this.activeGalaxyId === galaxyId) return;
    if (!this.universe) return;

    // Drop any non-galaxy labels — they belong to the previously-active galaxy.
    const kept: Label[] = [];
    for (const l of this.labels) {
      if (l.kind === 'galaxy') {
        kept.push(l);
      } else {
        l.el.remove();
      }
    }
    this.labels = kept;
    this.activeGalaxyId = galaxyId;

    const gh = this.universe.galaxies.get(galaxyId);
    if (!gh) return;
    for (const [, sys] of gh.systems) {
      this.addLabel({
        id: `sys:${sys.data.id}`,
        kind: 'system',
        systemId: sys.data.id,
        galaxyId,
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
          galaxyId,
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
            galaxyId,
            planetId: p.data.id,
            moonId: m.data.id,
            worldNode: m.mesh,
            text: m.data.name,
            color: rgbCss(m.data.color),
          });
        }
      }
    }

    // Replay last home markers so the freshly-built labels carry their badges.
    if (this.lastHomeOpts) this.markHome(this.lastHomeOpts);
  }

  private addLabel(p: {
    id: string;
    kind: LabelKind;
    systemId: string;
    galaxyId: string;
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
    if (p.galaxyId) el.dataset.galaxyId = p.galaxyId;
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
      galaxyId: p.galaxyId,
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
    this.lastHomeOpts = opts;
    for (const l of this.labels) {
      type Kind =
        | 'home-planet'
        | 'home-system-full'
        | 'home-system-partial'
        | 'owned-planet'
        | 'claimable-planet'
        | 'outpost-moon-active'
        | 'outpost-moon-pending'
        | 'remote-planet'
        | 'remote-system'
        | null;
      let kind: Kind = null;
      let remoteOwner: RemoteOwner | null = null;

      if (l.kind === 'planet' && l.planetId === opts.homePlanetId && opts.homePlanetId) {
        kind = 'home-planet';
      } else if (l.kind === 'planet' && l.planetId && opts.ownedPlanets.has(l.planetId)) {
        kind = 'owned-planet';
      } else if (
        l.kind === 'planet' && l.planetId &&
        l.planetId === opts.nextAnnexPlanetId && opts.nextAnnexPlanetId
      ) {
        kind = 'claimable-planet';
      } else if (l.kind === 'planet' && l.planetId && opts.remotePlanetOwners.has(l.planetId)) {
        kind = 'remote-planet';
        remoteOwner = opts.remotePlanetOwners.get(l.planetId) ?? null;
      } else if (l.kind === 'system' && l.systemId === opts.homeSystemId && opts.homeSystemId) {
        kind = opts.homeSystemFullyClaimed ? 'home-system-full' : 'home-system-partial';
      } else if (l.kind === 'system' && l.systemId && opts.remoteSystemOwners.has(l.systemId)) {
        kind = 'remote-system';
        remoteOwner = opts.remoteSystemOwners.get(l.systemId) ?? null;
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
        case 'remote-planet':
        case 'remote-system':
          prefix = remoteOwner ? `◆ ${remoteOwner.name} · ` : '';
          break;
      }
      l.textEl.textContent = prefix + l.baseText;
      l.el.dataset.home = kind ?? '';
      if (remoteOwner) {
        l.el.style.setProperty('--remote-color', remoteOwner.color);
      } else {
        l.el.style.removeProperty('--remote-color');
      }
    }
  }

  update(layer: LayerState, width: number, height: number): void {
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const camPos = this.camera.position;

    this.camera.updateMatrixWorld();

    // Galaxy view LOD: only the N nearest system labels render — keeps the
    // screen readable. Filter is per-galaxy: only systems in the active galaxy
    // count, otherwise distant remote-galaxy stars compete for label slots.
    let galaxyAllowed: Set<string> | null = null;
    if (layer.kind === 'galaxy') {
      const N = 24;
      const cands: { id: string; d: number }[] = [];
      for (const l of this.labels) {
        if (l.kind !== 'system') continue;
        if (layer.galaxyId && l.galaxyId !== layer.galaxyId) continue;
        l.worldNode.getWorldPosition(this.vTmp);
        cands.push({ id: l.id, d: this.vTmp.distanceToSquared(camPos) });
      }
      cands.sort((a, b) => a.d - b.d);
      galaxyAllowed = new Set(cands.slice(0, N).map((c) => c.id));
    }

    // W10 perf — limit visible galaxy-bulge labels in galaxy / system view to
    // the closest M others. Without this, all 99 remote galaxy labels project
    // to screen + write DOM transforms every frame.
    let bulgeLabelAllowed: Set<string> | null = null;
    if (layer.kind === 'galaxy' || layer.kind === 'system' || layer.kind === 'planet') {
      const M = 12;
      const cands: { id: string; d: number }[] = [];
      for (const l of this.labels) {
        if (l.kind !== 'galaxy') continue;
        if (l.galaxyId === layer.galaxyId) continue;
        l.worldNode.getWorldPosition(this.vTmp);
        cands.push({ id: l.id, d: this.vTmp.distanceToSquared(camPos) });
      }
      cands.sort((a, b) => a.d - b.d);
      bulgeLabelAllowed = new Set(cands.slice(0, M).map((c) => c.id));
    }

    for (const l of this.labels) {
      let visible = this.shouldShow(l, layer);
      if (visible && galaxyAllowed && l.kind === 'system' && !galaxyAllowed.has(l.id)) {
        visible = false;
      }
      if (visible && bulgeLabelAllowed && l.kind === 'galaxy' && !bulgeLabelAllowed.has(l.id)) {
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
    if (layer.kind === 'universe') {
      // Universe view: only galaxy labels.
      return l.kind === 'galaxy';
    }
    if (layer.kind === 'galaxy') {
      // System labels in the active galaxy. Other galaxies' labels also show
      // (faintly) so the player can always navigate back across galaxies.
      if (l.kind === 'galaxy') return l.galaxyId !== layer.galaxyId;
      return l.kind === 'system';
    }
    if (layer.kind === 'system') {
      if (l.kind === 'galaxy') return false;
      if (l.kind === 'system') return true; // distant + active
      if (l.kind === 'planet') return l.systemId === layer.systemId;
      return false; // moons hidden in system view
    }
    // planet view
    if (l.kind === 'galaxy') return false;
    if (l.kind === 'system') return l.systemId === layer.systemId; // single system label, will fade
    if (l.kind === 'planet') return l.systemId === layer.systemId;
    if (l.kind === 'moon') return l.systemId === layer.systemId && l.planetId === layer.planetId;
    return false;
  }

  private opacityFor(l: Label, layer: LayerState, dist: number): number {
    if (layer.kind === 'universe') {
      // Galaxy labels are always visible — they're sparse and the player needs
      // them to navigate. Soft fade only at extreme distances.
      const o = THREE.MathUtils.smoothstep(550000 - dist, 0, 200000);
      return o * 0.95;
    }
    if (layer.kind === 'galaxy') {
      // System labels within the active galaxy fade by camera distance.
      // Other-galaxy bulge labels stay faint so they don't dominate.
      if (l.kind === 'galaxy') {
        return 0.45;
      }
      const o = THREE.MathUtils.smoothstep(35000 - dist, 0, 12000);
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
