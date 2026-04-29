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
import { getEngageTargetId } from '../input';
import { getTrailPool, getDecalSystem } from '../fx';
import { elementFromSkillId, colorFor, coreColorFor, type ElementKind } from '../fx/elements';

// Build the registry: classId -> slotIndex -> Skill
const REGISTRY: Record<ClassId, Skill[]> = {
  rogue: ROGUE_SKILLS,
  barbarian: BARB_SKILLS,
  sorcerer: SORC_SKILLS,
};

// ---- Progression: skill point + slot gating ----
export const MAX_SKILL_RANK = 5;

// D4-style progression: which player level unlocks which slot.
// Slot 0 (basic) and 5 (dash) start unlocked at level 1.
export const SLOT_UNLOCK_LEVEL: Record<number, number> = {
  1: 2,
  2: 4,
  3: 7,
  4: 10,
};

// Inverse lookup: required level for a given slotIndex (0/5 are always unlocked).
export function slotUnlockLevel(slotIndex: number): number {
  if (slotIndex === 0 || slotIndex === 5) return 1;
  return SLOT_UNLOCK_LEVEL[slotIndex] ?? 99;
}

// Per-rank scalers. +15% damage / -5% cooldown per rank, capped to keep cd sane.
export function rankDamageMult(rank: number): number {
  return 1 + 0.15 * Math.max(0, rank);
}
export function rankCooldownMult(rank: number): number {
  return Math.max(0.25, 1 - 0.05 * Math.max(0, rank));
}

export function defaultUnlockedSlots(): boolean[] {
  // [basic, 1, 2, 3, ult, dash]
  return [true, false, false, false, false, true];
}
export function defaultSkillRanks(): number[] {
  return [0, 0, 0, 0, 0, 0];
}

// Stored on the caster while a skill is casting; combat reads it to scale
// outgoing damage by the active slot's rank multiplier. Persists between
// casts (always reflects the most recently cast skill's mult) so projectiles
// landing later still scale correctly.
const CAST_DAMAGE_MULT_KEY = 'skills:rankDamageMult';

export function getCasterRankDamageMult(caster: Entity): number {
  const v = caster.components.get(CAST_DAMAGE_MULT_KEY);
  return typeof v === 'number' ? v : 1;
}

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

