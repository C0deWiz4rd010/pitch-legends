import { Injectable, inject } from '@angular/core';
import { GameState, NewsItem } from '../../models/game.model';
import { Team } from '../../models/team.model';
import { Player } from '../../models/player.model';
import { MatchResult } from '../../models/match.model';
import { GameStateService } from './game-state.service';
import { MatchEngineService } from './match-engine.service';
import { RpgService } from './rpg.service';
import { Rng, clamp, uid } from '../util';
import { playerName } from '../ratings';

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
    return this.engine.simulate(home, away, fixture.week);
  }

  /** Commit the watched player result, simulate the rest of the week, then advance. */
  commitWeek(playerResult: MatchResult): void {
    this.gs.mutate((draft) => {
      const week = draft.league.currentWeek;

      // Mark & apply the player's fixture first.
      const playerFixture = draft.league.fixtures.find(
        (f) =>
          f.week === week &&
          !f.played &&
          f.homeTeamId === playerResult.homeTeamId &&
          f.awayTeamId === playerResult.awayTeamId,
      );
      if (playerFixture) {
        playerFixture.homeScore = playerResult.homeScore;
        playerFixture.awayScore = playerResult.awayScore;
        playerFixture.played = true;
      }
      this.applyResult(draft, playerResult, true);

      // Simulate every other fixture in this matchweek.
      for (const fx of draft.league.fixtures) {
        if (fx.week !== week || fx.played) continue;
        const home = draft.teams.find((t) => t.id === fx.homeTeamId)!;
        const away = draft.teams.find((t) => t.id === fx.awayTeamId)!;
        const r = this.engine.simulate(home, away, week);
        fx.homeScore = r.homeScore;
        fx.awayScore = r.awayScore;
        fx.played = true;
        this.applyResult(draft, r, false);
      }

      this.weeklyUpkeep(draft);
      if (draft.league.currentWeek <= draft.league.totalWeeks) {
        draft.league.currentWeek++;
      }
    });
  }

  private applyResult(draft: GameState, result: MatchResult, isPlayerMatch: boolean): void {
    const home = draft.teams.find((t) => t.id === result.homeTeamId);
    const away = draft.teams.find((t) => t.id === result.awayTeamId);
    if (!home || !away) return;

    this.applyToTeam(home, result, result.homeScore, result.awayScore);
    this.applyToTeam(away, result, result.awayScore, result.homeScore);

    if (isPlayerMatch) {
      // Store the full result for the match report & history (cap history length).
      draft.results.unshift(result);
      draft.results = draft.results.slice(0, 30);
      this.applyPlayerRewards(draft, home, away, result);
    }
  }

  private applyToTeam(team: Team, result: MatchResult, goalsFor: number, goalsAgainst: number): void {
    const won = goalsFor > goalsAgainst;
    const drew = goalsFor === goalsAgainst;
    const cleanSheet = goalsAgainst === 0;

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

      p.fitness = clamp(p.fitness - this.rng.int(18, 28), 0, 100);
      p.morale = clamp(p.morale + (won ? 4 : drew ? 1 : -4), 15, 100);

      const xp =
        42 +
        c.goals * 30 +
        c.assists * 18 +
        Math.round((rating - 6.5) * 22) +
        (won ? 25 : drew ? 10 : 0) +
        (p.id === result.manOfTheMatchId ? 20 : 0);
      this.rpg.awardXp(p, Math.max(10, xp));
    }
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

    const opp = isHome ? away : home;
    draft.news.unshift({
      id: uid('news'),
      week: draft.league.currentWeek,
      icon: won ? '🏆' : drew ? '🤝' : '😞',
      title: `${result.homeTeamName} ${result.homeScore}-${result.awayScore} ${result.awayTeamName}`,
      body: `${won ? 'Victory' : drew ? 'A share of the spoils' : 'Defeat'} against ${opp.name}. Matchday income: ${income.toLocaleString()} coins.`,
    });
    draft.news = draft.news.slice(0, 20);
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
              this.pushNews(draft, '🚑', 'Injury blow', `${playerName(p)} picked up a knock and will be out for ${p.injuryWeeks} week(s).`);
            }
          }
        }
        p.morale = clamp(p.morale + Math.sign(70 - p.morale) * 2, 15, 100);
        if (p.contractWeeks > 0) p.contractWeeks--;
      }
    }
  }

  private pushNews(draft: GameState, icon: string, title: string, body: string): void {
    const item: NewsItem = { id: uid('news'), week: draft.league.currentWeek, icon, title, body };
    draft.news.unshift(item);
    draft.news = draft.news.slice(0, 20);
  }

  /** Advance the season into a new one when all fixtures are played. */
  startNextSeason(): void {
    this.gs.mutate((draft) => {
      draft.league.season++;
      draft.league.currentWeek = 1;
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
      this.pushNews(draft, '🎬', `Season ${draft.league.season} kicks off!`, 'A fresh campaign begins. Time to push for the title.');
    });
  }
}
