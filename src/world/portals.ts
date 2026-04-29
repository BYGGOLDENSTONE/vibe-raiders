import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Object3D, Scene } from 'three';

export interface VibeJamPortalsOptions {
  scene: Scene;
  getPlayer: () => Object3D;
  spawnPoint?: { x: number; y: number; z: number };
  exitPosition?: { x: number; y: number; z: number };
  hostName?: string;
  selfName?: () => string | undefined;
  selfColor?: () => string | number | undefined;
  selfSpeed?: () => number | undefined;
}

export interface VibeJamPortals {
  update(dt: number): void;
  readonly arrivedViaPortal: boolean;
  readonly arrivalParams: URLSearchParams | null;
  dispose(): void;
}

interface PortalEntry {
  group: Group;
  particles: Points;
  particleGeom: BufferGeometry;
  box: Box3;
  kind: 'start' | 'exit';
}

const PORTAL_TRIGGER_DISTANCE = 50;

export function createVibeJamPortals(opts: VibeJamPortalsOptions): VibeJamPortals {
  const {
    scene,
    getPlayer,
    spawnPoint = { x: 0, y: 10, z: 0 },
    exitPosition = { x: 30, y: 10, z: 0 },
    hostName,
    selfName,
    selfColor,
    selfSpeed,
  } = opts;

  // Parse URL once.
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const portalFlag = params.get('portal');
  const arrivedViaPortal = portalFlag === 'true' || portalFlag === '1';
  const arrivalParams = arrivedViaPortal ? new URLSearchParams(params.toString()) : null;

  // 5s grace period from init time (start portal only).
  const startActivateAt = performance.now() + 5000;

  const portals: PortalEntry[] = [];
  const playerBox = new Box3();
  let redirecting = false;

  // Build exit portal (always).
  const exitPortal = buildPortal({
    color: 0x00ff00,
    label: 'VIBE JAM PORTAL',
  });
  exitPortal.group.position.set(exitPosition.x, exitPosition.y, exitPosition.z);
  scene.add(exitPortal.group);
  portals.push(exitPortal);

  // Build start portal (only if arrived via portal).
  if (arrivedViaPortal) {
    const startPortal = buildPortal({
      color: 0xff0000,
      label: null,
    });
    startPortal.group.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    scene.add(startPortal.group);
    portals.push(startPortal);
  }

  function update(_dt: number): void {
    if (redirecting) return;

    const t = performance.now() / 1000;
    const now = performance.now();

    // Animate particles for each portal.
    for (const p of portals) {
      const posAttr = p.particleGeom.getAttribute('position') as BufferAttribute;
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += 0.05 * Math.sin(t + i);
      }
      posAttr.needsUpdate = true;
    }

    // Player AABB (reused).
    const player = getPlayer();
    playerBox.setFromObject(player);
    const playerCenter = playerBox.getCenter(_tmpVec);

    for (const p of portals) {
      // Distance gate before doing intersection.
      const dx = p.group.position.x - playerCenter.x;
      const dy = p.group.position.y - playerCenter.y;
      const dz = p.group.position.z - playerCenter.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > PORTAL_TRIGGER_DISTANCE * PORTAL_TRIGGER_DISTANCE) continue;

      p.box.setFromObject(p.group);
      if (!playerBox.intersectsBox(p.box)) continue;

      if (p.kind === 'start') {
        if (now < startActivateAt) continue;
        triggerStartRedirect();
        return;
      } else {
        triggerExitRedirect();
        return;
      }
    }
  }

  function triggerStartRedirect(): void {
    if (!arrivalParams) return;
    const refRaw = arrivalParams.get('ref');
    if (!refRaw) return;
    const refUrl = /^https?:\/\//i.test(refRaw) ? refRaw : `https://${refRaw}`;

    // Carry forward all params except `ref`.
    const carry = new URLSearchParams();
    arrivalParams.forEach((value, key) => {
      if (key === 'ref') return;
      carry.append(key, value);
    });

    const target = carry.toString().length > 0 ? `${refUrl}?${carry.toString()}` : refUrl;
    redirecting = true;
    window.location.href = target;
  }

  function triggerExitRedirect(): void {
    const out = new URLSearchParams();
    // Start with current URL params so we forward whatever was passed in.
    new URL(window.location.href).searchParams.forEach((value, key) => {
      out.append(key, value);
    });
    out.set('portal', 'true');
    out.set('ref', hostName ?? window.location.hostname);

    const name = selfName?.();
    if (name !== undefined && name !== '') out.set('username', name);

    const color = selfColor?.();
    if (color !== undefined) out.set('color', normalizeColor(color));

    const speed = selfSpeed?.();
    if (speed !== undefined && Number.isFinite(speed)) out.set('speed', String(speed));

    redirecting = true;
    window.location.href = `https://vibej.am/portal/2026?${out.toString()}`;
  }

  function dispose(): void {
    for (const p of portals) {
      scene.remove(p.group);
      disposeGroup(p.group);
    }
    portals.length = 0;
  }

  return {
    update,
    get arrivedViaPortal() {
      return arrivedViaPortal;
    },
    get arrivalParams() {
      return arrivalParams;
    },
    dispose,
  };
}

