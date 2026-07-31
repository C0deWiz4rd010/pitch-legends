import { Team } from '../../models/team.model';
import { Player } from '../../models/player.model';
import {
  MatchContribution,
  MatchEvent,
  MatchKeyframe,
  MatchResult,
  Side,
  TeamMatchStats,
  emptyContribution,
  emptyTeamMatchStats,
} from '../../models/match.model';
import { Tactics } from '../../models/tactics.model';
import { AttributeKey } from '../../models/enums';
import { effectiveRating, playerName } from '../ratings';
import { getRole } from '../../data/roles';
import { Rng, clamp, uid } from '../util';

export const MENTALITY_ATT: Record<Tactics['mentality'], number> = {
  'ultra-defensive': -8,
  defensive: -4,
  balanced: 0,
  attacking: 4,
  'ultra-attacking': 8,
};
export const MENTALITY_DEF: Record<Tactics['mentality'], number> = {
  'ultra-defensive': 7,
  defensive: 4,
  balanced: 0,
  attacking: -4,
  'ultra-attacking': -8,
};
export const PRESS_AGGRO: Record<Tactics['pressing'], number> = {
  low: -2,
  medium: 0,
  high: 3,
  gegenpress: 6,
};
export const TEMPO_CHANCE: Record<Tactics['tempo'], number> = { slow: 0.85, balanced: 1, fast: 1.15 };

export interface TeamProfile {
  team: Team;
  isHome: boolean;
  starters: Player[];
  attack: number;
  midfield: number;
  defence: number;
  keeper: number;
  aggression: number;
}

export interface MatchState {
  home: Team;
  away: Team;
  week: number;
  rng: Rng;
  H: TeamProfile;
  A: TeamProfile;
  events: MatchEvent[];
  homeStats: TeamMatchStats;
  awayStats: TeamMatchStats;
  keyframes: MatchKeyframe[];
  ratings: Record<string, number>;
  contributions: Record<string, MatchContribution>;
  homeScore: number;
  awayScore: number;
  homePossession: number;
  /** -1 (away pressure) .. +1 (home pressure). */
  momentum: number;
  minute: number;
}

function roleOf(team: Team, playerId: string): string {
  const slot = team.formation.slots.find((s) => s.playerId === playerId);
  if (slot) return slot.roleId;
  const p = team.players.find((pl) => pl.id === playerId);
  const group = p ? p.positionGroup : 'MID';
  return group === 'GK' ? 'gk' : group === 'DEF' ? 'cd' : group === 'MID' ? 'cm' : 'cf';
}

function avgRating(team: Team, players: Player[]): number {
  if (!players.length) return 45;
  const sum = players.reduce(
    (acc, p) => acc + effectiveRating(p, getRole(roleOf(team, p.id)), p.position),
    0,
  );
  return sum / players.length;
}

export function buildProfile(team: Team, isHome: boolean): TeamProfile {
  const starters = team.formation.slots
    .map((s) => team.players.find((p) => p.id === s.playerId))
    .filter((p): p is Player => !!p && p.injuryWeeks === 0);

  const homeBonus = isHome ? 3 : 0;
  const t = team.tactics;

  let attack = 40;
  let midfield = 40;
  let defence = 40;
  let keeper = 40;

  if (starters.length) {
    const attackers = starters.filter((p) => p.positionGroup === 'ATT');
    const mids = starters.filter((p) => p.positionGroup === 'MID');
    const defs = starters.filter((p) => p.positionGroup === 'DEF');
    const gk = starters.find((p) => p.positionGroup === 'GK');

    attack = avgRating(team, attackers.length ? attackers : mids) + MENTALITY_ATT[t.mentality] + homeBonus;
    midfield = avgRating(team, mids.length ? mids : starters) + homeBonus;
    defence = avgRating(team, defs.length ? defs : mids) + MENTALITY_DEF[t.mentality] + homeBonus;
    keeper = gk ? effectiveRating(gk, getRole(roleOf(team, gk.id)), 'GK') + homeBonus : 45;
  }

  const press = PRESS_AGGRO[t.pressing];
  defence += press * 0.5;
  if (t.counterAttack) attack += 2;
  if (t.defensiveLine === 'high') {
    attack += 2;
    defence -= t.offsideTrap ? 0 : 2;
  }

  return {
    team,
    isHome,
    starters,
    attack: clamp(attack, 30, 99),
    midfield: clamp(midfield, 30, 99),
    defence: clamp(defence, 30, 99),
    keeper: clamp(keeper, 30, 99),
    aggression: 20 + press * 3,
  };
}

