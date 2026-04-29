// Wave 2 combat module — single source of truth for damage application,
// death, XP/leveling, resource regen, status effects, and player respawn.
//
// Subscribes:
//   'damage:dealt'  → applies HP loss, emits 'entity:died' / 'mob:killed' / fx
//   'mob:killed'    → credits XP to player, may emit 'level:up'
// Emits:
//   'entity:died', 'mob:killed', 'xp:gained', 'level:up',
//   'fx:hitstop', 'fx:screenshake', 'damage:dealt' (status DoT)
//
// Note: after this module lands, the WAVE2_OWNS_DAMAGE stub in mobs/index.ts
// is removed. The mob AI's own 'mob:killed' / 'entity:died' emission is
// expected to be reconciled by the integrator so we are the single source.

import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import {
  C,
  type HealthComponent,
  type PlayerComponent,
  type ResourceComponent,
  type SkillUserComponent,
  type StatusEffect,
  type StatusEffectsComponent,
  type MoveTargetComponent,
  type AIBrainComponent,
} from '../../core/components';
import { TUNING } from '../constants';
import { gameState, type GameContext } from '../state';
import {
  defaultSkillRanks,
  defaultUnlockedSlots,
  getCasterRankDamageMult,
  slotUnlockLevel,
} from '../skills';

// Convention key for archetype-provided XP reward override (string-keyed component).
const MOB_XP_REWARD_KEY = 'mobXpReward';

// Pending respawn timestamp lives on the player as a string-keyed component.
const PENDING_RESPAWN_KEY = 'pendingRespawnAt';

// Per-status book-keeping (next tick time) lives on the entity, keyed by
// `${effect.id}:nextTick`.
function nextTickKey(effectId: string): string {
  return `status:${effectId}:nextTick`;
}

// ---------- Public helpers ----------

export function rollDamage(base: number, critChance: number, critMult: number): { amount: number; isCrit: boolean } {
  const isCrit = Math.random() < critChance;
  const amount = isCrit ? base * critMult : base;
  return { amount, isCrit };
}

export function applyStatus(entity: Entity, effect: StatusEffect): void {
  let bag = entity.components.get(C.StatusEffects) as StatusEffectsComponent | undefined;
  if (!bag) {
    bag = { effects: [] };
    entity.components.set(C.StatusEffects, bag);
  }
  // Replace existing effect with same id (refresh duration/power).
  const existing = bag.effects.findIndex((e) => e.id === effect.id);
  if (existing >= 0) {
    bag.effects[existing] = effect;
  } else {
    bag.effects.push(effect);
  }
  // Reset next-tick scheduler so the new/refreshed effect ticks promptly.
  entity.components.delete(nextTickKey(effect.id));
}

// ---------- Init ----------