// ---------------- helpers ----------------

const _tmpVec = new Vector3();

interface BuildPortalArgs {
  color: number;
  label: string | null;
}

function buildPortal({ color, label }: BuildPortalArgs): PortalEntry {
  const group = new Group();
  group.rotation.x = 0.35;

  // Torus ring.
  const torus = new Mesh(
    new TorusGeometry(15, 2, 16, 100),
    new MeshPhongMaterial({
      color,
      emissive: color,
      transparent: true,
      opacity: 0.8,
    }),
  );
  group.add(torus);

  // Inner disc.
  const disc = new Mesh(
    new CircleGeometry(13, 32),
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
    }),
  );
  group.add(disc);

  // Particle ring.
  const PARTICLE_COUNT = 1000;
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const baseColor = new Color(color);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 15 + (Math.random() - 0.5) * 4; // 15 ± 2
    const idx = i * 3;
    positions[idx] = Math.cos(angle) * r;
    positions[idx + 1] = Math.sin(angle) * r;
    positions[idx + 2] = (Math.random() - 0.5) * 4; // slight Z spread

    // Color jitter around base.
    colors[idx] = clamp01(baseColor.r + (Math.random() - 0.5) * 0.2);
    colors[idx + 1] = clamp01(baseColor.g + (Math.random() - 0.5) * 0.2);
    colors[idx + 2] = clamp01(baseColor.b + (Math.random() - 0.5) * 0.2);
  }
  const particleGeom = new BufferGeometry();
  particleGeom.setAttribute('position', new BufferAttribute(positions, 3));
  particleGeom.setAttribute('color', new BufferAttribute(colors, 3));
  const particles = new Points(
    particleGeom,
    new PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
    }),
  );
  group.add(particles);

  // Optional label (exit portal only).
  if (label !== null) {
    const labelMesh = makeLabel(label, color);
    if (labelMesh) {
      labelMesh.position.set(0, 20, 0);
      group.add(labelMesh);
    }
  }

  return {
    group,
    particles,
    particleGeom,
    box: new Box3(),
    kind: label === null ? 'start' : 'exit',
  };
}

function makeLabel(text: string, color: number): Mesh | null {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + new Color(color).getHexString();
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });
  return new Mesh(new PlaneGeometry(30, 5), mat);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function normalizeColor(c: string | number): string {
  if (typeof c === 'number') return '#' + new Color(c).getHexString();
  return c;
}

function disposeGroup(group: Group): void {
  group.traverse((child) => {
    const anyChild = child as unknown as {
      geometry?: { dispose?: () => void };
      material?:
        | { dispose?: () => void; map?: { dispose?: () => void } }
        | Array<{ dispose?: () => void; map?: { dispose?: () => void } }>;
    };
    if (anyChild.geometry?.dispose) anyChild.geometry.dispose();
    const mat = anyChild.material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        m.map?.dispose?.();
        m.dispose?.();
      }
    } else if (mat) {
      mat.map?.dispose?.();
      mat.dispose?.();
    }
  });
}
