# Portal Empires — Implementation Plan

## Goal

Turn the current scaffold into a Vibe Jam submission that makes jurors say **"how is this even running in HTML?"** The wow factor is shared-galaxy multiplayer + AAA-jam visuals + visible optimization. Incremental gameplay is the substrate, not the headline.

Do not start by rewriting the scaffold. Layer the game on.

## Sequencing principle (what changed from the old plan)

The old plan put multiplayer last. That's wrong for our wow factor — multiplayer is the *first* thing a juror sees and the entire point. New order:

1. **Lock contracts** (types + EventMap + protocol — Wave 0).
2. **Shared galaxy 3D early** — visual presence of other players before any economy. Two tabs see each other in the same galaxy in Wave 1.
3. **Local economy on top** of the populated galaxy.
4. **UI shell** with proper visual polish (postprocessing, shaders, troika labels).
5. **Trade routes** including cross-player.
6. **Galactic map + galactic events + leaderboard polish.**
7. **Polish & submission.**

## Current foundation (don't rewrite)

Already wired:
- Vite + TypeScript strict.
- Three.js renderer.
- ECS-lite `World`.
- Global `GameContext`.
- Vibe Jam portal (gold outbound + cyan return).
- PartyKit relay + 16-player room + 10 Hz position broadcast + ghost capsules + party panel.
- Mandatory Vibe Jam widget in `index.html`.

The first wave preserves all of this and only adds.

## Recommended folder structure

```
src/game/economy/
src/game/galaxy/
src/game/multiplayer/      (replication, proposals — extends existing src/multiplayer/)
src/game/ui/
src/game/progression/
src/game/shaders/          (.glsl files — vite-plugin-glsl)
```

Single-responsibility per folder. Subagents must write only inside their assigned folder; integration is main-context.

---

## Wave 0 — Contracts & Tech Foundation

**Purpose:** lock shared types and install the tech stack so parallel waves don't collide.

**Tasks:**
- Install dependencies (one-time, see `TECH_STACK.md`):
  ```
  npm i postprocessing three-stdlib troika-three-text @three.ez/instanced-mesh tweakpane stats-gl
  npm i -D vite-plugin-glsl
  ```
- Add `vite-plugin-glsl` to `vite.config.ts`. Add `*.glsl` typings shim.
- Add EventMap entries (full list in `MULTIPLAYER_ECONOMY.md`).
- Add economy/resource/planet/route/ship types in `src/game/economy/types.ts`.
- Add deterministic galaxy seed generator in `src/game/economy/seed.ts` (returns identical 100-planet layout from a numeric seed).
- Extend `src/net/protocol.ts` with the three-channel message types (welcome, tick, event).
- Extend `partykit/server.ts` with: galaxy seed init, empire snapshot map, event ring buffer (256), Cristian time-sync ping/pong handler.
- Add `initGame(ctx)` entry point; wire from `main.ts`.
- Configure renderer for postprocessing: `antialias: false`, `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping` (postprocessing handles it).
- Add `EffectComposer` + initial `EffectPass` (BloomEffect + ToneMappingEffect + SMAA — minimum chain).

**Files touched:**
- `package.json`, `vite.config.ts`, `tsconfig.json` (glsl shim).
- `src/core/types.ts`, `src/net/protocol.ts`.
- `src/game/state.ts`, `src/game/economy/types.ts`, `src/game/economy/seed.ts`.
- `partykit/server.ts`.
- `src/main.ts` (renderer config + initGame call).

**Acceptance:**
- `npx tsc --noEmit && npm run build` passes.
- Existing portal + multiplayer ghosts still work (regression check).
- Scene runs through composer with bloom+tonemap (subtle glow on the gold portal arch).
- `npm run party:dev` server boots, picks a seed, broadcasts welcome on connect.
- No visible new gameplay yet.

---

## Wave 1 — Shared galaxy 3D (the spectacle's foundation)

**Purpose:** two tabs open the same galaxy and see each other's avatars **and each other's empires** before any economy exists. This is the first juror-facing wow milestone.

**Tasks:**
- Replace placeholder ground plane with `src/game/galaxy/scene.ts`:
  - Procedural starfield (single `Points` ~5k stars, custom shader).
  - Procedural nebula on a backside sphere (R ~900, two-octave fBm shader).
  - Galactic disc (faint particle ring at scene scale).
