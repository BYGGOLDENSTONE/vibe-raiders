// Debug overlay — toggleable, modular, dev-only by default.
//
// Usage:
//   const dbg = createDebugPanel({ enabled: import.meta.env.DEV });
//   dbg.addSection({ id, title, render: () => '<div>...</div>' });
//   dbg.addKey({ key: 'KeyB', label: 'next phase', group: 'atmosphere', fn: () => ... });
//
// Toggle visibility with backtick (`).
// Keys only fire while panel is enabled. Sections re-render at 5 Hz.

export interface DebugSection {
  id: string;
  title: string;
  render: () => string;
  order?: number;
}

export interface DebugKeyBinding {
  key: string;
  label: string;
  group?: string;
  fn: () => void;
}

export interface DebugPanel {
  enabled: boolean;
  visible: boolean;
  toggle: () => void;
  setVisible: (b: boolean) => void;
  addSection: (s: DebugSection) => () => void;
  addKey: (b: DebugKeyBinding) => () => void;
  setStatus: (text: string) => void;
  update: (dt: number) => void;
  destroy: () => void;
}

interface RegisteredSection extends DebugSection {
  bodyEl: HTMLElement;
}

export function createDebugPanel(opts: { enabled: boolean; mountTo?: HTMLElement }): DebugPanel {
  if (!opts.enabled) return makeStub();

  const root = document.createElement('div');
  root.id = 'debug-panel';
  root.innerHTML = `
    <style>
      #debug-panel {
        position: fixed;
        top: 8px;
        right: 8px;
        width: 260px;
        max-height: calc(100vh - 16px);
        background: rgba(8, 5, 3, 0.85);
        border: 1px solid rgba(243, 179, 90, 0.25);
        border-radius: 4px;
        color: #f3b35a;
        font-family: 'JetBrains Mono', 'Consolas', monospace;
        font-size: 11px;
        line-height: 1.45;
        padding: 8px 10px;
        z-index: 200;
        pointer-events: none;
        backdrop-filter: blur(4px);
      }
      #debug-panel.collapsed { width: auto; padding: 4px 8px; }
      #debug-panel.collapsed .dbg-body { display: none; }
      #debug-panel .dbg-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10px;
        letter-spacing: 0.3em;
        color: rgba(243, 179, 90, 0.7);
        margin-bottom: 6px;
      }
      #debug-panel .dbg-status { color: #ffcc6f; opacity: 0.85; }
      #debug-panel .dbg-section { margin-bottom: 8px; }
      #debug-panel .dbg-section:last-child { margin-bottom: 0; }
      #debug-panel .dbg-section-title {
        font-size: 9px;
        letter-spacing: 0.25em;
        color: rgba(243, 179, 90, 0.5);
        border-bottom: 1px solid rgba(243, 179, 90, 0.12);
        padding-bottom: 2px;
        margin-bottom: 3px;
      }
      #debug-panel .dbg-row { display: flex; justify-content: space-between; gap: 8px; }
      #debug-panel .dbg-row .k { color: rgba(243, 179, 90, 0.6); }
      #debug-panel .dbg-row .v { color: #ffcc6f; }
      #debug-panel .dbg-keys { font-size: 10px; opacity: 0.7; }
      #debug-panel .dbg-keys .kbd {
        display: inline-block;
        background: rgba(243, 179, 90, 0.12);
        border: 1px solid rgba(243, 179, 90, 0.25);
        border-radius: 2px;
        padding: 0 4px;
        margin-right: 4px;
        font-size: 10px;
        color: #ffcc6f;
      }
      #debug-panel .dbg-bar {
        height: 4px;
        background: rgba(243, 179, 90, 0.1);
        border-radius: 2px;
        overflow: hidden;
        margin-top: 2px;
      }
      #debug-panel .dbg-bar > span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #c97a2a, #ffcc6f);
      }
    </style>
    <div class="dbg-head">
      <span>DEBUG ~</span>
      <span class="dbg-status"></span>
    </div>
    <div class="dbg-body"></div>
  `;
  (opts.mountTo ?? document.body).appendChild(root);

  const headStatus = root.querySelector('.dbg-status') as HTMLElement;
  const body = root.querySelector('.dbg-body') as HTMLElement;
  const sections = new Map<string, RegisteredSection>();
  const keys = new Map<string, DebugKeyBinding>();

  let visible = true;
  let renderAccum = 0;

  const keysSectionEl = document.createElement('div');
  keysSectionEl.className = 'dbg-section';
  body.appendChild(keysSectionEl);

  const renderKeysSection = () => {
    const groups = new Map<string, DebugKeyBinding[]>();
    for (const b of keys.values()) {
      const g = b.group ?? 'general';
      let list = groups.get(g);
      if (!list) { list = []; groups.set(g, list); }
      list.push(b);
    }
    let html = '<div class="dbg-section-title">KEYS</div><div class="dbg-keys">';
    for (const [g, list] of groups) {
      html += `<div style="opacity:0.55;margin-top:3px;">${escape(g)}</div>`;
      for (const b of list) {
        html += `<div><span class="kbd">${escape(keyLabel(b.key))}</span>${escape(b.label)}</div>`;
      }
    }
    html += '</div>';
    keysSectionEl.innerHTML = html;
  };

  const renderSections = () => {
    const sorted = [...sections.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const s of sorted) {
      try {
        s.bodyEl.innerHTML = s.render();
      } catch (err) {
        s.bodyEl.innerHTML = `<div class="dbg-row"><span class="k">err</span><span class="v">${escape(String(err))}</span></div>`;
      }
    }
  };

  const update = (dt: number) => {
    if (!visible) return;
    renderAccum += dt;
    if (renderAccum >= 0.2) {
      renderSections();
      renderAccum = 0;
    }
  };

  const setVisible = (b: boolean) => {
    visible = b;
    root.classList.toggle('collapsed', !b);
    if (b) renderSections();
  };

  const toggle = () => setVisible(!visible);

  const addSection = (s: DebugSection): (() => void) => {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'dbg-section';
    sectionEl.dataset.id = s.id;
    const titleEl = document.createElement('div');
    titleEl.className = 'dbg-section-title';
    titleEl.textContent = s.title;
    const bodyEl = document.createElement('div');
    sectionEl.appendChild(titleEl);
    sectionEl.appendChild(bodyEl);
    body.insertBefore(sectionEl, keysSectionEl);
    sections.set(s.id, { ...s, bodyEl });
    return () => {
      sectionEl.remove();
      sections.delete(s.id);
    };
  };

  const addKey = (b: DebugKeyBinding): (() => void) => {
    keys.set(b.key, b);
    renderKeysSection();
    return () => {
      keys.delete(b.key);
      renderKeysSection();
    };
  };

  const setStatus = (text: string) => {
    headStatus.textContent = text;
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.repeat) return;
    if (isTypingTarget(ev.target)) return;
    if (ev.code === 'Backquote') {
      ev.preventDefault();
      toggle();
      return;
    }
    if (!visible) return;
    const b = keys.get(ev.code);
    if (b) { ev.preventDefault(); b.fn(); }
  };
  document.addEventListener('keydown', onKeyDown);

  const destroy = () => {
    document.removeEventListener('keydown', onKeyDown);
    root.remove();
  };

  setVisible(true);

  return {
    enabled: true,
    get visible() { return visible; },
    toggle,
    setVisible,
    addSection,
    addKey,
    setStatus,
    update,
    destroy,
  };
}

function makeStub(): DebugPanel {
  return {
    enabled: false,
    visible: false,
    toggle() {},
    setVisible() {},
    addSection() { return () => {}; },
    addKey() { return () => {}; },
    setStatus() {},
    update() {},
    destroy() {},
  };
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Helpers for building section HTML.
export function dbgRow(k: string, v: string | number): string {
  return `<div class="dbg-row"><span class="k">${escape(k)}</span><span class="v">${escape(String(v))}</span></div>`;
}

export function dbgBar(pct: number): string {
  const clamped = Math.max(0, Math.min(1, pct));
  return `<div class="dbg-bar"><span style="width:${(clamped * 100).toFixed(1)}%"></span></div>`;
}
