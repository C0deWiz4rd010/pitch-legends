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
