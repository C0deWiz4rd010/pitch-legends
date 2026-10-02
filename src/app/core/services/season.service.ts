import { Injectable, inject } from '@angular/core';
import { GameState, NewsItem } from '../../models/game.model';
import { Team } from '../../models/team.model';
import { MatchResult } from '../../models/match.model';
import { CupTie } from '../../models/career.model';
import { GameStateService } from './game-state.service';
import { MatchEngineService } from './match-engine.service';
import { RpgService } from './rpg.service';
import { Rng, clamp, uid } from '../util';
import { playerName } from '../ratings';
import { autoFillLineup } from '../../data/generators';
import { countryRoot } from '../../data/world-generator';
import { processTransferWeek, returnSeasonLoans, weeklyWageBill } from '../transfer-engine';
import { prepareTravelEvent } from '../travel-engine';
import { advanceInjury, applyInjury, createInjury, isPlayerAvailable } from '../injury-engine';
import { hash32 } from '../visual-identity';
import { CUP_ROUND_LABELS, CUP_WINNER_PRIZE, advanceCup, createCup, cupRoundForWeek, isCupFixtureId, openCupTie, recordCupResult } from '../career/cup';
import { allLeagues, applyPromotionRelegation, scheduleSeason, selectPlayerLeague, standingsFor } from '../career/divisions';
import { aiInvest, book, ensureFinance, gateIncome, matchPrize, tierOfTeam, weeklySponsor, weeklyTv, weeklyUpkeep } from '../career/finance';
import { academyIntake, rollOverSquads } from '../career/lifecycle';
import { applyBoardDelta, boardMatchDelta, cupRoundNumber, generateSeasonObjectives } from '../career/objectives';
import { quickSimulate, teamStrength } from '../career/quick-sim';
import { processScoutAssignments } from '../career/scouting';
import { archiveEntry, buildSeasonReview } from '../career/season-review';

const NEWS_LIMIT = 150;

@Injectable({ providedIn: 'root' })
export class SeasonService {
  private readonly gs = inject(GameStateService);
  private readonly engine = inject(MatchEngineService);
  private readonly rpg = inject(RpgService);

  /** Simulate the player's upcoming fixture and return the result (not yet committed). */
  simulatePlayerMatch(): MatchResult | null {
    const g = this.gs.game();
    const team = this.gs.playerTeam();
    const fixture = this.gs.nextFixture();
    if (!g || !team || !fixture) return null;
    const home = g.teams.find((t) => t.id === fixture.homeTeamId)!;
    const away = g.teams.find((t) => t.id === fixture.awayTeamId)!;
    return this.engine.simulate(home, away, fixture.week, undefined, fixture.id, fixture.competition === 'cup');
  }

