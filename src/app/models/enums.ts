/** Core enums and string-literal unions for the game domain. */

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'ATT';

/** Specific on-pitch positions. */
export type Position =
  | 'GK'
  | 'RB'
  | 'RCB'
  | 'CB'
  | 'LCB'
  | 'LB'
  | 'RWB'
  | 'LWB'
  | 'CDM'
  | 'CM'
  | 'CAM'
  | 'RM'
  | 'LM'
  | 'RW'
  | 'LW'
  | 'CF'
  | 'ST';

export type Foot = 'Left' | 'Right' | 'Both';

/** The eight core attributes every player has (0-99). */
export type AttributeKey =
  | 'pace'
  | 'shooting'
  | 'passing'
  | 'dribbling'
  | 'defending'
  | 'physical'
  | 'stamina'
  | 'goalkeeping';

export const ATTRIBUTE_KEYS: AttributeKey[] = [
  'pace',
  'shooting',
  'passing',
  'dribbling',
  'defending',
  'physical',
  'stamina',
  'goalkeeping',
];

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  pace: 'Pace',
  shooting: 'Shooting',
  passing: 'Passing',
  dribbling: 'Dribbling',
  defending: 'Defending',
  physical: 'Physical',
  stamina: 'Stamina',
  goalkeeping: 'Goalkeeping',
};

/** Team-wide tactical settings. */
export type Mentality = 'ultra-defensive' | 'defensive' | 'balanced' | 'attacking' | 'ultra-attacking';
export type PressingIntensity = 'low' | 'medium' | 'high' | 'gegenpress';
export type Tempo = 'slow' | 'balanced' | 'fast';
export type Width = 'narrow' | 'balanced' | 'wide';
export type DefensiveLine = 'deep' | 'medium' | 'high';
export type BuildUpStyle = 'play-out-of-defence' | 'balanced' | 'long-ball';
export type PassingStyle = 'short' | 'mixed' | 'direct';

/** Per-player instructions layered on top of team tactics. */
export type SupportDuty = 'defend' | 'support' | 'attack';
export type ForwardRuns = 'rarely' | 'mixed' | 'often';
export type MarkingStyle = 'zonal' | 'man' | 'aggressive';

export const MENTALITY_LABELS: Record<Mentality, string> = {
  'ultra-defensive': 'Ultra Defensive',
  defensive: 'Defensive',
  balanced: 'Balanced',
  attacking: 'Attacking',
  'ultra-attacking': 'Ultra Attacking',
};
