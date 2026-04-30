// Pre-game overlay: pick Solo / Multiplayer, optionally set name + colour.
//
// Lifecycle: mount() shows the screen, the user picks, the supplied callback
// fires with the resolved SessionConfig, and dispose() removes the DOM. The
// caller (main.ts) is responsible for instantiating the App after the
// callback fires.

import {
  PROFILE_COLORS,
  autoProfile,
  type SessionConfig,
} from './multiplayer/profile';
import type { GameMode } from './empire/types';
import type { PlayerProfile } from './multiplayer/protocol';

export class StartScreen {
  private host: HTMLElement;
  private root: HTMLDivElement | null = null;
  private onConfirm: (config: SessionConfig) => void;
  private mode: GameMode = 'solo';
  private chosenColor: string = PROFILE_COLORS[4] ?? '#9be8ff';
  private nameInput: HTMLInputElement | null = null;

  constructor(host: HTMLElement, onConfirm: (config: SessionConfig) => void) {
    this.host = host;
    this.onConfirm = onConfirm;
  }

  mount(): void {
    const root = document.createElement('div');
    root.className = 'ss-root';
    root.innerHTML = `
      <div class="ss-card">
        <div class="ss-eyebrow">The Vibecoder's Guide to the Galaxy</div>
        <h1 class="ss-title">Choose your path</h1>

        <div class="ss-modes">
          <button class="ss-mode" data-mode="solo">
            <div class="ss-mode-icon">★</div>
            <div class="ss-mode-name">Solo</div>
            <div class="ss-mode-blurb">Your own galaxy. Build at your own pace.</div>
          </button>
          <button class="ss-mode" data-mode="mp">
            <div class="ss-mode-icon">◆</div>
            <div class="ss-mode-name">Multiplayer</div>
            <div class="ss-mode-blurb">Shared galaxy with up to 16 players.</div>
          </button>
        </div>

        <div class="ss-profile" data-visible="false">
          <div class="ss-profile-row">
            <label class="ss-label" for="ss-name">Pilot name</label>
            <input id="ss-name" class="ss-input" maxlength="20" placeholder="leave blank to auto-generate" />
          </div>
          <div class="ss-profile-row">
            <span class="ss-label">Banner colour</span>
            <div class="ss-colors">
              ${PROFILE_COLORS.map((c, i) => (
                `<button class="ss-color${i === 4 ? ' active' : ''}" data-color="${c}" style="--c:${c}" aria-label="color ${c}"></button>`
              )).join('')}
            </div>
          </div>
          <div class="ss-profile-hint">Skip both to spawn as <code>Player-XXXX</code> with a random colour.</div>
        </div>

        <div class="ss-actions">
          <button class="ss-launch" data-launch>Launch</button>
        </div>

        <div class="ss-foot">
          Vibe Jam 2026 · single shared galaxy when in Multiplayer · resources &amp; upgrades stay private
        </div>
      </div>
    `;
    this.host.appendChild(root);
    this.root = root;

    this.wireEvents(root);
    this.applyModeVisibility();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
  }

  private wireEvents(root: HTMLDivElement) {
    for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('[data-mode]'))) {
      btn.addEventListener('click', () => {
        const m = btn.dataset.mode === 'mp' ? 'mp' : 'solo';
        this.mode = m;
        this.applyModeVisibility();
      });
    }
    for (const swatch of Array.from(root.querySelectorAll<HTMLButtonElement>('.ss-color'))) {
      swatch.addEventListener('click', () => {
        for (const s of Array.from(root.querySelectorAll('.ss-color'))) s.classList.remove('active');
        swatch.classList.add('active');
        this.chosenColor = swatch.dataset.color ?? this.chosenColor;
      });
    }
    this.nameInput = root.querySelector<HTMLInputElement>('#ss-name');
    const launch = root.querySelector<HTMLButtonElement>('[data-launch]');
    launch?.addEventListener('click', () => this.confirm());
    // Keyboard: Enter on the name input fires Launch.
    this.nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirm();
    });
  }

  private applyModeVisibility() {
    if (!this.root) return;
    for (const btn of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-mode]'))) {
      btn.classList.toggle('active', btn.dataset.mode === this.mode);
    }
    const profile = this.root.querySelector<HTMLDivElement>('.ss-profile');
    if (profile) profile.dataset.visible = this.mode === 'mp' ? 'true' : 'false';
  }

  // Build a profile from the current UI state. Empty name → auto-generate.
  // Solo also gets a profile (used for self-marker tinting later) but no
  // name is required, so we just hand back the chosen colour with a generic
  // label that never gets shown.
  private resolveProfile(): PlayerProfile {
    if (this.mode === 'solo') {
      return { name: 'You', color: this.chosenColor };
    }
    const typed = this.nameInput?.value.trim() ?? '';
    if (!typed) return autoProfile();
    return { name: typed.slice(0, 20), color: this.chosenColor };
  }

  private confirm() {
    const config: SessionConfig = { mode: this.mode, profile: this.resolveProfile() };
    this.onConfirm(config);
  }
}

// Renders a tiny "↻ change" link in the top-right of the game UI. Clicking it
// clears the saved session and reloads the page so the start screen shows
// again. Lives outside the App so the link is decoupled from the game scene.
export function mountChangeProfileLink(host: HTMLElement, onClick: () => void): void {
  const link = document.createElement('button');
  link.className = 'ss-change-link';
  link.type = 'button';
  link.textContent = '↻ change profile';
  link.addEventListener('click', onClick);
  host.appendChild(link);
}
