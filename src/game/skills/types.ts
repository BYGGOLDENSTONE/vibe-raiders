// Shared types for the skills module.

import type { Vector3 } from 'three';
import type { Entity } from '../../core/types';
import type { World } from '../../core/world';
import type { ClassId } from '../../core/components';

export interface SkillCastTarget {
  x: number;
  z: number;
  // Convenience pre-computed direction from caster on the XZ plane (unit vector).
  // If the target is the caster's position, dir is zero.
  dir: Vector3;
  distance: number;
}

export type SkillCastFn = (caster: Entity, world: World, target: SkillCastTarget) => void;

export interface Skill {
  id: string;
  name: string;
  classId: ClassId;
  slotIndex: number; // 0 basic, 1-3 actives, 4 ult, 5 dash
  cooldown: number; // seconds
  cost: number; // resource cost (energy/rage/mana)
  range: number; // max horizontal range from caster the skill can be aimed
  // Some skills bypass range (self-buff, channel around caster). They set range to 0 / Infinity.
  cast: SkillCastFn;
}
