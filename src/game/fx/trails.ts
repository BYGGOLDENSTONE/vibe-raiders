// Trail meshes — pooled TubeGeometry ribbons for melee swing arcs and projectile streaks.
// All geometry/materials are allocated once at pool init; spawning a trail just
// rebuilds buffer attributes on an existing mesh and toggles visibility.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Object3D, Scene } from 'three';

const SWING_POOL_SIZE = 24;
const PROJECTILE_POOL_SIZE = 32;

// ─── Shaders ───
// Vertex pass through. Fragment fades along length (UV.x) and across thickness (UV.y).
const TRAIL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uAlpha;
  uniform float uHeadBoost;
  varying vec2 vUv;
  void main() {
    // Length fade (head bright, tail dim).
    float lenFade = smoothstep(0.0, 1.0, vUv.x);
    // Thickness fade (centre bright, edge dim).
    float thick = 1.0 - abs(vUv.y * 2.0 - 1.0);
    thick = pow(thick, 1.5);
    // Mix core into head.
    vec3 col = mix(uColor, uCore, lenFade * uHeadBoost);
    float a = lenFade * thick * uAlpha;
    gl_FragColor = vec4(col, a);
  }
`;

interface SwingSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  duration: number;
}

interface ProjectileSlot {
  mesh: Mesh;
  mat: ShaderMaterial;
  active: boolean;
  age: number;
  lifetime: number;
  // Ring buffer of recent positions (head at index 0).
  history: Vector3[];
  obj: Object3D | null;
  // Final fade-out latch — set when source object3d disappears.
  decaying: boolean;
  decayAge: number;
}

export interface TrailPool {
  spawnSwingTrail(opts: {
    origin: { x: number; y: number; z: number };
    arcAxis: Vector3;
    arcAngleStart: number;
    arcAngleEnd: number;
    radius: number;
    duration: number;
    color: number;
    coreColor?: number;
  }): void;
  spawnProjectileTrail(obj: Object3D, color: number, lifetime: number, coreColor?: number): void;
  releaseProjectileTrail(obj: Object3D): void;
  update(realDt: number): void;
}

const _color = new Color();

export function createTrailPool(scene: Scene): TrailPool {
  // ── Swing pool: each slot owns a Mesh whose geometry we replace on spawn. ──
  const swingSlots: SwingSlot[] = [];
  for (let i = 0; i < SWING_POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xffffff) },
        uCore: { value: new Color(0xffffff) },
        uAlpha: { value: 0 },
        uHeadBoost: { value: 0.6 },
      },
    });
    // Placeholder geometry; replaced on spawn.
    const geom = new BufferGeometry();
    const mesh = new Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 997;
    scene.add(mesh);
    swingSlots.push({ mesh, mat, active: false, age: 0, duration: 0 });
  }

  function findSwingSlot(): SwingSlot {
    for (const s of swingSlots) if (!s.active) return s;
    let oldest = swingSlots[0]!;
    for (const s of swingSlots) if (s.age / s.duration > oldest.age / oldest.duration) oldest = s;
    return oldest;
  }

  // ── Projectile pool: ring-buffer of positions, tube rebuilt each frame. ──
  const projSlots: ProjectileSlot[] = [];
  const HISTORY = 12;
  for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
    const mat = new ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(0xffffff) },
        uCore: { value: new Color(0xffffff) },
        uAlpha: { value: 0 },
        uHeadBoost: { value: 0.7 },
      },
    });
    const geom = new BufferGeometry();
    const mesh = new Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 997;
    scene.add(mesh);
    const history: Vector3[] = [];
    for (let h = 0; h < HISTORY; h++) history.push(new Vector3());
    projSlots.push({ mesh, mat, active: false, age: 0, lifetime: 0, history, obj: null, decaying: false, decayAge: 0 });
  }

  function findProjSlot(): ProjectileSlot {
    for (const s of projSlots) if (!s.active) return s;
    // Recycle oldest decaying one, else the one with the most history age.
    let victim = projSlots[0]!;
    for (const s of projSlots) {
      if (s.decaying && s.decayAge > victim.decayAge) victim = s;
    }
    return victim;
  }

  return {
    spawnSwingTrail({ origin, arcAxis, arcAngleStart, arcAngleEnd, radius, duration, color, coreColor }) {
      const slot = findSwingSlot();
      slot.active = true;
      slot.age = 0;
      slot.duration = Math.max(0.05, duration);

      // Build a Catmull-Rom curve sweeping arcAngleStart→arcAngleEnd around arcAxis,
      // anchored at origin. We sample 15 points; arcAxis is the cross-axis (e.g. an
      // upward weapon swing has arcAxis ~ Vector3(0,0,1) — the swing rotates within
      // the XY plane around Z). For simplicity we build the arc in a local frame
      // whose normal is arcAxis, with the arc lying in the perpendicular plane.
      const axis = arcAxis.clone().normalize();
      // Pick a perpendicular reference vector.
      const ref = Math.abs(axis.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
      const u = new Vector3().crossVectors(axis, ref).normalize();
      const v = new Vector3().crossVectors(axis, u).normalize();

      const pts: Vector3[] = [];
      const SAMPLES = 15;
      for (let i = 0; i < SAMPLES; i++) {
        const t = i / (SAMPLES - 1);
        const a = arcAngleStart + (arcAngleEnd - arcAngleStart) * t;
        const cosA = Math.cos(a);
        const sinA = Math.sin(a);
        const px = origin.x + (u.x * cosA + v.x * sinA) * radius;
        const py = origin.y + (u.y * cosA + v.y * sinA) * radius;
        const pz = origin.z + (u.z * cosA + v.z * sinA) * radius;
        pts.push(new Vector3(px, py, pz));
      }
      const curve = new CatmullRomCurve3(pts);
      const tube = new TubeGeometry(curve, 24, 0.05, 4, false);
      // Re-assign UV.x to be 0..1 along length so the shader head/tail fade lines up.
      const uvAttr = tube.getAttribute('uv') as BufferAttribute | undefined;
      if (uvAttr) {
        // Tube UVs already run 0..1 along length on .x; leave them.
        uvAttr.needsUpdate = true;
      }
      // Swap geometry on the slot mesh.
      slot.mesh.geometry.dispose();
      slot.mesh.geometry = tube;

      _color.setHex(color);
      (slot.mat.uniforms.uColor!.value as Color).copy(_color);
      _color.setHex(coreColor ?? 0xffffff);
      (slot.mat.uniforms.uCore!.value as Color).copy(_color);
      slot.mat.uniforms.uAlpha!.value = 1;
      slot.mesh.visible = true;
    },

    spawnProjectileTrail(obj, color, lifetime, coreColor) {
      // If this object already owns a slot, reuse it.
      let slot: ProjectileSlot | null = null;
      for (const s of projSlots) {
        if (s.obj === obj) { slot = s; break; }
      }
      if (!slot) slot = findProjSlot();

      slot.active = true;
      slot.age = 0;
      slot.lifetime = lifetime;
      slot.obj = obj;
      slot.decaying = false;
      slot.decayAge = 0;
      // Seed history with current pos so first-frame trail isn't a zero-length tube.
      for (let h = 0; h < slot.history.length; h++) {
        slot.history[h]!.copy(obj.position);
      }
      _color.setHex(color);
      (slot.mat.uniforms.uColor!.value as Color).copy(_color);
      _color.setHex(coreColor ?? 0xffffff);
      (slot.mat.uniforms.uCore!.value as Color).copy(_color);
      slot.mat.uniforms.uAlpha!.value = 1;
      slot.mesh.visible = true;
    },

    releaseProjectileTrail(obj) {
      for (const s of projSlots) {
        if (s.obj === obj && s.active) {
          s.decaying = true;
          s.decayAge = 0;
          break;
        }
      }
    },

    update(realDt) {
      // Swing trails: simple alpha fade and slight expansion.
      for (const s of swingSlots) {
        if (!s.active) continue;
        s.age += realDt;
        const t = s.age / s.duration;
        if (t >= 1) {
          s.active = false;
          s.mesh.visible = false;
          s.mat.uniforms.uAlpha!.value = 0;
          continue;
        }
        // Fade out, ease-out shape.
        s.mat.uniforms.uAlpha!.value = (1 - t) * (1 - t);
      }

      // Projectile trails: shift history, rebuild tube along catmull-rom.
      for (const s of projSlots) {
        if (!s.active) continue;
        s.age += realDt;

        if (s.decaying) {
          s.decayAge += realDt;
          // 0.35s fade-out window.
          const f = 1 - Math.min(1, s.decayAge / 0.35);
          s.mat.uniforms.uAlpha!.value = f;
          if (s.decayAge >= 0.35) {
            s.active = false;
            s.decaying = false;
            s.mesh.visible = false;
            s.obj = null;
            continue;
          }
        } else if (s.obj) {
          // Drop the oldest (last) point and prepend current obj.position.
          const last = s.history[s.history.length - 1]!;
          for (let i = s.history.length - 1; i > 0; i--) {
            s.history[i]!.copy(s.history[i - 1]!);
          }
          s.history[0]!.copy(s.obj.position);
          // Suppress unused-var lint on `last` (semantic clarity).
          void last;

          // Auto-expire if obj somehow stays attached past lifetime.
          if (s.age >= s.lifetime) {
            s.decaying = true;
            s.decayAge = 0;
          }
        } else {
          // No obj; auto-decay.
          s.decaying = true;
        }

        // Rebuild tube. Curve needs ≥2 unique points; if all collapsed, hide.
        const curve = new CatmullRomCurve3(s.history.slice());
        try {
          s.mesh.geometry.dispose();
          s.mesh.geometry = new TubeGeometry(curve, 16, 0.06, 4, false);
        } catch {
          // Degenerate curve; skip this frame.
        }
      }
    },
  };
}
