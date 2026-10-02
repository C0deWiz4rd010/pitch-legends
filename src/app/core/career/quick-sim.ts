import { MatchEvent, MatchResult, PenaltyShootout, emptyContribution, emptyTeamMatchStats } from '../../models/match.model';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { createInjury, isPlayerAvailable } from '../injury-engine';
import { playerName } from '../ratings';
import { Rng, clamp } from '../util';
import { hash32 } from '../visual-identity';

/**
 * Statistical result for matches nobody watches: the other division and cup ties without the player's
 * club. The full 60 Hz engine stays in charge of the player's division and of the player's own ties;
 * this model keeps a week with 17 extra fixtures well under a frame budget per match.
 */
export interface QuickSimOptions {
  fixtureId: string;
  week: number;
  season: number;
  knockout?: boolean;
}

export function teamStrength(team: Team): number {
  const starters = team.formation.slots
    .map((slot) => team.players.find((player) => player.id === slot.playerId))
    .filter((player): player is Player => !!player && isPlayerAvailable(player));
  if (!starters.length) return 40;
  const average = starters.reduce((sum, player) => sum + player.overall, 0) / starters.length;
  // Missing starters weaken the side noticeably.
  return average - (11 - starters.length) * 3;
}

export function quickSimulate(home: Team, away: Team, options: QuickSimOptions): MatchResult {
  const rng = new Rng(hash32(`${options.fixtureId}|quick-sim-v1`));
  const diff = teamStrength(home) + 1.5 - teamStrength(away);
  const homeLambda = clamp(1.38 * Math.exp(diff / 15), 0.25, 4.2);
  const awayLambda = clamp(1.12 * Math.exp(-diff / 15), 0.2, 3.8);
  const events: MatchEvent[] = [];
  const contributions: MatchResult['contributions'] = {};
  const starters = (team: Team) => team.formation.slots
    .map((slot) => team.players.find((player) => player.id === slot.playerId))
    .filter((player): player is Player => !!player && isPlayerAvailable(player));
  const lineups = { home: starters(home), away: starters(away) };
  for (const player of [...lineups.home, ...lineups.away]) contributions[player.id] = emptyContribution();

  const score = { home: poisson(rng, homeLambda), away: poisson(rng, awayLambda) };
  for (const side of ['home', 'away'] as const) {
    for (let goal = 0; goal < score[side]; goal++) addGoal(rng, lineups[side], side, rng.int(2, 90), events, contributions);
  }

  let extraTime = false;
  let shootout: PenaltyShootout | undefined;
  if (options.knockout && score.home === score.away) {
    extraTime = true;
    for (const side of ['home', 'away'] as const) {
      const extra = poisson(rng, (side === 'home' ? homeLambda : awayLambda) / 3);
      score[side] += extra;
      for (let goal = 0; goal < extra; goal++) addGoal(rng, lineups[side], side, rng.int(91, 120), events, contributions);
    }
    if (score.home === score.away) shootout = simulateShootout(rng, lineups.home, lineups.away);
  }

  for (const side of ['home', 'away'] as const) {
    const cards = poisson(rng, 1.6);
    for (let card = 0; card < cards && lineups[side].length; card++) {
      const player = rng.pick(lineups[side]);
      const red = rng.bool(0.04);
      contributions[player.id][red ? 'reds' : 'yellows']++;
      events.push({ minute: rng.int(5, 90), type: red ? 'red' : 'yellow', side, playerId: player.id, playerName: playerName(player) });
    }
    if (rng.bool(0.035) && lineups[side].length) {
      const player = rng.pick(lineups[side]);
      const injury = createInjury({ seed: hash32(`${options.fixtureId}|${player.id}`), player, cause: rng.bool(0.6) ? 'contact' : 'non-contact', season: options.season, week: options.week, fixtureId: options.fixtureId, matchMinute: rng.int(5, 88) });
      events.push({ minute: injury.matchMinute ?? 45, type: 'injury', side, playerId: player.id, playerName: playerName(player), injury });
    }
  }
  events.sort((a, b) => a.minute - b.minute);

  const ratings: Record<string, number> = {};
  const endingFitness: Record<string, number> = {};
  for (const side of ['home', 'away'] as const) {
    const goalsFor = score[side], goalsAgainst = score[side === 'home' ? 'away' : 'home'];
    const result = goalsFor > goalsAgainst ? 0.35 : goalsFor === goalsAgainst ? 0 : -0.3;
    for (const player of lineups[side]) {
      const c = contributions[player.id];
      const keeperBonus = player.positionGroup === 'GK' || player.positionGroup === 'DEF' ? (goalsAgainst === 0 ? 0.55 : -goalsAgainst * 0.18) : 0;
      ratings[player.id] = Math.round(clamp(6.2 + (player.overall - 65) / 40 + result + keeperBonus + c.goals * 0.8 + c.assists * 0.4 - c.reds * 1.5 + rng.gaussian(0, 0.45), 3.5, 10) * 10) / 10;
      endingFitness[player.id] = clamp(Math.round(player.fitness - rng.int(16, 26) * (extraTime ? 1.25 : 1)), 0, 100);
    }
  }
  const all = [...lineups.home, ...lineups.away];
  const motm = all.sort((a, b) => (ratings[b.id] ?? 0) - (ratings[a.id] ?? 0))[0] ?? null;

  const stats = (side: 'home' | 'away') => {
    const value = emptyTeamMatchStats();
    const lambda = side === 'home' ? homeLambda : awayLambda;
    value.possession = side === 'home' ? clamp(Math.round(50 + diff * 0.8), 32, 68) : 0;
    value.shots = Math.max(score[side], Math.round(lambda * 5.5 + rng.int(0, 4)));
    value.shotsOnTarget = Math.max(score[side], Math.round(value.shots * rng.float(0.32, 0.5)));
    value.xG = Math.round(lambda * 100) / 100;
    value.corners = rng.int(1, 8);
    value.fouls = rng.int(6, 15);
    value.yellows = events.filter((event) => event.side === side && event.type === 'yellow').length;
    value.reds = events.filter((event) => event.side === side && event.type === 'red').length;
    value.passAccuracy = rng.int(68, 86);
    return value;
  };
  const homeStats = stats('home');
  const awayStats = stats('away');
  awayStats.possession = 100 - homeStats.possession;

  return {
    id: `result-${options.fixtureId}`,
    fixtureId: options.fixtureId,
    week: options.week,
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeTeamName: home.name,
    awayTeamName: away.name,
    homeScore: score.home,
    awayScore: score.away,
    events,
    homeStats,
    awayStats,
    keyframes: [],
    manOfTheMatchId: motm?.id ?? null,
    ratings,
    contributions,
    played: true,
    endingFitness,
    ...(extraTime ? { extraTime: true } : {}),
    ...(shootout ? { shootout } : {}),
  };
}

