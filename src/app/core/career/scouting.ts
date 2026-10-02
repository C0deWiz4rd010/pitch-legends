import { ScoutAssignment } from '../../models/career.model';
import { GameState } from '../../models/game.model';
import { Player } from '../../models/player.model';
import { clamp } from '../util';
import { hash32 } from '../visual-identity';
import { book } from './finance';

export const SCOUT_ASSIGNMENT_COST = 15_000;
export const SCOUT_ASSIGNMENT_WEEKS = 3;

/** Players of clubs based in a region, best potential first. */
export function regionPlayers(game: GameState, regionId: string, group: Player['positionGroup'] | null): Player[] {
  const teamIds = new Set(game.world.cities.filter((city) => city.regionId === regionId).map((city) => city.teamId));
  teamIds.delete(game.clubId);
  return game.teams.filter((team) => teamIds.has(team.id)).flatMap((team) => team.players)
    .filter((player) => !group || player.positionGroup === group)
    .sort((a, b) => b.potential - a.potential || b.overall - a.overall);
}

/** Adds precise reports (±1) for up to `count` players and returns their ids. */
export function deliverScoutReports(game: GameState, players: Player[], count: number, variance = 1): string[] {
  const delivered: string[] = [];
  const known = new Set(game.transfers.reports.filter((report) => report.season === game.league.season && report.exact).map((report) => report.playerId));
  for (const player of players) {
    if (delivered.length >= count) break;
    if (known.has(player.id)) continue;
    game.transfers.reports = game.transfers.reports.filter((report) => !(report.playerId === player.id && report.season === game.league.season));
    game.transfers.reports.unshift({
      playerId: player.id,
      season: game.league.season,
      createdWeek: game.league.currentWeek,
      confidence: variance === 0 ? 100 : 90,
      overallMin: clamp(player.overall - variance, 1, 99),
      overallMax: clamp(player.overall + variance, 1, 99),
      potentialMin: clamp(player.potential - variance, 1, 99),
      potentialMax: clamp(player.potential + variance, 1, 99),
      exact: variance === 0,
    });
    delivered.push(player.id);
  }
  game.transfers.reports = game.transfers.reports.slice(0, 80);
  return delivered;
}

/** Scout report from a travel event: three talents from the region of the host city. */
export function travelScoutReport(game: GameState, cityName: string): string[] {
  const city = game.world.cities.find((candidate) => candidate.name === cityName);
  if (!city) return [];
  return deliverScoutReports(game, regionPlayers(game, city.regionId, null), 3);
}

export function startScoutAssignment(game: GameState, regionId: string, positionGroup: ScoutAssignment['positionGroup']): { ok: boolean; reason?: string } {
  const club = game.teams.find((team) => team.id === game.clubId);
  if (!club) return { ok: false, reason: 'club' };
  game.scouting ??= [];
  if (game.scouting.filter((assignment) => !assignment.delivered).length >= 2) return { ok: false, reason: 'busy' };
  if (club.coins < SCOUT_ASSIGNMENT_COST) return { ok: false, reason: 'budget' };
  if (!game.world.regions.some((region) => region.id === regionId)) return { ok: false, reason: 'region' };
  book(game, club, 'other', -SCOUT_ASSIGNMENT_COST);
  const perks = game.manager.perks.scouting ?? 0;
  game.scouting.unshift({
    id: `scout-${hash32(`${regionId}|${positionGroup}|${game.league.season}|${game.league.currentWeek}|${game.scouting.length}`).toString(36)}`,
    regionId,
    positionGroup,
    season: game.league.season,
    startedWeek: game.league.currentWeek,
    readyWeek: game.league.currentWeek + Math.max(1, SCOUT_ASSIGNMENT_WEEKS - Math.floor(perks / 2)),
    delivered: false,
    playerIds: [],
  });
  game.scouting = game.scouting.slice(0, 12);
  return { ok: true };
}

/** Called every week: finished assignments deliver their reports. Returns the assignments that completed. */
export function processScoutAssignments(game: GameState): ScoutAssignment[] {
  const done: ScoutAssignment[] = [];
  for (const assignment of game.scouting ?? []) {
    if (assignment.delivered || (assignment.season === game.league.season && assignment.readyWeek > game.league.currentWeek)) continue;
    assignment.playerIds = deliverScoutReports(game, regionPlayers(game, assignment.regionId, assignment.positionGroup), 4);
    assignment.delivered = true;
    done.push(assignment);
  }
  return done;
}
