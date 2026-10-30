import { clamp } from '../util';

/**
 * Shoot-out conversion chance shared by the live match and the quick simulation.
 * `bonus` is added on top, e.g. 0.05 for the Ice in the Veins trait.
 */
export function shootoutConversionChance(
  shooting: number,
  keeperGoalkeeping: number,
  bonus = 0,
): number {
  return clamp(0.76 + (shooting - 70) / 200 + bonus - (keeperGoalkeeping - 70) / 250, 0.55, 0.92);
}
