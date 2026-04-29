// Element palette + per-element particle behavior knobs.
// Used by trails / decals / skill-FX so each school has a consistent look.

export type ElementKind =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'poison'
  | 'arcane'
  | 'physical'
  | 'shadow'
  | 'holy';

export const ELEMENT_COLORS: Record<ElementKind, number> = {
  fire: 0xff5020,
  ice: 0x80c0ff,
  lightning: 0x40e0ff,
  poison: 0x80ff40,
  arcane: 0xc060ff,
  physical: 0xe0d8c0,
  shadow: 0x6040a0,
  holy: 0xfff0a0,
};

// Secondary "core" tint — used for inner glow / highlight.
export const ELEMENT_CORE_COLORS: Record<ElementKind, number> = {
  fire: 0xffe0a0,
  ice: 0xe0f8ff,
  lightning: 0xffffff,
  poison: 0xc0ffa0,
  arcane: 0xffd0ff,
  physical: 0xffffff,
  shadow: 0xc0a0ff,
  holy: 0xffffff,
};

export interface ParticleBehavior {
  // Vertical bias on velocity at spawn (positive = rises).
  riseBias: number;
  // Random jitter strength per frame (used for lightning).
  jitter: number;
  // Gravity applied to particles (negative = float up).
  gravity: number;
  // Drag.
  drag: number;
  // Flicker frequency on alpha.
  flickerHz: number;
  // Trail base lifetime multiplier.
  lifetimeMult: number;
}

export const ELEMENT_PARTICLE_BEHAVIOR: Record<ElementKind, ParticleBehavior> = {
  fire:      { riseBias: 2.5,  jitter: 0.0,  gravity: -1.5, drag: 1.5, flickerHz: 18, lifetimeMult: 1.0 },
  ice:       { riseBias: -0.5, jitter: 0.0,  gravity:  3.0, drag: 1.8, flickerHz: 0,  lifetimeMult: 1.2 },
  lightning: { riseBias: 0.4,  jitter: 6.0,  gravity:  0.0, drag: 4.0, flickerHz: 40, lifetimeMult: 0.7 },
  poison:    { riseBias: 0.6,  jitter: 0.4,  gravity: -0.8, drag: 1.2, flickerHz: 4,  lifetimeMult: 1.4 },
  arcane:    { riseBias: 1.0,  jitter: 0.5,  gravity: -1.0, drag: 1.6, flickerHz: 8,  lifetimeMult: 1.0 },
  physical:  { riseBias: 0.5,  jitter: 0.0,  gravity:  6.0, drag: 2.5, flickerHz: 0,  lifetimeMult: 0.7 },
  shadow:    { riseBias: 0.0,  jitter: 0.3,  gravity: -0.4, drag: 1.4, flickerHz: 6,  lifetimeMult: 1.3 },
  holy:      { riseBias: 1.5,  jitter: 0.0,  gravity: -1.2, drag: 1.5, flickerHz: 0,  lifetimeMult: 1.1 },
};

// Map a skill id to an element. Pattern-match on common substrings; returns
// 'physical' as the safe default.
export function elementFromSkillId(skillId: string): ElementKind {
  const id = skillId.toLowerCase();
  if (id.includes('fire') || id.includes('meteor') || id.includes('burn') || id.includes('flame')) return 'fire';
  if (id.includes('ice') || id.includes('frost') || id.includes('frozen') || id.includes('nova') && !id.includes('arcane')) return 'ice';
  if (id.includes('lightning') || id.includes('chain') || id.includes('zap') || id.includes('shock')) return 'lightning';
  if (id.includes('poison') || id.includes('toxic') || id.includes('venom')) return 'poison';
  if (id.includes('bolt') || id.includes('arcane') || id.includes('blink') || id.includes('meteor')) return 'arcane';
  if (id.includes('shadow') || id.includes('smoke') || id.includes('dark') || id.includes('black-hole')) return 'shadow';
  // Class fallbacks.
  if (id.startsWith('rogue:')) return 'physical';
  if (id.startsWith('barb:')) return 'physical';
  if (id.startsWith('sorc:')) return 'arcane';
  return 'physical';
}

export function colorFor(element: ElementKind): number {
  return ELEMENT_COLORS[element];
}

export function coreColorFor(element: ElementKind): number {
  return ELEMENT_CORE_COLORS[element];
}
