// W11 — fullscreen 2D map overlay. Three tabs (universe / galaxy / system) that
// mirror the 3D layer hierarchy so multiplayer players can locate each other
// without scanning 100 galaxies × 200 systems by hand. Click a target to fly
// the camera there. Drag to pan, wheel to zoom. Esc / × / backdrop closes.
//
// Rendered with Canvas2D — the data sets are tiny (≤ 100 galaxies, ≤ 200
// systems per galaxy, ≤ 12 planets per system) so a CPU canvas is plenty
// fast and avoids dragging Three.js into a separate render pass.

import type { LayerKind, LayerState, PlanetData, SystemData } from './types';
import type { UniverseHandle } from './galaxy';
import type { Empire } from '../empire/empire';
import type { MultiplayerClient } from '../multiplayer/client';
import type { SessionConfig } from '../multiplayer/profile';
import type { PublicPlayer } from '../multiplayer/protocol';

export type MapNavigateFn = (next: LayerState) => void;

interface MapOverlayOpts {
  host: HTMLElement;
  universe: UniverseHandle;
  empire: Empire;
  session: SessionConfig;
  navigate: MapNavigateFn;
}

type Hit =
  | { kind: 'galaxy'; galaxyId: string; tooltip: string }
  | { kind: 'system'; galaxyId: string; systemId: string; tooltip: string }
  | { kind: 'planet'; galaxyId: string; systemId: string; planetId: string; tooltip: string };

export class MapOverlay {
  private universe: UniverseHandle;
  private empire: Empire;
  private session: SessionConfig;
  private navigate: MapNavigateFn;
  private mpClient: MultiplayerClient | null = null;

  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private titleEl: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private legendEl: HTMLDivElement;
  private hoverEl: HTMLDivElement;

  private currentLayer: LayerKind = 'galaxy';
  private currentGalaxyId = 'milky-way';
  // System map default is always the player's home — clicking a system on
  // the galaxy map sets this override so they can inspect another system
  // without losing their home context. Cleared on close().
  private systemOverride: string | null = null;

  // Pan + zoom — camX/camY in world units (galaxy local XZ for galaxy/system,
  // universe XZ for the universe map). camZoom is a multiplier on the
  // fit-to-canvas base scale.
  private camX = 0;
  private camY = 0;
  private camZoom = 1;
  private isPanning = false;
  private didPan = false;
  private panStartX = 0;
  private panStartY = 0;
  private downCamX = 0;
  private downCamY = 0;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private isOpen = false;
  private renderTimer: number | null = null;

