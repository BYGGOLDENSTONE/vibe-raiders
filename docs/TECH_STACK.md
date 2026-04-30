# Portal Empires — Tech Stack & Visual Reference

The single source of truth for what to install, what shaders to write, and what mistakes will make the scene look like a tutorial. Refer to this from every visual decision.

Locked rules (do not violate):
- Three.js, WebGL only (no WebGPU).
- Vanilla TS — no React, no R3F.
- 100% procedural — no GLB/FBX/PNG/audio files.
- Vite + TypeScript strict.

---

## Library list (install)

```
npm i postprocessing three-stdlib troika-three-text @three.ez/instanced-mesh tweakpane stats-gl
npm i -D vite-plugin-glsl
```

| Package | Role | Notes |
|---|---|---|
| **`postprocessing`** (pmndrs) | Effect composer with auto-merged effects | Replaces stock `EffectComposer`. Use mipmap-blur bloom. |
| **`three-stdlib`** | Maintained `examples/jsm` (Line2, OrbitControls) | Stable typings; pick this OR `examples/jsm`, never both. |
| **`troika-three-text`** | SDF text in 3D | Crisp planet labels and floating delivery numbers. |
| **`@three.ez/instanced-mesh`** | InstancedMesh with per-instance frustum culling + LOD | Use for cargo-ship swarm and avatars. |
| **`tweakpane`** | Vanilla dev GUI | Tune shader uniforms / costs in dev only; strip in prod. |
| **`stats-gl`** | GPU timing panel | Real ms numbers, not just FPS. Dev-only. |
| **`vite-plugin-glsl`** | `import frag from './x.frag'` + `#include` | Add shim `*.glsl` → string in `vite-env.d.ts`. |

**Skip:** R3F, `react-postprocessing`, `three-nebula` (heavier than needed), WebGPU/TSL libs, `leva` (React dep — use tweakpane instead).

---

## Renderer setup (paste once, get right)

```ts
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;            // postprocessing handles it
renderer.setClearColor(0x000005, 1);
```

**Critical:** `antialias: false` — built-in MSAA conflicts with postprocessing. SMAA pass handles AA.

---

## Postprocessing chain

Order matters. pmndrs/postprocessing merges compatible effects into a single shader pass.

```ts
import { EffectComposer, RenderPass, EffectPass,
         SelectiveBloomEffect, ChromaticAberrationEffect, VignetteEffect,
         NoiseEffect, ToneMappingEffect, ToneMappingMode,
         SMAAEffect, BlendFunction } from 'postprocessing';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new SelectiveBloomEffect(scene, camera, {
  mipmapBlur: true,
  luminanceThreshold: 0.85,
  luminanceSmoothing: 0.2,
  intensity: 1.2,
  radius: 0.7,
});
// Add emissive objects to bloom selection: bloom.selection.add(planetMesh), etc.

const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0015, 0.0015) });
const vig = new VignetteEffect({ offset: 0.35, darkness: 0.65 });
const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.OVERLAY });
const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
const smaa = new SMAAEffect();

composer.addPass(new EffectPass(camera, bloom, ca, vig, noise, tone, smaa));
```

**Cost on mid laptop @ 1080p:** ~3–5 ms total. Bloom mipmap chain is biggest single cost (~1.5 ms). Plenty of headroom.

**Drive emissive uniforms > 1.0** so SelectiveBloom catches them. That's the whole point of `luminanceThreshold: 0.85`.

If nebula colors look washed-out under ACES, swap to `ToneMappingMode.AGX` or `ToneMappingMode.NEUTRAL`. Don't fight ACES with already-saturated source colors — it desaturates highlights by design.

---

## Procedural planet shader

`IcosahedronGeometry(1, 5)` (no pole pinch). Single `ShaderMaterial`. Uniforms: `uTime`, `uSunDir`, `uSeed`, `uBiomeColors[3]`, `uCityColor`, `uCityIntensity`, `uOwnerColor`.

**Vertex shader:** pass world-space normal + view direction + world-space position. Optional small displacement `pos += normal * fbm(pos*2) * 0.015` for non-spherical silhouette (keep tiny so it reads at galaxy scale).

