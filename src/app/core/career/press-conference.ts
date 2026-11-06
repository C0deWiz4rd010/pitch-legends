import { PRESS_QUESTIONS, PressEffect, REASON_WEIGHT, pressStyle } from '../../data/press-conference';
import {
  PressConferenceState,
  PressReason,
  PressState,
  PressStyle,
  emptyPress,
} from '../../models/club-life.model';
import { GameState } from '../../models/game.model';
import { Team } from '../../models/team.model';
import { clamp } from '../util';
import { hash32 } from '../visual-identity';
import { cupRoundForWeek, openCupTie } from './cup';
import { ensureRoom } from './dressing-room';
import { leagueOfTeam, standingsFor } from './divisions';
import { TRAIT_EFFECTS, hasManagerTrait, managerAttribute } from './manager-effects';
import { applyBoardDelta } from './objectives';

/** Weeks that must lie between two press conferences. */
export const PRESS_COOLDOWN_WEEKS = 3;
/** A team in these places of the table makes a clash "big". */
export const TOP_PLACES = 4;
/** In the last weeks of the season a match against a team this close in the table can decide something. */
export const DECIDER_WEEKS = 3;
export const DECIDER_GAP = 3;

export function ensurePress(game: GameState): PressState {
  game.press ??= emptyPress();
  return game.press;
}

function ownTeam(game: GameState): Team | undefined {
  return game.teams.find((team) => team.id === game.clubId);
}

/** Why the next match (in `week`) is a big one, or null when it is an ordinary fixture. */
export function bigMatchReason(
  game: GameState,
  week: number,
): { opponentId: string; reason: PressReason } | null {
  const club = ownTeam(game);
  if (!club) return null;
  const cup = openCupTie(game.cup, game.clubId, week);
  if (cup && cupRoundForWeek(game.cup, week)) {
    return {
      opponentId: cup.homeTeamId === game.clubId ? cup.awayTeamId : cup.homeTeamId,
      reason: 'cup',
    };
  }
  const fixture = game.league.fixtures.find(
    (candidate) =>
      candidate.week === week &&
      !candidate.played &&
      candidate.competition !== 'cup' &&
      (candidate.homeTeamId === game.clubId || candidate.awayTeamId === game.clubId),
  );
  if (!fixture) return null;
  const opponentId =
    fixture.homeTeamId === game.clubId ? fixture.awayTeamId : fixture.homeTeamId;
  if (club.rivalTeamIds.includes(opponentId)) return { opponentId, reason: 'derby' };
  const league = leagueOfTeam(game, game.clubId);
  const table = league ? standingsFor(game, league).map((row) => row.teamId) : [];
  const own = table.indexOf(game.clubId);
  const other = table.indexOf(opponentId);
  if (own < 0 || other < 0) return null;
  const late = week >= game.league.totalWeeks - DECIDER_WEEKS;
  const atStake = own < TOP_PLACES || own >= table.length - TOP_PLACES;
  if (late && Math.abs(own - other) <= DECIDER_GAP && atStake) return { opponentId, reason: 'decider' };
  if (own < TOP_PLACES && other < TOP_PLACES) return { opponentId, reason: 'topclash' };
  return null;
}

const OPEN_CHANCE: Record<PressReason, number> = { derby: 100, decider: 100, topclash: 80, cup: 70 };

/**
 * The weekly roll, run next to the dressing room's: an old conference is dropped once its match is played, and
 * a new one opens when the coming week's match is a big one. Deterministic from the world seed, club, season and
 * week, so the same save always gives the same press. Returns the conference that opened this week, if any.
 */