  constructor(opts: MapOverlayOpts) {
    this.universe = opts.universe;
    this.empire = opts.empire;
    this.session = opts.session;
    this.navigate = opts.navigate;

    this.wrap = document.createElement('div');
    this.wrap.className = 'gx-map-overlay';
    this.wrap.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'gx-map-header';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'gx-map-title';
    header.appendChild(this.titleEl);

    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'gx-map-tabs';
    for (const t of ['universe', 'galaxy', 'system'] as const) {
      const btn = document.createElement('button');
      btn.dataset.tab = t;
      btn.textContent = t === 'universe' ? 'Universe' : t === 'galaxy' ? 'Galaxy' : 'System';
      btn.addEventListener('click', () => this.switchTab(t));
      this.tabsEl.appendChild(btn);
    }
    header.appendChild(this.tabsEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gx-map-close';
    closeBtn.innerHTML = '×';
    closeBtn.title = 'Close (Esc)';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    this.wrap.appendChild(header);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gx-map-canvas';
    this.wrap.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.legendEl = document.createElement('div');
    this.legendEl.className = 'gx-map-legend';
    this.wrap.appendChild(this.legendEl);

    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'gx-map-hover';
    this.hoverEl.style.display = 'none';
    this.wrap.appendChild(this.hoverEl);

    const hint = document.createElement('div');
    hint.className = 'gx-map-hint';
    hint.textContent = 'Click a target to fly there · Drag to pan · Wheel to zoom · Esc to close';
    this.wrap.appendChild(hint);

    opts.host.appendChild(this.wrap);

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverEl.style.display = 'none';
      this.isPanning = false;
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Backdrop click closes (only when the click lands on .gx-map-overlay
    // itself — not on the canvas, header, or any child element).
    this.wrap.addEventListener('click', (e) => {
      if (e.target === this.wrap) this.close();
    });
  }

  setMpClient(c: MultiplayerClient | null): void {
    this.mpClient = c;
    if (this.isOpen) this.render();
  }

  // Sync the map's "active galaxy" + default tab to the 3D state. The system
  // shown in the System tab is intentionally NOT synced — it always defaults
  // to the player's home system unless explicitly overridden via a galaxy-map
  // click (see handleClick). That keeps "where am I looking on the map?"
  // separate from "where is the camera?".
  syncToLayer(layer: LayerState): void {
    if (layer.galaxyId) this.currentGalaxyId = layer.galaxyId;
    if (layer.kind === 'planet' || layer.kind === 'system') this.currentLayer = 'system';
    else if (layer.kind === 'galaxy') this.currentLayer = 'galaxy';
    else this.currentLayer = 'universe';
  }

  // Effective system shown on the System tab: the galaxy-map override if set,
  // otherwise the player's home. Read fresh on every render so a home swap
  // (e.g. MP reassignment) is picked up automatically.
  private effectiveSystemId(): string {
    return this.systemOverride ?? this.empire.state.homeSystemId;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.wrap.style.display = '';
    this.fitView();
    this.render();
    // System view animates planets along their orbits, so re-render at 5 Hz
    // while the system tab is showing. Galaxy / universe maps are static, so
    // we skip the timer for them and just re-render on input events.
    this.renderTimer = window.setInterval(() => {
      if (this.isOpen && this.currentLayer === 'system') this.render();
    }, 200);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wrap.style.display = 'none';
    // Drop the galaxy-map drill-down so a fresh open lands back on the
    // player's home system. Galaxy id stays so the Galaxy tab still opens
    // on whichever galaxy they were last looking at.
    this.systemOverride = null;
    if (this.renderTimer !== null) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  // ---- Layout -------------------------------------------------------------

  private switchTab(kind: LayerKind): void {
    if (kind === 'planet') return;
    if (kind === this.currentLayer) return;
    this.currentLayer = kind;
    this.fitView();
    this.render();
  }

  private fitView(): void {
    this.camX = 0;
    this.camY = 0;
    this.camZoom = 1;
  }

  private fitExtent(): number {
    if (this.currentLayer === 'universe') {
      let maxR = 0;
      for (const g of this.universe.data.galaxies) {
        const x = g.position[0];
        const z = g.position[2];
        const r = Math.sqrt(x * x + z * z);
        if (r > maxR) maxR = r;
      }
      return Math.max(maxR + 60000, 100000);
    }
    if (this.currentLayer === 'galaxy') {
      const gh = this.universe.galaxies.get(this.currentGalaxyId);
      return (gh?.data.radius ?? 28000) * 1.05;
    }
    const data = this.findSystemData(this.effectiveSystemId());
    if (!data) return 60;
    let outer = 8;
    for (const p of data.planets) {
      outer = Math.max(outer, p.orbitRadius * (1 + p.orbitEccentricity));
    }
    return outer * 1.1;
  }

  private computeScale(): number {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const fit = this.fitExtent();
    const baseScale = Math.min(w, h) / (fit * 2.2);
    return baseScale * this.camZoom;
  }

  private worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const s = this.computeScale();
    return {
      x: (wx - this.camX) * s + this.canvas.width / 2,
      y: (wy - this.camY) * s + this.canvas.height / 2,
    };
  }

  // ---- Input --------------------------------------------------------------

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    this.isPanning = true;
    this.didPan = false;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
    this.downCamX = this.camX;
    this.downCamY = this.camY;
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.lastMouseX = e.clientX - rect.left;
    this.lastMouseY = e.clientY - rect.top;
    if (this.isPanning) {
      const dx = e.clientX - this.panStartX;
      const dy = e.clientY - this.panStartY;
      if (dx * dx + dy * dy > 16) this.didPan = true;
      const s = this.computeScale();
      this.camX = this.downCamX - dx / s;
      this.camY = this.downCamY - dy / s;
      this.render();
    } else {
      this.updateHover();
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    const wasPanning = this.isPanning;
    this.isPanning = false;
    if (wasPanning && !this.didPan) {
      this.handleClick();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / 1.18 : 1.18;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const s = this.computeScale();
    // World coords under the cursor — keep them anchored across the zoom.
    const wx = (mx - this.canvas.width / 2) / s + this.camX;
    const wy = (my - this.canvas.height / 2) / s + this.camY;
    this.camZoom = Math.max(0.3, Math.min(40, this.camZoom * factor));
    const ns = this.computeScale();
    this.camX = wx - (mx - this.canvas.width / 2) / ns;
    this.camY = wy - (my - this.canvas.height / 2) / ns;
    this.render();
  }

  // ---- Render -------------------------------------------------------------

  render(): void {
    if (!this.isOpen) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, w, h);
    this.drawGrid(ctx, w, h);

    for (const btn of Array.from(this.tabsEl.querySelectorAll('button'))) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === this.currentLayer);
    }

    if (this.currentLayer === 'universe') {
      this.titleEl.textContent = 'Universe Map · all galaxies';
      this.renderUniverse(ctx);
    } else if (this.currentLayer === 'galaxy') {
      const gh = this.universe.galaxies.get(this.currentGalaxyId);
      this.titleEl.textContent = `Galaxy Map · ${gh?.data.name ?? '—'}`;
      this.renderGalaxy(ctx);
    } else {
      const sysId = this.effectiveSystemId();
      const data = this.findSystemData(sysId);
      const tag = this.systemOverride
        ? ' (drilled in)'
        : (sysId === this.empire.state.homeSystemId ? ' (your home)' : '');
      this.titleEl.textContent = `System Map · ${data?.name ?? '—'}${tag}`;
      this.renderSystem(ctx);
    }
    this.renderLegend();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 140, 200, 0.06)';
    ctx.lineWidth = 1;
    const step = 80;
    for (let x = 0; x <= w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- Universe map -------------------------------------------------------

  private renderUniverse(ctx: CanvasRenderingContext2D): void {
    const remoteList = this.mpClient?.remotePlayers() ?? [];
    const ownership = this.computeGalaxyOwnership(remoteList);

    for (const g of this.universe.data.galaxies) {
      const sp = this.worldToScreen(g.position[0], g.position[2]);
      const r = Math.max(4, g.radius / 1500);
      const own = ownership.get(g.id);
      const totalSystems = g.systems.length;
      const claimedCount = own?.claimedCount ?? 0;
      const pct = claimedCount / totalSystems;

      ctx.save();

      // Soft halo using the galaxy's bulge colour
      const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r * 2.6);
      grad.addColorStop(0, colorRGBA(g.palette.bulgeColor, 0.5));
      grad.addColorStop(1, colorRGBA(g.palette.bulgeColor, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();

      // Disc body
      ctx.fillStyle = colorRGBA(g.palette.armColor, 0.7);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Outer thin ring
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();

      // Claimed-fraction arc tinted by the dominant owner
      if (pct > 0 && own) {
        ctx.strokeStyle = own.dominantColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r + 3, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.stroke();
      }

      // Active galaxy gets a gold ring so the player always sees where they are
      if (g.id === this.currentGalaxyId) {
        ctx.strokeStyle = '#ffd966';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r + 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Name + percentage
      ctx.fillStyle = 'rgba(220, 230, 255, 0.92)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.name, sp.x, sp.y + r + 18);
      if (pct > 0) {
        ctx.fillStyle = 'rgba(180, 200, 255, 0.7)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(`${(pct * 100).toFixed(0)}% · ${claimedCount}/${totalSystems}`, sp.x, sp.y + r + 33);
      }
      ctx.restore();
    }
  }

  // For each galaxy, count claimed systems by anyone (self + remotes) and
  // pick the dominant owner colour. Used to tint the claimed-arc on the
  // universe map so players see at a glance which galaxies are contested.
  private computeGalaxyOwnership(remoteList: PublicPlayer[]):
    Map<string, { claimedCount: number; dominantColor: string }> {
    const buckets = new Map<string, Map<string, number>>();
    const inc = (gid: string, color: string) => {
      let m = buckets.get(gid);
      if (!m) {
        m = new Map();
        buckets.set(gid, m);
      }
      m.set(color, (m.get(color) ?? 0) + 1);
    };

    if (this.empire.state.homeClaimed) {
      const c = this.session.profile.color;
      const home = this.empire.state.homeSystemId;
      const homeG = this.universe.systemToGalaxy.get(home);
      if (homeG) inc(homeG, c);
      for (const sysId of Object.keys(this.empire.state.claimedSystems ?? {})) {
        if (sysId === home) continue;
        const g = this.universe.systemToGalaxy.get(sysId);
        if (g) inc(g, c);
      }
    }

    for (const p of remoteList) {
      const c = p.profile.color;
      if (p.state.systemId) {
        const g = this.universe.systemToGalaxy.get(p.state.systemId);
        if (g) inc(g, c);
      }
      for (const sid of Object.keys(p.state.claimedSystems ?? {})) {
        if (sid === p.state.systemId) continue;
        const g = this.universe.systemToGalaxy.get(sid);
        if (g) inc(g, c);
      }
    }

    const result = new Map<string, { claimedCount: number; dominantColor: string }>();
    for (const [gid, m] of buckets) {
      let total = 0;
      let domColor = '#ffd966';
      let domCount = 0;
      for (const [color, n] of m) {
        total += n;
        if (n > domCount) {
          domCount = n;
          domColor = color;
        }
      }
      result.set(gid, { claimedCount: total, dominantColor: domColor });
    }
    return result;
  }

  // ---- Galaxy map ---------------------------------------------------------

  private renderGalaxy(ctx: CanvasRenderingContext2D): void {
    const gh = this.universe.galaxies.get(this.currentGalaxyId);
    if (!gh) return;

    const remoteList = this.mpClient?.remotePlayers() ?? [];
    const sysOwner = this.computeSystemOwners(remoteList, this.currentGalaxyId);
    // owner name lookup so we can label each owned system on the map
    const ownerName = new Map<string, string>();
    ownerName.set(this.session.profile.color, this.session.profile.name);
    for (const p of remoteList) ownerName.set(p.profile.color, p.profile.name);
    const drilledSystemId = this.systemOverride;

    const center = this.worldToScreen(0, 0);
    const scale = this.computeScale();

    // Disc outline + black hole cue
    ctx.save();
    ctx.strokeStyle = 'rgba(160, 180, 240, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(center.x, center.y, gh.data.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const bhR = Math.max(3, gh.data.radius * 0.04 * scale);
    ctx.fillStyle = '#1a1622';
    ctx.beginPath();
    ctx.arc(center.x, center.y, bhR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#553a8e';
    ctx.beginPath();
    ctx.arc(center.x, center.y, bhR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Systems
    for (const s of gh.data.systems) {
      const p = this.worldToScreen(s.position[0], s.position[2]);
      const owner = sysOwner.get(s.id);
      const dotR = owner ? 5 : 2.4;

      ctx.save();
      if (owner) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
        g.addColorStop(0, hexAlpha(owner, 0.7));
        g.addColorStop(1, hexAlpha(owner, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = owner;
      } else {
        ctx.fillStyle = colorRGBA(s.starColor, 0.75);
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Highlight the system the player has drilled into (white ring) — so
      // they can always see which system the System tab is currently showing.
      if (s.id === drilledSystemId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Owner name label next to each owned system. Self systems get a
      // smaller "you" tag so the home indicator below stays prominent.
      if (owner) {
        const name = ownerName.get(owner) ?? '';
        if (name) {
          ctx.save();
          ctx.fillStyle = owner;
          ctx.font = '10px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.shadowColor = 'rgba(0,0,0,0.85)';
          ctx.shadowBlur = 3;
          ctx.fillText(name, p.x + 9, p.y - 6);
          ctx.restore();
        }
      }
    }

    // Show the home-system indicator with a bigger gold ring so players can
    // always find their way back from a remote galaxy view.
    const homeSysId = this.empire.state.homeSystemId;
    if (homeSysId && this.universe.systemToGalaxy.get(homeSysId) === this.currentGalaxyId) {
      const homeData = gh.data.systems.find((s) => s.id === homeSysId);
      if (homeData) {
        const p = this.worldToScreen(homeData.position[0], homeData.position[2]);
        ctx.save();
        ctx.strokeStyle = '#ffd966';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffd966';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HOME', p.x, p.y - 20);
        ctx.restore();
      }
    }
  }

  private computeSystemOwners(remoteList: PublicPlayer[], galaxyId: string): Map<string, string> {
    const out = new Map<string, string>();
    const selfColor = this.session.profile.color;
    if (this.empire.state.homeClaimed) {
      const home = this.empire.state.homeSystemId;
      if (this.universe.systemToGalaxy.get(home) === galaxyId) out.set(home, selfColor);
      for (const sid of Object.keys(this.empire.state.claimedSystems ?? {})) {
        if (this.universe.systemToGalaxy.get(sid) === galaxyId) out.set(sid, selfColor);
      }
    }
    for (const p of remoteList) {
      if (p.state.systemId && this.universe.systemToGalaxy.get(p.state.systemId) === galaxyId) {
        if (!out.has(p.state.systemId)) out.set(p.state.systemId, p.profile.color);
      }
      for (const sid of Object.keys(p.state.claimedSystems ?? {})) {
        if (this.universe.systemToGalaxy.get(sid) === galaxyId && !out.has(sid)) {
          out.set(sid, p.profile.color);
        }
      }
    }
    return out;
  }

  // ---- System map ---------------------------------------------------------

  private renderSystem(ctx: CanvasRenderingContext2D): void {
    const sysId = this.effectiveSystemId();
    const data = this.findSystemData(sysId);
    if (!data) return;

    const remoteList = this.mpClient?.remotePlayers() ?? [];
    const planetOwner = this.computePlanetOwners(remoteList);
    // owner name lookup so the System map can label each owned planet with
    // its owner's name in their own colour.
    const ownerName = new Map<string, string>();
    ownerName.set(this.session.profile.color, this.session.profile.name);
    for (const p of remoteList) ownerName.set(p.profile.color, p.profile.name);

    const center = this.worldToScreen(0, 0);
    const scale = this.computeScale();

    // Star
    ctx.save();
    const starR = Math.max(4, data.starRadius * 0.7 * scale);
    const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, starR * 3);
    grad.addColorStop(0, colorRGBA(data.starColor, 1));
    grad.addColorStop(0.5, colorRGBA(data.starColor, 0.4));
    grad.addColorStop(1, colorRGBA(data.starColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(center.x, center.y, starR * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colorRGBA(data.starColor, 1);
    ctx.beginPath();
    ctx.arc(center.x, center.y, starR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Orbit rings + planets at their current angle. Use circular orbit
    // approximation for the map — the eccentricity of in-game planets is
    // small enough that the schematic reads correctly.
    const t = performance.now() / 1000;
    for (const planet of data.planets) {
      const ringR = planet.orbitRadius * scale;
      ctx.save();
      ctx.strokeStyle = 'rgba(160, 180, 240, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(center.x, center.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const ang = planet.orbitPhase + t * planet.orbitSpeed;
      const wx = Math.cos(ang) * planet.orbitRadius;
      const wy = Math.sin(ang) * planet.orbitRadius;
      const sp = this.worldToScreen(wx, wy);

      const owner = planetOwner.get(planet.id);
      const r = Math.max(3, planet.radius * 4 * scale);

      // Planet body keeps its natural colour — owner identity is conveyed by
      // a name label above the body instead of recolouring the disc.
      ctx.save();
      ctx.fillStyle = colorRGBA(planet.primaryColor, 0.9);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Owned planets get a thin coloured outline so they're still scannable
      // from a glance, without overwriting the planet's natural colour.
      if (owner) {
        ctx.strokeStyle = owner;
        ctx.lineWidth = 2;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
      }
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Planet name (always)
      ctx.fillStyle = 'rgba(220, 230, 255, 0.88)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(planet.name, sp.x + r + 5, sp.y + 4);

      // Owner tag above the planet, in the owner's colour with a dark glow
      // so it stays legible against the bright star backdrop near the centre.
      if (owner) {
        const name = ownerName.get(owner) ?? '';
        if (name) {
          ctx.save();
          ctx.fillStyle = owner;
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 4;
          ctx.fillText(name, sp.x, sp.y - r - 6);
          ctx.restore();
        }
      }
    }
  }

  private computePlanetOwners(remoteList: PublicPlayer[]): Map<string, string> {
    const out = new Map<string, string>();
    const selfColor = this.session.profile.color;
    for (const pid of this.empire.state.ownedPlanets) out.set(pid, selfColor);
    for (const p of remoteList) {
      for (const pid of p.state.ownedPlanets) {
        if (!out.has(pid)) out.set(pid, p.profile.color);
      }
    }
    return out;
  }

  // ---- Legend -------------------------------------------------------------

  private renderLegend(): void {
    const remoteList = this.mpClient?.remotePlayers() ?? [];
    const items: { name: string; color: string; self: boolean }[] = [];
    items.push({ name: this.session.profile.name, color: this.session.profile.color, self: true });
    for (const p of remoteList) items.push({ name: p.profile.name, color: p.profile.color, self: false });

    if (items.length === 0) {
      this.legendEl.innerHTML = '';
      return;
    }
    const rows = items
      .map((it) => {
        const tag = it.self ? ' <span class="gx-map-legend-self">you</span>' : '';
        return `<div class="gx-map-legend-row">`
          + `<span class="gx-map-legend-dot" style="background:${escapeAttr(it.color)};color:${escapeAttr(it.color)}"></span>`
          + `<span>${escapeHtml(it.name)}${tag}</span>`
          + `</div>`;
      })
      .join('');
    this.legendEl.innerHTML = `<div class="gx-map-legend-title">Players</div>${rows}`;
  }

  // ---- Hover + click ------------------------------------------------------

  private updateHover(): void {
    const hit = this.hitTest(this.lastMouseX, this.lastMouseY);
    if (!hit) {
      this.hoverEl.style.display = 'none';
      this.canvas.style.cursor = 'grab';
      return;
    }
    this.canvas.style.cursor = 'pointer';
    this.hoverEl.style.display = '';
    this.hoverEl.style.left = `${this.lastMouseX + 14}px`;
    this.hoverEl.style.top = `${this.lastMouseY + 80}px`; // offset below the header
    this.hoverEl.innerHTML = hit.tooltip;
  }

  private handleClick(): void {
    const hit = this.hitTest(this.lastMouseX, this.lastMouseY);
    if (!hit) return;
    if (hit.kind === 'galaxy') {
      // Universe → Galaxy: drill in on the map without moving the camera.
      // Player still has to click a planet to commit to a fly-to.
      this.currentGalaxyId = hit.galaxyId;
      this.currentLayer = 'galaxy';
      this.fitView();
      this.render();
    } else if (hit.kind === 'system') {
      // Galaxy → System: same drill-down, sets the override so the System
      // tab shows this remote system instead of home until close().
      this.systemOverride = hit.systemId;
      this.currentLayer = 'system';
      this.fitView();
      this.render();
    } else {
      // Planet click is the only thing that actually moves the camera. This
      // is the deliberate "commit" action — close the map and fly there.
      this.navigate({ kind: 'planet', galaxyId: hit.galaxyId, systemId: hit.systemId, planetId: hit.planetId });
      this.close();
    }
  }

  private hitTest(sx: number, sy: number): Hit | null {
    if (this.currentLayer === 'universe') {
      let best: { d2: number; gid: string } | null = null;
      for (const g of this.universe.data.galaxies) {
        const p = this.worldToScreen(g.position[0], g.position[2]);
        const r = Math.max(4, g.radius / 1500);
        const dx = sx - p.x;
        const dy = sy - p.y;
        const d2 = dx * dx + dy * dy;
        const hitR = Math.max(r + 6, 14);
        if (d2 <= hitR * hitR && (best === null || d2 < best.d2)) best = { d2, gid: g.id };
      }
      if (!best) return null;
      const gd = this.universe.data.galaxies.find((g) => g.id === best!.gid);
      if (!gd) return null;
      return { kind: 'galaxy', galaxyId: best.gid, tooltip: `<strong>${escapeHtml(gd.name)}</strong><br>${gd.systems.length} systems` };
    }

    if (this.currentLayer === 'galaxy') {
      const gh = this.universe.galaxies.get(this.currentGalaxyId);
      if (!gh) return null;
      let best: { d2: number; sid: string } | null = null;
      for (const s of gh.data.systems) {
        const p = this.worldToScreen(s.position[0], s.position[2]);
        const dx = sx - p.x;
        const dy = sy - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 100 && (best === null || d2 < best.d2)) best = { d2, sid: s.id };
      }
      if (!best) return null;
      const sd = gh.data.systems.find((s) => s.id === best!.sid);
      if (!sd) return null;
      return {
        kind: 'system',
        galaxyId: this.currentGalaxyId,
        systemId: best.sid,
        tooltip: `<strong>${escapeHtml(sd.name)}</strong><br>${sd.planets.length} planets`,
      };
    }

    const sysId = this.effectiveSystemId();
    const data = this.findSystemData(sysId);
    if (!data) return null;
    const t = performance.now() / 1000;
    let best: { d2: number; planet: PlanetData } | null = null;
    for (const planet of data.planets) {
      const ang = planet.orbitPhase + t * planet.orbitSpeed;
      const wx = Math.cos(ang) * planet.orbitRadius;
      const wy = Math.sin(ang) * planet.orbitRadius;
      const sp = this.worldToScreen(wx, wy);
      const dx = sx - sp.x;
      const dy = sy - sp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= 196 && (best === null || d2 < best.d2)) best = { d2, planet };
    }
    if (!best) return null;
    const galaxyId = this.universe.systemToGalaxy.get(sysId) ?? this.currentGalaxyId;
    return {
      kind: 'planet',
      galaxyId,
      systemId: sysId,
      planetId: best.planet.id,
      tooltip: `<strong>${escapeHtml(best.planet.name)}</strong><br>${best.planet.type}`,
    };
  }

  private findSystemData(systemId: string | null): SystemData | null {
    if (!systemId) return null;
    const gid = this.universe.systemToGalaxy.get(systemId);
    if (!gid) return null;
    const galaxyData = this.universe.data.galaxies.find((g) => g.id === gid);
    if (!galaxyData) return null;
    return galaxyData.systems.find((s) => s.id === systemId) ?? null;
  }
}

function colorRGBA(c: [number, number, number], a: number): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function hexAlpha(hex: string, a: number): string {
  // Accepts #rgb, #rrggbb, or rgba(...). For simplicity we only handle #rrggbb
  // since profile colours are stored that way.
  if (hex.startsWith('#') && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return hex;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;'
      : ch === '<' ? '&lt;'
      : ch === '>' ? '&gt;'
      : ch === '"' ? '&quot;'
      : '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
