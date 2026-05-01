import * as THREE from 'three';
import type { SystemData } from './types';
import { STAR_VERT, STAR_FRAG, GLOW_VERT, GLOW_FRAG } from './shaders';

export interface StarHandle {
  data: SystemData;
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  pickProxy: THREE.Mesh; // invisible large sphere for galaxy-view picking
  material: THREE.ShaderMaterial;
  color: THREE.Color;
}

// Shared geometries — same shape across all stars, only scale differs.
// W10 perf — core sphere reduced 32×32 (1024 verts) → 16×16 (256 verts) since
// the active galaxy renders 200 of these every frame in galaxy view.
const STAR_CORE_GEO = new THREE.SphereGeometry(1, 16, 16);
const STAR_GLOW_GEO = new THREE.PlaneGeometry(1, 1);
const STAR_PICK_GEO = new THREE.SphereGeometry(1, 8, 6);

export function makeStar(data: SystemData): StarHandle {
  const group = new THREE.Group();

  const color = new THREE.Color(...data.starColor);

  const coreGeo = STAR_CORE_GEO;
  const coreMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: color.clone() },
    },
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.scale.setScalar(data.starRadius);
  core.userData = { kind: 'star', systemId: data.id };
  // W10 perf — start hidden; setSystemDetail(true) reveals the full sphere
  // when the player enters system view. Galaxy view renders a single shared
  // Points cloud per galaxy instead of 200 sphere meshes.
  core.visible = false;
  group.add(core);

  // Billboard glow plane (always faces camera via onBeforeRender)
  const glowGeo = STAR_GLOW_GEO;
  const glowMat = new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      uColor:     { value: color.clone() },
      uIntensity: { value: 1.4 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.scale.setScalar(data.starRadius * 8.0);
  glow.userData = { kind: 'star-glow', systemId: data.id };
  glow.visible = false;
  group.add(glow);

  // Invisible pick proxy — large enough to be hittable from far away
  const pickGeo = STAR_PICK_GEO;
  const pickMat = new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false });
  const pickProxy = new THREE.Mesh(pickGeo, pickMat);
  pickProxy.scale.setScalar(data.starRadius * 4.5);
  pickProxy.userData = { kind: 'star', systemId: data.id };
  group.add(pickProxy);

  return { data, group, core, glow, pickProxy, material: coreMat, color };
}

export function updateStar(
  h: StarHandle,
  dt: number,
  cameraPos: THREE.Vector3,
): void {
  // W10 perf — skip work entirely when the full star isn't visible (galaxy
  // view, where the points cloud takes over). Saves 200 lookAt + uniform
  // writes per frame in the active galaxy.
  if (!h.core.visible) return;
  h.material.uniforms.uTime.value += dt;
  h.glow.lookAt(cameraPos);
}
