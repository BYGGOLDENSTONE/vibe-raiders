// Sanity-check bootstrap: Three.js + ECS-lite. Renders a rotating cube so we can
// confirm the renderer, animation loop, and World tick are all wired up.
// Replace this with the real game entry once the design is locked.

import { BoxGeometry, Clock, Color, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer, AmbientLight, DirectionalLight, Object3D, Vector3 } from 'three';
import { World } from './core/world';
import { createEntity, setComponent } from './core/entity';
import { C, type TransformComponent } from './core/components';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const boot = document.getElementById('boot');

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new Scene();
scene.background = new Color(0x101418);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 6);
camera.lookAt(0, 0, 0);

scene.add(new AmbientLight(0xffffff, 0.4));
const dir = new DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 10, 7);
scene.add(dir);

const world = new World(scene);

const cubeMesh = new Mesh(
  new BoxGeometry(1, 1, 1),
  new MeshStandardMaterial({ color: 0x6ea0ff }),
);
const cube = createEntity({ object3d: cubeMesh, tags: ['cube'] });
setComponent<TransformComponent>(cube, C.Transform, { velocity: new Vector3(), grounded: true });
world.spawn(cube);

world.addSystem((w) => {
  for (const e of w.query('cube')) {
    e.object3d.rotation.x += 0.01;
    e.object3d.rotation.y += 0.013;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (boot) boot.style.display = 'none';

const clock = new Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  world.tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

// Touch unused import so erasable-syntax-only tsconfig stays happy if Object3D ever drops out.
void Object3D;