**Fragment shader stages:**

1. **Surface noise** — domain-warped fBm:
   ```
   p = normalize(vWorldPos + uSeed);
   warp = fbm(p*2.0);
   n = fbm(p + warp*0.5);   // 4–6 octaves
   ```
2. **Biome blend:**
   ```
   ice  = smoothstep(0.85, 1.0, abs(p.y));
   land = step(0.5, n);
   color = mix(ocean, land, landMask);
   color = mix(color, ice, iceMask);
   ```
3. **Lambert lighting + soft terminator:**
   ```
   NdotL = dot(vNormalW, uSunDir);
   dayMask = smoothstep(-0.05, 0.15, NdotL);
   lit = color * max(NdotL, 0.0);
   ```
4. **Night-side city lights** (the upgrade hook):
   ```
   cityNoise = step(0.92, fbm(p*40.0));     // sparse hotspots
   cityMask  = cityNoise * landMask * (1.0 - dayMask);
   emissive  = uCityColor * cityMask * uCityIntensity;  // > 1.0 to bloom
   ```
   Bind `uCityIntensity` to `smoothstep(planet.level, 0, 10)` and animate over ~1.5 s on level change.
5. **Atmospheric rim (fresnel):**
   ```
   rim = pow(1.0 - dot(vNormalW, vViewDirW), 3.0);
   atm = atmosphereColor * rim * dayMask;
   ```
6. **Cheap scattering:**
   ```
   scatter = pow(max(NdotL,0.0), 0.5) * rim * sunColor * 0.6;
   ```
7. **Final:** `gl_FragColor = vec4(lit + emissive + atm + scatter, 1.0);`

**Atmosphere shell** (separate mesh, biggest impact for cost): a slightly larger sphere (R = 1.025), `BackSide`, additive blend, fragment:
```
alpha = pow(1.0 - dot(N, V), 4.0) * sunFacing;
```
This single addition is the difference between "tutorial planet" and "real planet."

**Tint by owner:** mix surface color with `uOwnerColor` at low weight (~0.15) on land mask only. This is what makes other players' empires read at galaxy zoom.

References: Three.js Journey "Earth Shaders" lesson, Sangil Lee's "Realistic Earth," THRASTRO shaders.

---

## Wormhole shader

Geometry: `RingGeometry(0.4, 1.2, 64, 8)` for the disc + thin `TorusGeometry` for the rim. Both additive, depthWrite off, high renderOrder.

**Disc fragment:**

1. Polar coords from centered UV: `c = vUv - 0.5; r = length(c)*2; a = atan(c.y, c.x);`
2. Swirl: `a += uTime*1.5 + (1.0 - r) * 4.0;`
3. fBm in (angle, log-radius) — log-r gives "tunnel" depth: `p = vec2(a/PI, log(r+0.01)*0.6 - uTime*0.4); n = fbm(p*3.0);`
4. Color ramp gold → cyan along radius: `col = mix(GOLD, CYAN, smoothstep(0.2, 0.9, n + r*0.3));`
5. Edge falloff + center hot core: `ring = smoothstep(1.0, 0.85, r) * smoothstep(0.0, 0.15, r); core = pow(1.0-r, 6.0) * 2.0;`
6. Output: `gl_FragColor = vec4(col*(ring+core), ring + core*0.5);`

**Rim torus** with strong emissive (3.0–5.0) so SelectiveBloom catches it.

Subtle chromatic aberration *on the disc only* (sample noise three times with channel offsets) sells the warp before global postprocess CA touches it.

References: Inigo Quilez "iq portal" Shadertoy; Kali "Star Nest"; the threejs-discourse wormhole renderer thread.

---

## Nebula + starfield (no skybox)

**Starfield.** Single `Points` ~5k vertices on a far sphere shell (R=800).
- Vertex: `gl_PointSize = (1.0 + hash(id)*3.0) * size / -mvPos.z;`
- Fragment: radial soft disc + `step(0.997, hash)` for occasional bright spikes (drives bloom).
- Tint each star by hash so they aren't all white.

