import { Injectable, inject } from '@angular/core';
import { GameState, NewsItem } from '../../models/game.model';
import { Team } from '../../models/team.model';
import { Player } from '../../models/player.model';
import { MatchResult } from '../../models/match.model';
import { GameStateService } from './game-state.service';
import { MatchEngineService } from './match-engine.service';
import { RpgService } from './rpg.service';
import { Rng, clamp, uid } from '../util';
import { playerName, weeklySalaryFor } from '../ratings';
import { autoFillLineup, generatePlayer } from '../../data/generators';
import { Position } from '../../models/enums';
import { processTransferWeek, returnSeasonLoans, weeklyWageBill } from '../transfer-engine';

@Injectable({ providedIn: 'root' })
export class SeasonService {
  private readonly gs = inject(GameStateService);
  private readonly engine = inject(MatchEngineService);
  private readonly rpg = inject(RpgService);
  private readonly rng = new Rng();

  /** Simulate the player's upcoming fixture and return the result (not yet committed). */
  simulatePlayerMatch(): MatchResult | null {
    const g = this.gs.game();
    const team = this.gs.playerTeam();
    const fixture = this.gs.nextFixture();
    if (!g || !team || !fixture) return null;
    const home = g.teams.find((t) => t.id === fixture.homeTeamId)!;
    const away = g.teams.find((t) => t.id === fixture.awayTeamId)!;
    return this.engine.simulate(home, away, fixture.week, undefined, fixture.id);
  }

  /** Commit the watched player result, simulate the rest of the week, then advance. */
  async commitWeek(playerResult: MatchResult): Promise<boolean> {
    const current = this.gs.game();
    if (!current) return false;
    const pendingFixture = current.league.fixtures.find(
      (fixture) =>
        fixture.week === current.league.currentWeek &&
        fixture.homeTeamId === playerResult.homeTeamId &&
        fixture.awayTeamId === playerResult.awayTeamId,
    );
    if (
      !pendingFixture ||
      pendingFixture.played ||
      current.results.some((result) => result.id === playerResult.id || (!!playerResult.fixtureId && result.fixtureId === playerResult.fixtureId))
    ) return false;
    playerResult.fixtureId ??= pendingFixture.id;
    const week = current.league.currentWeek;
    const otherFixtures = current.league.fixtures.filter((fixture) => fixture.week === week && !fixture.played && fixture.id !== pendingFixture.id);
    const otherResults = await Promise.all(otherFixtures.map((fixture) => {
      const home = current.teams.find((team) => team.id === fixture.homeTeamId)!;
      const away = current.teams.find((team) => team.id === fixture.awayTeamId)!;
      return this.engine.simulateAsync(home, away, week, undefined, fixture.id);
    }));
    let committed = false;
    this.gs.mutate((draft) => {
      // Mark & apply the player's fixture first.
      const playerFixture = draft.league.fixtures.find(
        (f) =>
          f.week === week &&
          !f.played &&
          f.homeTeamId === playerResult.homeTeamId &&
          f.awayTeamId === playerResult.awayTeamId,
      );
      if (!playerFixture) return;
      playerFixture.homeScore = playerResult.homeScore;
      playerFixture.awayScore = playerResult.awayScore;
      playerFixture.played = true;
      this.applyResult(draft, playerResult, true);

      for (const result of otherResults) {
        const fixture = draft.league.fixtures.find((candidate) => candidate.id === result.fixtureId && !candidate.played);
        if (!fixture) continue;
        fixture.homeScore = result.homeScore;
        fixture.awayScore = result.awayScore;
        fixture.played = true;
        this.applyResult(draft, result, false);
      }

      this.weeklyUpkeep(draft);
      if (draft.league.currentWeek <= draft.league.totalWeeks) {
        draft.league.currentWeek++;
      }
      draft.trainingWeek = {
        season: draft.league.season,
        week: draft.league.currentWeek,
        slotsUsed: 0,
        maxSlots: 3,
      };
      processTransferWeek(draft);
      committed = true;
    });
    return committed;
  }

