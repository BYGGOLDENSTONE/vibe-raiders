import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  Fog,
  Color,
  Mesh,
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
  hemi: HemisphereLight;
  fog: Fog;
  skyUniforms: {
    uHorizon: { value: Vector3 };
    uZenith: { value: Vector3 };
    uSunGlow: { value: Vector3 };
    uSunGlowStrength: { value: number };
  };
  resize: () => void;
}

export function createSceneBundle(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = new Color(0x1a0e06);
  // Fog tuned for the 400×400 m world. Atmosphere phases override these.
  const fog = new Fog(0xb8723a, 40, 380);
  scene.fog = fog;

  const camera = new PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1500);
  camera.position.set(0, 1.7, 0);

  const hemi = new HemisphereLight(0xff8a3c, 0x4a3850, 0.95);
  scene.add(hemi);

  const sun = new DirectionalLight(0xffd28a, 1.6);
  sun.position.set(-100, 80, -60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const { mesh: sky, uniforms: skyUniforms } = makeSky();
  scene.add(sky);

  // Ground is now provided by the world generator (heightmap mesh).

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, sun, hemi, fog, skyUniforms, resize };
}

function makeSky(): { mesh: Mesh; uniforms: SceneBundle['skyUniforms'] } {
  const geom = new SphereGeometry(1000, 32, 16);
  const horizonCol = new Color(0xff8a3c);
  const zenithCol = new Color(0x2d1a3a);
  const glowCol = new Color(0xff8c33);
  const uniforms = {
    uHorizon: { value: new Vector3(horizonCol.r, horizonCol.g, horizonCol.b) },
    uZenith: { value: new Vector3(zenithCol.r, zenithCol.g, zenithCol.b) },
    uSunGlow: { value: new Vector3(glowCol.r, glowCol.g, glowCol.b) },
    uSunGlowStrength: { value: 0.35 },
  };
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms,
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
      uniform vec3 uSunGlow;
      uniform float uSunGlowStrength;
      varying vec3 vWorldDir;
      void main() {
        float t = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
        t = pow(t, 0.6);
        vec3 col = mix(uHorizon, uZenith, t);
        float glow = smoothstep(-0.05, 0.4, vWorldDir.y) * smoothstep(0.6, -0.1, vWorldDir.y);
        col += uSunGlow * glow * uSunGlowStrength;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return { mesh: new Mesh(geom, mat), uniforms };
}
