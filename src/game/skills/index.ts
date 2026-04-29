// DUSK skills module: registry, casting pipeline, channels/tweens, player projectiles,
// and a basic-attack auto-fire fallback so combat can start without LMB-attack wired.

import { Vector3 } from 'three';
import { gameState, type GameContext } from '../state';
import {
  C,
  type ClassId,
  type MoveTargetComponent,
  type PlayerComponent,
  type ResourceComponent,
  type SkillUserComponent,
} from '../../core/components';
import type { Entity } from '../../core/types';
import type { Skill, SkillCastTarget } from './types';
import { ROGUE_SKILLS } from './rogue';
import { BARB_SKILLS } from './barbarian';
import { SORC_SKILLS } from './sorcerer';
import { playerProjectileSystem } from './projectiles';
import { isChanneling, tickChannels } from './channels';
import { tickTweens } from './tweens';
import { nearestHostile } from './helpers';

// Build the registry: classId -> slotIndex -> Skill
const REGISTRY: Record<ClassId, Skill[]> = {
  rogue: ROGUE_SKILLS,
  barbarian: BARB_SKILLS,
  sorcerer: SORC_SKILLS,
};

function findSkillForClassSlot(classId: ClassId, slotIndex: number): Skill | null {
  const skills = REGISTRY[classId];
  for (const s of skills) {
    if (s.slotIndex === slotIndex) return s;
  }
  return null;
}

// Range a class's basic-attack auto-fires from. Sorcerer's bolt homes from 12m.
function basicAttackRange(classId: ClassId): number {
  switch (classId) {
    case 'rogue': return 1.8;
    case 'barbarian': return 2.2;
    case 'sorcerer': return 12;
  }
}

export function initSkills(ctx: GameContext): void {
  const world = ctx.world;

  // Populate the player's slots based on their class.
  // Player entity is created before initSkills (in main.ts boot order), so read it now.
  const player = gameState.player;
  if (player) {
    populateSlots(player);
  } else {
    // Defensive: subscribe to entity:spawn and populate when player appears.
    const off = world.on('entity:spawn', (p) => {
      if (p.entity.tags.has('player') && p.entity.components.has(C.Player)) {
        populateSlots(p.entity);
        off();
      }
    });
  }

  // Casting pipeline.
  world.on('player:skillCast', (payload) => {
    const caster = world.get(payload.entityId);
    if (!caster) return;
    const playerComp = caster.components.get(C.Player) as PlayerComponent | undefined;
    if (!playerComp) return;
    const skillUser = caster.components.get(C.SkillUser) as SkillUserComponent | undefined;
    if (!skillUser) return;

    const skill = findSkillForClassSlot(playerComp.classId, payload.slotIndex);
    if (!skill) return;

    const slot = skillUser.slots[payload.slotIndex];
    if (!slot) return;

    const now = performance.now() / 1000;
    if (slot.cooldownEnd > now) {
      // Silent failure feedback.
      world.emit('audio:sfx', { id: 'skill-cd-blocked' });
      return;
    }

    // Resource check.
    const resource = caster.components.get(C.Resource) as ResourceComponent | undefined;
    if (resource && skill.cost > 0) {
      if (resource.current < skill.cost) {
        world.emit('audio:sfx', { id: 'skill-no-resource' });
        return;
      }
    }

    // Build target (range-clamped point + dir).
    const target = buildTarget(caster, payload.targetX, payload.targetZ, skill.range);

    // Deduct resource and set cooldown BEFORE the cast (prevents double-fire on re-entrance).
    if (resource && skill.cost > 0) {
      resource.current = Math.max(0, resource.current - skill.cost);
    }
    slot.cooldownEnd = now + skill.cooldown;

    // Emit pre-cast event so FX/UI can react (not a hit).
    world.emit('skill:cast', {
      casterId: caster.id,
      skillId: skill.id,
      targetX: target.x,
      targetZ: target.z,
    });

    // Run the cast.
    skill.cast(caster, world, target);
  });

  // Per-frame systems.
  world.addSystem((w) => {
    tickChannels(w);
    tickTweens(w);
  });
  world.addSystem((w, frameCtx) => playerProjectileSystem(w, frameCtx));

  // Basic-attack auto-fire. When player is idle (no MoveTarget) and not channeling,
  // and a hostile is within basic range, fire slot-0 on cooldown.
  world.addSystem((w) => {
    const p = gameState.player;
    if (!p || !p.alive) return;
    if (gameState.paused) return;
    if (isChanneling(p.id)) return;

    const playerComp = p.components.get(C.Player) as PlayerComponent | undefined;
    if (!playerComp) return;
    const skillUser = p.components.get(C.SkillUser) as SkillUserComponent | undefined;
    if (!skillUser) return;
    const slot = skillUser.slots[0];
    if (!slot) return;
    const now = performance.now() / 1000;
    if (slot.cooldownEnd > now) return;

    // If actively moving (non-trivial MoveTarget), skip — player is repositioning.
    const mt = p.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (mt && mt.target !== null) {
      // Allow auto-attack only if the move target is essentially the player's current position
      // (e.g. they tapped exactly where they are). Treat any active move as "moving".
      return;
    }

    const range = basicAttackRange(playerComp.classId);
    const target = nearestHostile(w, p.object3d.position.x, p.object3d.position.z, range);
    if (!target) return;

    // Emit a synthetic cast through the same pipeline so cooldowns/resource/events all fire.
    w.emit('player:skillCast', {
      entityId: p.id,
      slotIndex: 0,
      targetX: target.object3d.position.x,
      targetZ: target.object3d.position.z,
    });
  });
}