  /** Commit the watched player result, simulate the rest of the week, then advance. Cup ties do not advance the week. */
  async commitWeek(playerResult: MatchResult): Promise<boolean> {
    if (isCupFixtureId(playerResult.fixtureId)) return this.commitCupTie(playerResult);
    const current = this.gs.game();
    if (!current || !this.validResult(current, playerResult)) return false;
    const pendingFixture = current.league.fixtures.find(
      (fixture) =>
        fixture.week === current.league.currentWeek &&
        fixture.homeTeamId === playerResult.homeTeamId &&
        fixture.awayTeamId === playerResult.awayTeamId,
    );
    if (
      !pendingFixture ||
      pendingFixture.played ||
      (playerResult.fixtureId && playerResult.fixtureId !== pendingFixture.id) ||
      current.results.some((result) => result.id === playerResult.id || (!!playerResult.fixtureId && result.fixtureId === playerResult.fixtureId)) ||
      // The cup tie of this week comes first.
      !!openCupTie(current.cup, current.clubId, current.league.currentWeek)
    ) return false;
    // The caller may still display this result while worker simulations finish.
    const committedResult = { ...playerResult, fixtureId: pendingFixture.id, week: pendingFixture.week };
    const week = current.league.currentWeek;
    const otherFixtures = current.league.fixtures.filter((fixture) => fixture.week === week && !fixture.played && fixture.id !== pendingFixture.id);
    const otherResults = await Promise.all(otherFixtures.map((fixture) => {
      const home = current.teams.find((team) => team.id === fixture.homeTeamId)!;
      const away = current.teams.find((team) => team.id === fixture.awayTeamId)!;
      return this.engine.simulateAsync(home, away, week, undefined, fixture.id);
    }));
    // A concurrent click, imported career or new season must not consume this result.
    if (!this.unchanged(current, week) || this.gs.game()!.league.fixtures.find((fixture) => fixture.id === pendingFixture.id)?.played !== false) return false;
    let committed = false;
    this.gs.mutate((draft) => {
      const playerFixture = draft.league.fixtures.find(
        (f) => f.id === pendingFixture.id && !f.played && f.homeTeamId === playerResult.homeTeamId && f.awayTeamId === playerResult.awayTeamId,
      );
      if (!playerFixture) return;
      playerFixture.homeScore = committedResult.homeScore;
      playerFixture.awayScore = committedResult.awayScore;
      playerFixture.played = true;
      this.applyResult(draft, committedResult, true, 'league');

      for (const result of otherResults) {
        const fixture = draft.league.fixtures.find((candidate) => candidate.id === result.fixtureId && !candidate.played);
        if (!fixture) continue;
        fixture.homeScore = result.homeScore;
        fixture.awayScore = result.awayScore;
        fixture.played = true;
        this.applyResult(draft, result, false, 'league');
      }
      this.playOtherDivisions(draft, week);
      this.playCupRound(draft, week);

      this.weeklyUpkeep(draft);
      if (draft.league.currentWeek <= draft.league.totalWeeks) draft.league.currentWeek++;
      for (const league of draft.otherLeagues) league.currentWeek = draft.league.currentWeek;
      draft.trainingWeek = { season: draft.league.season, week: draft.league.currentWeek, slotsUsed: 0, maxSlots: 3, completedSessions: [] };
      processTransferWeek(draft);
      this.weeklyStories(draft);
      for (const assignment of processScoutAssignments(draft)) {
        const region = draft.world.regions.find((candidate) => candidate.id === assignment.regionId);
        this.pushNews(draft, 'scout', 'news.scout.title', 'news.scout.body', { region: region?.name ?? '—', count: assignment.playerIds.length });
      }
      prepareTravelEvent(draft);
      committed = true;
    });
    return committed;
  }

  /** The player's cup tie: stores it, plays the other ties of the round and draws the next one. */
  private async commitCupTie(playerResult: MatchResult): Promise<boolean> {
    const current = this.gs.game();
    if (!current || !this.validResult(current, playerResult)) return false;
    const tie = openCupTie(current.cup, current.clubId, current.league.currentWeek);
    if (!tie || tie.id !== playerResult.fixtureId || tie.homeTeamId !== playerResult.homeTeamId || tie.awayTeamId !== playerResult.awayTeamId) return false;
    if (playerResult.homeScore === playerResult.awayScore && !playerResult.shootout) return false;
    const week = current.league.currentWeek;
    if (!this.unchanged(current, week)) return false;
    let committed = false;
    this.gs.mutate((draft) => {
      const stored = this.settleCupTie(draft, { ...playerResult, week }, true);
      if (!stored) return;
      this.playCupRound(draft, week);
      committed = true;
    });
    return committed;
  }

  private validResult(game: GameState, result: MatchResult): boolean {
    return result.played && [result.homeTeamId, result.awayTeamId].includes(game.clubId) &&
      [result.homeScore, result.awayScore].every((score) => Number.isInteger(score) && score >= 0);
  }

  private unchanged(before: GameState, week: number): boolean {
    const latest = this.gs.game();
    return !!latest && latest.league.id === before.league.id && latest.createdAt === before.createdAt &&
      latest.league.season === before.league.season && latest.league.currentWeek === week;
  }

  /** Divisions without the player's club are simulated statistically. */
  private playOtherDivisions(draft: GameState, week: number): void {
    for (const league of draft.otherLeagues) {
      for (const fixture of league.fixtures.filter((candidate) => candidate.week === week && !candidate.played)) {
        const home = draft.teams.find((team) => team.id === fixture.homeTeamId);
        const away = draft.teams.find((team) => team.id === fixture.awayTeamId);
        if (!home || !away) continue;
        const result = quickSimulate(home, away, { fixtureId: fixture.id, week, season: draft.league.season });
        fixture.homeScore = result.homeScore;
        fixture.awayScore = result.awayScore;
        fixture.played = true;
        this.applyResult(draft, result, false, 'league');
      }
    }
  }

