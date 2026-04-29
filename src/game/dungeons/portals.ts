// Portal arch + animated swirling disc + DOM label.
// Used for entry (open-world side) and exit (dungeon side).

import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  TorusGeometry,
  Vector3,
  type Camera,
  DoubleSide,
} from 'three';

export type PortalState = 'active' | 'inactive';

export interface PortalRig {
  group: Group;
  // Inner swirling disc — rotates per frame.
  disc: Mesh;
  // Outer ring (also spins, opposite direction).
  outerRing: Mesh;
  // Light at the center.
  light: PointLight;
  // The clickable / proximity hitbox sphere position is just group.position.
  // Glyph emissives we can pulse.
  glyphMats: MeshStandardMaterial[];
  // The materials whose color we tint when inactive.
  tintMats: MeshStandardMaterial[];
  // Active flag — controls intensity / interaction.
  state: PortalState;
  // Tint hex used for the active palette.
  activeColor: number;
  // World position (cache).
  worldPos: Vector3;
  // DOM label element.
  label: HTMLDivElement;
  // Display name.
  name: string;
}

export interface PortalOpts {
  position: Vector3;
  // Color tint of the swirl/glyphs.
  color: number;
  // Display name (label above the arch).
  name: string;
  // Initial state.
  state: PortalState;
  // Optional rotation around Y axis (radians) so arches face the player.
  facingY?: number;
}

export function buildPortal(opts: PortalOpts, uiRoot: HTMLElement): PortalRig {
  const group = new Group();
  group.name = `portal-${opts.name}`;
  group.position.copy(opts.position);
  if (opts.facingY !== undefined) group.rotation.y = opts.facingY;

  const stoneMat = new MeshStandardMaterial({ color: 0x2a2530, roughness: 0.95, metalness: 0.05 });
  const tintMats: MeshStandardMaterial[] = [];
  const glyphMats: MeshStandardMaterial[] = [];

  // Pillars: 2 vertical cylinders.
  const pillarH = 4.0;
  const pillarR = 0.32;
  const pillarSpacing = 1.6;
  for (const side of [-1, 1]) {
    const p = new Mesh(new CylinderGeometry(pillarR, pillarR * 1.15, pillarH, 12), stoneMat);
    p.position.set(side * pillarSpacing, pillarH / 2, 0);
    group.add(p);

    // Eldritch glyph emissive bands on each pillar (3 small rings).
    for (let i = 0; i < 3; i++) {
      const glyphMat = new MeshStandardMaterial({
        color: opts.color,
        emissive: opts.color,
        emissiveIntensity: opts.state === 'active' ? 1.2 : 0.05,
        roughness: 0.5,
        metalness: 0.2,
      });
      glyphMats.push(glyphMat);
      tintMats.push(glyphMat);
      const band = new Mesh(new TorusGeometry(pillarR + 0.06, 0.04, 6, 16), glyphMat);
      band.position.set(side * pillarSpacing, 0.7 + i * 1.2, 0);
      band.rotation.x = Math.PI / 2;
      group.add(band);
    }
  }

  // Curved top (half-torus arch) bridging the two pillars.
  const archMat = new MeshStandardMaterial({
    color: 0x35303a,
    roughness: 0.85,
    metalness: 0.1,
  });
  const arch = new Mesh(
    new TorusGeometry(pillarSpacing, 0.32, 8, 24, Math.PI),
    archMat,
  );
  arch.position.set(0, pillarH, 0);
  arch.rotation.z = 0;
  group.add(arch);

  // Keystone glyph at top.
  const keystoneMat = new MeshStandardMaterial({
    color: opts.color,
    emissive: opts.color,
    emissiveIntensity: opts.state === 'active' ? 1.6 : 0.08,
    roughness: 0.4,
    metalness: 0.3,
  });
  glyphMats.push(keystoneMat);
  tintMats.push(keystoneMat);
  const keystone = new Mesh(new TorusGeometry(0.22, 0.06, 6, 16), keystoneMat);
  keystone.position.set(0, pillarH + pillarSpacing - 0.1, 0);
  group.add(keystone);

  // Inner swirling disc (flat circle facing +Z).
  const discMat = new MeshStandardMaterial({
    color: opts.color,
    emissive: opts.color,
    emissiveIntensity: opts.state === 'active' ? 1.8 : 0.1,
    roughness: 0.4,
    metalness: 0.0,
    transparent: true,
    opacity: opts.state === 'active' ? 0.85 : 0.25,
    side: DoubleSide,
  });
  tintMats.push(discMat);
  const discRadius = pillarSpacing - 0.2;
  const disc = new Mesh(new RingGeometry(0.2, discRadius, 32, 4), discMat);
  disc.position.set(0, pillarH / 2 + 0.4, 0);
  group.add(disc);

  // Outer ring sweep — slightly larger ring with a gap pattern.
  const outerMat = new MeshStandardMaterial({
    color: opts.color,
    emissive: opts.color,
    emissiveIntensity: opts.state === 'active' ? 2.2 : 0.1,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: opts.state === 'active' ? 0.95 : 0.3,
    side: DoubleSide,
  });
  tintMats.push(outerMat);
  const outerRing = new Mesh(
    new RingGeometry(discRadius * 0.9, discRadius * 1.05, 24, 1, 0, Math.PI * 1.5),
    outerMat,
  );
  outerRing.position.set(0, pillarH / 2 + 0.4, 0.02);
  group.add(outerRing);

  // Center light.
  const light = new PointLight(opts.color, opts.state === 'active' ? 3.0 : 0.4, 12, 1.6);
  light.position.set(0, pillarH / 2 + 0.4, 0);
  group.add(light);

  // DOM label.
  const label = document.createElement('div');
  label.textContent = opts.name;
  label.style.cssText = [
    'position: absolute',
    'pointer-events: none',
    'left: 0',
    'top: 0',
    'transform: translate(-50%, -100%)',
    'color: #f0e0d0',
    'font-family: "Trajan Pro", "Cinzel", Georgia, serif',
    'font-weight: 700',
    'font-size: 14px',
    'letter-spacing: 0.18em',
    'text-shadow: 0 0 6px rgba(0,0,0,0.9), 0 0 12px ' + cssRgbA(opts.color, 0.7),
    'white-space: nowrap',
    'opacity: ' + (opts.state === 'active' ? '1' : '0.4'),
    'transition: opacity 0.4s ease',
    'z-index: 5',
  ].join(';');
  uiRoot.appendChild(label);

  const rig: PortalRig = {
    group,
    disc,
    outerRing,
    light,
    glyphMats,
    tintMats,
    state: opts.state,
    activeColor: opts.color,
    worldPos: opts.position.clone(),
    label,
    name: opts.name,
  };
  return rig;
}

