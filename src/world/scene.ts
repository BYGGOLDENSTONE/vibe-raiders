import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  Fog,
  Color,
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
  BoxGeometry,
  Vector3,
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SphereGeometry,
  BackSide,
  ShaderMaterial,
} from 'three';

export interface SceneBundle {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  sun: DirectionalLight;
  resize: () => void;
}

const AMBER_HORIZON = new Color(0xff8a3c);
const AMBER_ZENITH = new Color(0x2d1a3a);
const SUN_COLOR = new Color(0xffd28a);
const FOG_COLOR = new Color(0xb8723a);

export function createSceneBundle(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color(0x1a0e06);
  scene.fog = new Fog(FOG_COLOR.getHex(), 40, 220);

  const camera = new PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 1.7, 0);

  const hemi = new HemisphereLight(AMBER_HORIZON.getHex(), 0x1a1428, 0.5);
  scene.add(hemi);

  const sun = new DirectionalLight(SUN_COLOR.getHex(), 1.4);
  sun.position.set(-60, 40, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  scene.add(makeSky());
  scene.add(makeGround());

  for (let i = 0; i < 12; i++) {
    const w = 2 + Math.random() * 4;
    const h = 1.5 + Math.random() * 6;
    const d = 2 + Math.random() * 4;
    const m = new Mesh(
      new BoxGeometry(w, h, d),
      new MeshStandardMaterial({ color: new Color().setHSL(0.07, 0.2, 0.18 + Math.random() * 0.12), roughness: 0.95 }),
    );
    const angle = (i / 12) * Math.PI * 2;
    const radius = 12 + Math.random() * 18;
    m.position.set(Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius);
    m.rotation.y = Math.random() * Math.PI;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, sun, resize };
}

function makeGround(): Mesh {
  const geom = new PlaneGeometry(500, 500, 1, 1);
  const mat = new MeshStandardMaterial({
    color: 0x3a2418,
    roughness: 1.0,
    metalness: 0.0,
  });
  const m = new Mesh(geom, mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

function makeSky(): Mesh {
  const geom = new SphereGeometry(400, 32, 16);
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uHorizon: { value: new Vector3(AMBER_HORIZON.r, AMBER_HORIZON.g, AMBER_HORIZON.b) },
      uZenith: { value: new Vector3(AMBER_ZENITH.r, AMBER_ZENITH.g, AMBER_ZENITH.b) },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      varying vec3 vWorldDir;
      void main() {
        float t = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
        t = pow(t, 0.6);
        vec3 col = mix(uHorizon, uZenith, t);
        // sun glow at low angles
        float glow = smoothstep(-0.05, 0.4, vWorldDir.y) * smoothstep(0.6, -0.1, vWorldDir.y);
        col += vec3(1.0, 0.55, 0.2) * glow * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new Mesh(geom, mat);
}