- Procedural planet shader (`src/game/shaders/planet.{vert,frag}.glsl`) — fBm surface, day/night terminator, fresnel atmosphere, additive atmosphere shell, **`uCityIntensity` uniform**.
- Wormhole shader (`src/game/shaders/wormhole.{vert,frag}.glsl`) — polar swirl, animated UVs, additive emissive ring. Replace the existing simple gold arch.
- `PlanetMesh` class (`src/game/galaxy/planet.ts`) wrapping mesh + atmosphere shell + label.
- Build all 100 planets from seed on `welcome`. Color-tint planets by sector owner (or grey if neutral/locked).
- Render all 16 empire ownership tints — even with no economy yet, every connected player gets their assigned sector and home planet visibly tinted in their identity color.
- Upgrade existing avatar capsules: instance them, add ground glow disc, identity-color emissive seam.

**Subagents (parallel, each owns one folder):**
- A — `src/game/galaxy/scene.ts` + `nebula.ts` + `starfield.ts`.
- B — `src/game/galaxy/planet.ts` + `src/game/shaders/planet.*.glsl`.
- C — `src/game/galaxy/wormhole.ts` + `src/game/shaders/wormhole.*.glsl`.
- D — `src/game/galaxy/avatar.ts` (upgraded capsules).

**Acceptance:**
- Page loads instantly into a populated procedural galaxy with 100 planets, nebula, starfield.
- Open two browser tabs → each sees the other's avatar AND sees the other's home planet tinted in their color.
- Planets that are unlocked/upgraded animate `uCityIntensity` smoothly when the value changes (test by tweakpane slider).
- Wormhole replaces old portal arch and has an animated swirl.
- 60 fps on mid laptop with 16 simulated empire tints.
- No external assets loaded (devtools network tab confirms).

---

## Wave 2 — Local economy & Tier 1 incremental depth

**Purpose:** make the game playable solo on top of the shared galaxy, with enough incremental depth that the first 5 minutes feel like a real progression game (not a clicker prototype).

**Tasks:**
- Resource state in `src/game/economy/state.ts`: Credits, Ore, Capital, Alloy, Data (Tier 2/3 fields exist but produce 0 until their unlocks).
- Production tick using `dt` from `world.tick` (not setInterval).
- Implement the **five-branch upgrade tree** structure with prerequisites, tier gating, exponential cost. Branch I (Production) and Branch IV (Infrastructure) wired up Tier 1 nodes for Wave 2; Tier 2/3 nodes defined but locked.
- Implement **planet specializations** chosen at planet level 5 (Industrial / Mining / Hub / Research / Refinery — last two visible but locked until Tier 2/3 in Wave 4).
- Implement **synergy multipliers** in `selectors.ts` (Industrial × Hub adjacency, all-kinds bonus, sector saturation). Visible in the resource bar tooltip as "× X.XX from synergies."
- Implement **building slots** per planet (3 slots, unlocked at lvl 3/8/14). For Wave 2, Storage Silo + Auto-Dispatcher buildable. Refinery/Foundry/Lab placeholder, unlock in Wave 4.
- Planet unlocking (own sector only) with `LIMITS` table mirrored from server.
- Local save/load to `localStorage` with debounce + capped 2-hour offline progress.
- Hook `cityIntensity` shader uniform to planet level (animate over 1.5 s on change).
- Internal trade routes: create, deliver via trajectory, upgrade.
- Implement the **demand curve** event flow on the client (multiplier UI, route value modifier — server picks demand vector in Wave 5; for Wave 2 use a local sine for testing).
- Emit `ship:launched` events through the net layer.
- Milestone 1–6 wired (through "Send a trade gift").

**Files:**
- `src/game/economy/state.ts`, `system.ts`, `balance.ts`, `selectors.ts`, `tree.ts` (upgrade tree definitions), `synergies.ts`, `buildings.ts`, `demand.ts`.
- `src/game/galaxy/routes.ts` (TubeGeometry with energy-flow shader).
- `src/game/galaxy/ships.ts` (InstancedMesh ship swarm + trajectory animator).
- `src/game/progression/milestones.ts`.

**Acceptance:**
- Credits + Ore tick up; rates show synergy multipliers transparently.
- Upgrade tree visible with locked/unlocked nodes and prerequisites; player can buy ≥5 nodes across 2+ branches.
- Player can unlock at least 2 new planets in own sector and specialize one at level 5.
- Player can place at least one building (Storage or Auto-Dispatcher) on a leveled planet.
- Synergy bonus visibly changes when a Hub-spec planet is placed adjacent to Industrials.
- Player can create an internal trade route; ships visibly fly; deliveries credit resources at the demand-modified rate.
- Refresh preserves progress; closing tab and reopening shows offline-progress event-feed line.
- Other tabs see the cargo ships flying (trajectory broadcast working).

