# The Vibecoder's Guide to the Galaxy

> **Game title:** The Vibecoder's Guide to the Galaxy.
> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders
> **Status:** Wave 6 complete. Multiplayer is live — a start screen lets players pick Solo or Multiplayer, MP uses a PartyKit relay (`partykit/server.ts`) with deterministic per-slot system assignment so each of up to 16 players spawns in a different rocky+moon system. Solo and MP keep separate save slots (`vibecoder.empire.v6` vs `vibecoder.empire.mp.v1`). System Expansion is now a single auto-targeted "Annex" banner button that always picks the closest unowned home-system planet — the per-planet annex click is gone (incremental-idle minimum-click feel). After every home-system planet is owned, the wormhole-observatory chain unlocks. Public ownership (claimed system + owned planets) is broadcast and rendered as colored player-name prefixes on labels plus a top-right leaderboard. Vibe Jam webring portal is wired: clicking the central black hole exits to `vibej.am/portal/2026?username=…&color=…&ref=…`, and incoming `?portal=true` traffic skips the start screen and shows a return-portal pill back to the originating game. Debug panel removed. Wormhole rift (W7) pending.

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
├── public/favicon.svg
├── src/
│   ├── main.ts                     boot flow — incoming portal? saved session? start screen?
│   ├── start-screen.ts             Wave-6 — Solo / Multiplayer chooser + profile picker
│   ├── portal.ts                   Wave-6 — Vibe Jam webring in/out + return-portal pill
│   ├── style.css                   global UI + empire styles
│   ├── galaxy/                     Wave-1 simulation
│   │   ├── app.ts                  orchestrator + render loop (also hosts Empire tick + MP wiring)
│   │   ├── camera-controller.ts
│   │   ├── types.ts
│   │   ├── rng.ts
│   │   ├── generation.ts
│   │   ├── shaders.ts
│   │   ├── starfield.ts
│   │   ├── blackhole.ts            includes `portalPickProxy` for the W6-H portal click target
│   │   ├── star.ts
│   │   ├── planet.ts
│   │   ├── system.ts
│   │   ├── galaxy.ts
│   │   ├── labels.ts               + remote-owner markers (W6-F)
│   │   ├── picking.ts              + 'portal' kind for the black hole proxy
│   │   └── ui.ts                   breadcrumb, layer switcher, detail panel, annex banner
│   ├── empire/                     Wave-2/3 gameplay layer
│   │   ├── types.ts                ResourceKey, EmpireState, UpgradeNode, GameMode + storage keys
│   │   ├── upgrades.ts             ~150-node skill tree catalogue (grouped into chains by panel.ts)
│   │   ├── empire.ts               state, tick, save/load, mode-aware bootstrap, auto-annex
│   │   ├── hud.ts                  top resource bar + Upgrades launcher button (chips carry data-resource)
│   │   ├── panel.ts                Branch Browser modal — left chain rail + tier-card detail pane
│   │   ├── vfx.ts                  buy effects: drain particles, burst, UNLOCKED text, tier-card flash
│   │   ├── surface.ts              Wave-3 — factory towers + drone swarm anchored to home planet
│   │   └── moon-outpost.ts         Wave-4-B — dome on primary moon + tether + shuttles
│   └── multiplayer/                Wave-6 client side
│       ├── protocol.ts             wire types shared with partykit/server.ts
│       ├── client.ts               partysocket wrapper — connection state, queueing, players cache
│       ├── profile.ts              SessionConfig + 8-colour palette + auto-name
│       └── leaderboard.ts          top-right chip list of remote players
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
| **W7** | Wormhole transit — claim a second system at T2 (×100 multiplier already wired in `claimedSystems`), visualised by a wormhole rift between systems. Trade Hub for inter-player resource swaps. Gated behind W6-E's "home system fully claimed → wormhole-observatory unlocks" milestone. |

Tunables for ongoing balance: see `docs/balance.csv` for the full audit. Live constants: `PLANET_INCOME`, `SYNERGY_PER_PLANET = 0.2`, `SYSTEM_TIER_BASE = 100`, `MOON_OUTPOST_INCOME = 5/s crystal`, `BASE_STORAGE_CAP = 1500`, `PROD_MUL_PER_TIER`, milestone costs in `src/empire/upgrades.ts` `expSteps`. W5 annex: `SYSTEM_PLANET_CLAIM_BASE = {metal:5000, water:3000, crystal:2000}`, `SYSTEM_PLANET_CLAIM_GROWTH = 1.6` in `src/empire/empire.ts`. Wave 4-B visuals: `DOME_DIAMETER_FRAC`, `TETHER_RADIUS_FRAC`, `SHUTTLE_COUNT`, `SHUTTLE_BASE_SPEED` in `src/empire/moon-outpost.ts`.

---

## Workflow notes

- User is non-technical — explain WHAT and WHY, not code internals.
- Plan before implementing; wait for user confirmation before each phase.
- Commit only when user explicitly approves.
- Update this file after each completed phase so future sessions can resume.
- Storage keys to know:
  - `vibecoder.empire.v6` — solo empire state.
  - `vibecoder.empire.mp.v1` — multiplayer empire state (separate slot, fresh on first MP launch).
  - `vibecoder.mp.session.v1` — current mode + profile + optional `portalRef`. Cleared by the "↻ change profile" link.
  - `vibecoder.mp.playerId.v1` — stable per-browser identity for the relay. Reusing this means refresh keeps the same spawn system and owned planets.
  - `vibecoder.empire.panelWidth.v2` — legacy panel width (unused after W2 redesign, can be deleted).
