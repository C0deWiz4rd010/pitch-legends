import { ROOM_EVENTS, RoomEffect, RoomEventDef, roomEventById } from '../../data/dressing-room-events';
import { DressingRoomState, ROOM_ROLES, RoomEventState, RoomRole, emptyDressingRoom } from '../../models/dressing-room.model';
import { GameState } from '../../models/game.model';
import { Player, PlayerPersonality } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { isPlayerAvailable } from '../injury-engine';
import { Rng, clamp } from '../util';
import { hash32 } from '../visual-identity';
import { book } from './finance';
import { TRAIT_EFFECTS, hasManagerTrait, managerAttribute } from './manager-effects';

export { ROOM_ROLES };

/** Share of the matches each role expects to play. */
export const EXPECTED_SHARE: Record<RoomRole, number> = { star: 0.8, starter: 0.6, rotation: 0.25, prospect: 0.1, fringe: 0 };
/** Matches before anyone can complain about playing time. */
export const MIN_MATCHES = 6;
/** Weeks of unhappiness a personality bears before asking to leave. */
export const PATIENCE: Record<PlayerPersonality, number> = { professional: 8, 'team-player': 10, driven: 5, flair: 5, volatile: 4 };
/** Open requests at the same time, at most, and the weeks between two new ones. */
export const MAX_OPEN_REQUESTS = 3;
export const REQUEST_COOLDOWN_WEEKS = 5;
/** Weeks an event waits for an answer before it is gone. */
export const EVENT_LIFETIME_WEEKS = 2;
const UNHAPPY_CAP = 30;

export function ensureRoom(game: GameState): DressingRoomState {
  game.dressingRoom ??= emptyDressingRoom();
  return game.dressingRoom;
}

function ownTeam(game: GameState): Team | undefined {
  return game.teams.find((team) => team.id === game.clubId);
}

/** The matches the club has played this season: the most appearances of anyone in the squad. */
export function matchesPlayed(team: Team): number {
  return team.players.reduce((most, player) => Math.max(most, player.seasonStats.appearances), 0);
}

/** A player's role in his own squad, from where his overall ranks him. */
export function roomRoleOf(player: Player, team: Pick<Team, 'players'>): RoomRole {
  const rank = [...team.players].sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id)).findIndex((candidate) => candidate.id === player.id);
  if (rank < 0) return 'fringe';
  if (rank < 3 && player.overall >= 75) return 'star';
  if (rank < 11) return 'starter';
  if (rank < 17) return 'rotation';
  return player.age <= 21 ? 'prospect' : 'fringe';
}

export interface RoomPlayerView {
  player: Player;
  role: RoomRole;
  /** Share of the club's matches he played this season, 0..1. */
  played: number;
  expected: number;
  unhappyWeeks: number;
  requested: boolean;
}

export function roomView(game: GameState): RoomPlayerView[] {
  const team = ownTeam(game);
  if (!team) return [];
  const room = game.dressingRoom ?? emptyDressingRoom();
  const matches = Math.max(1, matchesPlayed(team));
  return team.players
    .map((player) => {
      const role = roomRoleOf(player, team);
      return {
        player,
        role,
        played: clamp(player.seasonStats.appearances / matches, 0, 1),
        expected: EXPECTED_SHARE[role],
        unhappyWeeks: room.unhappyWeeks[player.id] ?? 0,
        requested: room.requests.includes(player.id),
      };
    })
    .sort((a, b) => ROOM_ROLES.indexOf(a.role) - ROOM_ROLES.indexOf(b.role) || b.player.overall - a.player.overall);
}

/** Where the squad's morale settles each week instead of the old flat 70: a good spirit lifts it, a bad one drags it down. */
export function moraleBaseline(room: DressingRoomState | undefined): number {
  return Math.round(56 + (room?.spirit ?? 70) * 0.2);
}

/** The pull towards which spirit moves, from morale, captain, character mix, leadership and open grievances. */
export function spiritTarget(game: GameState, team: Team, room: DressingRoomState): number {
  const squad = team.players;
  const morale = squad.reduce((sum, player) => sum + player.morale, 0) / Math.max(1, squad.length);
  const captain = squad.find((player) => player.id === team.tactics.captainId);
  const captainBonus = captain ? 2 + (captain.traitIds.includes('leader') ? 3 : 0) + (captain.level >= 8 ? 1 : 0) : 0;
  const mix = clamp(squad.filter((player) => player.personality === 'team-player').length * 0.8, 0, 6) - clamp(squad.filter((player) => player.personality === 'volatile').length * 0.8, 0, 5);
  const leadership = (managerAttribute(game.manager, 'leadership') - 55) / 5;
  const motivator = hasManagerTrait(game.manager, 'motivator') ? TRAIT_EFFECTS.motivatorSpirit : 0;
  const unhappy = Object.keys(room.unhappyWeeks).length;
  return clamp(30 + morale * 0.55 + captainBonus + mix + leadership + motivator - Math.min(10, unhappy * 2), 0, 100);
}

