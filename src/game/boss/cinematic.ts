// Boss cinematic helpers — phase-2 transition flash, death soul + ground crack,
// scythe sweep trail. Pure visual: no gameplay logic.

import {
  AdditiveBlending,
  BackSide,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  type Object3D,
  type Scene,
  type Vector3,
} from 'three';

const COLOR_CRIMSON = 0x8a0a18;
const COLOR_EMBER = 0xff5020;

// ─── Phase-2 DOM crimson overlay ─────────────────────────────────────────
// We keep this purely DOM so we don't have to touch fx/composer.

let overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    'background:radial-gradient(ellipse at center, rgba(255,40,30,0.0) 30%, rgba(140,4,4,0.65) 100%)',
    'opacity:0',
    'z-index:9000',
    'mix-blend-mode:screen',
    'transition:opacity 220ms ease-out',
  ].join(';');
  document.body.appendChild(overlay);
  return overlay;
}

export function flashPhaseTwoOverlay(): void {
  const el = ensureOverlay();
  el.style.opacity = '1';
  setTimeout(() => {
    if (overlay) overlay.style.opacity = '0';
  }, 280);
}

// ─── Phase-2 expanding crimson burst sphere (in-scene, around boss) ──────

interface BurstHandle {
  mesh: Mesh;
  light: PointLight;
  startTime: number;
  duration: number;
  scene: Scene;
  parent: Object3D;
}

const activeBursts: BurstHandle[] = [];

