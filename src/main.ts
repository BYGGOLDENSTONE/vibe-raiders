// DUSK — gothic action RPG, browser-native, multiplayer-ready.
// Boots Three.js + ECS-lite world, then hands control to the per-module init functions.

import { Clock, Color, FogExp2, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { World } from './core/world';
import { initWorld } from './game/world';
import { initPlayer } from './game/player';
import { initCamera } from './game/camera';
import { initInput } from './game/input';
import { initCombat } from './game/combat';
import { initSkills } from './game/skills';
import { initMobs } from './game/mobs';
import { initLoot } from './game/loot';
import { initInventory } from './game/inventory';
import { initUI } from './game/ui';
import { initFx } from './game/fx';
import { initAudio } from './game/audio';
import { initDungeons } from './game/dungeons';
import { initBoss } from './game/boss';
import { initPortal } from './game/portal';
import { initMultiplayer } from './multiplayer';
import { COLORS } from './game/constants';
import { gameState, type GameContext } from './game/state';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
const boot = document.getElementById('boot');

const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new Scene();
scene.background = new Color(COLORS.bgFog);
scene.fog = new FogExp2(COLORS.bgFog, 0.012);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);

const world = new World(scene);

const ctx: GameContext = { world, scene, camera, renderer, uiRoot, canvas, renderHook: null };

initWorld(ctx);
initPlayer(ctx);
initCamera(ctx);
initInput(ctx);
initCombat(ctx);
initSkills(ctx);
initMobs(ctx);
initLoot(ctx);
initInventory(ctx);
initUI(ctx);
initFx(ctx);
initAudio(ctx);
initDungeons(ctx);
initBoss(ctx);
initPortal(ctx);
initMultiplayer(ctx);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (boot) boot.style.display = 'none';

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