  /** Every still open tie of this week's cup round (the player's own tie only as a safety net). */
  private playCupRound(draft: GameState, week: number): void {
    const round = cupRoundForWeek(draft.cup, week);
    if (!round) return;
    for (const tie of draft.cup.ties.filter((candidate) => candidate.round === round.round && !candidate.played)) {
      const home = draft.teams.find((team) => team.id === tie.homeTeamId);
      const away = draft.teams.find((team) => team.id === tie.awayTeamId);
      if (!home || !away) continue;
      this.settleCupTie(draft, quickSimulate(home, away, { fixtureId: tie.id, week, season: draft.league.season, knockout: true }), false);
    }
    const drawn = advanceCup(draft.cup, allLeagues(draft), draft.world.seed);
    const label = (key: keyof typeof CUP_ROUND_LABELS) => this.roundLabel(draft, key);
    if (drawn.round) {
      const ownTie = draft.cup.ties.find((tie) => tie.round === drawn.round!.round && (tie.homeTeamId === draft.clubId || tie.awayTeamId === draft.clubId));
      if (ownTie) {
        const opponent = draft.teams.find((team) => team.id === (ownTie.homeTeamId === draft.clubId ? ownTie.awayTeamId : ownTie.homeTeamId));
        this.pushNews(draft, 'cup', 'news.cup.draw.title', 'news.cup.draw.body', { round: label(drawn.round.key), opponent: opponent?.name ?? '—', week: drawn.round.week });
      }
    }
    if (drawn.winnerId) {
      const winner = draft.teams.find((team) => team.id === drawn.winnerId);
      if (winner) book(draft, winner, 'prizes', CUP_WINNER_PRIZE);
      this.pushNews(draft, 'trophy', 'news.cup.winner.title', drawn.winnerId === draft.clubId ? 'news.cup.winner.own' : 'news.cup.winner.body', { club: winner?.name ?? '—', cup: draft.cup.name });
      if (drawn.winnerId === draft.clubId) applyBoardDelta(draft.board, 12);
    }
    this.updateCupObjective(draft);
  }

  private settleCupTie(draft: GameState, result: MatchResult, isPlayerMatch: boolean): CupTie | null {
    const tie = recordCupResult(draft.cup, result);
    if (!tie) return null;
    const round = draft.cup.rounds.find((candidate) => candidate.round === tie.round);
    for (const id of [tie.homeTeamId, tie.awayTeamId]) {
      const team = draft.teams.find((candidate) => candidate.id === id);
      if (team && round) book(draft, team, 'prizes', round.prize);
    }
    const home = draft.teams.find((team) => team.id === tie.homeTeamId);
    if (home) book(draft, home, 'gate', gateIncome(home, tierOfTeam(draft, home.id)) * 0.8);
    this.applyResult(draft, result, isPlayerMatch, 'cup');
    if (isPlayerMatch || tie.homeTeamId === draft.clubId || tie.awayTeamId === draft.clubId) {
      const won = tie.winnerId === draft.clubId;
      const opponent = draft.teams.find((team) => team.id === (tie.homeTeamId === draft.clubId ? tie.awayTeamId : tie.homeTeamId));
      const en = draft.settings.locale === 'en';
      const score = `${tie.homeScore}:${tie.awayScore}${tie.penalties ? ` (${tie.penalties.home}:${tie.penalties.away} ${en ? 'pens' : 'i.E.'})` : tie.extraTime ? (en ? ' aet' : ' n.V.') : ''}`;
      this.pushNews(draft, 'cup', won ? 'news.cup.through.title' : 'news.cup.out.title', won ? 'news.cup.through.body' : 'news.cup.out.body', {
        opponent: opponent?.name ?? '—', score, round: round ? this.roundLabel(draft, round.key) : '',
      });
    }
    return tie;
  }

