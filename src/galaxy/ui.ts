import type { GalaxyHandle } from './galaxy';
import type { EconomyKind, LayerKind, LayerState, PlanetData, RiskLevel, SystemData } from './types';

const PLANET_TYPE_LABEL_TR: Record<string, string> = {
  rocky:  'Kayalık',
  ocean:  'Okyanus',
  gas:    'Gaz Devi',
  ice:    'Buz',
  lava:   'Lav',
  desert: 'Çöl',
  toxic:  'Zehirli',
};

const STAR_CLASS_LABEL_TR: Record<string, string> = {
  'red-dwarf':  'Kırmızı Cüce',
  'orange':     'Turuncu Yıldız',
  'yellow':     'Sarı Yıldız',
  'white-blue': 'Beyaz-Mavi',
  'blue-giant': 'Mavi Dev',
};

const ECONOMY_LABEL_TR: Record<EconomyKind, string> = {
  'colony-core':     'Koloni çekirdeği',
  'science-line':    'Bilim hattı',
  'trade-hub':       'Ticaret kavşağı',
  'frontier-mining': 'Sınır madenciliği',
  'tourism-belt':    'Turizm kuşağı',
  'industrial':      'Endüstri merkezi',
  'military':        'Askeri üs',
  'lost-colony':     'Kayıp koloni',
  'empty':           'Boş sistem',
};

const RISK_LABEL_TR: Record<RiskLevel, string> = {
  low:     'Düşük',
  medium:  'Orta',
  high:    'Yüksek',
  extreme: 'Aşırı',
};

const RISK_CLASS: Record<RiskLevel, string> = {
  low: 'low', medium: 'med', high: 'hi', extreme: 'ex',
};

export type NavigateFn = (next: LayerState) => void;

export class UI {
  private breadcrumb: HTMLDivElement;
  private switcher: HTMLDivElement;
  private panel: HTMLDivElement;
  private objectList: HTMLDivElement;
  private hint: HTMLDivElement;
  private galaxy: GalaxyHandle;
  private navigate: NavigateFn;

  constructor(root: HTMLDivElement, galaxy: GalaxyHandle, navigate: NavigateFn) {
    this.galaxy = galaxy;
    this.navigate = navigate;

    this.breadcrumb = el('div', 'gx-breadcrumb');
    root.appendChild(this.breadcrumb);

    this.switcher = el('div', 'gx-switcher');
    this.switcher.setAttribute('role', 'group');
    this.switcher.setAttribute('aria-label', 'Görünüm katmanı');
    root.appendChild(this.switcher);

    this.panel = el('div', 'gx-panel');
    root.appendChild(this.panel);

    this.objectList = el('div', 'gx-objectlist');
    root.appendChild(this.objectList);

    this.hint = el('div', 'gx-hint');
    this.hint.innerHTML = `
      <span><strong>Sol tık</strong> seç</span>
      <span><strong>Sağ tık + sürükle</strong> döndür</span>
      <span><strong>Tekerlek</strong> yaklaş/uzaklaş</span>
    `;
    root.appendChild(this.hint);
  }

  render(layer: LayerState): void {
    this.renderBreadcrumb(layer);
    this.renderSwitcher(layer);
    this.renderPanel(layer);
    this.renderObjectList(layer);
  }

