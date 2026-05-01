// Upgrade modal — Branch Browser layout: a left-rail of category-grouped
// chains and a right detail pane that shows the active chain's tier cards.
// No panning, no spatial graph — every chain is reachable in one click.

import type { Empire } from './empire';
import { NODES_BY_ID, UPGRADE_NODES } from './upgrades';
import { buyWithVfx } from './vfx';
import {
  RESOURCE_COLOR,
  RESOURCE_KEYS,
  RESOURCE_LABEL,
  type ResourceBag,
  type ResourceKey,
  type UpgradeCategory,
  type UpgradeNode,
} from './types';

const CATEGORY_ORDER: UpgradeCategory[] = [
  'expansion',
  'production',
  'drones',
  'logistics',
  'tech',
];

const CATEGORY_META: Record<UpgradeCategory, { label: string; icon: string; color: string }> = {
  expansion:  { label: 'Expansion',  icon: '✦', color: '#7ec8ff' },
  production: { label: 'Production', icon: '◈', color: '#9bd64a' },
  drones:     { label: 'Drones',     icon: '➤', color: '#f0a560' },
  logistics:  { label: 'Logistics',  icon: '▦', color: '#a9b3c4' },
  tech:       { label: 'Tech',       icon: '✧', color: '#c89bff' },
};

interface Chain {
  key: string;
  name: string;
  category: UpgradeCategory;
  nodes: UpgradeNode[];
}

// Group catalogue nodes into chains keyed by their semantic family.
// Mirrors the design prototype's buildChains, but typed.
function buildChains(): Chain[] {
  const map = new Map<string, Chain>();
  for (const n of UPGRADE_NODES) {
    if (n.id === 'core') continue;
    let key: string;
    if (n.id.startsWith('unlock-')) {
      key = 'expansion';
    } else if (n.id.startsWith('prod-') && n.id.includes('-rate-')) {
      key = `mining-${n.id.split('-')[1]}`;
    } else if (n.id.startsWith('prod-') && n.id.includes('-mul-')) {
      key = `opt-${n.id.split('-')[1]}`;
    } else {
      key = n.id.replace(/-\d+$/, '');
    }
    let chain = map.get(key);
    if (!chain) {
      chain = { key, name: n.name, category: n.category, nodes: [] };
      map.set(key, chain);
    }
    chain.nodes.push(n);
  }
  for (const c of map.values()) {
    c.nodes.sort((a, b) => a.tierLabel.localeCompare(b.tierLabel));
  }
  return [...map.values()];
}

const CHAINS: Chain[] = buildChains();

export class UpgradePanel {
  private modal: HTMLDivElement;
  private rail: HTMLDivElement;
  private detail: HTMLDivElement;
  private counter: HTMLElement;
  private empire: Empire;
  private opened = false;
  private listeners = new Set<() => void>();
  private activeKey: string;
  private lastLiveRefresh = 0;

