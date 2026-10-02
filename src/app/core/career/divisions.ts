import { generateFixtures } from '../../data/generators';
import { GameState } from '../../models/game.model';
import { League } from '../../models/league.model';
import { computeStandings } from '../standings';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';

export const PROMOTION_PLACES = 2;

export function allLeagues(game: GameState): League[] {
  return [game.league, ...(game.otherLeagues ?? [])].sort((a, b) => (a.tier ?? 1) - (b.tier ?? 1));
}

export function leagueOfTeam(game: GameState, teamId: string): League | undefined {
  return allLeagues(game).find((league) => league.teamIds.includes(teamId));
}

export function standingsFor(game: GameState, league: League) {
  const ids = new Set(league.teamIds);
  return computeStandings(game.teams.filter((team) => ids.has(team.id)), league.fixtures);
}

/** Clubs that go up and down at the end of the current season (bottom 2 of tier 1 swap with the top 2 of tier 2). */
export function promotionMoves(game: GameState): { promoted: string[]; relegated: string[] } {
  const leagues = allLeagues(game);
  const top = leagues.find((league) => league.tier === 1);
  const second = leagues.find((league) => league.tier === 2);
  if (!top || !second) return { promoted: [], relegated: [] };
  const relegated = standingsFor(game, top).slice(-PROMOTION_PLACES).map((row) => row.teamId);
  const promoted = standingsFor(game, second).slice(0, PROMOTION_PLACES).map((row) => row.teamId);
  return { promoted, relegated };
}

/** Moves clubs between divisions and makes `game.league` the division of the player's club again. */
export function applyPromotionRelegation(game: GameState, moves = promotionMoves(game)): void {
  const leagues = allLeagues(game);
  const top = leagues.find((league) => league.tier === 1);
  const second = leagues.find((league) => league.tier === 2);
  if (!top || !second || !moves.promoted.length) return;
  top.teamIds = [...top.teamIds.filter((id) => !moves.relegated.includes(id)), ...moves.promoted];
  second.teamIds = [...second.teamIds.filter((id) => !moves.promoted.includes(id)), ...moves.relegated];
  selectPlayerLeague(game);
}

export function selectPlayerLeague(game: GameState): void {
  const leagues = allLeagues(game);
  const own = leagues.find((league) => league.teamIds.includes(game.clubId)) ?? game.league;
  game.league = own;
  game.otherLeagues = leagues.filter((league) => league !== own);
}

/** A freshly shuffled, seeded double round robin for every division. */
export function scheduleSeason(game: GameState, season: number): void {
  for (const league of allLeagues(game)) {
    const rng = new Rng(hash32(`${game.world.seed}|fixtures|${league.id}|${season}`));
    league.season = season;
    league.currentWeek = 1;
    league.fixtures = generateFixtures(league.teamIds, rng).map((fixture) => ({
      ...fixture,
      id: `fx-${league.id}-s${season}-w${fixture.week}-${fixture.homeTeamId}-${fixture.awayTeamId}`,
    }));
    league.totalWeeks = Math.max(...league.fixtures.map((fixture) => fixture.week));
  }
}
