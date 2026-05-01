import type { UniverseHandle } from './galaxy';
import type { EconomyKind, LayerKind, LayerState, PlanetData, RiskLevel, SystemData } from './types';

const PLANET_TYPE_LABEL: Record<string, string> = {
  rocky:  'Rocky',
  ocean:  'Ocean',
  gas:    'Gas Giant',
  ice:    'Ice',
  lava:   'Lava',
  desert: 'Desert',
  toxic:  'Toxic',
};

const STAR_CLASS_LABEL: Record<string, string> = {
  'red-dwarf':  'Red Dwarf',
  'orange':     'Orange Star',
  'yellow':     'Yellow Star',
  'white-blue': 'White-Blue',
  'blue-giant': 'Blue Giant',
};

const ECONOMY_LABEL: Record<EconomyKind, string> = {
  'colony-core':     'Colony Core',
  'science-line':    'Science Line',
  'trade-hub':       'Trade Hub',
  'frontier-mining': 'Frontier Mining',
  'tourism-belt':    'Tourism Belt',
  'industrial':      'Industrial Hub',
  'military':        'Military Base',
  'lost-colony':     'Lost Colony',
  'empty':           'Empty System',
};

const RISK_LABEL: Record<RiskLevel, string> = {
  low:     'Low',
  medium:  'Medium',
  high:    'High',
  extreme: 'Extreme',
};

const RISK_CLASS: Record<RiskLevel, string> = {
  low: 'low', medium: 'med', high: 'hi', extreme: 'ex',
};

export type NavigateFn = (next: LayerState) => void;

interface HomeCtx {
  systemId: string | null;
  planetId: string | null;
  fullSystemClaimed: boolean;
}

// Slim hook surface UI uses to render the W4-E / W6-E / W7 claim flows without
// taking a hard dependency on Empire (keeps galaxy/* free of empire types).
export interface EmpireCtx {
  needsMoonChoice: boolean;
  // W6-E — the single auto-targeted annex. null when no annex is available
  // (system-expansion not unlocked, or every home-system planet owned).
  nextAnnex: {
    planetName: string;
    canAfford: boolean;
    costHtml: string;     // pre-formatted cost pills, same renderer as upgrades
  } | null;
  claimNextAnnex: () => void;
  // W7 — wormhole system annex. Appears only after the home system is fully
  // claimed AND wormhole-transit is unlocked AND the player hasn't claimed
  // a T2 system yet. Targets the closest unclaimed system in galaxy coords.
  nextWormhole: {
    systemName: string;
    canAfford: boolean;
    costHtml: string;
  } | null;
  claimNextWormhole: () => void;
  // W9 — intergalactic bridge. Appears once the trade-hub-era player buys the
  // intergalactic-bridge unlock. Targets the nearest unclaimed extra galaxy's
  // first eligible system at T3 (×10K multiplier). After claim, that galaxy
  // becomes the player's "second galaxy" — wormhole-transit can then push
  // them to T4 inside it.
  nextIntergalactic: {
    galaxyName: string;
    systemName: string;
    canAfford: boolean;
    costHtml: string;
  } | null;
  claimNextIntergalactic: () => void;
}

export class UI {
  private breadcrumb: HTMLDivElement;
  private switcher: HTMLDivElement;
  private homeBtn: HTMLButtonElement;
  private panel: HTMLDivElement;
  private hint: HTMLDivElement;
  private banner: HTMLDivElement;
  private universe: UniverseHandle;
  private navigate: NavigateFn;
  private home: HomeCtx = { systemId: null, planetId: null, fullSystemClaimed: false };
  private empireCtx: EmpireCtx = {
    needsMoonChoice: false,
    nextAnnex: null,
    claimNextAnnex: () => {},
    nextWormhole: null,
    claimNextWormhole: () => {},
    nextIntergalactic: null,
    claimNextIntergalactic: () => {},
  };
  private layer: LayerState = { kind: 'galaxy', galaxyId: 'milky-way', systemId: null, planetId: null };

