import { generateTeam } from '../../data/generators';
import { generateWorld, uniqueShortName } from '../../data/world-generator';
import { MatchWeather } from '../../models/match.model';
import { Team } from '../../models/team.model';
import { StadiumVisualTheme } from '../../models/visual.model';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';

export interface QuickMatchSettings {
  homeIndex: number;
  awayIndex: number;
  controlAway: boolean;
  stadium: 1 | 2 | 3 | 4 | 5;
  weather: MatchWeather;
  atmosphere: StadiumVisualTheme['atmosphere'];
  halfMinutes: 3 | 5 | 8;
  smallSided: boolean;
}

export const DEFAULT_QUICK_SETTINGS: QuickMatchSettings = { homeIndex: 0, awayIndex: 1, controlAway: false, stadium: 3, weather: 'clear', atmosphere: 'night', halfMinutes: 3, smallSided: false };

export const QUICK_POOL_SEED = 20261002;
const STRENGTHS = [84, 82, 80, 78, 77, 75, 73, 71, 69, 67, 64, 61];

export interface QuickClub { index: number; name: string; short: string; primary: string; secondary: string; strength: number }

let pool: QuickClub[] | null = null;

/** Twelve fixed exhibition clubs from strong to modest, the same on every device. */
export function quickClubs(): QuickClub[] {
  if (pool) return pool;
  const ids = Array.from({ length: 12 }, (_, index) => `quick-${index}`);
  const blueprint = generateWorld(QUICK_POOL_SEED, ids, 'Harbour Athletic');
  const taken = new Set<string>();
  pool = blueprint.clubIdentities.map((identity, index) => ({
    index,
    name: index === 0 ? 'Harbour Athletic' : identity.name,
    short: uniqueShortName(index === 0 ? 'Harbour' : identity.name, taken),
    primary: index === 0 ? '#31baa5' : identity.primary,
    secondary: index === 0 ? '#143746' : identity.secondary,
    strength: STRENGTHS[index],
  }));
  return pool;
}

export function quickTeam(index: number, settings: QuickMatchSettings, home: boolean): Team {
  const club = quickClubs()[index] ?? quickClubs()[0];
  const rng = new Rng(hash32(`${QUICK_POOL_SEED}|club|${index}`));
  const team = generateTeam(rng, { name: club.name, short: club.short, primary: club.primary, secondary: club.secondary }, club.strength, false);
  // Both sides may be the same club; the away copy needs its own identity.
  team.id = `quick-${index}-${home ? 'home' : 'away'}`;
  if (home) {
    team.facilities.stadium = settings.stadium;
    team.visuals.stadium.atmosphere = settings.atmosphere;
  }
  for (const player of team.players) {
    player.fitness = 100;
    player.injuryWeeks = 0;
    if (!home) player.id = `${player.id}-a`;
  }
  if (!home) for (const slot of team.formation.slots) slot.playerId = slot.playerId ? `${slot.playerId}-a` : null;
  return team;
}