export function initMatchState(home: Team, away: Team, week: number, rng: Rng): MatchState {
  const H = buildProfile(home, true);
  const A = buildProfile(away, false);
  const homeStats = emptyTeamMatchStats();
  const awayStats = emptyTeamMatchStats();
  const ratings: Record<string, number> = {};
  const contributions: Record<string, MatchContribution> = {};
  [...H.starters, ...A.starters].forEach((p) => {
    ratings[p.id] = 6.5;
    contributions[p.id] = emptyContribution();
  });
  const homePossession = clamp(Math.round((H.midfield / (H.midfield + A.midfield)) * 100), 30, 70);
  homeStats.possession = homePossession;
  awayStats.possession = 100 - homePossession;

  const state: MatchState = {
    home,
    away,
    week,
    rng,
    H,
    A,
    events: [{ minute: 0, type: 'kickoff', side: null, playerId: null, text: 'Kick-off!' }],
    homeStats,
    awayStats,
    keyframes: [],
    ratings,
    contributions,
    homeScore: 0,
    awayScore: 0,
    homePossession,
    momentum: 0,
    minute: 0,
  };
  return state;
}

/** Recompute both profiles (after a live tactic change or substitution). */
export function refreshProfiles(state: MatchState): void {
  state.H = buildProfile(state.home, true);
  state.A = buildProfile(state.away, false);
  state.homePossession = clamp(
    Math.round((state.H.midfield / (state.H.midfield + state.A.midfield)) * 100),
    30,
    70,
  );
  state.homeStats.possession = state.homePossession;
  state.awayStats.possession = 100 - state.homePossession;
}

