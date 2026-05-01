import * as THREE from 'three';
import { DISK_VERT, DISK_FRAG, GLOW_VERT, GLOW_FRAG } from './shaders';

export interface BlackHoleHandle {
  group: THREE.Group;
  diskMaterial: THREE.ShaderMaterial;
  haloMesh: THREE.Mesh;
  // W6-H: an invisible, larger sphere wrapping the visible core so the Vibe
  // Jam outgoing portal (clicking the black hole) has a generous hit area
  // even when the camera is zoomed way out. Tagged with userData.kind='portal'
  // so the picker can recognise it.
  portalPickProxy: THREE.Mesh;
}

// W10 — every galaxy gets a black hole, scaled to its disc radius. Ratios
// pulled from the Milky Way preset (radius 28k → inner 400, outer 2400):
//   inner ≈ radius × 0.0143
//   outer ≈ radius × 0.0857
// A 9k-radius satellite galaxy gets inner ≈ 130, outer ≈ 770 — proportional.
export function makeBlackHole(galaxyRadius = 28000): BlackHoleHandle {
  const group = new THREE.Group();
  const inner = galaxyRadius * 0.0143;
  const outer = galaxyRadius * 0.0857;

  // Black core (slightly larger than inner radius to occlude what's behind).
  // W10 perf — 48×48 → 24×24 since the core renders as a flat black disc anyway.
  const coreGeo = new THREE.SphereGeometry(inner * 0.9, 24, 24);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // Portal pick proxy — invisible sphere ~2× the core, so even at galaxy
  // overview distance the click target is comfortable to hit.
  const proxyGeo = new THREE.SphereGeometry(inner * 1.6, 12, 12);
  const proxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const portalPickProxy = new THREE.Mesh(proxyGeo, proxyMat);
  portalPickProxy.userData.kind = 'portal';
  group.add(portalPickProxy);

  // Accretion disk: ring geometry on XY plane (we will tilt the group).
  // W10 perf — 256×32 → 96×8. Disk colour comes from a fragment shader so
  // higher tessellation only mattered for shape silhouette; 96 segs keep the
  // ring edge smooth at the camera distances we care about.
  const diskGeo = new THREE.RingGeometry(inner, outer, 96, 8);
  const diskMat = new THREE.ShaderMaterial({
    vertexShader: DISK_VERT,
    fragmentShader: DISK_FRAG,
    uniforms: {
      uTime:  { value: 0 },
      uInner: { value: inner },
      uOuter: { value: outer },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const disk = new THREE.Mesh(diskGeo, diskMat);
  group.add(disk);

  // Halo billboard for "lensing" suggestion
  const haloMat = new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      uColor:     { value: new THREE.Color(1.0, 0.82, 0.55) },
      uIntensity: { value: 2.2 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMat);
  halo.scale.setScalar(outer * 1.8);
  group.add(halo);

  // Tilt the whole black hole so the disk is angled
  group.rotation.x = -Math.PI / 2 + 0.18;

  return { group, diskMaterial: diskMat, haloMesh: halo, portalPickProxy };
}

export function updateBlackHole(
  h: BlackHoleHandle,
  dt: number,
  cameraPos: THREE.Vector3,
): void {
  h.diskMaterial.uniforms.uTime.value += dt;
  // halo billboards toward camera (in world space — convert)
  h.haloMesh.lookAt(cameraPos);
}