One draw call, looks better than any cubemap.

**Nebula.** Backside `SphereGeometry(900, 32, 32)` with two-octave fBm of `normalize(vWorldPos)`:
```
low  = fbm(p*1.5 + uTime*0.005);
high = fbm(p*6.0 - uTime*0.01);
dust = smoothstep(0.45, 0.85, low) * (0.4 + 0.6*high);
col  = mix(MAGENTA_DARK, CYAN_DARK, smoothstep(0.0, 1.0, low));
col += vec3(0.6,0.3,0.8) * pow(high, 4.0);   // bright wisps drive bloom
```
`material.depthWrite = false`, `side: BackSide`, `renderOrder: -1`, fog disabled.

Slow time drift creates ambient motion. Parallax against the star Points layer creates depth.

---

## Cargo ship instancing

50–200 ships. Use **`@three.ez/instanced-mesh` (`InstancedMesh2`)** for free per-instance frustum culling.

```ts
const ships = new InstancedMesh2(renderer, MAX, geom, mat);
geom.setAttribute('iColor',   new THREE.InstancedBufferAttribute(colors, 3));
geom.setAttribute('iVariant', new THREE.InstancedBufferAttribute(variant, 1));

// Per frame:
for (const ship of activeShips) {
  const t = clamp01((now() - ship.departTimeMs) / ship.durationMs);
  curve.getPointAt(t, scratchPos);
  curve.getTangentAt(t, scratchTan);
  scratchM4.lookAt(scratchPos, scratchPos.clone().add(scratchTan), UP).setPosition(scratchPos);
  ships.setMatrixAt(ship.index, scratchM4);
}
ships.instanceMatrix.needsUpdate = true;
```

**Don't:**
- Don't `setMatrixAt` more than necessary; cache curve references on the route.
- Don't set `needsUpdate` per instance — once per frame total.
- Don't swap geometries for variants. Use a `variant` attribute the vertex shader reads.

Use a custom `ShaderMaterial` (or `MeshStandardMaterial` with `onBeforeCompile`) so per-instance `iColor` drives the engine glow trail.

---

## Trade-route arcs

**Don't** use `LineBasicMaterial` (1px aliased). Use **`TubeGeometry` along a `CatmullRomCurve3`** with a custom shader doing:
- UV scroll along the tube length (energy flow).
- `fract(vU - uTime*speed)` masked into thin moving stripes.
- Additive blend.

**Cross-player routes:** thicker tube radius and a **gradient between two `uColorA`/`uColorB` uniforms** along U. Visually dominant on the galactic map — instant readability of who's trading with whom.

For the very thin internal-route variant, `Line2` from `three-stdlib` (thick lines via shader) is acceptable as a cheaper fallback if frame budget tightens.

---

## Avatar upgrade (kill the placeholder capsule)

Composition per avatar (cheap, intentional-looking):
- Rounded-cube torso (`BoxGeometry` + slight bevel via shader edge fade).
- Spherical head with low-poly facets.
- Glowing emissive seam in identity color.
- Subtle bob animation (`y += sin(time + phase) * 0.05`).
- Ground glow disc (additive plane below avatar).

Instance the torsos into one `InstancedMesh`, heads into another. Total: 2 draw calls for all 16 avatars including ground discs.

---

## Performance budget (1080p, mid laptop)

| Resource | Budget | Notes |
|---|---|---|
| Frame target | 16.6 ms (60 fps) | Hard target for jam build. |
| Draw calls | ≤ 60 ideal, ≤ 100 ceiling | Biggest lever. Instancing pulls 100 planets → 1 draw, 200 ships → 1 draw. |
| Triangles | 1–3 M visible | Not the bottleneck. |
| Realtime lights | 2–3 directional, no shadows | Sun + camera rim is enough. Env map fills the rest. |
| Realtime shadow casters | **0** | Skip entirely. Planet's day/night terminator IS the shadow. |
| Postprocess | 1 merged EffectPass + SMAA, ~3–5 ms | Don't add more passes. |
| InstancedMesh count | 200 ships, 16 avatars × 2 parts, 100 planet billboards | Trivial. |
| Custom shaders | Many fine, as long as they share source | Same shader compiles once. |

