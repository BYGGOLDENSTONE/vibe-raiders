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

    // Camera + controller
    this.controller = new CameraController(this.camera, this.canvas);
    this.controller.setLimits(2400, 24000);
    this.controller.snap({
      target: new THREE.Vector3(0, 0, 0),
      distance: 18000,
      yaw: 0.6,
      pitch: 0.95,
    });

    // Labels
    this.labels = new LabelManager(this.labelLayer, this.camera);
    this.labels.build(this.galaxy);

    // Picker
    this.picker = new Picker(this.camera);

    // UI
    this.ui = new UI(this.overlay, this.galaxy, (next) => this.navigateTo(next));
    this.ui.render(this.state);

    // Empire UI: upgrade modal (hidden until launched), then HUD that
    // owns the launcher button.
    this.upgradePanel = new UpgradePanel(this.overlay, this.empire);
    this.hud = new ResourceHUD(this.overlay, this.empire, this.upgradePanel);
    this.empire.subscribe(() => {
      this.upgradePanel.refresh();
      this.hud.refresh();
    });

    // Label clicks (delegated)
    this.labelLayer.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.gx-label') as HTMLElement | null;
      if (!target) return;
      if (this.controller.isTransitioning()) return;
      const kind = target.dataset.kind ?? '';
      const sysId = target.dataset.systemId ?? '';
      const plId = target.dataset.planetId;
      if (!sysId) return;
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
