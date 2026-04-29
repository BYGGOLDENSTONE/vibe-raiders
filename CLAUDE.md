# Project — Game Jam

> **Submission target:** Cursor Vibe Jam 2026 · deadline **2026-05-01 13:37 UTC** · today **2026-04-29**.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (public — name not yet renamed)
> **Game:** TBD. The previous prototype was wiped on 2026-04-29; we kept only the scaffold and rules.

The codebase is currently a clean slate: Vite + TS + Three.js + PartyKit + ECS-lite core, plus a sanity-check `main.ts` that renders a rotating cube. **Read this file first when resuming.** Pick up at "Next session priority list".

---

## Locked-in tech rules

These are not up for debate during the jam:

- **3D** — Three.js. WebGL only, no WebGPU.
- **Multiplayer** — PartyKit (Cloudflare Workers). Client-authoritative + server-relay. Browser ↔ server protocol lives in `src/net/protocol.ts` and is shared with the room.
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **ECS-lite** — every gameplay object is an `Entity` (tags + components + Object3D). Systems run per frame on a `World`. No singletons, no deep inheritance. See `src/core/`.
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` stays in `index.html` for the entire jam.
- **Public repo, commits land on `main`.** No PRs (jam pace).
- **Production build must be instant-load.** No loading screens, no heavy assets — keep payload small (currently bare scaffold).
- **90 % AI requirement** — all gameplay logic stays in source; document the workflow in the eventual README.

---

## How to resume in a new session

1. Read this file end-to-end.
2. Glance at `git log --oneline -10`.
3. Run `npm run dev` — confirm the rotating cube renders. That is your signal that Three.js + ECS-lite are alive.
4. If multiplayer is in scope, run `npx partykit dev` in a second shell to boot the relay on `:1999`.
5. Pick up at the **"Next session priority list"** below.

---

## Workflow (global rules, restated for this project)

- **Understand → clarify → plan → implement → test → commit.** One thing at a time.
- **Ask before assuming** when requirements are ambiguous. Group questions; don't drip-feed.
- **Plan before coding.** Show the plan, wait for approval.
- **No commits without explicit user approval.** When approved, commit and push together.
- **Update this file** with completed work so the next session can resume.
- **Subagents for independent modules** (one-off generators, isolated systems). Glue / wiring stays in the main context.
- **User is non-technical.** Explain *what* and *why*, not code internals. No code dumps in chat unless asked.

---

## What is in the repo right now

```
src/
├── core/          ECS-lite (Entity, World, components, event bus). Game-agnostic.
│   ├── types.ts
│   ├── entity.ts
│   ├── world.ts
│   ├── components.ts   (only TransformComponent for now)
│   └── index.ts
├── net/
│   └── protocol.ts     Minimal shared Client/Server message types.
└── main.ts             Sanity-check: rotating cube + ECS-lite tick.

partykit/
└── server.ts           Generic relay: hello → input → 10 Hz state broadcast.

partykit.json           PartyKit project config.
package.json            Vite + TS + Three.js + PartyKit.
tsconfig.json           Strict.
index.html              Bare shell + mandatory jam widget.
```

Everything else from the previous prototype was deleted.

---

## Game design — TBD

- Genre: open. User has confirmed it will be 3D + multiplayer.
- Mechanics: not picked yet. Decide **before** writing more code than the cube.
- When the genre is locked, replace this section with: one-liner pitch · core loop · differentiator hooks · scope cut list.

---

## Next session priority list

1. **Pick the game.** Decide the genre, the core loop, and 1-2 differentiator hooks. Block any other work until this is locked.
2. **Write a 1-page game design dossier** into this CLAUDE.md (above section). Include scope cuts.
3. **Sketch the module boundaries** — populate `ARCHITECTURE.md` once the game shape is known (was deleted on the wipe).
4. **First playable.** Smallest possible loop that compiles, runs, and lets the player do *the* primary verb. Then layer on.
5. **Multiplayer wire-up.** Connect `partykit dev` to the client; see two browser tabs sync positions. Do this early — late multiplayer integration always hurts.

---

## Known TODOs / risks

- **Vercel account not yet created** — user will run `! vercel login` when we reach deploy.
- **PartyKit account not yet created** — user will run `! npx partykit login` when we deploy the server.
- `partykit.json` name is `gamejam`; rename to the final game slug before deploy.
- Repo is still named `vibe-raiders` on GitHub from the previous prototype — rename when we pick a new title.
- `src/core/components.ts` only exposes `TransformComponent`. Add new component types (Health, Weapon, etc.) per-game in this file or split into sub-modules — your choice.

---

## Recent commits (most recent first)

Run `git log --oneline -10` for the live list. The wipe commit will be the most recent once it lands.
