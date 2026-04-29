import { Clock } from 'three';
import { World } from './core/world';
import { createSceneBundle } from './world/scene';
import { createAtmosphere, PHASES } from './world/atmosphere';
import { generateWorld } from './world/map';
import { createFpsController } from './systems/fps-controller';
import { createLocalPlayer } from './entities/player';
import { createDebugPanel, dbgRow, dbgBar } from './ui/debug';
import { createPostPipeline } from './render/post';
import { C, type TransformComponent, type HealthComponent, type WeaponComponent, type BackpackComponent } from './core/components';
import { getComponent } from './core/entity';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const boot = document.getElementById('boot');

const bundle = createSceneBundle(canvas);
const { renderer, scene, camera } = bundle;

const post = createPostPipeline({ renderer, scene, camera });

const onResize = () => post.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', onResize);

const atmosphere = createAtmosphere(bundle);

const CITY_SEED = Math.floor(Math.random() * 1_000_000);
const worldMap = generateWorld({ scene, seed: CITY_SEED });

// Pick a random shelter as the spawn position. Y is sampled from the heightmap.
const spawnShelter = worldMap.shelters[Math.floor(Math.random() * worldMap.shelters.length)];
const spawnPos = {
  x: spawnShelter.position[0],
  y: worldMap.groundHeight(spawnShelter.position[0], spawnShelter.position[2]),
  z: spawnShelter.position[2],
};

const world = new World(scene);
const player = createLocalPlayer({ spawn: spawnPos });
world.spawn(player);

const fps = createFpsController({
  camera,
  domElement: canvas,
  player,
  colliders: worldMap.colliders,
  worldHalfSize: 200,
  getGroundHeight: worldMap.groundHeight,
});

const debug = createDebugPanel({ enabled: import.meta.env.DEV });

let atmosphereTimeScale = 1;
let atmospherePaused = false;

debug.addKey({
  key: 'KeyB',
  label: 'next phase',
  group: 'atmosphere',
  fn: () => {
    let t = atmosphereTimeRef;
    let cursor = t % atmosphere.totalCycleSec();
    for (const p of PHASES) {
      if (cursor < p.durationSec) { t += (p.durationSec - cursor) + 0.001; break; }
      cursor -= p.durationSec;
    }
    atmosphere.setTime(t);
    atmosphereTimeRef = t;
  },
});
debug.addKey({ key: 'KeyP', label: 'pause cycle', group: 'atmosphere', fn: () => { atmospherePaused = !atmospherePaused; } });
debug.addKey({ key: 'BracketLeft', label: 'slow ÷2', group: 'atmosphere', fn: () => { atmosphereTimeScale = Math.max(0.125, atmosphereTimeScale / 2); } });
debug.addKey({ key: 'BracketRight', label: 'fast ×2', group: 'atmosphere', fn: () => { atmosphereTimeScale = Math.min(64, atmosphereTimeScale * 2); } });
debug.addKey({ key: 'KeyR', label: 'reset cycle', group: 'atmosphere', fn: () => { atmosphere.setTime(0); atmosphereTimeRef = 0; atmosphereTimeScale = 1; atmospherePaused = false; } });

debug.addKey({
  key: 'KeyN',
  label: 'toggle post-fx',
  group: 'render',
  fn: () => { post.setEnabled(!post.isEnabled()); },
});

debug.addKey({
  key: 'KeyT',
  label: 'tp to next shelter',
  group: 'world',
  fn: () => {
    const idx = (worldMap.shelters.findIndex(s => Math.abs(s.position[0] - player.object3d.position.x) < 5 && Math.abs(s.position[2] - player.object3d.position.z) < 5) + 1) % worldMap.shelters.length;
    const s = worldMap.shelters[idx];
    player.object3d.position.set(s.position[0], worldMap.groundHeight(s.position[0], s.position[2]), s.position[2]);
    const t = getComponent<TransformComponent>(player, C.Transform);
    if (t) t.velocity.set(0, 0, 0);
  },
});

let atmosphereTimeRef = 0;

let fpsAccum = 0; let fpsFrames = 0; let fpsValue = 0;

debug.addSection({
  id: 'perf',
  title: 'PERF',
  order: 0,
  render: () => {
    const ms = fpsValue > 0 ? (1000 / fpsValue).toFixed(1) : '—';
    return dbgRow('fps', fpsValue.toFixed(0)) + dbgRow('ms', ms);
  },
});

debug.addSection({
  id: 'atmosphere',
  title: 'ATMOSPHERE',
  order: 1,
  render: () => {
    const total = atmosphere.totalCycleSec();
    const cursor = atmosphereTimeRef % total;
    let phaseIdx = 0; let phaseStart = 0; let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      if (cursor < acc + PHASES[i].durationSec) { phaseIdx = i; phaseStart = acc; break; }
      acc += PHASES[i].durationSec;
    }
    const phase = PHASES[phaseIdx];
    const into = cursor - phaseStart;
    const remaining = phase.durationSec - into;
    return (
      dbgRow('phase', phase.name) +
      dbgRow('next in', `${remaining.toFixed(0)}s`) +
      dbgBar(into / phase.durationSec) +
      dbgRow('scale', atmospherePaused ? 'PAUSED' : `${atmosphereTimeScale}×`)
    );
  },
});

debug.addSection({
  id: 'player',
  title: 'PLAYER',
  order: 2,
  render: () => {
    const t = getComponent<TransformComponent>(player, C.Transform);
    const h = getComponent<HealthComponent>(player, C.Health);
    const w = getComponent<WeaponComponent>(player, C.Weapon);
    const b = getComponent<BackpackComponent>(player, C.Backpack);
    const p = player.object3d.position;
    return (
      dbgRow('xyz', `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`) +
      dbgRow('vel', t ? `${t.velocity.length().toFixed(1)} m/s` : '—') +
      dbgRow('grounded', t ? (t.grounded ? 'yes' : 'no') : '—') +
      dbgRow('hp', h ? `${h.current}/${h.max}` : '—') +
      dbgRow('ammo', w ? `${w.magazine}/${w.reserve}` : '—') +
      dbgRow('bag', b ? `${b.weightKg.toFixed(1)}/${b.capacityKg}kg` : '—')
    );
  },
});

debug.addSection({
  id: 'world',
  title: 'WORLD',
  order: 3,
  render: () => {
    return (
      dbgRow('seed', String(CITY_SEED)) +
      dbgRow('shelters', String(worldMap.shelters.length)) +
      dbgRow('colliders', String(worldMap.colliders.length)) +
      dbgRow('landmarks', String(worldMap.landmarks.length))
    );
  },
});

debug.setStatus('dev');

boot?.addEventListener('click', () => { fps.requestLock(); });

const onLockChange = () => {
  if (!boot) return;
  boot.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
};
document.addEventListener('pointerlockchange', onLockChange);

const clock = new Clock();
let elapsed = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (!atmospherePaused) {
    const scaled = dt * atmosphereTimeScale;
    atmosphere.update(scaled);
    atmosphereTimeRef += scaled;
  }

  worldMap.update?.(elapsed);

  fps.update(dt);
  world.tick(dt);
  post.render();

  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) { fpsValue = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }

  debug.update(dt);

  requestAnimationFrame(loop);
}
loop();