---

## Wave 3 — UI shell with visual polish

**Purpose:** make the UI dense, readable, and **visibly cohesive** — not placeholder.

**Tasks:**
- Layout: top-left identity, top-center resources, top-right leaderboard, left planet/routes panels, right upgrades, bottom milestone + event feed + galactic-map toggle.
- Backdrop-filter blur on every panel; identity-color borders on owner sections.
- `troika-three-text` for in-world planet labels and floating delivery readouts.
- Tweakpane dev panel hooked up (only in dev build).
- Tabular numbers everywhere; styled scrollbars.
- Resource bar with smooth ticking lerp at 8 Hz.
- Milestone strip with progress bar and celebration pulse.

**Files:**
- `src/game/ui/styles.css`.
- `src/game/ui/hud.ts`, `resources.ts`, `planets.ts`, `upgrades.ts`, `routes.ts`, `events.ts`, `milestone.ts`.
- `src/game/galaxy/labels.ts` (troika label factory).

**Acceptance:**
- Whole UI renders against the live galaxy at 1366×768 without overflow.
- All buttons have hover states and disabled-reason tooltips.
- Resource numbers smoothly tick.
- Planet labels readable in 3D world space at multiple zoom levels.
- Milestone strip drives the first 5 minutes (3+ milestones implemented).
- No `MeshStandardMaterial` defaults visible; no Bootstrap-default look anywhere.

---

## Wave 4 — Cross-player routes + Tier 2/3 unlocks

**Purpose:** the signature multiplayer mechanic, AND the incremental wall-and-unlock that opens Tier 2 (Capital/Alloy refining) and Tier 3 (Data, tech tree).

**Tasks:**
- Cross-player route proposal flow: client → server `route:propose`, server → other client `route:proposed`, response → `route:created`/`rejected`.
- Bilateral cargo flow with split rewards (60/40 default; LOG-4 inverts).
- **Each cross-player delivery drips Data** to both sides — this is how Tier 3 enters the economy.
- Cross-player route visuals: thicker tube, gradient between two players' identity colors.
- Proposal modal in UI + leaderboard "Trade route" button (when a planet is selected).
- Trade gift system (one-shot Credits gift, 60 s cooldown).
- **Refinery + Foundry buildings** activated: Tier 2 economy comes online. Players can convert Credits+Ore → Capital, and Ore+Credits → Alloy. UI panel for refining ratios + Auto-Refiner toggle (LOG-2 era).
- **Research Lab building** activated for passive Data trickle.
- **Tech tree UI** (Branch V) opened once player has any Data. Tech research costs Data; unlocking nodes reveals new upgrades and ship visuals.
- Server-side validation of consent, cost, and Data drip on cross-player routes.
- Empire snapshot delta replication: when a remote empire upgrades, animate their planet's `cityIntensity` locally.
- Milestones 7–10 wired (cross-player route, specialize, build Refinery, research Telemetry).

**Files:**
- `src/game/multiplayer/proposals.ts`, `replication.ts`, `events.ts`.
- `src/game/ui/proposals.ts`, `leaderboard.ts`, `refining.ts`, `techTree.ts`.
- `src/game/economy/refining.ts`, `tech.ts`.
- `src/game/galaxy/routes.ts` (cross-player gradient shader).
- `partykit/server.ts` (route consent state machine + Data drip).