**16-player overhead is essentially zero.** The galaxy itself is shared. Multiplayer adds ~16 capsules + 16 nameplates + 16 empire color tints — negligible.

---

## What to AVOID (the "tutorial scene" tells)

These are dead giveaways that kill the wow factor:

1. **`MeshStandardMaterial` with no env map.** Spec is dead. Generate a small **PMREM from a procedural cubemap** at boot (render the nebula shader to a cube RT, run through `PMREMGenerator`). Free after init.
2. **One directional light, no fill.** Add a low-intensity rim from the opposite side, or use the env map as the fill.
3. **Flat `AmbientLight`.** Replace with `HemisphereLight` (sky color + ground color).
4. **Default tone mapping with HDR colors.** Looks blown out. Always tone-map when emissive > 1. (We're using ACES via postprocessing — fine.)
5. **Additive blending without HDR.** Just clamps to white. Additive only makes sense after linear + tone map.
6. **Bloom with `luminanceThreshold: 0`.** Whole scene blooms = fog soup. Threshold ≥ 0.7.
7. **Many `PointLight`s with shadows.** Each shadowed PointLight = 6 shadow passes. **Zero shadows.** Fake them in shaders.
8. **`SphereGeometry` for planets.** Pole pinch on noise displacement. Use `IcosahedronGeometry`.
9. **Particles as `THREE.Sprite`.** Each is its own draw call. Use `THREE.Points` with custom shader.
10. **Default `LineBasicMaterial` for trade routes.** 1px aliased lines = "demo." Use `TubeGeometry` with shader.
11. **Fog enabled with bloom.** Fog desaturates highlights before bloom sees them.
12. **CSS2D labels with default `<div>` styling.** Add backdrop-blur, identity-color border, subtle glow. 10 minutes of CSS = cohesive UI.
13. **Forgetting `outputColorSpace = SRGBColorSpace`.** Muddy colors.
14. **Per-material `uTime` updates separately.** Use one shared `THREE.Clock`; one assignment per frame. Keep it as a single shared uniform reference.
15. **Default scrollbars in dark UI.** Style them. They scream "unfinished."
16. **Drop shadows that look like Material-default.** Use additive glow or none.
17. **Resource numbers without `font-variant-numeric: tabular-nums`.** Numbers jiggle as digits change width.
18. **Unmuted bloom on UI overlays.** SelectiveBloom only — UI doesn't bloom.

---

## Vite plugin glsl setup

`vite.config.ts`:
```ts
import glsl from 'vite-plugin-glsl';
export default {
  plugins: [glsl({ compress: false, watch: true })],
};
```

`src/vite-env.d.ts`:
```ts
declare module '*.glsl' { const value: string; export default value; }
declare module '*.vert' { const value: string; export default value; }
declare module '*.frag' { const value: string; export default value; }
```

Then:
```ts
import planetFrag from './shaders/planet.frag';
const mat = new THREE.ShaderMaterial({ fragmentShader: planetFrag, ... });
```

HMR works on shader edits — instant tuning.

---

## Sources (for deeper reading mid-implementation)

- pmndrs/postprocessing — github.com/pmndrs/postprocessing
- Three.js Journey, "Earth Shaders" lesson — threejs-journey.com
- Sangil Lee, "Realistic Earth with Shaders" — sangillee.com
- THRASTRO shaders — github.com/THRASTRO/thrastro-shaders
- @three.ez/instanced-mesh — github.com/agargaro/instanced-mesh
- Casey Primozic, "Gamma correction with pmndrs/postprocessing" — cprimozic.net
- Three.js discourse: "Wormhole renderer", "Starry Shader for Sky Sphere"
- PartyKit docs — docs.partykit.io
- Cloudflare Durable Objects limits & WebSocket Hibernation API
- Gabriel Gambetta, "Client-Side Prediction and Server Reconciliation" — gabrielgambetta.com
