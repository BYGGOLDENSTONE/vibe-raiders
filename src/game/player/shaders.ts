// Rim-light + cape sway shader helpers. Patches existing MeshStandardMaterials via
// onBeforeCompile so the standard PBR lighting still works — we only inject a
// fresnel emissive term and (for the cape) a vertex-shader sway driven by uTime.
//
// Used exclusively by player/index.ts; no other module imports this file.

import { Color, type IUniform, type Material, MeshStandardMaterial } from 'three';

export interface RimUniforms {
  uRimColor: IUniform<Color>;
  uRimPower: IUniform<number>;
  uRimStrength: IUniform<number>;
}

export interface CapeUniforms extends RimUniforms {
  uTime: IUniform<number>;
  uSwayAmp: IUniform<number>;
}

// Module-level registry of every patched material so player/animation.ts can
// advance uTime each frame without holding refs to individual meshes.
const capeUniformList: CapeUniforms[] = [];

export function tickShaderUniforms(time: number): void {
  for (const u of capeUniformList) {
    u.uTime.value = time;
  }
}

// Fresnel rim-light injection — cool blue highlight on silhouette edges.
// Returns the same material for chaining.
export function applyRimLight(
  material: MeshStandardMaterial,
  rimColor = 0x4060ff,
  rimPower = 2.0,
  rimStrength = 0.8,
): MeshStandardMaterial {
  const uniforms: RimUniforms = {
    uRimColor: { value: new Color(rimColor) },
    uRimPower: { value: rimPower },
    uRimStrength: { value: rimStrength },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimPower = uniforms.uRimPower;
    shader.uniforms.uRimStrength = uniforms.uRimStrength;
    // Pass view-space normal + position to the fragment shader.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
varying vec3 vRimNormal;
varying vec3 vRimViewPos;`,
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
  // Force a recompile if material was already used.
  material.needsUpdate = true;
  return material;
}

// Cape: same rim light + a vertex-shader sway. The sway is per-vertex so
// the plane bends naturally without needing a skeleton.
export function makeCapeMaterial(color: number): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
    side: 2, // DoubleSide — defined as constant 2 in three to avoid extra import.
  });
  const uniforms: CapeUniforms = {
    uRimColor: { value: new Color(0x4060ff) },
    uRimPower: { value: 2.5 },
    uRimStrength: { value: 0.6 },
    uTime: { value: 0 },
    uSwayAmp: { value: 0.05 },
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimPower = uniforms.uRimPower;
    shader.uniforms.uRimStrength = uniforms.uRimStrength;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSwayAmp = uniforms.uSwayAmp;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform float uSwayAmp;
varying vec3 vRimNormal;
varying vec3 vRimViewPos;`,
    );
    // Apply sway to the local vertex before the standard chain runs. Lower
    // vertices (negative Y in cape-local space) sway more.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = vec3(position);
float swayMask = clamp(0.5 - position.y, 0.0, 1.0);
transformed.z += sin(uTime * 2.0 + position.y * 3.0) * uSwayAmp * swayMask;
transformed.x += cos(uTime * 1.7 + position.y * 2.5) * uSwayAmp * 0.6 * swayMask;`,
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
  return mat;
}

// Convenience: clear registries on hot-reload safety. Called from initPlayer.
export function resetShaderRegistry(): void {
  capeUniformList.length = 0;
}

// Re-export type for player/index consumers.
export type { Material };
