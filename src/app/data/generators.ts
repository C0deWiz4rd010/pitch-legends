import { AttributeKey, Position, PositionGroup } from '../models/enums';
import {
  PersonalGoal,
  Player,
  PlayerArchetype,
  PlayerAttributes,
  PlayerPersonality,
  emptySeasonStats,
} from '../models/player.model';
import { Team } from '../models/team.model';
import { League, Fixture } from '../models/league.model';
import { GameState, ManagerProfile, SAVE_VERSION, TacticalPhilosophy, defaultSettings } from '../models/game.model';
import { emptyTransferState } from '../models/transfer.model';
import { defaultFacilities } from '../models/team.model';
import { defaultTactics } from '../models/tactics.model';
import { Rng, uid, clamp } from '../core/util';
import { computeOverall, groupForPosition, marketValueFor, weeklySalaryFor } from '../core/ratings';
import { xpToNextForLevel } from '../core/progression';
import { createFormation } from './formations';
import { ClubIdentity } from './names';
import { TRAITS } from './traits';
import { ARCHETYPES_BY_GROUP } from './talents';
import { createClubVisualIdentity, createManagerVisualIdentity, createPlayerVisualIdentity, hash32 } from '../core/visual-identity';
import { ClubVisualIdentity } from '../models/visual.model';
import { generatePersonName, generateWorld } from './world-generator';

/** Squad template: which positions to fill and their alternates. */
const SQUAD_TEMPLATE: { position: Position; alts: Position[] }[] = [
  { position: 'GK', alts: [] },
  { position: 'GK', alts: [] },
  { position: 'RB', alts: ['RWB', 'RM'] },
  { position: 'LB', alts: ['LWB', 'LM'] },
  { position: 'CB', alts: ['RCB', 'LCB'] },
  { position: 'CB', alts: ['RCB', 'LCB'] },
  { position: 'CB', alts: ['CDM'] },
  { position: 'RWB', alts: ['RB', 'RM'] },
  { position: 'CDM', alts: ['CM'] },
  { position: 'CDM', alts: ['CB', 'CM'] },
  { position: 'CM', alts: ['CDM', 'CAM'] },
  { position: 'CM', alts: ['CAM', 'CDM'] },
  { position: 'CAM', alts: ['CM', 'CF'] },
  { position: 'RM', alts: ['RW', 'RB'] },
  { position: 'LM', alts: ['LW', 'LB'] },
  { position: 'RW', alts: ['RM', 'ST'] },
  { position: 'LW', alts: ['LM', 'ST'] },
  { position: 'ST', alts: ['CF'] },
  { position: 'ST', alts: ['CF', 'RW'] },
  { position: 'CF', alts: ['ST', 'CAM'] },
];

/** Attribute profile bias per position group (0-1 scaling of raw roll). */
const PROFILE: Record<PositionGroup, Partial<Record<AttributeKey, number>>> = {
  GK: { goalkeeping: 1, passing: 0.7, physical: 0.8, pace: 0.6, defending: 0.5, shooting: 0.2, dribbling: 0.4, stamina: 0.6 },
  DEF: { defending: 1, physical: 0.9, pace: 0.8, stamina: 0.85, passing: 0.7, dribbling: 0.55, shooting: 0.4, goalkeeping: 0.05 },
  MID: { passing: 1, dribbling: 0.9, stamina: 0.9, defending: 0.75, physical: 0.75, pace: 0.8, shooting: 0.75, goalkeeping: 0.05 },
  ATT: { shooting: 1, pace: 0.95, dribbling: 0.95, physical: 0.75, passing: 0.75, stamina: 0.8, defending: 0.35, goalkeeping: 0.05 },
};

