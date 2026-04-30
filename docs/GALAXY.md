# Galaxy Simulation — Parameter Reference & Architecture

This is the playable map produced by Wave 1. The game loop, economy, and
multiplayer will be built **on top of** this — no rewrites planned.

Everything here is procedural: no textures, no external assets, no Blender.
All bodies are rendered with custom GLSL fragment shaders.

---

## 1. High-level architecture

A **single Three.js scene** with a **single perspective camera**. The three
"layers" the user navigates between are camera states, not separate scenes.

```ts
type LayerKind = 'galaxy' | 'system' | 'planet';
type LayerState = {
  kind: LayerKind;
  systemId: string | null;
  planetId: string | null;
};
```

Held in `App.state`. Mutated only through `App.navigateTo(next)`, which
fires a 1.4-second cinematic camera transition (easeInOutCubic on
position, distance, yaw, pitch) and rebuilds the UI panel.

### LOD by layer

| Layer  | Visible bodies                                 | Camera default                        |
|--------|------------------------------------------------|---------------------------------------|
| galaxy | All star cores + glows + black hole + skydome  | distance **13000**, pitch **0.95**    |
| system | Active system's planets + moons + orbit lines  | dynamic — `outermostOrbit × 1.55 + 24`|
| planet | Active system's planets (sibling planets visible) | `planetRadius × 4.5` (min 3.5)     |

Implemented via `setSystemDetail(systemHandle, full)`:

- `full = false` → planet meshes and orbit lines hidden, only star + glow remain.
- `full = true`  → planets, orbit lines, moons all visible.

`setActiveSystem(galaxy, id)` flips detail on the chosen system and off
on every other. Galaxy view passes `null` → all systems detail-off.

### Camera (`camera-controller.ts`)

Holds:

- `target: Vector3`
- `distance, yaw, pitch`
- `trackedNode: Object3D | null` — when set, `target` follows the node
  every frame **after a transition completes**, so the camera stays
  locked on a planet that's orbiting its star.

Pointer input:

- right-click + drag (or middle-click, or shift+left): orbit yaw/pitch
- wheel: zoom (clamped per layer)
- left click: picking, handled by `App.handlePick`; ignored if drag distance > ~5px

Distance limits (per layer):

| Layer  | min        | max         |
|--------|------------|-------------|
| galaxy | 2400       | 18000       |
| system | 14         | dynamic × 4 |
| planet | radius × 1.6 | radius × 60 |

Camera **far plane: 28000**, near plane: 0.05.

---

## 2. Procedural generation

Deterministic via `Rng` (mulberry32) seeded with `20260430`. Same seed →
same galaxy.

### Galaxy layout (`generateGalaxy`)

| Parameter        | Value |
|------------------|-------|
| System count     | **200** |
| Spiral arms      | 4 |
| Twist factor     | 3.6 |
| Disk radius      | **7000** |
| Inner cutout     | **1500** (around the black hole) |
| Disk thickness   | 120 (vertical Gaussian scatter) |
| Min separation   | **280** between any two systems |

Placement is rejection sampling, up to `systemCount × 80` attempts.
Distance follows a `pow(rand, 0.55)` bias toward outer regions.

### Star classes

| Class       | Linear RGB                  | Radius      |
|-------------|-----------------------------|-------------|
| red-dwarf   | (1.00, 0.45, 0.30)          | 3.0 – 4.8   |
| orange      | (1.00, 0.65, 0.35)          | 4.0 – 6.5   |
| yellow      | (1.00, 0.92, 0.65)          | 5.0 – 8.0   |
| white-blue  | (0.85, 0.92, 1.00)          | 6.5 – 10.5  |
| blue-giant  | (0.60, 0.75, 1.00)          | 9.0 – 14.0  |

Distribution skews toward red-dwarf / orange / yellow (8-entry weighted pick).

### Planets

A system has **4–7 planets**. Zone allocation:

