// Upgrade modal — full-screen overlay with a pannable skill-tree canvas.
// The catalogue radiates from a central "Empire Core" node:
//   UP    : Expansion chain
//   RIGHT : Production fan
//   LEFT  : Logistics
//   DOWN  : Drones
//   UP    : Tech (above the production fan)
// Edges are drawn with SVG; nodes are absolutely-positioned divs.

import type { Empire } from './empire';
import { CORE_NODE_ID, UPGRADE_NODES, catalogueExtent } from './upgrades';
import {
  RESOURCE_COLOR,
  RESOURCE_KEYS,
  RESOURCE_LABEL,
  type UpgradeCategory,
  type UpgradeNode,
} from './types';

const NODE_W = 124;
const NODE_H = 56;

const CATEGORY_COLOR: Record<UpgradeCategory, string> = {
  expansion:  '#7ec8ff',
  production: '#9bd64a',
  drones:     '#f0a560',
  logistics:  '#a9b3c4',
  tech:       '#c89bff',
};

interface NodeDom {
  root: HTMLDivElement;
  node: UpgradeNode;
}

export class UpgradePanel {
  private modal: HTMLDivElement;
  private viewport: HTMLDivElement;
  private worldDiv: HTMLDivElement;
  private edgesSvg: SVGSVGElement;
  private edgesGroup: SVGGElement;
  private empire: Empire;
  private nodes = new Map<string, NodeDom>();
  private opened = false;
  private listeners = new Set<() => void>();

  // Pan state
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartPanX = 0;
  private dragStartPanY = 0;
  private dragMoved = false;