export function initCombat(ctx: GameContext): void {
  const world = ctx.world;

  // ===== Damage application =====
  world.on('damage:dealt', (payload) => {
    const target = world.get(payload.targetId);
    if (!target) return;
    if (target.tags.has('dead')) return;
    const health = target.components.get(C.Health) as HealthComponent | undefined;
    if (!health) return;

    const now = performance.now() / 1000;

    // Invuln frames (player only — mobs don't use them).
    if (target.tags.has('player') && health.invulnUntil > now) return;

    // Skill-rank damage scaling: outgoing damage from the player is scaled by
    // the rank multiplier of the most recently cast skill. Projectiles fire
    // their own damage:dealt later but the caster-side flag persists, so they
    // inherit the right scale for the cast that produced them.
    let amountIn = payload.amount;
    const playerEnt = gameState.player;
    if (playerEnt && payload.sourceId === playerEnt.id && !target.tags.has('player')) {
      amountIn *= getCasterRankDamageMult(playerEnt);
    }
    const amount = amountIn;
    health.hp = Math.max(0, health.hp - amount);
    health.lastHitTime = now;

    if (target.tags.has('player')) {
      health.invulnUntil = now + TUNING.invulnAfterHit;
    }

    // FX cues.
    const bigHit = amount > health.maxHp * 0.2;
    if (payload.isCrit || health.hp <= 0) {
      world.emit('fx:hitstop', { duration: TUNING.hitstopBaseDuration });
    }
    if (target.tags.has('player')) {
      // Player damage shakes harder.
      const amp = bigHit ? 0.35 : 0.18;
      const dur = bigHit ? 0.25 : 0.15;
      world.emit('fx:screenshake', { amplitude: amp, duration: dur });
    } else if (bigHit) {
      world.emit('fx:screenshake', { amplitude: 0.15, duration: 0.1 });
    }

    // Death.
    if (health.hp <= 0) {
      handleDeath(world, target, payload.sourceId, now);
    }
  });

  // ===== XP / level up =====
  world.on('mob:killed', (payload) => {
    const player = gameState.player;
    if (!player) return;

    // Credit XP if the killer is the player, or if killerId is null (legacy).
    const credit = payload.killerId === player.id || payload.killerId === null;
    if (!credit) return;

    const pc = player.components.get(C.Player) as PlayerComponent | undefined;
    if (!pc) return;

    const amount = payload.xpReward;
    pc.xp += amount;
    world.emit('xp:gained', { entityId: player.id, amount });

    // Loop in case of multi-level-up from a single huge XP grant.
    while (pc.xp >= pc.xpToNext) {
      pc.xp -= pc.xpToNext;
      pc.level += 1;
      pc.xpToNext = Math.floor(pc.xpToNext * 1.5);

      // Restore HP / Resource on level up.
      const hp = player.components.get(C.Health) as HealthComponent | undefined;
      if (hp) hp.hp = hp.maxHp;
      const res = player.components.get(C.Resource) as ResourceComponent | undefined;
      if (res) res.current = res.max;

      // ----- Progression rewards -----
      const su = player.components.get(C.SkillUser) as SkillUserComponent | undefined;
      if (su) {
        if (!su.unlockedSlots || su.unlockedSlots.length !== 6) {
          su.unlockedSlots = defaultUnlockedSlots();
        }
        if (!su.skillRanks || su.skillRanks.length !== 6) {
          su.skillRanks = defaultSkillRanks();
        }
        if (typeof su.skillPoints !== 'number') su.skillPoints = 0;

        // +1 skill point per level (D4-style).
        su.skillPoints += 1;
        world.emit('skillpoint:gained', { entityId: player.id, total: su.skillPoints });

        // Auto-unlock slots that gate at this level.
        for (let i = 1; i <= 4; i++) {
          if (su.unlockedSlots[i] !== true && pc.level >= slotUnlockLevel(i)) {
            su.unlockedSlots[i] = true;
            world.emit('skill:unlocked', { entityId: player.id, slotIndex: i });
          }
        }
      }

      world.emit('level:up', { entityId: player.id, newLevel: pc.level });
    }
  });

  // ===== Tick systems =====
  world.addSystem((w, frameCtx) => resourceRegenSystem(w, frameCtx.dt));
  world.addSystem((w, frameCtx) => statusEffectSystem(w, frameCtx.elapsed));
  world.addSystem((w, frameCtx) => respawnSystem(w, frameCtx.elapsed));
}

// ---------- Death handling ----------

function handleDeath(world: World, target: Entity, sourceId: number, now: number): void {
  if (target.tags.has('dead')) return;
  target.tags.add('dead');

  const killerId: number | null = sourceId !== undefined && sourceId !== null ? sourceId : null;

  if (target.tags.has('player')) {
    // Player death: don't despawn; schedule respawn.
    world.emit('entity:died', { entityId: target.id, killerId });
    world.emit('fx:screenshake', { amplitude: 0.5, duration: 0.4 });
    target.components.set(PENDING_RESPAWN_KEY, now + 5);
    // Stop any movement.
    const mt = target.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (mt) mt.target = null;
    return;
  }

  if (target.tags.has('mob')) {
    let xpReward = 10;
    const override = target.components.get(MOB_XP_REWARD_KEY);
    if (typeof override === 'number') xpReward = override;
    world.emit('mob:killed', { entityId: target.id, killerId, xpReward });
    world.emit('entity:died', { entityId: target.id, killerId });
    // Despawn after 0.6s to allow death FX (mob AI's death state still drives
    // visual sink/rotate; we just enforce the timeout here).
    target.components.set('combat:despawnAt', now + 0.6);
    return;
  }

  // Generic combatant death.
  world.emit('entity:died', { entityId: target.id, killerId });
  target.components.set('combat:despawnAt', now + 1.0);
}

// ---------- Resource regen ----------

function resourceRegenSystem(world: World, dt: number): void {
  for (const e of world.queryWith(C.Resource)) {
    if (e.tags.has('dead')) continue;
    const r = e.components.get(C.Resource) as ResourceComponent;
    if (r.current >= r.max) continue;
    r.current = Math.min(r.max, r.current + r.regenPerSec * dt);
  }
}

// ---------- Status effects ----------

