import * as THREE from 'three';
import type { UniverseHandle } from './galaxy';
import type { LayerState } from './types';

export interface PickResult {
  kind: 'star' | 'planet' | 'portal' | 'galaxy';
  systemId: string;
  planetId: string | null;
  galaxyId: string | null;
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
    universe: UniverseHandle,
    layer: LayerState,
  ): PickResult | null {
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const targets: THREE.Object3D[] = [];
    if (layer.kind === 'universe') {
      // Universe view: every galaxy bulge proxy is a click target.
      for (const [, gh] of universe.galaxies) targets.push(gh.bulge.pickProxy);
    } else if (layer.kind === 'galaxy') {
      // Black-hole portal proxy is only clickable from the main galaxy view.
      const activeGalaxy = layer.galaxyId ? universe.galaxies.get(layer.galaxyId) : null;
      if (activeGalaxy?.blackHole) targets.push(activeGalaxy.blackHole.portalPickProxy);
      // Active galaxy's stars + other galaxies' bulges (so the player can hop
      // to a different galaxy by clicking its bulge from galaxy view).
      for (const [, gh] of universe.galaxies) {
        if (gh.data.id === layer.galaxyId) {
          for (const sys of gh.systems.values()) targets.push(sys.star.pickProxy);
        } else {
          targets.push(gh.bulge.pickProxy);
        }
      }
    } else if (layer.kind === 'system') {
      // active system planets + other system stars in the same galaxy + other galaxy bulges.
      const activeGalaxyId = universe.systemToGalaxy.get(layer.systemId ?? '');
      for (const [, gh] of universe.galaxies) {
        if (gh.data.id !== activeGalaxyId) {
          targets.push(gh.bulge.pickProxy);
          continue;
        }
        for (const sys of gh.systems.values()) {
          if (sys.data.id === layer.systemId) {
            for (const p of sys.planets) targets.push(p.mesh);
          } else {
            targets.push(sys.star.pickProxy);
          }
        }
      }
    } else {
      // planet view — sibling planets + active system star (to go up)
      const sys = layer.systemId ? universe.systems.get(layer.systemId) : null;
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
      return { kind: 'portal', systemId: '', planetId: null, galaxyId: null };
    }
    if (ud.kind === 'galaxy') {
      return { kind: 'galaxy', systemId: '', planetId: null, galaxyId: ud.galaxyId as string };
    }
    if (ud.kind === 'star') {
      const sysId = ud.systemId as string;
      return { kind: 'star', systemId: sysId, planetId: null, galaxyId: universe.systemToGalaxy.get(sysId) ?? null };
    }
    if (ud.kind === 'planet') {
      // Find which system this belongs to by walking up
      let n: THREE.Object3D | null = hit.object;
      while (n && !(n.userData && n.userData.kind === 'system')) n = n.parent;
      const sysId = n ? (n.userData.systemId as string) : '';
      return {
        kind: 'planet',
        systemId: sysId,
        planetId: ud.planetId as string,
        galaxyId: universe.systemToGalaxy.get(sysId) ?? null,
      };
    }
    return null;
  }
}
