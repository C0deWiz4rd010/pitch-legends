import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { createNewGame } from './data/generators';
import { GameStateService } from './core/services/game-state.service';
import { MatchEngineService } from './core/services/match-engine.service';
import { SaveService } from './core/services/save.service';
import { SeasonService } from './core/services/season.service';
import { resolveTravelEvent } from './core/travel-engine';
import { quickSimulate } from './core/career/quick-sim';
import { advanceCup, createCup, cupProgress, recordCupResult } from './core/career/cup';
import { allLeagues, applyPromotionRelegation, promotionMoves } from './core/career/divisions';
import { developPlayer, retiringPlayers } from './core/career/lifecycle';
import { boardMatchDelta } from './core/career/objectives';
import { buildSeasonReview } from './core/career/season-review';
import { startScoutAssignment } from './core/career/scouting';
import { Rng } from './core/util';
import { GameState } from './models/game.model';
import { Team } from './models/team.model';

function quick(home: Team, away: Team, week: number, _seed?: number, fixtureId = '', knockout = false) {
  return quickSimulate(home, away, { fixtureId: fixtureId || `${home.id}-${away.id}-${week}`, week, season: 1, knockout });
}

function playAllWeeks(fixtures: GameState['league']['fixtures'], scoreFor: (index: number) => [number, number]): void {
  fixtures.forEach((fixture, index) => {
    [fixture.homeScore, fixture.awayScore] = scoreFor(index);
    fixture.played = true;
  });
}

