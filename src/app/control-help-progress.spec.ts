import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ControlHelpService } from './core/services/control-help.service';
import { GameStateService } from './core/services/game-state.service';
import { defaultSettings, GameState } from './models/game.model';

describe('Control learning during live football', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    let game = { createdAt: 1, clubId: 'home', settings: defaultSettings() } as GameState;
    const mutate = vi.fn((update: (draft: GameState) => void) => update(game));
    TestBed.configureTestingModule({ providers: [{ provide: GameStateService, useValue: { game: () => game, mutate } }] });
    return { help: TestBed.inject(ControlHelpService), mutate, game: () => game, replace: () => { game = { ...game, createdAt: 2, settings: defaultSettings() }; } };
  }

  it('acknowledges the first pass immediately but saves once at a pause boundary', () => {
    const { help, mutate, game } = setup();
    help.complete('pass'); help.complete('pass'); help.setDevice('gamepad');
    expect(help.isCompleted('pass')).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
    help.flushProgress();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(game().settings.controlLearning.completedActions).toEqual(['pass']);
    expect(game().settings.controlLearning.preferredDevice).toBe('gamepad');
    help.flushProgress();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('discards unsaved learning when a different career replaces the current one', () => {
    const { help, mutate, replace } = setup();
    help.complete('pass'); help.setDevice('touch'); replace(); help.flushProgress();
    expect(help.isCompleted('pass')).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
});
