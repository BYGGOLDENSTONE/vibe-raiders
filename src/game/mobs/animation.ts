// Per-mob procedural animation: walk-cycle limb sway, attack windup + commit
// arc, and damage hit-shake. Reads named child meshes attached by archetypes.ts.
//
// All state lives in a per-entity `MobAnim` component (string-keyed) so we
// don't need to extend core/components.ts.

import type { Object3D } from 'three';
import type { World } from '../../core/world';
import {
  C,
  type AIBrainComponent,
  type CombatantComponent,
  type MoveTargetComponent,
} from '../../core/components';
import type { ArchetypeId } from './archetypes';
import { MOB_RUNTIME, type MobRuntime } from './ai';
import { tickMobShaderUniforms } from './shaders';

export const MOB_ANIM = 'mob:anim';

export interface MobAnim {
  archetypeId: ArchetypeId;
  // Phase accumulator for limb sway. Independent of the bobPhase used by ai.ts.
  walkPhase: number;
  // Hit shake — event handler raises the flag; system converts to a
  // ctx.elapsed-based deadline on the next tick (so we don't mix clocks).
  shakeUntil: number;
  shakeQueued: boolean;
  shakeSeed: number;
  // Track previous lastAttackTime so we can detect commit edges.
  prevAttackTime: number;
  // Predictive windup countdown — populated when AI is in 'attack' state and
  // the next swing is imminent. >0 means we're in windup.
  windupRemaining: number;
  windupDuration: number;
  // Last position so we can estimate movement speed for walk-cycle gain.
  lastX: number;
  lastZ: number;
  // Saved rest pose (position only) for the parts we mutate, so we can lerp
  // back to baseline when not animating.
  rest: Map<string, { x: number; y: number; z: number; rx: number; ry: number; rz: number }>;
}

// --------- creation helper called by archetypes.ts buildMesh wrappers ---------

export function createMobAnim(
  archetypeId: ArchetypeId,
  rig: Object3D,
  partNames: string[],
): MobAnim {
  const rest = new Map<string, { x: number; y: number; z: number; rx: number; ry: number; rz: number }>();
  for (const name of partNames) {
    const child = rig.getObjectByName(name);
    if (!child) continue;
    rest.set(name, {
      x: child.position.x,
      y: child.position.y,
      z: child.position.z,
      rx: child.rotation.x,
      ry: child.rotation.y,
      rz: child.rotation.z,
    });
  }
  return {
    archetypeId,
    walkPhase: Math.random() * Math.PI * 2,
    shakeUntil: 0,
    shakeQueued: false,
    shakeSeed: Math.random() * 1000,
    prevAttackTime: 0,
    windupRemaining: 0,
    windupDuration: 0,
    lastX: 0,
    lastZ: 0,
    rest,
  };
}

// ---------- main per-frame system ----------

export function mobAnimationSystem(world: World, ctx: { dt: number; elapsed: number }): void {
  const now = ctx.elapsed;

  // Tick cape-sway shader uniforms once per frame.
  tickMobShaderUniforms(now);

  for (const e of world.query('mob')) {
    const anim = e.components.get(MOB_ANIM) as MobAnim | undefined;
    const runtime = e.components.get(MOB_RUNTIME) as MobRuntime | undefined;
    if (!anim || !runtime) continue;
    const arch = runtime.archetype;

    // Skip animation while dead — ai.ts owns the death tween.
    const brain = e.components.get(C.AIBrain) as AIBrainComponent | undefined;
    if (brain && brain.state === 'dead') continue;

    // Estimate horizontal movement speed.
    const px = e.object3d.position.x;
    const pz = e.object3d.position.z;
    const vx = (px - anim.lastX) / Math.max(0.001, ctx.dt);
    const vz = (pz - anim.lastZ) / Math.max(0.001, ctx.dt);
    anim.lastX = px;
    anim.lastZ = pz;
    const speed = Math.hypot(vx, vz);
    const moveT = e.components.get(C.MoveTarget) as MoveTargetComponent | undefined;
    const moving = !!moveT?.target && speed > 0.05;

    // Walk phase advances proportional to actual ground speed (with a floor so
    // it idles slightly even when stationary).
    const archFreq = ARCHETYPE_GAIT[arch.id]?.frequency ?? 4;
    const archAmp = ARCHETYPE_GAIT[arch.id]?.amplitude ?? 0.3;
    const phaseSpeed = moving ? archFreq * Math.min(1.4, speed / Math.max(0.5, arch.speed)) : 0.5;
    anim.walkPhase += ctx.dt * phaseSpeed;

    // Detect attack commit edges (lastAttackTime advanced).
    const combat = e.components.get(C.Combatant) as CombatantComponent | undefined;
    if (combat) {
      if (combat.lastAttackTime > anim.prevAttackTime + 1e-6) {
        // Commit edge — clear windup; the limb tween below handles the swing.
        anim.prevAttackTime = combat.lastAttackTime;
        anim.windupRemaining = 0;
      }
      // Predict an imminent swing while parked in attack state.
      if (brain && brain.state === 'attack') {
        const cooldown = 1 / Math.max(0.001, arch.attackSpeed);
        const sinceLast = now - combat.lastAttackTime;
        const windupLen = ARCHETYPE_GAIT[arch.id]?.windup ?? 0.3;
        if (cooldown - sinceLast <= windupLen && anim.windupRemaining <= 0) {
          anim.windupRemaining = windupLen;
          anim.windupDuration = windupLen;
        }
        if (anim.windupRemaining > 0) {
          anim.windupRemaining = Math.max(0, anim.windupRemaining - ctx.dt);
        }
      } else {
        anim.windupRemaining = 0;
      }
    }

    // Convert queued hit-shake into ctx.elapsed-based deadline.
    if (anim.shakeQueued) {
      anim.shakeQueued = false;
      anim.shakeUntil = now + 0.2;
    }

    // Apply per-archetype animation.
    applyArchetypeAnimation(e.object3d, anim, arch.id, anim.walkPhase, archAmp, moving, now);

    // Hit shake: brief positional jitter on the rig root.
    if (anim.shakeUntil > now) {
      const t = (anim.shakeUntil - now) / 0.2;
      const k = 0.06 * t;
      e.object3d.position.x += Math.sin(now * 73 + anim.shakeSeed) * k;
      e.object3d.position.z += Math.cos(now * 91 + anim.shakeSeed) * k;
    }
  }
}