describe('Career V2: divisions, cup, finances and the season cycle', () => {
  let gs: GameStateService;
  let season: SeasonService;
  let saves: SaveService;
  const engine = {
    simulate: vi.fn(quick),
    simulateAsync: vi.fn(async (...args: Parameters<typeof quick>) => quick(...args)),
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: MatchEngineService, useValue: engine }] });
    gs = TestBed.inject(GameStateService);
    season = TestBed.inject(SeasonService);
    saves = TestBed.inject(SaveService);
  });

  it('creates two divisions of twelve, a 24-club cup with eight byes and season objectives', () => {
    const game = createNewGame({ managerName: 'Two Tier', clubName: 'Tier FC', seed: 50501 });
    expect(game.teams).toHaveLength(24);
    expect(game.league.tier).toBe(1);
    expect(game.otherLeagues).toHaveLength(1);
    expect(game.otherLeagues[0].tier).toBe(2);
    expect(new Set([...game.league.teamIds, ...game.otherLeagues[0].teamIds]).size).toBe(24);
    expect(game.world.cities).toHaveLength(24);
    expect(game.cup.byeTeamIds).toHaveLength(8);
    expect(game.cup.rounds.map((round) => round.key)).toEqual(['r1', 'r2', 'qf', 'sf', 'final']);
    expect(game.cup.ties).toHaveLength(8);
    expect(game.objectives.map((objective) => objective.type)).toEqual(['league-position', 'cup-round', 'youth-appearances', 'budget', 'player-growth']);
    // The first division is generated exactly as before the second division existed.
    const again = createNewGame({ managerName: 'Two Tier', clubName: 'Tier FC', seed: 50501 });
    expect(again.teams.slice(0, 12).map((team) => team.name)).toEqual(game.teams.slice(0, 12).map((team) => team.name));

    const second = createNewGame({ managerName: 'Low Start', clubName: 'Low FC', seed: 50502, startTier: 2 });
    expect(second.league.tier).toBe(2);
    expect(second.league.teamIds).toContain(second.clubId);
    expect(second.otherLeagues[0].teamIds).not.toContain(second.clubId);
  });

  it('gives every club of both divisions a unique three-letter code', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const game = createNewGame({ managerName: 'Codes', clubName: 'Northstar AFC', clubShort: 'NSA', seed });
      const codes = game.teams.map((team) => team.shortName);
      expect(new Set(codes).size).toBe(codes.length);
      expect(game.teams[0].shortName).toBe('NSA');
    }
  }, 20_000);

  it('runs a knockout cup to a single winner and lets lower-division clubs host', () => {
    const game = createNewGame({ managerName: 'Cup', clubName: 'Cup FC', seed: 50503 });
    const cup = createCup({ teams: game.teams, leagues: allLeagues(game), season: 1, seed: 7, totalWeeks: 22, name: 'Test Cup' });
    const tierOf = (id: string) => allLeagues(game).find((league) => league.teamIds.includes(id))!.tier;
    const roundSizes: number[] = [];
    for (let guard = 0; guard < 6 && !cup.winnerId; guard++) {
      const round = Math.max(...cup.ties.map((tie) => tie.round));
      const ties = cup.ties.filter((tie) => tie.round === round);
      roundSizes.push(ties.length);
      for (const tie of ties) {
        expect(tierOf(tie.homeTeamId)).toBeGreaterThanOrEqual(tierOf(tie.awayTeamId));
        const home = game.teams.find((team) => team.id === tie.homeTeamId)!;
        const away = game.teams.find((team) => team.id === tie.awayTeamId)!;
        const result = quickSimulate(home, away, { fixtureId: tie.id, week: tie.week, season: 1, knockout: true });
        expect(result.homeScore !== result.awayScore || !!result.shootout).toBe(true);
        expect(recordCupResult(cup, result)?.winnerId).toBeTruthy();
      }
      advanceCup(cup, allLeagues(game), 7);
    }
    expect(roundSizes).toEqual([8, 8, 4, 2, 1]);
    expect(cup.winnerId).toBeTruthy();
    expect(cupProgress(cup, cup.winnerId!)).toBe('winner');
  });

  it('swaps the bottom two of the top flight with the top two of the second division', () => {
    const game = createNewGame({ managerName: 'Moves', clubName: 'Moves FC', seed: 50504 });
    playAllWeeks(game.league.fixtures, (index) => [index % 3, (index + 1) % 2]);
    playAllWeeks(game.otherLeagues[0].fixtures, (index) => [(index * 7) % 4, index % 3]);
    const moves = promotionMoves(game);
    expect(moves.promoted).toHaveLength(2);
    expect(moves.relegated).toHaveLength(2);
    applyPromotionRelegation(game, moves);
    const top = allLeagues(game).find((league) => league.tier === 1)!;
    const second = allLeagues(game).find((league) => league.tier === 2)!;
    expect(moves.promoted.every((id) => top.teamIds.includes(id))).toBe(true);
    expect(moves.relegated.every((id) => second.teamIds.includes(id))).toBe(true);
    expect(top.teamIds).toHaveLength(12);
    expect(game.league.teamIds).toContain(game.clubId);
  });

  it('develops young players, lets veterans decline pace first and retires them deterministically', () => {
    const game = createNewGame({ managerName: 'Age', clubName: 'Age FC', seed: 50505 });
    const young = structuredClone(game.teams[3].players[0]);
    young.age = 18; young.potential = Math.min(99, young.overall + 15);
    const before = young.overall;
    developPlayer(young, new Rng(1));
    expect(young.overall).toBeGreaterThan(before);
    const veteran = structuredClone(game.teams[3].players[1]);
    veteran.age = 34;
    const pace = veteran.attributes.pace;
    developPlayer(veteran, new Rng(2));
    expect(veteran.attributes.pace).toBeLessThan(pace);
    for (const player of game.teams[4].players) player.age = 37;
    const first = retiringPlayers(game).map((entry) => entry.player.id);
    expect(first.length).toBeGreaterThan(0);
    expect(retiringPlayers(game).map((entry) => entry.player.id)).toEqual(first);
  });

  it('measures results against squad strength for the board', () => {
    expect(boardMatchDelta(70, 60, true, 3, 0)).toBeGreaterThan(0);
    expect(boardMatchDelta(70, 60, true, 0, 1)).toBeLessThan(-2);
    expect(boardMatchDelta(55, 75, false, 1, 1)).toBeGreaterThan(0);
  });

  it('migrates a version 5 career into two divisions with a cup and club finances', () => {
    const game = createNewGame({ managerName: 'Legacy', clubName: 'Legacy FC', seed: 50506 }) as Partial<GameState> & GameState;
    const topIds = new Set(game.league.teamIds);
    game.teams = game.teams.filter((team) => topIds.has(team.id));
    game.managers = game.managers.filter((manager) => topIds.has(manager.clubId));
    game.world.cities = game.world.cities.filter((city) => topIds.has(city.teamId));
    for (const team of game.teams) delete (team as Partial<Team>).finance;
    delete (game.league as Partial<GameState['league']>).tier;
    for (const key of ['otherLeagues', 'cup', 'archive', 'board', 'scouting', 'academy'] as const) delete game[key];
    game.version = 5;
    game.league.currentWeek = 5;

    const migrated = saves.parseImport(JSON.stringify(game));
    expect(migrated.version).toBe(6);
    expect(migrated.teams).toHaveLength(24);
    expect(migrated.otherLeagues[0].fixtures.filter((fixture) => fixture.week < 5).every((fixture) => fixture.played)).toBe(true);
    expect(migrated.cup.rounds[0].week).toBeGreaterThanOrEqual(5);
    expect(migrated.teams.every((team) => !!team.finance)).toBe(true);
    expect(migrated.teams.slice(0, 12).map((team) => team.id)).toEqual(game.teams.map((team) => team.id));
  });

  it('plays five seasons with cup ties, promotion, finances, scouting and reloads', async () => {
    const game = createNewGame({ managerName: 'Long Run', clubName: 'Marathon FC', seed: 50507 });
    game.settings.autoSave = false;
    gs.importState(game);
    gs.mutate((draft) => { startScoutAssignment(draft, draft.world.regions[0].id, 'ATT'); });
    const seen = new Set<string>();
    for (let year = 1; year <= 5; year++) {
      let cupTies = 0;
      for (let guard = 0; guard < 60 && !gs.seasonOver(); guard++) {
        gs.mutate((draft) => {
          for (const event of draft.world.travelEvents.filter((candidate) => !candidate.resolved)) resolveTravelEvent(draft, event.id, 'bold');
        });
        const fixture = gs.nextFixture()!;
        const result = season.simulatePlayerMatch()!;
        expect(result.fixtureId).toBe(fixture.id);
        if (fixture.competition === 'cup') cupTies++;
        expect(await season.commitWeek(result)).toBe(true);
      }
      const state = gs.game()!;
      expect(gs.seasonOver()).toBe(true);
      for (const league of allLeagues(state)) {
        expect(league.fixtures).toHaveLength(132);
        expect(league.fixtures.every((fixture) => fixture.played)).toBe(true);
        for (const fixture of league.fixtures) { expect(seen.has(fixture.id)).toBe(false); seen.add(fixture.id); }
      }
      expect(state.cup.winnerId).toBeTruthy();
      expect(state.cup.ties.every((tie) => tie.played)).toBe(true);
      expect(cupTies).toBeGreaterThanOrEqual(state.cup.byeTeamIds.includes(state.clubId) ? 0 : 1);
      if (year === 1) expect(state.scouting[0].delivered).toBe(true);

      const review = buildSeasonReview(state);
      expect(review.awards.map((award) => award.key)).toContain('scorer');
      expect(review.leagues).toHaveLength(2);
      season.startNextSeason();
      const next = gs.game()!;
      expect(next.league.season).toBe(year + 1);
      expect(next.archive).toHaveLength(year);
      expect(next.archive[year - 1].cupWinnerId).toBe(state.cup.winnerId);
      const top = allLeagues(next).find((league) => league.tier === 1)!;
      expect(review.promotedIds.every((id) => top.teamIds.includes(id))).toBe(true);
      expect(next.objectives.every((objective) => objective.season === year + 1)).toBe(true);
      expect(next.cup.season).toBe(year + 1);
      for (const team of next.teams) {
        expect(team.players.length).toBeGreaterThanOrEqual(16);
        expect(team.players.length).toBeLessThanOrEqual(26);
        expect(team.players.some((player) => player.positionGroup === 'GK')).toBe(true);
        expect(team.formation.slots.every((slot) => !!slot.playerId)).toBe(true);
      }
      gs.importState(saves.parseImport(JSON.stringify(next)));
    }
    const final = gs.game()!;
    // Every club stays solvent and the AI keeps trading.
    expect(final.teams.every((team) => team.coins > 0)).toBe(true);
    expect(final.transfers.history.some((deal) => deal.season >= 4 && deal.toTeamId !== final.clubId)).toBe(true);
    expect(final.teams.every((team) => team.finance.previous && team.finance.previous.tv > 0)).toBe(true);
    expect(final.teams.flatMap((team) => team.players).some((player) => (player.career?.seasons ?? 0) >= 4)).toBe(true);
  }, 120_000);

  it('sacks a failing manager at season end and continues at the offered club', async () => {
    const game = createNewGame({ managerName: 'Hot Seat', clubName: 'Wobble FC', seed: 50508 });
    game.settings.autoSave = false;
    for (const league of allLeagues(game)) playAllWeeks(league.fixtures, (index) => [index % 2, index % 3]);
    for (const tie of game.cup.ties) { tie.played = true; tie.homeScore = 1; tie.awayScore = 0; tie.winnerId = tie.homeTeamId; }
    game.cup.winnerId = game.cup.ties[0].homeTeamId;
    game.board.confidence = 2;
    gs.importState(game);
    const oldClub = game.clubId;
    expect(buildSeasonReview(gs.game()!).board.sacked).toBe(true);
    const offer = season.jobOfferFor(gs.game()!)!;
    season.startNextSeason(offer);
    const next = gs.game()!;
    expect(next.clubId).toBe(offer);
    expect(next.manager.clubId).toBe(offer);
    expect(next.teams.find((team) => team.id === oldClub)!.isPlayerControlled).toBe(false);
    expect(next.teams.find((team) => team.id === offer)!.isPlayerControlled).toBe(true);
    expect(next.league.teamIds).toContain(offer);
    expect(next.managers.find((manager) => manager.clubId === oldClub)).toBeTruthy();
  });
});
