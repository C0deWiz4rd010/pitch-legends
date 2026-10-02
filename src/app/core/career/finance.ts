import { EXPENSE_KINDS, FinanceKind, INCOME_KINDS, emptyFinanceTotals, emptyTeamFinance } from '../../models/career.model';
import { GameState } from '../../models/game.model';
import { Team } from '../../models/team.model';
import { clamp } from '../util';

/** Second-division clubs earn less from gates, prizes, TV and sponsors. */
const TIER_FACTOR: Record<1 | 2, number> = { 1: 1, 2: 0.55 };

export function tierOfTeam(game: GameState, teamId: string): 1 | 2 {
  if (game.league.teamIds.includes(teamId)) return game.league.tier ?? 1;
  return game.otherLeagues?.find((league) => league.teamIds.includes(teamId))?.tier ?? 1;
}

/** Books a money flow and applies it to the club balance. Expenses are passed as positive amounts. */
export function book(game: GameState, team: Team, kind: FinanceKind, amount: number): void {
  const value = Math.round(amount);
  if (!value) return;
  ensureFinance(team, game.league.season);
  team.finance.totals[kind] += value;
  const expense = EXPENSE_KINDS.includes(kind);
  team.coins = Math.max(0, team.coins + (expense ? -value : value));
}

/** Records a balance change that already happened elsewhere (legacy code paths). */
export function record(game: GameState, team: Team, kind: FinanceKind, amount: number): void {
  const value = Math.round(amount);
  if (!value) return;
  ensureFinance(team, game.league.season);
  team.finance.totals[kind] += value;
}

export function ensureFinance(team: Team, season: number): void {
  team.finance ??= emptyTeamFinance(season);
  if (team.finance.season === season) return;
  team.finance.previous = { ...team.finance.totals, season: team.finance.season };
  team.finance.season = season;
  team.finance.totals = emptyFinanceTotals();
  team.finance.balance = [];
}

/** Home gate: grows with stadium level and reputation. */
export function gateIncome(team: Team, tier: 1 | 2): number {
  const crowd = clamp(team.reputation / 65, 0.7, 1.25);
  return (40000 + team.facilities.stadium * 22000) * crowd * TIER_FACTOR[tier];
}

export function matchPrize(goalsFor: number, goalsAgainst: number, tier: 1 | 2): number {
  const base = goalsFor > goalsAgainst ? 30000 : goalsFor === goalsAgainst ? 12000 : 4000;
  return base * TIER_FACTOR[tier];
}

export function weeklyTv(tier: 1 | 2): number {
  return tier === 1 ? 6000 : 2500;
}

export function weeklySponsor(team: Team, tier: 1 | 2): number {
  return (1500 + team.reputation * 60) * TIER_FACTOR[tier];
}

export const FACILITY_KEYS = ['trainingGround', 'medicalCenter', 'stadium', 'youthAcademy'] as const;

export function facilityUpgradeCost(currentLevel: number): number {
  return currentLevel * 120000;
}

/**
 * AI clubs reinvest surplus money: once a season the weakest facility is upgraded when the club
 * holds three times its cost plus a wage reserve. Returns the upgraded facility, if any.
 */
export function aiInvest(game: GameState, team: Team, wageBill: number): (typeof FACILITY_KEYS)[number] | null {
  if (team.id === game.clubId) return null;
  const key = [...FACILITY_KEYS].sort((a, b) => team.facilities[a] - team.facilities[b])[0];
  const level = team.facilities[key];
  if (level >= 5) return null;
  const cost = facilityUpgradeCost(level);
  if (team.coins < cost * 3 + wageBill * 8) return null;
  book(game, team, 'facilities', cost);
  team.facilities[key] = level + 1;
  return key;
}

/** Grounds, staff and buildings cost money every week. */
export function weeklyUpkeep(team: Team): number {
  const f = team.facilities;
  return (f.trainingGround + f.medicalCenter + f.stadium + f.youthAcademy) * 1400;
}

/** Guidance for the finances page: a wage bill above this drains the club over a season. */
export function sustainableWageBill(team: Team, tier: 1 | 2): number {
  const perWeek = gateIncome(team, tier) / 2 + matchPrize(1, 1, tier) + weeklyTv(tier) + weeklySponsor(team, tier) - weeklyUpkeep(team);
  return Math.max(0, Math.round(perWeek * 0.8 / 1000) * 1000);
}

export function financeSummary(team: Team): { income: number; expenses: number; net: number } {
  const totals = team.finance?.totals ?? emptyFinanceTotals();
  const income = INCOME_KINDS.reduce((sum, kind) => sum + totals[kind], 0) + Math.max(0, totals.other);
  const expenses = EXPENSE_KINDS.reduce((sum, kind) => sum + totals[kind], 0) + Math.max(0, -totals.other);
  return { income, expenses, net: income - expenses };
}
