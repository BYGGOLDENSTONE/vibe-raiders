// This module has been moved to src/world/biomes/city.ts as part of the
// multi-biome world architecture. The orchestrator in src/world/map.ts
// is now the entry point for world generation.
//
// Kept as an empty module for any leftover imports during the transition.
//
// Re-export the new biome builder if anything still imports from here.

export { buildCityBiome } from './biomes/city';