  // --- Breadcrumb ---
  private renderBreadcrumb(layer: LayerState): void {
    const parts: { label: string; onClick: (() => void) | null }[] = [];
    parts.push({
      label: 'Galaksi',
      onClick: layer.kind === 'galaxy' ? null : () =>
        this.navigate({ kind: 'galaxy', systemId: null, planetId: null }),
    });
    if (layer.systemId) {
      const sys = this.galaxy.systems.get(layer.systemId);
      if (sys) {
        parts.push({
          label: sys.data.name,
          onClick: layer.kind === 'system' ? null : () =>
            this.navigate({ kind: 'system', systemId: layer.systemId, planetId: null }),
        });
      }
    }
    if (layer.planetId && layer.systemId) {
      const sys = this.galaxy.systems.get(layer.systemId);
      const planet = sys?.planets.find((p) => p.data.id === layer.planetId);
      if (planet) parts.push({ label: planet.data.name, onClick: null });
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
    this.switcher.appendChild(make('planet', 'Gezegen'));
    this.switcher.appendChild(make('system', 'Sistem'));
    this.switcher.appendChild(make('galaxy', 'Galaksi'));
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
        <div class="gx-panel-eyebrow">Galaksi katmanı</div>
        <div class="gx-panel-title">Galaksi Çekirdeği</div>
        <div class="gx-panel-sub">${count} yıldız sistemi · Süper kütleli kara delik</div>
        <p class="gx-panel-desc">Yıldız sistemleri merkezdeki kara deliğin etrafında 2D düzlemde döner. Bir sistem seç ve oraya akarsın.</p>
        <div class="gx-panel-grid">
          <div class="gx-panel-row"><span class="gx-k">Sistemler</span><span class="gx-v">${count}</span></div>
          <div class="gx-panel-row"><span class="gx-k">Merkez</span><span class="gx-v">Kara delik</span></div>
          <div class="gx-panel-row"><span class="gx-k">Düzlem</span><span class="gx-v">2D yörünge</span></div>
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
    const star = STAR_CLASS_LABEL_TR[sys.starClass] ?? sys.starClass;
    const economy = ECONOMY_LABEL_TR[sys.economy];
    const dot = colorCss(sys.starColor);
    return `
      <div class="gx-panel-eyebrow">Sistem katmanı</div>
      <div class="gx-panel-title"><span class="gx-row-dot" style="background:${dot}"></span>${escapeHtml(sys.name)}</div>
      <div class="gx-panel-sub">${star} · ${economy}</div>
      <p class="gx-panel-desc">${escapeHtml(sys.description)}</p>
      <div class="gx-panel-grid">
        <div class="gx-panel-row"><span class="gx-k">Sınıf</span><span class="gx-v">${star}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Ekonomi</span><span class="gx-v">${economy}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Gezegenler</span><span class="gx-v">${sys.planets.length}</span></div>
      </div>
    `;
  }

  private planetPanelHTML(p: PlanetData, sys: SystemData): string {
    const tt = PLANET_TYPE_LABEL_TR[p.type] ?? p.type;
    const dot = colorCss(p.primaryColor);
    const moonsLine = p.moons.length === 0
      ? 'Yok'
      : `${p.moons.length} (${p.moons.map((m) => escapeHtml(m.name.split(' ').pop() ?? '')).join(', ')})`;
    const riskCls = RISK_CLASS[p.risk];
    return `
      <div class="gx-panel-eyebrow">Gezegen odağı</div>
      <div class="gx-panel-title"><span class="gx-row-dot" style="background:${dot}"></span>${escapeHtml(p.name)}</div>
      <div class="gx-panel-sub">${tt} · ${escapeHtml(sys.name)}</div>
      <p class="gx-panel-desc">${escapeHtml(p.description)}</p>
      <div class="gx-panel-grid">
        <div class="gx-panel-row"><span class="gx-k">Tür</span><span class="gx-v">${tt}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Boyut</span><span class="gx-v">${(p.radius / 0.55).toFixed(2)} × Dünya</span></div>
        <div class="gx-panel-row"><span class="gx-k">Yıldıza uzaklık</span><span class="gx-v">${(p.orbitRadius / 6).toFixed(2)} AU</span></div>
        <div class="gx-panel-row"><span class="gx-k">Sıcaklık</span><span class="gx-v">${p.temperatureC} °C</span></div>
        <div class="gx-panel-row"><span class="gx-k">Kaynak</span><span class="gx-v">${escapeHtml(p.resource)}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Risk</span><span class="gx-v"><span class="gx-risk gx-risk-${riskCls}">${RISK_LABEL_TR[p.risk]}</span></span></div>
        <div class="gx-panel-row"><span class="gx-k">Halka</span><span class="gx-v">${p.hasRings ? 'Var' : 'Yok'}</span></div>
        <div class="gx-panel-row"><span class="gx-k">Uydular</span><span class="gx-v">${moonsLine}</span></div>
      </div>
    `;
  }

  // --- Object list ---
  private renderObjectList(layer: LayerState): void {
    let title = '';
    let items: { id: string; name: string; meta: string; dot: string; selected: boolean; onClick: () => void }[] = [];

    if (layer.kind === 'galaxy') {
      // Galaksi katmanında liste yok — ekran galaksinin kendisi olsun
      this.objectList.style.display = 'none';
      this.objectList.innerHTML = '';
      return;
    }
    this.objectList.style.display = '';

    if (layer.systemId) {
      const sys = this.galaxy.systems.get(layer.systemId);
      if (!sys) {
        this.objectList.innerHTML = '';
        return;
      }
      title = `${sys.data.name} — gezegenler`;
      items = sys.data.planets.map((p) => ({
        id: p.id,
        name: p.name,
        meta: PLANET_TYPE_LABEL_TR[p.type] ?? p.type,
        dot: colorCss(p.primaryColor),
        selected: layer.kind === 'planet' && layer.planetId === p.id,
        onClick: () => this.navigate({ kind: 'planet', systemId: sys.data.id, planetId: p.id }),
      }));
    }

    this.objectList.innerHTML = `
      <div class="gx-list-head">
        <span class="gx-list-title">${escapeHtml(title)}</span>
        <span class="gx-list-count">${items.length}</span>
      </div>
      <div class="gx-list-scroll" data-list></div>
    `;
    const scroll = this.objectList.querySelector('[data-list]') as HTMLDivElement;
    items.forEach((it) => {
      const btn = document.createElement('button');
      btn.className = `gx-list-item${it.selected ? ' selected' : ''}`;
      btn.innerHTML = `
        <span class="gx-row-dot" style="background:${it.dot}"></span>
        <span class="gx-row-name">${escapeHtml(it.name)}</span>
        <span class="gx-row-type">${escapeHtml(it.meta)}</span>
      `;
      btn.addEventListener('click', it.onClick);
      scroll.appendChild(btn);
    });
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
