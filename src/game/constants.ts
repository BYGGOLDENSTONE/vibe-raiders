// Globally tunable knobs. Keep raw numbers out of module code where possible.

export const GAME_NAME = 'DUSK';

export const COLORS = {
  bgFog: 0x1a1825,
  ambient: 0x9a8ab0,
  moonlight: 0xc0c8e8,
  ground: 0x4a4350,
  player: 0xc8a060,
  hostile: 0xa03030,
  boss: 0xff5020,
  loot: {
    common: 0xb8b8b8,
    magic: 0x4080ff,
    rare: 0xffd040,
    legendary: 0xff6020,
  },
  ui: {
    text: 0xd8dde4,
    dim: 0x6a7480,
    danger: 0xc04040,
    accent: 0xc8a060,
  },
} as const;

export const TUNING = {
  playerBaseHp: 100,
  playerBaseSpeed: 8,
  playerPickupRadius: 1.4,

  mobBaseHp: 30,
  mobBaseSpeed: 4,
  mobBaseDamage: 6,
  mobAggroRadius: 8,
  mobLeashRadius: 16,

  worldRadius: 220,
  hubRadius: 30,
  dungeonRoomCount: 5,

  basicAttackCooldown: 0.4, // s
  skillBaseCooldown: 6, // s
  ultCooldown: 30, // s
  dashCooldown: 4, // s

  invulnAfterHit: 0.3, // s
  hitstopBaseDuration: 0.06, // s

  xpPerKill: 10,
} as const;

export const CAMERA = {
  // Diablo IV-like angled iso. Camera sits behind/above player and pitches down.
  offsetY: 18,
  offsetZ: 14,
  lookAheadDistance: 0,
  followLerp: 6,
  fov: 50,
} as const;
