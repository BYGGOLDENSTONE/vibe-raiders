# The Vibecoder's Guide to the Galaxy

> **Game title:** The Vibecoder's Guide to the Galaxy.
> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders
> **Status:** Wave 10 complete — full 100-galaxy universe with strict LOD. Cosmetic distant-galaxy billboards (W9's skydome decor) are gone; the 100 procedural galaxies fill that role themselves. Every galaxy carries its own black hole (sized proportionally to disc radius, ratios `inner ≈ radius × 0.0143` / `outer ≈ radius × 0.0857`) and a bulge billboard now lying flat on the galaxy-local XZ plane (matches the actual system disc instead of standing upright). The bulge stays at ~30 % intensity in galaxy view so the spiral structure shows behind the real systems instead of disappearing the moment the player zooms in. LOD: each galaxy has a `systemsGroup` parent for its 200 system meshes; only the active galaxy's `systemsGroup` and black hole are visible / updated, every other galaxy is just its bulge billboard (~99 cheap quads). Labels are also lazy — galaxy labels stay resident, system / planet / moon labels only build for the active galaxy and rebuild on switch. Camera far plane 600k → 2 M; universe view distance 420k → 1.2 M; skydome 70k → 120k. Generation rewrote to position-first / build-system-on-accept so 100 × 200 = 20 000 systems load in ~1-2 s instead of ~30 s. Save key bumped: solo `vibecoder.empire.v8`, MP `vibecoder.empire.mp.v3` (old saves discard).

---

## Project direction

**Incremental space empire — multiplayer.**

The galaxy from Wave 1 is the playable map. Wave 2 layered the resource economy and upgrade tree on top. Future waves add planet-surface visuals, system expansion, and the PartyKit relay so other players' empires become visible.

---

## What's done

### Wave 1 — galaxy simulation (carry-over)
A 3-layer procedural galaxy:
1. **Galaxy layer** — ~200 star systems on spiral arms around a supermassive black hole.
2. **System layer** — fly into a system; planets orbit the star with rings, moons, orbit lines.
3. **Planet layer** — focus on a planet; its moons orbit it, sibling planets remain visible.

All bodies are procedural — no textures, no external assets. GLSL fragment shaders for planets, stars, moons, accretion disk, nebula skydome. Full reference in **`docs/GALAXY.md`**.

### Wave 2 — empire foundation (this session)

Gameplay layer that sits on top of the galaxy view:

- **Seven resources, 1:1 with planet types**: Metal (rocky), Water (ocean), Gas (gas), Crystal (ice), Plasma (lava), Silicon (desert), Chemical (toxic). Same global pool for every player; you only earn a resource if you own a planet of that type, so player must spread to access all of them.
- **Top resource HUD**: single straight row of compact chips (`[●] METAL 153 +0.8/s`), seven total + an `Upgrades` launcher button. Locked resources show `—`. Lives top-center, below the layer switcher.
- **Skill-tree modal** (`▦ Upgrades` button → full-screen overlay):
  - ~150 nodes laid out on a 140 px grid, edges drawn as straight or L-shaped SVG paths (no curves, no diagonals).
  - **CORE** node at origin, always owned.
  - **Up column**: Expansion (Moon → Elevator → Shipyard → System Expansion → Wormhole Observatory → Transit → Trade Hub).
  - **East half**: 7 mining lanes + 7 optimisation rows, alternating above and below row 0 so resource lanes are interleaved instead of stacked as one block.
  - **West half**: 10 chains of logistics, drones, and tech mixed across rows. Tech chains have **cross-category prereqs** (Industrial Doctrine ← Storage Bays II, Storage Doctrine ← Refinery II, Swarm Doctrine ← Drone Fleet III, Quantum Compute ← Drone Engines II) so the tree feels woven, not striped.
  - Modal is pannable with mouse drag (capture only acquires after >4 px movement so node clicks aren't swallowed). Esc / backdrop click / × closes.
- **Tick** runs every render frame, dt-driven. Trickle of `0.8/s` per owned producing planet so the very first upgrade is reachable in ~10 s.
- **Deterministic starting planet**: scans the galaxy for habitable + moon-bearing worlds and picks the best (ocean+temperate > rocky+temperate > rocky+any). Persisted across reloads.
- **Save/load**: `localStorage` under `vibecoder.empire.v3`. Empire auto-saves every 5 s of wall clock and on every purchase. No offline progress.
- **Detail panel** lives on the right (top: 132 px so it doesn't collide with the HUD). The old bottom-left "planets in system" list was removed — clicking labels and the system view itself already does that job.

### Wave 2.5 — upgrade panel redesign (this session)

The pannable skill-tree canvas was scrapped in favour of a **Branch Browser** modal. Driven by a Claude Design handoff (`Galaxy Upgrade Tree.html` prototype): the user explicitly preferred the Browser layout over the constellation/orrery alternatives.

- **Left rail**: chains grouped under category headers (Expansion → Production → Drones → Logistics → Tech). Each chain row shows a coloured progress bar, name, `owned/total`, and a pulsing dot when a tier is buyable. Click selects the chain — no panning, no zoom.
- **Right detail pane**: chain header (icon, eyebrow, description, Progress / Next tier / ETA stats) above a vertical list of tier cards. Each card has the tier glyph, effect, cost pills (`have/need`, green when affordable, red when short), and a `Buy` button. Locked tiers show ETA or `Locked`; owned tiers show `✓ Owned` and an `Active` badge.
- **Buy VFX** (`src/empire/vfx.ts`): on click, drain particles fly from each consumed HUD chip toward the buy button (the chips also shake + tint with `--c`), then 280 ms later the actual `empire.buy()` lands and a burst (radial sparks, ring shockwave, soft flash, 18 dots) plus a floating `UNLOCKED` label fires at the button. The tier card flashes with a category-coloured glow. Respects `prefers-reduced-motion`.
- **HUD chips** carry `data-resource="<key>"` so VFX can target them.
- **Modal** still keyboard-friendly: Esc closes, backdrop click closes, × button closes. Scroll inside the rail and detail pane independently.
- **Deleted**: `em-tree-*`, `em-node-*` styles + the panning logic. `panel.ts` is now ~290 lines without any drag/pan code.

### Wave 3 — planet-surface visuals (this session)

Owned home planet now reads as an active industrial world rather than a bare procedural sphere:

- **Factories** (`src/empire/surface.ts`) — 3 baseline + 1 per unlocked mining-rate tier for the planet's resource (cap 9). Procedural towers (BoxGeometry body + cap + antenna), oriented to the surface normal so they stand upright wherever they land. Cap colour matches the resource's HUD chip. Bodies live under `planet.body`, so they rotate with the axial spin like the rest of the planet.
- **Drones** — `8 + 6 × drone-count level` (so the swarm reads as dense even at level 0). Each drone slerp-interpolates between two random factory anchors with a sine-loft so paths arc above the surface. Speed scales with `metrics.droneSpeed`. `MeshBasicMaterial` + additive blending gives an emissive look without needing extra lights.
- **Deterministic placement** — factory positions come from a Fibonacci spiral seeded by `hash(planet.id + '|surface')`, jittered by RNG so the same planet always produces the same skyline.
- **Lifecycle** (`app.ts`) — `rebuildSurfaceIfNeeded()` runs on construction and on every `empire.subscribe` emit, but cheap-skips when both `factoryCount` and `droneCount` are unchanged (no GC churn from unrelated purchases). `disposeSurface` drops geometries/materials when rebuilding.
- **Tick** — `updateSurface(handle, dt, metrics)` advances drone `t` parameters in the main render loop. ~30 drones × tiny sphere mesh, no perf concern.

### Wave 4-C/D/E — balance pass + claim flows (this session)

The previous balance let a single planet hit ~5.7 M/s metal once drone upgrades stacked, because (count × cargoMul × speedMul) compounded multiplicatively. The W4-C pass flattens the drone formula and reduces tier values across the board. W4-D and W4-E added the missing player-choice moments (homeworld pick, moon pick).

**Balance pass (W4-C):**

- `docs/balance.csv` is the source-of-truth — every chain's old vs new tier values, plus the diagnosis of where the multiplier explosion came from.
- `droneThroughput` is now **additive**: `1 + 0.05*N + cargoAdd + speedAdd` instead of `(1 + 0.05*N) × cargoMul × speedMul`. Max throughput went from ×4900 to ~×7-8.
- `PROD_MUL_PER_TIER` reduced from `[0.25, 0.50, 1.00, 2.00, 4.00, 8.00]` (sum 15.75) to `[0.10, 0.20, 0.30, 0.50, 0.70, 1.00]` (sum 2.8 = ×3.8 max).
- Refinery + Industrial Doctrine (global-mul): max combined +140% (was +1820%).
- Drone Cargo + Auto-Sort (drone-cargo): max combined +200% (was +2790%).
- Drone Engines + Quantum Compute (drone-speed): max combined +160% (was +2135%).
- Drone Fleet + Swarm Doctrine (drone-count): cap 34 drones (was 119).
- Storage Bays reduced; Storage Doctrine kept (storage = ceiling, not a rate multiplier — can't compound).
- Milestone costs unchanged. Trade Hub @ 50M is still endgame; only reachable via T2-system ×100 boost (which is wired in `claimedSystems` but the claim flow itself comes in W5/W7).
- `BASE_STORAGE_CAP`: 1000 → 1500 so Phase 3 (Space Elevator @ 1500 metal) fits at base.
- New peak rates: ~350/s metal on a fully-maxed single planet, ~2300/s on a fully-claimed home system, ~35,000/s once a T2 system is claimed.
- HUD: a new `em-chip-drones` summary chip shows `Drones: N · ×throughput` so the player can read upgrade impact without diving into the panel. Hidden until homeworld claim.

**Starting homeworld claim (W4-D):**

- Fresh saves now start with `homeClaimed: false`, `ownedPlanets: []`, `homeSystemId: ''`. The empire layer is dormant — no income, no upgrade panel button (HUD `display: none`), no HOME jump button.
- Galaxy/system/planet views all show a sticky `gx-banner` instructing the player: "Choose your homeworld — open a system and click a rocky planet (with moons) to claim it."
- Eligible planets get a `✦ CLAIM ·` prefix on their label with a pulsing border so they read as actionable from system view. `Empire.isHomeworldEligible(planet)` enforces the rule (rocky + ≥1 moon) — kept identical to the old auto-pick filter so the catalogue's metal+water-baseline assumption still holds.
- Planet panel renders a "★ Claim as Homeworld" button when applicable. Click → `Empire.claimHomeworld(planetId)` → state populated → camera flies to the freshly claimed planet → banner clears → HUD/upgrade panel activate.
- Replaces the deterministic `pickStartingPlanet` (deleted). Reset via Debug panel goes back to the claim flow.

**Moon outpost claim (W4-E):**

- Old: every moon of every owned planet auto-contributed +5/s crystal as soon as `moon-outpost` was bought, and the dome rendered on the geometric "primary moon" without input.
- New: `EmpireState.outpostMoonId` starts null. After buying Moon Outpost, the banner switches to "Pick an outpost moon — open your home planet view and click one of its moons." The home planet's moon labels gain `◌ pick · ` prefix and pulse.
- Moon clicks (via label) only fire the claim while `Empire.needsOutpostMoonChoice()` is true — `Empire.claimOutpostMoon(moonId)` validates (must belong to an owned planet) and sets the field. Re-clicking another moon moves the outpost.
- Income now comes only from the **chosen moon**, scaled by its system tier — `MOON_OUTPOST_INCOME.rate × tierMul`. The previous "all moons of all owned planets" formula was a hidden multiplier (15+ moons in late game = +75/s base × tier) and contributed to the rate explosion.
- `moon-outpost.ts` no longer picks a primary moon — `makeMoonOutpost` takes a `MoonHandle` directly. The host (`app.ts`) resolves it from `outpostMoonContext()` and rebuilds when the chosen moon changes.

**Files touched:** `docs/balance.csv` (new), `src/empire/types.ts` (state fields, save key v6, BASE_STORAGE_CAP), `src/empire/upgrades.ts` (rebalanced tier values), `src/empire/empire.ts` (formula change, `claimHomeworld`, `claimOutpostMoon`, `outpostMoonContext`, empty-state init), `src/empire/moon-outpost.ts` (chosen-moon signature), `src/empire/hud.ts` (drone chip + claim-gated visibility), `src/empire/debug.ts` (reset copy), `src/galaxy/ui.ts` (`EmpireCtx`, banner, claim button), `src/galaxy/labels.ts` (eligibility / pending-moon markers), `src/galaxy/app.ts` (claim wiring + label moon clicks), `src/style.css` (banner, claim button, drone chip).

### Wave 5 — auto-homeworld + system expansion (this session)

The W4-D manual-claim flow was reverted at user request: every fresh save now auto-bootstraps a rocky+moon homeworld and starts producing immediately. Once the player buys `system-expansion`, they can annex the rest of their home system one planet at a time.

**Auto-bootstrap homeworld:**

- `Empire` constructor calls `bootstrapHomeworld()` for fresh saves AND heals dormant W4-D-era saves (`homeClaimed=false`) on load. Same for `Empire.reset()` — debug reset goes straight back to a populated empire.
- `pickStartingPlanet()` (returned to `empire.ts`) iterates the galaxy in deterministic order and returns the first temperate (-30°C..50°C) rocky+moon planet, falling back to any rocky+moon planet. Multiplayer (W6) will replace this picker with a per-player coordinated claim — see project memory `multiplayer_plan`.
- The "Choose your homeworld" banner, `★ Claim as Homeworld` button, and `eligibleHomeworlds` label markers were all removed. `claimHomeworld()` deleted from Empire (W4-D code).
- HUD `homeClaimed` visibility gate dropped — the bar always shows.
- **Startup camera** snaps to the home planet view (`{kind:'planet'}`) instead of the galaxy overview. Without this, first-time players landed at distance 18 000 in galaxy view and didn't realise they already had a planet. The galaxy/system layers are still one click away via the layer switcher.

**System Expansion (W5):**

- `Empire.canClaimSystemPlanet(planet)` — true when `system-expansion` is unlocked AND the planet is in the home system AND not already owned.
- `Empire.systemPlanetClaimCost(planet)` — `5000 metal + 3000 water + 2000 crystal × 1.6^n` where `n` is non-home home-system planets already owned. Curve: 1st claim ~5k/3k/2k, 6th ~52k/31k/21k. Resources are deducted on claim; the new planet's `PLANET_INCOME` (primary + secondary) starts flowing immediately, scaled by home-system tier (T1 = ×1).
- `Empire.claimSystemPlanet(planetId)` validates eligibility + affordability, deducts cost, pushes to `ownedPlanets`, saves+emits.
- `Empire.claimableHomeSystemPlanets()` — list of currently-claimable planets, drives label markers and banner state.
- **Banner:** "Expand your empire — click eligible planets in your home system to annex them." Shown when there are claimable planets and no moon-pick is pending (moon-pick W4-E takes priority since it's a one-shot).
- **Label markers:** `+ ANNEX · ` prefix on claimable planets with the same yellow pulse the old eligible-homeworld marker used.
- **Planet panel:** `✦ Annex Planet` button with a row of cost pills (per-resource, green when affordable, red when short — same pattern as upgrade-panel buy buttons). Click → `claimSystemPlanet()` → camera flies to the freshly claimed planet so the player sees their new asset spin into the rotation.
- The existing `★★ HOME SYSTEM` marker auto-engages once every planet in the home system is owned (no extra wiring needed — `isHomeSystemFullyClaimed()` already checks).

**Files touched:** `src/empire/empire.ts` (bootstrap, `pickStartingPlanet`, claim methods, removed `claimHomeworld`), `src/empire/types.ts` (homeClaimed comment), `src/empire/hud.ts` (drop visibility gate), `src/galaxy/labels.ts` (`claimablePlanets` opt + `claimable-planet` kind), `src/galaxy/ui.ts` (new `EmpireCtx` shape, banner, annex button), `src/galaxy/app.ts` (EmpireCtx wiring, cost-pill formatter), `src/style.css` (annex button + cost pills + claimable-planet marker).

**Save:** key still `vibecoder.empire.v6`. Old dormant saves auto-heal on load; saves that already had `homeClaimed=true` carry over untouched.

### Wave 4-B — moon outpost + space elevator visuals (previous session)

When the player unlocks `moon-outpost` (and later `space-elevator`), the home planet's primary moon (smallest orbit radius) gets new artefacts:

- **Dome** (`src/empire/moon-outpost.ts`) — emissive crystal-coloured half-sphere with a dark base ring and a thin antenna, parented to `moon.mesh`. Sized in unit space (dome radius `0.25 × moon-mesh scale`) so the moon's existing `mesh.scale = data.radius` propagates the right world size. Sits at the moon's "north pole" relative to its mesh local Y.
- **Tether** — added when `space-elevator` unlocks. Unit-height `CylinderGeometry` (radius `0.012 × planet.radius`, additive emissive crystal cyan) parented to `planet.pivot` (no axial spin). Each frame, the moon's world position is converted into the planet pivot's local frame; the cylinder is positioned at the midpoint, scaled along Y to the distance, and rotated from `+Y` to the endpoint direction with a quaternion. No geometry rebuilds, just transform tweaks.
- **Shuttles** — 3 small additive spheres lerping along the tether between planet centre (`t=0`) and moon (`t=1`), bouncing back at the endpoints. Speeds and starting phases are spaced so they read as continuous traffic.
- **Lifecycle** (`app.ts`) — `rebuildMoonOutpostIfNeeded` mirrors `rebuildSurfaceIfNeeded`: cheap-skips when the unlock flags and home planet are unchanged, dispose+rebuild otherwise. Tether path appears the moment `space-elevator` is purchased without tearing the dome down.
- **Perf gate** — render loop sets `setMoonOutpostVisible(handle, state.systemId === homeSystemId)` every frame. In galaxy view or any other system view, both the dome group (under `moon.mesh`) and tether group (under `planet.pivot`) are hidden, and `updateMoonOutpost` early-returns so per-frame matrix work is skipped. Surface (factories/drones) is left always-visible since it's tied to mining tiers; W4-B's perf concession applies only to the new artefacts as the user requested.

### Wave 4-A — economy rewrite (previous session)

The single-resource progression deadlock and a flat trickle-driven economy were both replaced with a layered, planet-anchored model:

- **Per-planet income** (`PLANET_INCOME` table in `src/empire/types.ts`) — every owned planet contributes a primary + secondary stream (e.g. rocky → 3/s metal + 1.5/s water, ocean → 3/s water + 1.5/s gas, …). Resources you don't own a producing planet for stay at zero — no universal trickle.
- **Moon outposts** (Phase 2 `moon-outpost` unlock) — each owned planet's moons each add +5/s crystal. So a rocky home with 1-3 moons drips crystal as soon as Phase 2 lands, opening the cost lane for Phase 3+.
- **Planet-count synergy** — every owned planet adds +20% to a global multiplier (compound). 7-planet full home system → ×3.4 global from synergy alone.
- **System-tier multiplier** — `SYSTEM_TIER_BASE = 100`, applied per-system: home is T1 (×1), wormhole-claimed systems are T2 (×100), T3 (×10K), T4 (×1M). Stored as `claimedSystems: Record<systemId, tier>` on `EmpireState`. The home system is implicitly T1; the rest is hooked up but no second system claim path exists yet.
- **Rocky-only home start** (`pickStartingPlanet`) — every player begins with a rocky+moon planet so the cost catalogue can assume `metal + water` as the baseline currency. Removes the "ocean home → can't afford metal milestones" dead-end the old picker created.
- **Tiered cost shape** (`tieredCost` helper) — Tier I-III of every west chain (Storage Bays, Drone Fleet, Refinery, Auto-Sort, Drone Engines, Drone Cargo, plus all four Tech doctrines) costs **metal + water** only. Tier IV-VI mix in **crystal** — by then the player has bought Phase 2 / Moon Outpost, so crystal is flowing.
- **Milestone costs** — Phase 2 (Moon) costs metal+water, Phase 3-6 add crystal, Phase 7 (Wormhole Transit) is in millions of M+W+C, Phase 8 (Trade Hub) is the only step that requires the full 7-resource set (50M-10M each — by then the player has wormhole'd to a T2 system that produces other types).
- **Production chains rewrite** — the flat `rate-add` mining chain was deleted. Each resource now has a single `rate-mul` chain (Metal Refinery, Water Pumping, Gas Compression, Crystal Lab, Plasma Extraction, Silicon Works, Chemical Plant), tier values bumped to **+25/50/100/200/400/800%**. Planet income is the flat baseline; upgrades are pure boost.
- **Upgrade boost rebalance** — global-mul tiers max +400% (×6.3), drone-count tiers add up to 18 each, drone-speed/cargo max ×6.6 / ×9.6, Storage Doctrine tier VI is +10,000,000% capacity (×100,001 cap) so big numbers don't truncate at the storage ceiling. Base storage cap also bumped from 200 → 1000.
- **Bug fix** — `blendedCost(p, pb, p, 0, …)` (used by Metal Refinery) was overwriting the primary cost with the secondary's `0`. Now guarded so `sb=0` is a no-op.
- **HOME UX** — top-right gold pill button (`gx-home-btn`) jumps the camera to the home planet from any view (smooth, via the existing `navigateTo` + `CameraController` transition). Home planet's label gets a `★ HOME · ` prefix; home system's label gets `★ HOME · ` (or `★★ HOME SYSTEM · ` if every planet in the system is owned). Other owned planets get a `✓ ` prefix. Breadcrumb mirrors the same star markers. Driven by `LabelManager.markHome` + `UI.setHomeContext`, refreshed on every empire emit.
- **Save key bumped to v5** — old saves (v3, v4) auto-discard so every player picks up the new rocky home and the new economy. State now persists `claimedSystems`.

### Wave 6 — multiplayer + portal + min-click annex (this session)

The W4-D claim flow that came back as a multiplayer requirement was redesigned again — players don't pick their spawn at all in MP either. The relay assigns it. The W5 manual "click a planet to annex" was also dropped in favour of a single banner button.

**Start screen + save split (W6-B/C):**

- New `src/start-screen.ts` overlays the canvas on launch with two buttons (Solo, Multiplayer). MP reveals an optional name input + 8-colour palette; skipping yields `Player-XXXX` + a random palette colour.
- Choice is persisted in `localStorage` under `vibecoder.mp.session.v1`. Subsequent visits skip the screen and fly straight in. A small "↻ change profile" link top-right wipes the session and reloads.
- Empire constructor takes a `mode: 'solo' | 'mp'` flag; storage key is `vibecoder.empire.v6` (solo) or `vibecoder.empire.mp.v1` (MP). The two slots never cross-contaminate, so the solo career survives MP excursions.

**PartyKit relay (W6-A/D):**

- `partykit/server.ts` — single shared room ("galaxy"), in-memory `Map<playerId, PublicPlayer>` durably persisted to `room.storage` so reconnects keep the same spawn system. Stale players (24 h offline) get swept on the next room start. Max 16 players; when the room is full, new connections are rejected with a "Galaxy is full" banner client-side.
- Wire protocol lives in `src/multiplayer/protocol.ts` (zero deps) so server and client share types without dragging Three.js into the worker bundle.
- `src/multiplayer/client.ts` wraps `partysocket`. Auto-reconnects when the websocket drops; pending claim/state sends are queued and replayed on reopen so the game keeps running offline (Q3 in the W6 design — local-first, eventual sync). Connection status drives the bottom-centre `mp-status-banner`.
- Spawn allocation: client computes its own deterministic priority list (galaxy order of rocky+moon systems, persisted system pinned first), server picks the first non-taken candidate. Player ID lives in `localStorage` (`vibecoder.mp.playerId.v1`) so a refresh keeps the same slot.
- `Empire.bootstrapInSystem(systemId)` wires the empire into the assigned system (skipping the auto-pick). MP saves stay dormant until the relay assigns; solo saves keep auto-bootstrapping on creation.

**Auto-annex by distance (W6-E) — solo + MP:**

- Old W5 click-to-annex panel button is gone. The new flow is a single banner button: `Next annex: <name> · cost pills · [Annex]`.
- `Empire.nextAnnexTarget()` returns the unowned home-system planet whose `orbitRadius` is closest to the home planet's, so claims march visibly outward (or inward) from the homeworld instead of jumping around.
- Wormhole gate: `unlock-observatory` (and the `wormhole-transit` / `trade-hub` chain behind it) is hidden until `isHomeSystemFullyClaimed()`. Wired in `Empire.isVisible`.
- Label markers: only the next-annex target pulses (replaces the W5 multi-planet pulse). Drives `nextAnnexPlanetId` in `HomeMarkerOpts` instead of the old `claimablePlanets: Set<string>`.

**Public ownership viz (W6-F):**

- Each empire publishes `{ systemId, ownedPlanets, outpostMoonId, claimedSystems }` to the relay on every emit. Resources and unlockedNodes are NOT replicated — the upgrade tree is private per the W6 design.
- `LabelManager.markHome` accepts `remotePlanetOwners` + `remoteSystemOwners` maps. Other players' planets/systems get a `◆ <name> · ` prefix tinted with the owner's color via `--remote-color` CSS var.
- Top-right `mp-leaderboard` shows every other player as a coloured chip with their system + planet counts. Sorted by planet count desc, then alphabetical for stable order. Re-renders on every `onPlayersChanged`.

**Vibe Jam portal (W6-H):**

- Outgoing: black hole has an invisible `portalPickProxy` sphere ~2× the visible core; the picker tags hits on it as `kind: 'portal'`. App.handlePick redirects to `https://vibej.am/portal/2026?username=…&color=…&speed=1&ref=<our-origin>`. A galaxy-view-only `gx-portal-hint` pill near the bottom-centre tells the player the black hole is clickable.
- Incoming: `parseIncomingPortal()` reads `?portal=true&username=…&color=…&ref=…` from `window.location.search`. If present, main.ts skips the start screen, builds an MP SessionConfig with the visitor's profile, persists it (carrying `portalRef`), and strips the URL params via `history.replaceState`.
- Return portal: when SessionConfig has `portalRef`, a top-left pulsing `portal-return-btn` reads "↩ return to <hostname>" and ships the player back via `window.location.href = ref`.

**Debug panel removed:**

- The old `src/empire/debug.ts` (1000-resource grant + reset buttons) was a developer aid that didn't belong in the shipped game. Reset still possible via the change-profile link → wipe session → fresh launch.

**Files touched:** `src/main.ts` (boot flow), `src/start-screen.ts` (new), `src/portal.ts` (new), `src/multiplayer/protocol.ts` / `client.ts` / `profile.ts` / `leaderboard.ts` (new), `partykit/server.ts` + `partykit.json` (new), `src/galaxy/app.ts` (MP wiring + portal hint + auto-annex banner + remote-owner ctx), `src/galaxy/blackhole.ts` (portal pick proxy), `src/galaxy/picking.ts` (`kind: 'portal'`), `src/galaxy/labels.ts` (`remotePlanetOwners` / `remoteSystemOwners`, single `nextAnnexPlanetId`), `src/galaxy/ui.ts` (annex banner with embedded button, removed per-planet annex), `src/empire/empire.ts` (mode flag, `bootstrapInSystem`, `nextAnnexTarget` / `claimNextAnnex`, wormhole-observatory gate), `src/empire/types.ts` (`STORAGE_KEY_SOLO` / `STORAGE_KEY_MP`, `GameMode`), `src/style.css` (start screen, MP banner, leaderboard, return portal, annex banner, removed debug panel CSS).

**Save:** solo still `vibecoder.empire.v6`. MP uses `vibecoder.empire.mp.v1`. Player identity for MP lives in `vibecoder.mp.playerId.v1`. Session config (mode + profile + optional portalRef) lives in `vibecoder.mp.session.v1`.

### Wave 7 — wormhole transit + trade hub (this session)

The endgame milestones from W4-A's economy plan are now playable. Wormhole annex turns the existing T2 multiplier into an actual claimable goal, and Trade Hub gives the late game a way to bridge resource gaps that planet-type ownership doesn't cover.

**Wormhole annex (W7-A):**

- New `Empire.canStartWormhole()`, `nextWormholeTarget()`, `wormholeClaimCost()`, `claimNextWormhole()`, `hasClaimedWormholeSystem()`, `wormholeSystemIds()`. Cost is fixed at `WORMHOLE_CLAIM_COST = {metal: 5M, water: 3M, crystal: 2M}` — not scaling, since the MVP only allows one second-system claim. T3+ deferred.
- Target picker uses raw 3D galaxy distance from the home system's star, so the rift always opens to the visually-closest neighbour. No filter on the target's planet types — the player gets whatever's closest.
- On claim, `claimedSystems[targetId] = 2` and every planet in that system is bulk-added to `ownedPlanets`. T2's ×100 tier multiplier kicks in immediately, giving a 100× boost to those planets' baseline income (computed by `tierOf` in `computeMetrics`).
- Banner priority extended in `ui.ts`: moon-pick > home-system annex > wormhole annex. The wormhole banner only ever appears post-W6-E (home system fully claimed) and disappears once the second system is claimed.
- `EmpireCtx` gained a sibling `nextWormhole` field with the same `{name, canAfford, costHtml}` shape as the W6 annex. Banner button uses `data-claim-wormhole` and a violet "✺ Wormhole annex · T2 ×100" copy. Camera flies to the freshly claimed system on success so the player sees the new vortex form.

**Vortex visuals (W7-B):**

- New `src/galaxy/wormhole.ts` — single billboard plane with a custom log-spiral fragment shader (5-arm + 3-arm counter-rotating swirl, hollow centre, soft outer fade, bloom ring at r≈0.55). Additive blending so it reads as a rift in space, not a solid disk. Sized at `max(starRadius * 9, 6)` so it's still visible from far in galaxy view.
- Self-vortex tinted by `session.profile.color`, remote-vortex tinted by each remote player's profile color. Inner color is the owner; outer color stays a fixed deep violet so every rift shares a "deep space" base tone.
- `App.rebuildWormholesIfNeeded()` builds the active set: union of (self home + self T2s) ∪ (each remote player's home + their T2s) — but only when an empire has at least one T2 (no rift = no vortex). Cheap-skips when the (sysId, color, connection-pair) key string hasn't changed since the last call. Per-frame work is just `lookAt(camera)` + uniform tick.

**Galaxy-view connection lines (W7-C):**

- Same data path as the vortex set produces a `connections: {a, b, color}[]` list of system pairs. A single `THREE.LineSegments` with vertex colors covers every connection (self + every remote player).
- Visibility gated to galaxy view via `navigateTo` + the rebuild itself — system / planet view hide the lines because the endpoints are far off-screen and the streak would distract.

**Trade Hub (W7-D):**

- `Empire.previewTrade()` / `executeTrade()` — pick the most-abundant resource (must be ≥100), give 20% of that stock; pick the least-abundant *other* resource, gain 50% of the give amount. 2:1 ratio favours the rare one so the swap feels rewarding even when the give is large. Capped by the get resource's storage cap so trades never silently overflow.
- HUD gains a new `em-hud-btn-trade` (`⇄ Trade · {cooldown}`) button right of Upgrades, hidden until `trade-hub` unlock is owned. App wires the click through `setTradeHandler()` so the HUD doesn't import multiplayer types.
- Cooldown is 60 s on the client (drives button label from `setTradeCooldown`); 30 s on the server (`TRADE_COOLDOWN_MS`) as a spam-floor.
- MP flow: client sends `trade-request` → server picks any other player with `tradeHubReady=true` whose `lastSeen < 5min` → both sides receive `trade-matched` (initiator runs the actual swap, counterpart gets a cosmetic "Hub used by …" notice).
- Solo / no-counterpart / offline fallback: client runs `Empire.executeTrade()` directly with "Galactic Exchange" as the cosmetic counterpart name. Same 2:1 math.
- Toast UI lives in a fixed-position `trade-toast-layer` (top-right under HUD), three variants: trade success (initiator), trade notice (counterpart), trade status (cooldown / not enough stockpile). Auto-dismiss after 3.5–4.5 s.

**Relay extensions (W7-E):**

- `PublicEmpireState` gained `tradeHubReady: boolean`. App publishes it from `empire.hasUnlock('trade-hub')` on every emit.
- New protocol messages: `ClientMessage` adds `{kind: 'trade-request'}`; `ServerMessage` adds `{kind: 'trade-matched', counterpartId, counterpartName, counterpartColor, asInitiator}` and `{kind: 'trade-failed', reason: 'no-counterpart' | 'cooldown'}`.
- `partykit/server.ts` adds `handleTradeRequest()` — validates the requester has `tradeHubReady`, enforces the 30 s server cooldown via in-memory `lastTradeAt`, picks a random eligible counterpart, sends `trade-matched` to both connections (uses `room.getConnections()` to find the counterpart's live conn). Falls back to `trade-failed: no-counterpart` when the room has no eligible peer.

**Files touched:** `src/empire/empire.ts` (wormhole methods + `executeTrade` / `previewTrade` + `TradeSwap` interface), `src/galaxy/ui.ts` (`EmpireCtx.nextWormhole` + banner variant + delegated button router), `src/galaxy/app.ts` (wormhole rebuild + connection lines + trade flow + toast layer + visibility hooks in `navigateTo`/loop), `src/galaxy/wormhole.ts` (new — vortex shader + handle), `src/empire/hud.ts` (Trade button + cooldown setter + handler injection point), `src/multiplayer/protocol.ts` (`tradeHubReady` + trade messages), `src/multiplayer/client.ts` (`requestTrade` + `onTradeMatched` / `onTradeFailed` events), `partykit/server.ts` (`handleTradeRequest` + cooldown bookkeeping + tradeHubReady plumbing through `update-state`), `src/style.css` (wormhole banner variant, trade button + toast styles), `CLAUDE.md` (this entry).

**Save:** still `vibecoder.empire.v6` / `vibecoder.empire.mp.v1`. No state shape change beyond `claimedSystems` already storing T2 entries; the wormhole flow only writes to fields that already existed. Old saves auto-heal as before.

### Wave 8 — audio (this session)

The first audio pass. SFX are 100 % WebAudio-synthesised (no asset files), per the locked tech rule. Background music is a single MP3 streamed through a `MediaElementAudioSourceNode` so the file never sits in memory all at once, and so the browser handles the codec.

- **`src/audio/audio.ts`** — `AudioManager` singleton. Lazy `AudioContext` init on the first user gesture (`pointerdown` / `keydown` / `touchstart`, capture phase). Three gain buses: SFX → master, Music → master, master → destination. Settings (`masterVolume`, `musicVolume`, `sfxVolume` plus three mute flags) persisted to `localStorage` under `vibecoder.audio.v1`. Slider values are squared when applied to gain so the slider feels perceptually linear; mute flags multiply in cleanly so sliders keep their visual position while muted. 40 ms `linearRampToValueAtTime` on every gain change avoids zipper noise on slider drags.
- **`src/audio/sfx.ts`** — seven prosedurel voices, each ~10–20 lines: `sfxClick`, `sfxBuy`, `sfxAnnex`, `sfxWormhole`, `sfxTrade`, `sfxLayerTransition`, `sfxError`. Built from `OscillatorNode` (sine/triangle/square/sawtooth) + envelope `GainNode` + optional biquad lowpass/highpass/bandpass. Tiny per-name cooldown table (e.g. 30 ms for click, 400 ms for wormhole) so rapid-fire clicks can't stack into a wall of voices. A single shared noise buffer (0.4 s of white noise) is reused for every noise-based call to avoid per-shot allocation.
- **`src/audio/music.ts`** — single `HTMLAudioElement` pointed at `/music/conquerer.mp3`, looped, captured into the music bus via `createMediaElementSource`. First `play()` happens on every `audio.subscribe` notify (which fires on the first gesture); browsers reject auto-play attempts pre-gesture and the retry just absorbs that. 1.8 s linear fade-in on the music gain so the first note doesn't slap.
- **`src/audio/settings-modal.ts`** — gear button anchored bottom-right. Click opens a centred modal with three rows (Master / Music / SFX), each with a 0–100 slider + mute checkbox. `audio.subscribe` keeps the modal in sync if settings change elsewhere. Esc and backdrop close. `sfxClick` fires on toggles so the player can hear the audio path is alive without changing other settings.
- **MP3 location** — `public/music/conquerer.mp3` (Vite serves `public/` as `/`). 1.8 MB; one-time stream, never decoded into memory. The "no asset downloads" CLAUDE.md rule is bent **only for music**; every SFX is still procedural.
- **Hooked events** — `vfx.ts` plays `sfxBuy` on successful `empire.buy()` and `sfxError` on a rejected purchase. `app.ts` plays `sfxAnnex` on `claimNextAnnex` + on outpost-moon click, `sfxWormhole` on `claimNextWormhole`, `sfxTrade` on every trade match (initiator + counterpart), `sfxError` on cooldown / no-stockpile, `sfxLayerTransition` on every `navigateTo` that actually changes the state. `hud.ts` plays `sfxClick` on the Upgrades launcher.

**Files touched:** `src/audio/audio.ts` (new), `src/audio/sfx.ts` (new), `src/audio/music.ts` (new), `src/audio/settings-modal.ts` (new), `public/music/conquerer.mp3` (moved from repo root), `src/main.ts` (mount settings + start music after launch), `src/empire/vfx.ts` (sfxBuy/sfxError), `src/empire/hud.ts` (sfxClick on upgrades button), `src/galaxy/app.ts` (annex / wormhole / trade / layer-transition hooks), `src/style.css` (gear + modal + slider styles), `CLAUDE.md` (this entry).

**Save:** new `localStorage` key `vibecoder.audio.v1`. Independent from the empire / session keys; clearing the change-profile session does not reset audio settings (intentional — the player's volume preference shouldn't snap back when they switch modes).

### Wave 10 — full 100-galaxy universe + LOD (this session)

User feedback after W9:
1. "Distant" cosmetic galaxies in the skydome shouldn't be there — every galaxy in the view should be reachable.
2. Every galaxy needs a black hole, not just the main one.
3. Galaxy count up to 100, ~200 systems per galaxy.
4. Bulge billboard was standing upright, should lie flat to match the actual systems, and should stay visible at galaxy-view distance instead of fading to zero.

**Procedural 100-galaxy generator (`generation.ts`):**

- `generateUniverse(seed)` now builds the main galaxy at origin (Milky Way, hand-tuned `MAIN_PALETTE`) plus 99 procedural extras placed on a Fibonacci-sphere shell at distances 250 k – 900 k from origin. Each extra carries a random radius (7 k – 22 k), random palette (`randomPalette()` picks warm vs cool tone, biases 1-2 star classes + 1-2 planet types, randomises arms 2-6 / twist / thickness), random 3D tilt (full ±π on all three axes), and a name pulled from `NAMED_GALAXIES` (~18 % chance) or composed from `GALAXY_GREEK + GALAXY_REGIONS` / catalogue prefixes (NGC / IC / UGC / M / Caldwell). Same seed → same 100-galaxy layout.
- Per-galaxy generation moved to position-first: 60 attempts × `systemCount` per slot, cheap distance-only collision check using a constant 700-unit minimum separation. Full system generation only runs for accepted positions, so 100 × 200 = 20 000 systems are produced in ~1 – 2 s instead of ~30 s. Pack density is slightly looser than W9's extent-aware packing but visually indistinguishable.
- `systemOuterExtent` (used only by the W9 packer) deleted.
- The named W9 satellites (Andromeda / Magellan / Sombrero / Pinwheel / Triangulum) are now elements in `NAMED_GALAXIES`; their hand-curated palettes are gone since `randomPalette()` produces equivalent variety.

**Black hole per galaxy (`blackhole.ts` + `galaxy.ts`):**

- `makeBlackHole(galaxyRadius = 28000)` accepts a per-galaxy radius and scales `inner = radius × 0.0143`, `outer = radius × 0.0857`. A 9 k-radius satellite gets a proportional ~130 / 770 disc, the 28 k Milky Way keeps the original 400 / 2400.
- Every galaxy builds one and stores it on `GalaxyHandle.blackHole`. The `UniverseHandle.blackHole` field still re-exports the home galaxy's black hole so the existing Vibe Jam portal-pick proxy logic doesn't have to change.

**Horizontal bulge + galaxy-view visibility (`bulge.ts`):**

- Plane mesh now lies flat (`rotation.x = -π/2`) in galaxy-local space — i.e. on the same XZ plane the systems live on. Per-galaxy tilt is applied to `galaxy.root` instead, so the bulge and the real stars rotate together and stay coplanar.
- Fade band changed from "fully bright far / zero at galaxy view (1.8× radius)" to "fully bright at 4× radius / ~30 % at galaxy view / zero at 0.4× radius". The active galaxy's bulge now stays visible behind its actual systems in galaxy view instead of disappearing the moment you arrive.
- Pick proxy stays clickable down to ~25 % intensity so the player can still hop between galaxies from inside another galaxy.

**LOD architecture (`galaxy.ts` + labels + app):**

- `GalaxyHandle.systemsGroup: THREE.Group` is a single parent for all 200 system meshes per galaxy. `setActiveGalaxy(universe, galaxyId)` toggles `systemsGroup.visible` (and `blackHole.group.visible`) so only the active galaxy is drawn. `updateUniverse` skips inactive galaxies entirely except for their bulge fade tick. `updateBlackHole` only runs for the active galaxy.
- `app.navigateTo` calls `setActiveGalaxy(this.universe, next.galaxyId)` whenever the destination layer carries a galaxy id, so flying into another galaxy's system instantly reveals its 200-star disc and hides the previous galaxy's.
- `LabelManager` now keeps galaxy labels resident (~100 nodes) but builds system / planet / moon labels lazily for the active galaxy only. `LabelManager.activateGalaxy(galaxyId)` drops the previous galaxy's per-system labels (calling `el.remove()`) and creates fresh ones. Last-applied home-marker opts are stashed and replayed onto the new labels so badges (★ HOME, ✓, ANNEX, etc.) survive the switch.
- Galactic-rotation tick (the slow `dt * 0.010` Y spin) moved from `gh.root` to `gh.systemsGroup` so it doesn't clash with the per-galaxy tilt baked into root.

**Camera + skydome (`app.ts` + `starfield.ts`):**

- Camera far plane 600 k → 2 M.
- Universe view distance 420 k → 1.2 M; min/max 80 k / 540 k → 200 k / 1.7 M.
- Skydome 70 k → 120 k (so it always envelops the universe view); star layer radii bumped proportionally (95 k / 65 k / 42 k).
- Cosmetic `distant-galaxies.ts` deleted; `BackgroundHandle.distantGalaxies` removed; the per-frame skydome / star-layer follow-camera code drops the now-missing distant-galaxies position copy.

**Save key bump:**

- Solo `vibecoder.empire.v7` → `v8`. MP `vibecoder.empire.mp.v2` → `v3`. Old saves auto-discard so the new universe shape (different system IDs, different positions, more galaxies) takes hold cleanly.

**Files touched:** `src/galaxy/generation.ts` (procedural 100-galaxy generator + position-first packing + name + palette generators), `src/galaxy/galaxy.ts` (rewritten — `systemsGroup`, `setActiveGalaxy`, every-galaxy black hole, tilt on root), `src/galaxy/bulge.ts` (horizontal orientation + new fade band), `src/galaxy/blackhole.ts` (radius parameter), `src/galaxy/starfield.ts` (skydome size + removed distant galaxies), `src/galaxy/distant-galaxies.ts` (DELETED), `src/galaxy/labels.ts` (lazy per-galaxy label rebuild via `activateGalaxy`), `src/galaxy/app.ts` (far plane, universe distance, `setActiveGalaxy` on navigate, label `activateGalaxy` on navigate, removed distant-galaxies follow), `src/empire/types.ts` (storage keys v8 / mp.v3), `CLAUDE.md` (this entry).

### Wave 9 — multi-galaxy universe (previous session)

The "WOW how did they fit this in HTML" pass. The original ~10k-radius galaxy disc became one of six in a Local Group, with new gameplay (`intergalactic-bridge`) to actually visit the others. Headlines: scale-up of the main galaxy (×2.8 radius, real 3D thickness, bigger black hole), a new `'universe'` LayerKind that frames every galaxy from ~420k out, palette-driven generation so each galaxy looks distinct, intergalactic claim that bulk-adds a foreign galaxy's first system at T3 (×10K).

**Scale + 3D pass:**

- `generation.ts` — main galaxy radius 10k → 28k, inner cutout 1500 → 3500, thickness 120 → 1800 (true 3D disc, no longer a flat plate edge-on). Min separation 600 → 1700, buffer 140 → 400, cluster jitter scales with `radius × 0.24` so satellite galaxies still cluster correctly. Same 200 systems across the bigger disc → much more void between them.
- `blackhole.ts` — disc inner/outer 160/900 → 400/2400, halo + core proportional. The supermassive feels properly cosmic now.
- `starfield.ts` — skydome 24k → 70k, star layers 18k/12k/8k → 55k/40k/28k. Skydome still follows the camera so the player can never "fall out" of the void.
- `app.ts` — camera far plane 38k → 600k for universe view. Galaxy-view camera distance is now derived from `galaxy.radius × 1.8` so smaller satellite galaxies frame tighter than the main 28k disc.

**Universe data model:**

- `types.ts` adds `GalaxyPalette` (star/planet weighting + arms/twist/thickness/inner-cutout/bulge+arm colours), `GalaxyData` (id+name+position+systems+radius+palette+tilt), `UniverseData` (`galaxies: GalaxyData[]`), and a new `'universe'` `LayerKind`. `LayerState` gains `galaxyId: string | null`.
- `generation.ts` exports `generateUniverse(seed)` — main galaxy at origin + 5 satellite galaxies (Andromeda 18k radius blue-white giants, Magellan 9k red-dwarf irregular, Sombrero 14k thick gas-giant disc, Pinwheel 16k 6-arm grand-design, Triangulum 12k cold ice/toxic) at varied 100k-220k positions and tilts. Per-galaxy seed = `mainSeed + offset` so every player sees the same universe.
- `weightedPick<T>(rng, candidates, weights)` drives both star class + planet type picks. Default weight = 1; palette overrides bias the rolls without reshuffling the whole RNG sequence (deterministic per seed/palette).
- System IDs are now galaxy-prefixed (`milky-way:sys-XXX`, `andromeda:sys-XXX`) so each galaxy lives in its own namespace.

**Universe scene + LOD:**

- `galaxy.ts` rewritten: `UniverseHandle` wraps multiple `GalaxyHandle` instances, exposes a flat `systems: Map<string, SystemHandle>` and `systemToGalaxy: Map<string, string>` so existing code paths (labels, picking, empire layer) keep working with a single `.get(systemId)`.
- Each `GalaxyHandle.root` is a `THREE.Group` positioned at `galaxy.position` in universe space. Only the main galaxy holds the supermassive black hole.
- `bulge.ts` (new) — per-galaxy procedural log-spiral billboard sized at `galaxy.radius × 2.4`, tinted by palette. Fade band 1.8× → 6× radius from camera so the bulge is invisible when the player enters that galaxy's view (real systems take over) and fully bright in universe view. Each bulge carries an invisible `pickProxy` sphere as the universe-view click target.
- `distant-galaxies.ts` (new) — 6 cosmetic spiral-galaxy billboards on a 55k shell that follows the camera. These are pure decor — never clickable — but they fill the sky in every direction.
- Per-frame: each galaxy's root spins ~0.010 rad/sec (so satellite galaxies rotate too, on their own axes). `updateUniverse` walks every galaxy and calls `updateSystem` only on the active one (LOD).

**Universe navigation:**

- `picking.ts` — universe view raycasts every bulge `pickProxy`; galaxy view raycasts the active galaxy's stars + every other galaxy's bulge (so you can hop directly between galaxies); system view also keeps other-galaxy bulges as click targets.
- `labels.ts` — adds `'galaxy'` LabelKind, one per playable galaxy anchored to its bulge group. Universe view renders only galaxy labels; galaxy view fades them slightly so they don't dominate the 24-system LOD list (bumped from 18 because the bigger disc has room for more readable names).
- `ui.ts` — breadcrumb prepends `Universe`, switcher gains a `Universe` button. Detail panel renders a "Local Group" overview in universe view and a per-galaxy summary in galaxy view.
- `app.ts` `layerPreset('universe')` puts the camera at distance 420k, pitch 0.85; min/max 80k/540k.

**W9 gameplay — Intergalactic Bridge:**

- New unlock node `intergalactic-bridge` in `upgrades.ts`, prereq `unlock-trade` (Phase 8). Cost 100M MWC + 5M for each rare resource — a hefty milestone but reachable within minutes of buying Trade Hub if the player has T2 income flowing.
- `Empire.canStartIntergalactic()` / `nextIntergalacticTarget()` / `claimNextIntergalactic()` — picks the satellite galaxy closest to the main galaxy AND its best rocky+moon system. Cost is fixed `INTERGALACTIC_CLAIM_COST` (500M/300M/200M MWC + 50M each for the rare four). On claim, every planet in the target system is bulk-added to `ownedPlanets`, system tier set to 3 → `SYSTEM_TIER_BASE^(3-1) = ×10 000` income multiplier. T3 is by far the biggest single-purchase income jump in the game.
- `EmpireCtx.nextIntergalactic` + new banner variant — gold + violet "Intergalactic Bridge · T3 ×10K" banner with a "Bridge" button that flies the player into the freshly claimed extra-galaxy system.
- T4 (wormhole within an extra galaxy) deferred for a future wave — `claimedSystems` schema + `tierOf` already support it, but no UI flow yet.
- Connection lines extended: `wormholeSystemIds()` returns only T2 systems; `intergalacticSystemIds()` returns T3+. App's connection-line rebuild draws additive lines between (home, T2) and (home, T3) pairs at the universe level (via `scene.add` instead of galaxy.root) so they span across galaxies. Visible in galaxy + universe view.
- Vortex shader from W7 is reused for T3 systems too — same swirl, owner-tinted, billboarded toward camera.
- Number formatter (`hud.ts`, `app.ts`, `panel.ts`) extended through T/Q/Qa/Qi/Sx so the post-T3 economy displays cleanly.

**Multiplayer:**

- `partykit/server.ts` defensive check — `claim-system` only accepts candidates with the `milky-way:` prefix. Every player still spawns in the main galaxy regardless of which mode. Resources stay private, T3/T4 ownership broadcasts via the same `claimedSystems` field that already carried T2 (no protocol shape change needed).
- `Empire.eligibleSpawnSystemIds()` filters to main galaxy systems only.
- Save key bumped: solo `vibecoder.empire.v6` → `v7`, MP `vibecoder.empire.mp.v1` → `mp.v2`. Old saves discard so the new universe layout takes hold cleanly.

**Files touched:** `src/galaxy/types.ts` (UniverseData / GalaxyData / GalaxyPalette / 'universe' LayerKind / `galaxyId` on LayerState), `src/galaxy/generation.ts` (rewrote — `generateUniverse` + `weightedPick` + 6 palettes), `src/galaxy/galaxy.ts` (rewrote — `UniverseHandle` wrapping `GalaxyHandle` instances), `src/galaxy/bulge.ts` (new), `src/galaxy/distant-galaxies.ts` (new), `src/galaxy/blackhole.ts` (scale-up), `src/galaxy/starfield.ts` (scale-up + distantGalaxies wiring), `src/galaxy/labels.ts` (galaxy labels + multi-galaxy LOD), `src/galaxy/picking.ts` ('galaxy' kind + multi-galaxy targets), `src/galaxy/ui.ts` (universe breadcrumb / switcher / panel + intergalactic banner), `src/galaxy/app.ts` (universe layer support — preset / target / navigate / pick / loop / wormholes / connection lines / camera far plane), `src/empire/types.ts` (`intergalactic-bridge` unlock + storage keys v7 / mp.v2), `src/empire/upgrades.ts` (`unlock-intergalactic` Phase-9 node), `src/empire/empire.ts` (UniverseData support + intergalactic methods + tier-aware helpers), `src/empire/hud.ts` (extended formatNumber Q/Qa/Qi), `src/empire/panel.ts` (extended fmtCost), `src/multiplayer/protocol.ts` (W9 doc note on prefixed IDs + tier 3/4), `partykit/server.ts` (main-galaxy spawn filter), `src/style.css` (intergalactic banner variant + galaxy label class), `CLAUDE.md` (this entry).

**Save:** solo `vibecoder.empire.v7`, MP `vibecoder.empire.mp.v2`. Old saves auto-discard so the multi-galaxy bootstrap takes hold.

### Known issue — solved

The "single-resource progression deadlock" from W3 is gone:
- Every player starts rocky → has metal+water from second one.
- Every Tier I-III west chain costs only metal+water.
- Phase 2 (Moon) costs only metal+water and unlocks crystal income.
- Phase 3+ adds crystal to costs, with crystal already arriving from moons.

---

## Resume here (start of next session)

1. Read this file end-to-end and `docs/GALAXY.md`.
2. `git log --oneline -10` to see recent history.
3. Decide which Wave to tackle next — see "Open work" below.

---

## Locked tech rules

- **3D** — Three.js (WebGL only, no WebGPU). 100% procedural — NO Blender / external assets / textures. Geometry + shaders + lighting only.
- **Multiplayer** — PartyKit relay (Cloudflare Workers). Single shared room, ≤16 players. Wired in W6 — `partykit/server.ts` + `src/multiplayer/*`.
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`. Do not remove.
- **Public repo, commits land on `main`.**
- **Instant-load** — no loading screens, no asset downloads. Audio (when added) must be WebAudio synthesized.
- **90% AI** — gameplay logic written by Claude under user direction.
- **Language** — all docs, code comments, commit messages, and runtime UI strings are English. Any Turkish strings still present are interim.

---

## Current state of the tree

```
gamejam/
├── CLAUDE.md
├── partykit.json                   PartyKit project config (W6)
├── partykit/
│   └── server.ts                   relay — slot allocation, ownership broadcast, idle sweep
├── docs/
│   ├── GALAXY.md
│   └── balance.csv             W4-C balance audit (old vs new tier values + diagnosis)
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── favicon.svg
│   └── music/
│       └── conquerer.mp3           Wave-8 background music
├── src/
│   ├── main.ts                     boot flow — incoming portal? saved session? start screen?
│   ├── start-screen.ts             Wave-6 — Solo / Multiplayer chooser + profile picker
│   ├── portal.ts                   Wave-6 — Vibe Jam webring in/out + return-portal pill
│   ├── style.css                   global UI + empire styles
│   ├── galaxy/                     Wave-1 simulation + Wave-9 universe layer
│   │   ├── app.ts                  orchestrator + render loop (Empire tick + MP wiring + W7 wormhole vortex / connection lines / trade + W9 universe nav)
│   │   ├── camera-controller.ts
│   │   ├── types.ts                + Wave-9 GalaxyPalette / GalaxyData (id+position+palette+tilt) / UniverseData / 'universe' LayerKind
│   │   ├── rng.ts
│   │   ├── generation.ts           + Wave-9 generateUniverse() — main + 5 satellite galaxies, palette-driven star/planet weighting
│   │   ├── shaders.ts
│   │   ├── starfield.ts            + Wave-9 distantGalaxies (cosmetic billboard shell)
│   │   ├── blackhole.ts            Wave-9 scaled (inner 400, outer 2400)
│   │   ├── star.ts
│   │   ├── planet.ts
│   │   ├── system.ts
│   │   ├── galaxy.ts               Wave-9/10 — UniverseHandle, per-galaxy black hole, LOD via setActiveGalaxy
│   │   ├── bulge.ts                Wave-9/10 — horizontal bulge billboard, stays visible in galaxy view
│   │   ├── labels.ts               + Wave-9 galaxy labels for universe view
│   │   ├── picking.ts              + Wave-9 'galaxy' kind for bulge picking
│   │   ├── wormhole.ts             Wave-7 — vortex shader billboard at connected systems
│   │   └── ui.ts                   breadcrumb / layer switcher / detail panel / annex banner (W7 wormhole + W9 intergalactic variants)
│   ├── empire/                     Wave-2/3 gameplay layer
│   │   ├── types.ts                ResourceKey, EmpireState, UpgradeNode, GameMode + storage keys
│   │   ├── upgrades.ts             ~150-node skill tree catalogue (grouped into chains by panel.ts)
│   │   ├── empire.ts               state, tick, save/load, mode-aware bootstrap, auto-annex
│   │   ├── hud.ts                  top resource bar + Upgrades launcher button (chips carry data-resource)
│   │   ├── panel.ts                Branch Browser modal — left chain rail + tier-card detail pane
│   │   ├── vfx.ts                  buy effects: drain particles, burst, UNLOCKED text, tier-card flash
│   │   ├── surface.ts              Wave-3 — factory towers + drone swarm anchored to home planet
│   │   └── moon-outpost.ts         Wave-4-B — dome on primary moon + tether + shuttles
│   ├── multiplayer/                Wave-6 client side
│   │   ├── protocol.ts             wire types shared with partykit/server.ts
│   │   ├── client.ts               partysocket wrapper — connection state, queueing, players cache
│   │   ├── profile.ts              SessionConfig + 8-colour palette + auto-name
│   │   └── leaderboard.ts          top-right chip list of remote players
│   └── audio/                      Wave-8 audio
│       ├── audio.ts                AudioManager — context, gain buses, settings persist
│       ├── sfx.ts                  procedural WebAudio SFX (buy / annex / wormhole / trade / …)
│       ├── music.ts                MP3 streaming player wired into the music bus
│       └── settings-modal.ts       gear button + Master / Music / SFX sliders
└── node_modules/
```

---

## Build commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on localhost:5173 |
| `npm run build` | Strict tsc + vite production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run party:dev` | PartyKit relay on `localhost:1999`. Run alongside `npm run dev` for full MP. |
| `npm run party:deploy` | Deploy relay to Cloudflare |
| `npx tsc --noEmit` | Type-check only |

---

## Open work — wave roadmap

| Wave | Goal |
|---|---|
| **W3** | ✅ Complete. Procedural factory meshes + drone swarm on home planet. System-view emissive glow / connection lines deferred to W5 once multi-planet ownership exists. |
| **W4-A** | ✅ Complete. Economy rewrite (planet income, synergy, system tier, rocky-only home, cost rebalance) + HOME button + label markers. |
| **W4-B** | ✅ Complete. Dome + tether + shuttles on the chosen outpost moon. Visibility gated to the home-system view. |
| **W4-C** | ✅ Complete. Balance pass — droneThroughput formula now additive (was multiplicative compound), tier values reduced ~4×, drone HUD chip added. Single-planet peak ~350/s instead of ~5.7M/s. Driven by `docs/balance.csv`. |
| **W4-D** | ⤺ Reverted in W5; not coming back — W6 settled on relay-assigned spawns instead of player picks. |
| **W4-E** | ✅ Complete. Moon outpost claim flow — Moon Outpost unlock now prompts the player to click a moon; only the chosen moon contributes income and renders the dome/tether. |
| **W5** | ✅ Complete. Auto-homeworld bootstrap on fresh save + System Expansion. Per-planet annex panel button later replaced by the W6-E single banner button. |
| **W6** | ✅ Complete. PartyKit relay + start screen + per-slot spawn allocation + auto-annex banner + public ownership viz + Vibe Jam portal in/out. Debug panel removed. |
| **W7** | ✅ Complete. Wormhole annex banner (`5M/3M/2M cost`, closest-unclaimed target, T2 ×100 multiplier on bulk-claim) + violet vortex shader at every connected system + galaxy-view connection lines per owner + Trade Hub auto-trade (2:1 most-abundant → least-abundant, 60 s cooldown, MP relay matchmaking with NPC fallback). |
| **W8** | ✅ Complete. Procedural WebAudio SFX (buy / annex / wormhole / trade / layer transition / click / error) + MP3 background music streamed through a music gain bus + bottom-right gear button opening a Master / Music / SFX volume modal. Persists to `vibecoder.audio.v1`. Music auto-plays after the first user gesture (browser autoplay policy). |
| **W9** | ✅ Complete. Multi-galaxy universe — main galaxy scaled ×2.8 (radius 28k, true 3D thickness), supermassive black hole 4× bigger, new `'universe'` LayerKind framing 6 playable galaxies (Milky Way + Andromeda + Magellan + Sombrero + Pinwheel + Triangulum) with per-palette star/planet weighting + per-galaxy bulge billboards + 6 cosmetic background billboards. New `intergalactic-bridge` Phase-9 unlock and banner claims the closest extra galaxy's first system at T3 (×10K). Number formatter extended through Q/Qa/Qi. Save key bumped to v7 / mp.v2. Server defensively filters spawn claims to `milky-way:` systems. |
| **W10** | ✅ Complete. Full 100-galaxy universe — 99 procedural extras (random positions on a Fibonacci shell 250k-900k from origin, random palette / radius 7k-22k / tilt / name) + the Milky Way at origin. Every galaxy now has its own black hole (scaled to disc radius). Bulge billboard rotated to horizontal so it shares a plane with the actual systems, fade band tuned to keep ~30 % intensity in galaxy view. Cosmetic distant-galaxy billboards deleted (the 100 procedural galaxies fill that role). LOD: only the active galaxy's `systemsGroup` + black hole are visible / updated; labels also lazy-rebuild per active galaxy. Camera far plane 2M; universe view 1.2M out. Position-first generation packs 20 000 systems in ~1-2 s. Save key bumped to v8 / mp.v3. |

Tunables for ongoing balance: see `docs/balance.csv` for the full audit. Live constants: `PLANET_INCOME`, `SYNERGY_PER_PLANET = 0.2`, `SYSTEM_TIER_BASE = 100`, `MOON_OUTPOST_INCOME = 5/s crystal`, `BASE_STORAGE_CAP = 1500`, `PROD_MUL_PER_TIER`, milestone costs in `src/empire/upgrades.ts` `expSteps`. W5 annex: `SYSTEM_PLANET_CLAIM_BASE = {metal:5000, water:3000, crystal:2000}`, `SYSTEM_PLANET_CLAIM_GROWTH = 1.6` in `src/empire/empire.ts`. W7 wormhole: `WORMHOLE_CLAIM_COST = {metal:5M, water:3M, crystal:2M}` in `src/empire/empire.ts`. W7 trade: 20% give / 50% return (2:1 ratio), 60 s client cooldown / 30 s server in `partykit/server.ts:TRADE_COOLDOWN_MS`. Wave 4-B visuals: `DOME_DIAMETER_FRAC`, `TETHER_RADIUS_FRAC`, `SHUTTLE_COUNT`, `SHUTTLE_BASE_SPEED` in `src/empire/moon-outpost.ts`. W9 intergalactic: `INTERGALACTIC_CLAIM_COST` in `src/empire/empire.ts`; satellite-galaxy positions / radii / palettes in `src/galaxy/generation.ts:generateUniverse`; bulge fade band 1.8×-6× radius in `src/galaxy/bulge.ts:updateBulge`.

---

## Workflow notes

- User is non-technical — explain WHAT and WHY, not code internals.
- Plan before implementing; wait for user confirmation before each phase.
- Commit only when user explicitly approves.
- Update this file after each completed phase so future sessions can resume.
- Storage keys to know:
  - `vibecoder.empire.v8` — solo empire state.
  - `vibecoder.empire.mp.v3` — multiplayer empire state (separate slot, fresh on first MP launch).
  - `vibecoder.mp.session.v1` — current mode + profile + optional `portalRef`. Cleared by the "↻ change profile" link.
  - `vibecoder.mp.playerId.v1` — stable per-browser identity for the relay. Reusing this means refresh keeps the same spawn system and owned planets.
  - `vibecoder.empire.panelWidth.v2` — legacy panel width (unused after W2 redesign, can be deleted).
  - `vibecoder.audio.v1` — Wave-8 audio settings (master / music / SFX volume + mute flags). Independent from session reset.
