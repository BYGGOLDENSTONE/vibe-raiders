import * as THREE from 'three';
import type { LayerState } from './types';
import { generateGalaxy } from './generation';
import { buildGalaxy, updateGalaxy, setActiveSystem, type GalaxyHandle } from './galaxy';
import { CameraController } from './camera-controller';
import { LabelManager } from './labels';
import { Picker } from './picking';
import { UI } from './ui';
import { Empire } from '../empire/empire';
import { ResourceHUD } from '../empire/hud';
import { UpgradePanel } from '../empire/panel';
import { DebugPanel } from '../empire/debug';
import { RESOURCE_COLOR, RESOURCE_KEYS, RESOURCE_LABEL, type ResourceBag, type ResourceKey } from '../empire/types';
import { makeSurface, updateSurface, disposeSurface, surfaceConfig, type SurfaceHandle } from '../empire/surface';
import {
  makeMoonOutpost,
  updateMoonOutpost,
  disposeMoonOutpost,
  setMoonOutpostVisible,
  moonOutpostConfig,
  findOutpostMoon,
  type MoonOutpostHandle,
} from '../empire/moon-outpost';

const GALAXY_SEED = 20260430;

interface LayerCamPreset {
  distance: number;
  pitch: number;
  minDist: number;
  maxDist: number;
}

export class App {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controller: CameraController;
  private galaxy: GalaxyHandle;
  private labels: LabelManager;
  private picker: Picker;
  private ui: UI;
  private empire: Empire;
  private hud: ResourceHUD;
  private upgradePanel: UpgradePanel;
  private surface: SurfaceHandle | null = null;
  private surfaceFactoryCount = -1;
  private surfaceDroneCount = -1;
  private surfacePlanetId: string | null = null;
  private moonOutpost: MoonOutpostHandle | null = null;
  private moonOutpostHasElevator = false;
  private moonOutpostPlanetId: string | null = null;
  private moonOutpostMoonId: string | null = null;
  private state: LayerState = { kind: 'galaxy', systemId: null, planetId: null };
  private clock = new THREE.Clock();
  private canvas: HTMLCanvasElement;
  private overlay: HTMLDivElement;
  private labelLayer: HTMLDivElement;
  private suppressPickClick = false;
  private pickDownX = 0;
  private pickDownY = 0;

