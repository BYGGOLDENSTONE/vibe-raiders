// Mid-tone, low-saturation neutrals so the 4-phase atmosphere lighting can recolor everything.
// Extended for the multi-biome world (city / industrial / dam / forest / mountain).

export const PALETTE = {
  // Original city palette
  concrete: 0x6a6258,
  asphalt: 0x2f2c28,
  rust: 0x8a4d2a,
  brick: 0x5a3a2a,
  metal: 0x4a4848,
  debris: 0x4a3a2a,
  fireGlow: 0xffaa3a,
  shelterAccent: 0x4aff66,

  // Ground tints (vertex-color base)
  groundDirt: 0x5a4838,
  groundDirtDeep: 0x3a2c20,
  groundDirtPeak: 0x7a6a5a,
  groundConcrete: 0x787268,
  groundForest: 0x4a4234,
  groundMountain: 0x6e6862,
  groundDamFloor: 0x5a564e,

  // Industrial
  hangarSteel: 0x5e6166,
  hangarRoof: 0x4a4640,
  containerA: 0x6e4a3a,   // rust-orange container
  containerB: 0x4a5a52,   // teal container
  containerC: 0x6a6a58,   // olive container
  containerD: 0x504848,   // gray container
  pipeRust: 0x7a4a30,
  catwalkMetal: 0x5a5448,
  smokestackSoot: 0x3c3834,
  fuelTank: 0x6a6e6c,

  // Dam
  damConcrete: 0x787068,
  damConcreteDark: 0x504a44,
  pumpHouse: 0x6e6660,
  boatPaint: 0x6a5a4c,
  boatHull: 0x4a4842,
  powerPole: 0x6a5a48,

  // Forest
  forestBark: 0x2a2420,       // charred trunk
  forestEmber: 0xff6a1a,
  forestMoss: 0x4a5a3a,
  forestLog: 0x3a2e24,
  cabinWood: 0x4a382a,
  cabinRoof: 0x3a2e24,
  boulder: 0x55504a,

  // Mountain
  mountainRock: 0x6a6660,
  mountainRockDark: 0x4a4844,
  mountainRockLight: 0x827e76,
  observatoryShell: 0x5a5048,
  observatoryGlow: 0xff2a32,

  // Distant silhouettes
  distantSilhouette: 0x1a1820,
  distantMountain: 0x232028,
} as const;

export type PaletteKey = keyof typeof PALETTE;
