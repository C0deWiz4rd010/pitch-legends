import { MatchWeather } from '../../models/match.model';

/** The middle of the season is winter: a tenth of the weeks before and after the turn of the year. */
export function isWinterWeek(week: number, totalWeeks: number): boolean {
  if (totalWeeks < 8) return false;
  return week >= Math.ceil(totalWeeks * 0.42) && week <= Math.ceil(totalWeeks * 0.58);
}

/** In winter four fixtures in ten are played in the snow; otherwise the usual clear, rain or storm. `roll` is a stable 0-9 number of the fixture. */
export function weatherFor(roll: number, week: number, totalWeeks: number): MatchWeather {
  if (isWinterWeek(week, totalWeeks) && roll < 4) return 'snow';
  return roll < 6 ? 'clear' : roll < 9 ? 'rain' : 'storm';
}

/** Standing water on the pitch, in pitch coordinates (metres). */
export interface Puddle { x: number; y: number; radius: number }

/**
 * Where water stands on this pitch in steady rain: the same spots for the same fixture seed, away from the touchlines.
 * Rain leaves a few shallow puddles, a storm more and larger ones; a dry or snowy pitch has none. The renderer draws them
 * (and the ball physics may read them), so they are a pure function of the seed.
 */
export function puddleSpots(seed: number, weather: MatchWeather, length: number, width: number): Puddle[] {
  const count = weather === 'storm' ? 10 : weather === 'rain' ? 6 : 0;
  const spots: Puddle[] = [];
  // A small integer generator of its own: the match's random stream stays untouched.
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
    return ((state ^ (state >>> 15)) >>> 0) / 4294967296;
  };
  for (let index = 0; index < count; index++) {
    const radius = (weather === 'storm' ? 1.5 : 1.1) + next() * (weather === 'storm' ? 2 : 1.3);
    spots.push({ x: 6 + next() * (length - 12), y: 5 + next() * (width - 10), radius });
  }
  return spots;
}