- inner ~33% → hot: lava / desert / rocky / toxic
- mid ~37%   → temperate: rocky / ocean / desert / toxic
- outer ~30% → cold: gas / ice / rocky

Orbit math:

- start: `star.maxRadius × 3.6`
- step:  `range(5.0, 8.0)` per planet

| Type   | Radius      | Resources                          |
|--------|-------------|------------------------------------|
| rocky  | 0.4 – 1.2   | Iron / Titanium / Nickel / Copper  |
| ocean  | 0.8 – 1.6   | Water / Food / Hydrogen            |
| gas    | 1.6 – 2.6   | Fuel / Helium-3 / Hydrogen         |
| ice    | 0.6 – 1.3   | Crystal / Frozen gas / Water       |
| lava   | 0.4 – 1.2   | Plasma / Energy / Volcanic metal   |
| desert | 0.4 – 1.2   | Silicon / Glass / Rare mineral     |
| toxic  | 0.4 – 1.2   | Chemical / Acid / Exotic gas       |


Each planet additionally carries:

- `temperatureC` — range depends on zone
- `risk` — `low / medium / high / extreme`, derived from type + temperature
- `moons[]` — gas giants: 1–3 always; others: 55% chance of 1–2
- `hasRings` — gas giants: 55% chance
- `description` — 1-line atmospheric blurb pulled from a per-type pool

### Moons

| Parameter        | Value |
|------------------|-------|
| Radius           | parent planet × **0.15 – 0.45** |
| Orbit radius     | parent × 2.6–4.4 + index × 1.2 × parent |
| Orbit speed      | `range(0.18, 0.42)` |
| Orbit tilt       | `range(-0.25, 0.25)` rad |
| Orbit line       | drawn per moon, opacity 0.18 |

### System economy

Determined from the dominant planet type:

| Dominant type | Possible economies                                 |
|---------------|-----------------------------------------------------|
| ocean         | Colony Core / Tourism Belt / Trade Hub              |
| rocky         | Frontier Mining / Industrial / Colony Core          |
| gas           | Industrial / Frontier Mining / Military             |
| ice           | Science Line / Frontier Mining / Lost Colony       |
| lava          | Industrial / Military / Frontier Mining             |
| desert        | Frontier Mining / Industrial / Lost Colony          |
| toxic         | Military / Science Line / Lost Colony               |

Each system also gets a 1-line description from a per-economy pool.

### Naming

- ~50% **tech**: `Kepler-1234`, `HD-7821`, `Gliese-…`, `Wolf-…`,
  `Trappist-…`, `NGC-…`, `TYC-…`, `Ross-…`, `Tau Ceti-…`
- ~50% **romantic**: `Solara`, `Nacre`, `Mirage`, `Aetheria`, `Vela`,
  `Ortis`, `Caelum`, `Pyra`, `Halcyon`, etc., suffixed with one of
  `System / Core / Belt / Line / Gate`.

Planets in romantic systems get given names (`Aster Prime`, `Ember`,
`Velora`); tech systems get `<system> I/II/III/…`.
Moons: `<planet> a/b/c/…`.

---

## 3. Animation

| Body                            | Speed                                                          |
|---------------------------------|----------------------------------------------------------------|
| Galaxy root rotation            | `+0.003 rad/sec` (≈35-min full revolution)                     |
| Planet orbit around star        | `range(0.06, 0.16) / sqrt(orbitRadius/8)` — Kepler-ish slowdown|
| Planet axial spin               | `range(0.02, 0.08)`, 80% prograde / 20% retrograde             |
| Moon orbit around planet        | `range(0.18, 0.42)`                                            |
| Accretion disk                  | shader-driven via `uTime`; faster inside, slower outside       |
| Black hole halo + star glow     | billboard `lookAt(camera)` every frame; no own rotation        |

`dt` is clamped to `0.05` per frame to prevent giant time-steps after tab switch.

---