  private applyResult(draft: GameState, result: MatchResult, isPlayerMatch: boolean): void {
    const home = draft.teams.find((t) => t.id === result.homeTeamId);
    const away = draft.teams.find((t) => t.id === result.awayTeamId);
    if (!home || !away) return;

    const homeGrowth = this.applyToTeam(home, result, result.homeScore, result.awayScore);
    const awayGrowth = this.applyToTeam(away, result, result.awayScore, result.homeScore);

    if (isPlayerMatch) {
      // Store the full result for the match report & history (cap history length).
      draft.results.unshift(result);
      draft.results = draft.results.slice(0, 30);
      this.applyPlayerRewards(draft, home, away, result);
      this.updateObjectives(draft, result, home.id === draft.clubId ? homeGrowth : awayGrowth);
    }
  }

  private applyToTeam(team: Team, result: MatchResult, goalsFor: number, goalsAgainst: number): number {
    const won = goalsFor > goalsAgainst;
    const drew = goalsFor === goalsAgainst;
    const cleanSheet = goalsAgainst === 0;

    let levelsGained = 0;
    for (const p of team.players) {
      const rating = result.ratings[p.id];
      if (rating === undefined) continue; // did not start
      const c = result.contributions[p.id] ?? { goals: 0, assists: 0, yellows: 0, reds: 0 };

      p.seasonStats.appearances++;
      p.seasonStats.ratingSum += rating;
      p.seasonStats.goals += c.goals;
      p.seasonStats.assists += c.assists;
      p.seasonStats.yellowCards += c.yellows;
      p.seasonStats.redCards += c.reds;
      if (cleanSheet && (p.positionGroup === 'DEF' || p.positionGroup === 'GK')) {
        p.seasonStats.cleanSheets++;
      }
      if (p.id === result.manOfTheMatchId) p.seasonStats.motmAwards++;
      if (result.events.some((event) => event.type === 'injury' && event.playerId === p.id)) {
        p.injuryWeeks = Math.max(p.injuryWeeks, this.rng.int(1, 4));
      }

      p.fitness = result.endingFitness?.[p.id] ?? clamp(p.fitness - this.rng.int(18, 28), 0, 100);
      p.morale = clamp(p.morale + (won ? 4 : drew ? 1 : -4), 15, 100);

      const xp =
        42 +
        c.goals * 30 +
        c.assists * 18 +
        Math.round((rating - 6.5) * 22) +
        (won ? 25 : drew ? 10 : 0) +
        (p.id === result.manOfTheMatchId ? 20 : 0);
      levelsGained += this.rpg.awardXp(p, Math.max(10, xp)).levelsGained;
      const goal = p.personalGoal;
      goal.progress =
        goal.type === 'goals' ? p.seasonStats.goals :
        goal.type === 'assists' ? p.seasonStats.assists :
        goal.type === 'clean-sheets' ? p.seasonStats.cleanSheets :
        goal.type === 'appearances' ? p.seasonStats.appearances :
        Math.round(p.seasonStats.ratingSum / Math.max(1, p.seasonStats.appearances) * 10);
      if (!goal.completed && goal.progress >= goal.target) {
        goal.completed = true;
        this.rpg.awardXp(p, goal.rewardXp);
        p.morale = clamp(p.morale + 10, 0, 100);
      }
    }
    return levelsGained;
  }