/** A result moves the spirit at once: a win lifts it, a defeat hurts, a calm manager takes the sting out. */
export function applyMatchToRoom(game: GameState, outcome: 'win' | 'draw' | 'loss'): void {
  const room = ensureRoom(game);
  const delta = outcome === 'win' ? 2.5 : outcome === 'loss' ? -2.5 * (hasManagerTrait(game.manager, 'calm') ? TRAIT_EFFECTS.calmSpiritShare : 1) : 0;
  room.spirit = clamp(room.spirit + delta, 0, 100);
}

export interface RoomWeekReport {
  /** Players who asked to leave this week. */
  newRequests: Player[];
  /** An event opened this week. */
  event: RoomEventDef | null;
  /** An unanswered event ran out. */
  expired: RoomEventDef | null;
}

/**
 * One week of the dressing room, for the managed club. Order: grievances grow or fade, requests follow,
 * spirit moves to its target, then an event may come or go. All of it is a pure function of the save.
 */
export function weeklyRoom(game: GameState): RoomWeekReport {
  const report: RoomWeekReport = { newRequests: [], event: null, expired: null };
  const team = ownTeam(game);
  if (!team) return report;
  const room = ensureRoom(game);
  const season = game.league.season;
  const week = game.league.currentWeek;
  const matches = matchesPlayed(team);
  const ids = new Set(team.players.map((player) => player.id));

  // Players who left are forgotten.
  for (const id of Object.keys(room.unhappyWeeks)) if (!ids.has(id)) delete room.unhappyWeeks[id];
  room.requests = room.requests.filter((id) => ids.has(id));

  if (matches >= MIN_MATCHES) {
    for (const player of team.players) {
      const role = roomRoleOf(player, team);
      const expected = EXPECTED_SHARE[role];
      const played = player.seasonStats.appearances / Math.max(1, matches);
      // Only those with a real claim can be aggrieved: a star or one of the first eleven who sits out. Rotation players,
      // talents and fillers accept the bench; their expected share is shown, but it does not make them unhappy.
      const claim = role === 'star' || role === 'starter';
      const aggrieved = claim && isPlayerAvailable(player) && played < expected * 0.5;
      const current = room.unhappyWeeks[player.id] ?? 0;
      if (aggrieved) {
        room.unhappyWeeks[player.id] = Math.min(UNHAPPY_CAP, current + 1);
        // A grievance costs morale; the squad baseline then pulls back only a little each week.
        player.morale = clamp(player.morale - 1 - Math.min(2, Math.floor(current / 4)), 25, 100);
      } else if (current > 0) {
        if (current <= 1) delete room.unhappyWeeks[player.id];
        else room.unhappyWeeks[player.id] = current - 1;
      }
      if (!room.unhappyWeeks[player.id]) room.requests = room.requests.filter((id) => id !== player.id);
    }

    const cooled = room.lastRequestSeason !== season || week - room.lastRequestWeek >= REQUEST_COOLDOWN_WEEKS;
    if (cooled && room.requests.length < MAX_OPEN_REQUESTS) {
      const asking = team.players
        .filter((player) => !room.requests.includes(player.id) && (room.unhappyWeeks[player.id] ?? 0) >= PATIENCE[player.personality])
        .sort((a, b) => (room.unhappyWeeks[b.id] ?? 0) - (room.unhappyWeeks[a.id] ?? 0) || b.overall - a.overall || a.id.localeCompare(b.id))[0];
      if (asking) {
        room.requests.push(asking.id);
        room.lastRequestSeason = season;
        room.lastRequestWeek = week;
        asking.morale = clamp(asking.morale - 10, 15, 100);
        room.spirit = clamp(room.spirit - 3, 0, 100);
        report.newRequests.push(asking);
      }
    }
    // Someone who wants out keeps a low mood until he is talked round or plays.
    for (const id of room.requests) {
      const player = team.players.find((candidate) => candidate.id === id);
      if (player) player.morale = Math.min(player.morale, 45);
    }
  }

  room.spirit = clamp(room.spirit + (spiritTarget(game, team, room) - room.spirit) * 0.2, 0, 100);

  if (room.event) {
    const open = room.event.choice === null;
    if (open && (season !== room.event.season || week - room.event.week >= EVENT_LIFETIME_WEEKS)) {
      report.expired = roomEventById(room.event.eventId) ?? null;
      room.spirit = clamp(room.spirit - 2, 0, 100);
      room.event = null;
    } else if (!open && (season !== room.event.season || week !== room.event.week)) {
      room.event = null;
    }
  }
  if (!room.event) {
    const rolled = rollRoomEvent(game, team, room);
    if (rolled) {
      room.event = { eventId: rolled.id, season, week, choice: null };
      report.event = rolled;
    }
  }
  return report;
}