// ---------- per-archetype gait + swing tuning ----------

interface GaitDef {
  frequency: number;   // walk-cycle radians/sec at full speed
  amplitude: number;   // limb swing magnitude
  windup: number;      // seconds of pre-swing telegraph
  bodyBob: number;     // extra vertical body bob for walk
}

const ARCHETYPE_GAIT: Record<ArchetypeId, GaitDef> = {
  'skeleton-warrior': { frequency: 7,  amplitude: 0.7, windup: 0.30, bodyBob: 0.04 },
  'skeleton-archer':  { frequency: 6,  amplitude: 0.6, windup: 0.40, bodyBob: 0.04 },
  'zombie':           { frequency: 3.2, amplitude: 0.45, windup: 0.20, bodyBob: 0.05 },
  'wraith':           { frequency: 2,  amplitude: 0.0, windup: 0.30, bodyBob: 0.0 },
  'brute':            { frequency: 2.6, amplitude: 0.55, windup: 0.60, bodyBob: 0.10 },
};

// Set transient pose; we lerp toward rest on idle.
function applyArchetypeAnimation(
  rig: Object3D,
  anim: MobAnim,
  id: ArchetypeId,
  phase: number,
  amp: number,
  moving: boolean,
  time: number,
): void {
  // Reset known parts to rest, then layer on motion. Cheap because rest map is small.
  for (const [name, r] of anim.rest) {
    const child = rig.getObjectByName(name);
    if (!child) continue;
    child.position.set(r.x, r.y, r.z);
    child.rotation.set(r.rx, r.ry, r.rz);
  }

  const sin = Math.sin(phase);
  const swing = moving ? sin * amp : 0;
  const counter = moving ? -sin * amp : 0;

  switch (id) {
    case 'skeleton-warrior':
      animateBiped(rig, anim, swing, counter, 0.04, time);
      animateMeleeSwing(rig, anim);
      break;
    case 'skeleton-archer':
      animateBiped(rig, anim, swing * 0.7, counter * 0.7, 0.03, time);
      // Archer limp: left leg phase shifted.
      animateLimp(rig, anim, phase);
      animateRangedDraw(rig, anim);
      break;
    case 'zombie':
      animateBiped(rig, anim, swing * 0.6, counter * 0.6, 0.05, time);
      animateLimp(rig, anim, phase);
      // Constant head loll.
      {
        const head = rig.getObjectByName('head');
        if (head) head.rotation.z += Math.sin(time * 1.3) * 0.12;
      }
      animateZombieBite(rig, anim);
      break;
    case 'wraith':
      // No biped legs — float bob handled by ai.ts. Sway arms gently.
      {
        const armL = rig.getObjectByName('armL');
        const armR = rig.getObjectByName('armR');
        if (armL) armL.rotation.z += Math.sin(time * 0.9) * 0.08;
        if (armR) armR.rotation.z += -Math.sin(time * 0.9 + 0.5) * 0.08;
      }
      animateWraithRaise(rig, anim);
      break;
    case 'brute':
      animateBiped(rig, anim, swing, counter, 0.10, time);
      animateBruteHeavyStep(rig, anim, phase);
      animateBruteAxe(rig, anim);
      break;
  }
}

