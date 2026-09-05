import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { createNewGame } from './data/generators';
import { GameStateService } from './core/services/game-state.service';
import { MatchEngineService } from './core/services/match-engine.service';
import { SaveService } from './core/services/save.service';
import { SeasonService } from './core/services/season.service';
import { resolveTravelEvent } from './core/travel-engine';
import { emptyTeamMatchStats, MatchResult } from './models/match.model';
import { Team } from './models/team.model';

function resultFor(home: Team, away: Team, week: number, _seed?: number, fixtureId = ''): MatchResult {
  return {
    id: `result-${fixtureId}`, fixtureId, week,
    homeTeamId: home.id, awayTeamId: away.id, homeTeamName: home.name, awayTeamName: away.name,
    homeScore: 2, awayScore: 1, events: [], keyframes: [], ratings: {}, contributions: {},
    homeStats: emptyTeamMatchStats(), awayStats: emptyTeamMatchStats(), manOfTheMatchId: null, played: true,
  };
}

describe('Career season integrity', () => {
  let gs: GameStateService;
  let season: SeasonService;
  let saves: SaveService;
  const engine = { simulate: vi.fn(resultFor), simulateAsync: vi.fn(async (...args: Parameters<typeof resultFor>) => resultFor(...args)) };

  beforeEach(() => {
    localStorage.clear();
    engine.simulate.mockReset().mockImplementation(resultFor);
    engine.simulateAsync.mockReset().mockImplementation(async (...args) => resultFor(...args));
    TestBed.configureTestingModule({ providers: [{ provide: MatchEngineService, useValue: engine }] });
    gs = TestBed.inject(GameStateService);
    season = TestBed.inject(SeasonService);
    saves = TestBed.inject(SaveService);
    const game = createNewGame({ managerName: 'Season Tester', clubName: 'Continuity FC', seed: 230401 });
    game.settings.autoSave = false;
    gs.importState(game);
  });

  it('completes three seasons with unique fixture identities, retained reports and reloads', async () => {
    const allFixtureIds = new Set<string>();
    let previousTravelIds = new Set<string>();
    for (let year = 1; year <= 3; year++) {
      const fixtures = gs.game()!.league.fixtures;
      expect(fixtures).toHaveLength(132);
      for (const fixture of fixtures) {
        expect(allFixtureIds.has(fixture.id)).toBe(false);
        allFixtureIds.add(fixture.id);
      }
      while (!gs.seasonOver()) {
        const result = season.simulatePlayerMatch()!;
        const nextWeek = gs.currentWeek() + 1;
        gs.mutate((draft) => {
          for (const event of draft.world.travelEvents.filter((event) => !event.resolved)) {
            resolveTravelEvent(draft, event.id);
          }
        });
        expect(await season.commitWeek(result)).toBe(true);
        expect(gs.currentWeek()).toBe(nextWeek);
        expect(await season.commitWeek(result)).toBe(false);
        const reloaded = saves.parseImport(JSON.stringify(gs.game()));
        gs.importState(reloaded);
      }
      expect(gs.standings().every((row) => row.played === 22)).toBe(true);
      const thisYearsTravel = gs.game()!.world.travelEvents.filter((event) => event.season === year);
      expect(thisYearsTravel.length).toBeGreaterThan(0);
      expect(thisYearsTravel.every((event) => !previousTravelIds.has(event.id))).toBe(true);
      previousTravelIds = new Set(gs.game()!.world.travelEvents.map((event) => event.id));
      const reportIds = gs.game()!.results.map((result) => result.id);
      expect(new Set(reportIds).size).toBe(reportIds.length);
      if (year < 3) {
        season.startNextSeason();
        expect(gs.season()).toBe(year + 1);
        expect(gs.game()!.results.map((result) => result.id)).toEqual(reportIds);
        expect(gs.trainingSlotsRemaining()).toBe(3);
      }
    }
    expect(allFixtureIds.size).toBe(396);
    expect(gs.game()!.results).toHaveLength(30);
  }, 30_000);

  it('commits a concurrently submitted result only once', async () => {
    const result = season.simulatePlayerMatch()!;
    expect((await Promise.all([season.commitWeek(result), season.commitWeek(result)])).sort()).toEqual([false, true]);
    expect(gs.currentWeek()).toBe(2);
    expect(gs.game()!.results.filter((stored) => stored.fixtureId === result.fixtureId)).toHaveLength(1);
  });

  it('rejects a stale season result even when its opponents match the new fixture', async () => {
    const result = season.simulatePlayerMatch()!;
    gs.mutate((draft) => { draft.league.fixtures.forEach((fixture) => { fixture.played = true; }); });
    season.startNextSeason();
    expect(await season.commitWeek(result)).toBe(false);
    expect(gs.currentWeek()).toBe(1);
    expect(gs.game()!.results).toHaveLength(0);
  });

  it('does not apply pending worker results to a replaced career', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => { finish = resolve; });
    engine.simulateAsync.mockImplementation(async (...args) => { await waiting; return resultFor(...args); });
    const pending = season.commitWeek(season.simulatePlayerMatch()!);
    const replacement = createNewGame({ managerName: 'Replacement', clubName: 'Other FC', seed: 330402 });
    gs.importState(replacement);
    finish();
    expect(await pending).toBe(false);
    expect(gs.game()!.clubId).toBe(replacement.clubId);
    expect(gs.currentWeek()).toBe(1);
    expect(gs.game()!.results).toHaveLength(0);
  });

  it('cannot skip an unfinished season', () => {
    const before = gs.game();
    season.startNextSeason();
    expect(gs.game()).toBe(before);
  });
});