  constructor(parent: HTMLElement, empire: Empire) {
    this.empire = empire;
    // Default to first non-empty chain.
    this.activeKey = CHAINS[0]?.key ?? '';

    this.modal = document.createElement('div');
    this.modal.className = 'em-modal';
    this.modal.hidden = true;
    this.modal.innerHTML = `
      <div class="em-modal-backdrop" data-close></div>
      <div class="em-modal-shell">
        <header class="em-modal-head">
          <div class="em-modal-title">Empire Upgrades</div>
          <div class="em-modal-count" data-count>0 / 0</div>
          <div class="em-modal-hint">Pick a branch on the left, then buy tiers in order.</div>
          <button class="em-modal-close" data-close aria-label="Close">×</button>
        </header>
        <div class="em-modal-body">
          <div class="branch-browser">
            <div class="bb-rail" data-rail></div>
            <div class="bb-detail" data-detail></div>
          </div>
        </div>
      </div>
    `;
    parent.appendChild(this.modal);

    this.rail = this.modal.querySelector('[data-rail]') as HTMLDivElement;
    this.detail = this.modal.querySelector('[data-detail]') as HTMLDivElement;
    this.counter = this.modal.querySelector('[data-count]') as HTMLElement;

    this.modal.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', () => this.close());
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.opened) this.close();
    });

    this.refresh();
  }

  // --- Open/close ----------------------------------------------------------

  isOpen(): boolean { return this.opened; }

  open(): void {
    this.modal.hidden = false;
    this.opened = true;
    this.refresh();
    this.emit();
  }
  close(): void {
    this.modal.hidden = true;
    this.opened = false;
    this.emit();
  }
  toggle(): void { this.opened ? this.close() : this.open(); }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // --- Render --------------------------------------------------------------

  // Throttled live refresh — runs while the modal is open so cost pills and
  // ETAs reflect the still-ticking economy. The game doesn't pause when the
  // modal opens (it can't — this is a multiplayer game).
  tickLive(now: number): void {
    if (!this.opened) return;
    if (now - this.lastLiveRefresh < 250) return;
    this.lastLiveRefresh = now;
    this.refresh();
  }

  refresh(): void {
    // Preserve scroll across the rebuild so the user doesn't get yanked back
    // to the top when the panel re-renders mid-scroll.
    const railScroll = this.rail.scrollTop;
    const detailScroll = this.detail.scrollTop;

    const owned = Math.max(0, this.empire.state.unlockedNodes.length - 1);
    const total = UPGRADE_NODES.length - 1;
    this.counter.textContent = `${owned} / ${total} owned`;

    // Visible chains, grouped by category in CATEGORY_ORDER.
    const visibleChains: { chain: Chain; visible: UpgradeNode[] }[] = [];
    for (const chain of CHAINS) {
      const visible = chain.nodes.filter((n) => this.empire.isVisible(n));
      if (visible.length === 0) continue;
      visibleChains.push({ chain, visible });
    }
    // If the active chain is no longer visible, fall back to the first visible.
    if (!visibleChains.find((c) => c.chain.key === this.activeKey)) {
      this.activeKey = visibleChains[0]?.chain.key ?? '';
    }

    this.renderRail(visibleChains);
    this.renderDetail(visibleChains);

    this.rail.scrollTop = railScroll;
    this.detail.scrollTop = detailScroll;
  }

  private renderRail(visible: { chain: Chain; visible: UpgradeNode[] }[]): void {
    this.rail.innerHTML = '';
    for (const cat of CATEGORY_ORDER) {
      const chains = visible.filter((c) => c.chain.category === cat);
      if (chains.length === 0) continue;
      const meta = CATEGORY_META[cat];

      const head = document.createElement('div');
      head.className = 'bb-cat';
      head.style.setProperty('--c', meta.color);
      head.innerHTML = `<span class="ico">${meta.icon}</span>${meta.label}`;
      this.rail.appendChild(head);

      for (const { chain, visible: vNodes } of chains) {
        const ownedN = vNodes.filter((n) => this.empire.hasNode(n.id)).length;
        const totalN = vNodes.length;
        const hasReady = vNodes.some((n) => this.empire.nodeStatus(n) === 'available');

        const row = document.createElement('div');
        row.className = 'bb-chain';
        if (chain.key === this.activeKey) row.classList.add('active');
        row.style.setProperty('--c', meta.color);
        row.innerHTML = `
          <div class="bb-chain-bar">
            <div class="bb-chain-bar-fill"></div>
          </div>
          <div class="bb-chain-name"></div>
          <div class="bb-chain-progress mono"></div>
        `;
        (row.querySelector('.bb-chain-bar-fill') as HTMLElement).style.width =
          `${(ownedN / totalN) * 100}%`;
        (row.querySelector('.bb-chain-name') as HTMLElement).textContent = chain.name;
        (row.querySelector('.bb-chain-progress') as HTMLElement).textContent =
          `${ownedN}/${totalN}${hasReady ? ' ●' : ''}`;
        row.addEventListener('click', () => {
          this.activeKey = chain.key;
          this.refresh();
        });
        this.rail.appendChild(row);
      }
    }
  }

  private renderDetail(visible: { chain: Chain; visible: UpgradeNode[] }[]): void {
    this.detail.innerHTML = '';
    const active = visible.find((c) => c.chain.key === this.activeKey);
    if (!active) {
      const empty = document.createElement('div');
      empty.className = 'bb-empty';
      empty.textContent = 'No branches available yet — claim a producing planet first.';
      this.detail.appendChild(empty);
      return;
    }
    const { chain, visible: vNodes } = active;
    const meta = CATEGORY_META[chain.category];
    this.detail.style.setProperty('--c', meta.color);

    const ownedN = vNodes.filter((n) => this.empire.hasNode(n.id)).length;
    const totalN = vNodes.length;
    const next = vNodes.find((n) => !this.empire.hasNode(n.id));
    const metrics = this.empire.computeMetrics();

    // Header
    const head = document.createElement('div');
    head.className = 'bb-head';
    head.innerHTML = `
      <div class="bb-head-ico">${meta.icon}</div>
      <div class="bb-head-body">
        <div class="bb-head-eyebrow">${meta.label} chain</div>
        <div class="bb-head-title"></div>
        <div class="bb-head-desc">A ${totalN}-tier chain. Each tier compounds on the previous — buy in order from ${vNodes[0]!.tierLabel} to ${vNodes[vNodes.length - 1]!.tierLabel}.</div>
        <div class="bb-head-stats" data-stats></div>
      </div>
    `;
    (head.querySelector('.bb-head-title') as HTMLElement).textContent = chain.name;

    const stats = head.querySelector('[data-stats]') as HTMLElement;
    stats.appendChild(this.buildStat('Progress', `${ownedN}/${totalN}`, true));
    if (next) {
      stats.appendChild(this.buildStat('Next tier', `${next.tierLabel} · ${next.description}`, false));
      const ready = canAffordNow(this.empire.state.resources, next.cost);
      const eta = ready ? 'Ready' : formatEta(etaFor(next.cost, this.empire.state.resources, metrics.rates));
      const stat = this.buildStat('ETA', eta, true);
      const v = stat.querySelector('.v') as HTMLElement;
      v.style.color = ready ? '#7adf9c' : '';
      stats.appendChild(stat);
    }
    this.detail.appendChild(head);

    // Tier list
    const list = document.createElement('div');
    list.className = 'bb-tier-list';
    for (const node of vNodes) {
      list.appendChild(this.buildTierCard(node, meta.color, metrics.rates));
    }
    this.detail.appendChild(list);
  }

  private buildStat(k: string, v: string, mono: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bb-head-stat';
    el.innerHTML = `<div class="k"></div><div class="v${mono ? ' mono' : ''}"></div>`;
    (el.querySelector('.k') as HTMLElement).textContent = k;
    (el.querySelector('.v') as HTMLElement).textContent = v;
    return el;
  }

  private buildTierCard(node: UpgradeNode, color: string, rates: ResourceBag): HTMLElement {
    const status = this.empire.nodeStatus(node);
    const card = document.createElement('div');
    card.className = 'bb-tier';
    card.dataset.nodeId = node.id;
    card.style.setProperty('--c', color);
    if (status === 'owned') card.classList.add('owned');
    else if (status === 'available') card.classList.add('ready');
    else card.classList.add('locked');

    card.innerHTML = `
      <div class="bb-tier-num"></div>
      <div class="bb-tier-body">
        <div class="bb-tier-name"></div>
        <div class="bb-tier-effect"></div>
        <div class="bb-tier-prereq" data-prereq hidden></div>
      </div>
      <div class="bb-tier-costs" data-costs></div>
      <button class="bb-tier-buy" type="button"></button>
    `;
    (card.querySelector('.bb-tier-num') as HTMLElement).textContent = node.tierLabel;
    (card.querySelector('.bb-tier-name') as HTMLElement).textContent = `${node.name} ${node.tierLabel}`;
    (card.querySelector('.bb-tier-effect') as HTMLElement).textContent = node.description;

    // When the node is gated by a prereq node we haven't bought yet, surface
    // *which* node so the player isn't left guessing why "Locked" appeared.
    const prereqMissing = node.prereq && !this.empire.hasNode(node.prereq);
    if (prereqMissing) {
      const pre = NODES_BY_ID.get(node.prereq!);
      if (pre) {
        const hint = card.querySelector('[data-prereq]') as HTMLElement;
        hint.hidden = false;
        hint.textContent = `Requires ${pre.name} ${pre.tierLabel}`;
      }
    }

    const costsEl = card.querySelector('[data-costs]') as HTMLElement;
    if (status === 'owned') {
      const span = document.createElement('span');
      span.className = 'bb-tier-active';
      span.textContent = 'Active';
      costsEl.appendChild(span);
    } else {
      for (const k of RESOURCE_KEYS) {
        const need = node.cost[k];
        if (need === undefined) continue;
        const has = this.empire.state.resources[k];
        const enough = has >= need;
        const pill = document.createElement('span');
        pill.className = `bb-cost-pill ${enough ? 'ok' : 'short'}`;
        pill.style.setProperty('--c', RESOURCE_COLOR[k]);
        pill.title = RESOURCE_LABEL[k];
        pill.innerHTML = `<span class="bb-cost-dot"></span><span></span>`;
        (pill.querySelector('span:last-child') as HTMLElement).textContent =
          `${fmtCost(has)}/${fmtCost(need)}`;
        costsEl.appendChild(pill);
      }
    }

    const btn = card.querySelector('.bb-tier-buy') as HTMLButtonElement;
    if (status === 'owned') {
      btn.classList.add('owned');
      btn.disabled = true;
      btn.textContent = '✓ Owned';
    } else if (status === 'available') {
      btn.textContent = 'Buy';
      btn.addEventListener('click', () => {
        // Buy is synchronous; empire.subscribe drives the panel refresh.
        buyWithVfx(this.empire, node, btn, color);
      });
    } else {
      btn.disabled = true;
      if (prereqMissing) {
        btn.textContent = 'Locked';
      } else {
        const sec = etaFor(node.cost, this.empire.state.resources, rates);
        btn.textContent = formatEta(sec);
      }
    }
    return card;
  }

  // --- HUD button helpers --------------------------------------------------

  ownedCount(): number {
    return Math.max(0, this.empire.state.unlockedNodes.length - 1);
  }
  totalCount(): number { return UPGRADE_NODES.length - 1; }
  readyCount(): number {
    let n = 0;
    for (const node of UPGRADE_NODES) {
      if (this.empire.nodeStatus(node) === 'available') n++;
    }
    return n;
  }
}

