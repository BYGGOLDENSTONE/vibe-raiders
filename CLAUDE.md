# Game Jam — Vibe Jam 2026 (project scaffold)

> **Submission target:** Cursor Vibe Jam 2026.
> **Repo:** https://github.com/BYGGOLDENSTONE/vibe-raiders (rename when convenient).
> **Status:** Bare scaffold — Three.js renderer + ECS-lite world + PartyKit hub + Vibe Jam portal. No game on top yet.

---

## Resume here (start of next session)

1. Read this file end-to-end so the locked-in tech rules and what's already wired are clear.
2. `git log --oneline -10` to see recent history.
3. `npm run dev` (vite at http://localhost:5173) and optionally `npx partykit dev` (relay at :1999).
4. The page boots into an empty grey ground plane with a gold "VIBE JAM" portal arch at `(-15, 1.4, -15)`. Click the portal label to test the webring outbound link.
5. Multiplayer party panel appears top-left when the relay is reachable. Other connected clients render as translucent capsules with name labels.
6. Decide on the next game with the user before writing any gameplay code.

---

## Locked-in tech rules

- **3D** — Three.js (WebGL only, no WebGPU). 100% procedural — NO Blender / external assets / textures. Geometry + shaders + lighting only.
- **Multiplayer** — PartyKit relay (Cloudflare Workers). Client-authoritative position broadcast at 10 Hz. Hub = `'hub-1'` room.
- **Bundler** — Vite + TypeScript (strict, `verbatimModuleSyntax`, `noUnused*`, `erasableSyntaxOnly`).
- **ECS-lite** — every gameplay object is an `Entity` (tags + components + Object3D). Systems run per frame on a `World`. Event bus for cross-module communication.
- **Mandatory widget** — `<script async src="https://vibej.am/2026/widget.js"></script>` in `index.html`. Do not remove.
- **Public repo, commits land on `main`.** Wave-by-wave commits so judges can follow progress.
- **Instant-load** — no loading screens, no asset downloads. Audio (when added) must be WebAudio synthesized.
- **90 % AI requirement** — gameplay logic is in source, written wave-by-wave by parallel subagents under main-context orchestration.

---

## Module map (current state)

```
src/
├── core/                 ECS-lite (game-agnostic)
│   ├── types.ts          Entity, FrameContext, EventMap (only entity:spawn/despawn for now)
│   ├── entity.ts         createEntity, setComponent, getComponent
│   ├── world.ts          spawn/despawn, query, addSystem, on/emit, tick
│   └── index.ts          re-exports
├── net/
│   └── protocol.ts       generic ClientMessage / ServerMessage (hello + input + welcome + state)
├── game/
│   ├── state.ts          GameContext + gameState (player, multiplayerConnected,
│   │                     partyMemberIds, paused, timeScale, renderHook)
│   └── portal/           Vibe Jam webring entry/exit (gold outbound, cyan return arch)
├── multiplayer/          PartyKit client (room hub-1) + ghost players + party panel +
│                         name prompt + 6-retry connection
└── main.ts               boot Three.js + World + portal + multiplayer

partykit/
└── server.ts             generic 16-player relay, 10 Hz state broadcast
```

---

## What's wired and stable

- **ECS world** — `World.spawn / despawn / query / addSystem / on / emit / tick`. Add new events to `EventMap` in `src/core/types.ts` upfront so subagents don't collide.
- **Multiplayer hub** — connects to `localhost:1999` in dev or `gamejam.example.partykit.dev` in prod (placeholder, see deploy checklist). Renders remote players as translucent capsules + name labels. Local-only "party" tagging via the panel rows.
- **Vibe Jam portal** — outbound to `vibej.am/portal/2026` and return arch when arriving via `?portal=true&ref=...&username=...&color=...`. Trigger by clicking the label OR walking within 1.8m (proximity needs `gameState.player` to be set).

---

## How to run / test

### Solo (no multiplayer)
```bash
npm install
npm run dev   # vite at http://localhost:5173/
```

### With multiplayer
In a SECOND terminal:
```bash
npx partykit dev   # relay at localhost:1999
```
Reload the page. The party panel (top-left) should show **Online**.

---

## Build commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on localhost:5173 |
| `npm run build` | Strict tsc + vite production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run party:dev` | PartyKit relay on localhost:1999 |
| `npm run party:deploy` | Deploy relay to Cloudflare |
| `npx tsc --noEmit` | Type-check only |

Always run `npx tsc --noEmit && npm run build` before committing.

---

## Deploy checklist

1. `! vercel login` (user runs interactively).
2. `! npx partykit login`.
3. Update `partykit.json` `name` if desired.
4. Replace prod host placeholder in `src/multiplayer/connection.ts` (`PROD_HOST_FALLBACK`).
5. `npx partykit deploy` → note the returned `*.partykit.dev` host.
6. `vercel deploy --prod` for the static site.
7. Submit URL to Vibe Jam 2026 form.
8. Verify the mandatory `vibej.am/2026/widget.js` is loading on prod.

---

## Workflow notes

- **Wave-based parallel subagent dispatch** has worked well in the past: each wave spawns 2-5 focused agents writing into their own folders. Integration is light when contracts (init signatures, EventMap, GameContext) are locked in Wave 0.
- **Cross-module communication is via the event bus** (EventMap in `src/core/types.ts`). Add new events there when extending.
- **TypeScript is strict** — `verbatimModuleSyntax` requires `import type` everywhere; `erasableSyntaxOnly` rules out `enum` / `namespace`.
- Commit per wave with a detailed body — judges browse the GitHub history.
- **Subagents must write only inside their assigned folder.** Cross-folder edits get integrated by the main context.
