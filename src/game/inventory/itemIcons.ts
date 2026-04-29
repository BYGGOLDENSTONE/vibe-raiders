// Offscreen Three.js renderer that produces tiny 3D item icons (64×64 PNG
// dataURLs) on demand. Each unique item gets a small mesh built from its
// name/slot, lit with a key/fill/rim setup, and rasterised into a canvas.
//
// Cache key = `${slot}:${nameHash}:${rarity}:${color}` so identical drop
// archetypes share an icon. Lazily initialised on first call to avoid the
// WebGL context cost when the inventory is never opened.

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  CylinderGeometry,
  ConeGeometry,
  SphereGeometry,
  TorusGeometry,
  Group,
  AmbientLight,
  DirectionalLight,
  PointLight,
  Color,
  Vector3,
  PCFSoftShadowMap,
} from 'three';
import type { ItemInstance, ItemRarity, ItemSlot } from '../../core/components';

interface IconRig {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  rimLight: PointLight;
}

let _rig: IconRig | null = null;
const _cache = new Map<string, string>();

function rig(): IconRig {
  if (_rig) return _rig;

  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(96, 96, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();

  // Lighting trio: warm key, cool fill, intense rim emissive point.
  const amb = new AmbientLight(0x404048, 0.6);
  scene.add(amb);

  const key = new DirectionalLight(0xfff0d8, 1.4);
  key.position.set(2, 3, 2.5);
  scene.add(key);

  const fill = new DirectionalLight(0x6080c0, 0.55);
  fill.position.set(-2.5, 1.2, -1.5);
  scene.add(fill);

  const rimLight = new PointLight(0xffe0a0, 1.2, 6, 1.2);
  rimLight.position.set(-1.6, 0.8, -2.2);
  scene.add(rimLight);

  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(2.0, 2.0, 2.6);
  camera.lookAt(0, 0, 0);

  _rig = { renderer, scene, camera, rimLight };
  return _rig;
}

// ─────────────────────────────────────────────────────────────────────────
// Geometry builders — each returns a Group sized to fit ~[-1,1] world space.
// The base color tints the dominant material; rarity adjusts emissive intensity.
// ─────────────────────────────────────────────────────────────────────────

function tone(c: number, mult: number): Color {
  const col = new Color(c);
  col.multiplyScalar(mult);
  return col;
}

function metalMat(color: number, emissiveBoost = 0.0): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    metalness: 0.85,
    roughness: 0.32,
    emissive: tone(color, emissiveBoost),
    emissiveIntensity: emissiveBoost > 0 ? 0.7 : 0,
  });
}
function leatherMat(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: tone(color, 0.4).getHex(),
    metalness: 0.05,
    roughness: 0.85,
  });
}
function gemMat(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    metalness: 0.3,
    roughness: 0.05,
    emissive: color,
    emissiveIntensity: 0.6,
  });
}

function buildSword(color: number, emissiveBoost: number): Group {
  const g = new Group();
  // Blade
  const blade = new Mesh(new BoxGeometry(0.16, 1.5, 0.04), metalMat(0xc8c8d0, emissiveBoost));
  blade.position.y = 0.45;
  g.add(blade);
  // Cross-guard
  const guard = new Mesh(new BoxGeometry(0.6, 0.08, 0.16), metalMat(color, emissiveBoost * 0.5));
  guard.position.y = -0.32;
  g.add(guard);
  // Handle
  const handle = new Mesh(new CylinderGeometry(0.07, 0.07, 0.45, 12), leatherMat(0x402810));
  handle.position.y = -0.6;
  g.add(handle);
  // Pommel
  const pommel = new Mesh(new SphereGeometry(0.1, 12, 10), metalMat(color, emissiveBoost));
  pommel.position.y = -0.88;
  g.add(pommel);
  g.rotation.z = -0.32;
  return g;
}

function buildAxe(color: number, emissiveBoost: number): Group {
  const g = new Group();
  // Handle
  const handle = new Mesh(new CylinderGeometry(0.07, 0.07, 1.5, 10), leatherMat(0x553010));
  handle.rotation.z = -0.25;
  g.add(handle);
  // Head: two cones blended into a wedge
  const headMat = metalMat(color, emissiveBoost);
  const wedge1 = new Mesh(new ConeGeometry(0.36, 0.7, 4), headMat);
  wedge1.position.set(0.34, 0.45, 0);
  wedge1.rotation.z = -1.55;
  g.add(wedge1);
  // Cap
  const cap = new Mesh(new SphereGeometry(0.08, 10, 8), metalMat(0x8a8a90, 0));
  cap.position.set(-0.32, -0.7, 0);
  g.add(cap);
  return g;
}

