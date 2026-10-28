import { PlayerArchetype } from '../models/player.model';
import { Rarity } from './rarity';

/** The two stages a signature can climb after its first form. */
export interface EvolutionStage {
  /** Level of the signature this stage leads to. */
  to: 2 | 3;
  /** Impact points needed: activations + shots while awake + 3 per goal scored while awake. */
  points: number;
  /** Minimum player level. */
  playerLevel: number;
  /** Lowest rarity that may take the step. */
  minRarity: Rarity;
}

export const EVOLUTION_STAGES: EvolutionStage[] = [
  { to: 2, points: 40, playerLevel: 10, minRarity: 'common' },
  { to: 3, points: 120, playerLevel: 18, minRarity: 'rare' },
];

/** Impact points of one match line of a signature. */
export function impactPoints(progress: { activations: number; shots: number; goals: number }): number {
  return progress.activations + progress.shots + progress.goals * 3;
}

/**
 * Stage II has two branches: A makes the effects stronger, B keeps them awake longer and lets them
 * come back sooner (conditions get a smaller boost plus cheaper running). Names are flavoured per archetype.
 */
export const PATH_NAMES: Record<PlayerArchetype, { a: [string, string]; b: [string, string] }> = {
  speedster: { a: ['Sternschnuppe', 'Shooting Star'], b: ['Meteor', 'Meteor'] },
  finisher: { a: ['Scharfschütze', 'Sharpshooter'], b: ['Dauerfeuer', 'Barrage'] },
  playmaker: { a: ['Präzision', 'Precision'], b: ['Taktstock', 'Baton'] },
  creator: { a: ['Meisterwerk', 'Masterpiece'], b: ['Showzeit', 'Showtime'] },
  stopper: { a: ['Bollwerk', 'Bulwark'], b: ['Wachposten', 'Sentinel'] },
  'ball-player': { a: ['Feinmechanik', 'Fine Mechanics'], b: ['Spielfluss', 'Flow'] },
  runner: { a: ['Turbine', 'Turbine'], b: ['Marathon', 'Marathon'] },
  'ball-winner': { a: ['Biss', 'Bite'], b: ['Meute', 'Pack'] },
  'box-to-box': { a: ['Kraftpaket', 'Powerhouse'], b: ['Ausdauerwunder', 'Endurance Marvel'] },
  'shot-stopper': { a: ['Reflexwunder', 'Reflex Marvel'], b: ['Dauerwache', 'Constant Watch'] },
  sweeper: { a: ['Antizipation', 'Anticipation'], b: ['Weitsicht', 'Far Sight'] },
  distributor: { a: ['Präzisionswurf', 'Precision Throw'], b: ['Schnellstart', 'Quick Start'] },
};

export const PATH_TEXT = {
  a: ['Pfad A: Die Wirkung ist 25 % stärker.', 'Path A: the effects are 25 % stronger.'] as [string, string],
  b: ['Pfad B: Bleibt länger aktiv (+50 %) und kehrt früher zurück (−30 % Abklingzeit); Situations-Signaturen werden 10 % stärker.', 'Path B: stays awake longer (+50 %) and returns sooner (−30 % cooldown); situational signatures get 10 % stronger.'] as [string, string],
};

/** One rarity step per career, earned by a standout achievement at the end of a season. */
export interface AscensionReason {
  id: 'top-scorer' | 'mvp-season' | 'club-legend';
  text: [string, string];
}

export const ASCENSION_REASONS: AscensionReason[] = [
  { id: 'top-scorer', text: ['Torschützenkönig der Liga', 'Top scorer of the league'] },
  { id: 'mvp-season', text: ['Fünfmal Spieler des Spiels in einer Saison', 'Five man-of-the-match awards in one season'] },
  { id: 'club-legend', text: ['100 Pflichtspiele für den Verein', '100 competitive appearances for the club'] },
];

/** Mythic cannot be reached by ascension; only the world roll creates it. */
export const ASCENSION_CAP: Rarity = 'legendary';
