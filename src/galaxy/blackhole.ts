import * as THREE from 'three';
import { DISK_VERT, DISK_FRAG, GLOW_VERT, GLOW_FRAG } from './shaders';

export interface BlackHoleHandle {
  group: THREE.Group;
  diskMaterial: THREE.ShaderMaterial;
  haloMesh: THREE.Mesh;
}

export function makeBlackHole(): BlackHoleHandle {
  const group = new THREE.Group();
  const inner = 160.0;
  const outer = 900.0;

  // Black core (slightly larger than inner radius to occlude what's behind)
  const coreGeo = new THREE.SphereGeometry(inner * 0.9, 48, 48);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

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

  return { group, diskMaterial: diskMat, haloMesh: halo };
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