function buildStaff(color: number, emissiveBoost: number): Group {
  const g = new Group();
  const shaft = new Mesh(new CylinderGeometry(0.06, 0.06, 1.6, 10), leatherMat(0x402818));
  g.add(shaft);
  // Top emissive sphere
  const top = new Mesh(new SphereGeometry(0.18, 14, 12), gemMat(color));
  top.position.y = 0.92;
  g.add(top);
  // Decorative rings
  const ring = new Mesh(new TorusGeometry(0.12, 0.025, 8, 14), metalMat(0x8a7030, emissiveBoost));
  ring.position.y = 0.7;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.rotation.z = -0.18;
  return g;
}

function buildDagger(color: number, emissiveBoost: number): Group {
  const g = new Group();
  const blade = new Mesh(new BoxGeometry(0.12, 0.85, 0.03), metalMat(0xd0d0d8, emissiveBoost));
  blade.position.y = 0.35;
  g.add(blade);
  const guard = new Mesh(new BoxGeometry(0.32, 0.07, 0.12), metalMat(color, emissiveBoost * 0.5));
  guard.position.y = -0.1;
  g.add(guard);
  const handle = new Mesh(new CylinderGeometry(0.06, 0.06, 0.32, 10), leatherMat(0x301810));
  handle.position.y = -0.31;
  g.add(handle);
  g.rotation.z = -0.4;
  return g;
}

function buildMace(color: number, emissiveBoost: number): Group {
  const g = new Group();
  const handle = new Mesh(new CylinderGeometry(0.06, 0.06, 1.0, 10), leatherMat(0x402818));
  handle.position.y = -0.25;
  g.add(handle);
  const head = new Mesh(new SphereGeometry(0.32, 12, 12), metalMat(color, emissiveBoost));
  head.position.y = 0.45;
  g.add(head);
  // Studs (cheap proc spikes)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const stud = new Mesh(new ConeGeometry(0.05, 0.13, 6), metalMat(0xa0a0a8, 0));
    stud.position.set(Math.cos(a) * 0.32, 0.45, Math.sin(a) * 0.32);
    stud.lookAt(new Vector3(Math.cos(a) * 2, 0.45, Math.sin(a) * 2));
    stud.rotateX(Math.PI / 2);
    g.add(stud);
  }
  g.rotation.z = -0.3;
  return g;
}

function buildHelm(color: number, emissiveBoost: number): Group {
  const g = new Group();
  // Dome (sphere half)
  const dome = new Mesh(new SphereGeometry(0.55, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2 + 0.3),
    metalMat(color, emissiveBoost));
  dome.position.y = -0.05;
  g.add(dome);
  // Visor band
  const visor = new Mesh(new BoxGeometry(1.0, 0.18, 0.55), metalMat(0x202028, 0));
  visor.position.y = -0.2;
  g.add(visor);
  // Crest (vertical fin)
  const crest = new Mesh(new BoxGeometry(0.1, 0.45, 0.7), metalMat(color, emissiveBoost * 1.2));
  crest.position.y = 0.42;
  g.add(crest);
  return g;
}

function buildChest(color: number, emissiveBoost: number): Group {
  const g = new Group();
  // Torso plate (rounded box approximation: scaled box with bevel illusion)
  const plate = new Mesh(new BoxGeometry(1.1, 1.2, 0.5), metalMat(color, emissiveBoost));
  g.add(plate);
  // Pauldrons
  const pl = new Mesh(new SphereGeometry(0.3, 14, 10), metalMat(color, emissiveBoost));
  pl.position.set(-0.6, 0.5, 0);
  g.add(pl);
  const pr = new Mesh(new SphereGeometry(0.3, 14, 10), metalMat(color, emissiveBoost));
  pr.position.set(0.6, 0.5, 0);
  g.add(pr);
  // Trim accent
  const trim = new Mesh(new BoxGeometry(1.05, 0.08, 0.52), metalMat(0xc8a060, 0.4));
  trim.position.y = 0.58;
  g.add(trim);
  return g;
}

