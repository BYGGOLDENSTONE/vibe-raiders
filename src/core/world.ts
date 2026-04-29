import { Scene } from 'three';
import type { Entity, EntityId, Tag, ComponentName, System, FrameContext, EventMap, EventName, EventHandler } from './types';

export class World {
  readonly scene: Scene;
  readonly entities = new Map<EntityId, Entity>();
  private readonly systems: System[] = [];
  private readonly handlers = new Map<EventName, Set<(p: unknown) => void>>();
  private frame = 0;
  private elapsed = 0;
  private readonly toDespawn: EntityId[] = [];

  constructor(scene?: Scene) {
    this.scene = scene ?? new Scene();
  }

  spawn(e: Entity): Entity {
    this.entities.set(e.id, e);
    if (e.object3d.parent !== this.scene) this.scene.add(e.object3d);
    this.emit('entity:spawn', { entity: e });
    return e;
  }

  despawn(id: EntityId): void {
    this.toDespawn.push(id);
  }

  private flushDespawns(): void {
    for (const id of this.toDespawn) {
      const e = this.entities.get(id);
      if (!e) continue;
      e.alive = false;
      this.emit('entity:despawn', { entity: e });
      this.scene.remove(e.object3d);
      this.entities.delete(id);
    }
    this.toDespawn.length = 0;
  }

  get(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  *query(...tags: Tag[]): Generator<Entity> {
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      let ok = true;
      for (const t of tags) if (!e.tags.has(t)) { ok = false; break; }
      if (ok) yield e;
    }
  }

  *queryWith(...components: ComponentName[]): Generator<Entity> {
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      let ok = true;
      for (const c of components) if (!e.components.has(c)) { ok = false; break; }
      if (ok) yield e;
    }
  }

  count(...tags: Tag[]): number {
    let n = 0;
    for (const _ of this.query(...tags)) n++;
    return n;
  }

  addSystem(sys: System): void {
    this.systems.push(sys);
  }

  on<K extends EventName>(name: K, handler: EventHandler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) { set = new Set(); this.handlers.set(name, set); }
    set.add(handler as (p: unknown) => void);
    return () => set!.delete(handler as (p: unknown) => void);
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of set) (h as EventHandler<K>)(payload);
  }

  tick(dt: number): void {
    this.frame++;
    this.elapsed += dt;
    const ctx: FrameContext = { dt, elapsed: this.elapsed, frame: this.frame };
    for (const sys of this.systems) sys(this, ctx);
    this.flushDespawns();
  }
}
