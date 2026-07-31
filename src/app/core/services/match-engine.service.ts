import { Injectable } from '@angular/core';
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
import { effectiveRating, groupForPosition, playerName } from '../ratings';
import { getRole } from '../../data/roles';
import { Rng, clamp, uid } from '../util';

interface TeamProfile {
  team: Team;
  starters: Player[];
  attack: number;
  midfield: number;
  defence: number;
  keeper: number;
  aggression: number;
  fatigueRate: number;
}

const MENTALITY_ATT: Record<Tactics['mentality'], number> = {
  'ultra-defensive': -8,
  defensive: -4,
  balanced: 0,
  attacking: 4,
  'ultra-attacking': 8,
};
const MENTALITY_DEF: Record<Tactics['mentality'], number> = {
  'ultra-defensive': 7,
  defensive: 4,
  balanced: 0,
  attacking: -4,
  'ultra-attacking': -8,
};
const PRESS_AGGRO: Record<Tactics['pressing'], number> = {
  low: -2,
  medium: 0,
  high: 3,
  gegenpress: 6,
};
const TEMPO_CHANCE: Record<Tactics['tempo'], number> = { slow: 0.85, balanced: 1, fast: 1.15 };

@Injectable({ providedIn: 'root' })
export class MatchEngineService {
  simulate(home: Team, away: Team, week: number, seed?: number): MatchResult {
    const rng = new Rng(seed ?? (Date.now() >>> 0));
    const H = this.profile(home, true);
    const A = this.profile(away, false);

    const events: MatchEvent[] = [];
    const homeStats = emptyTeamMatchStats();
    const awayStats = emptyTeamMatchStats();
    const keyframes: MatchKeyframe[] = [];
    const ratings: Record<string, number> = {};
    const contributions: Record<string, MatchContribution> = {};
    [...H.starters, ...A.starters].forEach((p) => {
      ratings[p.id] = 6.5;
      contributions[p.id] = emptyContribution();
    });

    let homeScore = 0;
    let awayScore = 0;

    // Possession derived from the midfield battle.
    const homePossession = clamp(
      Math.round((H.midfield / (H.midfield + A.midfield)) * 100),
      30,
      70,
    );
    homeStats.possession = homePossession;
    awayStats.possession = 100 - homePossession;

    events.push({ minute: 0, type: 'kickoff', side: null, playerId: null, text: 'Kick-off!' });

    for (let minute = 1; minute <= 90; minute++) {
      // Each minute, one team may mount an attack proportional to possession.
      const homeTurn = rng.next() < homePossession / 100;
      const [atk, def, atkStats, defStats, atkSide, atkScoreRef] = homeTurn
        ? ([H, A, homeStats, awayStats, 'home', 'home'] as const)
        : ([A, H, awayStats, homeStats, 'away', 'away'] as const);

      // Chance probability from attack vs defence balance & tempo.
      const balance = (atk.attack - def.defence) / 100;
      const chanceP =
        0.11 * TEMPO_CHANCE[atk.team.tactics.tempo] * (1 + balance) * (0.85 + rng.next() * 0.3);

      if (rng.next() < chanceP) {
        atkStats.shots++;
        const shooter = this.pickWeighted(atk.starters, 'shooting', rng);
        const onTarget = rng.next() < 0.42 + (shooter.attributes.shooting - 60) / 200;
        if (onTarget) {
          atkStats.shotsOnTarget++;
          const shot = effectiveRating(shooter, getRole(this.roleOf(atk.team, shooter.id)), shooter.position);
          const keep = def.keeper;
          const goalP = clamp(0.32 + (shot - keep) / 130, 0.05, 0.7);
          if (rng.next() < goalP) {
            // Goal!
            const assist = this.pickAssist(atk.starters, shooter, rng);
            if (atkScoreRef === 'home') homeScore++;
            else awayScore++;
            ratings[shooter.id] = clamp((ratings[shooter.id] ?? 6.5) + 1.3, 1, 10);
            contributions[shooter.id].goals++;
            if (assist) {
              ratings[assist.id] = clamp((ratings[assist.id] ?? 6.5) + 0.8, 1, 10);
              contributions[assist.id].assists++;
            }
            events.push({
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
            if (gk) ratings[gk.id] = clamp((ratings[gk.id] ?? 6.5) + 0.25, 1, 10);
            events.push({
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
            events.push({
              minute,
              type: 'corner',
              side: atkSide,
              playerId: null,
              text: `Corner for ${atk.team.shortName}.`,
            });
          } else {
            events.push({
              minute,
              type: 'shot',
              side: atkSide,
              playerId: shooter.id,
              text: `${playerName(shooter)} fires just wide.`,
            });
          }
        }
      }

      // Fouls & cards, influenced by aggression.
      if (rng.next() < 0.03 + def.aggression / 900) {
        const fouler = rng.pick(def.starters);
        defStats.fouls++;
        if (rng.next() < 0.16) {
          defStats.yellows++;
          ratings[fouler.id] = clamp((ratings[fouler.id] ?? 6.5) - 0.3, 1, 10);
          (contributions[fouler.id] ??= emptyContribution()).yellows++;
          events.push({
            minute,
            type: 'yellow',
            side: homeTurn ? 'away' : 'home',
            playerId: fouler.id,
            text: `🟨 Yellow card for ${playerName(fouler)}.`,
          });
        }
      }

      // Keyframe roughly every 3 minutes for the canvas replay.
      if (minute % 3 === 0) {
        const towardHome = !homeTurn;
        const targetX = towardHome ? 0.12 : 0.88;
        keyframes.push({
          minute,
          ball: {
            x: clamp(0.5 + (targetX - 0.5) * (0.4 + rng.next() * 0.6), 0.08, 0.92),
            y: clamp(0.5 + (rng.next() - 0.5) * 0.7, 0.1, 0.9),
          },
          homeInPossession: homeTurn,
        });
      }

      if (minute === 45) {
        events.push({
          minute,
          type: 'halftime',
          side: null,
          playerId: null,
          text: `Half-time: ${home.shortName} ${homeScore} - ${awayScore} ${away.shortName}`,
        });
      }
    }

    events.push({
      minute: 90,
      type: 'fulltime',
      side: null,
      playerId: null,
      text: `Full-time: ${home.shortName} ${homeScore} - ${awayScore} ${away.shortName}`,
    });

    // Pass accuracy is a cosmetic stat derived from midfield quality.
    homeStats.passAccuracy = clamp(Math.round(70 + (H.midfield - 60) / 2), 55, 94);
    awayStats.passAccuracy = clamp(Math.round(70 + (A.midfield - 60) / 2), 55, 94);

    this.finaliseRatings(H, A, homeScore, awayScore, ratings);
    const motm = this.manOfTheMatch(ratings, [...H.starters, ...A.starters], homeScore >= awayScore ? 'home' : 'away', H);

    return {
      id: uid('match'),
      week,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeTeamName: home.name,
      awayTeamName: away.name,
      homeScore,
      awayScore,
      events,
      homeStats,
      awayStats,
      keyframes,
      manOfTheMatchId: motm,
      ratings,
      contributions,
      played: true,
    };
  }

  // ── Team profile ────────────────────────────────────────────────────────────
  private profile(team: Team, isHome: boolean): TeamProfile {
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

      attack = this.avgRating(team, attackers.length ? attackers : mids) + MENTALITY_ATT[t.mentality] + homeBonus;
      midfield = this.avgRating(team, mids.length ? mids : starters) + homeBonus;
      defence = this.avgRating(team, defs.length ? defs : mids) + MENTALITY_DEF[t.mentality] + homeBonus;
      keeper = gk ? effectiveRating(gk, getRole(this.roleOf(team, gk.id)), 'GK') + homeBonus : 45;
    }

    // Pressing lifts defence & attack transitions but tires the team.
    const press = PRESS_AGGRO[t.pressing];
    defence += press * 0.5;
    if (t.counterAttack) attack += 2;
    if (t.defensiveLine === 'high') {
      attack += 2;
      defence -= t.offsideTrap ? 0 : 2;
    }

    return {
      team,
      starters,
      attack: clamp(attack, 30, 99),
      midfield: clamp(midfield, 30, 99),
      defence: clamp(defence, 30, 99),
      keeper: clamp(keeper, 30, 99),
      aggression: 20 + press * 3,
      fatigueRate: 1 + Math.max(press, 0) * 0.05,
    };
  }

  private avgRating(team: Team, players: Player[]): number {
    if (!players.length) return 45;
    const sum = players.reduce(
      (acc, p) => acc + effectiveRating(p, getRole(this.roleOf(team, p.id)), p.position),
      0,
    );
    return sum / players.length;
  }

  private roleOf(team: Team, playerId: string): string {
    const slot = team.formation.slots.find((s) => s.playerId === playerId);
    return slot?.roleId ?? this.fallbackRole(team, playerId);
  }

  private fallbackRole(team: Team, playerId: string): string {
    const p = team.players.find((pl) => pl.id === playerId);
    const group = p ? p.positionGroup : 'MID';
    return group === 'GK' ? 'gk' : group === 'DEF' ? 'cd' : group === 'MID' ? 'cm' : 'cf';
  }

  private pickWeighted(players: Player[], attr: keyof Player['attributes'], rng: Rng): Player {
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

  private pickAssist(players: Player[], shooter: Player, rng: Rng): Player | null {
    if (rng.next() < 0.25) return null; // solo goal
    const pool = players.filter((p) => p.id !== shooter.id && p.positionGroup !== 'GK');
    if (!pool.length) return null;
    return this.pickWeighted(pool, 'passing', rng);
  }

  private finaliseRatings(
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

  private manOfTheMatch(
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
}
