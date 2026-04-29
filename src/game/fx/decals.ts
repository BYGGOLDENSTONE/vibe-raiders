// Ground decals + telegraph shapes.
// All meshes pre-allocated; spawn = pluck slot, set uniforms, show.
//
// Layers:
//   - AoE decal: large rune ring with rotating dilim pattern.
//   - Hit decal: small cracked-ground pattern (procedural Voronoi-ish).
//   - Telegraph ring / cone / line: animated rune flow used while a skill winds up.

import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Scene } from 'three';

const AOE_POOL_SIZE = 16;
const HIT_POOL_SIZE = 32;
const TELE_RING_POOL_SIZE = 8;
const TELE_CONE_POOL_SIZE = 6;
const TELE_LINE_POOL_SIZE = 6;

// ─── Shaders ───

// AoE rune circle. Polar fragment shader: rotating rune dilims + inner glow.
const AOE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const AOE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uRunes;       // 1 = on, 0 = plain ring
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float angle = atan(c.y, c.x);

    // Outer rim
    float rim = smoothstep(0.78, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
    // Inner soft glow
    float glow = (1.0 - smoothstep(0.0, 0.95, r)) * 0.18;

    // Rotating rune dilims: 8 evenly-spaced wedges that pulse.
    float runes = 0.0;
    if (uRunes > 0.5) {
      float a = angle + uTime * 0.6;
      float wedge = sin(a * 8.0) * 0.5 + 0.5;
      wedge = smoothstep(0.55, 0.95, wedge);
      // Limit runes to a band near the rim.
      float band = smoothstep(0.55, 0.78, r) * (1.0 - smoothstep(0.78, 0.94, r));
      runes = wedge * band * 0.7;
      // Inner counter-rotating sigil.
      float a2 = angle - uTime * 1.1;
      float sig = sin(a2 * 5.0) * 0.5 + 0.5;
      sig = smoothstep(0.7, 0.95, sig);
      float sigBand = smoothstep(0.25, 0.45, r) * (1.0 - smoothstep(0.45, 0.6, r));
      runes += sig * sigBand * 0.5;
    }

    float total = rim + glow + runes;
    vec3 col = mix(uColor, uCore, runes);
    gl_FragColor = vec4(col, total * uAlpha);
  }
`;

// Hit decal — small cracked star pattern.
const HIT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float angle = atan(c.y, c.x);
    // Crack rays: high-frequency angular stripes that shrink with radius.
    float rays = abs(sin(angle * 7.0));
    rays = smoothstep(0.55, 1.0, rays);
    rays *= (1.0 - smoothstep(0.0, 0.9, r));
    // Center burn.
    float burn = (1.0 - smoothstep(0.0, 0.4, r)) * 0.6;
    float a = (rays + burn) * uAlpha;
    gl_FragColor = vec4(uColor, a);
  }
`;

// Telegraph ring — sparking edge, rotating dashed segments.
const TELE_RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uProgress; // 0..1 fill-up cue
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float angle = atan(c.y, c.x);

    // Outer ring band.
    float band = smoothstep(0.85, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
    // Dashed rotating segments.
    float dash = sin((angle + uTime * 1.4) * 12.0) * 0.5 + 0.5;
    dash = smoothstep(0.6, 0.95, dash);
    band *= 0.4 + dash * 0.8;

    // Fill (inner shaded region — visualizes danger zone).
    float fill = (1.0 - smoothstep(0.0, 0.85, r)) * 0.18;
    // Sweep cue: angular wedge from -PI to PI as progress fills.
    float sweep = step(angle, -3.14159 + uProgress * 6.2832) * fill * 0.6;

    float total = band + fill + sweep;
    gl_FragColor = vec4(uColor, total * uAlpha);
  }
`;

// Telegraph cone — flow-shader along the cone surface.
const TELE_CONE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uProgress;
  varying vec2 vUv;
  void main() {
    // ConeGeometry side gives uv.y running tip→base.
    float along = 1.0 - vUv.y;
    float flow = fract(along * 3.0 - uTime * 1.2);
    flow = smoothstep(0.7, 1.0, flow);
    float band = smoothstep(0.0, 0.05, along) * (1.0 - smoothstep(0.95, 1.0, along));
    float a = (flow * 0.7 + band * 0.4) * uAlpha;
    a *= 0.4 + uProgress * 0.6;
    gl_FragColor = vec4(uColor, a);
  }
`;