  private roundLabel(draft: GameState, key: keyof typeof CUP_ROUND_LABELS): string {
    return draft.settings.locale === 'en' ? CUP_ROUND_LABELS[key].en : CUP_ROUND_LABELS[key].de;
  }

  private applyResult(draft: GameState, result: MatchResult, isPlayerMatch: boolean, competition: 'league' | 'cup'): void {
    const home = draft.teams.find((t) => t.id === result.homeTeamId);
    const away = draft.teams.find((t) => t.id === result.awayTeamId);
    if (!home || !away) return;
    const rng = new Rng(hash32(`${result.fixtureId ?? result.id}|apply`));
    const homeGrowth = this.applyToTeam(home, result, result.homeScore, result.awayScore, draft.league.season, rng);
    const awayGrowth = this.applyToTeam(away, result, result.awayScore, result.homeScore, draft.league.season, rng);
    if (competition === 'league') {
      book(draft, home, 'gate', gateIncome(home, tierOfTeam(draft, home.id)));
      book(draft, home, 'prizes', matchPrize(result.homeScore, result.awayScore, tierOfTeam(draft, home.id)));
      book(draft, away, 'prizes', matchPrize(result.awayScore, result.homeScore, tierOfTeam(draft, away.id)));
    }

    if (isPlayerMatch) {
      // Store the full result for the match report & history (cap history length).
      draft.results.unshift(result);
      draft.results = draft.results.slice(0, 30);
      const own = home.id === draft.clubId ? home : away;
      const opponent = own === home ? away : home;
      const goalsFor = own === home ? result.homeScore : result.awayScore;
      const goalsAgainst = own === home ? result.awayScore : result.homeScore;
      applyBoardDelta(draft.board, boardMatchDelta(teamStrength(own), teamStrength(opponent), own === home, goalsFor, goalsAgainst) * (competition === 'cup' ? 0.6 : 1));
      this.applyPlayerRewards(draft, home, away, result, competition);
      this.updateObjectives(draft, result, home.id === draft.clubId ? homeGrowth : awayGrowth);
      this.matchStories(draft, result, own, opponent, goalsFor, goalsAgainst);
    }
  }