// --- Helpers ---------------------------------------------------------------

// W9 — costs in the late game (Phase 9 intergalactic milestone) hit the
// hundreds-of-millions / billions range, so the upgrade panel needs the same
// suffix ladder as the HUD chips. Below 10K shows the raw integer because
// players still count Tier I-II costs by hand.
function fmtCost(v: number): string {
  if (v < 10) return v.toFixed(1);
  if (v < 10_000) return Math.ceil(v).toString();
  if (v < 1_000_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v < 1_000_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v < 1e12) return `${(v / 1e9).toFixed(2)}B`;
  if (v < 1e15) return `${(v / 1e12).toFixed(2)}T`;
  return `${(v / 1e15).toFixed(2)}Q`;
}

function canAffordNow(have: ResourceBag, cost: Partial<Record<ResourceKey, number>>): boolean {
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined) continue;
    if (have[k] < need) return false;
  }
  return true;
}

function etaFor(
  cost: Partial<Record<ResourceKey, number>>,
  have: ResourceBag,
  rates: ResourceBag,
): number {
  let max = 0;
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined) continue;
    const missing = need - have[k];
    if (missing <= 0) continue;
    const rate = rates[k];
    if (rate <= 0.001) return Infinity;
    const t = missing / rate;
    if (t > max) max = t;
  }
  return max;
}

function formatEta(sec: number): string {
  if (sec <= 0) return 'now';
  if (!isFinite(sec)) return '—';
  if (sec < 60) return `${Math.ceil(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

// Used by NODES_BY_ID lookup elsewhere — keep import alive in case empire/buy
// path indirectly resolves through this file. (Empire.buy uses NODES_BY_ID.)
void NODES_BY_ID;
