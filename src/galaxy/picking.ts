import * as THREE from 'three';
import type { GalaxyHandle } from './galaxy';
import type { LayerState } from './types';

export interface PickResult {
  kind: 'star' | 'planet' | 'portal';
  systemId: string;
  planetId: string | null;
}

export class Picker {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private camera: THREE.Camera;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  pickAt(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    galaxy: GalaxyHandle,
    layer: LayerState,
  ): PickResult | null {
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const targets: THREE.Object3D[] = [];
    if (layer.kind === 'galaxy') {
      // Black-hole portal proxy is only clickable from galaxy view — once
      // you're zoomed into a system, you're past it.
      targets.push(galaxy.blackHole.portalPickProxy);
      // Use the invisible pick proxy so distant stars stay clickable
      for (const sys of galaxy.systems.values()) targets.push(sys.star.pickProxy);
    } else if (layer.kind === 'system') {
      // active system planets + other system stars
      for (const sys of galaxy.systems.values()) {
        if (sys.data.id === layer.systemId) {
          for (const p of sys.planets) targets.push(p.mesh);
        } else {
          targets.push(sys.star.pickProxy);
        }
      }
    } else {
      // planet view — sibling planets + active system star (to go up)
      const sys = galaxy.systems.get(layer.systemId ?? '');
      if (sys) {
        for (const p of sys.planets) targets.push(p.mesh);
        targets.push(sys.star.pickProxy);
      }
    }

    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    if (!hit) return null;
    const ud = hit.object.userData;
    if (ud.kind === 'portal') {
      return { kind: 'portal', systemId: '', planetId: null };
    }
    if (ud.kind === 'star') {
      return { kind: 'star', systemId: ud.systemId as string, planetId: null };
    }
    if (ud.kind === 'planet') {
      // Find which system this belongs to by walking up
      let n: THREE.Object3D | null = hit.object;
      while (n && !(n.userData && n.userData.kind === 'system')) n = n.parent;
      const sysId = n ? (n.userData.systemId as string) : '';
      return { kind: 'planet', systemId: sysId, planetId: ud.planetId as string };
    }
    return null;
  }
}
