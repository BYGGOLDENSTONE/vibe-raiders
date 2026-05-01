import * as THREE from 'three';
import type { LayerState } from './types';
import { generateUniverse } from './generation';
import { buildUniverse, updateUniverse, setActiveSystem, setActiveGalaxy, hideAllSystemsForUniverseView, systemWorldPositionFromData, type UniverseHandle } from './galaxy';
import { prebakeBulgeTextures, setBulgeOwnerTint } from './bulge';
import { CameraController } from './camera-controller';
import { LabelManager } from './labels';
import { Picker } from './picking';
import { UI } from './ui';
import { MapOverlay } from './map-overlay';
import { Empire } from '../empire/empire';
import type { TradeSwap } from '../empire/empire';
import { ResourceHUD } from '../empire/hud';
import { UpgradePanel } from '../empire/panel';
import { RESOURCE_COLOR, RESOURCE_LABEL } from '../empire/types';
import type { SessionConfig } from '../multiplayer/profile';
import { goToVibeJamHub } from '../portal';
import { MultiplayerClient, type ConnectionStatus } from '../multiplayer/client';
import type { PublicEmpireState } from '../multiplayer/protocol';
import { Leaderboard } from '../multiplayer/leaderboard';
import type { RemoteOwner } from './labels';
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
import {
  makeWormhole,
  attachWormholeToSystem,
  updateWormhole,
  disposeWormhole,
  type WormholeHandle,
} from './wormhole';
import {
  sfxAnnex,
  sfxClick,
  sfxError,
  sfxLayerTransition,
  sfxTrade,
} from '../audio/sfx';

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
  private universe: UniverseHandle;
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
  // W7 — vortex visuals at every connected system (self home + T2 + every
  // remote player's home/T2 chain) plus thin galaxy-view lines between each
  // connected pair. Rebuilt only when the connection set changes; per-frame
  // work is just lookAt + uniform tick.
  private wormholes = new Map<string, WormholeHandle>();
  private connectionLines: THREE.LineSegments | null = null;
  private wormholeKey = '';
  // W7 — Trade Hub state. Cooldown lives on the client (60s), the relay also
  // enforces 30s as a safety net. Toasts pile up briefly on rapid trades.
  private tradeCooldownUntil = 0;
  private tradeToastLayer: HTMLDivElement | null = null;
  private state: LayerState = { kind: 'galaxy', galaxyId: 'milky-way', systemId: null, planetId: null };
  private clock = new THREE.Clock();
  private canvas: HTMLCanvasElement;
  private overlay: HTMLDivElement;
  private labelLayer: HTMLDivElement;
  private suppressPickClick = false;
  private pickDownX = 0;
  private pickDownY = 0;
  private session: SessionConfig;
  private mpClient: MultiplayerClient | null = null;
  private mpBanner: HTMLDivElement | null = null;
  private mpSpawnReady = false;
  private mpLeaderboard: Leaderboard | null = null;
  private portalHint: HTMLDivElement | null = null;
  private mapOverlay!: MapOverlay;
  private mapBtn!: HTMLButtonElement;

  constructor(host: HTMLDivElement, session: SessionConfig) {
    this.session = session;
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

    // Scene + camera. W10 — far plane bumped to 2M so the universe view
    // (camera at ~1.2M from origin) can still see galaxies in the far shell
    // (positioned out to ~900k from origin).
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, host.clientWidth / host.clientHeight, 0.05, 2000000);

    // Subtle ambient (most lighting is in planet shader)
    const ambient = new THREE.AmbientLight(0xffffff, 0.05);
    this.scene.add(ambient);

    // W9 — universe with main galaxy + 5 satellite galaxies + cosmetic
    // background discs. Build on the same seed so every player sees the same
    // universe layout.
    // W10 perf — bake the bulge spiral once into shared textures so every
    // galaxy can render with a cheap textured-quad shader instead of running
    // the procedural spiral math per-pixel × 100 bulges.
    prebakeBulgeTextures(this.renderer);
    const data = generateUniverse(GALAXY_SEED);
    this.universe = buildUniverse(this.scene, data);

    // Empire (gameplay state) — selects/loads home planet, starts the tick.
    // Mode flag drives the save-slot split so solo and multiplayer empires
    // don't trample each other's progress.
    this.empire = new Empire(data, GALAXY_SEED, this.session.mode);

    // Camera + controller — start framed on the player's homeworld so first-
    // time players land in their empire instead of staring at the galaxy from
    // 50 000 units out. Falls back to galaxy view only if bootstrap somehow
    // failed to claim a home planet.
    this.controller = new CameraController(this.camera, this.canvas);
    const homeGid = this.empire.homeGalaxyId();
    const start: LayerState = this.empire.state.homeClaimed
      ? { kind: 'planet', galaxyId: homeGid, systemId: this.empire.state.homeSystemId, planetId: this.empire.state.homePlanetId }
      : { kind: 'galaxy', galaxyId: homeGid, systemId: null, planetId: null };
    // W10 — activate the home galaxy so its systems are visible from frame 0;
    // every other galaxy stays as a bulge billboard until clicked.
    setActiveGalaxy(this.universe, homeGid);
    if (start.kind !== 'galaxy' && start.kind !== 'universe') {
      setActiveSystem(this.universe, start.systemId);
    }
    // resolveTarget reads world positions, so push the freshly-built matrices.
    this.universe.root.updateMatrixWorld(true);
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
    this.labels.build(this.universe);

    // Picker
    this.picker = new Picker(this.camera);

    // W6-H — galaxy-view-only hint pointing at the black hole. Hidden in
    // system/planet views since the proxy is only pickable from galaxy view.
    this.portalHint = document.createElement('div');
    this.portalHint.className = 'gx-portal-hint';
    this.portalHint.innerHTML =
      '<span class="gx-portal-hint-ico">🌀</span>'
      + '<span><strong>Vibe Jam Portal</strong> · click the central black hole to travel to the next game</span>';
    this.overlay.appendChild(this.portalHint);
    this.updatePortalHint();

    // UI
    this.ui = new UI(this.overlay, this.universe, (next) => this.navigateTo(next));
    this.ui.setEmpireContext(this.buildEmpireCtx());
    this.refreshHomeMarkers();
    this.ui.render(this.state);

    // W11 — fullscreen 2D map. Mirrors the 3D layer hierarchy and lets the
    // player click any galaxy / system / planet to fly there. Critical for
    // multiplayer since 100 galaxies × 200 systems is impossible to scan
    // by hand.
    this.mapOverlay = new MapOverlay({
      host: this.overlay,
      universe: this.universe,
      empire: this.empire,
      session: this.session,
      navigate: (next) => this.navigateTo(next),
    });
    this.mapOverlay.syncToLayer(this.state);

    // Map launcher button. Sits next to the HOME button so the player has
    // both navigation aids in one place.
    this.mapBtn = document.createElement('button');
    this.mapBtn.className = 'gx-map-btn';
    this.mapBtn.type = 'button';
    this.mapBtn.title = 'Open map (M)';
    this.mapBtn.innerHTML = '<span class="gx-map-btn-ico">⊞</span><span>MAP</span>';
    this.mapBtn.addEventListener('click', () => {
      sfxClick();
      this.mapOverlay.toggle();
    });
    this.overlay.appendChild(this.mapBtn);

    // Keyboard: M toggles the map, Esc closes it. Ignore key events sourced
    // from form fields so the start-screen name input still works normally.
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        sfxClick();
        this.mapOverlay.toggle();
      } else if (e.key === 'Escape' && this.mapOverlay.isVisible()) {
        e.preventDefault();
        this.mapOverlay.close();
      }
    });

    // Empire UI: upgrade modal (hidden until launched), then HUD that
    // owns the launcher button.
    this.upgradePanel = new UpgradePanel(this.overlay, this.empire);
    this.hud = new ResourceHUD(this.overlay, this.empire, this.upgradePanel);
    // W7 — Trade Hub button click goes through App so it can route to the
    // multiplayer relay (or NPC fallback in solo / when no counterpart is
    // online). The HUD just owns the button.
    this.hud.setTradeHandler(() => this.handleTradeClick());

    // Toast layer for trade banners. Lives in the overlay so it stays above
    // canvas but below modals.
    this.tradeToastLayer = document.createElement('div');
    this.tradeToastLayer.className = 'trade-toast-layer';
    this.overlay.appendChild(this.tradeToastLayer);
    this.empire.subscribe(() => {
      this.upgradePanel.refresh();
      this.hud.refresh();
      this.rebuildSurfaceIfNeeded();
      this.rebuildMoonOutpostIfNeeded();
      this.rebuildWormholesIfNeeded();
      this.refreshHomeMarkers();
      this.ui.render(this.state);
      // W11 — own ownership shifted (annex / wormhole / intergalactic). Map
      // re-renders cheaply if it's closed (early-outs in render()).
      this.mapOverlay.render();
      // W13 — galaxy bulge tint follows ownership share, including own claims
      // that haven't yet been mirrored to the relay.
      this.refreshGalaxyTints();
      this.publishMp();
    });
    this.rebuildSurfaceIfNeeded();
    this.rebuildMoonOutpostIfNeeded();
    this.rebuildWormholesIfNeeded();
    // W13 — initial bulge tint pass so the home galaxy already wears the
    // player's colour the moment the scene appears (before the first emit).
    this.refreshGalaxyTints();

    // W6-D — multiplayer wiring. Solo mode skips this entirely so the relay
    // is only opened when the player actually wants to share a galaxy.
    if (this.session.mode === 'mp') {
      this.setupMultiplayer();
    }

    // Label clicks (delegated)
    this.labelLayer.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.gx-label') as HTMLElement | null;
      if (!target) return;
      if (this.controller.isTransitioning()) return;
      const kind = target.dataset.kind ?? '';
      const sysId = target.dataset.systemId ?? '';
      const galaxyIdAttr = target.dataset.galaxyId;
      const plId = target.dataset.planetId;
      const mnId = target.dataset.moonId;
      // W9 — galaxy labels jump straight to galaxy view of the clicked galaxy.
      if (kind === 'galaxy' && galaxyIdAttr) {
        this.navigateTo({ kind: 'galaxy', galaxyId: galaxyIdAttr, systemId: null, planetId: null });
        return;
      }
      if (!sysId) return;
      // W4-E: moon-claim mode — the only thing a moon click does is claim
      // the outpost moon (when applicable). Otherwise moons aren't navigable.
      if (kind === 'moon' && mnId && this.empire.needsOutpostMoonChoice()) {
        this.empire.claimOutpostMoon(mnId);
        sfxAnnex();
        return;
      }
      const galaxyId = this.universe.systemToGalaxy.get(sysId) ?? null;
      if (kind === 'system') {
        this.navigateTo({ kind: 'system', galaxyId, systemId: sysId, planetId: null });
      } else if (kind === 'planet' && plId) {
        this.navigateTo({ kind: 'planet', galaxyId, systemId: sysId, planetId: plId });
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
    if (layer.kind === 'universe') {
      // W10 — frame the whole 100-galaxy universe. Camera sits ~1.2M from
      // origin; galaxies span out to ~900k radius. Far plane is 2M so this
      // distance is well inside the frustum.
      return { distance: 1200000, pitch: 0.85, minDist: 200000, maxDist: 1700000 };
    }
    if (layer.kind === 'galaxy') {
      // W9 — galaxy view distance scales with the active galaxy's radius so
      // small satellites frame tighter than the main 28k disc.
      const gh = layer.galaxyId ? this.universe.galaxies.get(layer.galaxyId) : null;
      const radius = gh?.data.radius ?? 28000;
      const dist = Math.max(radius * 1.8, 12000);
      return { distance: dist, pitch: 0.95, minDist: Math.max(radius * 0.18, 2400), maxDist: dist * 1.6 };
    }
    if (layer.kind === 'system') {
      // Frame the whole system based on the outermost planet's apoapsis.
      const sys = layer.systemId ? this.universe.systems.get(layer.systemId) : null;
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
    const sys = layer.systemId ? this.universe.systems.get(layer.systemId) : null;
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
    if (layer.kind === 'universe') {
      // Universe view targets the centre of the Local Group (origin).
      return { pos: new THREE.Vector3(0, 0, 0), node: null };
    }
    if (layer.kind === 'galaxy') {
      const gh = layer.galaxyId ? this.universe.galaxies.get(layer.galaxyId) : null;
      if (!gh) return { pos: new THREE.Vector3(0, 0, 0), node: null };
      const v = new THREE.Vector3();
      gh.root.getWorldPosition(v);
      return { pos: v, node: gh.root };
    }
    const sys = layer.systemId ? this.universe.systems.get(layer.systemId) : null;
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
    if (next.kind !== this.state.kind || next.systemId !== this.state.systemId
        || next.planetId !== this.state.planetId
        || next.galaxyId !== this.state.galaxyId) {
      sfxLayerTransition();
    }

    const preset = this.layerPreset(next);
    const { pos, node } = this.resolveTarget(next);

    // W10 — activate the destination galaxy first (toggles which galaxy's
    // 200-system mesh subtree is drawn). Labels rebuild for the active galaxy
    // so we never carry 100 × 200 system labels in the DOM.
    // Universe view hides ALL system meshes (the bulge billboards already
    // show each galaxy at that distance) — saves ~400 draw calls per frame.
    if (next.kind === 'universe') {
      hideAllSystemsForUniverseView(this.universe);
    } else if (next.galaxyId) {
      setActiveGalaxy(this.universe, next.galaxyId);
      this.labels.activateGalaxy(next.galaxyId);
    }
    // Activate system immediately so its planets render during the fly
    setActiveSystem(this.universe, next.systemId);

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

    // For galaxy or universe view, deactivate any active system.
    if (next.kind === 'galaxy' || next.kind === 'universe') {
      setActiveSystem(this.universe, null);
    }

    this.state = next;
    this.ui.render(this.state);
    this.mapOverlay.syncToLayer(this.state);
    this.updatePortalHint();
    // W7/W9 — connection lines render in galaxy + universe view; hidden in
    // system / planet view so they don't streak through the local scene.
    if (this.connectionLines) {
      this.connectionLines.visible = next.kind === 'galaxy' || next.kind === 'universe';
    }
  }

  private updatePortalHint(): void {
    if (!this.portalHint) return;
    this.portalHint.style.display = this.state.kind === 'galaxy' ? '' : 'none';
  }

  private handlePick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.picker.pickAt(clientX, clientY, rect, this.universe, this.state);
    if (!hit) return;

    // W6-H — clicking the central black hole jumps the player to the next
    // game in the Vibe Jam webring. Profile (name + colour) goes along with
    // them so the receiving game can render a coherent identity.
    if (hit.kind === 'portal') {
      goToVibeJamHub(this.session.profile);
      return;
    }

    // W9 — universe view: clicking a galaxy bulge enters that galaxy.
    if (hit.kind === 'galaxy' && hit.galaxyId) {
      this.navigateTo({ kind: 'galaxy', galaxyId: hit.galaxyId, systemId: null, planetId: null });
      return;
    }

    if (this.state.kind === 'galaxy' && hit.kind === 'star') {
      this.navigateTo({ kind: 'system', galaxyId: hit.galaxyId, systemId: hit.systemId, planetId: null });
      return;
    }
    if (this.state.kind === 'system') {
      if (hit.kind === 'planet' && hit.systemId === this.state.systemId) {
        this.navigateTo({ kind: 'planet', galaxyId: hit.galaxyId, systemId: hit.systemId, planetId: hit.planetId });
        return;
      }
      if (hit.kind === 'star' && hit.systemId !== this.state.systemId) {
        this.navigateTo({ kind: 'system', galaxyId: hit.galaxyId, systemId: hit.systemId, planetId: null });
        return;
      }
    }
    if (this.state.kind === 'planet') {
      if (hit.kind === 'planet' && hit.planetId !== this.state.planetId) {
        this.navigateTo({ kind: 'planet', galaxyId: hit.galaxyId, systemId: hit.systemId, planetId: hit.planetId });
        return;
      }
      if (hit.kind === 'star') {
        this.navigateTo({ kind: 'system', galaxyId: hit.galaxyId, systemId: hit.systemId, planetId: null });
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

    // W6-E — only the next-annex target pulses, so the player always knows
    // which planet they're about to claim before pressing the banner button.
    const next = this.empire.nextAnnexTarget();
    const nextAnnexPlanetId = next?.id ?? '';

    const awaitingMoon = this.empire.needsOutpostMoonChoice() ? homePlanetId : '';

    const { remotePlanets, remoteSystems } = this.buildRemoteOwners();

    this.labels.markHome({
      homePlanetId,
      homeSystemId,
      ownedPlanets: new Set(st.ownedPlanets),
      homeSystemFullyClaimed: fullClaimed,
      nextAnnexPlanetId,
      awaitingMoonChoiceForPlanet: awaitingMoon,
      outpostMoonId: st.outpostMoonId,
      remotePlanetOwners: remotePlanets,
      remoteSystemOwners: remoteSystems,
    });
    this.ui.setHomeContext({
      systemId: homeSystemId || null,
      planetId: homePlanetId || null,
      fullSystemClaimed: fullClaimed,
    });
    this.ui.setEmpireContext(this.buildEmpireCtx());
  }

  // W13 — UI banner is moon-pick only now; empire ctx is a single-field hook.
  // Annexation / wormhole / intergalactic flows are owned by the auto-expand
  // engine in src/empire/empire.ts.
  private buildEmpireCtx() {
    return {
      needsMoonChoice: this.empire.needsOutpostMoonChoice(),
    };
  }

  // Build / rebuild the home-planet surface visuals. Cheap-skips when the
  // factory and drone count haven't changed since the last call so a routine
  // upgrade purchase doesn't tear the meshes down for nothing.
  private rebuildSurfaceIfNeeded(): void {
    const planetData = this.empire.homePlanet();
    if (!planetData) return;
    const sys = this.universe.systems.get(this.empire.state.homeSystemId);
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
      const sys = this.universe.systems.get(ctx.systemId);
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

  // W7 — build the active wormhole-vortex set + galaxy-view connection lines.
  // Every connected system gets a vortex tinted by its owner's color, and
  // each (home, T2) pair gets a thin line drawn between them in galaxy view.
  // Cheap-skips when the resulting connection set hasn't changed since the
  // last call, so a routine resource tick doesn't rebuild meshes.
  private rebuildWormholesIfNeeded(): void {
    const targets = new Map<string, string>();
    // Each connection is a pair of system ids + the owner colour, used to
    // build the line segment buffer below.
    const connections: { a: string; b: string; color: string }[] = [];

    // Self contributions — only when the empire has actually opened a rift.
    if (this.empire.state.homeClaimed) {
      const selfColor = this.session.profile.color;
      const home = this.empire.state.homeSystemId;
      const hasT2 = this.empire.hasClaimedWormholeSystem();
      const hasT3 = this.empire.hasClaimedIntergalacticSystem();
      if (hasT2 || hasT3) {
        targets.set(home, selfColor);
      }
      // T2 — in-galaxy wormhole.
      for (const sysId of this.empire.wormholeSystemIds()) {
        targets.set(sysId, selfColor);
        connections.push({ a: home, b: sysId, color: selfColor });
      }
      // W9 — T3 intergalactic bridge. Connection line stretches from the home
      // system to the claimed extra-galaxy system (long thin line crossing the
      // universe view).
      for (const sysId of this.empire.intergalacticSystemIds()) {
        targets.set(sysId, selfColor);
        connections.push({ a: home, b: sysId, color: selfColor });
      }
    }

    // Remote contributions (MP). Each remote player who has claimed a T2
    // system contributes their home + every claimed T2 to the active set,
    // tinted by their profile color. Self entries take priority on overlap.
    if (this.mpClient) {
      for (const p of this.mpClient.remotePlayers()) {
        const remoteHome = p.state.systemId;
        if (!remoteHome) continue;
        const remoteT2: string[] = [];
        for (const [sid, tier] of Object.entries(p.state.claimedSystems ?? {})) {
          if (sid !== remoteHome && tier >= 2) remoteT2.push(sid);
        }
        if (remoteT2.length === 0) continue;
        if (!targets.has(remoteHome)) targets.set(remoteHome, p.profile.color);
        for (const sid of remoteT2) {
          if (!targets.has(sid)) targets.set(sid, p.profile.color);
          connections.push({ a: remoteHome, b: sid, color: p.profile.color });
        }
      }
    }

    // Cache key includes both vortex targets AND connection pairs since two
    // different connection layouts could share the same target set.
    const targetsKey = Array.from(targets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('|');
    const connectionsKey = connections
      .map((c) => `${c.a}-${c.b}-${c.color}`)
      .sort()
      .join(',');
    const key = `${targetsKey}#${connectionsKey}`;
    if (key === this.wormholeKey) return;
    this.wormholeKey = key;

    // Drop any vortex that's no longer in the active set.
    for (const [sid, handle] of this.wormholes) {
      if (!targets.has(sid)) {
        disposeWormhole(handle);
        this.wormholes.delete(sid);
      }
    }

    // Add or recolor every active entry.
    for (const [sid, color] of targets) {
      const existing = this.wormholes.get(sid);
      if (existing) {
        existing.material.uniforms.uColorInner.value = new THREE.Color(color);
        continue;
      }
      const sys = this.universe.systems.get(sid);
      if (!sys) continue;
      const handle = makeWormhole(sys.data.starRadius, color);
      attachWormholeToSystem(handle, sys);
      this.wormholes.set(sid, handle);
    }

    // Rebuild the connection-line buffer. Single LineSegments object covers
    // every connection — vertex colours so each line gets the right tint.
    if (this.connectionLines) {
      this.connectionLines.geometry.dispose();
      (this.connectionLines.material as THREE.Material).dispose();
      this.scene.remove(this.connectionLines);
      this.connectionLines = null;
    }
    if (connections.length > 0) {
      const positions: number[] = [];
      const colors: number[] = [];
      const tmp = new THREE.Vector3();
      // W9 — connection lines live at the universe-root level (so they can
      // span galaxies). Endpoints are world positions of each system's group,
      // which already accounts for the per-galaxy offset.
      this.universe.root.updateMatrixWorld(true);
      for (const c of connections) {
        // W10 — endpoints come from system meshes when the galaxy is built,
        // and from raw data (with galaxy tilt + offset) otherwise. This lets
        // T3 / remote-player connections render to galaxies the local player
        // hasn't visited yet without forcing every galaxy to be activated.
        const sa = this.universe.systems.get(c.a);
        const sb = this.universe.systems.get(c.b);
        if (sa) sa.group.getWorldPosition(tmp);
        else if (!systemWorldPositionFromData(this.universe, c.a, tmp)) continue;
        positions.push(tmp.x, tmp.y, tmp.z);
        if (sb) sb.group.getWorldPosition(tmp);
        else if (!systemWorldPositionFromData(this.universe, c.b, tmp)) continue;
        positions.push(tmp.x, tmp.y, tmp.z);
        const col = new THREE.Color(c.color);
        colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.connectionLines = new THREE.LineSegments(geo, mat);
      // Lines visible in galaxy + universe view — they help the player track
      // their multi-galaxy claims at a glance.
      this.connectionLines.visible = this.state.kind === 'galaxy' || this.state.kind === 'universe';
      this.scene.add(this.connectionLines);
    }
  }

  // Build the planet/system → owner maps used by labels + leaderboard. Returns
  // empty maps when no relay is wired up (solo mode), so the rest of the
  // pipeline works the same way regardless of mode.
  private buildRemoteOwners(): {
    remotePlanets: Map<string, RemoteOwner>;
    remoteSystems: Map<string, RemoteOwner>;
  } {
    const remotePlanets = new Map<string, RemoteOwner>();
    const remoteSystems = new Map<string, RemoteOwner>();
    if (!this.mpClient) return { remotePlanets, remoteSystems };
    for (const p of this.mpClient.remotePlayers()) {
      const owner: RemoteOwner = { name: p.profile.name, color: p.profile.color };
      if (p.state.systemId) remoteSystems.set(p.state.systemId, owner);
      for (const planetId of p.state.ownedPlanets) {
        remotePlanets.set(planetId, owner);
      }
    }
    return { remotePlanets, remoteSystems };
  }

  // ---- W6-D: Multiplayer ---------------------------------------------------

  // Open the relay connection, build a preferred-systems list (existing home
  // first, then galaxy order), and ask the server to assign a spawn system.
  // The empire stays dormant until handleSpawnAssigned fires, so the player
  // sees a "Connecting…" banner instead of a blank/black galaxy.
  private setupMultiplayer(): void {
    const host = (import.meta.env.VITE_PARTYKIT_HOST as string | undefined)
      ?? 'localhost:1999';
    this.mpBanner = this.makeMpBanner();
    this.mpClient = new MultiplayerClient(host, this.session.profile, {
      onStatusChanged: (s) => this.updateMpBanner(s),
      onSystemAssigned: (sysId) => this.handleSpawnAssigned(sysId),
      onSystemClaimFailed: (reason) => {
        if (this.mpBanner) {
          this.mpBanner.textContent = reason === 'no-systems-available'
            ? 'Galaxy is full — try again later.'
            : 'Spawn claim failed.';
          this.mpBanner.classList.add('mp-banner-error');
        }
      },
      onPlayersChanged: () => {
        // W6-F: rebuild remote-owner labels and the top-right leaderboard.
        // Leaderboard renders only the *other* players (self is excluded
        // by remotePlayers()).
        this.mpLeaderboard?.render(this.mpClient?.remotePlayers() ?? []);
        this.refreshHomeMarkers();
        // W7 — remote players' wormhole connections may have appeared or
        // shifted, so rebuild the vortex set as well.
        this.rebuildWormholesIfNeeded();
        // W11 — keep the map fresh when remote ownership changes. Cheap
        // when the overlay is closed (render() early-outs).
        this.mapOverlay.render();
      },
      onOwnershipChanged: () => {
        // W13 — server-authoritative ownership snapshot mutated. Push the
        // "taken-by-others" set to the empire engine so its auto-claim
        // picker skips occupied targets, and refresh visuals.
        this.refreshExternalOwnership();
        this.refreshHomeMarkers();
        this.refreshGalaxyTints();
        this.mapOverlay.render();
      },
      onRoundReset: () => {
        // W13 — galaxy-wide territory wipe. Empire layer resets, then we
        // re-run the spawn-claim handshake to land in a fresh home system.
        // Resources and unlocks survive — the player carries their economy
        // build into the next 30-min round.
        this.handleRoundResetMp();
      },
      onTradeMatched: ({ counterpartName, counterpartColor, asInitiator }) => {
        // W7 — actually run the swap on whichever side initiated. Counterparts
        // get a cosmetic-only banner since their resources don't change here
        // (the other player will run their own swap and broadcast their state).
        if (asInitiator) {
          const swap = this.empire.executeTrade();
          if (swap) {
            sfxTrade();
            this.showTradeToast(counterpartName, counterpartColor, swap);
          }
        } else {
          sfxTrade();
          this.showTradeNotice(counterpartName, counterpartColor);
        }
      },
      onTradeFailed: (reason) => {
        // W7 — server-side rate-limit or no counterparts. The "no-counterpart"
        // path falls back to the NPC trader so the player still gets a swap;
        // the cooldown path just shows a wait toast.
        if (reason === 'no-counterpart') {
          this.runNpcTrade();
        } else {
          sfxError();
          this.showTradeStatus('Trade hub cooling down — try again in a moment.');
        }
      },
    });
    this.mpLeaderboard = new Leaderboard(this.overlay);
    // W11 — hand the relay client to the map so it can colour systems /
    // planets / galaxies by their owner and render the players legend.
    this.mapOverlay.setMpClient(this.mpClient);

    // W13 — register the auto-claim authority gate. Empire engine routes
    // every claim attempt through this so the relay's first-come-first-served
    // ownership map stays authoritative.
    const mp = this.mpClient;
    this.empire.setAutoGate(async (claim) => {
      const wireKind: 'planet' | 't2-anchor' | 't3-anchor' =
        claim.kind === 't2-anchor' ? 't2-anchor'
        : claim.kind === 't3-anchor' ? 't3-anchor'
        : 'planet';
      return await mp.requestClaim(claim.targetId, wireKind);
    });
    this.refreshExternalOwnership();

    const preferred = this.empire.eligibleSpawnSystemIds();
    const persisted = this.empire.state.homeSystemId;
    if (persisted && preferred.includes(persisted)) {
      const i = preferred.indexOf(persisted);
      preferred.splice(i, 1);
      preferred.unshift(persisted);
    }
    this.mpClient.claimSystem(preferred);
    this.publishMp();
  }

  // W13 — push the latest "taken by other players" set into the empire so
  // its auto-claim engine never targets an occupied planet/system.
  private refreshExternalOwnership(): void {
    if (!this.mpClient) return;
    const own = this.mpClient.getOwnership();
    const me = this.mpClient.myPlayerId();
    const taken = new Set<string>();
    for (const [targetId, ownerId] of Object.entries(own)) {
      if (ownerId !== me) taken.add(targetId);
    }
    this.empire.setExternalOwnership(taken);
  }

  // W13 — tint each galaxy's bulge by its dominant owner. Counts system-level
  // ownership; the shader caps the visible blend so palette identity stays
  // readable even at full ownership. Re-run on every empire emit and every
  // ownership broadcast so the visual stays current as territory shifts.
  private refreshGalaxyTints(): void {
    const ownership: Record<string, string> = this.mpClient?.getOwnership() ?? {};
    const myId = this.mpClient ? this.mpClient.myPlayerId() : 'self';
    const myColor = this.session.profile.color;

    for (const [, gh] of this.universe.galaxies) {
      const systems = gh.data.systems;
      if (systems.length === 0) {
        setBulgeOwnerTint(gh.bulge, null, 0);
        continue;
      }
      const counts = new Map<string, number>();
      for (const s of systems) {
        const ownerId = ownership[s.id];
        if (ownerId) {
          counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
        } else if (this.empire.state.claimedSystems[s.id]) {
          counts.set(myId, (counts.get(myId) ?? 0) + 1);
        }
      }
      if (counts.size === 0) {
        setBulgeOwnerTint(gh.bulge, null, 0);
        continue;
      }
      let topId = '';
      let topCount = 0;
      for (const [id, c] of counts) {
        if (c > topCount) { topCount = c; topId = id; }
      }
      const strength = topCount / systems.length;
      let color: string = '#888';
      if (topId === myId) {
        color = myColor;
      } else if (this.mpClient) {
        const remote = this.mpClient.remotePlayers().find((p) => p.id === topId);
        if (remote) color = remote.profile.color;
      }
      setBulgeOwnerTint(gh.bulge, color, strength);
    }
  }

  // W13 — round reset broadcast handler. Wipe territory, navigate to galaxy
  // view, and re-run the spawn-claim handshake. The empire keeps resources
  // and unlocks so the player can immediately re-fund the auto-expand drones.
  private handleRoundResetMp(): void {
    this.empire.resetForNewRound();
    this.mpSpawnReady = false;
    if (this.mpBanner) {
      this.mpBanner.style.display = 'block';
      this.mpBanner.textContent = 'Round reset — finding a new spawn…';
      this.mpBanner.classList.remove('mp-banner-error');
    }
    this.refreshExternalOwnership();
    this.refreshHomeMarkers();
    if (this.mpClient) {
      const preferred = this.empire.eligibleSpawnSystemIds();
      this.mpClient.claimSystem(preferred);
    }
    this.navigateTo({
      kind: 'galaxy',
      galaxyId: this.empire.homeGalaxyId(),
      systemId: null,
      planetId: null,
    });
  }

  private handleSpawnAssigned(systemId: string): void {
    const st = this.empire.state;
    if (!st.homeClaimed) {
      this.empire.bootstrapInSystem(systemId);
      const planetId = this.empire.state.homePlanetId;
      if (planetId) {
        this.navigateTo({ kind: 'planet', galaxyId: this.empire.homeGalaxyId(), systemId, planetId });
      }
    } else if (st.homeSystemId !== systemId) {
      // Server reassigned us — our slot must have been swept while we were
      // away. Reset the empire and bootstrap into the newly assigned system.
      this.empire.reset();
      this.empire.bootstrapInSystem(systemId);
      const planetId = this.empire.state.homePlanetId;
      if (planetId) {
        this.navigateTo({ kind: 'planet', galaxyId: this.empire.homeGalaxyId(), systemId, planetId });
      }
    }
    this.mpSpawnReady = true;
    if (this.mpBanner) {
      this.mpBanner.style.display = 'none';
    }
    this.publishMp();
  }

  private publishMp(): void {
    if (!this.mpClient) return;
    const st = this.empire.state;
    const payload: PublicEmpireState = {
      systemId: st.homeClaimed ? st.homeSystemId : null,
      ownedPlanets: st.ownedPlanets,
      outpostMoonId: st.outpostMoonId,
      claimedSystems: st.claimedSystems,
      tradeHubReady: this.empire.hasUnlock('trade-hub'),
    };
    this.mpClient.publishState(payload);
  }

  // ---- W7: Trade Hub ------------------------------------------------------

  // Trade button click: in MP, ask the relay to find a counterpart; in solo
  // (or when the relay is offline / has no counterparts), run an NPC trade
  // immediately so the player always gets feedback from the click.
  private handleTradeClick(): void {
    if (!this.empire.hasUnlock('trade-hub')) return;
    if (Date.now() < this.tradeCooldownUntil) {
      sfxError();
      return;
    }
    sfxClick();
    // Tentatively start the cooldown so the button is visibly disabled while
    // we're waiting on the relay. If the trade fails for cooldown reasons
    // (server rate-limit), the toast tells the player to wait.
    this.tradeCooldownUntil = Date.now() + 60_000;
    if (this.mpClient && this.mpClient.isOnline()) {
      this.mpClient.requestTrade();
    } else {
      this.runNpcTrade();
    }
  }

  // Solo / no-counterpart fallback: trade with the "Galactic Exchange" NPC
  // at the same 2:1 ratio so the player has a deterministic offline option.
  private runNpcTrade(): void {
    const swap = this.empire.executeTrade();
    if (!swap) {
      sfxError();
      this.showTradeStatus('Not enough stockpile to trade — keep producing.');
      return;
    }
    sfxTrade();
    this.showTradeToast('Galactic Exchange', '#9be8ff', swap);
  }

  // Build a small toast describing the executed swap. Auto-dismisses after
  // 4.5s. Multiple toasts stack vertically inside trade-toast-layer.
  private showTradeToast(name: string, color: string, swap: TradeSwap): void {
    if (!this.tradeToastLayer) return;
    const toast = document.createElement('div');
    toast.className = 'trade-toast';
    const giveLabel = RESOURCE_LABEL[swap.give.resource];
    const getLabel  = RESOURCE_LABEL[swap.get.resource];
    const giveColor = RESOURCE_COLOR[swap.give.resource];
    const getColor  = RESOURCE_COLOR[swap.get.resource];
    toast.innerHTML = `
      <div class="trade-toast-eyebrow">Trade with <strong style="color:${escapeAttr(color)}">${escapeHtml(name)}</strong></div>
      <div class="trade-toast-row trade-toast-give" style="--c:${escapeAttr(giveColor)}">
        <span class="trade-toast-dot"></span>
        <span class="trade-toast-amt">−${formatTradeAmt(swap.give.amount)}</span>
        <span class="trade-toast-label">${escapeHtml(giveLabel)}</span>
      </div>
      <div class="trade-toast-row trade-toast-get" style="--c:${escapeAttr(getColor)}">
        <span class="trade-toast-dot"></span>
        <span class="trade-toast-amt">+${formatTradeAmt(swap.get.amount)}</span>
        <span class="trade-toast-label">${escapeHtml(getLabel)}</span>
      </div>
    `;
    this.tradeToastLayer.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  // W7 — counterpart-side notice. Only shown when *another* player picked us
  // as their trade counterpart; our resources don't change but the player
  // gets a heads-up that their hub was used.
  private showTradeNotice(name: string, color: string): void {
    if (!this.tradeToastLayer) return;
    const toast = document.createElement('div');
    toast.className = 'trade-toast trade-toast-notice';
    toast.innerHTML = `
      <div class="trade-toast-eyebrow">Hub used by <strong style="color:${escapeAttr(color)}">${escapeHtml(name)}</strong></div>
      <div class="trade-toast-row">
        <span class="trade-toast-amt">No resource change</span>
        <span class="trade-toast-label">cosmetic</span>
      </div>
    `;
    this.tradeToastLayer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  private showTradeStatus(text: string): void {
    if (!this.tradeToastLayer) return;
    const toast = document.createElement('div');
    toast.className = 'trade-toast trade-toast-status';
    toast.textContent = text;
    this.tradeToastLayer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  private makeMpBanner(): HTMLDivElement {
    const b = document.createElement('div');
    b.className = 'mp-status-banner';
    b.textContent = 'Connecting to galaxy…';
    this.overlay.appendChild(b);
    return b;
  }

  private updateMpBanner(status: ConnectionStatus): void {
    if (!this.mpBanner) return;
    if (status === 'open') {
      // Don't hide until spawn is ready — otherwise the banner blinks off
      // while the claim handshake is still in flight.
      if (this.mpSpawnReady) {
        this.mpBanner.style.display = 'none';
      } else {
        this.mpBanner.textContent = 'Finding your spawn system…';
      }
      this.mpBanner.classList.remove('mp-banner-error');
    } else if (status === 'connecting') {
      this.mpBanner.style.display = 'block';
      this.mpBanner.textContent = 'Connecting to galaxy…';
      this.mpBanner.classList.remove('mp-banner-error');
    } else {
      this.mpBanner.style.display = 'block';
      this.mpBanner.textContent = 'Disconnected — reconnecting…';
      this.mpBanner.classList.remove('mp-banner-error');
    }
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
    // W13 — auto-expand drone tick. Picks one target per cadence (1s base,
    // halved per Auto-Annex Drones tier), routes through the MP gate when
    // applicable, applies on accept.
    this.empire.autoClaimTick(dt);
    this.hud.update(dt);
    // W7 — trade cooldown drives the button label/state. Cheap; no save churn.
    this.hud.setTradeCooldown(this.tradeCooldownUntil - Date.now());
    // W13 — round-reset countdown chip (MP only).
    this.hud.setRoundCountdown(this.mpClient ? this.mpClient.roundCountdownMs() : null);
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
    // W7 — every active wormhole vortex spins + billboards toward the camera.
    if (this.wormholes.size > 0) {
      const camPos = this.camera.position;
      for (const handle of this.wormholes.values()) {
        updateWormhole(handle, dt, camPos);
      }
    }

    // 1. Advance the world first. Slow galactic rotation only on the active
    //    galaxy's systemsGroup (drift's invisible on the bulge billboard
    //    anyway, and rotating root would clash with the tilt baked there).
    const activeGh = this.universe.galaxies.get(this.universe.activeGalaxyId);
    if (activeGh) activeGh.systemsGroup.rotation.y += dt * 0.010;
    // Billboards (star glow, black hole halo) face the camera position from
    // the previous frame — invisible drift since the camera moves smoothly.
    const prevCamPos = this.camera.position;
    updateUniverse(this.universe, dt, prevCamPos, this.state.systemId);

    // 2. Now place the camera based on the *current* frame's world positions.
    //    This was the source of the click-to-track shimmer: when the camera
    //    read the tracked node before world advance, render saw the planet
    //    one dt ahead of the camera target.
    this.controller.update(dt);

    // 3. Background follows the new camera position so layers always envelop
    //    the view at any zoom. W10 — cosmetic distant-galaxy billboards are
    //    gone; the 100 procedural galaxies fill that role themselves.
    const camPos = this.camera.position;
    this.universe.background.skydome.position.copy(camPos);
    const layers = this.universe.background.starLayers;
    if (layers[0]) layers[0].position.copy(camPos);
    if (layers[1]) layers[1].position.copy(camPos);
    if (layers[2]) layers[2].position.copy(camPos);

    this.renderer.render(this.scene, this.camera);

    this.labels.update(this.state, window.innerWidth, window.innerHeight);

    requestAnimationFrame(this.loop);
  };
}

function formatNumber(n: number): string {
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n < 1e12) return `${(n / 1e9).toFixed(2)}B`;
  if (n < 1e15) return `${(n / 1e12).toFixed(2)}T`;
  if (n < 1e18) return `${(n / 1e15).toFixed(2)}Q`;
  if (n < 1e21) return `${(n / 1e18).toFixed(2)}Qa`;
  return `${(n / 1e21).toFixed(2)}Qi`;
}

// Shorter formatter for trade banners — drops decimals on small whole-number
// trades so a 100 → 50 swap reads as "−100 / +50" instead of "−100.0 / +50.0".
function formatTradeAmt(n: number): string {
  if (n < 100) return Math.round(n).toString();
  return formatNumber(n);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' :
    ch === '<' ? '&lt;'  :
    ch === '>' ? '&gt;'  :
    ch === '"' ? '&quot;' : '&#39;'
  );
}

function escapeAttr(s: string): string { return escapeHtml(s); }