// Telegraph beam line.
const TELE_LINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    // uv.x runs along the beam, uv.y across width.
    float lat = abs(vUv.y - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.0, 0.6, lat);
    float flow = fract(vUv.x * 4.0 - uTime * 1.5);
    flow = smoothstep(0.6, 1.0, flow);
    float a = (core + flow * 0.4) * uAlpha;
    gl_FragColor = vec4(uColor, a);
  }
`;

interface AoeSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  duration: number;
}

interface HitSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  duration: number;
}

interface TeleRingSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  duration: number;
}

interface TeleConeSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  duration: number;
}

interface TeleLineSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  duration: number;
}

export interface DecalSystem {
  spawnAoEDecal(x: number, z: number, radius: number, duration: number, color: number, runeShader?: boolean): void;
  spawnHitDecal(x: number, z: number, color: number): void;
  spawnTelegraphRing(x: number, z: number, radius: number, duration: number, color: number): void;
  spawnTelegraphCone(x: number, z: number, dirX: number, dirZ: number, length: number, halfAngle: number, duration: number, color: number): void;
  spawnTelegraphLine(x1: number, z1: number, x2: number, z2: number, width: number, duration: number, color: number): void;
  update(realDt: number): void;
}

const _color = new Color();

export function createDecalSystem(scene: Scene): DecalSystem {
  // ── AoE pool ──
  const aoeSlots: AoeSlot[] = [];
  const aoeGeom = new PlaneGeometry(2, 2); // unit-2 plane; scale to radius.
  for (let i = 0; i < AOE_POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: AOE_VERT,
      fragmentShader: AOE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xffffff) },
        uCore: { value: new Color(0xffffff) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uRunes: { value: 1 },
      },
    });
    const mesh = new Mesh(aoeGeom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.06;
    mesh.visible = false;
    mesh.renderOrder = 996;
    // Polygon offset so we don't z-fight the ground.
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    scene.add(mesh);
    aoeSlots.push({ mesh, mat, active: false, age: 0, duration: 0 });
  }

  // ── Hit pool ──
  const hitSlots: HitSlot[] = [];
  const hitGeom = new PlaneGeometry(2, 2);
  for (let i = 0; i < HIT_POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: AOE_VERT,
      fragmentShader: HIT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xffffff) },
        uAlpha: { value: 0 },
      },
    });
    const mesh = new Mesh(hitGeom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.07;
    mesh.visible = false;
    mesh.renderOrder = 996;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    scene.add(mesh);
    hitSlots.push({ mesh, mat, active: false, age: 0, duration: 1.5 });
  }

  // ── Telegraph ring pool ──
  const teleRingSlots: TeleRingSlot[] = [];
  const teleRingGeom = new PlaneGeometry(2, 2);
  for (let i = 0; i < TELE_RING_POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: AOE_VERT,
      fragmentShader: TELE_RING_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xff4040) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
    });
    const mesh = new Mesh(teleRingGeom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.08;
    mesh.visible = false;
    mesh.renderOrder = 996;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    scene.add(mesh);
    teleRingSlots.push({ mesh, mat, active: false, age: 0, duration: 0 });
  }

  // ── Telegraph cone pool ──
  const teleConeSlots: TeleConeSlot[] = [];
  // Unit cone laid flat (rotated -PI/2 on x so the tip is at origin pointing +Z, base on the ground).
  for (let i = 0; i < TELE_CONE_POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: AOE_VERT,
      fragmentShader: TELE_CONE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xff4040) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
    });
    // Geometry built per-spawn (cone radius/length variable). Start with a placeholder.
    const placeholder = new ConeGeometry(1, 1, 24, 1, true);
    const mesh = new Mesh(placeholder, mat);
    mesh.visible = false;
    mesh.renderOrder = 996;
    scene.add(mesh);
    teleConeSlots.push({ mesh, mat, active: false, age: 0, duration: 0 });
  }

  // ── Telegraph line pool ──
  const teleLineSlots: TeleLineSlot[] = [];
  const teleLineGeom = new PlaneGeometry(1, 1); // 1×1 unit; scaled to length×width.
  for (let i = 0; i < TELE_LINE_POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: AOE_VERT,
      fragmentShader: TELE_LINE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xff4040) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
      },
    });
    const mesh = new Mesh(teleLineGeom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.07;
    mesh.visible = false;
    mesh.renderOrder = 996;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    scene.add(mesh);
    teleLineSlots.push({ mesh, mat, active: false, age: 0, duration: 0 });
  }

  function findFree<T extends { active: boolean; age: number; duration: number }>(slots: T[]): T {
    for (const s of slots) if (!s.active) return s;
    let oldest = slots[0]!;
    for (const s of slots) {
      const sp = s.duration > 0 ? s.age / s.duration : 1;
      const op = oldest.duration > 0 ? oldest.age / oldest.duration : 1;
      if (sp > op) oldest = s;
    }
    return oldest;
  }

  let elapsedTime = 0;

  return {
    spawnAoEDecal(x, z, radius, duration, color, runeShader = true) {
      const s = findFree(aoeSlots);
      s.active = true;
      s.age = 0;
      s.duration = Math.max(0.1, duration);
      s.mesh.position.set(x, 0.06, z);
      s.mesh.scale.setScalar(radius);
      s.mesh.visible = true;
      _color.setHex(color);
      (s.mat.uniforms.uColor!.value as Color).copy(_color);
      // Core = mostly white-tinted version of color.
      (s.mat.uniforms.uCore!.value as Color).copy(_color).lerp(new Color(0xffffff), 0.55);
      s.mat.uniforms.uAlpha!.value = 0.9;
      s.mat.uniforms.uRunes!.value = runeShader ? 1 : 0;
    },

    spawnHitDecal(x, z, color) {
      const s = findFree(hitSlots);
      s.active = true;
      s.age = 0;
      s.duration = 1.5;
      s.mesh.position.set(x, 0.07, z);
      s.mesh.scale.setScalar(0.6);
      s.mesh.visible = true;
      // Slight random rotation so consecutive hits don't look identical.
      s.mesh.rotation.z = Math.random() * Math.PI * 2;
      _color.setHex(color);
      (s.mat.uniforms.uColor!.value as Color).copy(_color);
      s.mat.uniforms.uAlpha!.value = 0.9;
    },

    spawnTelegraphRing(x, z, radius, duration, color) {
      const s = findFree(teleRingSlots);
      s.active = true;
      s.age = 0;
      s.duration = Math.max(0.1, duration);
      s.mesh.position.set(x, 0.08, z);
      s.mesh.scale.setScalar(radius);
      s.mesh.visible = true;
      _color.setHex(color);
      (s.mat.uniforms.uColor!.value as Color).copy(_color);
      s.mat.uniforms.uAlpha!.value = 1;
      s.mat.uniforms.uProgress!.value = 0;
    },

    spawnTelegraphCone(x, z, dirX, dirZ, length, halfAngle, duration, color) {
      const s = findFree(teleConeSlots);
      s.active = true;
      s.age = 0;
      s.duration = Math.max(0.1, duration);
      // Build cone geometry sized to length × tan(halfAngle) * length.
      const baseRadius = Math.tan(halfAngle) * length;
      s.mesh.geometry.dispose();
      s.mesh.geometry = new ConeGeometry(baseRadius, length, 24, 1, true);
      // Default cone in three.js points up Y. We want it lying flat on XZ pointing along (dirX,dirZ).
      // Steps:
      //  1) Translate so tip is at origin (move geometry up by length/2).
      const geom = s.mesh.geometry;
      geom.translate(0, length / 2, 0);
      //  2) Rotate so cone axis is along +X (90° around Z), then orient via mesh.rotation.y.
      // Easier: rotate the mesh: mesh.rotation.x = -PI/2 lays it on XZ pointing +Z.
      //         then mesh.rotation.y aligns +Z with our (dirX, dirZ).
      const yaw = Math.atan2(dirX, dirZ);
      s.mesh.rotation.set(-Math.PI / 2, 0, 0);
      // Apply yaw via parent transform: rotate around Y after the X tilt by composing.
      // Object3D applies rotations in XYZ order — rotation.y rotates around the world Y
      // even after the X tilt because rotations compose multiplicatively. Set y on the
      // mesh frame but we need it before the X tilt; easiest way: keep position + use
      // rotation order 'YXZ' so y is applied first.
      s.mesh.rotation.order = 'YXZ';
      s.mesh.rotation.y = yaw;
      s.mesh.rotation.x = -Math.PI / 2;
      s.mesh.position.set(x, 0.08, z);
      s.mesh.scale.setScalar(1);
      s.mesh.visible = true;
      _color.setHex(color);
      (s.mat.uniforms.uColor!.value as Color).copy(_color);
      s.mat.uniforms.uAlpha!.value = 1;
      s.mat.uniforms.uProgress!.value = 0;
    },

    spawnTelegraphLine(x1, z1, x2, z2, width, duration, color) {
      const s = findFree(teleLineSlots);
      s.active = true;
      s.age = 0;
      s.duration = Math.max(0.1, duration);
      const dx = x2 - x1;
      const dz = z2 - z1;
      const length = Math.hypot(dx, dz) || 0.01;
      const cx = (x1 + x2) * 0.5;
      const cz = (z1 + z2) * 0.5;
      s.mesh.position.set(cx, 0.07, cz);
      s.mesh.scale.set(length, 1, width);
      // Plane is created in XY; rotated -PI/2 on X to lie on XZ. Now rotate around Y to
      // align the plane's local +X with our (dx, dz).
      s.mesh.rotation.order = 'YXZ';
      s.mesh.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
      s.mesh.rotation.x = -Math.PI / 2;
      s.mesh.visible = true;
      _color.setHex(color);
      (s.mat.uniforms.uColor!.value as Color).copy(_color);
      s.mat.uniforms.uAlpha!.value = 1;
    },

    update(realDt) {
      elapsedTime += realDt;

      // AoE
      for (const s of aoeSlots) {
        if (!s.active) continue;
        s.age += realDt;
        const t = s.age / s.duration;
        if (t >= 1) { s.active = false; s.mesh.visible = false; continue; }
        s.mat.uniforms.uTime!.value = elapsedTime;
        // Fade-in (0..0.15) → hold → fade-out (last 0.4).
        let a = 0.9;
        if (t < 0.15) a *= t / 0.15;
        else if (t > 0.6) a *= 1 - (t - 0.6) / 0.4;
        s.mat.uniforms.uAlpha!.value = Math.max(0, a);
      }

      // Hit
      for (const s of hitSlots) {
        if (!s.active) continue;
        s.age += realDt;
        const t = s.age / s.duration;
        if (t >= 1) { s.active = false; s.mesh.visible = false; continue; }
        s.mat.uniforms.uAlpha!.value = (1 - t) * 0.9;
      }

      // Telegraph ring
      for (const s of teleRingSlots) {
        if (!s.active) continue;
        s.age += realDt;
        const t = s.age / s.duration;
        if (t >= 1) { s.active = false; s.mesh.visible = false; continue; }
        s.mat.uniforms.uTime!.value = elapsedTime;
        s.mat.uniforms.uProgress!.value = t;
        // Pulse alpha so the danger reads even at glance.
        s.mat.uniforms.uAlpha!.value = 0.65 + 0.35 * Math.sin(t * Math.PI);
      }

      // Telegraph cone
      for (const s of teleConeSlots) {
        if (!s.active) continue;
        s.age += realDt;
        const t = s.age / s.duration;
        if (t >= 1) { s.active = false; s.mesh.visible = false; continue; }
        s.mat.uniforms.uTime!.value = elapsedTime;
        s.mat.uniforms.uProgress!.value = t;
        s.mat.uniforms.uAlpha!.value = 0.75 + 0.25 * Math.sin(t * Math.PI);
      }

      // Telegraph line
      for (const s of teleLineSlots) {
        if (!s.active) continue;
        s.age += realDt;
        const t = s.age / s.duration;
        if (t >= 1) { s.active = false; s.mesh.visible = false; continue; }
        s.mat.uniforms.uTime!.value = elapsedTime;
        s.mat.uniforms.uAlpha!.value = 0.7 + 0.3 * Math.sin(t * Math.PI);
      }
    },
  };
}

// Re-export a typed Vector3 (some callers want to express arc axes without importing three).
export const TRAILS_AXIS_UP = new Vector3(0, 1, 0);
export const TRAILS_AXIS_RIGHT = new Vector3(1, 0, 0);
