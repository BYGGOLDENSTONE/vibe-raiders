import { Clock } from 'three';
import { World } from './core/world';
import { createSceneBundle } from './world/scene';
import { createFpsController } from './systems/fps-controller';
import { createLocalPlayer } from './entities/player';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const boot = document.getElementById('boot');

const { renderer, scene, camera } = createSceneBundle(canvas);

const world = new World(scene);
const player = createLocalPlayer({ spawn: { x: 0, y: 0, z: 8 } });
world.spawn(player);

const fps = createFpsController({
  camera,
  domElement: canvas,
  player,
});

boot?.addEventListener('click', () => {
  fps.requestLock();
});

const onLockChange = () => {
  if (!boot) return;
  boot.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
};
document.addEventListener('pointerlockchange', onLockChange);

const clock = new Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  fps.update(dt);
  world.tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
