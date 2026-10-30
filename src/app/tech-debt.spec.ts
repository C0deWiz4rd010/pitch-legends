import { TestBed } from '@angular/core/testing';
import { GameStateService } from './core/services/game-state.service';
import { PersistentStore } from './core/storage/persistent-store';
import { buildProfile } from './core/team-profile';
import { createNewGame } from './data/generators';

describe('Phase 9 tech debt', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('changes settings without copying the world', () => {
    const gs = TestBed.inject(GameStateService);
    gs.importState(createNewGame({ managerName: 'P', clubName: 'P FC', seed: 9 }));
    const before = gs.game()!;
    gs.patchSettings((settings) => {
      settings.reducedMotion = !settings.reducedMotion;
    });
    const after = gs.game()!;
    expect(after.settings.reducedMotion).toBe(!before.settings.reducedMotion);
    expect(after.settings).not.toBe(before.settings);
    expect(after.teams).toBe(before.teams);
    expect(after.league).toBe(before.league);
    expect(before.settings.reducedMotion).toBe(!after.settings.reducedMotion);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('keeps the team profile of the tactics analysis after the legacy simulation was removed', () => {
    const game = createNewGame({ managerName: 'P', clubName: 'P FC', seed: 10 });
    const team = game.teams[0];
    const profile = buildProfile(team, true);
    expect(profile.starters).toHaveLength(11);
    expect(profile.attack).toBeGreaterThan(20);
    expect(profile.keeper).toBeGreaterThan(20);
    expect(buildProfile(team, true).isHome).toBe(true);
  });

  it.skipIf(typeof BroadcastChannel === 'undefined')('warns when another tab writes the career', async () => {
    const store = TestBed.inject(PersistentStore);
    const other = TestBed.runInInjectionContext(() => new PersistentStore());
    // Saves still pending from the tests before may announce themselves; let them settle first.
    await new Promise((resolve) => setTimeout(resolve, 400));
    store.externalChange.set(false);
    await other.set('pitch-legends:save:v6', '{}');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.externalChange()).toBe(true);
    // Writes of unrelated keys and of the tab itself do not raise it again.
    store.externalChange.set(false);
    await store.set('pitch-legends:save:v6', '{}');
    await other.set('pitch-legends:audio-volumes:v1', '{}');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.externalChange()).toBe(false);
  });
});