function generateAttributes(rng: Rng, group: PositionGroup, targetOverall: number): PlayerAttributes {
  const profile = PROFILE[group];
  const attrs = {} as PlayerAttributes;
  const keys: AttributeKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'stamina', 'goalkeeping'];
  for (const key of keys) {
    const bias = profile[key] ?? 0.5;
    const base = targetOverall * bias;
    attrs[key] = Math.round(clamp(rng.gaussian(base, 8), 20, 99));
  }
  // Nudge attributes so the computed overall lands near the target.
  let overall = computeOverall(attrs, group);
  let guard = 0;
  while (Math.abs(overall - targetOverall) > 2 && guard < 30) {
    const delta = targetOverall - overall > 0 ? 2 : -2;
    for (const key of keys) {
      if ((profile[key] ?? 0) > 0.6) attrs[key] = Math.round(clamp(attrs[key] + delta, 20, 99));
    }
    overall = computeOverall(attrs, group);
    guard++;
  }
  return attrs;
}

export function generatePlayer(
  rng: Rng,
  position: Position,
  alts: Position[],
  targetOverall: number,
  kitNumber: number,
  identityKey?: string | number,
  worldSeed?: number,
): Player {
  const identitySeed = rng.int(1, 0x7fffffff);
  const id = `ply-${identitySeed.toString(36)}`;
  const identity = generatePersonName(worldSeed ?? identitySeed, identityKey ?? identitySeed);
  const group = groupForPosition(position);
  const age = rng.int(17, 34);
  const attributes = generateAttributes(rng, group, targetOverall);
  const overall = computeOverall(attributes, group);
  // Younger players have more headroom.
  const potentialBonus = age <= 21 ? rng.int(4, 14) : age <= 25 ? rng.int(1, 7) : rng.int(0, 2);
  const potential = clamp(overall + potentialBonus, overall, 99);
  const level = clamp(Math.round((overall - 45) / 3) + rng.int(0, 2), 1, 20);

  const traitIds: string[] = [];
  if (rng.bool(0.28)) {
    const eligible = TRAITS.filter((t) => t.unlockLevel <= level);
    if (eligible.length) traitIds.push(rng.pick(eligible).id);
  }

  const archetype = rng.pick(ARCHETYPES_BY_GROUP[group]) as PlayerArchetype;
  const personalities: PlayerPersonality[] = ['professional', 'driven', 'flair', 'team-player', 'volatile'];
  const goalPool: PersonalGoal[] =
    group === 'ATT'
      ? [{ type: 'goals', target: rng.int(5, 12), progress: 0, rewardXp: 220, completed: false }]
      : group === 'GK' || group === 'DEF'
        ? [{ type: 'clean-sheets', target: rng.int(4, 9), progress: 0, rewardXp: 220, completed: false }]
        : [{ type: 'assists', target: rng.int(4, 10), progress: 0, rewardXp: 220, completed: false }];
  const marketValue = marketValueFor(overall, age, potential);

  return {
    id,
    firstName: identity.firstName,
    lastName: identity.lastName,
    nationality: identity.nationality,
    age,
    foot: rng.bool(0.72) ? 'Right' : rng.bool(0.6) ? 'Left' : 'Both',
    kitNumber,
    visuals: createPlayerVisualIdentity(id),
    position,
    positionGroup: group,
    altPositions: alts,
    attributes,
    overall,
    potential,
    level,
    xp: 0,
    xpToNext: xpToNextForLevel(level),
    skillPoints: 0,
    traitIds,
    archetype,
    developmentPlan: 'balanced',
    talentRanks: {},
    personality: rng.pick(personalities),
    personalGoal: goalPool[0],
    morale: rng.int(60, 85),
    fitness: rng.int(88, 100),
    form: rng.int(-1, 2),
    injuryWeeks: 0,
    medical: { activeInjury: null, history: [], recurrenceUntilWeek: null },
    marketValue,
    salary: weeklySalaryFor({ marketValue, age, overall }),
    contractWeeks: rng.int(40, 160),
    seasonStats: emptySeasonStats(),
  };
}

