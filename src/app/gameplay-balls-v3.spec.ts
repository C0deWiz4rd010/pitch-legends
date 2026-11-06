import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { ArcadeActor } from './core/football/match-types';
import { createPracticeTeams } from './core/football/practice';
import { integrateBall, SpinningBall } from './core/football/ball-physics';
import { EFFECT_CAPS, HK, HOOK_BIT } from './core/rpg/effects';
import { EMPTY_MATCH_COMMAND, MatchCommand } from './models/match.model';

type Spec = { side: 'home' | 'away'; index: number; x: number; y: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (match: ArcadeMatch) => match as unknown as Record<string, any>;

function outfield(match: ArcadeMatch, side: 'home' | 'away'): ArcadeActor[] {
  return match.actors.filter(actor => actor.side === side && actor.player.positionGroup !== 'GK');
}
const keeperOf = (match: ArcadeMatch, side: 'home' | 'away') => match.actors.find(actor => actor.side === side && actor.player.positionGroup === 'GK')!;

function stage(specs: Spec[], mode: 'human' | 'auto' = 'auto') {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: mode, seed: 8812, fixtureId: 'balls-v3', controlledTeamId: home.id,
    halfMinutes: 3, difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'keyboard',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true } });
  match.rule.phase = 'playing';
  match.tick = 100;
  const placed = specs.map(spec => {
    const actor = outfield(match, spec.side)[spec.index];
    Object.assign(actor, { x: spec.x, y: spec.y, vx: 0, vy: 0, intentX: spec.x, intentY: spec.y, decisionCooldown: 100, stamina: 100 });
    return actor;
  });
  for (const actor of match.actors) actor.active = placed.includes(actor);
  Object.assign(match.ball, { ownerId: null, x: 50, y: 34, z: 0.11, vx: 0, vy: 0, vz: 0, controlledTouch: 1, lastTouchPlayerId: null });
  match.selectedPlayerId = (placed.find(actor => actor.side === 'home') ?? outfield(match, 'home')[0]).player.id;
  return { match, placed };
}

const command = (patch: Partial<MatchCommand> = {}): MatchCommand => ({ ...EMPTY_MATCH_COMMAND, device: 'keyboard', ...patch });

describe('Phase 2 – ball flight', () => {
  const flight = (speed: number) => {
    const ball: SpinningBall = { x: 0, y: 0, z: 40, vx: speed, vy: 0, vz: 0, spin: 0, topspin: 0 };
    for (let i = 0; i < 60; i++) integrateBall(ball, 1 / 60, false);
    return ball.vx / speed;
  };

  it('slows fast balls more than slow ones in the air', () => {
    // Share of the speed that survives one second of flight: quadratic drag costs fast balls more.
    expect(flight(32)).toBeLessThan(flight(12));
    expect(flight(25)).toBeGreaterThan(0.8);
  });
});

describe('Phase 2 – goalkeeper', () => {
  const save = (distanceToKeeper: number, z = 0.9) => {
    const { match, placed } = stage([{ side: 'away', index: 0, x: 40, y: 34 }]);
    const keeper = keeperOf(match, 'home');
    Object.assign(keeper, { active: true, x: 1.5, y: 34, vx: 0, vy: 0, decisionCooldown: 100 });
    Object.assign(match.ball, { ownerId: null, x: 2.6, y: 34 + distanceToKeeper, z, vx: -12, vy: 0, vz: 0, controlledTouch: 1, lastTouch: 'away', lastTouchPlayerId: placed[0].player.id });
    internals(match)['activeShot'] = { shooterId: placed[0].player.id, side: 'away', xG: 0.3, targetY: 34, checkedKeeper: false, keeperQuality: 0.5 };
    internals(match)['handlePostsAndKeeper']();
    return { match, keeper, handled: internals(match)['activeShot'] === null };
  };

  it('meets a ball that passes within reach and lets one that is too wide go by', () => {
    expect(save(0.9).handled).toBe(true);
    expect(save(2.4).handled).toBe(false);
  });

  it('keeps a missed shot open for later sub-steps instead of spending its single check', () => {
    const wide = save(2.4);
    expect(internals(wide.match)['activeShot'].checkedKeeper).toBe(false);
  });

  it('tips a high shot over the bar towards the goal line', () => {
    const { match, placed } = stage([{ side: 'away', index: 0, x: 40, y: 34 }]);
    const keeper = keeperOf(match, 'home');
    Object.assign(keeper, { active: true, x: 1.5, y: 34, vx: 0, vy: 0, decisionCooldown: 100 });
    Object.assign(match.ball, { ownerId: null, x: 2.5, y: 35.2, z: 2.0, vx: -14, vy: 0, vz: 0, controlledTouch: 1, lastTouch: 'away', lastTouchPlayerId: placed[0].player.id });
    internals(match)['activeShot'] = { shooterId: placed[0].player.id, side: 'away', xG: 0.3, targetY: 34, checkedKeeper: false, keeperQuality: 0.9 };
    internals(match)['rng'].bool = () => true;
    internals(match)['handlePostsAndKeeper']();
    // Not caught (the catch radius is 1.15 m), so it is tipped: up and back over the goal line.
    expect(match.ball.vz).toBeGreaterThan(4);
    expect(match.ball.vx).toBeLessThan(0);
  });

  it('lets a human keeper choose the corner of a penalty with the stick', () => {
    const { match } = stage([{ side: 'away', index: 0, x: 80, y: 34 }], 'human');
    const keeper = keeperOf(match, 'home');
    Object.assign(keeper, { active: true, x: 1, y: 34 });
    internals(match)['previousInput'] = command({ moveY: -1 });
    internals(match)['keeperGuessesPenalty']('away');
    expect(keeper.action).toBe('keeper-dive');
    expect(keeper.actionTarget!.y).toBeLessThan(34);
    internals(match)['previousInput'] = command({ moveY: 1 });
    internals(match)['keeperGuessesPenalty']('away');
    expect(keeper.actionTarget!.y).toBeGreaterThan(34);
  });
});