function buildAmulet(color: number, emissiveBoost: number): Group {
  const g = new Group();
  const chain = new Mesh(new TorusGeometry(0.55, 0.04, 8, 26), metalMat(0xc8a060, 0));
  chain.rotation.x = Math.PI / 2;
  g.add(chain);
  const setting = new Mesh(new TorusGeometry(0.18, 0.05, 8, 16), metalMat(0xc8a060, emissiveBoost));
  setting.position.y = -0.2;
  g.add(setting);
  const gem = new Mesh(new SphereGeometry(0.16, 14, 12), gemMat(color));
  gem.position.y = -0.2;
  g.add(gem);
  return g;
}

function buildRing(color: number, emissiveBoost: number): Group {
  const g = new Group();
  const band = new Mesh(new TorusGeometry(0.45, 0.09, 10, 26), metalMat(0xc8a060, emissiveBoost * 0.5));
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const gem = new Mesh(new SphereGeometry(0.18, 14, 12), gemMat(color));
  gem.position.y = 0.45;
  g.add(gem);
  return g;
}

function chooseWeaponShape(item: ItemInstance): 'sword' | 'axe' | 'staff' | 'dagger' | 'mace' {
  const n = item.name.toLowerCase();
  if (/staff|wand|rod|scepter/.test(n)) return 'staff';
  if (/dagger|knife|kris|shiv/.test(n)) return 'dagger';
  if (/axe|cleaver|hatchet/.test(n)) return 'axe';
  if (/mace|hammer|maul|club/.test(n)) return 'mace';
  return 'sword';
}

function chooseAccessoryShape(item: ItemInstance): 'amulet' | 'ring' {
  const n = item.name.toLowerCase();
  if (/ring|band|loop|signet/.test(n)) return 'ring';
  return 'amulet';
}

function buildItemMesh(item: ItemInstance): Group {
  const color = item.iconColor;
  const rarityBoost: Record<ItemRarity, number> = {
    common: 0,
    magic: 0.25,
    rare: 0.5,
    legendary: 0.9,
  };
  const boost = rarityBoost[item.rarity];

  switch (item.slot as ItemSlot) {
    case 'weapon': {
      const shape = chooseWeaponShape(item);
      if (shape === 'staff') return buildStaff(color, boost);
      if (shape === 'axe') return buildAxe(color, boost);
      if (shape === 'dagger') return buildDagger(color, boost);
      if (shape === 'mace') return buildMace(color, boost);
      return buildSword(color, boost);
    }
    case 'head': return buildHelm(color, boost);
    case 'chest': return buildChest(color, boost);
    case 'accessory': {
      return chooseAccessoryShape(item) === 'ring'
        ? buildRing(color, boost)
        : buildAmulet(color, boost);
    }
  }
  return buildSword(color, boost);
}

function disposeGroup(g: Group): void {
  g.traverse((node) => {
    if ((node as Mesh).isMesh) {
      const m = node as Mesh;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  });
}

function cacheKey(item: ItemInstance): string {
  // Keep narrow but distinct: same archetype + rarity + color → same icon.
  return `${item.slot}:${item.baseId}:${item.rarity}:${item.iconColor.toString(16)}`;
}

export function getItemIcon(item: ItemInstance): string {
  const key = cacheKey(item);
  const hit = _cache.get(key);
  if (hit) return hit;

  const r = rig();
  const mesh = buildItemMesh(item);
  // Slight idle yaw so silhouettes read better than dead-on.
  mesh.rotation.y = -0.55;
  r.scene.add(mesh);

  // Tint the rim light to match rarity for extra readability.
  const rarityRim: Record<ItemRarity, number> = {
    common: 0xffe0b0,
    magic: 0x80a0ff,
    rare: 0xffd060,
    legendary: 0xff7030,
  };
  r.rimLight.color.set(rarityRim[item.rarity]);

  r.renderer.render(r.scene, r.camera);
  const url = r.renderer.domElement.toDataURL('image/png');

  r.scene.remove(mesh);
  disposeGroup(mesh);

  _cache.set(key, url);
  return url;
}

export function clearItemIconCache(): void {
  _cache.clear();
}
