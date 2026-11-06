import { RpgService } from '../services/rpg.service';
import { GameState } from '../../models/game.model';
import { Player } from '../../models/player.model';
import { spentOnTalents } from '../rpg/talent-preview';
import { clamp } from '../util';
import { book } from './finance';
import { managerAttribute } from './manager-effects';

const rpg = new RpgService();

/** Coins of a talent conversation: more for a higher level, a little less with a manager the players trust. */
export function respecCost(game: Pick<GameState, 'manager'>, player: Pick<Player, 'level'>): number {
  const leadership = managerAttribute(game.manager, 'leadership');
  const discount = clamp((leadership - 55) / 200, 0, 0.15);
  return Math.round((4000 + player.level * 800) * (1 - discount) / 100) * 100;
}

export type RespecState = 'ok' | 'nothing' | 'done';

/** One new beginning per player and season, and only when there is something to take back. */
export function respecState(player: Pick<Player, 'talentRanks' | 'respecSeason'>, season: number): RespecState {
  if (player.respecSeason === season) return 'done';
  return spentOnTalents(player) > 0 ? 'ok' : 'nothing';
}

export type RespecResult =
  | { ok: true; cost: number; refunded: number; mood: 'agrees' | 'grumbles' }
  | { ok: false; error: 'player' | 'nothing' | 'done' | 'budget'; cost?: number };

/**
 * A conversation between the manager and a player about a different role: the player gets all his talent points
 * back to spend again, the club pays, and he does it once per season. A volatile player is not happy about the
 * fuss and loses a little morale; the rest agree.
 */
export function respecTalents(game: GameState, playerId: string): RespecResult {
  const club = game.teams.find((team) => team.id === game.clubId);
  const player = club?.players.find((candidate) => candidate.id === playerId);
  if (!club || !player) return { ok: false, error: 'player' };
  const state = respecState(player, game.league.season);
  if (state !== 'ok') return { ok: false, error: state };
  const cost = respecCost(game, player);
  if (club.coins < cost) return { ok: false, error: 'budget', cost };
  book(game, club, 'upkeep', cost);
  const refunded = rpg.refundTalents(player);
  player.respecSeason = game.league.season;
  const grumbles = player.personality === 'volatile';
  if (grumbles) player.morale = clamp(player.morale - 3, 0, 100);
  return { ok: true, cost, refunded, mood: grumbles ? 'grumbles' : 'agrees' };
}
