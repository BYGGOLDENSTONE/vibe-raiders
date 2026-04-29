// Local identity helpers — username + derived color, persisted in localStorage.
// Multiplayer uses a stable name across sessions so visiting judges see the same wanderer.

const NAME_KEY = 'dusk:name';

// Gothic palette — warm browns, pale gold, dim purple, ember red, slate blue.
// Color is picked deterministically from the username so the same name always
// renders with the same hue.
const PALETTE: number[] = [
  0xc8a060, // pale gold
  0x8a6a30, // warm brown
  0x6a4ec8, // dim purple
  0xc04040, // ember red
  0x5a78c8, // slate blue
  0x8a9080, // sage
  0xb89070, // tan
  0x9a4870, // wine
  0x4a8060, // moss
  0xa07050, // bronze
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

export function colorForName(name: string): number {
  if (!name) return PALETTE[0]!;
  const idx = hashString(name) % PALETTE.length;
  return PALETTE[idx] ?? PALETTE[0]!;
}

function randomHex4(): string {
  const v = Math.floor(Math.random() * 0x10000);
  return v.toString(16).toUpperCase().padStart(4, '0');
}

export function generateRandomName(): string {
  return `Wanderer-${randomHex4()}`;
}

export function loadStoredName(): string | null {
  try {
    const v = localStorage.getItem(NAME_KEY);
    if (typeof v === 'string' && v.trim().length > 0) return v.trim().slice(0, 24);
    return null;
  } catch {
    return null;
  }
}

export function persistName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.slice(0, 24));
  } catch {
    // Storage may be blocked; non-fatal.
  }
}
