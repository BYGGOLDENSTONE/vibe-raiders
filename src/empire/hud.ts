// Top resource bar — seven named chips + an "Upgrades" launcher button.

import type { Empire } from './empire';
import type { UpgradePanel } from './panel';
import {
  RESOURCE_COLOR,
  RESOURCE_KEYS,
  RESOURCE_LABEL,
  type ResourceBag,
  type ResourceKey,
} from './types';

interface ChipDom {
  root: HTMLDivElement;
  amount: HTMLSpanElement;
  rate: HTMLSpanElement;
}

export class ResourceHUD {
  private root: HTMLDivElement;
  private empire: Empire;
  private panel: UpgradePanel;
  private chips: Map<ResourceKey, ChipDom> = new Map();
  private button: HTMLButtonElement;
  private buttonCount: HTMLSpanElement;
  private displayed: ResourceBag;
  private displayedRates: ResourceBag;

  constructor(parent: HTMLElement, empire: Empire, panel: UpgradePanel) {
    this.empire = empire;
    this.panel = panel;
    this.root = document.createElement('div');
    this.root.className = 'em-hud';
    parent.appendChild(this.root);

    this.displayed = { ...empire.state.resources };
    this.displayedRates = {
      metal: 0, water: 0, gas: 0, crystal: 0, plasma: 0, silicon: 0, chemical: 0,
    };

    for (const k of RESOURCE_KEYS) {
      this.chips.set(k, this.buildChip(k));
    }

    // Vertical divider then the upgrades launcher.
    const divider = document.createElement('div');
    divider.className = 'em-hud-divider';
    this.root.appendChild(divider);

    this.button = document.createElement('button');
    this.button.className = 'em-hud-btn';
    this.button.innerHTML = `
      <span class="em-hud-btn-icon">▦</span>
      <span class="em-hud-btn-label">Upgrades</span>
      <span class="em-hud-btn-count" data-count>0/0</span>
    `;
    this.button.addEventListener('click', () => this.panel.toggle());
    this.root.appendChild(this.button);
    this.buttonCount = this.button.querySelector('[data-count]') as HTMLSpanElement;

    this.refresh();
  }

  private buildChip(k: ResourceKey): ChipDom {
    const chip = document.createElement('div');
    chip.className = 'em-chip';
    chip.title = RESOURCE_LABEL[k];
    chip.dataset.resource = k;
    chip.style.setProperty('--c', RESOURCE_COLOR[k]);
    chip.innerHTML = `
      <span class="em-chip-dot"></span>
      <span class="em-chip-name">${RESOURCE_LABEL[k]}</span>
      <span class="em-chip-amount" data-amount>0</span>
      <span class="em-chip-rate" data-rate>—</span>
    `;
    this.root.appendChild(chip);
    return {
      root: chip,
      amount: chip.querySelector('[data-amount]') as HTMLSpanElement,
      rate: chip.querySelector('[data-rate]') as HTMLSpanElement,
    };
  }

  update(dt: number): void {
    const m = this.empire.computeMetrics();
    const true_ = this.empire.state.resources;
    const lerp = Math.min(1, dt * 8);
    for (const k of RESOURCE_KEYS) {
      this.displayed[k] += (true_[k] - this.displayed[k]) * lerp;
      this.displayedRates[k] += (m.rates[k] - this.displayedRates[k]) * lerp;
      const chip = this.chips.get(k)!;
      chip.amount.textContent = formatNumber(this.displayed[k]);
      const rate = this.displayedRates[k];
      const isLocked = m.ownership[k] === 0;
      if (isLocked) {
        chip.rate.textContent = '—';
        chip.rate.classList.add('locked');
      } else {
        chip.rate.textContent = rate >= 0.05 ? `+${rate.toFixed(1)}/s` : '0/s';
        chip.rate.classList.remove('locked');
      }
      chip.root.classList.toggle('em-chip-locked', isLocked);
    }

    // Button counter: owned / total — and pulse when something is buyable.
    const ready = this.panel.readyCount();
    const owned = this.panel.ownedCount();
    const total = this.panel.totalCount();
    this.buttonCount.textContent = `${owned}/${total}`;
    this.button.classList.toggle('em-hud-btn-ready', ready > 0);
    this.button.dataset.ready = String(ready);
  }

  refresh(): void {
    this.update(1);
  }
}

function formatNumber(n: number): string {
  if (n < 100) return n.toFixed(1);
  if (n < 10_000) return Math.round(n).toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}
