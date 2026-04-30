// Debug panel — small floating widget for testing the upgrade flow.
// Only meant for development / play-testing; not gated behind a flag because
// the project is single-player and the user wants quick reset access.

import type { Empire } from './empire';

export class DebugPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private toggleBtn: HTMLButtonElement;
  private empire: Empire;
  private opened = false;

  constructor(parent: HTMLElement, empire: Empire) {
    this.empire = empire;
    this.root = document.createElement('div');
    this.root.className = 'em-debug';
    this.root.innerHTML = `
      <button class="em-debug-toggle" type="button" data-toggle>
        <span class="em-debug-toggle-ico">⚙</span>
        <span class="em-debug-toggle-label">Debug</span>
      </button>
      <div class="em-debug-body" data-body hidden>
        <div class="em-debug-h">Debug</div>
        <div class="em-debug-row">
          <button class="em-debug-btn" data-grant="1000">+1 000 res</button>
          <button class="em-debug-btn" data-grant="10000">+10 000 res</button>
        </div>
        <div class="em-debug-row">
          <button class="em-debug-btn warn" data-reset>Reset empire</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('[data-body]') as HTMLDivElement;
    this.toggleBtn = this.root.querySelector('[data-toggle]') as HTMLButtonElement;

    this.toggleBtn.addEventListener('click', () => this.toggle());

    this.root.querySelectorAll<HTMLButtonElement>('[data-grant]').forEach((btn) => {
      const amt = Number(btn.dataset.grant);
      btn.addEventListener('click', () => {
        this.empire.grantAll(amt);
      });
    });

    const resetBtn = this.root.querySelector('[data-reset]') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => {
      // Block accidental wipe — the save is per-galaxy-seed but still real.
      const ok = window.confirm(
        'Reset empire?\n\nThis wipes all owned upgrades and resources, and re-picks the home planet. Galaxy itself stays the same.',
      );
      if (!ok) return;
      this.empire.reset();
      this.close();
    });

    // Close when clicking outside the panel.
    document.addEventListener('pointerdown', (e) => {
      if (!this.opened) return;
      if (this.root.contains(e.target as Node)) return;
      this.close();
    });
  }

  toggle(): void { this.opened ? this.close() : this.open(); }
  open(): void {
    this.opened = true;
    this.body.hidden = false;
    this.root.classList.add('open');
  }
  close(): void {
    this.opened = false;
    this.body.hidden = true;
    this.root.classList.remove('open');
  }
}