function pickWeighted(players: Player[], attr: AttributeKey, rng: Rng): Player {
  const pool = players.filter((p) => p.positionGroup !== 'GK');
  const candidates = pool.length ? pool : players;
  const weights = candidates.map((p) => {
    const posBias = p.positionGroup === 'ATT' ? 3 : p.positionGroup === 'MID' ? 1.6 : 0.5;
    return Math.max(p.attributes[attr] * posBias, 1);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function pickAssist(players: Player[], shooter: Player, rng: Rng): Player | null {
  if (rng.next() < 0.25) return null;
  const pool = players.filter((p) => p.id !== shooter.id && p.positionGroup !== 'GK');
  if (!pool.length) return null;
  return pickWeighted(pool, 'passing', rng);
}

/** Advance the match one minute, mutating state. Reads live tactics from teams. */
export function simulateMinute(state: MatchState, minute: number): void {
  const { rng } = state;
  const homeTurn = rng.next() < state.homePossession / 100;
  const [atk, def, atkStats, defStats, atkSide, atkScoreRef] = homeTurn
    ? ([state.H, state.A, state.homeStats, state.awayStats, 'home', 'home'] as const)
    : ([state.A, state.H, state.awayStats, state.homeStats, 'away', 'away'] as const);

  let didShoot = false;
  let didScore = false;

  const balance = (atk.attack - def.defence) / 100;
  const chanceP = 0.11 * TEMPO_CHANCE[atk.team.tactics.tempo] * (1 + balance) * (0.85 + rng.next() * 0.3);

  if (rng.next() < chanceP) {
    didShoot = true;
    atkStats.shots++;
    const shooter = pickWeighted(atk.starters, 'shooting', rng);
    const onTarget = rng.next() < 0.42 + (shooter.attributes.shooting - 60) / 200;
    if (onTarget) {
      atkStats.shotsOnTarget++;
      const shot = effectiveRating(shooter, getRole(roleOf(atk.team, shooter.id)), shooter.position);
      const keep = def.keeper;
      const goalP = clamp(0.32 + (shot - keep) / 130, 0.05, 0.7);
      if (rng.next() < goalP) {
        didScore = true;
        const assist = pickAssist(atk.starters, shooter, rng);
        if (atkScoreRef === 'home') state.homeScore++;
        else state.awayScore++;
        state.ratings[shooter.id] = clamp((state.ratings[shooter.id] ?? 6.5) + 1.3, 1, 10);
        (state.contributions[shooter.id] ??= emptyContribution()).goals++;
        if (assist) {
          state.ratings[assist.id] = clamp((state.ratings[assist.id] ?? 6.5) + 0.8, 1, 10);
          (state.contributions[assist.id] ??= emptyContribution()).assists++;
        }
        state.events.push({
          minute,
          type: 'goal',
          side: atkSide,
          playerId: shooter.id,
          playerName: playerName(shooter),
          assistName: assist ? playerName(assist) : undefined,
          text: assist
            ? `⚽ GOAL! ${playerName(shooter)} finishes off a pass from ${playerName(assist)}!`
            : `⚽ GOAL! ${playerName(shooter)} strikes!`,
        });
      } else {
        const gk = def.starters.find((p) => p.positionGroup === 'GK');
        if (gk) state.ratings[gk.id] = clamp((state.ratings[gk.id] ?? 6.5) + 0.25, 1, 10);
        state.events.push({
          minute,
          type: 'save',
          side: atkSide,
          playerId: gk?.id ?? null,
          text: `🧤 Great save! ${gk ? playerName(gk) : 'The keeper'} denies ${playerName(shooter)}.`,
        });
      }
    } else {
      if (rng.next() < 0.4) {
        atkStats.corners++;
        state.events.push({ minute, type: 'corner', side: atkSide, playerId: null, text: `Corner for ${atk.team.shortName}.` });
      } else {
        state.events.push({ minute, type: 'shot', side: atkSide, playerId: shooter.id, text: `${playerName(shooter)} fires just wide.` });
      }
    }
  }

  if (rng.next() < 0.03 + def.aggression / 900) {
    const fouler = rng.pick(def.starters);
    defStats.fouls++;
    if (rng.next() < 0.16) {
      defStats.yellows++;
      state.ratings[fouler.id] = clamp((state.ratings[fouler.id] ?? 6.5) - 0.3, 1, 10);
      (state.contributions[fouler.id] ??= emptyContribution()).yellows++;
      state.events.push({
        minute,
        type: 'yellow',
        side: homeTurn ? 'away' : 'home',
        playerId: fouler.id,
        text: `🟨 Yellow card for ${playerName(fouler)}.`,
      });
    }
  }

  if (minute % 3 === 0) {
    const towardHome = !homeTurn;
    const targetX = towardHome ? 0.12 : 0.88;
    state.keyframes.push({
      minute,
      ball: {
        x: clamp(0.5 + (targetX - 0.5) * (0.4 + rng.next() * 0.6), 0.08, 0.92),
        y: clamp(0.5 + (rng.next() - 0.5) * 0.7, 0.1, 0.9),
      },
      homeInPossession: homeTurn,
    });
  }

  if (minute === 45) {
    state.events.push({
      minute,
      type: 'halftime',
      side: null,
      playerId: null,
      text: `Half-time: ${state.home.shortName} ${state.homeScore} - ${state.awayScore} ${state.away.shortName}`,
    });
  }

  // Momentum (no RNG — keeps simulation deterministic).
  const dir = homeTurn ? 1 : -1;
  let delta = dir * 0.05;
  if (didShoot) delta += dir * 0.12;
  if (didScore) delta += dir * 0.5;
  state.momentum = clamp(state.momentum * 0.9 + delta, -1, 1);
  state.minute = minute;
}

export function finalizeMatch(state: MatchState): MatchResult {
  const { home, away, H, A } = state;
  state.events.push({
    minute: 90,
    type: 'fulltime',
    side: null,
    playerId: null,
    text: `Full-time: ${home.shortName} ${state.homeScore} - ${state.awayScore} ${away.shortName}`,
  });

  state.homeStats.passAccuracy = clamp(Math.round(70 + (H.midfield - 60) / 2), 55, 94);
  state.awayStats.passAccuracy = clamp(Math.round(70 + (A.midfield - 60) / 2), 55, 94);

  finaliseRatings(H, A, state.homeScore, state.awayScore, state.ratings);
  const allStarters = [...H.starters, ...A.starters];
  const motm = manOfTheMatch(state.ratings, allStarters, state.homeScore >= state.awayScore ? 'home' : 'away', H);

  return {
    id: uid('match'),
    week: state.week,
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeTeamName: home.name,
    awayTeamName: away.name,
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    events: state.events,
    homeStats: state.homeStats,
    awayStats: state.awayStats,
    keyframes: state.keyframes,
    manOfTheMatchId: motm,
    ratings: state.ratings,
    contributions: state.contributions,
    played: true,
  };
}

function finaliseRatings(
  H: TeamProfile,
  A: TeamProfile,
  homeScore: number,
  awayScore: number,
  ratings: Record<string, number>,
): void {
  const apply = (prof: TeamProfile, goalsFor: number, goalsAgainst: number) => {
    const cleanSheet = goalsAgainst === 0;
    for (const p of prof.starters) {
      let r = ratings[p.id] ?? 6.5;
      if (cleanSheet && (p.positionGroup === 'DEF' || p.positionGroup === 'GK')) r += 0.6;
      if (goalsAgainst >= 3 && (p.positionGroup === 'DEF' || p.positionGroup === 'GK')) r -= 0.5;
      if (goalsFor > goalsAgainst) r += 0.3;
      ratings[p.id] = clamp(r, 1, 10);
    }
  };
  apply(H, homeScore, awayScore);
  apply(A, awayScore, homeScore);
}

function manOfTheMatch(
  ratings: Record<string, number>,
  players: Player[],
  winningSide: Side,
  home: TeamProfile,
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const p of players) {
    const onWinner = winningSide === 'home' ? home.starters.includes(p) : !home.starters.includes(p);
    const score = (ratings[p.id] ?? 0) + (onWinner ? 0.2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

/**
 * An interactive, minute-by-minute match the manager can influence live:
 * change mentality/pressing and make substitutions that affect the rest of
 * the game. Operates on private clones so global state is untouched until commit.
 */
export class LiveMatch {
  readonly home: Team;
  readonly away: Team;
  private state: MatchState;
  private subsUsed = 0;
  private subbedOut = new Set<string>();
  readonly maxSubs = 5;

  constructor(home: Team, away: Team, week: number, seed?: number) {
    this.home = structuredClone(home);
    this.away = structuredClone(away);
    this.state = initMatchState(this.home, this.away, week, new Rng(seed ?? (Date.now() >>> 0)));
  }

  get minute(): number {
    return this.state.minute;
  }
  get homeScore(): number {
    return this.state.homeScore;
  }
  get awayScore(): number {
    return this.state.awayScore;
  }
  get momentum(): number {
    return this.state.momentum;
  }
  get events(): MatchEvent[] {
    return this.state.events;
  }
  get keyframes(): MatchKeyframe[] {
    return this.state.keyframes;
  }
  get subsRemaining(): number {
    return this.maxSubs - this.subsUsed;
  }

  /** Players available to bring on (fit, not already used or on the pitch). */
  bench(): Player[] {
    const onPitch = new Set(this.home.formation.slots.map((s) => s.playerId));
    return this.home.players.filter(
      (p) => !onPitch.has(p.id) && !this.subbedOut.has(p.id) && p.injuryWeeks === 0,
    );
  }

  /** Advance simulation up to (and including) the given whole minute. */
  stepTo(targetMinute: number): void {
    const target = Math.min(90, Math.floor(targetMinute));
    while (this.state.minute < target) {
      simulateMinute(this.state, this.state.minute + 1);
    }
  }

  setMentality(mentality: Tactics['mentality']): void {
    this.home.tactics.mentality = mentality;
    refreshProfiles(this.state);
    this.pushLive(`📋 Mentality switched to ${mentality.replace('-', ' ')}.`);
  }

  setPressing(pressing: Tactics['pressing']): void {
    this.home.tactics.pressing = pressing;
    refreshProfiles(this.state);
    this.pushLive(`📋 Pressing set to ${pressing}.`);
  }

  makeSub(outId: string, inId: string): boolean {
    if (this.subsUsed >= this.maxSubs) return false;
    const slot = this.home.formation.slots.find((s) => s.playerId === outId);
    const incoming = this.home.players.find((p) => p.id === inId);
    if (!slot || !incoming) return false;
    slot.playerId = inId;
    this.subbedOut.add(outId);
    this.subsUsed++;
    this.state.ratings[inId] ??= 6.5;
    this.state.contributions[inId] ??= emptyContribution();
    refreshProfiles(this.state);
    const out = this.home.players.find((p) => p.id === outId);
    this.pushLive(`🔄 Substitution: ${playerName(incoming)} on${out ? `, ${playerName(out)} off` : ''}.`);
    return true;
  }

  finalize(): MatchResult {
    if (this.state.minute < 90) this.stepTo(90);
    return finalizeMatch(this.state);
  }

  private pushLive(text: string): void {
    this.state.events.push({ minute: this.state.minute, type: 'commentary', side: 'home', playerId: null, text });
  }
}
