# Portal Empires — UI and UX Design

## UI principle

This is a UI-heavy game wrapped around a 3D spectacle. The UI is dense, useful, and readable — more like an operations dashboard than a landing page. The 3D galaxy is **always visible behind the UI** and is what sells the multiplayer/scale wow.

Do not build a marketing-style homepage. The first screen is the populated galaxy with the player's own panels overlaid.

## Two camera modes

The UI must work in both modes the player can be in.

### Sector view (default)

Camera angled above the player's home planet. Their sector dominates the frame. Other empires are visible at the edges as glowing distant clusters. This is where most upgrade clicking happens.

### Galactic map view (zoom-out)

Camera pulled out to a top-down view of the whole galaxy. All 16 empires color-coded. Cross-player routes drawn as gradient arcs. Cargo ships are sparks. The wormhole is the center. **This is the defining screenshot** — the UI in this mode should feel like a strategic command screen.

Toggle: `M` key, or top-left button. Smooth dolly transition (~600 ms). Most panels (resources, milestone, event feed) stay overlaid in both modes; planet/upgrade panels collapse in galactic-map mode and a sector legend takes their place.

## First screen layout (sector view)

Fixed UI zones over the live 3D scene:

- **Top-left**: identity badge (your color + name + sector number), multiplayer connection state, room player count.
- **Top-center**: resource bar (Credits + Ore, with per-second rate).
- **Top-right**: leaderboard (compact, top 5 + your rank).
- **Left panel**: planet list and selected-planet detail, switchable to **Routes** tab.
- **Right panel**: upgrades.
- **Bottom-center**: contextual action bar + current milestone strip.
- **Bottom-right**: event feed (last 5–7 events).
- **Bottom-left**: galactic map toggle button + "Walk to wormhole" shortcut.

Avoid covering the entire screen with opaque UI. Every panel uses `backdrop-filter: blur(12px)` over a semi-transparent background so the galaxy stays visible.

## Visual tone

Tone: clean sci-fi trading desk, *not* purple gradient vaporwave.

Palette:
- Background: near-black navy with deep purple-cyan nebula bleeding through (procedural shader, not gradient CSS).
- **Credits accent**: warm gold (`#f4c95d`).
- **Ore accent**: rust/copper (`#c87856`).
- **Routes / data accent**: cyan (`#5ce0e0`).
- **Identity colors**: 16 high-contrast hues assigned per player slot (HSL evenly spaced, jittered for distinguishability).
- Success: phosphor green. Warning: amber. Error: dim red.

Use these colors in shader uniforms too — the planet's atmosphere matches its sector's tone, the player's own cargo ships glow in their identity color.

## Typography

- **System fonts** for the main HUD by default — instant load, zero asset weight.
- For floating world-space numbers (cargo delivery readouts, planet labels), use **`troika-three-text`** with a system font reference. SDF text scales crisply at any zoom and only costs ~50 KB of code.
- Numbers prominent and tabular (`font-variant-numeric: tabular-nums`).
- Labels short. No paragraph tutorials.

Resource display:
```
Credits  1.24K  +32/s
Ore        480  +7/s
```

## Core panels

### Resource bar (top-center)

- Current amount + per-second rate per resource.
- Hover/tap → source breakdown popover.
- Numbers tick smoothly via `requestAnimationFrame` lerp at 8 Hz, not raw simulation rate.

### Planet panel (left)

Planet rows:
- Color dot (planet kind).
- Name + level.
- Production summary (`+12.4 Cr/s` or `+3.1 Or/s`).
- Lock state (greyed if locked, with cost preview).

Selected planet detail:
- Production rates, storage, level.
- Connected route indicators.
- "Upgrade" + "Unlock new route" buttons.
- Click any planet in the 3D scene → selects it here.

### Routes panel (left, alternate tab)

Two sections: **Internal** and **Cross-player**.

Internal route row: source → target, value/delivery, travel time, level, "Upgrade" button.

Cross-player route row: shows both flags/colors, partner name, your share %, travel time, level, "Dissolve" button. Pulses when a delivery completes.

**Create route flow** (simplified): one button "New Route" → modal lets you pick source planet, then target planet (highlighting valid targets in the 3D view), confirm cost, done. For cross-player: target is a planet in another player's sector, partner gets a `route:proposed` event and accepts.

### Upgrade panel (right)

Compact cards (fit ~6 visible without scroll):
- Label + level.
- Effect line (`+25% Credits`).
- Cost line (color-coded resources).
- Buy button.
- Disabled-state reason on hover/tap.

Per-planet upgrades change to a per-planet sub-tab when you select a planet. Empire-wide upgrades stay constant.

### Leaderboard (top-right)

Fields: rank, name (in identity color), empire value, online indicator, action button.

Action button per row:
- Self → "You" badge.
- Online other → "🎁 Gift" (cooldown-aware) and "🔗 Trade route" if planet is selected.
- Offline other → dim, "💤 dormant" tooltip.

Local player highlighted with a subtle glow. Click rank → camera flies to that player's sector (works in both view modes).