export function weeklyPress(game: GameState): PressConferenceState | null {
  const press = ensurePress(game);
  const season = game.league.season;
  const next = game.league.currentWeek + 1;
  if (press.current && (press.current.season !== season || press.current.week < next))
    press.current = null;
  if (press.current) return null;
  const last = press.history[0];
  if (last && last.season === season && next - last.week < PRESS_COOLDOWN_WEEKS) return null;
  const big = bigMatchReason(game, next);
  if (!big) return null;
  const seed = hash32(`${game.world?.seed ?? 0}|${game.clubId}|press|${season}|${next}`);
  if (seed % 100 >= OPEN_CHANCE[big.reason]) return null;
  const pool = PRESS_QUESTIONS.map((question, index) => ({ question, index })).filter(
    ({ question }) => !question.reasons || question.reasons.includes(big.reason),
  );
  const picked = pool[(seed >>> 7) % pool.length];
  const conference: PressConferenceState = {
    season,
    week: next,
    opponentId: big.opponentId,
    reason: big.reason,
    question: picked.index,
    answer: null,
  };
  press.current = conference;
  return conference;
}

export interface PressOdds {
  /** Chance that the answer works, 0..1. */
  chance: number;
  /** What it would do on success and on failure, with the stakes already counted. */
  success: PressEffect;
  failure: PressEffect;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function scaled(effect: PressEffect, weight: number, swing = 1): PressEffect {
  return {
    spirit: round1(effect.spirit * weight * swing),
    morale: round1(effect.morale * weight * swing),
    board: round1(effect.board * weight * swing),
    opponent: round1(effect.opponent * weight * swing),
  };
}

/** The numbers behind one answer for this manager: media skill moves the chance, traits move the swing. */
export function pressOdds(
  game: Pick<GameState, 'manager'>,
  reason: PressReason,
  style: PressStyle,
): PressOdds {
  const def = pressStyle(style);
  const media = managerAttribute(game.manager, 'media');
  const chance =
    style === 'humble' ? 1 : clamp(def.base + (media - 55) * def.mediaSlope, 0.1, 0.92);
  const weight = REASON_WEIGHT[reason];
  // A risk-taker swings further with the bold answer, a calm manager softens a failure by half.
  const swing =
    style === 'provocative' && hasManagerTrait(game.manager, 'risk-taker')
      ? TRAIT_EFFECTS.riskTakerSwing
      : 1;
  const relief = hasManagerTrait(game.manager, 'calm') ? TRAIT_EFFECTS.calmSpiritShare : 1;
  const failure = scaled(def.failure, weight, swing);
  if (relief < 1)
    for (const key of ['spirit', 'morale', 'board'] as const)
      if (failure[key] < 0) failure[key] = round1(failure[key] * relief);
  return { chance, success: scaled(def.success, weight, swing), failure };
}

export type PressAnswer =
  | { ok: true; success: boolean; effect: PressEffect }
  | { ok: false; error: 'no-conference' | 'answered' };

/** Answers the open conference: a deterministic roll decides, then spirit, morale, board and the opponent react. */
export function answerPress(game: GameState, style: PressStyle): PressAnswer {
  const press = ensurePress(game);
  const conference = press.current;
  const club = ownTeam(game);
  if (!conference || !club) return { ok: false, error: 'no-conference' };
  if (conference.answer !== null) return { ok: false, error: 'answered' };
  const odds = pressOdds(game, conference.reason, style);
  const seed = `${game.world?.seed ?? 0}|${game.clubId}|press-answer|${conference.season}|${conference.week}|${style}`;
  const success = (hash32(seed) % 1000) / 1000 < odds.chance;
  const effect = success ? odds.success : odds.failure;
  const room = ensureRoom(game);
  room.spirit = clamp(room.spirit + effect.spirit, 0, 100);
  for (const player of club.players) player.morale = clamp(player.morale + effect.morale, 15, 100);
  applyBoardDelta(game.board, effect.board);
  const opponent = game.teams.find((team) => team.id === conference.opponentId);
  if (opponent)
    for (const player of opponent.players)
      player.morale = clamp(player.morale + effect.opponent, 15, 100);
  conference.answer = style;
  conference.outcome = {
    success,
    spirit: effect.spirit,
    morale: effect.morale,
    board: effect.board,
    opponent: effect.opponent,
  };
  press.history = [{ season: conference.season, week: conference.week }, ...press.history].slice(0, 12);
  return { ok: true, success, effect };
}
