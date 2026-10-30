import { createPracticeTeams } from './core/football/practice';
import { Aim, aiKeeperDive, aiShooterChoice, kickOutcome, shootoutDecided } from './core/football/shootout';
import { ArcadeMatch } from './core/services/arcade-match';
import { Rng } from './core/util';
import { MatchConfig } from './models/match.model';

function config(controlledTeamId: string, extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'play', controllerMode: 'human', controlledTeamId, halfMinutes: 3, seed: 2026, difficulty: 'normal', assist: 'balanced', knockout: true,
    playerLockId: null, weather: 'clear', inputDevice: 'keyboard', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, ...extra,
  };
}

function rate(choice: { aim: Aim; power: boolean }, dive: Aim, trials = 4000): number {
  const rng = new Rng(77);
  let scored = 0;
  for (let index = 0; index < trials; index++) if (kickOutcome(75, 70, 0, choice, dive, rng).scored) scored++;
  return scored / trials;
}

describe('Interactive penalty shoot-out', () => {
  it('lets the keeper punish a right guess and the shooter a wrong one', () => {
    const placed = { aim: -1 as Aim, power: false };
    expect(rate(placed, -1)).toBeLessThan(0.5);
    expect(rate(placed, 1)).toBeGreaterThan(0.85);
    expect(rate(placed, 0)).toBeGreaterThan(0.85);
  });

  it('trades risk for power: harder to save when guessed, but it can miss the goal', () => {
    const placed = { aim: 1 as Aim, power: false };
    const power = { aim: 1 as Aim, power: true };
    expect(rate(power, 1)).toBeGreaterThan(rate(placed, 1));
    const rng = new Rng(5);
    let over = 0;
    for (let index = 0; index < 3000; index++) if (kickOutcome(75, 70, 0, power, -1, rng).offTarget) over++;
    expect(over / 3000).toBeGreaterThan(0.06);
    expect(over / 3000).toBeLessThan(0.14);
  });

  it('keeps the AI near the old automatic conversion rate', () => {
    const rng = new Rng(9);
    let scored = 0;
    for (let index = 0; index < 6000; index++) {
      scored += kickOutcome(75, 70, 0, aiShooterChoice(rng), aiKeeperDive(rng), rng).scored ? 1 : 0;
    }
    // The automatic shoot-out converts about 0.79 for these ratings.
    expect(scored / 6000).toBeGreaterThan(0.7);
    expect(scored / 6000).toBeLessThan(0.88);
  });

  it('knows when the shoot-out is decided', () => {
    expect(shootoutDecided({ home: 3, away: 0 }, { home: 3, away: 3 }, 2, true)).toBe(true);
    expect(shootoutDecided({ home: 2, away: 2 }, { home: 3, away: 3 }, 2, true)).toBe(false);
    expect(shootoutDecided({ home: 4, away: 3 }, { home: 5, away: 5 }, 4, true)).toBe(true);
    expect(shootoutDecided({ home: 4, away: 4 }, { home: 5, away: 5 }, 4, true)).toBe(false);
    expect(shootoutDecided({ home: 5, away: 4 }, { home: 6, away: 5 }, 5, false)).toBe(false);
    expect(shootoutDecided({ home: 6, away: 5 }, { home: 6, away: 6 }, 5, true)).toBe(true);
  });

  describe('in the match', () => {
    interface Internals {
      beginInteractiveShootout(): boolean;
    }

    function drawnMatch(extra: Partial<MatchConfig> = {}) {
      const { home, away } = createPracticeTeams(131);
      const match = new ArcadeMatch(home, away, config(home.id, extra));
      return { match, internals: match as unknown as Internals, home, away };
    }

    it('waits for the player, alternates the roles and finishes with a winner', () => {
      const { match, internals } = drawnMatch();
      expect(internals.beginInteractiveShootout()).toBe(true);
      expect(match.finished).toBe(false);
      const roles: string[] = [];
      for (let guard = 0; guard < 80 && !match.finished; guard++) {
        const prompt = match.shootoutPrompt!;
        roles.push(prompt.role);
        expect(prompt.shooterSide === match.controlledSide).toBe(prompt.role === 'shoot');
        match.playShootoutKick(prompt.role === 'shoot' ? { aim: guard % 3 === 0 ? 0 : guard % 2 ? 1 : -1, power: guard % 4 === 0 } : { dive: (guard % 3) - 1 as Aim });
      }
      expect(match.finished).toBe(true);
      expect(match.shootoutPrompt).toBeNull();
      expect(roles.slice(0, 4)).toEqual(['shoot', 'dive', 'shoot', 'dive']);
      const result = match.result();
      expect(result.shootout).toBeDefined();
      const scored = { home: result.shootout!.home.filter(Boolean).length, away: result.shootout!.away.filter(Boolean).length };
      expect(scored[result.shootout!.winner]).toBeGreaterThan(scored[result.shootout!.winner === 'home' ? 'away' : 'home']);
      expect(Math.abs(result.shootout!.home.length - result.shootout!.away.length)).toBeLessThanOrEqual(1);
      expect(result.events.some((event) => event.messageKey === 'match.shootoutWinner')).toBe(true);
    });

    it('does not run for AI-played or instant matches', () => {
      expect(drawnMatch({ controllerMode: 'auto' }).internals.beginInteractiveShootout()).toBe(false);
      expect(drawnMatch({ mode: 'instant' }).internals.beginInteractiveShootout()).toBe(false);
      expect(drawnMatch({ interactiveShootout: false }).internals.beginInteractiveShootout()).toBe(false);
    });

    it('is deterministic for the same choices', () => {
      const play = () => {
        const { match, internals } = drawnMatch();
        internals.beginInteractiveShootout();
        for (let guard = 0; guard < 80 && !match.finished; guard++) {
          const prompt = match.shootoutPrompt!;
          match.playShootoutKick(prompt.role === 'shoot' ? { aim: 1, power: false } : { dive: 1 });
        }
        return match.result().shootout;
      };
      expect(play()).toEqual(play());
    });

    it('settles a shoot-out automatically when a checkpoint taken during it is restored', () => {
      const { match, internals, home, away } = drawnMatch();
      internals.beginInteractiveShootout();
      match.playShootoutKick({ aim: 1 });
      const checkpoint = match.checkpoint();
      expect(checkpoint.runtime.shootoutPending).toBe(true);
      const resumed = new ArcadeMatch(home, away, config(home.id));
      expect(resumed.restore(checkpoint)).toBe(true);
      expect(resumed.finished).toBe(true);
      expect(resumed.result().shootout).toBeDefined();
    });
  });
});
