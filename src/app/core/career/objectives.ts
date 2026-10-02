import { BoardState } from '../../models/career.model';
import { CareerObjective, GameState } from '../../models/game.model';
import { computeStandings } from '../standings';
import { clamp } from '../util';
import { cupProgress } from './cup';
import { teamStrength } from './quick-sim';

const CUP_ROUND_NUMBER = { r1: 1, r2: 2, qf: 3, sf: 4, final: 5, winner: 6 } as const;

export function leagueTeams(game: GameState, leagueId = game.league.id) {
  const league = leagueId === game.league.id ? game.league : game.otherLeagues.find((candidate) => candidate.id === leagueId);
  const ids = new Set(league?.teamIds ?? []);
  return game.teams.filter((team) => ids.has(team.id));
}

/** Where the club "should" finish by squad strength: 1 = favourite. */
export function expectedRank(game: GameState): number {
  const ranked = leagueTeams(game).map((team) => ({ id: team.id, value: teamStrength(team) + team.reputation * 0.05 }))
    .sort((a, b) => b.value - a.value);
  return Math.max(1, ranked.findIndex((entry) => entry.id === game.clubId) + 1);
}

export function cupRoundNumber(game: GameState, teamId = game.clubId): number {
  const progress = cupProgress(game.cup, teamId);
  return progress ? CUP_ROUND_NUMBER[progress] : 0;
}

/** Board targets for a new season, derived from the squad and the division. */
export function generateSeasonObjectives(game: GameState): CareerObjective[] {
  const season = game.league.season;
  const club = game.teams.find((team) => team.id === game.clubId);
  const size = game.league.teamIds.length || 12;
  const rank = expectedRank(game);
  const tier = game.league.tier ?? 1;
  const scale = tier === 1 ? 1 : 0.7;
  const leagueTarget = tier === 2 ? (rank <= 4 ? 2 : clamp(rank, 3, size - 2)) : clamp(rank + 1, 1, size - 2);
  const cupTarget = rank <= 3 ? 4 : rank <= 6 ? 3 : 2;
  const budgetTarget = Math.max(100_000, Math.round((club?.coins ?? 250_000) * 0.6 / 10_000) * 10_000);
  const objective = (type: CareerObjective['type'], target: number, progress: number, rewardCoins: number, rewardXp: number): CareerObjective => ({
    id: `objective-s${season}-${type}`, season, type, target, progress, rewardCoins: Math.round(rewardCoins * scale / 1000) * 1000, rewardXp, completed: false,
  });
  return [
    objective('league-position', leagueTarget, size, 180_000, 300),
    objective('cup-round', cupTarget, cupRoundNumber(game), 90_000, 180),
    objective('youth-appearances', 12, 0, 60_000, 140),
    objective('budget', budgetTarget, club?.coins ?? 0, 50_000, 120),
    objective('player-growth', 3, 0, 80_000, 180),
  ];
}

export function leaguePosition(game: GameState, teamId = game.clubId): number {
  return computeStandings(leagueTeams(game), game.league.fixtures).findIndex((row) => row.teamId === teamId) + 1;
}

/** Whether an objective is met at the end of the season (league table, cup, budget). */
export function objectiveMet(game: GameState, objective: CareerObjective): boolean {
  if (objective.completed) return true;
  if (objective.type === 'league-position') {
    const position = leaguePosition(game);
    return position > 0 && position <= objective.target;
  }
  if (objective.type === 'cup-round') return cupRoundNumber(game) >= objective.target;
  if (objective.type === 'budget') return (game.teams.find((team) => team.id === game.clubId)?.coins ?? 0) >= objective.target;
  return objective.progress >= objective.target;
}

/** Confidence change after a match, measured against what the squads promised. */
export function boardMatchDelta(ownStrength: number, opponentStrength: number, home: boolean, goalsFor: number, goalsAgainst: number): number {
  const expected = clamp(1.35 + (ownStrength - opponentStrength + (home ? 1.5 : -1.5)) / 12, 0.2, 2.6);
  const points = goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
  return Math.round((points - expected) * 2.2 * 10) / 10;
}

export function applyBoardDelta(board: BoardState, delta: number): void {
  board.confidence = clamp(Math.round((board.confidence + delta) * 10) / 10, 0, 100);
}

export interface BoardVerdict {
  delta: number;
  confidence: number;
  sacked: boolean;
}

/** The season's final judgement: objectives, promotion and relegation weigh most. */
export function seasonBoardVerdict(game: GameState, promoted: boolean, relegated: boolean): BoardVerdict {
  let delta = 0;
  for (const objective of game.objectives) {
    const met = objectiveMet(game, objective);
    if (objective.type === 'league-position') {
      const position = leaguePosition(game);
      delta += met ? 10 : -Math.min(24, 6 + (position - objective.target) * 4);
    } else delta += met ? 4 : -2;
  }
  if (promoted) delta += 15;
  if (relegated) delta -= 25;
  const confidence = clamp(Math.round(game.board.confidence + delta), 0, 100);
  return { delta, confidence, sacked: confidence < 15 };
}