## 4. Shaders (`src/galaxy/shaders.ts`)

Three.js auto-injects `precision highp float;`. All shader source lives
as template-string exports.

### Three.js gotchas learned during Wave 1 (DO NOT FORGET)

1. **`modelMatrix` is auto-injected only into the vertex shader.** Using
   it in the fragment shader → `undeclared identifier modelMatrix` →
   shader compile fails silently → mesh stops rendering. Pass world
   position via a varying instead:

   ```glsl
   // vert
   varying vec3 vWorldPos;
   void main() {
     vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
     ...
   }

   // frag
   varying vec3 vWorldPos;
   ... cameraPosition - vWorldPos ...
   ```

   Auto-injected uniforms in the **fragment** stage are
   `cameraPosition`, `viewMatrix`, `isOrthographic`. Everything else
   needs explicit declaration or vertex pass-through.

2. **JS `number` uniforms upload via `uniform1f`.** If the shader
   declares the slot as `int`, WebGL fails with `INVALID_OPERATION`.
   Always declare integer-like uniforms as `float` and cast inside the
   shader: `int tp = int(uType + 0.5);`.

### Planet shader

- Vertex: world position + world-space normal + local position out as varyings
- Fragment branches on `uType` (0 rocky, 1 ocean, 2 gas, 3 ice, 4 lava,
  5 desert, 6 toxic):
  - **rocky** — fbm height, 3-color blend
  - **ocean** — fbm continents + ice caps near poles
  - **gas**   — latitude bands (sin) + swirl noise + faux red spot
  - **ice**   — fbm + ridged
  - **lava**  — ridged cracks emit night-side glow
  - **desert** — dunes (fbm) + fine grain
  - **toxic** — bands + cloud noise + green atmospheric tint
- Lighting: per-frame `uLightDir = normalize(star.world - planet.world)`,
  soft terminator via `smoothstep(-0.15, 0.45, ndl)`, ambient floor 0.05,
  atmospheric rim only on the lit hemisphere

### Moon shader

Cratered: fbm height + ridged crater mask, parent star light + ambient
floor. Each moon has a unique seed so two moons of the same planet
look distinct.

### Star shader

Procedural granulation + sunspot noise + fresnel rim glow toward the
camera. The visible star is the small core; an additive plane-billboard
glow doubles apparent size and survives long camera distances (galaxy
view sees stars as ~5 px points + halo).

### Black hole

- **Black core sphere** — radius `inner × 0.9` (= 144 units)
- **Accretion disk** — `RingGeometry(160, 900, 256, 32)` with shader:
  radial temperature gradient white → orange → red, time-rotated
  streaks, additive blending
- **Halo billboard plane** — `outer × 1.8 ≈ 1620` units, additive radial
  glow with subtle 4-armed spikes; fakes lensing presence
- Tilted `~-π/2 + 0.18` so the disk reads as a ring

### Background

- **Skydome**: sphere, `BackSide`, radius **24000**. Nebula shader =
  vertical gradient (deep navy → dark purple) + 2-octave fbm cloud +
  magenta/teal/violet tint.
- **3 star layers** (`Points`): far **18000** / mid **12000** / near **8000**.
  Each uses a custom shader with per-vertex size and per-vertex tint,
  additive blending. All three follow the camera every frame so the
  user can never reach the edge of space.

---

## 5. UI (`ui.ts`)

`UI` builds these on construction and rebuilds them on each `navigateTo`:

- **Top-left breadcrumb** — `Galaxy › Solara › Aster Prime`. Each
  segment except the current one is clickable.
- **Top-center layer switcher** — three buttons (Planet / System /
  Galaxy), disabled when not navigable from the current layer.
- **Right detail panel** — eyebrow + title + sub + 1-line description
  + key/value rows:
  - galaxy view: system count + 2D-plane note
  - system view: star class, economy, planet count
  - planet view: type, size (× Earth), AU, temperature, resource, risk
    badge, rings, moons
