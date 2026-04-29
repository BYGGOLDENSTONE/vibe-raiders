// Rim-light + (wraith-only) iridescence shader injection for mob materials.
// Patches MeshStandardMaterial via onBeforeCompile so the standard PBR pipeline
// keeps working — we only add a fresnel emissive term (and an extra hue-shift
// for iridescent wraith materials) plus a vertex-shader cape sway.
//
// Used exclusively from mobs/archetypes.ts (build) and mobs/animation.ts (tick).

import { Color, type IUniform, MeshStandardMaterial, type ShaderMaterial } from 'three';

export interface RimUniforms {
  uRimColor: IUniform<Color>;
  uRimPower: IUniform<number>;
  uRimStrength: IUniform<number>;
}

export interface CapeSwayUniforms extends RimUniforms {
  uTime: IUniform<number>;
  uSwayAmp: IUniform<number>;
  uSwayFreq: IUniform<number>;
}

// Iridescent variant adds a hue-shift driven by view-angle.
export interface IridescenceUniforms extends RimUniforms {
  uIridA: IUniform<Color>;
  uIridB: IUniform<Color>;
  uIridStrength: IUniform<number>;
}

// Module-level registries so animation.ts can tick uTime cheaply per frame.
const capeUniformList: CapeSwayUniforms[] = [];

export function tickMobShaderUniforms(time: number): void {
  for (const u of capeUniformList) {
    u.uTime.value = time;
  }
}

export function resetMobShaderRegistry(): void {
  capeUniformList.length = 0;
}

// ---------- Rim light ----------

// Apply a Fresnel rim-light to a standard material. Cool blue by default — gives
// every mob a clean silhouette pop against the dark fog.
export function applyRimLight(
  material: MeshStandardMaterial,
  rimColor = 0x4060ff,
  rimPower = 2.0,
  rimStrength = 0.6,
): MeshStandardMaterial {
  const uniforms: RimUniforms = {
    uRimColor: { value: new Color(rimColor) },
    uRimPower: { value: rimPower },
    uRimStrength: { value: rimStrength },
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimPower = uniforms.uRimPower;
    shader.uniforms.uRimStrength = uniforms.uRimStrength;
    shader.vertexShader = injectVarying(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
varying vec3 vRimNormal;
varying vec3 vRimViewPos;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `float rim = 1.0 - max(dot(normalize(vRimViewPos), normalize(vRimNormal)), 0.0);
rim = pow(rim, uRimPower) * uRimStrength;
gl_FragColor.rgb += uRimColor * rim;
#include <output_fragment>`,
    );
  };
  material.needsUpdate = true;
  return material;
}

// ---------- Iridescence (wraith) ----------

// Wraith-specific: rim light + a view-angle hue gradient (cyan -> magenta).
export function applyIridescence(
  material: MeshStandardMaterial,
  rimColor = 0x80b8ff,
  hueA = 0x40c0ff,
  hueB = 0xc060ff,
  strength = 0.55,
): MeshStandardMaterial {
  const uniforms: IridescenceUniforms = {
    uRimColor: { value: new Color(rimColor) },
    uRimPower: { value: 1.6 },
    uRimStrength: { value: 0.7 },
    uIridA: { value: new Color(hueA) },
    uIridB: { value: new Color(hueB) },
    uIridStrength: { value: strength },
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimPower = uniforms.uRimPower;
    shader.uniforms.uRimStrength = uniforms.uRimStrength;
    shader.uniforms.uIridA = uniforms.uIridA;
    shader.uniforms.uIridB = uniforms.uIridB;
    shader.uniforms.uIridStrength = uniforms.uIridStrength;
    shader.vertexShader = injectVarying(shader.vertexShader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
uniform vec3 uIridA;
uniform vec3 uIridB;
uniform float uIridStrength;
varying vec3 vRimNormal;
varying vec3 vRimViewPos;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `vec3 V = normalize(vRimViewPos);
vec3 N = normalize(vRimNormal);
float fres = 1.0 - max(dot(V, N), 0.0);
float rim = pow(fres, uRimPower) * uRimStrength;
float t = clamp(fres, 0.0, 1.0);
vec3 irid = mix(uIridA, uIridB, t) * uIridStrength * t;
gl_FragColor.rgb += uRimColor * rim + irid;
#include <output_fragment>`,
    );
  };
  material.needsUpdate = true;
  return material;
}

// ---------- Cape sway (wraith cloak) ----------

// Build a cape material that:
//   - sways via vertex shader (sin-based, more displacement at the bottom)
//   - has rim light for silhouette
//   - is double-sided so we see the inside of the cloak
export function makeMobCapeMaterial(
  color: number,
  rimColor = 0x80b8ff,
  swayAmp = 0.15,
  swayFreq = 2.0,
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.0,
    transparent: true,
    opacity: 0.85,
    side: 2, // DoubleSide
  });
  const uniforms: CapeSwayUniforms = {
    uRimColor: { value: new Color(rimColor) },
    uRimPower: { value: 2.5 },
    uRimStrength: { value: 0.5 },
    uTime: { value: 0 },
    uSwayAmp: { value: swayAmp },
    uSwayFreq: { value: swayFreq },
  };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimPower = uniforms.uRimPower;
    shader.uniforms.uRimStrength = uniforms.uRimStrength;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSwayAmp = uniforms.uSwayAmp;
    shader.uniforms.uSwayFreq = uniforms.uSwayFreq;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform float uSwayAmp;
uniform float uSwayFreq;
varying vec3 vRimNormal;
varying vec3 vRimViewPos;`,
    );
    // Bottom of cape (negative local Y) sways more.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = vec3(position);
float swayMask = clamp(0.5 - position.y, 0.0, 1.0);
transformed.z += sin(uTime * uSwayFreq + position.x * 3.0) * uSwayAmp * swayMask;
transformed.x += cos(uTime * (uSwayFreq * 0.85) + position.y * 2.5) * uSwayAmp * 0.6 * swayMask;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
vRimNormal = normalize(normalMatrix * normal);
vRimViewPos = -mvPosition.xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
varying vec3 vRimNormal;
varying vec3 vRimViewPos;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `float rim = 1.0 - max(dot(normalize(vRimViewPos), normalize(vRimNormal)), 0.0);
rim = pow(rim, uRimPower) * uRimStrength;
gl_FragColor.rgb += uRimColor * rim;
#include <output_fragment>`,
    );
  };
  capeUniformList.push(uniforms);
  mat.needsUpdate = true;
  return mat;
}

// ---------- internals ----------

function injectVarying(vertexShader: string): string {
  let v = vertexShader.replace(
    '#include <common>',
    `#include <common>
varying vec3 vRimNormal;
varying vec3 vRimViewPos;`,
  );
  v = v.replace(
    '#include <fog_vertex>',
    `#include <fog_vertex>
vRimNormal = normalize(normalMatrix * normal);
vRimViewPos = -mvPosition.xyz;`,
  );
  return v;
}

// Re-export so consumers can type-narrow if they want — not currently used.
export type { ShaderMaterial };
