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
import { RESOURCE_COLOR, RESOURCE_KEYS, RESOURCE_LABEL, type ResourceBag, type ResourceKey } from '../empire/types';
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
  private session: SessionConfig;
  private mpClient: MultiplayerClient | null = null;
  private mpBanner: HTMLDivElement | null = null;
  private mpSpawnReady = false;
  private mpLeaderboard: Leaderboard | null = null;
  private portalHint: HTMLDivElement | null = null;

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
    // Mode flag drives the save-slot split so solo and multiplayer empires
    // don't trample each other's progress.
    this.empire = new Empire(data, GALAXY_SEED, this.session.mode);

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
    this.ui = new UI(this.overlay, this.galaxy, (next) => this.navigateTo(next));
    this.ui.setEmpireContext(this.buildEmpireCtx());
    this.refreshHomeMarkers();
    this.ui.render(this.state);

    // Empire UI: upgrade modal (hidden until launched), then HUD that
    // owns the launcher button.
    this.upgradePanel = new UpgradePanel(this.overlay, this.empire);
    this.hud = new ResourceHUD(this.overlay, this.empire, this.upgradePanel);
    this.empire.subscribe(() => {
      this.upgradePanel.refresh();
      this.hud.refresh();
      this.rebuildSurfaceIfNeeded();
      this.rebuildMoonOutpostIfNeeded();
      this.refreshHomeMarkers();
      this.ui.render(this.state);
      this.publishMp();
    });
    this.rebuildSurfaceIfNeeded();
    this.rebuildMoonOutpostIfNeeded();

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
    this.updatePortalHint();
  }

  private updatePortalHint(): void {
    if (!this.portalHint) return;
    this.portalHint.style.display = this.state.kind === 'galaxy' ? '' : 'none';
  }

  private handlePick(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.picker.pickAt(clientX, clientY, rect, this.galaxy, this.state);
    if (!hit) return;

    // W6-H — clicking the central black hole jumps the player to the next
    // game in the Vibe Jam webring. Profile (name + colour) goes along with
    // them so the receiving game can render a coherent identity.
    if (hit.kind === 'portal') {
      goToVibeJamHub(this.session.profile);
      return;
    }

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

  // EmpireCtx wires UI hooks (banner) to the empire layer without leaking
  // empire types into galaxy/*. Rebuilt on every emit so the ctx always sees
  // fresh state (next-target shifts, costs grow, etc).
  private buildEmpireCtx() {
    const target = this.empire.nextAnnexTarget();
    const cost = this.empire.nextAnnexCost();
    const haveBag = this.empire.state.resources;
    let nextAnnex: { planetName: string; canAfford: boolean; costHtml: string } | null = null;
    if (target && cost) {
      const canAfford = canAffordCost(cost, haveBag);
      nextAnnex = {
        planetName: target.name,
        canAfford,
        costHtml: formatCostPills(cost, haveBag),
      };
    }
    return {
      needsMoonChoice: this.empire.needsOutpostMoonChoice(),
      nextAnnex,
      claimNextAnnex: () => {
        const before = this.empire.nextAnnexTarget();
        if (!before) return;
        if (this.empire.claimNextAnnex()) {
          // Camera-drift to the freshly claimed planet so the player sees
          // their new asset spin into the rotation. Use the captured target
          // since the next call will return a different planet.
          this.navigateTo({
            kind: 'planet',
            systemId: this.empire.state.homeSystemId,
            planetId: before.id,
          });
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
      },
    });
    this.mpLeaderboard = new Leaderboard(this.overlay);

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

  private handleSpawnAssigned(systemId: string): void {
    const st = this.empire.state;
    if (!st.homeClaimed) {
      this.empire.bootstrapInSystem(systemId);
      const planetId = this.empire.state.homePlanetId;
      if (planetId) {
        this.navigateTo({ kind: 'planet', systemId, planetId });
      }
    } else if (st.homeSystemId !== systemId) {
      // Server reassigned us — our slot must have been swept while we were
      // away. Reset the empire and bootstrap into the newly assigned system.
      this.empire.reset();
      this.empire.bootstrapInSystem(systemId);
      const planetId = this.empire.state.homePlanetId;
      if (planetId) {
        this.navigateTo({ kind: 'planet', systemId, planetId });
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
    };
    this.mpClient.publishState(payload);
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

function canAffordCost(cost: Partial<ResourceBag>, have: ResourceBag): boolean {
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined || need <= 0) continue;
    if (have[k] < need) return false;
  }
  return true;
}

// Render a cost bag as inline pills, colour-coded per resource. Each pill
// shows the cost and goes red when the player can't afford that resource —
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
