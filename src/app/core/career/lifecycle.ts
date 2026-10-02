import { autoFillLineup, generatePlayer } from '../../data/generators';
import { PlayerCareerStats } from '../../models/career.model';
import { AttributeKey, Position } from '../../models/enums';
import { GameState } from '../../models/game.model';
import { Player, emptySeasonStats } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { OVERALL_WEIGHTS, computeOverall, marketValueFor, playerName, weeklySalaryFor } from '../ratings';
import { MIN_SQUAD_SIZE } from '../transfer-engine';
import { Rng, clamp } from '../util';
import { createPlayerVisualIdentity, hash32 } from '../visual-identity';

const YOUTH_POSITIONS: Position[] = ['GK', 'CB', 'RB', 'LB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST'];
const MAX_AI_SQUAD = 24;

function roll(seed: number, ...parts: Array<string | number>): number {
  return hash32(`${seed}|${parts.join('|')}`) / 0xffffffff;
}

/** Retirement odds by age; strong players hang on a little longer. */
export function retirementChance(player: Player): number {
  const base = player.age < 33 ? 0 : player.age === 33 ? 0.15 : player.age === 34 ? 0.3 : player.age === 35 ? 0.5 : player.age === 36 ? 0.72 : 0.92;
  return clamp(base - (player.overall >= 78 ? 0.1 : 0), 0, 1);
}

/** Players who end their career after this season. Deterministic, so the season review can announce them. */
export function retiringPlayers(game: GameState): Array<{ player: Player; team: Team }> {
  const result: Array<{ player: Player; team: Team }> = [];
  for (const team of game.teams) {
    for (const player of team.players) {
      if (roll(game.world.seed, 'retire', game.league.season, player.id) < retirementChance(player)) result.push({ player, team });
    }
  }
  return result;
}

/**
 * One year of development: growth towards potential up to 23, a plateau in the late twenties,
 * then decline from 31 with pace first, followed by stamina and physique.
 */
export function developPlayer(player: Player, rng: Rng, growthFactor = 1): void {
  const weights = OVERALL_WEIGHTS[player.positionGroup];
  const keys = Object.keys(weights) as AttributeKey[];
  const pickWeighted = () => {
    let value = rng.next() * keys.reduce((sum, key) => sum + weights[key]!, 0);
    for (const key of keys) { value -= weights[key]!; if (value <= 0) return key; }
    return keys[0];
  };
  const raise = (key: AttributeKey, amount: number) => { player.attributes[key] = clamp(player.attributes[key] + amount, 1, 99); };
  if (player.age <= 27) {
    const room = Math.max(0, player.potential - player.overall);
    const pace = player.age <= 21 ? 0.3 : player.age <= 24 ? 0.2 : 0.08;
    let points = Math.round((room * pace + rng.float(-0.5, 1.2)) * growthFactor * 2);
    for (let guard = 0; points > 0 && guard < 40 && player.overall < player.potential; guard++) {
      raise(pickWeighted(), 1);
      player.overall = computeOverall(player.attributes, player.positionGroup);
      points--;
    }
  } else if (player.age >= 31) {
    const severity = player.age >= 34 ? 3 : player.age >= 33 ? 2 : 1;
    raise('pace', -rng.int(1, 1 + severity));
    raise('stamina', -rng.int(0, severity));
    if (player.age >= 32) raise('physical', -rng.int(0, severity));
    if (player.age >= 33) for (let index = 0; index < 2; index++) raise(rng.pick(keys), -1);
    player.potential = Math.max(computeOverall(player.attributes, player.positionGroup), player.potential - severity);
  }
  player.overall = computeOverall(player.attributes, player.positionGroup);
  player.potential = Math.max(player.potential, player.overall);
  player.marketValue = marketValueFor(player.overall, player.age, player.potential);
}

export function addCareerStats(player: Player, teamShortName: string): void {
  const stats = player.seasonStats;
  const career: PlayerCareerStats = player.career ?? { seasons: 0, appearances: 0, goals: 0, assists: 0, clubs: [] };
  if (stats.appearances > 0) career.seasons++;
  career.appearances += stats.appearances;
  career.goals += stats.goals;
  career.assists += stats.assists;
  if (!career.clubs.includes(teamShortName)) career.clubs.push(teamShortName);
  player.career = career;
  player.seasonStats = emptySeasonStats();
}

/**
 * Season roll-over for every squad: retirements, expiring contracts, development, youth intake.
 * Returns news-worthy facts about the player's club.
 */
