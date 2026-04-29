// Mid-tone, low-saturation neutrals so the 4-phase atmosphere lighting can recolor the city.

export const PALETTE = {
  concrete: 0x6a6258,
  asphalt: 0x2f2c28,
  rust: 0x8a4d2a,
  brick: 0x5a3a2a,
  metal: 0x4a4848,
  debris: 0x4a3a2a,
  fireGlow: 0xffaa3a,
  shelterAccent: 0x4aff66,
} as const;

export type PaletteKey = keyof typeof PALETTE;
