import {
  AttributeKey,
  BuildUpStyle,
  DefensiveLine,
  ForwardRuns,
  MarkingStyle,
  Mentality,
  PassingStyle,
  Position,
  PressingIntensity,
  SupportDuty,
  Tempo,
  Width,
} from './enums';

/**
 * A tactical role that can be assigned to a player in a formation slot.
 * Roles reshape how a player's attributes are weighted and add match modifiers.
 */
export interface Role {
  id: string;
  name: string;
  shortName: string;
  /** Positions this role can be used at. */
  positions: Position[];
  /** Attribute weights used for role-fit rating (should roughly sum to 1). */
  attributeWeights: Partial<Record<AttributeKey, number>>;
  /** Default support duty for the role. */
  defaultDuty: SupportDuty;
  description: string;
}

/** A single slot in a formation, holding one player + their role & instructions. */
export interface FormationSlot {
  id: string;
  position: Position;
  /** Normalised pitch coordinates: x 0 (own goal) -> 1 (opp goal), y 0 (left) -> 1 (right). */
  x: number;
  y: number;
  roleId: string;
  playerId: string | null;
  instruction: PlayerInstruction;
}

/** Per-player instructions layered on top of team tactics. */
export interface PlayerInstruction {
  duty: SupportDuty;
  forwardRuns: ForwardRuns;
  /** Extra pressing on top of team pressing, -1 (less) .. +1 (more). */
  pressingBias: number;
  marking: MarkingStyle;
  /** Whether the player should stay in position or roam. */
  stayInPosition: boolean;
}

export function defaultInstruction(duty: SupportDuty): PlayerInstruction {
  return {
    duty,
    forwardRuns: 'mixed',
    pressingBias: 0,
    marking: 'zonal',
    stayInPosition: false,
  };
}

export interface Formation {
  id: string;
  name: string;
  slots: FormationSlot[];
}

/** Team-wide tactical configuration. */
export interface Tactics {
  mentality: Mentality;
  pressing: PressingIntensity;
  tempo: Tempo;
  width: Width;
  defensiveLine: DefensiveLine;
  buildUp: BuildUpStyle;
  passing: PassingStyle;
  offsideTrap: boolean;
  counterAttack: boolean;

  // Set-piece & leadership assignments (player ids)
  captainId: string | null;
  penaltyTakerId: string | null;
  freeKickTakerId: string | null;
  cornerTakerId: string | null;
}

export function defaultTactics(): Tactics {
  return {
    mentality: 'balanced',
    pressing: 'medium',
    tempo: 'balanced',
    width: 'balanced',
    defensiveLine: 'medium',
    buildUp: 'balanced',
    passing: 'mixed',
    offsideTrap: false,
    counterAttack: true,
    captainId: null,
    penaltyTakerId: null,
    freeKickTakerId: null,
    cornerTakerId: null,
  };
}