  private applyPlayerRewards(draft: GameState, home: Team, away: Team, result: MatchResult): void {
    const club = draft.teams.find((t) => t.id === draft.clubId);
    if (!club) return;
    const isHome = club.id === home.id;
    const goalsFor = isHome ? result.homeScore : result.awayScore;
    const goalsAgainst = isHome ? result.awayScore : result.homeScore;
    const won = goalsFor > goalsAgainst;
    const drew = goalsFor === goalsAgainst;

    const gate = isHome ? 40000 + club.facilities.stadium * 22000 : 0;
    const prize = won ? 60000 : drew ? 25000 : 8000;
    const income = Math.round(gate + prize);
    club.coins += income;
    club.reputation = clamp(club.reputation + (won ? 1 : drew ? 0 : -0.5), 20, 100);
    const leadership = draft.manager.perks.leadership ?? 0;
    this.rpg.awardManagerXp(draft.manager, Math.round((won ? 90 : drew ? 55 : 35) * (1 + leadership * 0.06)));
    for (const player of club.players) {
      player.morale = clamp(player.morale + leadership * (won ? 1 : 0.4), 0, 100);
    }

    const opp = isHome ? away : home;
    draft.news.unshift({
      id: uid('news'),
      week: draft.league.currentWeek,
      icon: won ? 'trophy' : drew ? 'handshake' : 'whistle',
      titleKey: 'news.match.title',
      bodyKey: won ? 'news.match.win' : drew ? 'news.match.draw' : 'news.match.loss',
      params: {
        home: result.homeTeamName,
        away: result.awayTeamName,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        opponent: opp.name,
        income,
      },
    });
    draft.news = draft.news.slice(0, 20);
  }

  private updateObjectives(draft: GameState, result: MatchResult, playerLevels: number): void {
    const clubIsHome = result.homeTeamId === draft.clubId;
    const won = clubIsHome ? result.homeScore > result.awayScore : result.awayScore > result.homeScore;
    for (const objective of draft.objectives) {
      if (objective.completed) continue;
      if (objective.type === 'wins' && won) objective.progress++;
      if (objective.type === 'player-growth') objective.progress += playerLevels;
      if (objective.type === 'league-position' || objective.progress < objective.target) continue;
      objective.completed = true;
      const club = draft.teams.find((team) => team.id === draft.clubId)!;
      club.coins += objective.rewardCoins;
      this.rpg.awardManagerXp(draft.manager, objective.rewardXp);
      this.pushNews(draft, 'target', 'news.objective.title', 'news.objective.body', {
        coins: objective.rewardCoins,
        xp: objective.rewardXp,
      });
    }
  }

  private weeklyUpkeep(draft: GameState): void {
    for (const team of draft.teams) {
      const recovery = 12 + team.facilities.medicalCenter * 4;
      for (const p of team.players) {
        if (p.injuryWeeks > 0) {
          p.injuryWeeks = Math.max(0, p.injuryWeeks - 1);
        } else {
          p.fitness = clamp(p.fitness + recovery, 0, 100);
          // Small chance of a knock, reduced by a better medical centre.
          const injuryChance = 0.02 - team.facilities.medicalCenter * 0.002;
          if (this.rng.bool(Math.max(0.006, injuryChance)) && p.fitness < 70) {
            p.injuryWeeks = this.rng.int(1, 4);
            if (team.id === draft.clubId) {
              this.pushNews(draft, 'medical', 'news.injury.title', 'news.injury.body', {
                player: playerName(p),
                weeks: p.injuryWeeks,
              });
            }
          }
        }
        p.morale = clamp(p.morale + Math.sign(70 - p.morale) * 2, 15, 100);
        if (p.contractWeeks > 0) {
          p.contractWeeks--;
          if (p.contractWeeks === 0 && team.id === draft.clubId) {
            this.pushNews(draft, 'contract', 'news.contract.title', 'news.contract.body', { player: playerName(p) });
            p.morale = clamp(p.morale - 12, 0, 100);
          }
        }
      }
      const wages = weeklyWageBill(draft, team.id);
      team.coins = Math.max(0, team.coins - wages);
    }
  }

  private pushNews(
    draft: GameState,
    icon: string,
    titleKey: string,
    bodyKey: string,
    params?: Record<string, string | number>,
  ): void {
    const item: NewsItem = { id: uid('news'), week: draft.league.currentWeek, icon, titleKey, bodyKey, params };
    draft.news.unshift(item);
    draft.news = draft.news.slice(0, 20);
  }

