// Boot: Three.js renderer + ECS world + Vibe Jam portal + multiplayer hub + game init hook.
//
// Wave 0 changes:
//   - renderer configured for postprocessing (antialias off, NoToneMapping, SRGB).
//   - composer wired via initGame -> ctx.renderHook.
//   - resize forwards to ctx.resizeHook so the composer follows window changes.
//   - ground plane stays as a low-key reference until Wave 1 replaces it with the galaxy.

import {
  Clock,
  Color,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { World } from './core/world';
import { initPortal } from './game/portal';
import { initMultiplayer } from './multiplayer';
import { gameState, type GameContext } from './game/state';
import { initGame } from './game/initGame';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

// Renderer tuned for pmndrs/postprocessing. SMAA covers AA; built-in MSAA
// would conflict with the merged effect pass.
const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
renderer.setClearColor(0x000005, 1);

const scene = new Scene();
scene.background = new Color(0x000005);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 14, 18);
camera.lookAt(0, 0, 0);

// Hemisphere light is the placeholder global fill; planets / wormhole bring their
// own emissive shading so this stays subtle.
scene.add(new HemisphereLight(0x6677aa, 0x111118, 0.6));

// Placeholder ground so the boot screen has something at scale until Wave 1.
const ground = new Mesh(
  new PlaneGeometry(120, 120),
  new MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.95, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const world = new World(scene);

const ctx: GameContext = {
  world, scene, camera, renderer, uiRoot, canvas,
  renderHook: null,
  resizeHook: null,
};

initGame(ctx);
initPortal(ctx);
initMultiplayer(ctx);

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  ctx.resizeHook?.(w, h);
});

const clock = new Clock();
function loop(): void {
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = rawDt * gameState.timeScale;
  world.tick(dt);
  if (ctx.renderHook) ctx.renderHook();
  else renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