function populateSlots(player: Entity): void {
  const playerComp = player.components.get(C.Player) as PlayerComponent | undefined;
  const skillUser = player.components.get(C.SkillUser) as SkillUserComponent | undefined;
  if (!playerComp || !skillUser) return;
  const skills = REGISTRY[playerComp.classId];
  // Ensure slots[0..5] populated.
  const slots = new Array(6).fill(null).map(() => ({ id: '', cooldownEnd: 0 }));
  for (const s of skills) {
    if (s.slotIndex >= 0 && s.slotIndex < 6) {
      slots[s.slotIndex] = { id: s.id, cooldownEnd: 0 };
    }
  }
  skillUser.slots = slots;
  // Make sure the player's resource kind matches the class (player.ts defaults to 'energy' for rogue).
  const resource = player.components.get(C.Resource) as ResourceComponent | undefined;
  if (resource) {
    const want = resourceKindFor(playerComp.classId);
    if (resource.kind !== want) {
      resource.kind = want;
      // Reset to full on switch — friendly default.
      resource.current = resource.max;
    }
  }
}

function resourceKindFor(classId: ClassId): ResourceComponent['kind'] {
  switch (classId) {
    case 'rogue': return 'energy';
    case 'barbarian': return 'rage';
    case 'sorcerer': return 'mana';
  }
}

function buildTarget(caster: Entity, tx: number, tz: number, range: number): SkillCastTarget {
  const px = caster.object3d.position.x;
  const pz = caster.object3d.position.z;
  let dx = tx - px;
  let dz = tz - pz;
  let d = Math.hypot(dx, dz);

  // If the skill has a finite, positive range, clamp the target point to it.
  // range 0 means caster-centered (self-buff/AoE around caster) — keep target as caster pos.
  if (range > 0 && range !== Infinity && d > range) {
    const k = range / d;
    dx *= k;
    dz *= k;
    d = range;
  }
  if (range === 0) {
    dx = 0;
    dz = 0;
    d = 0;
  }
  const dirVec = d > 1e-6 ? new Vector3(dx / d, 0, dz / d) : new Vector3(0, 0, 0);
  return {
    x: px + dx,
    z: pz + dz,
    dir: dirVec,
    distance: d,
  };
}

// Re-exports for downstream modules (UI hotbar reads slot ids -> looks up names).
export { ROGUE_SKILLS, BARB_SKILLS, SORC_SKILLS };
export function getSkillById(id: string): Skill | null {
  for (const list of [ROGUE_SKILLS, BARB_SKILLS, SORC_SKILLS]) {
    for (const s of list) if (s.id === id) return s;
  }
  return null;
}