function statusEffectSystem(world: World, now: number): void {
  for (const e of world.queryWith(C.StatusEffects)) {
    const bag = e.components.get(C.StatusEffects) as StatusEffectsComponent;
    if (bag.effects.length === 0) continue;

    // Filter expired.
    if (e.tags.has('dead')) {
      // Drop everything.
      for (const eff of bag.effects) e.components.delete(nextTickKey(eff.id));
      bag.effects.length = 0;
      // Clear stun/slow flags too.
      e.components.delete('status:slowMult');
      e.components.delete('status:stunned');
      continue;
    }

    let slowMult = 1;
    let stunned = false;

    for (let i = bag.effects.length - 1; i >= 0; i--) {
      const eff = bag.effects[i]!;
      if (eff.endTime <= now) {
        bag.effects.splice(i, 1);
        e.components.delete(nextTickKey(eff.id));
        continue;
      }

      switch (eff.id) {
        case 'burn':
        case 'poison': {
          const tickKey = nextTickKey(eff.id);
          const nextTick = (e.components.get(tickKey) as number | undefined) ?? now + 0.5;
          if (now >= nextTick) {
            e.components.set(tickKey, now + 0.5);
            world.emit('damage:dealt', {
              sourceId: -1,
              targetId: e.id,
              amount: eff.power,
              isCrit: false,
            });
          } else if (e.components.get(tickKey) === undefined) {
            e.components.set(tickKey, nextTick);
          }
          break;
        }
        case 'slow': {
          // Multiplicative; pick strongest slow.
          slowMult = Math.min(slowMult, Math.max(0.05, 1 - eff.power));
          break;
        }
        case 'stun': {
          stunned = true;
          break;
        }
        default:
          break;
      }
    }

    // Apply slow to MoveTarget speed (store a multiplier flag — movement system
    // reads from MoveTarget.speed which other modules tune; we expose a flag
    // and clamp speed in-place each tick).
    const mt = e.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (mt) {
      const baseSpeed = (e.components.get('status:baseSpeed') as number | undefined) ?? mt.speed;
      if (slowMult < 1) {
        // Remember original baseline once (using current speed if not yet stored).
        if (!e.components.has('status:baseSpeed')) {
          e.components.set('status:baseSpeed', mt.speed);
        }
        mt.speed = baseSpeed * slowMult;
      } else if (e.components.has('status:baseSpeed')) {
        mt.speed = baseSpeed;
        e.components.delete('status:baseSpeed');
      }
    }

    // Stun: clear MoveTarget and set a flag the AI can read.
    if (stunned) {
      if (mt) mt.target = null;
      e.components.set('status:stunned', true);
      // Clear any AI brain target so chase is interrupted (AI logic itself
      // stays in mobs; we only set passive flags here).
      const brain = e.components.get(C.AIBrain) as AIBrainComponent | undefined;
      if (brain) brain.targetId = null;
    } else {
      e.components.delete('status:stunned');
    }

    // Clean: if no effects remain, ensure flags are cleared.
    if (bag.effects.length === 0) {
      e.components.delete('status:stunned');
      if (e.components.has('status:baseSpeed') && mt) {
        mt.speed = (e.components.get('status:baseSpeed') as number);
        e.components.delete('status:baseSpeed');
      }
    }
  }
}

// ---------- Respawn + delayed despawn ----------

function respawnSystem(world: World, now: number): void {
  // Player respawn.
  const player = gameState.player;
  if (player) {
    const at = player.components.get(PENDING_RESPAWN_KEY) as number | undefined;
    if (at !== undefined && now >= at) {
      player.components.delete(PENDING_RESPAWN_KEY);
      respawnPlayer(world, player);
    }
  }

  // Delayed despawn for non-player entities.
  for (const e of world.entities.values()) {
    if (!e.alive) continue;
    if (e.tags.has('player')) continue;
    const at = e.components.get('combat:despawnAt') as number | undefined;
    if (at !== undefined && now >= at) {
      e.components.delete('combat:despawnAt');
      world.despawn(e.id);
    }
  }
}

function respawnPlayer(world: World, player: Entity): void {
  const hp = player.components.get(C.Health) as HealthComponent | undefined;
  if (hp) {
    hp.hp = hp.maxHp;
    hp.lastHitTime = 0;
    hp.invulnUntil = 0;
  }
  const res = player.components.get(C.Resource) as ResourceComponent | undefined;
  if (res) res.current = res.max;

  const status = player.components.get(C.StatusEffects) as StatusEffectsComponent | undefined;
  if (status) {
    for (const eff of status.effects) player.components.delete(nextTickKey(eff.id));
    status.effects.length = 0;
  }
  player.components.delete('status:stunned');
  player.components.delete('status:baseSpeed');

  const mt = player.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
  if (mt) mt.target = null;

  player.tags.delete('dead');
  player.object3d.position.set(0, 0.9, 0);

  world.emit('fx:screenshake', { amplitude: 0.05, duration: 0.3 });
}
