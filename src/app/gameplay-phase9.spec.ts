import { createPracticeTeams } from './core/football/practice';
import { tacticalIntent } from './core/football/tactical-intent';
import { ArcadeActor, MATCH_TICK } from './core/football/match-types';
import { ArcadeMatch } from './core/services/arcade-match';
import { MatchConfig } from './models/match.model';

function config(controlledTeamId: string, seed: number): MatchConfig {
  return {
    mode: 'instant', controllerMode: 'auto', controlledTeamId, halfMinutes: 3, seed, difficulty: 'normal', assist: 'balanced',
    playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
  };
}

describe('Phase 9 gameplay: offside runs, safer passing, seeded ties', () => {
  function striker(match: ArcadeMatch): ArcadeActor {
    return match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup === 'ATT')!;
  }

  it('lets attackers hover beyond the last defender now and then, never when told to hold position', () => {
    const { home, away } = createPracticeTeams(61);
    const match = new ArcadeMatch(home, away, config(home.id, 61));
    const actor = striker(match);
    const owner = match.actors.find((candidate) => candidate.side === 'home' && candidate.player.positionGroup === 'MID')!;
    match.ball.x = 60; match.ball.y = 34; match.ball.ownerId = owner.player.id;
    owner.x = 60; owner.y = 34;
    const defenders = match.actors.filter((candidate) => candidate.side === 'away' && candidate.player.positionGroup !== 'GK');
    defenders.forEach((defender, index) => { defender.x = 80; defender.y = 10 + index * 4; });
    const slot = match.home.formation.slots.find((entry) => entry.playerId === actor.player.id)!;
    const depths: number[] = [];
    for (let tick = 0; tick < 2000; tick += 100) {
      const intent = tacticalIntent(actor, owner, match.ball, match.actors, match.home, 1, tick);
      depths.push(intent.x);
    }
    expect(depths.some((x) => x > 79)).toBe(true);
    expect(depths.some((x) => x <= 79)).toBe(true);
    expect(depths).toEqual(Array.from({ length: 20 }, (_, index) => tacticalIntent(actor, owner, match.ball, match.actors, match.home, 1, index * 100).x));

    slot.instruction.forwardRuns = 'rarely';
    for (let tick = 0; tick < 2000; tick += 100) expect(tacticalIntent(actor, owner, match.ball, match.actors, match.home, 1, tick).x).toBeLessThanOrEqual(79);
    slot.instruction.forwardRuns = 'often';
    slot.instruction.stayInPosition = true;
    for (let tick = 0; tick < 2000; tick += 100) expect(tacticalIntent(actor, owner, match.ball, match.actors, match.home, 1, tick).x).toBeLessThanOrEqual(79);
  });

  it('produces a realistic number of offsides over many matches', () => {
    let offsides = 0;
    const matches = 24;
    for (let index = 0; index < matches; index++) {
      const { home, away } = createPracticeTeams(70 + index);
      const result = new ArcadeMatch(home, away, config(home.id, 900 + index)).result();
      offsides += result.homeStats.offsides + result.awayStats.offsides;
    }
    expect(offsides / matches).toBeGreaterThan(0.8);
    expect(offsides / matches).toBeLessThan(4);
  }, 120_000);

  it('settles equal ball-control distances by a fixed pseudo-random order', () => {
    const { home, away } = createPracticeTeams(62);
    const match = new ArcadeMatch(home, away, config(home.id, 62));
    const internals = match as unknown as { tieOrder(actor: ArcadeActor): number };
    const [first, second] = match.actors;
    expect(internals.tieOrder(first)).toBe(internals.tieOrder(first));
    expect(internals.tieOrder(first)).not.toBe(internals.tieOrder(second));
    const before = internals.tieOrder(first);
    for (let tick = 0; tick < 3; tick++) match.step(MATCH_TICK);
    expect(internals.tieOrder(first)).not.toBe(before);
    const order = (list: ArcadeActor[]) => [...list].sort((a, b) => internals.tieOrder(a) - internals.tieOrder(b)).map((actor) => actor.player.id);
    expect(order(match.actors)).toEqual(order([...match.actors].reverse()));
  });

  it('completes clearly more of its passes than before and stays deterministic', () => {
    const run = () => {
      const { home, away } = createPracticeTeams(63);
      return new ArcadeMatch(home, away, config(home.id, 63)).result();
    };
    const first = run();
    expect({ ...run(), id: undefined }).toEqual({ ...first, id: undefined });
    let attempted = 0;
    let completed = 0;
    for (let index = 0; index < 12; index++) {
      const { home, away } = createPracticeTeams(80 + index);
      const result = new ArcadeMatch(home, away, config(home.id, 700 + index)).result();
      attempted += result.homeStats.passesAttempted + result.awayStats.passesAttempted;
      completed += result.homeStats.passesCompleted + result.awayStats.passesCompleted;
    }
    expect(completed / attempted).toBeGreaterThan(0.6);
  }, 120_000);
});
