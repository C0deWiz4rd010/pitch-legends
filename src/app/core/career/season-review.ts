import { ArchivedLeague, SeasonArchive, SeasonAward } from '../../models/career.model';
import { CareerObjective, GameState } from '../../models/game.model';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { playerName } from '../ratings';
import { cupProgress } from './cup';
import { allLeagues, promotionMoves, standingsFor } from './divisions';
import { retiringPlayers } from './lifecycle';
import { BoardVerdict, leaguePosition, objectiveMet, seasonBoardVerdict } from './objectives';

export interface SeasonReview {
  season: number;
  leagues: ArchivedLeague[];
  promotedIds: string[];
  relegatedIds: string[];
  cupWinnerId: string | null;
  awards: SeasonAward[];
  objectives: Array<{ objective: CareerObjective; met: boolean }>;
  position: number;
  retiring: Array<{ player: Player; team: Team }>;
  board: BoardVerdict;
  clubPromoted: boolean;
  clubRelegated: boolean;
}

function average(player: Player): number {
  return player.seasonStats.appearances ? player.seasonStats.ratingSum / player.seasonStats.appearances : 0;
}

/** Awards across the player's division: player, top scorer, talent (≤21) and keeper of the season. */
export function seasonAwards(game: GameState): SeasonAward[] {
  const ids = new Set(game.league.teamIds);
  const entries = game.teams.filter((team) => ids.has(team.id)).flatMap((team) => team.players.map((player) => ({ player, team })));
  const award = (key: SeasonAward['key'], pool: typeof entries, value: (player: Player) => number): SeasonAward | null => {
    const best = pool.map((entry) => ({ ...entry, value: value(entry.player) })).filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value || b.player.overall - a.player.overall)[0];
    return best ? { key, playerId: best.player.id, playerName: playerName(best.player), teamId: best.team.id, value: Math.round(best.value * 100) / 100 } : null;
  };
  return [
    award('player', entries.filter((entry) => entry.player.seasonStats.appearances >= 8), average),
    award('scorer', entries, (player) => player.seasonStats.goals),
    award('talent', entries.filter((entry) => entry.player.age <= 21 && entry.player.seasonStats.appearances >= 5), average),
    award('keeper', entries.filter((entry) => entry.player.positionGroup === 'GK'), (player) => player.seasonStats.cleanSheets),
  ].filter((entry): entry is SeasonAward => !!entry);
}

export function buildSeasonReview(game: GameState): SeasonReview {
  const leagues = allLeagues(game).map<ArchivedLeague>((league) => {
    const table = standingsFor(game, league);
    return { id: league.id, name: league.name, tier: league.tier ?? 1, championId: table[0]?.teamId ?? '', table };
  });
  const moves = promotionMoves(game);
  const clubPromoted = moves.promoted.includes(game.clubId);
  const clubRelegated = moves.relegated.includes(game.clubId);
  return {
    season: game.league.season,
    leagues,
    promotedIds: moves.promoted,
    relegatedIds: moves.relegated,
    cupWinnerId: game.cup?.winnerId ?? null,
    awards: seasonAwards(game),
    objectives: game.objectives.map((objective) => ({ objective, met: objectiveMet(game, objective) })),
    position: leaguePosition(game),
    retiring: retiringPlayers(game).filter((entry) => entry.team.id === game.clubId || entry.player.overall >= 72),
    board: seasonBoardVerdict(game, clubPromoted, clubRelegated),
    clubPromoted,
    clubRelegated,
  };
}

export function archiveEntry(game: GameState, review: SeasonReview): SeasonArchive {
  const final = game.cup?.ties.find((tie) => tie.round === game.cup.rounds[game.cup.rounds.length - 1]?.round && tie.played);
  return {
    season: review.season,
    leagues: review.leagues.map((league) => ({ ...league, table: league.table.map((row) => ({ ...row })) })),
    cupWinnerId: review.cupWinnerId,
    cupFinal: final ? { homeTeamId: final.homeTeamId, awayTeamId: final.awayTeamId, homeScore: final.homeScore ?? 0, awayScore: final.awayScore ?? 0, penalties: final.penalties } : null,
    awards: review.awards,
    club: {
      teamId: game.clubId,
      tier: game.league.tier ?? 1,
      position: review.position,
      cupRound: cupProgress(game.cup, game.clubId),
      objectivesCompleted: review.objectives.filter((entry) => entry.met).length,
      objectivesTotal: review.objectives.length,
    },
    promotedIds: review.promotedIds,
    relegatedIds: review.relegatedIds,
  };
}

/** Trophy cabinet of one club across all archived seasons. */
export function trophiesOf(game: GameState, teamId: string): { leagues: number[]; cups: number[]; promotions: number[] } {
  const archive = game.archive ?? [];
  return {
    leagues: archive.filter((entry) => entry.leagues.some((league) => league.tier === 1 && league.championId === teamId)).map((entry) => entry.season),
    cups: archive.filter((entry) => entry.cupWinnerId === teamId).map((entry) => entry.season),
    promotions: archive.filter((entry) => entry.promotedIds.includes(teamId)).map((entry) => entry.season),
  };
}
