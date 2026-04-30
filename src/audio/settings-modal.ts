// Settings modal — gear button in the top-right opens a panel with master /
// music / SFX volume sliders + mute toggles. All three persist via the
// AudioManager (localStorage key vibecoder.audio.v1).

import { audio } from './audio';
import type { AudioSettings } from './audio';
import { sfxClick } from './sfx';

export function mountSettings(host: HTMLElement): void {
  const button = document.createElement('button');
  button.className = 'settings-gear';
  button.type = 'button';
  button.setAttribute('aria-label', 'Audio settings');
  button.innerHTML = '<span class="settings-gear-ico">⚙</span>';
  host.appendChild(button);

  let modal: HTMLDivElement | null = null;
  let unsubscribe: (() => void) | null = null;

  const close = (): void => {
    if (!modal) return;
    modal.classList.remove('settings-open');
    modal.addEventListener('transitionend', () => modal?.remove(), { once: true });
    modal = null;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const open = (): void => {
    if (modal) return;
    modal = buildModal(close);
    host.appendChild(modal);
    // double rAF so the .settings-open transition actually runs
    requestAnimationFrame(() => requestAnimationFrame(() => modal?.classList.add('settings-open')));
    syncFromSettings(modal, audio.getSettings());
    unsubscribe = audio.subscribe((s) => {
      if (modal) syncFromSettings(modal, s);
    });
  };

  button.addEventListener('click', () => {
    sfxClick();
    if (modal) close();
    else open();
  });
}

function buildModal(close: () => void): HTMLDivElement {
  const modal = document.createElement('div');
  modal.className = 'settings-modal';
  modal.innerHTML = `
    <div class="settings-backdrop"></div>
    <div class="settings-card" role="dialog" aria-label="Audio settings">
      <div class="settings-head">
        <span class="settings-title">Audio</span>
        <button class="settings-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="settings-body">
        ${row('master', 'Master')}
        ${row('music', 'Music')}
        ${row('sfx', 'Sound Effects')}
      </div>
      <div class="settings-foot">
        <span class="settings-hint">Settings persist locally.</span>
      </div>
    </div>
  `;

  modal.querySelector('.settings-backdrop')!.addEventListener('click', close);
  modal.querySelector('.settings-close')!.addEventListener('click', () => {
    sfxClick();
    close();
  });

  // Slider + mute wiring. The slider patches *Volume; the mute checkbox
  // patches *Muted. Both push through audio.setSettings → applyGains so the
  // change is audible immediately.
  for (const which of ['master', 'music', 'sfx'] as const) {
    const slider = modal.querySelector<HTMLInputElement>(`[data-slider="${which}"]`)!;
    const mute = modal.querySelector<HTMLInputElement>(`[data-mute="${which}"]`)!;

    slider.addEventListener('input', () => {
      const v = Number(slider.value) / 100;
      audio.setSettings({ [`${which}Volume`]: v } as Partial<AudioSettings>);
    });
    mute.addEventListener('change', () => {
      audio.setSettings({ [`${which}Muted`]: mute.checked } as Partial<AudioSettings>);
      sfxClick();
    });
  }

  // Esc closes
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      close();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  return modal;
}

function row(which: 'master' | 'music' | 'sfx', label: string): string {
  return `
    <div class="settings-row" data-row="${which}">
      <div class="settings-row-head">
        <span class="settings-label">${label}</span>
        <span class="settings-value" data-value="${which}">70%</span>
      </div>
      <div class="settings-row-controls">
        <input type="range" min="0" max="100" step="1" value="70" class="settings-slider" data-slider="${which}" />
        <label class="settings-mute">
          <input type="checkbox" data-mute="${which}" />
          <span>Mute</span>
        </label>
      </div>
    </div>
  `;
}

function syncFromSettings(modal: HTMLElement, s: AudioSettings): void {
  for (const which of ['master', 'music', 'sfx'] as const) {
    const slider = modal.querySelector<HTMLInputElement>(`[data-slider="${which}"]`);
    const valueEl = modal.querySelector<HTMLElement>(`[data-value="${which}"]`);
    const mute = modal.querySelector<HTMLInputElement>(`[data-mute="${which}"]`);
    if (!slider || !valueEl || !mute) continue;
    const v = s[`${which}Volume`];
    const m = s[`${which}Muted`];
    const pct = Math.round(v * 100);
    if (document.activeElement !== slider) slider.value = String(pct);
    valueEl.textContent = m ? 'Muted' : `${pct}%`;
    mute.checked = m;
    const row = modal.querySelector(`[data-row="${which}"]`);
    row?.classList.toggle('settings-row-muted', m);
  }
}