  constructor(root: HTMLDivElement, universe: UniverseHandle, navigate: NavigateFn) {
    this.universe = universe;
    this.navigate = navigate;

    this.breadcrumb = el('div', 'gx-breadcrumb');
    root.appendChild(this.breadcrumb);

    this.switcher = el('div', 'gx-switcher');
    this.switcher.setAttribute('role', 'group');
    this.switcher.setAttribute('aria-label', 'View layer');
    root.appendChild(this.switcher);

    this.homeBtn = document.createElement('button');
    this.homeBtn.className = 'gx-home-btn';
    this.homeBtn.type = 'button';
    this.homeBtn.title = 'Jump to home planet';
    this.homeBtn.innerHTML = '<span class="gx-home-ico">★</span><span>HOME</span>';
    this.homeBtn.addEventListener('click', () => this.jumpHome());
    root.appendChild(this.homeBtn);

    this.panel = el('div', 'gx-panel');
    root.appendChild(this.panel);

    // W4-E / W5 sticky banner: announces what the player needs to do to
    // advance ("Click a moon" after Moon Outpost, "Annex planets" after
    // System Expansion).
    this.banner = el('div', 'gx-banner');
    this.banner.style.display = 'none';
    root.appendChild(this.banner);

    // W6-E + W7: banner buttons are routed by a single delegated handler.
    // Each button declares its action via a data attribute so future flows
    // (trade hub, etc.) can plug in without rewiring this listener.
    this.banner.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-claim-next]')) {
        this.empireCtx.claimNextAnnex();
        return;
      }
      if (target.closest('[data-claim-wormhole]')) {
        this.empireCtx.claimNextWormhole();
        return;
      }
      if (target.closest('[data-claim-intergalactic]')) {
        this.empireCtx.claimNextIntergalactic();
        return;
      }
    });

    this.hint = el('div', 'gx-hint');
    this.hint.innerHTML = `
      <span><strong>Left click</strong> select</span>
      <span><strong>Right click + drag</strong> orbit</span>
      <span><strong>Wheel</strong> zoom</span>
    `;
    root.appendChild(this.hint);
  }

  render(layer: LayerState): void {
    this.layer = layer;
    this.renderBreadcrumb(layer);
    this.renderSwitcher(layer);
    this.renderPanel(layer);
    this.renderHomeBtn(layer);
    this.renderBanner();
  }

  setHomeContext(home: HomeCtx): void {
    this.home = home;
  }
  setEmpireContext(ctx: EmpireCtx): void {
    this.empireCtx = ctx;
    this.renderBanner();
    this.renderPanel(this.layer);
  }

  private renderBanner(): void {
    // Banner priority: moon-pick (W4-E) over home-system annex (W6-E) over
    // wormhole annex (W7). Moon-pick is a one-shot prompt and should win;
    // home-system annex sits there for the entire expansion phase; wormhole
    // only appears once the home system is full and transit is unlocked, so
    // by then the planet-annex banner is already gone.
    let html = '';
    let extraClass = '';
    if (this.empireCtx.needsMoonChoice) {
      html = `
        <span class="gx-banner-ico">◐</span>
        <span><strong>Pick an outpost moon</strong> — open your home planet view and click one of its moons.</span>
      `;
    } else if (this.empireCtx.nextAnnex) {
      const { planetName, canAfford, costHtml } = this.empireCtx.nextAnnex;
      const btnClass = canAfford ? 'gx-annex-banner-btn ready' : 'gx-annex-banner-btn waiting';
      const btnAttrs = canAfford ? '' : 'disabled';
      html = `
        <span class="gx-banner-ico">✦</span>
        <span class="gx-banner-text">
          <span class="gx-banner-eyebrow">Next annex</span>
          <strong>${escapeHtml(planetName)}</strong>
        </span>
        <span class="gx-annex-banner-cost">${costHtml}</span>
        <button class="${btnClass}" data-claim-next ${btnAttrs}>Annex</button>
      `;
      extraClass = 'gx-banner-annex';
    } else if (this.empireCtx.nextIntergalactic) {
      // W9 — intergalactic banner takes priority over the wormhole banner
      // because it represents the next milestone after a player has already
      // claimed their T2 wormhole. The button copy makes the scale obvious.
      const { galaxyName, systemName, canAfford, costHtml } = this.empireCtx.nextIntergalactic;
      const btnClass = canAfford ? 'gx-annex-banner-btn ready' : 'gx-annex-banner-btn waiting';
      const btnAttrs = canAfford ? '' : 'disabled';
      html = `
        <span class="gx-banner-ico">✦</span>
        <span class="gx-banner-text">
          <span class="gx-banner-eyebrow">Intergalactic bridge · T3 ×10K</span>
          <strong>${escapeHtml(galaxyName)} · ${escapeHtml(systemName)}</strong>
        </span>
        <span class="gx-annex-banner-cost">${costHtml}</span>
        <button class="${btnClass}" data-claim-intergalactic ${btnAttrs}>Bridge</button>
      `;
      extraClass = 'gx-banner-annex gx-banner-intergalactic';
    } else if (this.empireCtx.nextWormhole) {
      const { systemName, canAfford, costHtml } = this.empireCtx.nextWormhole;
      const btnClass = canAfford ? 'gx-annex-banner-btn ready' : 'gx-annex-banner-btn waiting';
      const btnAttrs = canAfford ? '' : 'disabled';
      html = `
        <span class="gx-banner-ico">✺</span>
        <span class="gx-banner-text">
          <span class="gx-banner-eyebrow">Wormhole annex · T2 ×100</span>
          <strong>${escapeHtml(systemName)}</strong>
        </span>
        <span class="gx-annex-banner-cost">${costHtml}</span>
        <button class="${btnClass}" data-claim-wormhole ${btnAttrs}>Open Rift</button>
      `;
      extraClass = 'gx-banner-annex gx-banner-wormhole';
    }
    this.banner.className = 'gx-banner' + (extraClass ? ' ' + extraClass : '');
    if (html) {
      this.banner.innerHTML = html;
      this.banner.style.display = '';
    } else {
      this.banner.style.display = 'none';
    }
  }

  // Disable when we're already at the home-planet view; otherwise let the
  // player one-click smooth-fly back. navigateTo handles the layer transition
  // and CameraController interpolates camera position + target.
  private renderHomeBtn(layer: LayerState): void {
    const haveHome = !!this.home.planetId && !!this.home.systemId;
    const atHome =
      layer.kind === 'planet' &&
      layer.systemId === this.home.systemId &&
      layer.planetId === this.home.planetId;
    this.homeBtn.disabled = !haveHome || atHome;
    this.homeBtn.style.display = haveHome ? '' : 'none';
  }

  private jumpHome(): void {
    if (!this.home.systemId || !this.home.planetId) return;
    const galaxyId = this.universe.systemToGalaxy.get(this.home.systemId) ?? null;
    this.navigate({
      kind: 'planet',
      galaxyId,
      systemId: this.home.systemId,
      planetId: this.home.planetId,
    });
  }

  // --- Breadcrumb ---
  private renderBreadcrumb(layer: LayerState): void {
    const parts: { label: string; onClick: (() => void) | null }[] = [];
    parts.push({
      label: 'Universe',
      onClick: layer.kind === 'universe' ? null : () =>
        this.navigate({ kind: 'universe', galaxyId: null, systemId: null, planetId: null }),
    });
    if (layer.galaxyId) {
      const gh = this.universe.galaxies.get(layer.galaxyId);
      if (gh) {
        parts.push({
          label: gh.data.name,
          onClick: layer.kind === 'galaxy' ? null : () =>
            this.navigate({ kind: 'galaxy', galaxyId: layer.galaxyId, systemId: null, planetId: null }),
        });
      }
    }
    if (layer.systemId) {
      const sys = this.universe.systems.get(layer.systemId);
      if (sys) {
        const isHomeSys = layer.systemId === this.home.systemId;
        const sysPrefix = isHomeSys
          ? (this.home.fullSystemClaimed ? '★★ ' : '★ ')
          : '';
        const galaxyId = this.universe.systemToGalaxy.get(layer.systemId) ?? layer.galaxyId;
        parts.push({
          label: sysPrefix + sys.data.name,
          onClick: layer.kind === 'system' ? null : () =>
            this.navigate({ kind: 'system', galaxyId, systemId: layer.systemId, planetId: null }),
        });
      }
    }
    if (layer.planetId && layer.systemId) {
      const sys = this.universe.systems.get(layer.systemId);
      const planet = sys?.planets.find((p) => p.data.id === layer.planetId);
      if (planet) {
        const planetPrefix = layer.planetId === this.home.planetId ? '★ ' : '';
        parts.push({ label: planetPrefix + planet.data.name, onClick: null });
      }
    }

    this.breadcrumb.innerHTML = '';
    parts.forEach((p, i) => {
      if (i > 0) {
        const sep = el('span', 'gx-breadcrumb-sep');
        sep.textContent = '›';
        this.breadcrumb.appendChild(sep);
      }
      const a = document.createElement(p.onClick ? 'button' : 'span') as HTMLElement;
      a.className = `gx-breadcrumb-${p.onClick ? 'link' : 'current'}`;
      a.textContent = p.label;
      if (p.onClick) (a as HTMLButtonElement).addEventListener('click', p.onClick);
      this.breadcrumb.appendChild(a);
    });
  }

  // --- Layer switcher ---
  private renderSwitcher(layer: LayerState): void {
    const make = (kind: LayerKind, label: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = `gx-switch-btn ${layer.kind === kind ? 'active' : ''}`;
      btn.textContent = label;
      btn.disabled = !this.canGoTo(layer, kind);
      btn.addEventListener('click', () => this.handleSwitch(layer, kind));
      return btn;
    };
    this.switcher.innerHTML = '';
    this.switcher.appendChild(make('planet', 'Planet'));
    this.switcher.appendChild(make('system', 'System'));
    this.switcher.appendChild(make('galaxy', 'Galaxy'));
    this.switcher.appendChild(make('universe', 'Universe'));
  }

  private canGoTo(layer: LayerState, kind: LayerKind): boolean {
    if (layer.kind === kind) return false;
    if (kind === 'universe') return true;
    if (kind === 'galaxy') return layer.galaxyId !== null || layer.kind !== 'universe';
    if (kind === 'system') return layer.systemId !== null;
    return layer.systemId !== null;
  }

  private handleSwitch(layer: LayerState, kind: LayerKind): void {
    if (layer.kind === kind) return;
    if (kind === 'universe') {
      this.navigate({ kind: 'universe', galaxyId: null, systemId: null, planetId: null });
      return;
    }
    if (kind === 'galaxy') {
      // Default to the home galaxy if none explicit (e.g. coming from universe view).
      const gid = layer.galaxyId ?? 'milky-way';
      this.navigate({ kind: 'galaxy', galaxyId: gid, systemId: null, planetId: null });
      return;
    }
    if (kind === 'system' && layer.systemId) {
      const galaxyId = this.universe.systemToGalaxy.get(layer.systemId) ?? layer.galaxyId;
      this.navigate({ kind: 'system', galaxyId, systemId: layer.systemId, planetId: null });
      return;
    }
    if (kind === 'planet' && layer.systemId) {
      // pick currently selected planet, or fallback to first
      const sys = this.universe.systems.get(layer.systemId);
      if (!sys) return;
      const pid = layer.planetId ?? sys.planets[0]?.data.id;
      if (!pid) return;
      const galaxyId = this.universe.systemToGalaxy.get(layer.systemId) ?? layer.galaxyId;
      this.navigate({ kind: 'planet', galaxyId, systemId: layer.systemId, planetId: pid });
    }
  }

  // --- Detail panel ---
  private renderPanel(layer: LayerState): void {
    if (layer.kind === 'universe') {
      const count = this.universe.galaxies.size;
      let totalSystems = 0;
      for (const [, gh] of this.universe.galaxies) totalSystems += gh.data.systems.length;
      const galaxyList = Array.from(this.universe.galaxies.values())
        .map((g) => `<div class="gx-panel-row"><span class="gx-k">${escapeHtml(g.data.name)}</span><span class="gx-v">${g.data.systems.length} systems</span></div>`)
        .join('');
      this.panel.innerHTML = `
        <div class="gx-panel-eyebrow">Universe layer</div>
        <div class="gx-panel-title">The Local Group</div>
        <div class="gx-panel-sub">${count} galaxies · ${totalSystems} star systems</div>
        <p class="gx-panel-desc">Each galaxy is a procedural disc with its own star palette. Click a galaxy bulge to enter — only the Milky Way is reachable until you build the Intergalactic Bridge.</p>
        <div class="gx-panel-grid">${galaxyList}</div>
      `;
      return;
    }
    if (layer.kind === 'galaxy') {
      const galaxyId = layer.galaxyId ?? 'milky-way';
      const gh = this.universe.galaxies.get(galaxyId);
      if (!gh) return;
      const count = gh.data.systems.length;
      this.panel.innerHTML = `
        <div class="gx-panel-eyebrow">Galaxy layer</div>
        <div class="gx-panel-title">${escapeHtml(gh.data.name)}</div>
        <div class="gx-panel-sub">${count} star systems${gh.blackHole ? ' · Supermassive black hole' : ''}</div>
        <p class="gx-panel-desc">${count} systems lie in this galaxy. Pick one to fly in.</p>
        <div class="gx-panel-grid">
          <div class="gx-panel-row"><span class="gx-k">Systems</span><span class="gx-v">${count}</span></div>
          <div class="gx-panel-row"><span class="gx-k">Disc arms</span><span class="gx-v">${gh.data.palette.arms}</span></div>
          <div class="gx-panel-row"><span class="gx-k">Radius</span><span class="gx-v">${(gh.data.radius / 1000).toFixed(0)}k units</span></div>
        </div>
      `;
      return;
    }
    if (layer.kind === 'system' && layer.systemId) {
      const sys = this.universe.systems.get(layer.systemId);
      if (!sys) return;
      this.panel.innerHTML = this.systemPanelHTML(sys.data);
      return;
    }
    if (layer.kind === 'planet' && layer.systemId && layer.planetId) {
      const sys = this.universe.systems.get(layer.systemId);
      const planet = sys?.planets.find((p) => p.data.id === layer.planetId);
      if (!planet || !sys) return;
      this.panel.innerHTML = this.planetPanelHTML(planet.data, sys.data);
    }
  }

  private systemPanelHTML(sys: SystemData): string {
    const star = STAR_CLASS_LABEL[sys.starClass] ?? sys.starClass;
    const economy = ECONOMY_LABEL[sys.economy];
    const dot = colorCss(sys.starColor);
    return `
      <div class="gx-panel-eyebrow">System layer</div>
      <div class="gx-panel-title"><span class="gx-row-dot" style="background:${dot}"></span>${escapeHtml(sys.name)}</div>
      <div class="gx-panel-sub">${star} · ${economy}</div>
      <p class="gx-panel-desc">${escapeHtml(sys.description)}</p>
      <div class="gx-panel-grid">
        <div class="gx-panel-row"><span class="gx-k">Class</span><span class="gx-v">${star}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Economy</span><span class="gx-v">${economy}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Planets</span><span class="gx-v">${sys.planets.length}</span></div>
      </div>
    `;
  }

  private planetPanelHTML(p: PlanetData, sys: SystemData): string {
    const tt = PLANET_TYPE_LABEL[p.type] ?? p.type;
    const dot = colorCss(p.primaryColor);
    const moonsLine = p.moons.length === 0
      ? 'None'
      : `${p.moons.length} (${p.moons.map((m) => escapeHtml(m.name.split(' ').pop() ?? '')).join(', ')})`;
    const riskCls = RISK_CLASS[p.risk];

    // W6-E removed the per-planet annex button — annexing is now driven from
    // a single banner control that always targets the closest unowned home-
    // system planet, so the player only ever has one button to click.

    return `
      <div class="gx-panel-eyebrow">Planet focus</div>
      <div class="gx-panel-title"><span class="gx-row-dot" style="background:${dot}"></span>${escapeHtml(p.name)}</div>
      <div class="gx-panel-sub">${tt} · ${escapeHtml(sys.name)}</div>
      <p class="gx-panel-desc">${escapeHtml(p.description)}</p>
      <div class="gx-panel-grid">
        <div class="gx-panel-row"><span class="gx-k">Type</span><span class="gx-v">${tt}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Size</span><span class="gx-v">${(p.radius / 0.55).toFixed(2)} × Earth</span></div>
        <div class="gx-panel-row"><span class="gx-k">Distance</span><span class="gx-v">${(p.orbitRadius / 6).toFixed(2)} AU</span></div>
        <div class="gx-panel-row"><span class="gx-k">Temperature</span><span class="gx-v">${p.temperatureC} °C</span></div>
        <div class="gx-panel-row"><span class="gx-k">Resource</span><span class="gx-v">${escapeHtml(p.resource)}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Risk</span><span class="gx-v"><span class="gx-risk gx-risk-${riskCls}">${RISK_LABEL[p.risk]}</span></span></div>
        <div class="gx-panel-row"><span class="gx-k">Rings</span><span class="gx-v">${p.hasRings ? 'Yes' : 'No'}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Moons</span><span class="gx-v">${moonsLine}</span></div>
      </div>
    `;
  }

}

function el(tag: string, cls: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  return e;
}

function colorCss(c: [number, number, number]): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' :
    ch === '<' ? '&lt;'  :
    ch === '>' ? '&gt;'  :
    ch === '"' ? '&quot;' : '&#39;'
  );
}
