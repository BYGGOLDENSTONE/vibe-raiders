# Vibe Raiders — Project State

> **Submission:** Cursor Vibe Jam 2026 — deadline **2026-05-01 13:37 UTC**.
> **One-liner:** Browser extraction shooter inspired by Arc Raiders — procedural ruined city, push-your-luck loot loop, multiplayer rooms.

## Current phase
**P0 — Bootstrap.** Repo, scaffold, ECS-lite core, docs.

## What is done
- [x] GitHub repo: `BYGGOLDENSTONE/vibe-raiders` (public)
- [x] Vite + TypeScript + Three.js scaffold
- [x] ECS-lite core (`src/core/`)
- [x] Folder layout: `core/ world/ entities/ systems/ net/ ui/ audio/`
- [ ] CLAUDE.md / ARCHITECTURE.md / README.md (in progress)
- [ ] index.html (widget script + meta)
- [ ] First playable: scene + FPS controller + test ground
- [ ] Vibe Jam portals (lobby)
- [ ] Procedural ruined city
- [ ] Combat (weapon, hitscan, ammo, reload)
- [ ] Backpack + loot pickups
- [ ] Bot AI (drone, sentry, hunter)
- [ ] Shelters + rotating extraction window
- [ ] PartyKit multiplayer (rooms, PvE/PvP)
- [ ] Lobby UI + matchmaking + leaderboard
- [ ] Audio
- [ ] Vercel deploy

## Game design (locked)
- **Loop:** spawn at random shelter → loot city + fight bots → wait for next shelter window (every 3 min) → reach shelter → 5s hold to extract → score banked. Die = lose run inventory, banked score safe.
- **Modes:** PvE-EZ (bots only) and PvP-HOT (bots + players). Solo or 3-person squads via 6-digit room code. Max 12 per room. Empty rooms allowed.
- **Map:** ~250×250m procedural ruined city, 4 shelters (NW/NE/SW/SE), boss landmark in center. Golden-hour post-apocalypse palette.
- **Combat:** 1 weapon (laser rifle), hitscan, mag 20 / reserve 40 start, ammo crates as loot.
- **Backpack:** 20 kg capacity. Common 1kg/+1pt · Uncommon 2kg/+5 · Rare 4kg/+20 · Legendary 8kg/+100. Medkit 3kg, ammo crate 2kg.
- **Bots:** drone (+5), sentry (+5), hunter boss (+50). Player kill +30 in PvP.
- **Extract bonus:** +50% of run loot value.
- **Portals:** lobby has exit (green) + arrival (red, if `?portal=true`).

## Tech stack (locked)
- Render: Three.js
- Bundler: Vite + TS
- Multiplayer: PartyKit (one room = one match)
- Hosting: Vercel (`vibe-raiders.vercel.app`)
- Net model: client-authoritative + server-relay (jam-acceptable)

## Workflow rules
- Component + tag (ECS-lite). No spaghetti — every entity goes through `World`.
- Modular: each module owns its concern, exports a clean API. See `ARCHITECTURE.md`.
- Subagents for independent modules (worldgen, ai, net, combat).
- Public repo. README is jury-facing.
- Mandatory: `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`.
- Commit cadence: end of each task. Push after every commit.
- No commits without user approval (per global CLAUDE.md).

## Open questions
- Vercel + PartyKit accounts not yet created. User will run `! vercel login` and `! npx partykit login` when we reach deploy step.
