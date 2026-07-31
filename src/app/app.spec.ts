import { computeOverall } from './core/ratings';
import { Rng } from './core/util';
import { createNewGame } from './data/generators';
import { MatchEngineService } from './core/services/match-engine.service';

describe('ratings', () => {
  it('computes a goalkeeper overall dominated by goalkeeping', () => {
    const attrs = {
      pace: 40,
      shooting: 20,
      passing: 55,
      dribbling: 40,
      defending: 45,
      physical: 60,
      stamina: 55,
      goalkeeping: 88,
    };
    const overall = computeOverall(attrs, 'GK');
    expect(overall).toBeGreaterThan(70);
    expect(overall).toBeLessThanOrEqual(99);
  });
});

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
});

describe('match engine', () => {
  it('produces a deterministic, valid result for a given seed', () => {
    const game = createNewGame({ managerName: 'Test', clubName: 'Test FC', seed: 42 });
    const [home, away] = game.teams;
    const engine = new MatchEngineService();
    const r1 = engine.simulate(home, away, 1, 999);
    const r2 = engine.simulate(home, away, 1, 999);
    expect(r1.homeScore).toBe(r2.homeScore);
    expect(r1.awayScore).toBe(r2.awayScore);
    expect(r1.homeScore).toBeGreaterThanOrEqual(0);
    expect(r1.events.length).toBeGreaterThan(0);
    expect(r1.homeStats.possession + r1.awayStats.possession).toBe(100);
  });
});

