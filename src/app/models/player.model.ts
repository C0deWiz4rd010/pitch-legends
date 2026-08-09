import { AttributeKey, Foot, Position, PositionGroup } from './enums';

/** A trait/perk that modifies a player's match behaviour. */
export interface Trait {
  id: string;
  name: string;
  description: string;
  /** Attribute the trait is thematically tied to (for UI grouping). */
  category: AttributeKey | 'mental';
  /** Flat modifiers applied to effective match rating in relevant phases. */
  modifiers: Partial<Record<AttributeKey, number>>;
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

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  foot: Foot;
  kitNumber: number;

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

  // Condition & psychology (0-100 unless noted)
  morale: number;
  fitness: number;
  /** Recent form, -5 (poor) .. +5 (excellent). */
  form: number;
  /** Weeks remaining until injury heals; 0 = fit. */
  injuryWeeks: number;

  // Career / economy
  marketValue: number;
  salary: number;
  contractWeeks: number;

  // Season stats
  seasonStats: PlayerSeasonStats;
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
