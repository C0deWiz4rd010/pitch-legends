import { ATTRIBUTE_KEYS, AttributeKey, PositionGroup } from '../../models/enums';
import { TrainingGrade, TrainingIntensity, TrainingScope } from '../../models/game.model';
import { Player, PlayerTrainingState } from '../../models/player.model';
import { clamp } from '../util';

/** Load of one session in arbitrary units; intense work from rest is deliberately a risk. */
export const INTENSITY_LOAD: Record<TrainingIntensity, number> = { light: 1, normal: 2, intense: 3.5 };
export const INTENSITY_MASTERY: Record<TrainingIntensity, number> = { light: 0.8, normal: 1, intense: 1.25 };
export const GRADE_MULTIPLIER: Record<TrainingGrade, number> = { S: 1.5, A: 1.25, B: 1, C: 0.8 };

/** Mastery points a normal session earns before multipliers. */
export const BASE_MASTERY = 8;
export const MASTERY_MILESTONES = [25, 50] as const;
/** The trait unlocked for free at 100 mastery, one per attribute. */
export const MASTERY_TRAIT: Record<AttributeKey, string> = {
  pace: 'speedster', shooting: 'clinical', passing: 'playmaker', dribbling: 'maestro',
  defending: 'wall', physical: 'rock', stamina: 'engine', goalkeeping: 'safehands',
};

/** Attribute a position group lives from; camp events grow it. */
export const CORE_ATTRIBUTE: Record<PositionGroup, AttributeKey> = {
  GK: 'goalkeeping', DEF: 'defending', MID: 'passing', ATT: 'shooting',
};

export type LoadZone = 'green' | 'yellow' | 'red';

const DEFAULT_LOAD = [2, 2, 2, 2];

export function ensureTraining(player: Player): PlayerTrainingState {
  return (player.training ??= { mastery: {}, load: [...DEFAULT_LOAD], weekLoad: 0, buffs: [] });
}

/** Load a session adds to a player (video analysis and recovery cost nothing). */
export function sessionLoad(intensity: TrainingIntensity, scope: TrainingScope, drillLoad = 1): number {
  return INTENSITY_LOAD[intensity] * (scope === 'unit' ? 0.75 : 1) * drillLoad;
}

/** Acute (this week, including what is planned) over chronic (mean of the last weeks) load. */
export function acuteChronicRatio(player: Player, plannedLoad = 0): number {
  const state = player.training;
  const history = state?.load.length ? state.load : DEFAULT_LOAD;
  const chronic = Math.max(1, history.reduce((sum, value) => sum + value, 0) / history.length);
  return ((state?.weekLoad ?? 0) + plannedLoad) / chronic;
}

export function loadZone(ratio: number): LoadZone {
  return ratio <= 1.3 ? 'green' : ratio <= 1.6 ? 'yellow' : 'red';
}

/** Injury risk multiplier from the load ratio: neutral up to 1.3, then rising steeply. */
export function loadRiskFactor(ratio: number): number {
  const over = Math.max(0, ratio - 1.3) * 2;
  const undertrained = ratio < 0.6 ? 1.1 : 1;
  return clamp((1 + over) * undertrained, 0.9, 2.5);
}

/** Closes the running week: its load joins the history (four weeks), buffs of the played week expire. */
export function closeTrainingWeek(player: Player): void {
  const state = ensureTraining(player);
  state.load = [...state.load, state.weekLoad].slice(-4);
  state.weekLoad = 0;
  state.buffs = [];
}

export interface MasteryOutcome {
  gained: number;
  value: number;
  milestone?: 25 | 50;
  traitUnlocked?: string;
}

/** Adds mastery and reports a crossed milestone. The caller pays out the reward. */
export function addMastery(player: Player, attribute: AttributeKey, amount: number): MasteryOutcome {
  const state = ensureTraining(player);
  const before = state.mastery[attribute] ?? 0;
  const value = clamp(before + Math.max(0, Math.round(amount)), 0, 100);
  state.mastery[attribute] = value;
  const outcome: MasteryOutcome = { gained: value - before, value };
  for (const milestone of MASTERY_MILESTONES) if (before < milestone && value >= milestone) outcome.milestone = milestone;
  const trait = MASTERY_TRAIT[attribute];
  if (before < 100 && value >= 100 && !player.traitIds.includes(trait)) outcome.traitUnlocked = trait;
  return outcome;
}

/** A senior (29+, level 12+) and a junior (21 or younger) in one unit session: the junior learns faster. */
export function mentoringJuniors(players: readonly Player[]): Set<string> {
  const hasSenior = players.some((player) => player.age >= 29 && player.level >= 12);
  return new Set(hasSenior ? players.filter((player) => player.age <= 21).map((player) => player.id) : []);
}

export const MENTORING_XP = 1.2;

export function isAttribute(value: string): value is AttributeKey {
  return (ATTRIBUTE_KEYS as string[]).includes(value);
}
