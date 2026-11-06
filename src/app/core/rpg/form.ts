import { Player } from '../../models/player.model';
import { clamp } from '../util';

/** The last ratings kept per player: enough for a trend, small enough for every squad in a save. */
export const RECENT_RATINGS = 5;
/** What a match of an average player rates: form rises above it and falls below it. */
const PAR_RATING = 6.6;

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Form follows performances: it moves a quarter of the way to what the match rating says (a 8.0 points to +5, a 5.8 to -3).
 * It stays between -5 and +5, where the effect pipeline turns it into at most ±4 % on every attribute.
 */
export function recordMatchForm(player: Player, rating: number): void {
  const recent = (player.recentRatings ??= []);
  recent.push(round(rating, 2));
  if (recent.length > RECENT_RATINGS) recent.shift();
  const target = clamp((rating - PAR_RATING) * 4, -5, 5);
  player.form = round(clamp(player.form + (target - player.form) * 0.25, -5, 5), 1);
}

/** A week without a match cools form down towards neutral. */
export function decayForm(player: Player): void {
  player.form = Math.abs(player.form) < 0.05 ? 0 : round(player.form * 0.94, 2);
}

export type FormTrend = 'up' | 'down' | 'flat';

/** Mean of the last two ratings against the three before them. */
export function formTrend(player: Player): FormTrend {
  const recent = player.recentRatings;
  if (!recent || recent.length < 3) return 'flat';
  const latest = recent.slice(-2);
  const before = recent.slice(0, -2);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const difference = mean(latest) - mean(before);
  return difference > 0.25 ? 'up' : difference < -0.25 ? 'down' : 'flat';
}

export function formSymbol(player: Player): string {
  const trend = formTrend(player);
  return trend === 'up' ? '▲' : trend === 'down' ? '▼' : '▬';
}
