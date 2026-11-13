import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { keeperDiveTarget, keeperPositionIntent } from './core/football/keeper-ai';
import { MATCH_TUNING } from './core/football/tuning';
import { FIELD_WIDTH } from './core/football/match-types';
import { createNewGame } from './data/generators';
import { EMPTY_MATCH_COMMAND } from './models/match.model';

function autoMatch(seed: number): ArcadeMatch {
  const game = createNewGame({ managerName: 'Keeper', clubName: 'Keeper FC', seed: 52 });
  const [home, away] = game.teams;
  return new ArcadeMatch(home, away, {
    mode: 'instant', controllerMode: 'auto', seed, fixtureId: `keeper-${seed}`, controlledTeamId: home.id, halfMinutes: 3,
    difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'ai',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
  });
}

describe('Goalkeeper 2.0', () => {
  it('reaches a far corner when the shot gives him time, but not from close range', () => {
    const match = autoMatch(1);
    const keeper = match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup === 'GK')!;
    keeper.x = 2; keeper.y = FIELD_WIDTH / 2; keeper.action = 'keeper-ready';
    const shot = { shooterId: 'x', side: 'away' as const, xG: 0.1, targetY: keeper.y + 3, checkedKeeper: false };
    // 10 m out at 20 m/s towards a point 3 m beside him: half a second of flight.
    const far = { ...match.ball, ownerId: null, x: 12, y: keeper.y, z: 0.3, vx: -20, vy: 6, vz: 2.5 };
    expect(keeperDiveTarget(keeper, far, shot, 80)).not.toBeNull();
    // The same corner from 4 m: no time to get there.
    const close = { ...far, x: 6, vy: 15 };
    expect(keeperDiveTarget(keeper, close, shot, 80)).toBeNull();
    // A better keeper covers more of the goal than a poor one at the edge of the reach.
    const edge = { ...match.ball, ownerId: null, x: 8, y: keeper.y, z: 0.3, vx: -20, vy: 7.5, vz: 2.5 };
    expect(keeperDiveTarget(keeper, edge, shot, 95)).not.toBeNull();
    expect(keeperDiveTarget(keeper, edge, shot, 40)).toBeNull();
  });

  it('comes off his line when he is alone against the carrier', () => {
    const match = autoMatch(2);
    const keeper = match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup === 'GK')!;
    const ball = { ...match.ball, x: 18, y: FIELD_WIDTH / 2, z: 0, vx: 0, vy: 0, vz: 0 };
    const home = keeperPositionIntent(keeper, ball, true, 1);
    const out = keeperPositionIntent(keeper, ball, true, 1, true);
    expect(out.x).toBeGreaterThan(home.x + 3);
    expect(out.x).toBeLessThan(ball.x);
  });

  it('keeps the ball for a moment after a catch and never longer than the limit', () => {
    let holds = 0, longest = 0, shortest = Infinity;
    for (const seed of [11, 12, 13]) {
      const match = autoMatch(seed);
      let since: { id: string; tick: number } | null = null;
      for (let tick = 0; tick < 150_000 && !match.finished; tick++) {
        if (match.phase === 'halftime') match.resumeSecondHalf();
        if (match.phase === 'goalReplay') match.endReplay();
        match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
        const hold = match.football.keeperHold;
        if (hold && !since) since = { id: hold.id, tick: hold.sinceTick };
        else if (since && (!hold || hold.id !== since.id)) {
          // Only releases by the keeper himself count: a whistle or a lost ball ends a hold too.
          if (match.ball.lastTouchPlayerId === since.id && !match.ball.ownerId) {
            const seconds = (match.tick - since.tick) / 60;
            holds++; longest = Math.max(longest, seconds); shortest = Math.min(shortest, seconds);
          }
          since = hold ? { id: hold.id, tick: hold.sinceTick } : null;
        }
      }
    }
    expect(holds).toBeGreaterThan(5);
    expect(shortest).toBeGreaterThanOrEqual(0.3);
    expect(longest).toBeLessThanOrEqual(MATCH_TUNING.keeper.holdMax + 1);
  }, 60_000);
});