export function generateSquad(rng: Rng, teamStrength: number, teamKey = 'team', worldSeed?: number): Player[] {
  const players: Player[] = [];
  const usedNumbers = new Set<number>();
  SQUAD_TEMPLATE.forEach((slot, i) => {
    const target = clamp(Math.round(rng.gaussian(teamStrength, 5)), 40, 92);
    let kit = clamp(i + 1 + rng.int(0, 3), 1, 99);
    while (usedNumbers.has(kit)) kit = clamp(kit + 1, 1, 99);
    usedNumbers.add(kit);
    players.push(generatePlayer(rng, slot.position, slot.alts, target, kit, `${teamKey}|${i}`, worldSeed));
  });
  return players;
}

export function generateTeam(
  rng: Rng,
  identity: ClubIdentity,
  strength: number,
  isPlayerControlled: boolean,
  visuals?: ClubVisualIdentity,
  meta?: { id: string; cityId: string; managerId: string; worldSeed: number },
): Team {
  const teamId = meta?.id ?? `team-${rng.int(1, 0x7fffffff).toString(36)}`;
  const players = generateSquad(rng, strength, teamId, meta?.worldSeed);
  const formation = createFormation('4-3-3');
  const wageBill = players.reduce((sum, player) => sum + player.salary, 0);
  const team: Team = {
    id: teamId,
    name: identity.name,
    shortName: identity.short,
    kit: { primary: identity.primary, secondary: identity.secondary },
    visuals: visuals ?? createClubVisualIdentity(identity.name, identity.short, identity.primary, identity.secondary, rng.int(1, 0x7fffffff)),
    players,
    formation,
    tactics: defaultTactics(),
    facilities: defaultFacilities(),
    coins: isPlayerControlled ? 250_000 : 400_000,
    reputation: clamp(Math.round(strength), 30, 95),
    wageBudget: Math.ceil((wageBill * 1.25) / 500) * 500,
    isPlayerControlled,
    strength,
    managerId: meta?.managerId ?? `manager-${teamId}`,
    cityId: meta?.cityId ?? `city-${teamId}`,
    rivalTeamIds: [],
  };
  autoFillLineup(team);
  return team;
}

/** Fill formation slots with the best-fitting available players. */
export function autoFillLineup(team: Team): void {
  const available = [...team.players];
  for (const slot of team.formation.slots) {
    // Prefer exact position, then alt, then same group, then anyone.
    available.sort((a, b) => selectionScore(b, slot.position) - selectionScore(a, slot.position));
    const chosen = available.shift();
    slot.playerId = chosen ? chosen.id : null;
  }
  // Assign leadership & set-piece takers to sensible defaults.
  const starters = team.formation.slots
    .map((s) => team.players.find((p) => p.id === s.playerId))
    .filter((p): p is Player => !!p);
  if (starters.length) {
    const byOverall = [...starters].sort((a, b) => b.overall - a.overall);
    team.tactics.captainId = byOverall[0].id;
    team.tactics.penaltyTakerId = bestBy(starters, 'shooting').id;
    team.tactics.freeKickTakerId = bestBy(starters, 'passing').id;
    team.tactics.cornerTakerId = bestBy(starters, 'passing').id;
  }
}

function selectionScore(player: Player, position: Position): number {
  let score = player.overall;
  if (player.position === position) score += 25;
  else if (player.altPositions.includes(position)) score += 12;
  else if (groupForPosition(position) === player.positionGroup) score += 4;
  return score;
}

function bestBy(players: Player[], attr: AttributeKey): Player {
  return players.reduce((best, p) => (p.attributes[attr] > best.attributes[attr] ? p : best), players[0]);
}

/** Double round-robin fixture list. */
export function generateFixtures(teamIds: string[], rng: Rng): Fixture[] {
  const ids = rng.shuffle(teamIds);
  if (ids.length % 2 !== 0) ids.push('__BYE__');
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const fixtures: Fixture[] = [];
  const arr = ids.slice();

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home !== '__BYE__' && away !== '__BYE__') {
        // Alternate home/away for balance across rounds.
        const swap = round % 2 === 0;
        fixtures.push(makeFixture(round + 1, swap ? home : away, swap ? away : home));
      }
    }
    // Rotate all but the first element.
    arr.splice(1, 0, arr.pop()!);
  }

  // Second half of season: reverse fixtures.
  const firstHalf = fixtures.slice();
  firstHalf.forEach((f) => {
    fixtures.push(makeFixture(f.week + rounds, f.awayTeamId, f.homeTeamId));
  });

  return fixtures;
}

