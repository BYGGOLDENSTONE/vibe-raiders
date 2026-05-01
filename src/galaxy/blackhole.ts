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

export function makeBlackHole(): BlackHoleHandle {
  const group = new THREE.Group();
  // W9 — supermassive scale-up to match the 28k galaxy disk. Disk inner/outer
  // grew ~2.7×; the rest (core sphere, halo) follows the same ratios as before.
  const inner = 400.0;
  const outer = 2400.0;

  // Black core (slightly larger than inner radius to occlude what's behind)
  const coreGeo = new THREE.SphereGeometry(inner * 0.9, 48, 48);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  // Portal pick proxy — invisible sphere ~2× the core, so even at galaxy
  // overview distance the click target is comfortable to hit.
  const proxyGeo = new THREE.SphereGeometry(inner * 1.6, 16, 16);
  const proxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const portalPickProxy = new THREE.Mesh(proxyGeo, proxyMat);
  portalPickProxy.userData.kind = 'portal';
  group.add(portalPickProxy);

  // Accretion disk: ring geometry on XY plane (we will tilt the group)
  const diskGeo = new THREE.RingGeometry(inner, outer, 256, 32);
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