function poisson(rng: Rng, lambda: number): number {
  const limit = Math.exp(-lambda);
  let product = rng.next();
  let count = 0;
  while (product > limit && count < 9) {
    product *= rng.next();
    count++;
  }
  return count;
}

function weighted(rng: Rng, players: Player[], weight: (player: Player) => number): Player | null {
  const total = players.reduce((sum, player) => sum + weight(player), 0);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const player of players) {
    roll -= weight(player);
    if (roll <= 0) return player;
  }
  return players[players.length - 1];
}

const SCORER_WEIGHT = { GK: 0, DEF: 0.35, MID: 1.2, ATT: 3 } as const;
const ASSIST_WEIGHT = { GK: 0.05, DEF: 0.5, MID: 1.8, ATT: 1.2 } as const;

function addGoal(rng: Rng, lineup: Player[], side: 'home' | 'away', minute: number, events: MatchEvent[], contributions: MatchResult['contributions']): void {
  const scorer = weighted(rng, lineup, (player) => SCORER_WEIGHT[player.positionGroup] * player.attributes.shooting);
  if (!scorer) return;
  contributions[scorer.id].goals++;
  const assist = rng.bool(0.72) ? weighted(rng, lineup.filter((player) => player.id !== scorer.id), (player) => ASSIST_WEIGHT[player.positionGroup] * player.attributes.passing) : null;
  if (assist) contributions[assist.id].assists++;
  events.push({ minute, type: 'goal', side, playerId: scorer.id, playerName: playerName(scorer), ...(assist ? { assistName: playerName(assist) } : {}) });
}

function simulateShootout(rng: Rng, home: Player[], away: Player[]): PenaltyShootout {
  const order = (players: Player[]) => [...players].sort((a, b) => (a.positionGroup === 'GK' ? 1 : 0) - (b.positionGroup === 'GK' ? 1 : 0) || b.attributes.shooting - a.attributes.shooting);
  const takers = { home: order(home), away: order(away) };
  const keeper = (players: Player[]) => players.find((player) => player.positionGroup === 'GK')?.attributes.goalkeeping ?? 60;
  const shootout: PenaltyShootout = { home: [], away: [], takers: { home: [], away: [] }, winner: 'home' };
  const goals = { home: 0, away: 0 };
  for (let round = 0; round < 30; round++) {
    for (const side of ['home', 'away'] as const) {
      const list = takers[side];
      const taker = list[round % Math.max(1, list.length)];
      if (!taker) continue;
      const chance = clamp(0.76 + (taker.attributes.shooting - 70) / 200 - (keeper(side === 'home' ? away : home) - 70) / 250, 0.55, 0.92);
      const scored = rng.bool(chance);
      shootout[side].push(scored);
      shootout.takers[side].push(taker.id);
      if (scored) goals[side]++;
      if (round < 5 && (goals.home + 5 - shootout.home.length < goals.away || goals.away + 5 - shootout.away.length < goals.home)) {
        shootout.winner = goals.home > goals.away ? 'home' : 'away';
        return shootout;
      }
    }
    if (round >= 4 && goals.home !== goals.away) break;
  }
  if (goals.home === goals.away) {
    // A 30-round deadlock is practically impossible; the home side converts the deciding kick.
    shootout.home.push(true);
    goals.home++;
  }
  shootout.winner = goals.home > goals.away ? 'home' : 'away';
  return shootout;
}
