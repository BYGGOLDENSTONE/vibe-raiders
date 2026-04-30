import type { PlanetType } from './types';

export const PLANET_TYPE_INT: Record<PlanetType, number> = {
  rocky:  0,
  ocean:  1,
  gas:    2,
  ice:    3,
  lava:   4,
  desert: 5,
  toxic:  6,
};

// 3D simplex noise (Ashima / Stefan Gustavson). Public domain.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * snoise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}

float ridged(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * (1.0 - abs(snoise(p)));
    p *= 2.13;
    a *= 0.5;
  }
  return v;
}
`;

// --- PLANET ----------------------------------------------------------------

export const PLANET_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorldPos;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vPosL = position;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PLANET_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorldPos;

uniform float uTime;
uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform float uType;
uniform vec3  uPrimary;
uniform vec3  uSecondary;
uniform vec3  uAccent;
uniform float uSeed;

${NOISE_GLSL}

vec3 surfaceColor(vec3 p) {
  vec3 sp = p * 1.6 + vec3(uSeed);

  // type 0 ROCKY
  if (uType < 0.5) {
    float h = fbm3(sp * 1.4);
    float c = fbm3(sp * 4.0 + 11.0);
    vec3 col = mix(uSecondary, uPrimary, smoothstep(-0.4, 0.6, h));
    col = mix(col, uAccent, smoothstep(0.55, 0.85, h + c * 0.15));
    return col;
  }
  // type 1 OCEAN
  if (uType < 1.5) {
    float continent = fbm3(sp * 1.1);
    float detail = fbm3(sp * 4.5 + 7.0) * 0.25;
    float land = smoothstep(-0.05, 0.18, continent + detail);
    vec3 ocean = mix(uPrimary * 0.6, uPrimary, smoothstep(-0.6, 0.0, continent));
    vec3 landCol = mix(uSecondary, uAccent, smoothstep(0.2, 0.8, continent + detail));
    // ice caps
    float lat = abs(normalize(p).y);
    float ice = smoothstep(0.78, 0.92, lat);
    vec3 col = mix(ocean, landCol, land);
    col = mix(col, vec3(0.92, 0.96, 1.0), ice);
    return col;
  }
  // type 2 GAS GIANT
  if (uType < 2.5) {
    vec3 n = normalize(p);
    float lat = n.y;
    float bands = sin(lat * 14.0 + fbm3(sp * 0.8 + uTime * 0.04) * 1.4);
    float swirl = fbm3(vec3(sp.x * 1.2, sp.y * 6.0, sp.z * 1.2) + uTime * 0.05);
    vec3 a = mix(uSecondary, uPrimary, smoothstep(-1.0, 1.0, bands));
    vec3 b = mix(a, uAccent, smoothstep(0.4, 1.2, swirl));
    // a great red spot-ish
    float spot = smoothstep(0.85, 0.7, length(vec2(n.x, (lat - 0.15) * 2.4)));
    b = mix(b, uAccent * 1.1, spot * 0.6);
    return b;
  }
  // type 3 ICE
  if (uType < 3.5) {
    float h = fbm3(sp * 2.2);
    float c = ridged(sp * 3.0);
    vec3 col = mix(uSecondary, uPrimary, smoothstep(-0.3, 0.4, h));
    col = mix(col, uAccent, smoothstep(0.55, 0.95, c));
    return col;
  }
  // type 4 LAVA
  if (uType < 4.5) {
    float c = fbm3(sp * 2.8);
    float cracks = ridged(sp * 6.0 + uTime * 0.05);
    vec3 col = mix(uPrimary, uSecondary, smoothstep(0.45, 0.95, cracks));
    // hot glow inside cracks
    col += uAccent * smoothstep(0.7, 1.05, cracks) * 1.4;
    col *= 0.65 + 0.35 * smoothstep(-0.4, 0.6, c);
    return col;
  }
  // type 5 DESERT
  if (uType < 5.5) {
    float dunes = fbm3(sp * 2.0);
    float fine = fbm3(sp * 7.0) * 0.3;
    vec3 col = mix(uSecondary, uPrimary, smoothstep(-0.2, 0.5, dunes));
    col = mix(col, uAccent, smoothstep(0.4, 0.8, dunes + fine));
    return col;
  }
  // type 6 TOXIC
  vec3 n2 = normalize(p);
  float lat2 = n2.y;
  float clouds = fbm3(sp * 1.8 + vec3(uTime * 0.03, 0.0, uTime * 0.02));
  float bands2 = sin(lat2 * 8.0 + clouds * 1.6);
  vec3 colT = mix(uSecondary, uPrimary, smoothstep(-1.0, 1.0, bands2));
  colT = mix(colT, uAccent, smoothstep(0.3, 0.9, clouds));
  return colT;
}

void main() {
  int tp = int(uType + 0.5);
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);
  float ndl = dot(N, L);

  float diffuse = smoothstep(-0.15, 0.45, ndl);
  vec3 base = surfaceColor(vPosL);

  vec3 ambient = base * uAmbient;
  vec3 lit = base * uLightColor * diffuse;

  vec3 night = vec3(0.0);
  if (tp == 4) night = uAccent * 0.35 * (1.0 - diffuse);
  if (tp == 6) night = uAccent * 0.10 * (1.0 - diffuse);

  float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vWorldPos)), 0.0), 3.0);
  vec3 atmoTint = vec3(0.6, 0.7, 0.9);
  if (tp == 1) atmoTint = vec3(0.55, 0.75, 1.0);
  else if (tp == 2) atmoTint = uAccent;
  else if (tp == 6) atmoTint = vec3(0.7, 1.0, 0.5);
  vec3 atmo = atmoTint * rim * 0.35 * smoothstep(-0.1, 0.5, ndl);

  vec3 color = lit + ambient + night + atmo;
  gl_FragColor = vec4(color, 1.0);
}
`;

