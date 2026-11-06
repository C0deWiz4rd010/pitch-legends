import { CosmeticSlot, MetaState } from '../../models/meta.model';

/**
 * The Legends Path: profile experience from every mode opens cosmetic rewards. Cosmetics are only ever drawn
 * (boot colours, a cheer, the ball, the look of the ground, a kit pattern for the managed club); nothing here is
 * read by the simulation or the effect pipeline, so no reward can make a team stronger.
 */
export const PATH_MAX_LEVEL = 30;

/** Experience from level `level` to the next one: 80 for the first, 40 more for each level after. */
export function xpForLevel(level: number): number {
  return 80 + 40 * (Math.max(1, level) - 1);
}

/** Total experience needed to be at the start of `level`. */
export function xpToReach(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, PATH_MAX_LEVEL); l++) total += xpForLevel(l);
  return total;
}

export function levelFor(xp: number): number {
  let level = 1;
  while (level < PATH_MAX_LEVEL && xp >= xpToReach(level + 1)) level++;
  return level;
}

export interface PathProgress {
  level: number;
  /** Experience inside the current level and what the level costs; both 0 at the top. */
  into: number;
  needed: number;
  percent: number;
}

export function pathProgress(xp: number): PathProgress {
  const level = levelFor(xp);
  if (level >= PATH_MAX_LEVEL) return { level, into: 0, needed: 0, percent: 100 };
  const into = xp - xpToReach(level);
  const needed = xpForLevel(level);
  return { level, into, needed, percent: Math.round((into / needed) * 100) };
}

export interface CosmeticDef {
  slot: CosmeticSlot;
  id: string;
  /** Level of the Legends Path that opens it; 1 is open from the start. */
  level: number;
  name: [string, string];
  /** What it looks like: a colour, a celebration number or a kit pattern. Read only by the renderer. */
  value: string;
}

export const COSMETICS: CosmeticDef[] = [
  // Boot colours (the first six are in core/rpg/equipment.ts and open from the start).
  { slot: 'boots', id: 'aurora', level: 2, name: ['Polarlicht', 'Aurora'], value: '#7ee8c9' },
  { slot: 'boots', id: 'lava', level: 8, name: ['Lava', 'Lava'], value: '#ff4d2e' },
  { slot: 'boots', id: 'royal', level: 14, name: ['Königlich', 'Royal'], value: '#7a4dff' },
  { slot: 'boots', id: 'chrome', level: 20, name: ['Chrom', 'Chrome'], value: '#c9d3dc' },
  { slot: 'boots', id: 'prism', level: 27, name: ['Prisma', 'Prism'], value: '#ff7ad9' },
  // Cheers of the managed club's scorers; the number is the celebration of the pose library.
  { slot: 'cheer', id: 'pump', level: 3, name: ['Faustjubel', 'Fist pump'], value: '3' },
  { slot: 'cheer', id: 'slide', level: 9, name: ['Knierutsche', 'Knee slide'], value: '1' },
  { slot: 'cheer', id: 'plane', level: 13, name: ['Flieger', 'Aeroplane'], value: '2' },
  { slot: 'cheer', id: 'pose', level: 19, name: ['Siegerpose', 'Winner pose'], value: '4' },
  { slot: 'cheer', id: 'dance', level: 25, name: ['Tanz', 'Dance'], value: '5' },
  // The ball: the colour of its panels and of its body.
  { slot: 'ball', id: 'neon', level: 5, name: ['Neon', 'Neon'], value: '#ff3da8|#f4fff3' },
  { slot: 'ball', id: 'gold', level: 15, name: ['Gold', 'Gold'], value: '#8a6a12|#ffe9a6' },
  { slot: 'ball', id: 'night', level: 21, name: ['Nacht', 'Night'], value: '#e8f0ff|#1b2338' },
  { slot: 'ball', id: 'ember', level: 28, name: ['Glut', 'Ember'], value: '#ff7a1c|#2b2220' },
  // The look of the ground: the colour of the boards and flags.
  { slot: 'decor', id: 'club', level: 7, name: ['Vereinsfarben', 'Club colours'], value: 'club' },
  { slot: 'decor', id: 'neon', level: 17, name: ['Neonlicht', 'Neon light'], value: '#52d1ff' },
  { slot: 'decor', id: 'royal', level: 23, name: ['Königsviolett', 'Royal purple'], value: '#b58cff' },
  // Kit patterns for the managed club's outfield players.
  { slot: 'kit', id: 'stripes', level: 6, name: ['Längsstreifen', 'Stripes'], value: 'stripes' },
  { slot: 'kit', id: 'hoops', level: 11, name: ['Ringel', 'Hoops'], value: 'hoops' },
  { slot: 'kit', id: 'sash', level: 18, name: ['Schärpe', 'Sash'], value: 'sash' },
  { slot: 'kit', id: 'chevron', level: 24, name: ['Winkel', 'Chevron'], value: 'chevron' },
  { slot: 'kit', id: 'pinstripes', level: 29, name: ['Nadelstreifen', 'Pinstripes'], value: 'pinstripes' },
];

export const COSMETIC_SLOTS: CosmeticSlot[] = ['boots', 'cheer', 'ball', 'decor', 'kit'];

export function cosmeticsOf(slot: CosmeticSlot): CosmeticDef[] {
  return COSMETICS.filter((cosmetic) => cosmetic.slot === slot);
}

export function cosmeticById(slot: CosmeticSlot, id: string | undefined): CosmeticDef | undefined {
  return id ? COSMETICS.find((cosmetic) => cosmetic.slot === slot && cosmetic.id === id) : undefined;
}

export function isCosmeticUnlocked(meta: Pick<MetaState, 'xp'>, cosmetic: CosmeticDef): boolean {
  return levelFor(meta.xp) >= cosmetic.level;
}

/** Cosmetics a level opens. */
export function rewardsOfLevel(level: number): CosmeticDef[] {
  return COSMETICS.filter((cosmetic) => cosmetic.level === level);
}

/** Wears a cosmetic (or `null` to go back to the default look of the slot). Only an unlocked one can be worn. */
export function equipCosmetic(meta: MetaState, slot: CosmeticSlot, id: string | null): boolean {
  if (id === null) {
    delete meta.equipped[slot];
    return true;
  }
  const cosmetic = cosmeticById(slot, id);
  if (!cosmetic || !isCosmeticUnlocked(meta, cosmetic)) return false;
  meta.equipped[slot] = id;
  return true;
}

/** What the renderer is asked to draw: the worn cosmetics that are still unlocked. */
export function wornCosmetics(meta: MetaState): Partial<Record<CosmeticSlot, CosmeticDef>> {
  const worn: Partial<Record<CosmeticSlot, CosmeticDef>> = {};
  for (const slot of COSMETIC_SLOTS) {
    const cosmetic = cosmeticById(slot, meta.equipped[slot]);
    if (cosmetic && isCosmeticUnlocked(meta, cosmetic)) worn[slot] = cosmetic;
  }
  return worn;
}