**Acceptance:**
- Two tabs can open a bilateral route. Cargo ships fly both directions.
- Each delivery visibly splits credits (event feed shows both sides' gains) AND drips Data to both.
- Player can build a Refinery and convert Credits+Ore → Capital.
- Player can research Branch V RSCH-1 once Data > cost; the tech node visibly unlocks and grants the new upgrade.
- Either side can dissolve a cross-player route with no penalty.
- Trade gift works one-shot with cooldown.
- Server rejects malformed proposals (smoke-tested).
- Remote empire upgrades animate visually within ~1 frame of arrival.

---

## Wave 5 — Galactic map, leaderboard polish, galactic events

**Purpose:** the screenshot moment. The game must look *coordinated and large* in the zoom-out view.

**Tasks:**
- Galactic map view (`M` key + button toggle): top-down camera, smooth dolly transition, free pan + scroll-zoom.
- All 16 empires color-coded clouds in the map.
- Cross-player route gradient arcs prominently visible.
- Cargo ships render as moving sparks at galactic scale.
- Leaderboard fully wired to broadcast 0.5 Hz, online/dormant indicators, click-to-fly-camera.
- Galactic events: server picks one every 5 minutes, broadcasts; clients render storm/boom/flare effects in the affected sector.
- Soft-presence dormant empires render desaturated.
- Late-joiner test: third tab joins mid-session, gets correct welcome snapshot, no visual flicker.

**Files:**
- `src/game/galaxy/cameraModes.ts`.
- `src/game/ui/galacticMap.ts`, `leaderboard.ts`.
- `src/game/galaxy/galacticEvents.ts` (storm particles, boom shimmer, flare overlay).
- `partykit/server.ts` (event picker + alarm-based scheduling).

**Acceptance:**
- Zoom-out shows all 16 empires distinctly; identity colors readable.
- Bilateral routes form visible network on the map.
- A galactic event fires within 5 minutes of room start; all clients show it in sync.
- Disconnect → empire dims → reconnect within 60 s → empire re-saturates. No flicker.
- Third tab joins and sees correct shared state.

---

## Wave 6 — Polish & submission

**Purpose:** make it feel finished and ship.

**Tasks:**
- Tune first 10 minutes (milestone pacing, costs, route values).
- Event feed text variety (5+ templates per event class).
- Synth WebAudio UI sounds: button click, upgrade purchase, delivery ping, proposal received, galactic event start (each ≤200 ms procedural).
- Postprocessing chain final: SelectiveBloom + ChromaticAberration + Vignette + Noise + ACESFilmic + SMAA, in that order, merged.
- Verify Vibe Jam widget loads on prod build.
- Replace `PROD_HOST_FALLBACK` placeholder in `src/multiplayer/connection.ts` with real PartyKit deploy host.
- `npx partykit deploy`, then `vercel deploy --prod`.
- Submit URL to Vibe Jam 2026 form.
- Verify prod widget loading, prod portal entry/return, prod multiplayer.

**Acceptance:**
- `npm run build` passes; gzipped JS ≤ 500 KB.
- First load to interactive ≤ 1.5 s on a fresh tab (DevTools throttled to "Fast 4G").
- 60 fps sustained on mid laptop with 4+ tabs as players.
- No console errors in normal play.
- Portal works (outbound + return).
- Multiplayer gracefully reports offline relay state if PartyKit is unreachable.
- The first 5 minutes show: planet unlock, internal route, trade gift, cross-player route open.

---

## Integration rules for Claude/subagents

- **Never remove the Vibe Jam widget** in `index.html`.
- **No external models, textures, or audio files.** Procedural only.
- **No heavy UI framework** (no React/Vue) without explicit user approval.
- **No first-person WASD as the core gameplay surface.** UI is the surface; avatar movement is for proximity to the wormhole.
- **Keep `src/net/protocol.ts` dependency-free.**
- **Add EventMap entries before systems depend on them** (Wave 0 covers this).
- **Use `import type`** under strict TS rules.
- **Each wave must be buildable.** Don't merge a wave that breaks `npm run build`.
- **Subagents write only inside their assigned folder.** Cross-folder edits get integrated by main context.
- **Disable WebSocket Hibernation** for `hub-1` (avoid rehydration footgun).
- **Reference `TECH_STACK.md` for visual decisions.** When in doubt, look at the AVOID list before shipping a placeholder-feel choice.

## Testing checklist

Manual:
- Vite-only load works (with offline relay fallback).
- Vite + PartyKit load works.
- Two tabs open: ghosts appear, planets tint, both see each other's empires.
- Buy several upgrades; verify city-light intensifies.
- Unlock a planet in own sector.
- Open internal route; see cargo fly.
- Send a trade gift; receiver sees event feed line + gold pulse.
- Open a cross-player route; both sides earn cargo.
- Open galactic map; all 16 empires visible (use multiple tabs to populate).
- Trigger a galactic event (or wait); both tabs see same effect synced.
- Refresh: progress preserved.
- Disconnect tab: empire goes dormant on other tabs; reconnect within 60 s: re-saturates.
- Walk avatar into wormhole: outbound webring works.
- Resize to 1366×768 and 1024×768: UI does not break.

Commands:
```bash
npx tsc --noEmit
npm run build
npm run preview     # smoke test prod build locally
```
