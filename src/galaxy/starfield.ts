import * as THREE from 'three';
import { Rng } from './rng';
import { NEBULA_VERT, NEBULA_FRAG } from './shaders';
import { buildDistantGalaxies, type DistantGalaxiesHandle } from './distant-galaxies';

export interface BackgroundHandle {
  skydome: THREE.Mesh;
  starLayers: THREE.Points[];
  distantGalaxies: DistantGalaxiesHandle;
}

function buildStarLayer(count: number, radius: number, sizeMin: number, sizeMax: number, seed: number): THREE.Points {
  const rng = new Rng(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // uniform on sphere
    const u = rng.next();
    const v = rng.next();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.85 + rng.next() * 0.15);
    pos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);

    // slight color variation: pale blue/white/yellow tints
    const tint = rng.next();
    let cr = 1.0, cg = 1.0, cb = 1.0;
    if (tint < 0.2) { cr = 0.85; cg = 0.9; cb = 1.0; }
    else if (tint < 0.5) { cr = 1.0; cg = 0.95; cb = 0.85; }
    else if (tint < 0.6) { cr = 1.0; cg = 0.7; cb = 0.6; }
    const b = 0.55 + rng.next() * 0.45;
    col[i * 3 + 0] = cr * b;
    col[i * 3 + 1] = cg * b;
    col[i * 3 + 2] = cb * b;

    size[i] = sizeMin + rng.next() * (sizeMax - sizeMin);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        // sharper core
        a = pow(a, 2.0);
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geo, mat);
}

export function buildBackground(): BackgroundHandle {
  // W9 — skydome scaled 24k → 70k so the 28k galaxy disk has room to breathe
  // inside the nebula. Star layers shifted in step.
  const skyGeo = new THREE.SphereGeometry(70000, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skydome = new THREE.Mesh(skyGeo, skyMat);
  skydome.frustumCulled = false;

  const starLayers = [
    buildStarLayer(3200, 55000, 1.0, 2.4, 991),  // far
    buildStarLayer(1600, 40000, 1.4, 3.0, 7311), // mid
    buildStarLayer(700,  28000, 1.6, 3.8, 1029), // near
  ];

  const distantGalaxies = buildDistantGalaxies();

  return { skydome, starLayers, distantGalaxies };
}
