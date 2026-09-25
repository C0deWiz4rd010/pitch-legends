import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { MatchCheckpointService, MATCH_CHECKPOINT_KEY } from './core/services/match-checkpoint.service';
import { GameStateService } from './core/services/game-state.service';
import { createNewGame } from './data/generators';
import { interpolateThreeFrame, RenderInterpolationScratch } from './features/match/three-render-state';
import { kitSilhouetteUri } from './core/services/portrait.service';
import { EMPTY_MATCH_COMMAND } from './models/match.model';

function runningMatch(): ArcadeMatch {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, home.id, 3, 11);
  for (let tick = 0; tick < 240; tick++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, moveX: 1, sprint: true });
  return match;
}

describe('Foundation performance contracts', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); TestBed.resetTestingModule(); });

  it('rewrites a reused render frame to exactly the freshly built state', () => {
    const match = runningMatch();
    const stale = match.renderState();
    for (let tick = 0; tick < 30; tick++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, moveY: 1 });
    const reused = match.renderState(stale);
    expect(reused).toBe(stale);
    expect(JSON.parse(JSON.stringify(reused))).toEqual(JSON.parse(JSON.stringify(match.renderState())));
  });

  it('interpolates into scratch storage without touching either simulation frame', () => {
    const match = runningMatch();
    const previous = match.renderState();
    match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, moveX: -1 });
    const current = match.renderState();
    const before = JSON.stringify({ previous, current });
    const scratch: RenderInterpolationScratch = { players: [], owned: [] };
    const first = interpolateThreeFrame({ previous, current, alpha: .5, deltaSeconds: 1 / 60 }, scratch);
    const second = interpolateThreeFrame({ previous, current, alpha: .25, deltaSeconds: 1 / 60 }, scratch);
    expect(second).toBe(first);
    expect(JSON.stringify({ previous, current })).toBe(before);
    const moved = current.players.findIndex((player, index) => player.x !== previous.players[index].x);
    expect(second.players[moved].x).toBeCloseTo(previous.players[moved].x + (current.players[moved].x - previous.players[moved].x) * .25, 6);
    expect(interpolateThreeFrame({ previous, current, alpha: .25, deltaSeconds: 1 / 60 })).toEqual(second);
  });

  it('writes idle checkpoints once, keeps only the newest and never resurrects a cleared one', () => {
    vi.useFakeTimers();
    const service = new MatchCheckpointService();
    const match = runningMatch();
    service.saveWhenIdle(match.checkpoint());
    match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    const newest = match.checkpoint();
    service.saveWhenIdle(newest);
    expect(localStorage.getItem(MATCH_CHECKPOINT_KEY)).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(JSON.parse(localStorage.getItem(MATCH_CHECKPOINT_KEY)!).tick).toBe(newest.tick);
    service.saveWhenIdle(match.checkpoint());
    service.clear();
    vi.advanceTimersByTime(2000);
    expect(localStorage.getItem(MATCH_CHECKPOINT_KEY)).toBeNull();
    service.saveWhenIdle(newest);
    expect(service.load()?.tick).toBe(newest.tick);
  });

  it('coalesces career autosaves and discards a pending save when the career is deleted', () => {
    vi.useFakeTimers();
    const gs = TestBed.inject(GameStateService);
    gs.importState(createNewGame({ managerName: 'Burst Tester', clubName: 'Batch FC', seed: 77 }));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setItem.mockClear();
    for (let index = 0; index < 5; index++) gs.mutate(draft => { draft.manager.xp += 1; });
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(setItem).toHaveBeenCalledTimes(1);
    gs.mutate(draft => { draft.manager.xp += 1; });
    gs.deleteGame();
    vi.advanceTimersByTime(200);
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });

  it('falls back to a kit-coloured silhouette instead of the retired pixel sprites', () => {
    const { home } = createPracticeTeams();
    const uri = kitSilhouetteUri(home.visuals.kits.home, 9, true);
    expect(uri.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(uri)).toContain(home.visuals.kits.home.shirt.toLowerCase().slice(0, 4));
    expect(decodeURIComponent(uri)).toContain('>9<');
  });
});
