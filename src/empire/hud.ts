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
import { sfxClick } from '../audio/sfx';

// W13 — friendly label for each auto-claim kind (rendered in the Next chip).
const AUTO_KIND_LABEL: Record<string, string> = {
  'home-planet': 'Annex',
  't2-planet':   'T2 Planet',
  't3-planet':   'T3 Planet',
  't2-anchor':   'Wormhole Anchor',
  't3-anchor':   'Intergalactic Bridge',
};

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
  private droneChip: HTMLDivElement;
  private droneCountEl: HTMLSpanElement;
  private droneMulEl: HTMLSpanElement;
  private tradeBtn: HTMLButtonElement;
  private tradeCooldownEl: HTMLSpanElement;
  private onTradeClick: () => void = () => {};
  private displayed: ResourceBag;
  private displayedRates: ResourceBag;
  // W13 — auto-expand status chip (target name + cost) and round-reset
  // countdown chip (MP only). Both are show/hide so solo doesn't get the
  // round chip.
  private nextChip: HTMLDivElement;
  private nextLabel: HTMLSpanElement;
  private nextTarget: HTMLSpanElement;
  private nextCost: HTMLSpanElement;
  private roundChip: HTMLDivElement;
  private roundCounter: HTMLSpanElement;

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

    // Drone summary chip — surfaces what those upgrades actually do at a
    // glance: count and the resulting throughput multiplier (1 + 0.05*N +
    // cargoAdd + speedAdd). Sits to the right of the resources, before the
    // upgrades launcher, with its own visual style so it doesn't get mistaken
    // for an 8th resource.
    this.droneChip = document.createElement('div');
    this.droneChip.className = 'em-chip em-chip-drones';
    this.droneChip.title = 'Drone count × throughput multiplier (boosts every resource you produce)';
    this.droneChip.innerHTML = `
      <span class="em-chip-dot"></span>
      <span class="em-chip-name">Drones</span>
      <span class="em-chip-amount" data-drone-count>0</span>
      <span class="em-chip-rate" data-drone-mul>×1.0</span>
    `;
    this.root.appendChild(this.droneChip);
    this.droneCountEl = this.droneChip.querySelector('[data-drone-count]') as HTMLSpanElement;
    this.droneMulEl = this.droneChip.querySelector('[data-drone-mul]') as HTMLSpanElement;

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
    this.button.addEventListener('click', () => {
      sfxClick();
      this.panel.toggle();
    });
    this.root.appendChild(this.button);
    this.buttonCount = this.button.querySelector('[data-count]') as HTMLSpanElement;

    // W7 — Trade Hub button. Hidden until trade-hub unlock is owned, so it
    // doesn't clutter the HUD pre-endgame. App wires the click handler via
    // setTradeHandler() since trade matchmaking touches the multiplayer
    // client which the HUD has no business knowing about directly.
    this.tradeBtn = document.createElement('button');
    this.tradeBtn.className = 'em-hud-btn em-hud-btn-trade';
    this.tradeBtn.style.display = 'none';
    this.tradeBtn.innerHTML = `
      <span class="em-hud-btn-icon">⇄</span>
      <span class="em-hud-btn-label">Trade</span>
      <span class="em-hud-btn-count" data-cooldown></span>
    `;
    this.tradeBtn.addEventListener('click', () => this.onTradeClick());
    this.root.appendChild(this.tradeBtn);
    this.tradeCooldownEl = this.tradeBtn.querySelector('[data-cooldown]') as HTMLSpanElement;

    // W13 — Next-target chip. Mirrors the resource chip styling but with a
    // different colour ramp (green when affordable, red when waiting on
    // income). Hidden until auto-expand is unlocked (system-expansion).
    this.nextChip = document.createElement('div');
    this.nextChip.className = 'em-chip em-chip-next';
    this.nextChip.style.display = 'none';
    this.nextChip.title = 'Next auto-expand target';
    this.nextChip.innerHTML = `
      <span class="em-chip-dot"></span>
      <span class="em-chip-name" data-next-label>Next</span>
      <span class="em-chip-amount" data-next-target>—</span>
      <span class="em-chip-rate" data-next-cost>—</span>
    `;
    this.root.appendChild(this.nextChip);
    this.nextLabel = this.nextChip.querySelector('[data-next-label]') as HTMLSpanElement;
    this.nextTarget = this.nextChip.querySelector('[data-next-target]') as HTMLSpanElement;
    this.nextCost = this.nextChip.querySelector('[data-next-cost]') as HTMLSpanElement;

    // W13 — round-reset countdown chip. App calls setRoundCountdown(ms) each
    // frame in MP mode; null hides the chip (solo or relay-not-yet-ready).
    this.roundChip = document.createElement('div');
    this.roundChip.className = 'em-chip em-chip-round';
    this.roundChip.style.display = 'none';
    this.roundChip.title = 'Round resets every 30 minutes — territory wipes, resources + upgrades carry over';
    this.roundChip.innerHTML = `
      <span class="em-chip-dot"></span>
      <span class="em-chip-name">Round</span>
      <span class="em-chip-amount" data-round-counter>—</span>
    `;
    this.root.appendChild(this.roundChip);
    this.roundCounter = this.roundChip.querySelector('[data-round-counter]') as HTMLSpanElement;

    this.refresh();
  }

  // W13 — App pushes the round-reset countdown ms each frame. Pass null to
  // hide the chip (solo mode or relay not ready). MM:SS format.
  setRoundCountdown(remainingMs: number | null): void {
    if (remainingMs === null) {
      this.roundChip.style.display = 'none';
      return;
    }
    this.roundChip.style.display = '';
    const secs = Math.max(0, Math.floor(remainingMs / 1000));
    const mm = Math.floor(secs / 60).toString().padStart(2, '0');
    const ss = (secs % 60).toString().padStart(2, '0');
    this.roundCounter.textContent = `${mm}:${ss}`;
    this.roundChip.classList.toggle('em-chip-round-soon', remainingMs <= 60_000);
  }

  // App wires its trade handler in here. Kept as a setter so the HUD doesn't
  // need to import multiplayer types — the button just calls back when
  // pressed and the App layer handles the matchmaking + local trade.
  setTradeHandler(fn: () => void): void {
    this.onTradeClick = fn;
  }

  // App calls this every frame so the cooldown counter ticks down. Pass the
  // remaining cooldown ms; 0 (or negative) means ready.
  setTradeCooldown(remainingMs: number): void {
    if (remainingMs <= 0) {
      this.tradeCooldownEl.textContent = 'READY';
      this.tradeCooldownEl.classList.remove('em-hud-cooldown-wait');
      this.tradeBtn.disabled = false;
    } else {
      const s = Math.ceil(remainingMs / 1000);
      this.tradeCooldownEl.textContent = `${s}s`;
      this.tradeCooldownEl.classList.add('em-hud-cooldown-wait');
      this.tradeBtn.disabled = true;
    }
  }

  // Show / hide the Trade button based on whether trade-hub is unlocked.
  // Called from refresh(); no work needed beyond the inline read.
  private updateTradeVisibility(): void {
    const visible = this.empire.hasUnlock('trade-hub');
    this.tradeBtn.style.display = visible ? '' : 'none';
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
      const isLocked = !m.produces.has(k);
      if (isLocked) {
        chip.rate.textContent = '—';
        chip.rate.classList.add('locked');
      } else {
        chip.rate.textContent = rate >= 0.05 ? `+${rate.toFixed(1)}/s` : '0/s';
        chip.rate.classList.remove('locked');
      }
      chip.root.classList.toggle('em-chip-locked', isLocked);
    }

    // Drone summary — recompute throughput so the player can read the impact
    // of drone purchases without diving into the upgrade panel.
    const throughput = 1
      + 0.05 * m.droneCount
      + Math.max(0, m.droneCargo - 1)
      + Math.max(0, m.droneSpeed - 1);
    this.droneCountEl.textContent = String(m.droneCount);
    this.droneMulEl.textContent = `×${throughput.toFixed(2)}`;

    // W13 — auto-expand "Next" chip. Hidden until the drone engine has any
    // candidate (system-expansion bought + a viable target found).
    const next = this.empire.peekNextAutoClaim();
    if (next) {
      this.nextChip.style.display = '';
      this.nextLabel.textContent = AUTO_KIND_LABEL[next.kind] ?? 'Next';
      this.nextTarget.textContent = next.label;
      const can = canAfford(this.empire.state.resources, next.cost);
      this.nextCost.textContent = formatCostShort(next.cost);
      this.nextChip.classList.toggle('em-chip-next-ready', can);
      this.nextChip.classList.toggle('em-chip-next-waiting', !can);
    } else {
      this.nextChip.style.display = 'none';
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
    this.updateTradeVisibility();
  }
}