  constructor(parent: HTMLElement, empire: Empire) {
    this.empire = empire;
    this.modal = document.createElement('div');
    this.modal.className = 'em-modal';
    this.modal.hidden = true;
    this.modal.innerHTML = `
      <div class="em-modal-backdrop" data-close></div>
      <div class="em-modal-shell">
        <header class="em-modal-head">
          <div class="em-modal-title">Empire Upgrades</div>
          <div class="em-modal-count" data-count>0 / 0</div>
          <div class="em-modal-hint">Drag to pan · click an unlocked node to buy</div>
          <button class="em-modal-close" data-close aria-label="Close">×</button>
        </header>
        <div class="em-modal-body">
          <div class="em-tree-viewport" data-viewport></div>
        </div>
      </div>
    `;
    parent.appendChild(this.modal);
    this.viewport = this.modal.querySelector('[data-viewport]') as HTMLDivElement;

    // SVG layer for edges (sits behind nodes, panned together)
    this.edgesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.edgesSvg.classList.add('em-tree-edges');
    this.edgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.edgesSvg.appendChild(this.edgesGroup);
    this.viewport.appendChild(this.edgesSvg);

    // Div world for nodes
    this.worldDiv = document.createElement('div');
    this.worldDiv.className = 'em-tree-world';
    this.viewport.appendChild(this.worldDiv);

    this.modal.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', () => this.close());
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.opened) this.close();
    });

    this.buildEdges();
    this.buildNodes();
    this.installPan();

    this.refresh();
  }

  // --- Open/close ----------------------------------------------------------

  isOpen(): boolean { return this.opened; }
  open(): void {
    this.modal.hidden = false;
    this.opened = true;
    this.refresh();
    // Defer the recenter to next frame so the viewport has its final size.
    requestAnimationFrame(() => this.recenter());
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

  // --- Build graph ---------------------------------------------------------

  private buildEdges(): void {
    for (const node of UPGRADE_NODES) {
      if (!node.prereq) continue;
      const src = UPGRADE_NODES.find((n) => n.id === node.prereq);
      if (!src) continue;
      const x1 = src.x + NODE_W / 2;
      const y1 = src.y + NODE_H / 2;
      const x2 = node.x + NODE_W / 2;
      const y2 = node.y + NODE_H / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // Strictly orthogonal routing: straight line if axially aligned,
      // L-shape (one 90° turn) otherwise. Horizontal-first when the chain
      // lives mostly to one side; vertical-first otherwise. Never diagonal.
      let d: string;
      if (x1 === x2 || y1 === y2) {
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
        // Wide step: go horizontal first, then vertical to target.
        d = `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
      } else {
        // Tall step: go vertical first, then horizontal to target.
        d = `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
      }
      path.setAttribute('d', d);
      path.setAttribute('class', 'em-tree-edge');
      path.dataset.from = src.id;
      path.dataset.to = node.id;
      this.edgesGroup.appendChild(path);
    }
    // Size the SVG to encompass the whole catalogue (with margin).
    const ext = catalogueExtent();
    const margin = 200;
    const w = ext.maxX - ext.minX + NODE_W + margin * 2;
    const h = ext.maxY - ext.minY + NODE_H + margin * 2;
    this.edgesSvg.setAttribute('viewBox', `${ext.minX - margin} ${ext.minY - margin} ${w} ${h}`);
    this.edgesSvg.style.width = `${w}px`;
    this.edgesSvg.style.height = `${h}px`;
    this.edgesSvg.style.left = `${ext.minX - margin}px`;
    this.edgesSvg.style.top = `${ext.minY - margin}px`;
  }

  private buildNodes(): void {
    for (const node of UPGRADE_NODES) {
      const div = document.createElement('div');
      div.className = `em-tree-node em-tree-node-${node.category}`;
      div.style.left = `${node.x}px`;
      div.style.top = `${node.y}px`;
      div.style.width = `${NODE_W}px`;
      div.style.height = `${NODE_H}px`;
      div.style.setProperty('--cat', CATEGORY_COLOR[node.category]);
      div.dataset.id = node.id;
      // The Core gets a different look — the centre of the empire.
      if (node.id === CORE_NODE_ID) div.classList.add('em-tree-node-core');
      div.innerHTML = `
        <div class="em-node-head">
          <span class="em-node-name"></span>
          <span class="em-node-tier"></span>
        </div>
        <div class="em-node-effect"></div>
        <div class="em-node-cost" data-cost></div>
      `;
      (div.querySelector('.em-node-name') as HTMLElement).textContent = node.name;
      (div.querySelector('.em-node-tier') as HTMLElement).textContent = node.tierLabel;
      (div.querySelector('.em-node-effect') as HTMLElement).textContent = node.description;
      div.title = `${node.name} ${node.tierLabel}`;
      div.addEventListener('click', () => {
        if (this.dragMoved) return;
        if (this.empire.canBuy(node)) {
          this.empire.buy(node.id);
          this.refresh();
        }
      });
      this.worldDiv.appendChild(div);
      this.nodes.set(node.id, { root: div, node });
    }
  }

  // --- Pan -----------------------------------------------------------------

  private installPan(): void {
    // Pointer capture is acquired *only* once the user moves past the drag
    // threshold. Capturing on pointerdown swallows the node's synthetic click
    // event, which manifests as "I tap a node and nothing happens".
    let pending = false;
    this.viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pending = true;
      this.isDragging = false;
      this.dragMoved = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartPanX = this.panX;
      this.dragStartPanY = this.panY;
    });
    this.viewport.addEventListener('pointermove', (e) => {
      if (!pending && !this.isDragging) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (!this.isDragging && Math.abs(dx) + Math.abs(dy) > 4) {
        this.isDragging = true;
        this.dragMoved = true;
        try { this.viewport.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      if (this.isDragging) {
        this.panX = this.dragStartPanX + dx;
        this.panY = this.dragStartPanY + dy;
        this.applyPan();
      }
    });
    const finish = (e: PointerEvent): void => {
      pending = false;
      if (this.isDragging) {
        this.isDragging = false;
        try { this.viewport.releasePointerCapture(e.pointerId); } catch { /* released */ }
      }
    };
    this.viewport.addEventListener('pointerup', finish);
    this.viewport.addEventListener('pointercancel', finish);
  }

  private applyPan(): void {
    this.worldDiv.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
    this.edgesSvg.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
  }

  // Centre the viewport on the Core node when the modal opens.
  private recenter(): void {
    const target = UPGRADE_NODES.find((n) => n.id === CORE_NODE_ID);
    if (!target) return;
    const vw = this.viewport.clientWidth || 800;
    const vh = this.viewport.clientHeight || 500;
    this.panX = vw / 2 - (target.x + NODE_W / 2);
    this.panY = vh / 2 - (target.y + NODE_H / 2);
    this.applyPan();
  }

  // --- Refresh -------------------------------------------------------------

  refresh(): void {
    const counter = this.modal.querySelector('[data-count]') as HTMLElement | null;
    if (counter) {
      // Subtract the always-owned core from the counter so it reads naturally.
      const owned = Math.max(0, this.empire.state.unlockedNodes.length - 1);
      const total = UPGRADE_NODES.length - 1;
      counter.textContent = `${owned} / ${total} owned`;
    }

    for (const { root: el, node } of this.nodes.values()) {
      const status = this.empire.nodeStatus(node);
      el.classList.toggle('em-node-owned', status === 'owned');
      el.classList.toggle('em-node-ready', status === 'available');
      el.classList.toggle('em-node-locked', status === 'locked');
      el.classList.toggle('em-node-hidden', status === 'hidden');

      const costEl = el.querySelector('[data-cost]') as HTMLElement;
      if (status === 'owned' || node.id === CORE_NODE_ID) {
        costEl.innerHTML = '';
      } else {
        costEl.innerHTML = renderCost(node.cost, this.empire.state.resources);
      }
    }

    // Edge highlighting
    this.edgesGroup.querySelectorAll('.em-tree-edge').forEach((line) => {
      const path = line as SVGPathElement;
      const from = path.dataset.from ?? '';
      const to = path.dataset.to ?? '';
      const fromOwned = this.empire.hasNode(from);
      const toOwned = this.empire.hasNode(to);
      path.classList.toggle('em-tree-edge-active', fromOwned && toOwned);
      path.classList.toggle('em-tree-edge-ready', fromOwned && !toOwned);
    });
  }

  // For the HUD button
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

function renderCost(cost: Partial<Record<string, number>>, have: Record<string, number>): string {
  const parts: string[] = [];
  for (const k of RESOURCE_KEYS) {
    const need = cost[k];
    if (need === undefined) continue;
    const has = have[k] ?? 0;
    const enough = has >= need;
    const display = need < 10 ? need.toFixed(1) : Math.ceil(need).toString();
    parts.push(
      `<span class="em-cost-pill ${enough ? '' : 'short'}" style="--c:${RESOURCE_COLOR[k]}" title="${RESOURCE_LABEL[k]}">` +
      `<span class="em-cost-dot"></span>${display}` +
      `</span>`,
    );
  }
  return parts.join('');
}
