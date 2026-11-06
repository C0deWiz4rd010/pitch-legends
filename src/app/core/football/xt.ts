import { clamp } from '../util';
import { FIELD_LENGTH, FIELD_WIDTH } from './match-types';

/**
 * Expected threat: how likely a possession is to end in a goal from a given spot, on a static 12 x 8 grid
 * (columns run from the own goal to the opponent's). Shape follows the published xT surfaces: flat in the own
 * half, steeply rising in front of goal, and centre-heavy near the box. It is scaled to the pitch in use,
 * so it also fits the five-a-side cage.
 */
const COLUMN_VALUE = [0.006, 0.0078, 0.0092, 0.0116, 0.015, 0.02, 0.0274, 0.0398, 0.062, 0.11, 0.195, 0.3] as const;
const ROW_FACTOR = [0.55, 0.75, 0.92, 1, 1, 0.92, 0.75, 0.55] as const;

export function expectedThreat(x: number, y: number, direction: 1 | -1): number {
  const depth = direction > 0 ? x : FIELD_LENGTH - x;
  const column = clamp(Math.floor((depth / FIELD_LENGTH) * 12), 0, 11);
  const row = clamp(Math.floor((y / FIELD_WIDTH) * 8), 0, 7);
  // Width matters more the closer to goal: a wide spot in the first column is worth almost the centre.
  const lateral = 1 - (1 - ROW_FACTOR[row]) * (0.35 + (column / 11) * 0.65);
  return COLUMN_VALUE[column] * lateral;
}

/** Value of an action: the gain when it works, the (danger-weighted) cost when the ball is lost. */
export function actionValue(successChance: number, gain: number, currentThreat: number): number {
  return successChance * gain - (1 - successChance) * (0.012 + currentThreat * 0.5);
}

/** Chance that a pass arrives: lane pressure, distance and the space the receiver has. */
export function passCompletion(lanePressure: number, gap: number, receiverSpace: number): number {
  return clamp(0.95 - lanePressure * 0.3 - gap * 0.011 - clamp((3 - receiverSpace) / 3, 0, 1) * 0.14, 0.15, 0.95);
}

/** Chance that a dribble past the next 8 m works, from the carrier's skill and the room around him. */
export function dribbleSuccess(dribbling: number, closestOpponent: number): number {
  return clamp(0.55 + (dribbling - 60) * 0.006 + clamp((closestOpponent - 1.5) / 6, 0, 1) * 0.3, 0.3, 0.95);
}