### Event feed (bottom-right)

Short, color-coded:
- `Route completed: +42 Cr` (gold)
- `Mina sent cargo: +120 Cr` (cyan)
- `🔗 Veyra II ↔ your Argon Prime opened` (cyan, big)
- `⚠️ Asteroid storm in Sector 7` (amber)
- `You entered rank #4` (success)

Max 5–7 visible. New events animate in from below; old fade.

### Milestone strip (bottom-center)

Always shows the current milestone goal as a single line with a thin progress bar. When complete, a celebration pulse plays and the next milestone slides in. Drives the first-5-minutes pacing critical for jam judging.

## 3D scene requirements (UI-relevant)

The 3D view must communicate state at all times:

- **Home planet** — central in sector view, atmosphere shell visible.
- **Locked planets** — dim silhouettes with a faint outline.
- **Unlocked planets** — full procedural shader, day/night terminator visible, **city-light intensity directly tied to upgrade level** (the most important visual feedback in the game).
- **Internal trade routes** — single-color thin tube (`TubeGeometry` with energy-flow shader), color = sector color.
- **Cross-player trade routes** — thicker tube, gradient between two players' identity colors. **Visually dominant.**
- **Cargo ships** — small instanced meshes flying along arcs, emissive in owner's color.
- **Other players' empires** — visible at galaxy distance with subtle parallax.
- **Wormhole** — large gold/cyan animated portal, ring of avatars congregating around it.
- **Galactic events** — visible in 3D (asteroid particles, trade boom shimmer, wormhole flare).

Camera:
- Sector view: orbit-like, slight ease, mouse drag for free look (gentle clamp).
- Galactic map: top-down, free pan, mouse-wheel zoom within bounds.
- Always smooth transitions between modes.

The existing player avatar (capsule near wormhole) can stay for portal proximity, but the **economy game does not require WASD**. The avatar is a presence indicator, not the gameplay surface.

## Interaction model

**Desktop (primary):**
- Mouse click for buttons.
- Click planet in 3D → selects in panel.
- Drag in empty space → camera orbit.
- Mouse wheel → zoom (sector mode: dolly; galactic mode: zoom).
- `M` toggles galactic map.
- Hover for tooltips.
- `Esc` closes modals.

**Mobile/tablet (accept reduced experience):**
- Panels collapse into bottom sheets/tabs.
- Resource bar always visible.
- 3D scene is mostly decorative; clicking planets uses single-tap → tooltip → confirm.

The jam priority is desktop. Don't burn time perfecting mobile.

## Feedback (every action visible)

- Button press → CSS transition + identity-color flash.
- Resource gain → number ticks up + small sparkle near the source planet in 3D.
- Upgrade purchased → planet pulses, **city-light shader uniform animates** from old to new intensity.
- Route delivery → small floating number in 3D + event feed line.
- Route created → both endpoint planets pulse in unison, lane fades in over 1 s.
- Cross-player route accepted → both players' screens show coordinated pulse + event feed line.

Use small CSS transitions and Three.js scale/color/uniform pulses. **No heavy animation libraries.**

## Visual polish (production-grade, not placeholder)

The UI must read as cohesive sci-fi, not "default Bootstrap with a dark theme." Concrete rules:

- **Backdrop blur** behind every panel.
- **Thin 1px identity-color border** on the player's own panel sections (their badge, their planet rows, their leaderboard row).
- **Glow on emissive UI elements** matching the bloom on the 3D scene — buttons that boost things glow gold; route buttons glow cyan.
- **No drop shadows** that look like Material design defaults. Use additive glow or none at all.
- **Tabular numbers** everywhere, monospace fallback if needed.
- **Scrollbars styled** (thin, identity-color thumb, transparent track) — default browser scrollbars in dark UI scream "unfinished."
- **Hover state on every interactive thing.** Disabled state has a reason tooltip.

See `TECH_STACK.md` § "What to avoid" for the full anti-placeholder list.

## Accessibility (basic)

- High contrast text against blurred-but-still-dark panel backgrounds.
- Disabled button states include a reason.
- Resource and identity meanings carry both color AND label/icon (color-blind safety).
- Text never overflows containers.
- Click targets ≥ 32×32 px.

## UI implementation notes

No React. No UI framework unless explicitly approved.

Recommended approach:
- `src/game/ui/` — small functions creating/updating DOM nodes.
- UI state is **derived** from `gameState` and the multiplayer snapshot, not duplicated.
- Throttled updates: **don't rebuild the full UI every frame.**
- CSS in a single stylesheet (`src/game/ui/styles.css`) — no CSS-in-JS, no Tailwind.

Update cadence:
- Resource numbers: 8 Hz lerp toward target value.
- Leaderboard: only when network snapshot changes.
- Event feed: on emitted events only.
- Upgrade disabled states: re-evaluated on resource change events, not per frame.
- Galactic map labels: only re-positioned when camera moves (CSS3D `transform`).

Use `troika-three-text` for in-world labels (planet names, floating delivery numbers); use plain DOM for HUD panels.