export function rollOverSquads(game: GameState): { retired: Player[]; left: Player[]; renewedAi: number } {
  const seed = game.world.seed;
  const season = game.league.season;
  const retiring = new Set(retiringPlayers(game).map((entry) => entry.player.id));
  const retired: Player[] = [];
  const left: Player[] = [];
  let renewedAi = 0;
  for (const team of game.teams) {
    const own = team.id === game.clubId;
    const rng = new Rng(hash32(`${seed}|rollover|${season}|${team.id}`));
    const keep: Player[] = [];
    let removed = 0;
    for (const player of team.players) {
      addCareerStats(player, team.shortName);
      if (retiring.has(player.id)) { if (own) retired.push(player); removed++; continue; }
      if (player.contractWeeks <= 0) {
        const keyPlayer = player.overall >= team.strength - 3 && player.age <= 31;
        if (own) {
          left.push(player);
          removed++;
          continue;
        }
        if (keyPlayer || team.players.length - removed - 1 < MIN_SQUAD_SIZE + 2) {
          player.contractWeeks = player.age >= 30 ? 52 : 104;
          player.salary = weeklySalaryFor(player);
          renewedAi++;
        } else {
          releaseToMarket(game, player);
          removed++;
          continue;
        }
      }
      keep.push(player);
    }
    team.players = keep;
    for (const player of team.players) {
      player.age = Math.min(40, player.age + 1);
      player.fitness = 100;
      developPlayer(player, rng, own ? 0.5 : 1);
    }
    if (!own) aiYouthIntake(game, team, rng);
    // Every squad keeps two goalkeepers (one at the player's club, who may sign more).
    const keepers = team.players.filter((player) => player.positionGroup === 'GK').length;
    for (let index = keepers; index < (own ? 1 : 2); index++) team.players.push(prospectFor(game, team, rng, 90 + index, 'GK'));
    while (team.players.length < MIN_SQUAD_SIZE) team.players.push(prospectFor(game, team, rng, team.players.length));
    autoFillLineup(team);
  }
  for (const player of left) releaseToMarket(game, player);
  for (const player of game.transfers.freeAgents) { player.age = Math.min(40, player.age + 1); developPlayer(player, new Rng(hash32(`${seed}|fa|${season}|${player.id}`)), 0.6); }
  // Old free agents retire as well and the pool stays a useful size.
  game.transfers.freeAgents = game.transfers.freeAgents.filter((player) => player.age < 35).sort((a, b) => b.overall - a.overall).slice(0, 40);
  game.transfers.listings = game.transfers.listings.filter((listing) => game.teams.some((team) => team.id === listing.teamId && team.players.some((player) => player.id === listing.playerId)));
  return { retired, left, renewedAi };
}

function releaseToMarket(game: GameState, player: Player): void {
  player.contractWeeks = 0;
  player.salary = weeklySalaryFor(player);
  if (!game.transfers.freeAgents.some((candidate) => candidate.id === player.id)) game.transfers.freeAgents.push(player);
}

function aiYouthIntake(game: GameState, team: Team, rng: Rng): void {
  const count = Math.min(MAX_AI_SQUAD - team.players.length, 1 + Math.floor(team.facilities.youthAcademy / 2));
  for (let index = 0; index < count; index++) team.players.push(prospectFor(game, team, rng, index));
}

/** A 16-18 year old whose quality follows the academy level and the club's standing. */
export function prospectFor(game: GameState, team: Team, rng: Rng, index: number, position?: Position): Player {
  const academy = team.facilities.youthAcademy;
  const overall = clamp(Math.round(45 + academy * 3 + team.reputation * 0.08 + rng.gaussian(0, 4)), 44, 74);
  const used = new Set(team.players.map((player) => player.kitNumber));
  let kit = rng.int(24, 60);
  while (used.has(kit)) kit = kit >= 99 ? 24 : kit + 1;
  const prospect = generatePlayer(rng, position ?? rng.pick(YOUTH_POSITIONS), [], overall, kit);
  prospect.id = `youth-${hash32(`${game.world.seed}|${team.id}|${game.league.season}|${index}|${rng.int(0, 1e6)}`).toString(36)}`;
  prospect.visuals = createPlayerVisualIdentity(prospect.id);
  prospect.age = rng.int(16, 18);
  prospect.potential = clamp(Math.max(prospect.potential, prospect.overall + 7 + academy * 2), prospect.overall, 99);
  prospect.marketValue = marketValueFor(prospect.overall, prospect.age, prospect.potential);
  prospect.salary = weeklySalaryFor(prospect);
  prospect.contractWeeks = 156;
  return prospect;
}

/** The player's own intake waits in the academy until the manager decides. */
export function academyIntake(game: GameState): Player[] {
  const club = game.teams.find((team) => team.id === game.clubId);
  if (!club) return [];
  const rng = new Rng(hash32(`${game.world.seed}|academy|${game.league.season}`));
  const count = 2 + Math.floor(club.facilities.youthAcademy / 2);
  return Array.from({ length: count }, (_, index) => prospectFor(game, club, rng, index));
}

export function describePlayer(player: Player): string {
  return `${playerName(player)} (${player.age}, ${player.overall})`;
}