- **Bottom-left object list** — only on system/planet view (galaxy
  view hides it because 200 entries swamp the screen).
- **Bottom-center hint bar** — controls.


### Labels (`labels.ts`)

`LabelManager` builds **one HTML element per body** (system, planet,
moon) up front. Every frame it projects the world position to screen
and sets `transform: translate(...)`.

Visibility/opacity:

- `shouldShow` filters by layer:
  - galaxy → only system labels
  - system → active system's planets + all system labels (others faint)
  - planet → active system's planets + active planet's moons
- `opacityFor` smoothly fades by camera distance.
- **Galaxy LOD: only the 18 nearest system labels render.** The rest
  are hidden so the screen stays readable. The set updates each frame
  as the camera moves.

### Picking (`picking.ts`)

`Picker` raycasts against:

- **galaxy view**: every star's invisible `pickProxy` — a sphere of
  radius `starRadius × 4.5`. The mesh's `Material.visible = false`, so
  it doesn't render but Three.js still raycasts the geometry.
- **system view**: active system's planet meshes + every other
  system's `pickProxy`.
- **planet view**: active system's planet meshes + the star's
  `pickProxy` (so the user can click the star to go up).

User data on the hit object identifies what was clicked. `App.handlePick`
maps that to the appropriate navigate.

---

## 6. Performance notes

- Star geometries (core / glow / pickProxy) are **shared** across all
  200 stars (one `SphereGeometry(1, 32, 32)` and one
  `PlaneGeometry(1,1)`).
- Planet sphere geometry is **cached per segment count**.
- Galaxy view: planet meshes / orbit lines / moons are
  `visible = false`, so per-frame draw cost is dominated by ~200 star
  cores + 200 glow planes + skydome + 3 star fields + black hole disk.
- 200 system glow billboards do `lookAt(camera)` each frame — fine in
  practice on a midrange iGPU.
- The accretion disk has `256 × 32` ring segments — heavy on iGPUs at
  huge sizes; if perf tanks later, drop to `192 × 24`.

---

## 7. Open work / next-session checklist

1. **Lock the gameplay design with the user before writing any logic.**
   Incremental empire — economy, build queues, multiplayer relay — all TBD.
2. **PartyKit relay** is referenced in `package.json` scripts but no
   server has been written yet. `npm run party:dev` will fail until
   `partykit/server.ts` exists.

---

## 8. Quick reference — magic numbers to know

If you're tweaking the feel:

| Knob                                   | Where                                  | Current |
|----------------------------------------|----------------------------------------|---------|
| Galaxy disk radius                     | `generation.ts → generateGalaxy.radius`| 7000    |
| Inner cutout (around black hole)       | `generation.ts → generateGalaxy.innerRadius` | 1500 |
| System count                           | `generateGalaxy(seed, systemCount)` default | 200 |
| Min system separation                  | `generation.ts → minDistance`          | 280     |
| Black hole disk inner / outer          | `blackhole.ts → makeBlackHole`         | 160 / 900 |
| Star radius range (any class)          | `generation.ts → STAR_PRESETS`         | 3.0 – 14.0 |
| Planet radius range (any type)         | `generation.ts → makePlanet.radius`    | 0.4 – 2.6 |
| Moon radius ratio                      | `generation.ts → makeMoon.radius`      | 0.15 – 0.45 |
| Galaxy default camera distance         | `app.ts → layerPreset('galaxy')`       | 13000   |
| Camera far plane                       | `app.ts → PerspectiveCamera`           | 28000   |
| Skydome radius                         | `starfield.ts`                         | 24000   |
| Galaxy rotation rate                   | `app.ts → loop`                        | 0.003 rad/sec |
| Visible system labels in galaxy view   | `labels.ts → update`                   | 18      |
| Cinematic transition duration          | `app.ts → navigateTo`                  | 1.4 sec |