  /** Advance the season into a new one when all fixtures are played. */
  startNextSeason(): void {
    this.gs.mutate((draft) => {
      this.resolveLeagueObjective(draft);
      draft.league.season++;
      draft.league.currentWeek = 1;
      draft.trainingWeek = { season: draft.league.season, week: 1, slotsUsed: 0, maxSlots: 3 };
      returnSeasonLoans(draft);
      draft.transfers.season = draft.league.season;
      draft.transfers.week = 1;
      draft.league.fixtures.forEach((f) => {
        f.played = false;
        f.homeScore = null;
        f.awayScore = null;
      });
      // Reset season stats and age players by a year.
      for (const team of draft.teams) {
        for (const p of team.players) {
          p.seasonStats = {
            appearances: 0,
            goals: 0,
            assists: 0,
            cleanSheets: 0,
            yellowCards: 0,
            redCards: 0,
            ratingSum: 0,
            motmAwards: 0,
          };
          p.age = Math.min(40, p.age + 1);
          p.fitness = 100;
        }
      }
      this.promoteYouth(draft);
      processTransferWeek(draft);
      this.pushNews(draft, 'flag', 'news.season.title', 'news.season.body', {
        season: draft.league.season,
      });
    });
  }

  private resolveLeagueObjective(draft: GameState): void {
    const objective = draft.objectives.find((candidate) => candidate.type === 'league-position' && !candidate.completed);
    if (!objective) return;
    const points = new Map(draft.teams.map((team) => [team.id, { points: 0, diff: 0 }]));
    for (const fixture of draft.league.fixtures) {
      if (!fixture.played || fixture.homeScore == null || fixture.awayScore == null) continue;
      const home = points.get(fixture.homeTeamId)!;
      const away = points.get(fixture.awayTeamId)!;
      home.diff += fixture.homeScore - fixture.awayScore;
      away.diff += fixture.awayScore - fixture.homeScore;
      if (fixture.homeScore > fixture.awayScore) home.points += 3;
      else if (fixture.awayScore > fixture.homeScore) away.points += 3;
      else {
        home.points++;
        away.points++;
      }
    }
    const position = [...points.entries()]
      .sort((a, b) => b[1].points - a[1].points || b[1].diff - a[1].diff)
      .findIndex(([id]) => id === draft.clubId) + 1;
    objective.progress = position;
    if (position > 0 && position <= objective.target) {
      objective.completed = true;
      const club = draft.teams.find((team) => team.id === draft.clubId)!;
      club.coins += objective.rewardCoins;
      this.rpg.awardManagerXp(draft.manager, objective.rewardXp);
    }
  }

  private promoteYouth(draft: GameState): void {
    const club = draft.teams.find((team) => team.id === draft.clubId);
    if (!club || club.players.length >= 26) return;
    const academy = club.facilities.youthAcademy;
    const positions: Position[] = ['GK', 'CB', 'RB', 'LB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST'];
    const count = Math.min(26 - club.players.length, 1 + Math.floor(academy / 2));
    const promoted: Player[] = [];
    for (let index = 0; index < count; index++) {
      const overall = clamp(Math.round(47 + academy * 3 + club.reputation * 0.08 + this.rng.gaussian(0, 4)), 46, 76);
      const used = new Set(club.players.map((player) => player.kitNumber));
      let kit = this.rng.int(24, 60);
      while (used.has(kit)) kit = kit === 99 ? 24 : kit + 1;
      const prospect = generatePlayer(this.rng, this.rng.pick(positions), [], overall, kit);
      prospect.age = this.rng.int(16, 18);
      prospect.potential = clamp(Math.max(prospect.potential, prospect.overall + 7 + academy * 2), prospect.overall, 99);
      prospect.salary = weeklySalaryFor(prospect);
      prospect.contractWeeks = 156;
      club.players.push(prospect);
      promoted.push(prospect);
    }
    autoFillLineup(club);
    if (promoted.length) {
      const best = [...promoted].sort((a, b) => b.potential - a.potential)[0];
      this.pushNews(draft, 'academy', 'news.academy.title', 'news.academy.body', {
        count: promoted.length,
        player: playerName(best),
        potential: best.potential,
      });
    }
  }
}
