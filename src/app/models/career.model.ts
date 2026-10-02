import { Fixture, StandingRow } from './league.model';

/** Money flows booked per club and season. Expenses are stored as positive amounts. */
export type FinanceKind = 'gate' | 'prizes' | 'tv' | 'sponsor' | 'transfersIn' | 'wages' | 'transfersOut' | 'facilities' | 'upkeep' | 'other';
export type FinanceTotals = Record<FinanceKind, number>;

export const INCOME_KINDS: FinanceKind[] = ['gate', 'prizes', 'tv', 'sponsor', 'transfersIn'];
export const EXPENSE_KINDS: FinanceKind[] = ['wages', 'transfersOut', 'facilities', 'upkeep'];

export interface TeamFinance {
  season: number;
  totals: FinanceTotals;
  previous: (FinanceTotals & { season: number }) | null;
  /** Club balance at the end of every completed week of the current season. */
  balance: number[];
}

/** A knockout tie. It reuses the fixture shape so the match page can play it like a league game. */
export interface CupTie extends Fixture {
  competition: 'cup';
  round: number;
  extraTime: boolean;
  penalties: { home: number; away: number } | null;
  winnerId: string | null;
}

export type CupRoundKey = 'r1' | 'r2' | 'qf' | 'sf' | 'final';

export interface CupRound {
  round: number;
  key: CupRoundKey;
  /** League week in which the round is played (before that week's league fixture). */
  week: number;
  /** Prize for every club that reaches this round. */
  prize: number;
}

export interface CupState {
  id: string;
  name: string;
  season: number;
  rounds: CupRound[];
  ties: CupTie[];
  /** Clubs that enter in round 2. */
  byeTeamIds: string[];
  winnerId: string | null;
}

export interface SeasonAward {
  key: 'player' | 'scorer' | 'talent' | 'keeper';
  playerId: string;
  playerName: string;
  teamId: string;
  value: number;
}

export interface ArchivedLeague {
  id: string;
  name: string;
  tier: 1 | 2;
  championId: string;
  table: StandingRow[];
}

export interface SeasonArchive {
  season: number;
  leagues: ArchivedLeague[];
  cupWinnerId: string | null;
  cupFinal: { homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number; penalties: { home: number; away: number } | null } | null;
  awards: SeasonAward[];
  club: { teamId: string; tier: 1 | 2; position: number; cupRound: CupRoundKey | 'winner' | null; objectivesCompleted: number; objectivesTotal: number };
  promotedIds: string[];
  relegatedIds: string[];
}

export interface BoardState {
  /** 0 (sacked) .. 100 (untouchable). */
  confidence: number;
  warnedSeason: number | null;
  /** League position the board expects this season. */
  expectedPosition: number;
  /** Set when the board sacked the manager; the review then offers this club. */
  jobOffer: { teamId: string; season: number } | null;
}

export interface ScoutAssignment {
  id: string;
  regionId: string;
  positionGroup: 'GK' | 'DEF' | 'MID' | 'ATT';
  season: number;
  startedWeek: number;
  readyWeek: number;
  delivered: boolean;
  playerIds: string[];
}

export interface AcademyState {
  season: number;
  /** This season's youth intake, waiting for a decision. */
  prospects: import('./player.model').Player[];
}

export interface PlayerCareerStats {
  seasons: number;
  appearances: number;
  goals: number;
  assists: number;
  clubs: string[];
}

export function emptyFinanceTotals(): FinanceTotals {
  return { gate: 0, prizes: 0, tv: 0, sponsor: 0, transfersIn: 0, wages: 0, transfersOut: 0, facilities: 0, upkeep: 0, other: 0 };
}

export function emptyTeamFinance(season: number): TeamFinance {
  return { season, totals: emptyFinanceTotals(), previous: null, balance: [] };
}