function makeFixture(week: number, homeTeamId: string, awayTeamId: string): Fixture {
  return { id: `fx-${week}-${homeTeamId}-${awayTeamId}`, week, homeTeamId, awayTeamId, homeScore: null, awayScore: null, played: false };
}

export interface NewGameOptions {
  managerName: string;
  clubName: string;
  clubShort?: string;
  primary?: string;
  secondary?: string;
  difficulty?: 'easy' | 'normal' | 'hard';
  locale?: 'de' | 'en';
  seed?: number;
  visuals?: ClubVisualIdentity;
  managerPhilosophy?: TacticalPhilosophy;
}

/** Build a full, ready-to-play GameState. */
export function createNewGame(opts: NewGameOptions): GameState {
  const seed = opts.seed ?? (Date.now() >>> 0);
  const rng = new Rng(seed);
  const totalTeams = 12;
  const teamIds = Array.from({ length: totalTeams }, (_, index) => `team-${hash32(`${seed}|team|${index}`).toString(36)}`);
  const worldBlueprint = generateWorld(seed, teamIds, opts.clubName);

  // Player's club identity.
  const playerIdentity: ClubIdentity = {
    name: opts.clubName,
    short: (opts.clubShort || opts.clubName.slice(0, 3)).toUpperCase(),
    primary: opts.primary || '#38e07b',
    secondary: opts.secondary || '#04240f',
  };

  const teams: Team[] = [];
  const ownManager = generateManager(seed, 0, teamIds[0], opts.managerName || 'Manager', opts.primary || '#38e07b', true, opts.managerPhilosophy);
  const aiManagers = Array.from({ length: totalTeams - 1 }, (_, index) =>
    generateManager(seed, index + 1, teamIds[index + 1], undefined, worldBlueprint.clubIdentities[index + 1].primary, false),
  );

  // Player team is mid-table strength so there's room to grow.
  teams.push(generateTeam(rng, playerIdentity, 66, true, opts.visuals, {
    id: teamIds[0], cityId: worldBlueprint.world.cities[0].id, managerId: ownManager.id, worldSeed: seed,
  }));
  worldBlueprint.clubIdentities.slice(1).forEach((identity, i) => {
    const strength = clamp(Math.round(58 + rng.gaussian(8, 9) + (i % 4) * 2), 50, 84);
    const manager = aiManagers[i];
    const team = generateTeam(rng, identity, strength, false, undefined, {
      id: teamIds[i + 1], cityId: worldBlueprint.world.cities[i + 1].id, managerId: manager.id, worldSeed: seed,
    });
    applyManagerPhilosophy(team, manager.tacticalPhilosophy);
    teams.push(team);
  });

  for (const rivalry of worldBlueprint.world.rivalries) {
    const a = teams.find((team) => team.id === rivalry.teamAId);
    const b = teams.find((team) => team.id === rivalry.teamBId);
    if (a && !a.rivalTeamIds.includes(rivalry.teamBId)) a.rivalTeamIds.push(rivalry.teamBId);
    if (b && !b.rivalTeamIds.includes(rivalry.teamAId)) b.rivalTeamIds.push(rivalry.teamAId);
  }
  const fixtures = generateFixtures(teamIds, rng);
  const totalWeeks = Math.max(...fixtures.map((f) => f.week));

  const league: League = {
    id: `league-${seed.toString(36)}`,
    name: worldBlueprint.world.country.leagueName,
    season: 1,
    currentWeek: 1,
    totalWeeks,
    teamIds,
    fixtures,
  };

  const now = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    managerName: `${ownManager.firstName} ${ownManager.lastName}`.trim(),
    clubId: teams[0].id,
    teams,
    league,
    results: [],
    news: [
      {
        id: `news-${seed.toString(36)}-welcome`,
        week: 1,
        icon: 'star',
        titleKey: 'news.welcome.title',
        bodyKey: 'news.welcome.body',
        params: { club: playerIdentity.name, manager: opts.managerName || 'Boss' },
      },
    ],
    settings: {
      ...defaultSettings(),
      difficulty: opts.difficulty ?? 'normal',
      locale: opts.locale ?? 'de',
    },
    manager: ownManager,
    managers: aiManagers,
    trainingWeek: { season: 1, week: 1, slotsUsed: 0, maxSlots: 3, completedSessions: [] },
    objectives: [
      {
        id: `objective-${seed.toString(36)}-league`,
        type: 'league-position',
        target: 6,
        progress: 12,
        rewardCoins: 180000,
        rewardXp: 300,
        completed: false,
      },
      {
        id: `objective-${seed.toString(36)}-growth`,
        type: 'player-growth',
        target: 3,
        progress: 0,
        rewardCoins: 80000,
        rewardXp: 180,
        completed: false,
      },
    ],
    transfers: emptyTransferState(1, 1),
    world: worldBlueprint.world,
  };
}