/** Events the squad's mood allows right now. */
export function eligibleEvents(game: GameState, team: Team, room: DressingRoomState): RoomEventDef[] {
  const hasUnhappy = Object.keys(room.unhappyWeeks).length > 0;
  void game;
  void team;
  return ROOM_EVENTS.filter((event) => {
    if (event.needs === 'unhappy') return hasUnhappy;
    if (event.needs === 'lowSpirit') return room.spirit < 50;
    if (event.needs === 'highSpirit') return room.spirit >= 60;
    return true;
  });
}

/** Deterministic: roughly one week in four brings an event, and the same save always draws the same one. */
function rollRoomEvent(game: GameState, team: Team, room: DressingRoomState): RoomEventDef | null {
  const season = game.league.season;
  const week = game.league.currentWeek;
  if (week < 3) return null;
  const seed = game.world?.seed ?? 0;
  const rng = new Rng(hash32(`${seed}|${game.clubId}|room|${season}|${week}`));
  if (!rng.bool(0.26)) return null;
  const pool = eligibleEvents(game, team, room).filter((event) => !room.history.slice(0, 3).includes(event.id));
  return pool.length ? rng.pick(pool) : null;
}

export type RoomAnswer = { ok: true; xp: number } | { ok: false; error: 'no-event' | 'answered' | 'budget' };

/** Applies one answer to the open event. The second option is the bold one: a risk-taker swings further both ways. */
export function answerRoomEvent(game: GameState, option: 0 | 1): RoomAnswer {
  const room = ensureRoom(game);
  const team = ownTeam(game);
  const state = room.event;
  if (!team || !state) return { ok: false, error: 'no-event' };
  if (state.choice !== null) return { ok: false, error: 'answered' };
  const event = roomEventById(state.eventId);
  if (!event) return { ok: false, error: 'no-event' };
  const effect = event.options[option].effect;
  const coins = effect.coins ?? 0;
  if (coins < 0 && team.coins < -coins) return { ok: false, error: 'budget' };
  const swing = option === 1 && hasManagerTrait(game.manager, 'risk-taker') ? TRAIT_EFFECTS.riskTakerSwing : 1;
  applyRoomEffect(game, team, room, effect, swing);
  state.choice = option;
  room.history = [state.eventId, ...room.history].slice(0, 12);
  return { ok: true, xp: effect.xp ?? 0 };
}

function applyRoomEffect(game: GameState, team: Team, room: DressingRoomState, effect: RoomEffect, swing: number): void {
  if (effect.spirit) room.spirit = clamp(room.spirit + effect.spirit * swing, 0, 100);
  if (effect.morale) for (const player of team.players) player.morale = clamp(player.morale + effect.morale * swing, 15, 100);
  if (effect.calm) for (const id of Object.keys(room.unhappyWeeks)) room.unhappyWeeks[id] = Math.max(1, room.unhappyWeeks[id] - 3);
  if (effect.coins) book(game, team, 'other', effect.coins);
}

export type TalkResult = { ok: true; success: boolean } | { ok: false; error: 'player' | 'content' | 'talked' };

/** A talk with an unhappy player: once a season each; leadership and a calm nature tip the odds. Deterministic. */
export function talkToPlayer(game: GameState, playerId: string): TalkResult {
  const room = ensureRoom(game);
  const team = ownTeam(game);
  const player = team?.players.find((candidate) => candidate.id === playerId);
  if (!team || !player) return { ok: false, error: 'player' };
  if (!(room.unhappyWeeks[playerId] > 0) && !room.requests.includes(playerId)) return { ok: false, error: 'content' };
  const season = game.league.season;
  if (room.talked[playerId] === season) return { ok: false, error: 'talked' };
  room.talked[playerId] = season;
  const chance = clamp(0.45 + (managerAttribute(game.manager, 'leadership') - 55) / 150 + (hasManagerTrait(game.manager, 'calm') ? 0.05 : 0) + (player.personality === 'professional' ? 0.1 : player.personality === 'volatile' ? -0.1 : 0), 0.25, 0.9);
  const roll = (hash32(`${game.world?.seed ?? 0}|talk|${playerId}|${season}|${game.league.currentWeek}`) % 1000) / 1000;
  const success = roll < chance;
  if (success) {
    room.requests = room.requests.filter((id) => id !== playerId);
    room.unhappyWeeks[playerId] = Math.min(2, room.unhappyWeeks[playerId] ?? 2);
    player.morale = clamp(player.morale + 8, 15, 100);
    room.spirit = clamp(room.spirit + 1, 0, 100);
  } else {
    player.morale = clamp(player.morale - 3, 15, 100);
    room.spirit = clamp(room.spirit - 1, 0, 100);
  }
  return { ok: true, success };
}
