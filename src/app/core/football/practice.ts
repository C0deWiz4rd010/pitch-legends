import { generateTeam } from '../../data/generators';
import { Rng } from '../util';
import { Team } from '../../models/team.model';

/** Standalone matches never create, overwrite or mutate a career. */
export function createPracticeTeams(seed = 20260905): { home: Team; away: Team } {
  const rng = new Rng(seed);
  const home = generateTeam(rng, { name: 'Harbour Athletic', short: 'HBR', primary: '#31baa5', secondary: '#143746' }, 73, true);
  const away = generateTeam(rng, { name: 'Sunset Rovers', short: 'SUN', primary: '#f1aa57', secondary: '#6c3048' }, 72, false);
  home.visuals.stadium.atmosphere = 'day';
  home.facilities.stadium = 3;
  for (const team of [home, away]) for (const player of team.players) {
    player.fitness = 100;
    player.injuryWeeks = 0;
  }
  return { home, away };
}
