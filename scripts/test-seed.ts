import { generateGalaxy } from '../src/game/economy/seed.ts';

const a = generateGalaxy(566413715);
const b = generateGalaxy(566413715);
const c = generateGalaxy(7);

console.log('seed=' + a.seed + ' planets=' + a.planets.length + ' sectors=' + a.sectorCenters.length);
console.log('homes assigned: ' + a.sectorHomeIds.size);
console.log('first 5 planets:');
for (let i = 0; i < 5; i++) {
  const p = a.planets[i];
  console.log('  ' + p.id + ' ' + p.name + ' kind=' + p.kind + ' sector=' + p.sectorId
    + (p.isHomeOfSector ? ' [HOME]' : '') + (p.isNeutral ? ' [NEUTRAL]' : ''));
}

const aIds = a.planets.map((p) => p.id + '|' + p.name + '|' + p.kind).join(',');
const bIds = b.planets.map((p) => p.id + '|' + p.name + '|' + p.kind).join(',');
const cIds = c.planets.map((p) => p.id + '|' + p.name + '|' + p.kind).join(',');
console.log('deterministic same-seed: ' + (aIds === bIds));
console.log('different-seed differs:  ' + (aIds !== cIds));

const counts: Record<string, number> = {};
for (const p of a.planets) counts[p.kind] = (counts[p.kind] || 0) + 1;
console.log('kind counts: ' + JSON.stringify(counts));

let missingHome = 0;
for (let s = 0; s < 16; s++) if (!a.sectorHomeIds.has(s)) missingHome++;
console.log('sectors missing home: ' + missingHome);

let neutrals = 0;
for (const p of a.planets) if (p.isNeutral) neutrals++;
console.log('neutrals: ' + neutrals);