function formatNumber(n: number): string {
  if (n < 100) return n.toFixed(1);
  if (n < 10_000) return Math.round(n).toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n < 1e12) return `${(n / 1e9).toFixed(2)}B`;
  if (n < 1e15) return `${(n / 1e12).toFixed(2)}T`;     // trillion
  if (n < 1e18) return `${(n / 1e15).toFixed(2)}Q`;     // quadrillion
  if (n < 1e21) return `${(n / 1e18).toFixed(2)}Qa`;    // quintillion
  if (n < 1e24) return `${(n / 1e21).toFixed(2)}Qi`;    // sextillion
  return `${(n / 1e24).toFixed(2)}Sx`;                  // septillion+
}

// W13 — single-line cost summary for the Next chip. Picks the dominant
// resource (largest amount) so the player has a quick "how much before this
// fires" read; full breakdown is implicit since the chip pulses while paid.
function formatCostShort(cost: Partial<ResourceBag>): string {
  let bestKey: ResourceKey | null = null;
  let bestVal = 0;
  for (const k of RESOURCE_KEYS) {
    const v = cost[k];
    if (v === undefined || v <= 0) continue;
    if (v > bestVal) { bestVal = v; bestKey = k; }
  }
  if (!bestKey) return '—';
  return `${formatNumber(bestVal)} ${bestKey}`;
}

function canAfford(have: ResourceBag, cost: Partial<ResourceBag>): boolean {
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined || need <= 0) continue;
    if (have[k] < need) return false;
  }
  return true;
}