// Public for the input module so click-to-engage stops just inside attack range.
// Reads slot 0's range from the registry first; falls back to per-class default.
export function basicAttackRangeForPlayer(player: Entity): number {
  const playerComp = player.components.get(C.Player) as PlayerComponent | undefined;
  if (!playerComp) return 2.0;
  const skills = REGISTRY[playerComp.classId];
  for (const s of skills) {
    if (s.slotIndex === 0 && s.range > 0 && Number.isFinite(s.range)) return s.range;
  }
  return basicAttackRange(playerComp.classId);
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

  // Class hot-swap: re-populate hotbar slots & resource kind.
  world.on('player:classChanged', () => {
    const p = gameState.player;
    if (p) populateSlots(p);
  });

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

    // Slot gating: locked slots cannot be cast.
    const unlocked = skillUser.unlockedSlots ?? defaultUnlockedSlots();
    if (unlocked[payload.slotIndex] === false) {
      world.emit('audio:sfx', { id: 'skill-locked' });
      return;
    }

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
    // Apply rank scaling: shorter cooldown, higher damage (damage scaling
    // happens in combat by reading the caster-side mult flag).
    const ranks = skillUser.skillRanks ?? defaultSkillRanks();
    const rank = ranks[payload.slotIndex] ?? 0;
    slot.cooldownEnd = now + skill.cooldown * rankCooldownMult(rank);
    caster.components.set(CAST_DAMAGE_MULT_KEY, rankDamageMult(rank));

    // Emit pre-cast event so FX/UI can react (not a hit).
    world.emit('skill:cast', {
      casterId: caster.id,
      skillId: skill.id,
      targetX: target.x,
      targetZ: target.z,
    });

    // Run the cast.
    skill.cast(caster, world, target);

    // ───── FX overhaul: trails + decals + telegraphs based on skill id. ─────
    // Pure visual; does not change skill mechanics. Best-effort — degrades
    // silently if FX module hasn't initialized yet.
    dispatchSkillFx(caster, skill.id, payload.slotIndex, target.x, target.z, target.dir);
  });

  // Attach a projectile trail when a player-projectile spawns. We subscribe
  // once at init; per-projectile trails come from the trail pool.
  world.on('entity:spawn', (p) => {
    if (!p.entity.tags.has('player-projectile')) return;
    const trails = getTrailPool();
    if (!trails) return;
    // Determine color: prefer the projectile's hit-color stamp if present,
    // otherwise pick by inferring from kind via existing material color.
    // Use the mesh material's emissive as a quick palette source.
    let color = 0x80c8ff;
    let core = 0xffffff;
    // The projectile mesh is the entity's object3d.
    const mesh = p.entity.object3d as { material?: { emissive?: { getHex: () => number } } };
    if (mesh.material && mesh.material.emissive) {
      color = mesh.material.emissive.getHex();
      core = 0xffffff;
    }
    trails.spawnProjectileTrail(p.entity.object3d, color, 1.5, core);
  });
  world.on('entity:despawn', (p) => {
    if (!p.entity.tags.has('player-projectile')) return;
    const trails = getTrailPool();
    if (!trails) return;
    trails.releaseProjectileTrail(p.entity.object3d);
  });

  // Right-click on a hotbar slot spends a skill point: rank +1, capped at MAX.
  // Listening at window/contextmenu level so we don't need hotbar.ts wiring.
  // We resolve the hovered .dusk-slot from the click target.
  const onContextMenu = (ev: MouseEvent) => {
    const tgt = ev.target as Element | null;
    if (!tgt) return;
    const slotEl = tgt.closest?.('.dusk-slot') as HTMLElement | null;
    if (!slotEl) return;
    // Always swallow right-click on the hotbar so the browser menu never opens
    // over our UI, regardless of whether the spend succeeds.
    ev.preventDefault();
    const idxStr = slotEl.dataset.idx;
    if (idxStr === undefined) return;
    const slotIndex = Number(idxStr);
    if (!Number.isFinite(slotIndex)) return;

    const p = gameState.player;
    if (!p) return;
    const su = p.components.get(C.SkillUser) as SkillUserComponent | undefined;
    if (!su) return;
    if ((su.unlockedSlots ?? defaultUnlockedSlots())[slotIndex] !== true) {
      world.emit('audio:sfx', { id: 'skill-locked' });
      return;
    }
    if (!su.skillRanks) su.skillRanks = defaultSkillRanks();
    const cur = su.skillRanks[slotIndex] ?? 0;
    if (cur >= MAX_SKILL_RANK) return;
    if ((su.skillPoints ?? 0) <= 0) {
      world.emit('audio:sfx', { id: 'skill-no-resource' });
      return;
    }
    su.skillRanks[slotIndex] = cur + 1;
    su.skillPoints = (su.skillPoints ?? 0) - 1;
    world.emit('skillpoint:spent', {
      entityId: p.id,
      slotIndex,
      remaining: su.skillPoints,
    });
    world.emit('audio:sfx', { id: 'skill-rank-up' });
  };
  window.addEventListener('contextmenu', onContextMenu);

  // Per-frame systems.
  world.addSystem((w) => {
    tickChannels(w);
    tickTweens(w);
  });
  world.addSystem((w, frameCtx) => playerProjectileSystem(w, frameCtx));

  // Basic-attack auto-fire. Priority order:
  //   1. If input has an 'engage' intent and the engaged target is in range, fire at it.
  //   2. Otherwise, when the player is idle (MoveTarget cleared) and not channeling,
  //      fire at the nearest hostile within basic range (legacy behavior).
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

    const range = basicAttackRange(playerComp.classId);
    const px = p.object3d.position.x;
    const pz = p.object3d.position.z;

    // 1) Engage-intent target gets priority — this is the D4-style "I clicked
    //    that mob, keep hitting it" behavior. Range check still applies so we
    //    don't fire while still walking toward the target.
    const engageId = getEngageTargetId();
    if (engageId !== null) {
      const t = w.get(engageId);
      if (t && t.alive && t.tags.has('hostile')) {
        const dx = t.object3d.position.x - px;
        const dz = t.object3d.position.z - pz;
        if (dx * dx + dz * dz <= range * range) {
          w.emit('player:skillCast', {
            entityId: p.id,
            slotIndex: 0,
            targetX: t.object3d.position.x,
            targetZ: t.object3d.position.z,
          });
          return;
        }
        // Engaged but out of range — input system is walking us in. Skip auto-fire.
        return;
      }
      // Engaged target died/despawned — fall through to legacy auto-fire.
    }

    // 2) Legacy auto-fire: only when standing still (move/pickup intents may
    //    leave MoveTarget set; auto-fire stays passive while repositioning).
    const mt = p.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    if (mt && mt.target !== null) return;

    const target = nearestHostile(w, px, pz, range);
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
  // Progression defaults — only fill if not already set so class hot-swap
  // preserves earned ranks / unlocks.
  if (!skillUser.unlockedSlots || skillUser.unlockedSlots.length !== 6) {
    skillUser.unlockedSlots = defaultUnlockedSlots();
  }
  if (!skillUser.skillRanks || skillUser.skillRanks.length !== 6) {
    skillUser.skillRanks = defaultSkillRanks();
  }
  if (typeof skillUser.skillPoints !== 'number') {
    skillUser.skillPoints = 0;
  }
  // Apply level-based auto-unlocks for the player's CURRENT level (covers
  // saves / restarts / class swap mid-run).
  const playerLevel = playerComp.level;
  for (let i = 0; i < 6; i++) {
    if (i === 0 || i === 5) {
      skillUser.unlockedSlots[i] = true;
    } else if (playerLevel >= slotUnlockLevel(i)) {
      skillUser.unlockedSlots[i] = true;
    }
  }
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

