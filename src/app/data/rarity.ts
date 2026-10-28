export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];

export interface RarityDef {
  id: Rarity;
  label: [string, string];
  /** Power budget for signatures, quirks and evolutions (used from Phase 4 on). */
  budget: number;
  /** Quirk slots as [min, max]. */
  quirkSlots: [number, number];
  /** Evolution steps a signature can climb. */
  evolutionSteps: number;
  /** Upper bound of the (adjusted) roll for this tier; common takes the rest. */
  threshold: number;
  /** Frame and gem colour; mythic additionally uses the iridescent gradient from the tokens. */
  color: string;
  /** Colour of the match aura ring. */
  aura: string;
}

/** 68 / 22 / 7.5 / 2.2 / 0.3 % before the potential nudge. */
export const RARITY_DEFS: Record<Rarity, RarityDef> = {
  common: { id: 'common', label: ['Gewöhnlich', 'Common'], budget: 2, quirkSlots: [1, 1], evolutionSteps: 2, threshold: 1, color: '#8fa3b8', aura: '#8fa3b8' },
  rare: { id: 'rare', label: ['Selten', 'Rare'], budget: 3, quirkSlots: [1, 2], evolutionSteps: 2, threshold: 0.32, color: '#38b6ff', aura: '#38b6ff' },
  epic: { id: 'epic', label: ['Episch', 'Epic'], budget: 4, quirkSlots: [2, 2], evolutionSteps: 2, threshold: 0.1, color: '#a66bff', aura: '#a66bff' },
  legendary: { id: 'legendary', label: ['Legendär', 'Legendary'], budget: 5, quirkSlots: [2, 3], evolutionSteps: 3, threshold: 0.025, color: '#ffc83d', aura: '#ffc83d' },
  mythic: { id: 'mythic', label: ['Mythisch', 'Mythic'], budget: 6, quirkSlots: [3, 3], evolutionSteps: 3, threshold: 0.003, color: '#ff5fd2', aura: '#7cf7ff' },
};

/** Players of this tier or better get a nickname and an aura in the match. */
export const AURA_FROM: Rarity = 'epic';
/** At most this many mythic players exist in one world. */
export const MYTHIC_WORLD_CAP = 3;

export function rarityRank(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

export function atLeast(rarity: Rarity, minimum: Rarity): boolean {
  return rarityRank(rarity) >= rarityRank(minimum);
}
