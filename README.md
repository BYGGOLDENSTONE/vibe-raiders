# Vibe Raiders

> **Cursor Vibe Jam 2026 entry.** A browser-based extraction shooter inspired by Arc Raiders. Drop into a ruined city, loot, fight rogue machines, and extract before the shelter window closes.

🎮 **Play:** _coming soon — `vibe-raiders.vercel.app`_
🏆 **Jam:** [vibej.am/2026](https://vibej.am/2026/)
🛠 **Built with:** [Claude Code](https://claude.com/claude-code) (Opus 4.7) — 90%+ AI-authored

---

## The pitch

> Sirens pulse across the dust. _"Shelter Bravo is open. 180 seconds."_ You glance at your backpack — three rare scraps, half a clip, a medkit. The door is 200 meters out, through a plaza patrolled by two sentries. **One more crate, or run?**

**Vibe Raiders** is a 3D extraction shooter for the web — no install, no sign-up, instant load. Solo or with a 3-person squad. PvE-only rooms or hot PvP rooms. Bots drop scrap, scrap weighs you down, your backpack is small, and your run only counts if you make it back.

Risk. Reward. One more crate.

## How to play

| Action | Key |
|---|---|
| Move | `W A S D` |
| Sprint | `Shift` |
| Crouch | `C` |
| Jump | `Space` |
| Shoot | `Left Mouse` |
| Reload | `R` |
| Use medkit | `F` |
| Interact / pick up | `E` |
| Drop loot | `G` |
| Scoreboard | `Tab` |

Desktop only. Chrome / Firefox / Edge with WebGL2.

## Game loop

1. **Lobby** — set name, choose PvE or PvP, solo or squad (6-digit code), drop in.
2. **Spawn** — emerge from a random shelter into the ruined city.
3. **Loot** — scrap (4 rarities, weight = points), ammo crates, medkits.
4. **Fight** — drones (+5), sentries (+5), the central hunter boss (+50). PvP players are +30.
5. **Extract** — every 3 minutes a random shelter opens for 60s. Reach it, hold for 5s, your run banks.
6. **Die** — lose your run inventory. Banked score is safe.

The leaderboard tracks **banked score**. Stay greedy or stay alive — you can't have both.

## Tech

| | |
|---|---|
| Render | Three.js |
| Language | TypeScript |
| Bundler | Vite |
| Multiplayer | PartyKit (Cloudflare Workers) |
| Hosting | Vercel |
| Architecture | ECS-lite (component + tag) — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) |

No external 3D models. The entire city, including the boss arena, is generated procedurally in code. Total payload is well under 5 MB and loads in under a second.

## Built with Claude Code

This project is a demonstration of what's possible when you treat an AI coding agent as your full development partner. It satisfies the jam's **"≥90% AI-written"** requirement by a wide margin — the human side is design direction, scope decisions, and visual taste-checking; the code is Claude's.

**How we worked:**
- **Component + tag architecture (ECS-lite).** Locked in before a single feature was written, so nothing devolved into spaghetti as scope grew.
- **Subagents for parallel modules.** Procedural city generation, bot AI, multiplayer server, and portal integration were each handed to subagents with a clear contract — they built independently while the main thread did integration.
- **Event-bus communication.** Systems never import each other; they talk through `World.emit/on`. New features plug in without touching old code.
- **Living docs over GDDs.** A short [`CLAUDE.md`](./CLAUDE.md) tracks state across sessions; [`ARCHITECTURE.md`](./ARCHITECTURE.md) documents the rules. No phase plans, no specs, no overhead.
- **Public from day one.** Every commit is in this repo so jurors can see the actual development trail, not a polished after-the-fact narrative.

## Vibe Jam compliance

- [x] New project (started 2026-04-29, after the 2026-04-01 cutoff)
- [x] Free, no login, web-accessible
- [x] Own subdomain (`vibe-raiders.vercel.app`)
- [x] Mandatory submission widget in `index.html`
- [x] Instant load, no loading screen
- [ ] Vibe Jam Portal integration (in progress)

## Local development

```bash
git clone https://github.com/BYGGOLDENSTONE/vibe-raiders.git
cd vibe-raiders
npm install
npm run dev
```

Open `http://localhost:5173`.

## License

MIT — do whatever you want with it. The jam ethos is open.