export function setPortalState(rig: PortalRig, state: PortalState): void {
  if (rig.state === state) return;
  rig.state = state;
  const active = state === 'active';
  for (const m of rig.glyphMats) m.emissiveIntensity = active ? 1.4 : 0.06;
  // Disc/outer (last two items pushed) — find by reference instead.
  for (const m of rig.tintMats) {
    if (m.transparent) {
      m.opacity = active ? 0.9 : 0.28;
      m.emissiveIntensity = active ? 2.0 : 0.1;
    }
  }
  rig.light.intensity = active ? 3.0 : 0.4;
  rig.label.style.opacity = active ? '1' : '0.4';
}

export function tickPortal(rig: PortalRig, elapsed: number, dt: number): void {
  // Spin disc and outer ring.
  rig.disc.rotation.z += dt * (rig.state === 'active' ? 1.4 : 0.4);
  rig.outerRing.rotation.z -= dt * (rig.state === 'active' ? 2.2 : 0.6);

  // Pulse glyphs.
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4);
  const base = rig.state === 'active' ? 1.0 : 0.05;
  const span = rig.state === 'active' ? 0.7 : 0.05;
  for (const m of rig.glyphMats) {
    m.emissiveIntensity = base + pulse * span;
  }
}

export function updatePortalLabel(
  rig: PortalRig,
  camera: Camera,
  canvas: HTMLCanvasElement,
): void {
  // Project world position above the arch into screen space.
  const worldHead = new Vector3(0, 4.8, 0).add(rig.worldPos);
  const ndc = worldHead.clone().project(camera);
  // ndc range -1..1; behind camera if z>1.
  if (ndc.z > 1) {
    rig.label.style.display = 'none';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = (ndc.x * 0.5 + 0.5) * rect.width + rect.left;
  const y = (-ndc.y * 0.5 + 0.5) * rect.height + rect.top;
  rig.label.style.display = 'block';
  rig.label.style.left = `${x}px`;
  rig.label.style.top = `${y}px`;
}

export function disposePortal(rig: PortalRig): void {
  rig.label.remove();
  rig.group.parent?.remove(rig.group);
  rig.group.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      const m = o.material as MeshStandardMaterial | MeshStandardMaterial[];
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m.dispose();
    }
  });
}

function cssRgbA(hex: number, a: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}
