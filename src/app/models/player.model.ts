import { AttributeKey, Foot, Position, PositionGroup } from './enums';
import { PlayerVisualIdentity } from './visual.model';
import type { EffectSpec } from '../core/rpg/effects';
import type { Rarity } from '../data/rarity';
import type { Nickname } from '../data/nicknames';

/** A trait/perk that modifies a player's match behaviour. */
export interface Trait {
  id: string;
  name: string;
  description: string;
  /** Attribute the trait is thematically tied to (for UI grouping). */
  category: AttributeKey | 'mental';
  /** Flat modifiers applied to effective match rating in relevant phases. */
  modifiers: Partial<Record<AttributeKey, number>>;
  /** What the live match applies, each under the condition the description promises. */
  effects?: EffectSpec[];
  /** Level at which the trait becomes available to unlock. */
  unlockLevel: number;
}

export type PlayerAttributes = Record<AttributeKey, number>;

export type PlayerArchetype =
  | 'shot-stopper'
  | 'sweeper'
  | 'distributor'
  | 'stopper'
  | 'ball-player'
  | 'runner'
  | 'ball-winner'
  | 'playmaker'
  | 'box-to-box'
  | 'finisher'
  | 'creator'
  | 'speedster';

export type DevelopmentPlan = 'balanced' | 'technical' | 'physical' | 'position';
export type PlayerPersonality = 'professional' | 'driven' | 'flair' | 'team-player' | 'volatile';

export interface PersonalGoal {
  type: 'appearances' | 'goals' | 'assists' | 'clean-sheets' | 'rating';
  target: number;
  progress: number;
  rewardXp: number;
  completed: boolean;
}

export type InjuryArea = 'head' | 'shoulder' | 'back' | 'groin' | 'hamstring' | 'knee' | 'calf' | 'ankle' | 'foot';
export type InjurySeverity = 'minor' | 'moderate' | 'serious';
export type InjuryCause = 'contact' | 'non-contact' | 'training' | 'travel' | 'legacy';
export type RehabPlan = 'conservative' | 'standard' | 'accelerated';

export interface InjuryRecord {
  id: string;
  diagnosisId: string;
  area: InjuryArea;
  severity: InjurySeverity;
  cause: InjuryCause;
  fixtureId: string | null;
  matchMinute: number | null;
  initialWeeks: number;
  remainingWeeks: number;
  rehabPlan: RehabPlan;
  recurrenceRisk: number;
  returnFitness: number;
  occurredSeason: number;
  occurredWeek: number;
}

export interface InjuryHistoryEntry extends InjuryRecord {
  recoveredSeason: number;
  recoveredWeek: number;
}

export interface PlayerMedicalState {
  activeInjury: InjuryRecord | null;
  history: InjuryHistoryEntry[];
  recurrenceUntilWeek: number | null;
}

/** Permanent identity of a player beyond the numbers: rarity and nickname now, signature and story later. */
export interface SignatureState {
  id: string;
  /** German/English name of this player's variant. */
  name: [string, string];
  /** Strength: 1 = as written in the data; scaled by rarity and a small personal tuning. */
  power: number;
  /** Evolution stage (Phase 6) and the branch chosen at stage II. */
  level: 1 | 2 | 3;
  path: 'a' | 'b' | null;
}

export interface PlayerDNA {
  version: number;
  rarity: Rarity;
  /** One or two signatures: Common 1 passive, Rare/Epic 1 triggered, Legendary/Mythic both. */
  signatures?: SignatureState[];
  /** German/English epithet from Epic upwards. */
  nickname: Nickname | null;
}

/** A short-lived bonus earned in training; it plays in the next match and then expires. */
export interface TrainingBuff {
  drillId: string;
  effects: EffectSpec[];
  /** Season and week the session took place. */
  season: number;
  week: number;
}

/** Long-term training memory of a player. Created on first use, so older saves need no migration. */
export interface PlayerTrainingState {
  /** Mastery per attribute, 0-100. 100 unlocks the attribute's signature trait. */
  mastery: Partial<Record<AttributeKey, number>>;
  /** Training load of the last completed weeks, oldest first (at most four). */
  load: number[];
  /** Load collected so far in the running week. */
  weekLoad: number;
  buffs: TrainingBuff[];
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  foot: Foot;
  kitNumber: number;
  visuals: PlayerVisualIdentity;

  position: Position;
  positionGroup: PositionGroup;
  /** Secondary positions the player is comfortable in. */
  altPositions: Position[];

  attributes: PlayerAttributes;
  /** Cached overall rating (0-99), derived from attributes + position. */
  overall: number;
  /** Maximum overall this player can reach through training. */
  potential: number;

  // RPG progression
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  traitIds: string[];
  archetype: PlayerArchetype;
  developmentPlan: DevelopmentPlan;
  talentRanks: Record<string, number>;
  personality: PlayerPersonality;
  personalGoal: PersonalGoal;
  /** Mastery, load history and match buffs from the training camp. */
  training?: PlayerTrainingState;
  /** Rarity, nickname and (later) signature, quirks and story. Assigned once, never re-rolled. */
  dna?: PlayerDNA;

  // Condition & psychology (0-100 unless noted)
  morale: number;
  fitness: number;
  /** Recent form, -5 (poor) .. +5 (excellent). */
  form: number;
  /** Weeks remaining until injury heals; 0 = fit. */
  injuryWeeks: number;
  medical: PlayerMedicalState;

  // Career / economy
  marketValue: number;
  salary: number;
  contractWeeks: number;

  // Season stats
  seasonStats: PlayerSeasonStats;
  /** Totals of all completed seasons. */
  career?: import('./career.model').PlayerCareerStats;
}

export interface PlayerSeasonStats {
  appearances: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
  /** Sum of match ratings, used to derive an average. */
  ratingSum: number;
  motmAwards: number;
}

export function emptySeasonStats(): PlayerSeasonStats {
  return {
    appearances: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
    ratingSum: 0,
    motmAwards: 0,
  };
}
