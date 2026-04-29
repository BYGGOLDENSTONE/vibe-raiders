// Procedural walk + attack swing for the player rig. No skeletal data — we
// just tween the children of the rig group every frame based on the current
// movement speed and a (potentially active) attack swing.
//
// Used exclusively by player/index.ts.

import { MathUtils, type Group, type Mesh, type Object3D } from 'three';

export interface PlayerRig {
  root: Group;            // entity.object3d — the parent that locomotion moves
  body: Group;            // bob target (head + torso + arms + legs ride this)
  head: Object3D;
  torso: Object3D;
  leftArm: Object3D;
  rightArm: Object3D;
  leftLeg: Object3D;
  rightLeg: Object3D;
  cape: Object3D;
  weapon: Object3D | null;
  // Constants picked at rig-build time.
  armRestX: number;
  legRestX: number;
  hasOffhand: boolean;    // rogue dual-wields, attack-anim mirrors to leftArm
}

export interface PlayerAnimState {
  phase: number;             // gait phase accumulator
  attackEndTime: number;     // 0 if no swing in flight
  attackStartTime: number;
  attackDuration: number;
  deathStartTime: number;    // 0 if alive
  deathDuration: number;
  alive: boolean;
}

export function createAnimState(): PlayerAnimState {
  return {
    phase: 0,
    attackEndTime: 0,
    attackStartTime: 0,
    attackDuration: 0,
    deathStartTime: 0,
    deathDuration: 1.0,
    alive: true,
  };
}

const MAX_SPEED = 8; // matches TUNING.playerBaseSpeed
const TARGET_BOB = 0.04;

// Smooth cubic ease-out used for swing arc.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function updatePlayerAnimation(
  rig: PlayerRig,
  state: PlayerAnimState,
  dt: number,
  elapsed: number,
  speed: number,
): void {
  // ---------- Death takeover ----------
  if (!state.alive) {
    if (state.deathStartTime <= 0) state.deathStartTime = elapsed;
    const t = Math.min(1, (elapsed - state.deathStartTime) / state.deathDuration);
    rig.body.rotation.z = (Math.PI / 2) * easeOutCubic(t);
    rig.body.position.y = MathUtils.lerp(0, -0.5, easeOutCubic(t));
    // Dissolve via material opacity if the meshes opt in.
    if (t > 0.4) {
      const fade = MathUtils.smoothstep(t, 0.4, 1.0);
      applyOpacity(rig.body, 1 - fade);
    }
    return;
  } else if (state.deathStartTime > 0) {
    // Reset on respawn.
    state.deathStartTime = 0;
    rig.body.rotation.z = 0;
    rig.body.position.y = 0;
    applyOpacity(rig.body, 1);
  }

  const speedFactor = Math.max(0, Math.min(1, speed / MAX_SPEED));
  // Frequency: idle~4 rad/s breathing; running ramps to ~16 rad/s gait.
  const freq = 4 + speedFactor * 12;
  state.phase += dt * freq;

  // Are we mid-swing? Damp walk swing if so.
  let attackProgress = -1;
  if (state.attackEndTime > 0) {
    const total = state.attackDuration;
    const local = (elapsed - state.attackStartTime) / total;
    if (local >= 1) {
      state.attackEndTime = 0;
      attackProgress = -1;
    } else {
      attackProgress = local;
    }
  }
  const walkDamp = attackProgress >= 0 ? 0.3 : 1.0;

  // ---------- Body bob ----------
  const bob = Math.sin(state.phase * 2) * TARGET_BOB * speedFactor;
  rig.body.position.y = bob;
  rig.head.rotation.x = Math.sin(state.phase * 2 + 0.3) * 0.04 * speedFactor;
  rig.torso.rotation.y = Math.sin(state.phase) * 0.06 * speedFactor;

  // ---------- Limb swings ----------
  const armSwing = Math.sin(state.phase) * 0.6 * speedFactor * walkDamp;
  rig.leftArm.rotation.x = rig.armRestX + armSwing;
  // Weapon-side arm swings less; mirrored phase for natural opposite gait.
  const weaponArmDamp = rig.weapon ? 0.5 : 1.0;
  rig.rightArm.rotation.x = rig.armRestX - armSwing * weaponArmDamp;

  const legSwing = Math.sin(state.phase) * 0.5 * speedFactor;
  rig.leftLeg.rotation.x = rig.legRestX - legSwing;
  rig.rightLeg.rotation.x = rig.legRestX + legSwing;

  // Slight cape sway on top of shader sway — more pronounced lean during run.
  rig.cape.rotation.x = -0.1 - speedFactor * 0.25;
  rig.cape.rotation.z = Math.sin(state.phase * 0.5) * 0.04 * speedFactor;

  // ---------- Attack swing override ----------
  if (attackProgress >= 0) {
    // Arc 0 → -1.6 rad → 0 (forward overhead chop). Use a sin curve so it
    // both rises and returns within the duration.
    const arc = Math.sin(attackProgress * Math.PI) * -1.6;
    rig.rightArm.rotation.x = rig.armRestX + arc;
    if (rig.hasOffhand) {
      // Rogue: stagger left-hand swing slightly behind for a 2-hit feel.
      const lateral = Math.sin(Math.max(0, attackProgress - 0.15) * Math.PI) * -1.4;
      rig.leftArm.rotation.x = rig.armRestX + lateral;
    }
    if (rig.weapon) {
      rig.weapon.rotation.x = arc * 0.5;
    }
  } else if (rig.weapon) {
    // Resting weapon angle.
    rig.weapon.rotation.x = 0;
  }
}

export function triggerAttackSwing(
  state: PlayerAnimState,
  elapsedNow: number,
  durationMs = 250,
): void {
  // Don't interrupt an active swing in its first 60% — feels less janky.
  if (state.attackEndTime > 0) {
    const total = state.attackDuration;
    const localProgress = (elapsedNow - state.attackStartTime) / total;
    if (localProgress < 0.6) return;
  }
  state.attackStartTime = elapsedNow;
  state.attackDuration = durationMs / 1000;
  state.attackEndTime = elapsedNow + state.attackDuration;
}

export function setAlive(state: PlayerAnimState, alive: boolean): void {
  state.alive = alive;
  if (alive) state.deathStartTime = 0;
}

// Walk helper: walk all descendant Mesh materials and set transparent + opacity.
function applyOpacity(root: Object3D, opacity: number): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
        m.needsUpdate = true;
      }
    } else if (mat) {
      mat.transparent = opacity < 1;
      mat.opacity = opacity;
      mat.needsUpdate = true;
    }
  });
}
