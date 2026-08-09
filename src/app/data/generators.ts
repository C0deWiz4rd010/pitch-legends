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
import { GameState, SAVE_VERSION, defaultSettings } from '../models/game.model';
import { emptyTransferState } from '../models/transfer.model';
import { defaultFacilities } from '../models/team.model';
import { defaultTactics } from '../models/tactics.model';
import { Rng, uid, clamp } from '../core/util';
import { computeOverall, groupForPosition, marketValueFor, weeklySalaryFor } from '../core/ratings';
import { xpToNextForLevel } from '../core/progression';
import { createFormation } from './formations';
import { CLUB_IDENTITIES, FIRST_NAMES, LAST_NAMES, NATIONALITIES, ClubIdentity } from './names';
import { TRAITS } from './traits';
import { ARCHETYPES_BY_GROUP } from './talents';
import { createClubVisualIdentity, createPlayerVisualIdentity } from '../core/visual-identity';
import { ClubVisualIdentity } from '../models/visual.model';

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
): Player {
  const id = uid('ply');
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
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    nationality: rng.pick(NATIONALITIES),
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
    marketValue,
    salary: weeklySalaryFor({ marketValue, age, overall }),
    contractWeeks: rng.int(40, 160),
    seasonStats: emptySeasonStats(),
  };
}

export function generateSquad(rng: Rng, teamStrength: number): Player[] {
  const players: Player[] = [];
  const usedNumbers = new Set<number>();
  SQUAD_TEMPLATE.forEach((slot, i) => {
    const target = clamp(Math.round(rng.gaussian(teamStrength, 5)), 40, 92);
    let kit = clamp(i + 1 + rng.int(0, 3), 1, 99);
    while (usedNumbers.has(kit)) kit = clamp(kit + 1, 1, 99);
    usedNumbers.add(kit);
    players.push(generatePlayer(rng, slot.position, slot.alts, target, kit));
  });
  return players;
}

export function generateTeam(
  rng: Rng,
  identity: ClubIdentity,
  strength: number,
  isPlayerControlled: boolean,
  visuals?: ClubVisualIdentity,
): Team {
  const players = generateSquad(rng, strength);
  const formation = createFormation('4-3-3');
  const wageBill = players.reduce((sum, player) => sum + player.salary, 0);
  const team: Team = {
    id: uid('team'),
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
  return { id: uid('fx'), week, homeTeamId, awayTeamId, homeScore: null, awayScore: null, played: false };
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
}

/** Build a full, ready-to-play GameState. */
export function createNewGame(opts: NewGameOptions): GameState {
  const rng = new Rng(opts.seed ?? (Date.now() >>> 0));
  const totalTeams = 12;

  // Player's club identity.
  const playerIdentity: ClubIdentity = {
    name: opts.clubName,
    short: (opts.clubShort || opts.clubName.slice(0, 3)).toUpperCase(),
    primary: opts.primary || '#38e07b',
    secondary: opts.secondary || '#04240f',
  };

  const aiIdentities = rng.shuffle(CLUB_IDENTITIES).slice(0, totalTeams - 1);
  const teams: Team[] = [];

  // Player team is mid-table strength so there's room to grow.
  teams.push(generateTeam(rng, playerIdentity, 66, true, opts.visuals));
  aiIdentities.forEach((id, i) => {
    const strength = clamp(Math.round(58 + rng.gaussian(8, 9) + (i % 4) * 2), 50, 84);
    teams.push(generateTeam(rng, id, strength, false));
  });

  const teamIds = teams.map((t) => t.id);
  const fixtures = generateFixtures(teamIds, rng);
  const totalWeeks = Math.max(...fixtures.map((f) => f.week));

  const league: League = {
    id: uid('lg'),
    name: 'Legends League',
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
    managerName: opts.managerName || 'Manager',
    clubId: teams[0].id,
    teams,
    league,
    results: [],
    news: [
      {
        id: uid('news'),
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
    manager: {
      level: 1,
      xp: 0,
      xpToNext: 250,
      skillPoints: 0,
      perks: {},
    },
    trainingWeek: { season: 1, week: 1, slotsUsed: 0, maxSlots: 3, completedSessions: [] },
    objectives: [
      {
        id: uid('objective'),
        type: 'league-position',
        target: 6,
        progress: 12,
        rewardCoins: 180000,
        rewardXp: 300,
        completed: false,
      },
      {
        id: uid('objective'),
        type: 'player-growth',
        target: 3,
        progress: 0,
        rewardCoins: 80000,
        rewardXp: 180,
        completed: false,
      },
    ],
    transfers: emptyTransferState(1, 1),
  };
}
