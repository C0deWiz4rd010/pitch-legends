import { CupRound, CupRoundKey, CupState, CupTie } from '../../models/career.model';
import { League } from '../../models/league.model';
import { MatchResult } from '../../models/match.model';
import { Team } from '../../models/team.model';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';

const ROUND_KEYS_FROM_FINAL: CupRoundKey[] = ['final', 'sf', 'qf', 'r2', 'r1'];
const PRIZES: Record<CupRoundKey, number> = { r1: 15000, r2: 30000, qf: 60000, sf: 110000, final: 180000 };
export const CUP_WINNER_PRIZE = 250000;

export const CUP_ROUND_LABELS: Record<CupRoundKey | 'winner', { de: string; en: string }> = {
  r1: { de: '1. Runde', en: 'Round 1' },
  r2: { de: 'Achtelfinale', en: 'Round of 16' },
  qf: { de: 'Viertelfinale', en: 'Quarter-final' },
  sf: { de: 'Halbfinale', en: 'Semi-final' },
  final: { de: 'Finale', en: 'Final' },
  winner: { de: 'Pokalsieger', en: 'Cup winner' },
};

/**
 * Knockout cup for every club of both divisions. With 24 clubs the eight strongest top-flight
 * sides enter in round 2, the other 16 play round 1. Rounds sit between league weeks.
 */
export function createCup(options: { teams: Team[]; leagues: League[]; season: number; seed: number; name: string; totalWeeks: number; seededIds?: string[]; firstWeek?: number }): CupState {
  const entrants = options.leagues.flatMap((league) => league.teamIds);
  const size = 2 ** Math.floor(Math.log2(Math.max(2, entrants.length)));
  const firstRoundTeams = entrants.length === size ? entrants.length : 2 * (entrants.length - size);
  const roundCount = Math.round(Math.log2(size)) + (entrants.length === size ? 0 : 1);
  const keys = ROUND_KEYS_FROM_FINAL.slice(0, roundCount).reverse();
  const first = Math.max(3, options.firstWeek ?? 3), last = Math.max(first + roundCount - 1, options.totalWeeks - 3);
  const rounds: CupRound[] = keys.map((key, index) => ({
    round: index + 1,
    key,
    week: roundCount === 1 ? first : Math.round(first + (last - first) * index / (roundCount - 1)),
    prize: PRIZES[key],
  }));
  const topFlight = options.leagues.find((league) => league.tier === 1)?.teamIds ?? entrants;
  const ranking = options.seededIds?.length ? options.seededIds : [...topFlight].sort((a, b) => strength(options.teams, b) - strength(options.teams, a));
  const byeCount = entrants.length - firstRoundTeams;
  const byeTeamIds = ranking.filter((id) => entrants.includes(id)).slice(0, byeCount);
  const cup: CupState = {
    id: `cup-${options.seed.toString(36)}-s${options.season}`,
    name: options.name,
    season: options.season,
    rounds,
    ties: [],
    byeTeamIds,
    winnerId: null,
  };
  // A cup that no longer fits into the season (careers migrated late in the season) starts next year.
  if (rounds[rounds.length - 1].week > options.totalWeeks) return { ...cup, rounds: [], byeTeamIds: [] };
  drawRound(cup, rounds[0], entrants.filter((id) => !byeTeamIds.includes(id)), options.leagues, options.seed);
  return cup;
}

function strength(teams: Team[], id: string): number {
  const team = teams.find((candidate) => candidate.id === id);
  return team ? team.strength * 2 + team.reputation : 0;
}

function tierOf(leagues: League[], teamId: string): number {
  return leagues.find((league) => league.teamIds.includes(teamId))?.tier ?? 1;
}