function generateManager(seed: number, index: number, clubId: string, explicitName: string | undefined, clubPrimary: string, playerControlled: boolean, preferredPhilosophy?: TacticalPhilosophy): ManagerProfile {
  const generated = generatePersonName(seed, `manager-${index}`);
  const parts = explicitName?.trim().split(/\s+/).filter(Boolean) ?? [];
  const firstName = parts.length ? parts[0] : generated.firstName;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts.length ? '' : generated.lastName;
  const rng = new Rng(hash32(`${seed}|manager-profile|${index}`));
  const tacticalPhilosophy = rng.pick(['balanced', 'possession', 'gegenpress', 'counter', 'low-block'] as const);
  return {
    id: `manager-${hash32(`${seed}|${index}`).toString(36)}`,
    clubId,
    firstName,
    lastName,
    age: rng.int(35, 66),
    nationality: generated.nationality,
    visuals: createManagerVisualIdentity(`manager-${seed}-${index}`, clubPrimary),
    attributes: {
      coaching: playerControlled ? 55 : rng.int(45, 88),
      tactics: playerControlled ? 55 : rng.int(45, 88),
      scouting: playerControlled ? 55 : rng.int(45, 88),
      leadership: playerControlled ? 55 : rng.int(45, 88),
      negotiation: playerControlled ? 55 : rng.int(45, 88),
      youthDevelopment: playerControlled ? 55 : rng.int(45, 88),
    },
    tacticalPhilosophy: playerControlled ? preferredPhilosophy ?? 'balanced' : tacticalPhilosophy,
    recruitmentPhilosophy: rng.pick(['academy', 'stars', 'value', 'athletic', 'loyalty'] as const),
    preferredFormation: rng.pick(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'] as const),
    traits: rng.shuffle(['calm', 'motivator', 'analyst', 'developer', 'risk-taker', 'negotiator']).slice(0, 2),
    level: 1,
    xp: 0,
    xpToNext: 250,
    skillPoints: 0,
    perks: {},
  };
}

function applyManagerPhilosophy(team: Team, philosophy: TacticalPhilosophy): void {
  if (philosophy === 'possession') Object.assign(team.tactics, { mentality: 'balanced', pressing: 'medium', tempo: 'slow', buildUp: 'play-out-of-defence', passing: 'short', counterAttack: false });
  if (philosophy === 'gegenpress') Object.assign(team.tactics, { mentality: 'attacking', pressing: 'gegenpress', tempo: 'fast', defensiveLine: 'high', counterAttack: true });
  if (philosophy === 'counter') Object.assign(team.tactics, { mentality: 'defensive', pressing: 'medium', tempo: 'fast', defensiveLine: 'deep', buildUp: 'long-ball', passing: 'direct', counterAttack: true });
  if (philosophy === 'low-block') Object.assign(team.tactics, { mentality: 'ultra-defensive', pressing: 'low', tempo: 'slow', defensiveLine: 'deep', width: 'narrow', counterAttack: false });
}