  constructor(host: HTMLDivElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.setClearColor(0x05060d);
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('gx-canvas');
    host.appendChild(this.canvas);

    // Overlay (UI + labels share parent)
    this.overlay = document.createElement('div');
    this.overlay.className = 'gx-overlay';
    host.appendChild(this.overlay);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'gx-labels';
    this.overlay.appendChild(this.labelLayer);

    // Scene + camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.05, 38000);

    // Subtle ambient (most lighting is in planet shader)
    const ambient = new THREE.AmbientLight(0xffffff, 0.05);
    this.scene.add(ambient);

    // Galaxy
    const data = generateGalaxy(GALAXY_SEED);
    this.galaxy = buildGalaxy(this.scene, data);

    // Empire (gameplay state) — selects/loads home planet, starts the tick.
    this.empire = new Empire(data, GALAXY_SEED);

    // Camera + controller — start framed on the player's homeworld so first-
    // time players land in their empire instead of staring at the galaxy from
    // 18 000 units out. Falls back to galaxy view only if bootstrap somehow
    // failed to claim a home planet.
    this.controller = new CameraController(this.camera, this.canvas);
    const start: LayerState = this.empire.state.homeClaimed
      ? { kind: 'planet', systemId: this.empire.state.homeSystemId, planetId: this.empire.state.homePlanetId }
      : { kind: 'galaxy', systemId: null, planetId: null };
    if (start.kind !== 'galaxy') {
      setActiveSystem(this.galaxy, start.systemId);
    }
    // resolveTarget reads world positions, so push the freshly-built matrices.
    this.galaxy.root.updateMatrixWorld(true);
    const startPreset = this.layerPreset(start);
    const startTarget = this.resolveTarget(start);
    this.controller.trackedNode = startTarget.node;
    this.controller.setLimits(startPreset.minDist, startPreset.maxDist);
    this.controller.snap({
      target: startTarget.pos,
      distance: startPreset.distance,
      yaw: 0.6,
      pitch: startPreset.pitch,
    });
    this.state = start;

    // Labels
    this.labels = new LabelManager(this.labelLayer, this.camera);
    this.labels.build(this.galaxy);

    // Picker
    this.picker = new Picker(this.camera);

    // UI
    this.ui = new UI(this.overlay, this.galaxy, (next) => this.navigateTo(next));
    this.ui.setEmpireContext(this.buildEmpireCtx());
    this.refreshHomeMarkers();
    this.ui.render(this.state);

    // Empire UI: upgrade modal (hidden until launched), then HUD that
    // owns the launcher button.
    this.upgradePanel = new UpgradePanel(this.overlay, this.empire);
    this.hud = new ResourceHUD(this.overlay, this.empire, this.upgradePanel);
    new DebugPanel(this.overlay, this.empire);
    this.empire.subscribe(() => {
      this.upgradePanel.refresh();
      this.hud.refresh();
      this.rebuildSurfaceIfNeeded();
      this.rebuildMoonOutpostIfNeeded();
      this.refreshHomeMarkers();
      this.ui.render(this.state);
    });
    this.rebuildSurfaceIfNeeded();
    this.rebuildMoonOutpostIfNeeded();

    // Label clicks (delegated)
    this.labelLayer.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.gx-label') as HTMLElement | null;
      if (!target) return;
      if (this.controller.isTransitioning()) return;
      const kind = target.dataset.kind ?? '';
      const sysId = target.dataset.systemId ?? '';
      const plId = target.dataset.planetId;
      const mnId = target.dataset.moonId;
      if (!sysId) return;
      // W4-E: moon-claim mode — the only thing a moon click does is claim
      // the outpost moon (when applicable). Otherwise moons aren't navigable.
      if (kind === 'moon' && mnId && this.empire.needsOutpostMoonChoice()) {
        this.empire.claimOutpostMoon(mnId);
        return;
      }
      if (kind === 'system') {
        this.navigateTo({ kind: 'system', systemId: sysId, planetId: null });
      } else if (kind === 'planet' && plId) {
        this.navigateTo({ kind: 'planet', systemId: sysId, planetId: plId });
      }
    });

    // Pointer click for picking
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.shiftKey) return;
      this.suppressPickClick = false;
      this.pickDownX = e.clientX;
      this.pickDownY = e.clientY;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if ((e.buttons & 1) !== 0) {
        const dx = e.clientX - this.pickDownX;
        const dy = e.clientY - this.pickDownY;
        if (dx * dx + dy * dy > 25) this.suppressPickClick = true;
      }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      if (e.shiftKey) return;
      if (this.suppressPickClick) return;
      if (this.controller.isTransitioning()) return;
      this.handlePick(e.clientX, e.clientY);
    });

    // Resize
    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    // Loop
    requestAnimationFrame(this.loop);
  }

  private layerPreset(layer: LayerState): LayerCamPreset {
    if (layer.kind === 'galaxy') {
      return { distance: 18000, pitch: 0.95, minDist: 2400, maxDist: 24000 };
    }
    if (layer.kind === 'system') {
      // Frame the whole system based on the outermost planet's apoapsis.
      const sys = layer.systemId ? this.galaxy.systems.get(layer.systemId) : null;
      let outer = 60;
      if (sys && sys.data.planets.length > 0) {
        for (const p of sys.data.planets) {
          const apo = p.orbitRadius * (1 + p.orbitEccentricity);
          outer = Math.max(outer, apo);
        }
      }
      const dist = outer * 1.55 + 24;
      return { distance: dist, pitch: 0.55, minDist: 14, maxDist: dist * 4 };
    }
    // planet — frame the whole planet system (rings + moon apoapsis), not just the body.
    const sys = layer.systemId ? this.galaxy.systems.get(layer.systemId) : null;
    const planet = sys?.planets.find((p) => p.data.id === layer.planetId);
    const r = planet ? planet.data.radius : 0.6;
    let extent = r;
    if (planet) {
      if (planet.data.hasRings) extent = Math.max(extent, planet.data.ringOuter);
      for (const m of planet.data.moons) {
        extent = Math.max(extent, m.orbitRadius * (1 + m.orbitEccentricity) + m.radius);
      }
    }
    const dist = Math.max(extent * 2.4 + 2, 3.5);
    return {
      distance: dist,
      pitch: 0.32,
      minDist: r * 1.6,
      maxDist: Math.max(extent * 12, r * 60),
    };
  }

  private resolveTarget(layer: LayerState): { pos: THREE.Vector3; node: THREE.Object3D | null } {
    if (layer.kind === 'galaxy') {
      return { pos: new THREE.Vector3(0, 0, 0), node: null };
    }
    const sys = layer.systemId ? this.galaxy.systems.get(layer.systemId) : null;
    if (!sys) return { pos: new THREE.Vector3(0, 0, 0), node: null };
    if (layer.kind === 'system') {
      const v = new THREE.Vector3();
      sys.group.getWorldPosition(v);
      return { pos: v, node: sys.group };
    }
    // planet
    const planet = sys.planets.find((p) => p.data.id === layer.planetId);
    if (!planet) {
      const v = new THREE.Vector3();
      sys.group.getWorldPosition(v);
      return { pos: v, node: sys.group };
    }
    const v = new THREE.Vector3();
    planet.body.getWorldPosition(v);
    return { pos: v, node: planet.body };
  }

  navigateTo(next: LayerState): void {
    if (this.controller.isTransitioning()) return;

    const preset = this.layerPreset(next);
    const { pos, node } = this.resolveTarget(next);

    // Activate system immediately so its planets render during the fly
    setActiveSystem(this.galaxy, next.systemId);

    // Track the destination node from the start of the transition. The
    // camera-controller refreshes the lerp endpoint each frame from the node's
    // world position, so the camera chases the moving target smoothly and
    // there's no snap when the transition completes.
    this.controller.trackedNode = node;

    this.controller.goTo(
      {
        target: pos,
        distance: preset.distance,
        yaw: this.controller.yaw,
        pitch: preset.pitch,
      },
      1.4,
      () => {
        this.controller.setLimits(preset.minDist, preset.maxDist);
      },
    );

    // For galaxy view, deactivate any active system
    if (next.kind === 'galaxy') {
      setActiveSystem(this.galaxy, null);
    }

    this.state = next;
    this.ui.render(this.state);
  }

  private handlePick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.picker.pickAt(clientX, clientY, rect, this.galaxy, this.state);
    if (!hit) return;

    if (this.state.kind === 'galaxy' && hit.kind === 'star') {
      this.navigateTo({ kind: 'system', systemId: hit.systemId, planetId: null });
      return;
    }
    if (this.state.kind === 'system') {
      if (hit.kind === 'planet' && hit.systemId === this.state.systemId) {
        this.navigateTo({ kind: 'planet', systemId: hit.systemId, planetId: hit.planetId });
        return;
      }
      if (hit.kind === 'star' && hit.systemId !== this.state.systemId) {
        this.navigateTo({ kind: 'system', systemId: hit.systemId, planetId: null });
        return;
      }
    }
    if (this.state.kind === 'planet') {
      if (hit.kind === 'planet' && hit.planetId !== this.state.planetId) {
        this.navigateTo({ kind: 'planet', systemId: hit.systemId, planetId: hit.planetId });
        return;
      }
      if (hit.kind === 'star') {
        this.navigateTo({ kind: 'system', systemId: hit.systemId, planetId: null });
        return;
      }
    }
  }

  // Push current home/owned state to the label manager and breadcrumb UI so
  // the HOME / HOME SYSTEM / annex badges stay in sync with the empire.
  private refreshHomeMarkers(): void {
    const st = this.empire.state;
    const homeSystemId = st.homeClaimed ? st.homeSystemId : '';
    const homePlanetId = st.homeClaimed ? st.homePlanetId : '';
    const fullClaimed = st.homeClaimed && this.empire.isHomeSystemFullyClaimed();

    // W5 — claimable planets light up once `system-expansion` is unlocked,
    // until every home-system planet is owned.
    const claimable = this.empire.claimableHomeSystemPlanets();
    const claimablePlanets = new Set(claimable.map((p) => p.id));

    const awaitingMoon = this.empire.needsOutpostMoonChoice() ? homePlanetId : '';

    this.labels.markHome({
      homePlanetId,
      homeSystemId,
      ownedPlanets: new Set(st.ownedPlanets),
      homeSystemFullyClaimed: fullClaimed,
      claimablePlanets,
      awaitingMoonChoiceForPlanet: awaitingMoon,
      outpostMoonId: st.outpostMoonId,
    });
    this.ui.setHomeContext({
      systemId: homeSystemId || null,
      planetId: homePlanetId || null,
      fullSystemClaimed: fullClaimed,
    });
    this.ui.setEmpireContext(this.buildEmpireCtx());
  }

  // EmpireCtx wires UI hooks (banner, panel buttons) to the empire layer
  // without leaking empire types into galaxy/*. Rebuilt on every emit so the
  // ctx always sees fresh state (canClaimPlanet returns false once owned, etc).
  private buildEmpireCtx() {
    const findPlanet = (planetId: string) => {
      for (const s of this.galaxy.data.systems) {
        for (const p of s.planets) {
          if (p.id === planetId) return p;
        }
      }
      return null;
    };
    const claimable = this.empire.claimableHomeSystemPlanets();
    return {
      needsMoonChoice: this.empire.needsOutpostMoonChoice(),
      hasClaimablePlanets: claimable.length > 0,
      canClaimPlanet: (planetId: string) => {
        const p = findPlanet(planetId);
        return !!p && this.empire.canClaimSystemPlanet(p);
      },
      claimPlanetCostHtml: (planetId: string) => {
        const p = findPlanet(planetId);
        if (!p) return '';
        return formatCostPills(this.empire.systemPlanetClaimCost(p), this.empire.state.resources);
      },
      claimPlanet: (planetId: string) => {
        if (this.empire.claimSystemPlanet(planetId)) {
          // Camera-drift to the freshly claimed planet so the player sees
          // their new asset spin into the rotation.
          const sysId = this.empire.state.homeSystemId;
          this.navigateTo({ kind: 'planet', systemId: sysId, planetId });
        }
      },
    };
  }

  // Build / rebuild the home-planet surface visuals. Cheap-skips when the
  // factory and drone count haven't changed since the last call so a routine
  // upgrade purchase doesn't tear the meshes down for nothing.
  private rebuildSurfaceIfNeeded(): void {
    const planetData = this.empire.homePlanet();
    if (!planetData) return;
    const sys = this.galaxy.systems.get(this.empire.state.homeSystemId);
    if (!sys) return;
    const planetHandle = sys.planets.find((p) => p.data.id === planetData.id);
    if (!planetHandle) return;

    const cfg = surfaceConfig(this.empire, planetData);
    const samePlanet = this.surfacePlanetId === planetData.id;
    if (
      samePlanet &&
      cfg.factoryCount === this.surfaceFactoryCount &&
      cfg.droneCount === this.surfaceDroneCount &&
      this.surface !== null
    ) {
      return;
    }

    if (this.surface) {
      disposeSurface(this.surface);
      this.surface = null;
    }
    this.surface = makeSurface(planetData, this.empire);
    planetHandle.body.add(this.surface.group);
    this.surfaceFactoryCount = cfg.factoryCount;
    this.surfaceDroneCount = cfg.droneCount;
    this.surfacePlanetId = planetData.id;
  }

  // Wave 4-B/E — moon-outpost dome + space-elevator tether on the *chosen*
  // moon. Builds only after the player has both bought `moon-outpost` and
  // clicked a moon (W4-E claim flow). Cheap-skips when nothing changed.
  private rebuildMoonOutpostIfNeeded(): void {
    const cfg = moonOutpostConfig(this.empire);
    const ctx = this.empire.outpostMoonContext();

    const samePlanet = ctx ? this.moonOutpostPlanetId === ctx.planet.id : this.moonOutpostPlanetId === null;
    const sameMoon = cfg.moonId === this.moonOutpostMoonId;
    const sameElevator = cfg.hasElevator === this.moonOutpostHasElevator;
    const wantsHandle = cfg.hasOutpost && !!ctx;
    const haveHandle = !!this.moonOutpost;

    if (sameMoon && samePlanet && sameElevator && wantsHandle === haveHandle) return;

    if (this.moonOutpost) {
      disposeMoonOutpost(this.moonOutpost);
      this.moonOutpost = null;
    }

    if (wantsHandle && ctx) {
      const sys = this.galaxy.systems.get(ctx.systemId);
      const planetHandle = sys?.planets.find((p) => p.data.id === ctx.planet.id);
      const moonHandle = planetHandle && cfg.moonId
        ? findOutpostMoon(planetHandle, cfg.moonId)
        : null;
      if (planetHandle && moonHandle) {
        const handle = makeMoonOutpost(planetHandle, moonHandle, this.empire);
        if (handle) {
          planetHandle.pivot.add(handle.planetSideGroup);
          moonHandle.mesh.add(handle.moonSideGroup);
          this.moonOutpost = handle;
        }
      }
    }

    this.moonOutpostHasElevator = cfg.hasElevator;
    this.moonOutpostPlanetId = ctx?.planet.id ?? null;
    this.moonOutpostMoonId = cfg.moonId;
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // 0. Tick empire economy (resource accumulation, autosave). Runs every
    //    frame so HUD numbers animate smoothly; the actual save throttling
    //    happens inside Empire.
    this.empire.tick(dt);
    this.hud.update(dt);
    this.upgradePanel.tickLive(performance.now());
    if (this.surface) {
      updateSurface(this.surface, dt, this.empire.computeMetrics());
    }
    if (this.moonOutpost) {
      const inHomeSystem =
        this.empire.state.homeClaimed &&
        this.state.systemId === this.empire.state.homeSystemId;
      setMoonOutpostVisible(this.moonOutpost, inHomeSystem);
      updateMoonOutpost(this.moonOutpost, dt);
    }

    // 1. Advance the world first. Slow galactic rotation around the central
    //    black hole (~10 min/revolution), then planet/moon orbits.
    this.galaxy.root.rotation.y += dt * 0.010;
    // Billboards (star glow, black hole halo) face the camera position from
    // the previous frame — invisible drift since the camera moves smoothly.
    const prevCamPos = this.camera.position;
    updateGalaxy(this.galaxy, dt, prevCamPos, this.state.systemId);

    // 2. Now place the camera based on the *current* frame's world positions.
    //    This was the source of the click-to-track shimmer: when the camera
    //    read the tracked node before world advance, render saw the planet
    //    one dt ahead of the camera target.
    this.controller.update(dt);

    // 3. Background follows the new camera position so layers always envelop
    //    the view at any zoom.
    const camPos = this.camera.position;
    this.galaxy.background.skydome.position.copy(camPos);
    const layers = this.galaxy.background.starLayers;
    if (layers[0]) layers[0].position.copy(camPos);
    if (layers[1]) layers[1].position.copy(camPos);
    if (layers[2]) layers[2].position.copy(camPos);

    this.renderer.render(this.scene, this.camera);

    this.labels.update(this.state, window.innerWidth, window.innerHeight);

    requestAnimationFrame(this.loop);
  };
}

// Render a cost bag as inline pills, colour-coded per resource. Each pill
// shows "have/need" and goes red when the player can't afford that resource —
// mirrors the upgrade-panel buy-button style so the annex flow feels familiar.
function formatCostPills(cost: Partial<ResourceBag>, have: ResourceBag): string {
  const parts: string[] = [];
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined || need <= 0) continue;
    parts.push(formatPill(k, need, have[k]));
  }
  return parts.join('');
}

function formatPill(k: ResourceKey, need: number, have: number): string {
  const ok = have >= need;
  const cls = ok ? 'gx-cost-pill ok' : 'gx-cost-pill short';
  return `<span class="${cls}" style="--c:${RESOURCE_COLOR[k]}" title="${RESOURCE_LABEL[k]}">`
    + `<span class="gx-cost-dot"></span>`
    + `<span class="gx-cost-amt">${formatNumber(need)}</span>`
    + `</span>`;
}

function formatNumber(n: number): string {
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}