function drawRound(cup: CupState, round: CupRound, teamIds: string[], leagues: League[], seed: number): void {
  const rng = new Rng(hash32(`${seed}|cup|${cup.season}|${round.round}`));
  const pool = rng.shuffle(teamIds);
  for (let index = 0; index + 1 < pool.length; index += 2) {
    let home = pool[index], away = pool[index + 1];
    // The lower-division club hosts the tie, as in most real cups.
    if (tierOf(leagues, away) > tierOf(leagues, home)) [home, away] = [away, home];
    cup.ties.push({
      id: `cup-s${cup.season}-r${round.round}-${home}-${away}`,
      competition: 'cup',
      round: round.round,
      week: round.week,
      homeTeamId: home,
      awayTeamId: away,
      homeScore: null,
      awayScore: null,
      played: false,
      extraTime: false,
      penalties: null,
      winnerId: null,
    });
  }
}

export function cupRoundForWeek(cup: CupState | undefined, week: number): CupRound | null {
  return cup?.rounds.find((round) => round.week === week) ?? null;
}

/** Unplayed tie of this team in the round scheduled for the given league week. */
export function openCupTie(cup: CupState | undefined, teamId: string, week: number): CupTie | null {
  const round = cupRoundForWeek(cup, week);
  if (!cup || !round) return null;
  return cup.ties.find((tie) => tie.round === round.round && !tie.played && (tie.homeTeamId === teamId || tie.awayTeamId === teamId)) ?? null;
}

export function isCupFixtureId(id: string | undefined): boolean {
  return !!id && id.startsWith('cup-');
}

/** Stores a result. Draws must carry a shoot-out; without one the home side goes through. */
export function recordCupResult(cup: CupState, result: MatchResult): CupTie | null {
  const tie = cup.ties.find((candidate) => candidate.id === result.fixtureId && !candidate.played);
  if (!tie) return null;
  tie.homeScore = result.homeScore;
  tie.awayScore = result.awayScore;
  tie.played = true;
  tie.extraTime = !!result.extraTime;
  if (result.shootout) {
    tie.penalties = { home: result.shootout.home.filter(Boolean).length, away: result.shootout.away.filter(Boolean).length };
  }
  tie.winnerId = result.homeScore > result.awayScore ? tie.homeTeamId
    : result.awayScore > result.homeScore ? tie.awayTeamId
    : result.shootout?.winner === 'away' ? tie.awayTeamId : tie.homeTeamId;
  return tie;
}

/** Draws the next round once the current one is complete. Returns the clubs that just qualified. */
export function advanceCup(cup: CupState, leagues: League[], seed: number): { round: CupRound | null; teamIds: string[]; winnerId: string | null } {
  const none = { round: null, teamIds: [], winnerId: null };
  if (cup.winnerId || !cup.ties.length) return none;
  const latest = Math.max(...cup.ties.map((tie) => tie.round));
  const ties = cup.ties.filter((tie) => tie.round === latest);
  if (!ties.length || ties.some((tie) => !tie.played)) return none;
  const winners = ties.map((tie) => tie.winnerId!).filter(Boolean);
  const next = cup.rounds.find((round) => round.round === latest + 1);
  if (!next) {
    cup.winnerId = winners[0] ?? null;
    return { round: null, teamIds: [], winnerId: cup.winnerId };
  }
  const qualified = latest === 1 ? [...cup.byeTeamIds, ...winners] : winners;
  drawRound(cup, next, qualified, leagues, seed);
  return { round: next, teamIds: qualified, winnerId: null };
}

/** Furthest stage the club reached, or null if it did not take part. */
export function cupProgress(cup: CupState | undefined, teamId: string): CupRoundKey | 'winner' | null {
  if (!cup) return null;
  if (cup.winnerId === teamId) return 'winner';
  const rounds = cup.ties.filter((tie) => tie.homeTeamId === teamId || tie.awayTeamId === teamId).map((tie) => tie.round);
  if (!rounds.length) return cup.byeTeamIds.includes(teamId) ? 'r2' : null;
  const round = Math.max(...rounds);
  return cup.rounds.find((candidate) => candidate.round === round)?.key ?? null;
}

export function isEliminated(cup: CupState | undefined, teamId: string): boolean {
  if (!cup) return true;
  return cup.ties.some((tie) => tie.played && tie.winnerId !== teamId && (tie.homeTeamId === teamId || tie.awayTeamId === teamId));
}
