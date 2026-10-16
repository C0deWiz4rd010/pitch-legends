import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { createNewGame } from './data/generators';
import { GameStateService } from './core/services/game-state.service';
import { MatchEngineService } from './core/services/match-engine.service';
import { SeasonService } from './core/services/season.service';
import { resolveTravelEvent } from './core/travel-engine';
import { quickSimulate } from './core/career/quick-sim';
import { GameState } from './models/game.model';
import { Team } from './models/team.model';
import { EXPENSE_KINDS, INCOME_KINDS } from './models/career.model';

function quick(home: Team, away: Team, week: number, _seed?: number, fixtureId = '', knockout = false) {
  return quickSimulate(home, away, { fixtureId: fixtureId || `${home.id}-${away.id}-${week}`, week, season: 1, knockout });
}

interface SeasonSnapshot {
  season: number;
  players: number;
  minSquad: number;
  maxSquad: number;
  meanOverall: number;
  maxOverall: number;
  meanAge: number;
  minCoins: number;
  medianCoins: number;
  maxCoins: number;
  ownCoins: number;
  transfers: number;
  medianIncome: number;
  medianExpenses: number;
}

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

function snapshot(state: GameState, transfers = 0): SeasonSnapshot {
  const previous = state.teams.map((team) => team.finance?.previous).filter((totals) => !!totals);
  const players = state.teams.flatMap((team) => team.players);
  // The manager's club is left out: without a human it never spends.
  const coins = state.teams.filter((team) => team.id !== state.clubId).map((team) => team.coins).sort((a, b) => a - b);
  const squads = state.teams.map((team) => team.players.length);
  return {
    season: state.league.season,
    players: players.length,
    minSquad: Math.min(...squads),
    maxSquad: Math.max(...squads),
    meanOverall: Math.round(players.reduce((sum, player) => sum + player.overall, 0) / players.length * 10) / 10,
    maxOverall: Math.max(...players.map((player) => player.overall)),
    meanAge: Math.round(players.reduce((sum, player) => sum + player.age, 0) / players.length * 10) / 10,
    minCoins: coins[0],
    medianCoins: coins[Math.floor(coins.length / 2)],
    maxCoins: coins[coins.length - 1],
    ownCoins: state.teams.find((team) => team.id === state.clubId)!.coins,
    transfers,
    medianIncome: median(previous.map((totals) => INCOME_KINDS.reduce((sum, kind) => sum + totals![kind], 0))),
    medianExpenses: median(previous.map((totals) => EXPENSE_KINDS.reduce((sum, kind) => sum + totals![kind], 0))),
  };
}

/** Ten seasons headless: the world must neither inflate, starve nor run out of players. */
describe('Career long run: ten seasons without a human', () => {
  const engine = {
    simulate: vi.fn(quick),
    simulateAsync: vi.fn(async (...args: Parameters<typeof quick>) => quick(...args)),
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: MatchEngineService, useValue: engine }] });
  });
  afterEach(() => { localStorage.clear(); TestBed.resetTestingModule(); });

  it('keeps economy, squads and ratings in a healthy band for ten seasons', async () => {
    const gs = TestBed.inject(GameStateService);
    const season = TestBed.inject(SeasonService);
    const game = createNewGame({ managerName: 'Ten Years', clubName: 'Decade FC', seed: 101010 });
    game.settings.autoSave = false;
    gs.importState(game);
    const history: SeasonSnapshot[] = [snapshot(gs.game()!)];
    for (let year = 1; year <= 10; year++) {
      for (let guard = 0; guard < 60 && !gs.seasonOver(); guard++) {
        gs.mutate((draft) => {
          for (const event of draft.world.travelEvents.filter((candidate) => !candidate.resolved)) resolveTravelEvent(draft, event.id, 'safe');
        });
        const result = season.simulatePlayerMatch()!;
        expect(await season.commitWeek(result)).toBe(true);
      }
      expect(gs.seasonOver()).toBe(true);
      const finished = gs.game()!;
      const transfers = finished.transfers.history.filter((deal) => deal.season === finished.league.season && deal.kind === 'permanent').length;
      season.startNextSeason();
      const state = gs.game()!;
      history.push(snapshot(state, transfers));
      for (const team of state.teams) {
        expect(team.players.some((player) => player.positionGroup === 'GK')).toBe(true);
        expect(team.formation.slots.every((slot) => !!slot.playerId)).toBe(true);
        expect(Number.isFinite(team.coins)).toBe(true);
      }
    }
    // The table is printed so balance changes can be compared run by run.
    console.table(history);
    const first = history[0];
    for (const entry of history.slice(1)) {
      expect(entry.minSquad).toBeGreaterThanOrEqual(16);
      expect(entry.maxSquad).toBeLessThanOrEqual(26);
      // The player pool stays roughly constant: retirements are replaced by youth and free agents.
      expect(entry.players).toBeGreaterThanOrEqual(first.players * 0.85);
      expect(entry.players).toBeLessThanOrEqual(first.players * 1.15);
      expect(entry.maxOverall).toBeLessThanOrEqual(99);
      expect(entry.meanAge).toBeGreaterThan(22);
      expect(entry.meanAge).toBeLessThan(30);
      // Every club can pay its way, nobody hoards the whole league's money.
      expect(entry.minCoins).toBeGreaterThan(0);
      expect(entry.maxCoins).toBeLessThan(entry.medianCoins * 12);
      expect(entry.transfers).toBeGreaterThan(0);
    }
    // No rating inflation or collapse over a decade.
    const last = history[history.length - 1];
    expect(Math.abs(last.meanOverall - first.meanOverall)).toBeLessThanOrEqual(6);
  }, 300_000);
});
