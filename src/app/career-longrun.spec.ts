import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { createNewGame } from './data/generators';
import { GameStateService } from './core/services/game-state.service';
import { MatchEngineService } from './core/services/match-engine.service';
import { SeasonService } from './core/services/season.service';
import { MetaService } from './core/services/meta.service';
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
  /** Mean unspent skill points of the players no human manages. */
  aiSkillPoints: number;
  medianIncome: number;
  medianExpenses: number;
  /** The managed club's team spirit and open transfer requests at the turn of the season. */
  spirit: number;
  openRequests: number;
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
    aiSkillPoints: Math.round(state.teams.filter((team) => team.id !== state.clubId).flatMap((team) => team.players).reduce((sum, player, _, all) => sum + player.skillPoints / all.length, 0) * 10) / 10,
    medianIncome: median(previous.map((totals) => INCOME_KINDS.reduce((sum, kind) => sum + totals![kind], 0))),
    medianExpenses: median(previous.map((totals) => EXPENSE_KINDS.reduce((sum, kind) => sum + totals![kind], 0))),
    spirit: Math.round(state.dressingRoom?.spirit ?? 0),
    openRequests: state.dressingRoom?.requests.length ?? 0,
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
    // The dressing room is watched every week: spirit stays in range, requests stay rare and capped.
    let spiritLow = 100, spiritHigh = 0, mostOpen = 0, requestsMade = 0, requestKey = '0|-99';
    for (let year = 1; year <= 10; year++) {
      for (let guard = 0; guard < 60 && !gs.seasonOver(); guard++) {
        gs.mutate((draft) => {
          for (const event of draft.world.travelEvents.filter((candidate) => !candidate.resolved)) resolveTravelEvent(draft, event.id, 'safe');
        });
        const result = season.simulatePlayerMatch()!;
        expect(await season.commitWeek(result)).toBe(true);
        const room = gs.game()!.dressingRoom!;
        spiritLow = Math.min(spiritLow, room.spirit);
        spiritHigh = Math.max(spiritHigh, room.spirit);
        mostOpen = Math.max(mostOpen, room.requests.length);
        const key = `${room.lastRequestSeason}|${room.lastRequestWeek}`;
        if (key !== requestKey) { requestsMade++; requestKey = key; }
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
      // Computer-built players spend what they earn; before, their points piled up unused for years.
      expect(entry.aiSkillPoints).toBeLessThan(14);
    }
    console.log(`Dressing room over ten seasons: spirit ${spiritLow.toFixed(0)}..${spiritHigh.toFixed(0)}, most open requests ${mostOpen}, requests made ${requestsMade}`);
    expect(spiritLow).toBeGreaterThan(25);
    expect(spiritHigh).toBeLessThanOrEqual(100);
    expect(mostOpen).toBeLessThanOrEqual(3);
    // Requests are rare: well under three a season on average, and never in clusters.
    expect(requestsMade).toBeLessThanOrEqual(30);
    // The meta layer followed the whole decade: every season and every match of the managed club was counted, once.
    const meta = TestBed.inject(MetaService).state();
    expect(meta.counters['seasons']).toBe(10);
    expect(meta.counters['matches']).toBeGreaterThanOrEqual(150);
    expect(meta.counters['matches']).toBeLessThanOrEqual(10 * 40);
    expect(meta.unlocked['seasons-2']).toBeGreaterThan(0);
    expect(meta.xp).toBeGreaterThan(500);
    // Every archived season carries its RPG recap, and over ten seasons the squad did gain levels.
    const archive = gs.game()!.archive;
    expect(archive).toHaveLength(10);
    expect(archive.every((entry) => !!entry.rpg)).toBe(true);
    expect(archive.reduce((sum, entry) => sum + (entry.rpg?.levelsGained ?? 0), 0)).toBeGreaterThan(0);
    // No rating inflation or collapse over a decade.
    const last = history[history.length - 1];
    expect(Math.abs(last.meanOverall - first.meanOverall)).toBeLessThanOrEqual(6);
  }, 300_000);
});
