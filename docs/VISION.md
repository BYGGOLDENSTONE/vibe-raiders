# Portal Empires — Vision

## Short pitch

Portal Empires is a **shared-galaxy multiplayer incremental** that runs in a single browser tab with instant load, 100% procedural visuals, and 16 players growing visible empires inside the *same* galaxy in real time. The reaction we are chasing from Vibe Jam jurors is:

> "How is this even running in HTML?"

The number-go-up loop is the gameplay surface. The wow is that everyone shares one galaxy, and you can see other players' empires bloom as they upgrade — their city lights flicker on, their cargo ships fly through your sector, their trade routes thread into yours.

The incremental side is **not a thin shell** under the spectacle. Three resource tiers (base / refined / multiplayer-gated Data), a five-branch upgrade tree with prerequisites, planet specializations with synergies, a fluctuating galactic demand curve, building slots, and a tiered automation progression give the genre depth jurors recognize. The spectacle is what makes them open the tab; the depth is what keeps them in it long enough to feel the spectacle.

## The core insight (what locks the vision)

**Incremental gameplay alone does not impress jurors.** Idle/incremental games are easy to make and the genre is saturated — an AI-built one without a spectacle hook reads as "AI did the easy part." The spectacle has to come from a place a single jam developer would not normally reach:

- A live, **shared procedural galaxy** rendered for 16 players simultaneously.
- **Visible cross-player interaction** — not chat, not a leaderboard list, but actual empires appearing and growing in 3D space.
- **AAA-jam visual fidelity** through Three.js — procedural shaders, postprocessing bloom, instanced cargo fleets — with zero asset downloads and instant load.
- **Optimization** that makes "this many players + this much state in HTML" feel impossible.

Everything else (resources, upgrades, planets, milestones) is *the substrate that makes the spectacle meaningful*. If the spectacle is removed, the game is forgettable. If the spectacle is in place, the incremental loop gives jurors a reason to keep clicking long enough to feel it.

## Design pillars

### 1. Shared galaxy, not parallel solo galaxies

Every player lives in the **same** procedural galaxy. The galaxy seed is room-level (PartyKit `hub-1`), so every connected client renders the same star field, same planet positions, same wormhole. Each player owns a sector of ~5–10 planets. Other players' sectors are visible at the edges of your view and dominant when you zoom out to the **galactic map**.

This single decision is what the entire networking and visual stack is optimized for.

### 2. Visible cross-player presence and trade

Multiplayer is not a leaderboard. Multiplayer is:

- Other players' planets glowing in your sky as they upgrade.
- Cargo ships from neighbors crossing your sector on routes you can see.
- **Bilateral trade routes** between two players' planets — a real persistent route, not a one-shot gift, with cargo ships traveling both ways.
- Player avatars congregating around the Vibe Jam wormhole as a social spawn point.
- Galactic events that affect a sector and force players in that sector to react together.

### 3. "How is this in HTML?" optimization

The technical wow comes from doing more with less, visibly:

- **Trajectory-broadcast netcode.** Cargo ships are not synced per frame. The launch event includes departure time, duration, and arc shape; every client computes position locally. 500 ships in flight = zero ongoing bandwidth.
- **Procedural everything.** No textures, no models, no font files (or one inline subset). DataTexture/PMREM generated at boot from the nebula shader itself.
- **Instanced rendering.** All cargo ships in one InstancedMesh draw call. All stars in one Points draw call. Total draw calls under 60 even with 16 empires on screen.
- **Single-pass postprocessing.** pmndrs/postprocessing merges bloom + vignette + chromatic aberration + tone mapping + SMAA into one shader.

These are *not* implementation footnotes. They are part of the pitch.

### 4. UI-first incremental, 3D-second confirmation

The player makes decisions through panels: resources, upgrades, planets, routes, leaderboard. Every decision has a visible 3D consequence — a planet's night-side city lights brighten, a new cargo ship launches, a route arc pulses. The galaxy never changes without the UI explaining why; the UI never changes without the galaxy showing the result.