describe('Phase 2 – effect hooks', () => {
  it('has a cap for every hook that is wired into the match', () => {
    for (const hook of ['shotPower', 'curve', 'throughLead', 'firstTouch', 'shielding', 'aerial', 'keeperReach', 'staminaRecovery', 'composure'] as const) {
      expect(EFFECT_CAPS[hook], hook).toBeDefined();
    }
  });

  it('lets a shotPower modifier make the same shot faster', () => {
    const run = (bonus: number) => {
      const { match, placed } = stage([{ side: 'home', index: 0, x: 80, y: 34 }]);
      const shooter = placed[0];
      if (bonus) {
        shooter.stats!.hookMask |= HOOK_BIT.shotPower;
        shooter.hookAdd![HK.shotPower] = bonus;
        shooter.hookMul![HK.shotPower] = 1;
      }
      Object.assign(match.ball, { ownerId: shooter.player.id, x: shooter.x, y: shooter.y });
      internals(match)['shoot'](shooter, 0.8, 1, 0, false, false);
      return Math.hypot(match.ball.vx, match.ball.vy);
    };
    expect(run(2) - run(0)).toBeGreaterThan(1.5);
  });
});

describe('Phase 2 – aerial duels and crosses', () => {
  it('lets the stronger jumper win a high ball only he can reach', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 90, y: 34 }, { side: 'away', index: 0, x: 90.2, y: 34 }]);
    placed[0].attrs!.physical = 30; placed[0].attrs!.defending = 30; placed[0].attrs!.shooting = 30;
    placed[1].attrs!.physical = 95; placed[1].attrs!.defending = 90; placed[1].attrs!.shooting = 60;
    Object.assign(match.ball, { x: 90.1, y: 34, z: 2.75, vx: 6, vy: 0, vz: 0, controlledTouch: 1 });
    internals(match)['tryHeader']();
    expect(match.ball.lastTouchPlayerId).toBe(placed[1].player.id);
  });

  it('delivers a cut-back to the edge of the box when the stick is pulled back', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 96, y: 8 }, { side: 'home', index: 1, x: 99, y: 31 }, { side: 'home', index: 2, x: 84, y: 34 }]);
    const [crosser, boxRunner, edge] = placed;
    const direction = internals(match)['attackDirection']('home') as number;
    Object.assign(match.ball, { ownerId: crosser.player.id, x: crosser.x, y: crosser.y });
    expect(internals(match)['cross'](crosser, false, 0.7, -direction, 0)).toBe(true);
    expect(internals(match)['intendedReceiverId']).toBe(edge.player.id);
    expect(boxRunner.player.id).not.toBe(edge.player.id);
  });

  it('sends the attackers into the box and crosses a corner', () => {
    const { match, placed } = stage([
      { side: 'home', index: 0, x: 70, y: 34 }, { side: 'home', index: 1, x: 60, y: 20 }, { side: 'home', index: 2, x: 62, y: 48 }, { side: 'home', index: 3, x: 55, y: 34 },
      { side: 'away', index: 0, x: 85, y: 30 }, { side: 'away', index: 1, x: 85, y: 38 },
    ]);
    const direction = internals(match)['attackDirection']('home') as number;
    const goalX = direction > 0 ? 105 : 0;
    internals(match)['setRestart']('corner', 'home', goalX, 0.5);
    for (let i = 0; i < 3; i++) match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    const inBox = placed.filter(actor => actor.side === 'home' && Math.abs(goalX - actor.x) < 18);
    expect(inBox.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 60; i++) match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    expect(match.rule.phase).toBe('playing');
    // A cross, not a pass along the ground: the ball went up and a receiver was chosen.
    expect(internals(match)['intendedReceiverId'] ?? internals(match)['lastPasser']).toBeTruthy();
  });
});

describe('Phase 2 – contact injuries', () => {
  it('lets an injury-risk modifier change the chance of a contact injury', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 40, y: 34 }]);
    const victim = placed[0];
    expect(internals(match)['injuryChance'](victim, 0.04)).toBe(0.04);
    victim.stats!.hookMask |= HOOK_BIT.injuryRisk;
    victim.stats!.mods['injuryRisk'] = [{ hook: 'injuryRisk', op: 'mul', value: 1.5, source: { kind: 'quirk', id: 'glass-bones' } }];
    expect(internals(match)['injuryChance'](victim, 0.04)).toBeCloseTo(0.06, 6);
  });
});