// ───── FX dispatch (visual-only enrichment for skill casts) ─────
// All trail / decal / telegraph spawns based on skill identity. Fully optional;
// degrades to no-op if the FX subsystem hasn't booted yet.
function dispatchSkillFx(
  caster: Entity,
  skillId: string,
  _slotIndex: number,
  tx: number,
  tz: number,
  dir: Vector3,
): void {
  const trails = getTrailPool();
  const decals = getDecalSystem();
  if (!trails && !decals) return;

  const element: ElementKind = elementFromSkillId(skillId);
  const color = colorFor(element);
  const core = coreColorFor(element);
  const px = caster.object3d.position.x;
  const py = caster.object3d.position.y;
  const pz = caster.object3d.position.z;

  // Categorize by skill id. Ranges/timings here are PURELY visual — they don't
  // change cooldowns / damage / mechanics (those live in the Skill.cast() body).
  switch (skillId) {
    // ── Rogue ──
    case 'rogue:strike': {
      // Quick swing arc above target direction.
      if (trails) {
        // Build arc axis perpendicular to swing direction.
        const swingDir = new Vector3(dir.x, 0, dir.z).normalize();
        // Axis: vertical (so arc sweeps horizontally, like a slash).
        const axis = new Vector3(0, 1, 0);
        const yaw = Math.atan2(swingDir.x, swingDir.z);
        // Sample arc origin slightly in front of caster.
        const origin = { x: px + swingDir.x * 0.6, y: py + 1.0, z: pz + swingDir.z * 0.6 };
        // Use yaw to bias arc start/end.
        trails.spawnSwingTrail({
          origin,
          arcAxis: axis,
          arcAngleStart: yaw - 0.6,
          arcAngleEnd: yaw + 0.6,
          radius: 0.9,
          duration: 0.22,
          color,
          coreColor: core,
        });
      }
      if (decals) decals.spawnHitDecal(tx, tz, color);
      break;
    }
    case 'rogue:shadow-step': {
      if (decals) decals.spawnAoEDecal(tx, tz, 1.2, 0.6, colorFor('shadow'), true);
      if (decals) decals.spawnHitDecal(tx, tz, colorFor('shadow'));
      break;
    }
    case 'rogue:smoke-cloud': {
      if (decals) decals.spawnAoEDecal(tx, tz, 4.0, 1.4, colorFor('shadow'), true);
      break;
    }
    case 'rogue:volley': {
      // Daggers each get a projectile-trail when spawned (handled by entity:spawn hook).
      // Add a forward telegraph cone so the fan reads visually.
      if (decals) decals.spawnTelegraphCone(px, pz, dir.x, dir.z, 8, 30 * Math.PI / 180, 0.4, color);
      break;
    }
    case 'rogue:storm-of-blades': {
      if (decals) decals.spawnAoEDecal(px, pz, 4.0, 3.0, color, true);
      break;
    }
    case 'rogue:roll': {
      // Dash-streak line.
      if (decals) decals.spawnTelegraphLine(px, pz, tx, tz, 0.5, 0.35, color);
      break;
    }

    // ── Barbarian ──
    case 'barb:cleave': {
      if (trails) {
        const swingDir = new Vector3(dir.x, 0, dir.z).normalize();
        const yaw = Math.atan2(swingDir.x, swingDir.z);
        const origin = { x: px + swingDir.x * 0.7, y: py + 1.1, z: pz + swingDir.z * 0.7 };
        trails.spawnSwingTrail({
          origin,
          arcAxis: new Vector3(0, 1, 0),
          arcAngleStart: yaw - 0.85,
          arcAngleEnd: yaw + 0.85,
          radius: 1.4,
          duration: 0.3,
          color,
          coreColor: core,
        });
      }
      if (decals) decals.spawnHitDecal(px + dir.x * 1.6, pz + dir.z * 1.6, color);
      break;
    }
    case 'barb:leap': {
      // Telegraph the landing site BEFORE the leap arc completes.
      if (decals) decals.spawnTelegraphRing(tx, tz, 3.0, 0.5, colorFor('fire'));
      // Impact decal slightly delayed — but since onLand fires later, just queue
      // a smaller AoE here that lasts the full flight + brief impact lifetime.
      if (decals) decals.spawnAoEDecal(tx, tz, 3.0, 1.2, colorFor('fire'), true);
      break;
    }
    case 'barb:whirlwind': {
      if (decals) decals.spawnAoEDecal(px, pz, 3.0, 2.6, color, true);
      break;
    }
    case 'barb:ground-slam': {
      if (decals) decals.spawnTelegraphRing(tx, tz, 4.0, 0.3, colorFor('fire'));
      if (decals) decals.spawnAoEDecal(tx, tz, 4.0, 1.0, color, true);
      if (decals) decals.spawnHitDecal(tx, tz, colorFor('fire'));
      break;
    }
    case 'barb:berserk': {
      if (decals) decals.spawnAoEDecal(px, pz, 2.0, 1.0, colorFor('fire'), true);
      break;
    }
    case 'barb:charge': {
      if (decals) decals.spawnTelegraphLine(px, pz, tx, tz, 1.2, 0.4, color);
      break;
    }

    // ── Sorcerer ──
    case 'sorc:bolt': {
      // Projectile trail handled by entity:spawn hook.
      break;
    }
    case 'sorc:ice-nova': {
      if (decals) decals.spawnAoEDecal(px, pz, 5.0, 1.2, colorFor('ice'), true);
      break;
    }
    case 'sorc:chain-lightning': {
      // Beam from caster to target as a quick line.
      if (decals) decals.spawnTelegraphLine(px, pz, tx, tz, 0.4, 0.35, colorFor('lightning'));
      break;
    }
    case 'sorc:meteor': {
      if (decals) decals.spawnTelegraphRing(tx, tz, 5.0, 1.0, colorFor('fire'));
      // Impact decal scheduled to land with the meteor visually (1s delay) —
      // we approximate with an AoE decal whose lifetime overlaps the impact.
      if (decals) decals.spawnAoEDecal(tx, tz, 5.0, 2.0, colorFor('fire'), true);
      break;
    }
    case 'sorc:black-hole': {
      if (decals) decals.spawnAoEDecal(tx, tz, 4.0, 4.5, colorFor('shadow'), true);
      if (decals) decals.spawnTelegraphRing(tx, tz, 8.0, 0.5, colorFor('arcane'));
      break;
    }
    case 'sorc:blink': {
      if (decals) decals.spawnHitDecal(px, pz, colorFor('arcane'));
      if (decals) decals.spawnHitDecal(tx, tz, colorFor('arcane'));
      break;
    }

    default: {
      // Unknown skill — just drop a generic ground decal at the target.
      if (decals && (tx !== px || tz !== pz)) {
        decals.spawnHitDecal(tx, tz, color);
      }
    }
  }
}
