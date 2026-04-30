// Bare boot: Three.js renderer + ECS world + Vibe Jam portal + multiplayer hub.
// No game logic yet — this is the scaffold to build the next game on top of.

import {
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { World } from './core/world';
import { initPortal } from './game/portal';
import { initMultiplayer } from './multiplayer';
import { gameState, type GameContext } from './game/state';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new Scene();
scene.background = new Color(0x0a0c14);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 14, 18);
camera.lookAt(0, 0, 0);

scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 0.8);
sun.position.set(20, 30, 10);
scene.add(sun);

// Placeholder ground so the scene is not empty. Replace when the new game lands.
const ground = new Mesh(
  new PlaneGeometry(120, 120),
  new MeshStandardMaterial({ color: 0x1a1f2c, roughness: 0.95, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const world = new World(scene);

const ctx: GameContext = { world, scene, camera, renderer, uiRoot, canvas, renderHook: null };

initPortal(ctx);
initMultiplayer(ctx);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