export function spawnPhaseTwoBurst(scene: Scene, atWorldPos: Vector3, now: number): void {
  const mat = new MeshBasicMaterial({
    color: COLOR_CRIMSON,
    transparent: true,
    opacity: 0.85,
    side: BackSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(0.5, 24, 16), mat);
  mesh.position.copy(atWorldPos);
  mesh.position.y += 1.5;
  scene.add(mesh);

  const light = new PointLight(COLOR_EMBER, 6, 14, 1.4);
  light.position.copy(atWorldPos);
  light.position.y += 1.5;
  scene.add(light);

  activeBursts.push({ mesh, light, startTime: now, duration: 0.55, scene, parent: scene });
}

export function tickPhaseTwoBursts(now: number): void {
  for (let i = activeBursts.length - 1; i >= 0; i--) {
    const b = activeBursts[i]!;
    const t = (now - b.startTime) / b.duration;
    if (t >= 1) {
      b.scene.remove(b.mesh);
      b.scene.remove(b.light);
      b.mesh.geometry.dispose();
      (b.mesh.material as MeshBasicMaterial).dispose();
      activeBursts.splice(i, 1);
      continue;
    }
    const s = 0.5 + t * 8;
    b.mesh.scale.setScalar(s);
    (b.mesh.material as MeshBasicMaterial).opacity = 0.85 * (1 - t);
    b.light.intensity = 6 * (1 - t);
  }
}

// ─── Death cinematic: rising soul + ground crack ─────────────────────────

interface SoulHandle {
  group: Group;
  particles: Mesh[];
  startTime: number;
  duration: number;
  scene: Scene;
  spawnY: number;
}

interface CrackHandle {
  group: Group;
  startTime: number;
  duration: number;
  scene: Scene;
  pieces: Mesh[];
}

const activeSouls: SoulHandle[] = [];
const activeCracks: CrackHandle[] = [];

export function spawnDeathSoul(scene: Scene, atWorldPos: Vector3, now: number): void {
  const group = new Group();
  group.position.copy(atWorldPos);
  group.position.y += 2.0;
  scene.add(group);

  const soulMat = new MeshBasicMaterial({
    color: 0xb8d8ff,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const core = new Mesh(new SphereGeometry(0.45, 16, 12), soulMat);
  group.add(core);

  // Halo ring around core.
  const haloMat = new MeshBasicMaterial({
    color: 0xddeeff,
    transparent: true,
    opacity: 0.6,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const halo = new Mesh(new RingGeometry(0.6, 0.85, 32), haloMat);
  halo.rotation.x = -Math.PI / 2;
  group.add(halo);

  // Soft point light.
  const light = new PointLight(0xc0d8ff, 3.0, 8, 1.4);
  group.add(light);

  // Trailing particles (12 small spheres that drift up + outward).
  const particles: Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const pMat = new MeshBasicMaterial({
      color: 0xa0c0ff,
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const p = new Mesh(new SphereGeometry(0.08 + Math.random() * 0.1, 8, 6), pMat);
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const r = 0.3 + Math.random() * 0.4;
    p.position.set(Math.cos(a) * r, -0.5 + Math.random() * 0.6, Math.sin(a) * r);
    p.userData.driftA = a;
    p.userData.driftR = r;
    p.userData.driftSpeed = 0.6 + Math.random() * 0.6;
    group.add(p);
    particles.push(p);
  }

  activeSouls.push({
    group,
    particles,
    startTime: now,
    duration: 2.4,
    scene,
    spawnY: group.position.y,
  });
}

export function spawnGroundCrack(scene: Scene, atWorldPos: Vector3, now: number): void {
  const group = new Group();
  group.position.copy(atWorldPos);
  group.position.y = atWorldPos.y - 0.95; // hug the dungeon floor
  scene.add(group);

  const pieces: Mesh[] = [];
  // 8 radial crack slivers.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
    const len = 3 + Math.random() * 1.5;
    const w = 0.18 + Math.random() * 0.1;
    const mat = new MeshBasicMaterial({
      color: 0xff3010,
      transparent: true,
      opacity: 0.0,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const geom = new PlaneGeometry(w, len);
    const mesh = new Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -a;
    mesh.position.set(Math.cos(a) * len * 0.5, 0.02, Math.sin(a) * len * 0.5);
    mesh.userData.angle = a;
    mesh.userData.length = len;
    group.add(mesh);
    pieces.push(mesh);
  }
  activeCracks.push({ group, startTime: now, duration: 2.2, scene, pieces });
}

export function tickDeathCinematics(now: number): void {
  // Soul rise + drift.
  for (let i = activeSouls.length - 1; i >= 0; i--) {
    const s = activeSouls[i]!;
    const t = (now - s.startTime) / s.duration;
    if (t >= 1) {
      s.scene.remove(s.group);
      disposeGroup(s.group);
      activeSouls.splice(i, 1);
      continue;
    }
    s.group.position.y = s.spawnY + t * 6;
    const fade = 1 - t;
    for (const child of s.group.children) {
      const m = (child as Mesh).material;
      if (m && 'opacity' in m && (m as MeshBasicMaterial).transparent) {
        (m as MeshBasicMaterial).opacity = Math.min(1, fade) * 0.85;
      }
    }
    for (const p of s.particles) {
      const dr = (p.userData.driftR as number) + t * 0.6;
      const a = (p.userData.driftA as number) + t * 0.4;
      p.position.x = Math.cos(a) * dr;
      p.position.z = Math.sin(a) * dr;
      p.position.y += (p.userData.driftSpeed as number) * 0.02;
    }
    s.group.rotation.y = t * 1.5;
  }

  // Ground crack: fade in then slowly fade out.
  for (let i = activeCracks.length - 1; i >= 0; i--) {
    const c = activeCracks[i]!;
    const t = (now - c.startTime) / c.duration;
    if (t >= 1) {
      c.scene.remove(c.group);
      disposeGroup(c.group);
      activeCracks.splice(i, 1);
      continue;
    }
    // Open phase 0..0.3 (fast pulse), hold 0.3..0.7, fade 0.7..1.
    let alpha: number;
    if (t < 0.3) alpha = (t / 0.3) * 0.95;
    else if (t < 0.7) alpha = 0.95;
    else alpha = (1 - (t - 0.7) / 0.3) * 0.95;
    for (const piece of c.pieces) {
      const m = piece.material as MeshBasicMaterial;
      m.opacity = alpha;
      // Grow to full length over the open phase.
      const grow = Math.min(1, t / 0.3);
      piece.scale.set(1, grow, 1);
    }
  }
}

function disposeGroup(g: Group): void {
  g.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      const m = o.material as MeshBasicMaterial | MeshBasicMaterial[];
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m.dispose();
    }
  });
}

// ─── Rune-shader telegraph material ──────────────────────────────────────
//
// Replaces flat MeshBasicMaterial fills with a swirling rune pattern in the
// crimson palette. Used for circle/arc/line telegraphs.

export interface RuneTelegraphMatRef {
  mat: ShaderMaterial;
}

export function buildRuneTelegraphMaterial(opts: {
  variant: 'circle' | 'arc' | 'line';
  color?: number;
}): ShaderMaterial {
  const color = new Color(opts.color ?? 0xff2030);
  return new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 }, // 0..1 windup fill
      uColor: { value: color },
      uAlpha: { value: 0.55 },
      uVariant: { value: opts.variant === 'arc' ? 1 : opts.variant === 'line' ? 2 : 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uProgress;
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform int uVariant;

      float runePattern(vec2 p) {
        // Polar-coord rune dilim.
        vec2 c = p - vec2(0.5);
        float r = length(c) * 2.0;
        float a = atan(c.y, c.x);
        float spokes = sin(a * 8.0 + uTime * 0.8) * 0.5 + 0.5;
        float secondary = sin(a * 4.0 - uTime * 0.5) * 0.5 + 0.5;
        // Hash dots for engraving feel.
        float ring1 = smoothstep(0.04, 0.0, abs(r - 0.55 - 0.08 * sin(uTime * 1.2)));
        float ring2 = smoothstep(0.025, 0.0, abs(r - 0.78));
        float ring3 = smoothstep(0.02, 0.0, abs(r - 0.93));
        float runes = spokes * (1.0 - smoothstep(0.62, 0.78, r)) * smoothstep(0.32, 0.5, r);
        float swirl = secondary * smoothstep(0.0, 0.4, r) * (1.0 - smoothstep(0.5, 0.6, r));
        return clamp(ring1 + ring2 * 0.7 + ring3 * 0.5 + runes * 0.85 + swirl * 0.25, 0.0, 1.0);
      }

      void main() {
        // Base radial fade for circle variant.
        vec2 p = vUv;
        float pat;
        if (uVariant == 0) {
          pat = runePattern(p);
        } else if (uVariant == 1) {
          // Arc: re-map UV to a centered radial layout (UVs come from RingGeometry — use them directly).
          pat = runePattern(p);
        } else {
          // Line: sliding stripes + inner glow.
          float band = abs(p.y - 0.5);
          float core = smoothstep(0.5, 0.0, band * 4.0);
          float stripes = 0.5 + 0.5 * sin((p.x * 14.0) + uTime * 4.0);
          pat = core * (0.5 + 0.5 * stripes);
        }
        // Fill ramp by progress (interior glow grows during windup).
        float fill = mix(0.18, 0.65, smoothstep(0.0, 1.0, uProgress));
        float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
        vec3 col = uColor * (fill + pat * (0.6 + 0.3 * pulse));
        float a = (fill + pat) * uAlpha;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
  });
}

// ─── Boss ribbon-cape ─────────────────────────────────────────────────────
// Single mesh: 6×12 grid plane with vertex shader that bows it around the
// boss (cylindrical wrap), sways with time, and reacts to a velocity uniform.

export interface BossCapeRig {
  mesh: Mesh;
  mat: ShaderMaterial;
  // World-velocity input (mutated each frame).
  prevPos: Vector3;
}

export function buildBossCape(initialPos: Vector3): BossCapeRig {
  const segX = 12;
  const segY = 8;
  const w = 3.6;
  const h = 2.8;
  const geom = new PlaneGeometry(w, h, segX, segY);
  // Anchor top edge at y = 0; rest hangs down.
  geom.translate(0, -h / 2, 0);

  const mat = new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uVel: { value: new Color(0, 0, 0) }, // reusing Color as a vec3 holder
      uPhaseTwo: { value: 0 },
      uColor: { value: new Color(0x6a0a18) },
      uTrim: { value: new Color(0x501010) },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uVel;
      uniform float uPhaseTwo;

      void main() {
        vUv = uv;
        vec3 p = position;
        // Wrap around boss: bend the X axis into a partial cylinder.
        float wrap = 1.4;
        float ang = (p.x / 1.8) * wrap;
        float radius = 0.95;
        vec3 wrapped = vec3(sin(ang) * radius, p.y, -cos(ang) * radius + radius);
        // Gravity-influenced taper toward bottom.
        float tBottom = clamp(-p.y / 2.6, 0.0, 1.0);
        // Sway: wave along Y, modulated by sway frequency and X position.
        float sway = sin(uTime * 2.0 + p.y * 1.6 + p.x * 0.5) * 0.3 * tBottom;
        wrapped.x += sway * (0.5 + uPhaseTwo * 0.4);
        wrapped.z += cos(uTime * 1.5 + p.y * 1.3) * 0.15 * tBottom;
        // Velocity influence: drag bottom against motion direction.
        wrapped.xz -= uVel.xz * tBottom * 0.6;
        wrapped.y -= tBottom * 0.05; // sag
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wrapped, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform vec3 uTrim;
      uniform float uPhaseTwo;
      uniform float uTime;

      void main() {
        // Top→bottom gradient: dark purple/violet top → crimson hem.
        float yT = clamp(1.0 - vUv.y, 0.0, 1.0);
        vec3 top = mix(vec3(0.16, 0.04, 0.08), vec3(0.24, 0.04, 0.06), uPhaseTwo);
        vec3 mid = uColor;
        vec3 hem = mix(uTrim, vec3(0.95, 0.18, 0.18), uPhaseTwo);
        vec3 col = mix(top, mid, smoothstep(0.0, 0.5, yT));
        col = mix(col, hem, smoothstep(0.7, 1.0, yT));
        // Tatter alpha at hem (irregular cuts).
        float tatter = step(0.04, sin(vUv.x * 18.0) * 0.5 + 0.5 - smoothstep(0.85, 1.0, yT));
        float a = mix(0.92, tatter, smoothstep(0.85, 1.0, yT));
        // Subtle inner glow flicker phase 2.
        col += vec3(0.6, 0.05, 0.08) * uPhaseTwo * (0.05 + 0.05 * sin(uTime * 3.0));
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const mesh = new Mesh(geom, mat);
  mesh.position.set(0, 0, 0);
  return { mesh, mat, prevPos: initialPos.clone() };
}

export function tickBossCape(rig: BossCapeRig, currentWorldPos: Vector3, now: number, dt: number): void {
  if (dt <= 0) dt = 1 / 60;
  const vx = (currentWorldPos.x - rig.prevPos.x) / dt;
  const vz = (currentWorldPos.z - rig.prevPos.z) / dt;
  rig.prevPos.copy(currentWorldPos);
  // Damp + clamp.
  const dampX = Math.max(-3, Math.min(3, vx * 0.4));
  const dampZ = Math.max(-3, Math.min(3, vz * 0.4));
  // Reuse uniform Color object for velocity (r=x, g=y unused, b=z).
  const u = rig.mat.uniforms.uVel.value as Color;
  u.r = dampX;
  u.g = 0;
  u.b = dampZ;
  rig.mat.uniforms.uTime.value = now;
}

// ─── Scythe sweep trail ──────────────────────────────────────────────────
// Manual additive cone arc that follows the scythe blade during a windup.

export interface ScytheTrail {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  startTime: number;
  duration: number;
}

export function spawnScytheTrail(parent: Object3D, now: number): ScytheTrail {
  const mat = new MeshBasicMaterial({
    color: COLOR_CRIMSON,
    transparent: true,
    opacity: 0.0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  // A flat torus sliver as the swing ribbon.
  const geom = new ConeGeometry(2.4, 0.05, 8, 1, true);
  const mesh = new Mesh(geom, mat);
  mesh.rotation.x = Math.PI / 2;
  parent.add(mesh);
  return { mesh, mat, startTime: now, duration: 0.45 };
}

export function tickScytheTrail(trail: ScytheTrail, now: number): boolean {
  const t = (now - trail.startTime) / trail.duration;
  if (t >= 1) {
    trail.mesh.parent?.remove(trail.mesh);
    trail.mesh.geometry.dispose();
    trail.mat.dispose();
    return true;
  }
  // Quick bloom in/out.
  trail.mat.opacity = (t < 0.3 ? t / 0.3 : (1 - (t - 0.3) / 0.7)) * 0.65;
  trail.mesh.scale.setScalar(1 + t * 0.4);
  return false;
}
