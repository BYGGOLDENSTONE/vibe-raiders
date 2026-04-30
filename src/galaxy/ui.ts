import type { GalaxyHandle } from './galaxy';
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

// Slim hook surface UI uses to render the W4-E / W6-E claim flows without
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
}

export class UI {
  private breadcrumb: HTMLDivElement;
  private switcher: HTMLDivElement;
  private homeBtn: HTMLButtonElement;
  private panel: HTMLDivElement;
  private hint: HTMLDivElement;
  private banner: HTMLDivElement;
  private galaxy: GalaxyHandle;
  private navigate: NavigateFn;
  private home: HomeCtx = { systemId: null, planetId: null, fullSystemClaimed: false };
  private empireCtx: EmpireCtx = {
    needsMoonChoice: false,
    nextAnnex: null,
    claimNextAnnex: () => {},
  };
  private layer: LayerState = { kind: 'galaxy', systemId: null, planetId: null };

  constructor(root: HTMLDivElement, galaxy: GalaxyHandle, navigate: NavigateFn) {
    this.galaxy = galaxy;
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

    // W6-E: the "Annex" button now lives inside the banner instead of the
    // per-planet panel. One delegated click handler routes any banner
    // button back into the empire layer.
    this.banner.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-claim-next]') as HTMLElement | null;
      if (!btn) return;
      this.empireCtx.claimNextAnnex();
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
    // Banner priority: moon-pick (W4-E) over annex (W6-E). Moon-pick is a
    // one-shot follow-up to a specific purchase, while annex sits there
    // for the entire system-expansion phase and shouldn't drown out the
    // moon prompt the moment it appears.
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
    this.navigate({
      kind: 'planet',
      systemId: this.home.systemId,
      planetId: this.home.planetId,
    });
  }

  // --- Breadcrumb ---
  private renderBreadcrumb(layer: LayerState): void {
    const parts: { label: string; onClick: (() => void) | null }[] = [];
    parts.push({
      label: 'Galaxy',
      onClick: layer.kind === 'galaxy' ? null : () =>
        this.navigate({ kind: 'galaxy', systemId: null, planetId: null }),
    });
    if (layer.systemId) {
      const sys = this.galaxy.systems.get(layer.systemId);
      if (sys) {
        const isHomeSys = layer.systemId === this.home.systemId;
        const sysPrefix = isHomeSys
          ? (this.home.fullSystemClaimed ? '★★ ' : '★ ')
          : '';
        parts.push({
          label: sysPrefix + sys.data.name,
          onClick: layer.kind === 'system' ? null : () =>
            this.navigate({ kind: 'system', systemId: layer.systemId, planetId: null }),
        });
      }
    }
    if (layer.planetId && layer.systemId) {
      const sys = this.galaxy.systems.get(layer.systemId);
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
  }

  private canGoTo(layer: LayerState, kind: LayerKind): boolean {
    if (layer.kind === kind) return false;
    if (kind === 'galaxy') return true;
    if (kind === 'system') return layer.systemId !== null;
    // planet
    return layer.systemId !== null;
  }

  private handleSwitch(layer: LayerState, kind: LayerKind): void {
    if (layer.kind === kind) return;
    if (kind === 'galaxy') {
      this.navigate({ kind: 'galaxy', systemId: null, planetId: null });
      return;
    }
    if (kind === 'system' && layer.systemId) {
      this.navigate({ kind: 'system', systemId: layer.systemId, planetId: null });
      return;
    }
    if (kind === 'planet' && layer.systemId) {
      // pick currently selected planet, or fallback to first
      const sys = this.galaxy.systems.get(layer.systemId);
      if (!sys) return;
      const pid = layer.planetId ?? sys.planets[0]?.data.id;
      if (!pid) return;
      this.navigate({ kind: 'planet', systemId: layer.systemId, planetId: pid });
    }
  }

  // --- Detail panel ---
  private renderPanel(layer: LayerState): void {
    if (layer.kind === 'galaxy') {
      const count = this.galaxy.systems.size;
      this.panel.innerHTML = `
        <div class="gx-panel-eyebrow">Galaxy layer</div>
        <div class="gx-panel-title">Galactic Core</div>
        <div class="gx-panel-sub">${count} star systems · Supermassive black hole</div>
        <p class="gx-panel-desc">Star systems orbit the central black hole on a 2D plane. Pick a system and the camera streams you in.</p>
        <div class="gx-panel-grid">
          <div class="gx-panel-row"><span class="gx-k">Systems</span><span class="gx-v">${count}</span></div>
          <div class="gx-panel-row"><span class="gx-k">Center</span><span class="gx-v">Black hole</span></div>
          <div class="gx-panel-row"><span class="gx-k">Plane</span><span class="gx-v">2D orbit</span></div>
        </div>
      `;
      return;
    }
    if (layer.kind === 'system' && layer.systemId) {
      const sys = this.galaxy.systems.get(layer.systemId);
      if (!sys) return;
      this.panel.innerHTML = this.systemPanelHTML(sys.data);
      return;
    }
    if (layer.kind === 'planet' && layer.systemId && layer.planetId) {
      const sys = this.galaxy.systems.get(layer.systemId);
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