// --- MOON ------------------------------------------------------------------

export const MOON_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorldPos;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vPosL = position;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const MOON_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorldPos;

uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform float uAmbient;
uniform vec3  uColor;
uniform float uSeed;

${NOISE_GLSL}

void main() {
  vec3 sp = vPosL * 2.0 + vec3(uSeed);
  float h = fbm3(sp * 1.6) * 0.5 + 0.5;
  float craters = ridged(sp * 4.0 + 11.0);
  float fine = fbm3(sp * 8.0 + 31.0) * 0.15;

  float craterMask = smoothstep(0.62, 0.95, craters);
  vec3 base = uColor * (0.55 + 0.55 * (h + fine));
  base = mix(base, base * 0.4, craterMask);

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);
  float ndl = dot(N, L);
  float diffuse = smoothstep(-0.05, 0.55, ndl);

  vec3 ambient = base * uAmbient;
  vec3 lit = base * uLightColor * diffuse;

  // dim the world-pos contribution out of the linker (silence "unused varying" warnings on some drivers)
  float _u = vWorldPos.x * 0.0;

  gl_FragColor = vec4(lit + ambient + vec3(_u), 1.0);
}
`;

// --- STAR ------------------------------------------------------------------

export const STAR_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorldPos;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vPosL = position;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const STAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormalW;
varying vec3 vPosL;
varying vec3 vWorldPos;
uniform float uTime;
uniform vec3  uColor;

${NOISE_GLSL}

void main() {
  vec3 sp = normalize(vPosL) * 3.0 + vec3(uTime * 0.05);
  float granulation = fbm3(sp * 1.4) * 0.5 + 0.5;
  float spots = smoothstep(0.65, 0.95, fbm3(sp * 3.0 + 5.0));
  vec3 viewN = normalize(vNormalW);
  vec3 toCam = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - max(dot(viewN, toCam), 0.0), 2.0);

  vec3 base = uColor * (0.85 + 0.5 * granulation);
  base = mix(base, uColor * 0.5, spots * 0.6);
  base += uColor * fres * 1.6;
  // overall brightness
  base *= 1.6;
  gl_FragColor = vec4(base, 1.0);
}
`;

// Soft glow billboard around stars (additive sprite)
export const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  float a = exp(-d * d * 4.0) * uIntensity;
  // radial spikes
  float ang = atan(c.y, c.x);
  float spikes = pow(0.5 + 0.5 * cos(ang * 4.0), 6.0) * exp(-d * 3.0) * 0.4;
  vec3 col = uColor * (a + spikes);
  gl_FragColor = vec4(col, a + spikes);
}
`;

// --- BLACK HOLE ACCRETION DISK --------------------------------------------

export const DISK_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPosL;
void main() {
  vUv = uv;
  vPosL = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const DISK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vPosL;
uniform float uTime;
uniform float uInner;
uniform float uOuter;

${NOISE_GLSL}

void main() {
  // vUv is on a ring geometry: u along the ring, v across width
  float r = length(vPosL.xy);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float angle = atan(vPosL.y, vPosL.x);

  // streaks rotating with radius (faster inside)
  float streakCoord = angle * 6.0 + uTime * (3.0 / max(t, 0.05));
  float streaks = fbm3(vec3(streakCoord, t * 4.0, uTime * 0.2)) * 0.5 + 0.5;

  // inner is hot white, mid orange, outer red->fade
  vec3 hot   = vec3(1.0, 0.95, 0.85);
  vec3 warm  = vec3(1.0, 0.55, 0.20);
  vec3 cool  = vec3(0.7, 0.18, 0.05);
  vec3 col = mix(hot, warm, smoothstep(0.0, 0.45, t));
  col = mix(col, cool, smoothstep(0.45, 1.0, t));

  // brightness profile: bright at inner edge, falloff outward
  float brightness = (1.0 - smoothstep(0.0, 0.85, t)) * (0.5 + streaks * 0.9);
  // soft inner edge
  brightness *= smoothstep(0.0, 0.04, t);
  // soft outer edge
  brightness *= smoothstep(1.0, 0.85, t);

  gl_FragColor = vec4(col * brightness * 1.8, brightness);
}
`;

// --- NEBULA SKYDOME --------------------------------------------------------

export const NEBULA_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;

${NOISE_GLSL}

void main() {
  vec3 d = normalize(vDir);
  // Base background gradient (deep navy -> dark purple)
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = mix(vec3(0.012, 0.018, 0.045), vec3(0.025, 0.012, 0.045), h);

  // Two cloud layers
  float c1 = fbm3(d * 2.4) * 0.5 + 0.5;
  float c2 = fbm3(d * 5.0 + 7.0) * 0.5 + 0.5;
  float clouds = pow(c1, 2.0) * 0.35 + pow(c2, 3.0) * 0.25;

  vec3 magenta = vec3(0.55, 0.18, 0.42);
  vec3 teal    = vec3(0.10, 0.40, 0.55);
  vec3 violet  = vec3(0.30, 0.18, 0.55);
  vec3 mixed = mix(magenta, teal, smoothstep(0.3, 0.7, c2));
  mixed = mix(mixed, violet, smoothstep(0.4, 0.9, c1));

  vec3 color = base + mixed * clouds * 0.55;
  gl_FragColor = vec4(color, 1.0);
}
`;