// Generic biped: arms + legs counter-swing in XZ plane via X rotation.
function animateBiped(
  rig: Object3D,
  _anim: MobAnim,
  swing: number,
  counter: number,
  bobAmp: number,
  time: number,
): void {
  const armL = rig.getObjectByName('armL');
  const armR = rig.getObjectByName('armR');
  const legL = rig.getObjectByName('legL');
  const legR = rig.getObjectByName('legR');
  const torso = rig.getObjectByName('torso');
  if (armL) armL.rotation.x += swing;
  if (armR) armR.rotation.x += counter;
  if (legL) legL.rotation.x += counter;
  if (legR) legR.rotation.x += swing;
  if (torso) torso.position.y += Math.abs(Math.sin(time * 4)) * bobAmp;
}

// Limp: one leg drags (smaller swing, shifted phase). Applied AFTER animateBiped
// so we override its left-leg rotation slightly.
function animateLimp(rig: Object3D, _anim: MobAnim, phase: number): void {
  const legL = rig.getObjectByName('legL');
  if (!legL) return;
  // Replace the X rotation we just added with a damped, phase-offset version.
  const drag = Math.sin(phase * 0.6) * 0.18;
  legL.rotation.x += drag;
  legL.position.y += -0.04; // sit lower
}

// Skeleton warrior: sword swings during the windup-to-commit window.
function animateMeleeSwing(rig: Object3D, anim: MobAnim): void {
  const sword = rig.getObjectByName('sword');
  if (!sword) return;
  if (anim.windupRemaining > 0 && anim.windupDuration > 0) {
    const t = 1 - anim.windupRemaining / anim.windupDuration; // 0..1
    // Pull back early, then snap forward at the end.
    const angle = t < 0.7 ? -t * 1.0 : -0.7 + (t - 0.7) * (0.7 / 0.3) * 2.4;
    sword.rotation.x = -0.4 + angle;
  }
}

// Archer: pull right arm back during windup (drawing the bow).
function animateRangedDraw(rig: Object3D, anim: MobAnim): void {
  const armR = rig.getObjectByName('armR');
  if (!armR) return;
  if (anim.windupRemaining > 0 && anim.windupDuration > 0) {
    const t = 1 - anim.windupRemaining / anim.windupDuration;
    armR.rotation.x += -t * 0.9;
    armR.position.z += -t * 0.15;
  }
}

// Zombie: lurch head forward during attack windup (the bite).
function animateZombieBite(rig: Object3D, anim: MobAnim): void {
  const head = rig.getObjectByName('head');
  if (!head) return;
  if (anim.windupRemaining > 0 && anim.windupDuration > 0) {
    const t = 1 - anim.windupRemaining / anim.windupDuration;
    head.position.z += t * 0.25;
    head.rotation.x += -t * 0.25;
  }
}

// Wraith: raise both arms during cast.
function animateWraithRaise(rig: Object3D, anim: MobAnim): void {
  if (anim.windupRemaining <= 0 || anim.windupDuration <= 0) return;
  const t = 1 - anim.windupRemaining / anim.windupDuration;
  const armL = rig.getObjectByName('armL');
  const armR = rig.getObjectByName('armR');
  if (armL) armL.rotation.z += -t * 0.6;
  if (armR) armR.rotation.z += t * 0.6;
}

// Brute: heavy axe windup + commit.
function animateBruteAxe(rig: Object3D, anim: MobAnim): void {
  const axe = rig.getObjectByName('axe');
  const armR = rig.getObjectByName('armR');
  if (!axe) return;
  if (anim.windupRemaining > 0 && anim.windupDuration > 0) {
    const t = 1 - anim.windupRemaining / anim.windupDuration;
    // Long pull-back, big commit forward.
    const angle = t < 0.75 ? -t * 1.4 : -1.05 + (t - 0.75) * 4.4 * 1.2;
    axe.rotation.x += angle;
    if (armR) armR.rotation.x += angle * 0.5;
  }
}

// Brute heavy step: ground stomp shudder synced to walk phase peaks.
function animateBruteHeavyStep(rig: Object3D, _anim: MobAnim, phase: number): void {
  const stomp = Math.max(0, Math.sin(phase * 2)) * 0.08;
  rig.position.y -= stomp; // tiny dip on planted foot
}

// ---------- damage hit-shake hookup ----------

// Wired from initMobs. The handler only sets a flag — the next animation
// tick converts it to a ctx.elapsed-based deadline so we don't mix clocks
// (world.elapsed is private and not equal to performance.now()).
export function registerHitShake(world: World): void {
  world.on('damage:dealt', (payload) => {
    const target = world.get(payload.targetId);
    if (!target || !target.tags.has('mob')) return;
    const anim = target.components.get(MOB_ANIM) as MobAnim | undefined;
    if (!anim) return;
    anim.shakeQueued = true;
  });
}