  private applyToTeam(team: Team, result: MatchResult, goalsFor: number, goalsAgainst: number, season: number, rng: Rng): number {
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
      const injuryEvent = result.events.find((event) => event.type === 'injury' && event.playerId === p.id);
      if (injuryEvent) {
        const injury = injuryEvent.injury ?? createInjury({ seed: hash32(`${result.id}|${p.id}|fallback-injury`), player: p, cause: 'contact', season, week: result.week, fixtureId: result.fixtureId, matchMinute: injuryEvent.minute });
        injury.occurredSeason = season;
        injury.occurredWeek = result.week;
        applyInjury(p, injury);
      }

      p.fitness = result.endingFitness?.[p.id] ?? clamp(p.fitness - rng.int(18, 28), 0, 100);
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

  private applyPlayerRewards(draft: GameState, home: Team, away: Team, result: MatchResult, competition: 'league' | 'cup'): void {
    const club = draft.teams.find((t) => t.id === draft.clubId);
    if (!club) return;
    const isHome = club.id === home.id;
    const goalsFor = isHome ? result.homeScore : result.awayScore;
    const goalsAgainst = isHome ? result.awayScore : result.homeScore;
    const won = goalsFor > goalsAgainst;
    const drew = goalsFor === goalsAgainst;
    const tier = tierOfTeam(draft, club.id);
    const income = Math.round((isHome ? gateIncome(club, tier) : 0) + (competition === 'league' ? matchPrize(goalsFor, goalsAgainst, tier) : 0));
    club.reputation = clamp(club.reputation + (won ? 1 : drew ? 0 : -0.5), 20, 100);
    const leadership = draft.manager.perks.leadership ?? 0;
    this.rpg.awardManagerXp(draft.manager, Math.round((won ? 90 : drew ? 55 : 35) * (1 + leadership * 0.06)));
    for (const player of club.players) {
      player.morale = clamp(player.morale + leadership * (won ? 1 : 0.4), 0, 100);
    }
    if (competition === 'cup') return;
    const opp = isHome ? away : home;
    this.pushNews(draft, won ? 'trophy' : drew ? 'handshake' : 'whistle', 'news.match.title', won ? 'news.match.win' : drew ? 'news.match.draw' : 'news.match.loss', {
      home: result.homeTeamName,
      away: result.awayTeamName,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      opponent: opp.name,
      income,
    });
  }

  private updateObjectives(draft: GameState, result: MatchResult, playerLevels: number): void {
    const clubIsHome = result.homeTeamId === draft.clubId;
    const won = clubIsHome ? result.homeScore > result.awayScore : result.awayScore > result.homeScore;
    const club = draft.teams.find((team) => team.id === draft.clubId)!;
    const youthApps = club.players.filter((player) => player.age <= 21 && result.ratings[player.id] !== undefined).length;
    for (const objective of draft.objectives) {
      if (objective.completed) continue;
      if (objective.type === 'wins' && won) objective.progress++;
      if (objective.type === 'player-growth') objective.progress += playerLevels;
      if (objective.type === 'youth-appearances') objective.progress += youthApps;
      if (objective.type === 'budget') objective.progress = club.coins;
      if (['league-position', 'cup-round', 'budget'].includes(objective.type) || objective.progress < objective.target) continue;
      this.completeObjective(draft, objective);
    }
  }

  private updateCupObjective(draft: GameState): void {
    const objective = draft.objectives.find((candidate) => candidate.type === 'cup-round' && !candidate.completed);
    if (!objective) return;
    objective.progress = cupRoundNumber(draft);
    if (objective.progress >= objective.target) this.completeObjective(draft, objective);
  }

  private completeObjective(draft: GameState, objective: GameState['objectives'][number]): void {
    objective.completed = true;
    const club = draft.teams.find((team) => team.id === draft.clubId)!;
    book(draft, club, 'other', objective.rewardCoins);
    this.rpg.awardManagerXp(draft.manager, objective.rewardXp);
    applyBoardDelta(draft.board, 4);
    this.pushNews(draft, 'target', 'news.objective.title', 'news.objective.body', { coins: objective.rewardCoins, xp: objective.rewardXp });
  }

  private weeklyUpkeep(draft: GameState): void {
    for (const team of draft.teams) {
      ensureFinance(team, draft.league.season);
      const recovery = 12 + team.facilities.medicalCenter * 4;
      for (const p of team.players) {
        if (!isPlayerAvailable(p)) {
          advanceInjury(p, draft.league.season, draft.league.currentWeek, team.facilities.medicalCenter);
        } else {
          p.fitness = clamp(p.fitness + recovery, 0, 100);
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
      const tier = tierOfTeam(draft, team.id);
      book(draft, team, 'tv', weeklyTv(tier));
      book(draft, team, 'sponsor', weeklySponsor(team, tier));
      book(draft, team, 'upkeep', weeklyUpkeep(team));
      book(draft, team, 'wages', weeklyWageBill(draft, team.id));
      team.finance.balance.push(team.coins);
    }
    if (draft.board.confidence < 30 && draft.board.warnedSeason !== draft.league.season) {
      draft.board.warnedSeason = draft.league.season;
      this.pushNews(draft, 'warning', 'news.board.warning.title', 'news.board.warning.body', { confidence: Math.round(draft.board.confidence) });
    }
  }

  /** Streaks, derbies and big wins of the player's club. */
  private matchStories(draft: GameState, result: MatchResult, own: Team, opponent: Team, goalsFor: number, goalsAgainst: number): void {
    if (own.rivalTeamIds.includes(opponent.id)) {
      this.pushNews(draft, 'derby', 'news.derby.title', goalsFor > goalsAgainst ? 'news.derby.win' : goalsFor < goalsAgainst ? 'news.derby.loss' : 'news.derby.draw', { opponent: opponent.name, score: `${result.homeScore}:${result.awayScore}` });
    }
    if (goalsFor - goalsAgainst >= 4) this.pushNews(draft, 'record', 'news.bigwin.title', 'news.bigwin.body', { opponent: opponent.name, score: `${goalsFor}:${goalsAgainst}` });
    const outcomes = draft.results.filter((entry) => entry.homeTeamId === draft.clubId || entry.awayTeamId === draft.clubId).map((entry) => {
      const scored = entry.homeTeamId === draft.clubId ? entry.homeScore : entry.awayScore;
      const conceded = entry.homeTeamId === draft.clubId ? entry.awayScore : entry.homeScore;
      return scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
    });
    const run = (predicate: (outcome: string) => boolean) => { let count = 0; for (const outcome of outcomes) { if (!predicate(outcome)) break; count++; } return count; };
    const wins = run((outcome) => outcome === 'W');
    const losses = run((outcome) => outcome === 'L');
    const unbeaten = run((outcome) => outcome !== 'L');
    if (wins >= 3) this.pushNews(draft, 'streak', 'news.streak.title', 'news.streak.wins', { count: wins });
    else if (unbeaten >= 5 && unbeaten % 5 === 0) this.pushNews(draft, 'streak', 'news.streak.title', 'news.streak.unbeaten', { count: unbeaten });
    else if (losses >= 3) this.pushNews(draft, 'warning', 'news.streak.title', 'news.streak.losses', { count: losses });
    for (const event of result.events.filter((entry) => entry.type === 'injury' && entry.playerId)) {
      const player = own.players.find((candidate) => candidate.id === event.playerId);
      if (player) this.pushNews(draft, 'medical', 'news.injury.title', 'news.injury.body', { player: playerName(player), weeks: player.injuryWeeks || event.injury?.remainingWeeks || 1 });
    }
  }

  /** A weekly transfer rumour about a strong player of another club. */
  private weeklyStories(draft: GameState): void {
    const rng = new Rng(hash32(`${draft.world.seed}|rumour|${draft.league.season}|${draft.league.currentWeek}`));
    if (!rng.bool(0.3)) return;
    const pool = draft.teams.filter((team) => team.id !== draft.clubId).flatMap((team) => team.players.filter((player) => player.overall >= 72).map((player) => ({ player, team })));
    if (!pool.length) return;
    const { player, team } = rng.pick(pool);
    const suitors = draft.teams.filter((candidate) => candidate.id !== team.id && candidate.id !== draft.clubId && candidate.coins > player.marketValue);
    if (!suitors.length) return;
    this.pushNews(draft, 'rumour', 'news.rumour.title', 'news.rumour.body', { player: playerName(player), club: team.name, suitor: rng.pick(suitors).name });
  }

  private pushNews(draft: GameState, icon: string, titleKey: string, bodyKey: string, params?: Record<string, string | number>): void {
    const item: NewsItem = { id: uid('news'), week: draft.league.currentWeek, icon, titleKey, bodyKey, params };
    draft.news.unshift(item);
    draft.news = draft.news.slice(0, NEWS_LIMIT);
  }

  /** Club that offers the sacked manager a job: a second-division side from the lower half. */
  jobOfferFor(game: GameState): string | null {
    const second = allLeagues(game).find((league) => league.tier === 2);
    if (!second) return null;
    const table = standingsFor(game, second).filter((row) => row.teamId !== game.clubId);
    const candidates = table.slice(Math.floor(table.length / 2));
    if (!candidates.length) return null;
    return candidates[hash32(`${game.world.seed}|offer|${game.league.season}`) % candidates.length].teamId;
  }

  /**
   * Season change: archive, rewards, board verdict, promotion and relegation, squad roll-over,
   * new fixtures and cup draw. A sacked manager continues at `takeOfferId`.
   */
  startNextSeason(takeOfferId?: string): void {
    if (!this.gs.seasonOver()) return;
    this.gs.mutate((draft) => {
      const review = buildSeasonReview(draft);
      draft.archive = [...(draft.archive ?? []), archiveEntry(draft, review)].slice(-30);
      for (const entry of review.objectives) if (entry.met && !entry.objective.completed) {
        const objective = draft.objectives.find((candidate) => candidate.id === entry.objective.id);
        if (objective) this.completeObjective(draft, objective);
      }
      draft.board.confidence = review.board.confidence;
      const oldClubId = draft.clubId;
      if (review.board.sacked) {
        const offer = takeOfferId ?? this.jobOfferFor(draft);
        if (offer) this.takeOverClub(draft, offer);
      }

      const rollover = rollOverSquads(draft);
      applyPromotionRelegation(draft, { promoted: review.promotedIds, relegated: review.relegatedIds });
      selectPlayerLeague(draft);
      const finalTopTable = review.leagues.find((league) => league.tier === 1)?.table.map((row) => row.teamId) ?? [];

      const season = draft.league.season + 1;
      scheduleSeason(draft, season);
      draft.trainingWeek = { season, week: 1, slotsUsed: 0, maxSlots: 3, completedSessions: [] };
      returnSeasonLoans(draft);
      draft.transfers.season = season;
      draft.transfers.week = 1;
      for (const team of draft.teams) {
        ensureFinance(team, season);
        aiInvest(draft, team, weeklyWageBill(draft, team.id));
        autoFillLineup(team);
      }
      draft.academy = { season, prospects: academyIntake(draft) };
      draft.cup = createCup({
        teams: draft.teams, leagues: allLeagues(draft), season, seed: draft.world.seed, totalWeeks: draft.league.totalWeeks,
        name: draft.cup?.name ?? `${countryRoot(draft.world)} Cup`,
        // Byes go to the best of last season's top flight that are still in it.
        seededIds: finalTopTable.filter((id) => allLeagues(draft).find((league) => league.tier === 1)?.teamIds.includes(id)),
      });
      draft.objectives = generateSeasonObjectives(draft);
      draft.board.expectedPosition = draft.objectives.find((objective) => objective.type === 'league-position')?.target ?? 6;
      draft.board.warnedSeason = null;
      draft.board.jobOffer = null;

      this.pushNews(draft, 'flag', 'news.season.title', 'news.season.body', { season });
      if (draft.clubId !== oldClubId) this.pushNews(draft, 'warning', 'news.board.sacked.title', 'news.board.sacked.body', { club: draft.teams.find((team) => team.id === draft.clubId)?.name ?? '—' });
      if (review.clubPromoted && draft.clubId === oldClubId) this.pushNews(draft, 'trophy', 'news.promoted.title', 'news.promoted.body', { league: draft.league.name });
      if (review.clubRelegated && draft.clubId === oldClubId) this.pushNews(draft, 'warning', 'news.relegated.title', 'news.relegated.body', { league: draft.league.name });
      for (const player of rollover.retired) this.pushNews(draft, 'flag', 'news.retired.title', 'news.retired.body', { player: playerName(player), age: player.age, games: player.career?.appearances ?? 0 });
      for (const player of rollover.left) this.pushNews(draft, 'contract', 'news.left.title', 'news.left.body', { player: playerName(player) });
      const best = [...draft.academy.prospects].sort((a, b) => b.potential - a.potential)[0];
      if (best) this.pushNews(draft, 'academy', 'news.academy.title', 'news.academy.body', { count: draft.academy.prospects.length, player: playerName(best), potential: best.potential });
      processTransferWeek(draft);
      prepareTravelEvent(draft);
    });
  }

  /** The manager moves to another club; that club's manager takes the old post. */
  private takeOverClub(draft: GameState, teamId: string): void {
    const previous = draft.teams.find((team) => team.id === draft.clubId);
    const next = draft.teams.find((team) => team.id === teamId);
    if (!previous || !next || previous === next) return;
    const replacement = draft.managers.find((manager) => manager.clubId === next.id);
    if (replacement) {
      replacement.clubId = previous.id;
      previous.managerId = replacement.id;
    }
    previous.isPlayerControlled = false;
    next.isPlayerControlled = true;
    next.managerId = draft.manager.id;
    draft.manager.clubId = next.id;
    draft.clubId = next.id;
    draft.board = { confidence: 55, warnedSeason: null, expectedPosition: draft.board.expectedPosition, jobOffer: null };
    draft.transfers.negotiations = draft.transfers.negotiations.filter((negotiation) => ['accepted', 'rejected', 'expired'].includes(negotiation.status));
    draft.transfers.listings = draft.transfers.listings.filter((listing) => listing.teamId !== previous.id);
    draft.academy = { season: draft.league.season, prospects: [] };
  }
}