### 5. Instant load, zero placeholder feel

No loading screens. No external models. No texture downloads. No heavy generated assets. **And** no scene that looks like a tutorial — every visual element passes the "this isn't a placeholder" bar (see `TECH_STACK.md` for the AVOID list).

If a juror sees `MeshStandardMaterial` with default lighting, no env map, and a flat sphere planet, the spectacle dies. Visual polish is non-negotiable from Wave 1.

### 6. Portal as fiction, not banner

The mandatory Vibe Jam widget stays. The Vibe Jam portal is reframed as the **galactic wormhole** — visually the most complex shader in the scene (animated swirl, additive emissive ring, polar UV distortion), positioned at the galaxy's center or edge as a social spawn point where all players' avatars naturally gather. Entering it preserves username/color into the webring.

## Target player experience

### First 30 seconds

The page loads instantly into a populated galaxy. The player sees their starter planet, a compact resource UI, **other players' empires visibly glowing in the distance**, a wormhole at the horizon, and avatars near it. They press an upgrade. Their planet's night side lights up. A cargo ship launches. **A neighbor's cargo ship arrives at their dock.**

The "I get it AND there are other people here" moment hits in the same beat.

### First 5 minutes

The player unlocks a second planet, opens an internal trade route, sees cargo travel along an arc, sends a **cross-player trade route request** to a neighbor, and watches bilateral cargo flow start. They open the galactic map and see all 16 empires color-coded across the galaxy. They appear on the leaderboard.

### First 20 minutes

The player optimizes production chains, negotiates which neighbors to trade with (higher-rank players give better cargo value), reacts to a galactic event in their sector, and considers a Singularity Jump (stretch).

## MVP feature set

Build these first:

- Shared procedural galaxy (one room-level seed, all clients render identically).
- Home planet with Credit + Ore production.
- Five-branch upgrade tree with prerequisites and tier gating.
- Planet specializations (chosen at level 5) with synergy multipliers.
- Building slots per planet (Refinery, Foundry, Lab, Beacon, etc.) — unlock at planet levels 3/8/14.
- Refined resource tier (Capital, Alloy) gating Tier 3 progression.
- Data resource — earned only through cross-player interaction — gating the tech tree.
- Galactic demand curve (90 s cycles affecting resource value multipliers).
- Automation progression (Auto-Dispatcher, Auto-Broker, Auto-Refiner, …).
- Procedural planet shader with day/night terminator and upgrade-driven city lights.
- Internal trade routes (within own empire).
- Cross-player trade routes (bilateral, with consent flow).
- Cargo ships rendered via single InstancedMesh, trajectory-broadcast.
- Galactic map zoom-out view showing all 16 empires.
- Leaderboard reflecting real shared-galaxy state.
- Vibe Jam portal/wormhole with avatar congregation.
- Local save in `localStorage` with capped offline progress.
- Postprocessing chain (selective bloom, tone mapping, SMAA, subtle CA, vignette).

## Stretch features

Only after the MVP is playable:

- Galactic events (asteroid storm in a sector affects all players there).
- Abandoned-empire capture (disconnected players' planets become claimable after grace period).
- Singularity Jump (prestige reset for permanent multiplier).
- Procedural event feed text variety.
- Synthesized WebAudio UI sounds.
- Daily room/seed rotation.

## Non-goals for the jam

Avoid these:

- **Prestige in MVP.** Singularity Jump is stretch (tied to RSCH-5 tech node).
- **Mobile responsiveness.** Desktop only — jurors play on laptops.
- Combat / PvP griefing.
- Full account/login system.
- Server-authoritative economy beyond clamping.
- Real money mechanics.
- External art assets.
- 4X diplomacy, alliances UI, chat.
- Long tutorial text.

## Possible names

- Portal Empires (working title)
- Galactic Dividend
- Orbit Cartel
- Wormhole Tycoon
- Trade Singularity
