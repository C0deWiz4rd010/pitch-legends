import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { ArcadeActor } from './core/football/match-types';
import { createPracticeTeams } from './core/football/practice';
import { EMPTY_MATCH_COMMAND, MatchCommand } from './models/match.model';

type Spec = { side: 'home' | 'away'; index: number; x: number; y: number };

/** Direct access to engine internals for scenario set-up; the tests exercise behaviour, not the API. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (match: ArcadeMatch) => match as unknown as Record<string, any>;

function outfield(match: ArcadeMatch, side: 'home' | 'away'): ArcadeActor[] {
  return match.actors.filter(actor => actor.side === side && actor.player.positionGroup !== 'GK');
}

function stage(specs: Spec[], mode: 'human' | 'auto' = 'human') {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: mode, seed: 7771, fixtureId: 'feel-v3', controlledTeamId: home.id,
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
  match.selectedPlayerId = placed.find(actor => actor.side === 'home')!.player.id;
  return { match, placed };
}

const command = (patch: Partial<MatchCommand> = {}): MatchCommand => ({ ...EMPTY_MATCH_COMMAND, device: 'keyboard', ...patch });

describe('Phase 1 – bug fixes', () => {
  it('damps a mishandled cross-field ball along its own direction of travel', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 50, y: 34 }]);
    Object.assign(match.ball, { x: 50.3, y: 34, vx: 0, vy: 12 });
    internals(match)['rng'].bool = () => false;
    internals(match)['tryBallControl']();
    expect(placed[0].action).toBe('heavy-touch');
    // Before the fix only vx was halved, so a ball travelling along y kept its full 12 m/s.
    expect(Math.hypot(match.ball.vx, match.ball.vy)).toBeLessThan(9);
  });

  it('lets a defender in tackling range tackle instead of also sending the keeper out', () => {
    const run = (gap: number) => {
      const { match, placed } = stage([{ side: 'home', index: 0, x: 8, y: 34 }, { side: 'away', index: 0, x: 8 + gap, y: 34 }]);
      const keeper = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'GK')!;
      Object.assign(keeper, { active: true, x: 3, y: 34, intentX: 3, intentY: 34, decisionCooldown: 100 });
      const carrier = placed[1];
      Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
      match.step(MATCH_TICK, command({ through: true, keeperRush: true }));
      return keeper.action;
    };
    expect(run(1)).not.toBe('keeper-rush');
    expect(run(9)).toBe('keeper-rush');
  });

  it('gives the nearest player the header, whatever the order of the player list', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 50.55, y: 34 }, { side: 'away', index: 0, x: 50.15, y: 34 }]);
    Object.assign(match.ball, { x: 50, y: 34, z: 1.9, vx: 6, vy: 0, vz: 0, controlledTouch: 1 });
    internals(match)['tryHeader']();
    expect(match.ball.lastTouchPlayerId).toBe(placed[1].player.id);
  });

  it('leads a through ball along the runner\'s own path instead of only towards goal', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 40, y: 34 }, { side: 'home', index: 1, x: 46, y: 30 }]);
    const [passer, runner] = placed;
    runner.vx = 0; runner.vy = 6;
    Object.assign(match.ball, { ownerId: passer.player.id, x: passer.x, y: passer.y });
    internals(match)['pass'](passer, true, false, 0.8, runner.x - passer.x, runner.y - passer.y);
    // The runner moves to larger y; the old goal-axis lead would have sent the ball towards y = 30.
    expect(match.ball.vy).toBeGreaterThan(0);
  });

  it('gives a defender only one try at a pass in flight', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 30, y: 34 }, { side: 'away', index: 0, x: 60, y: 34 }]);
    const [passer, defender] = placed;
    Object.assign(match.ball, { ownerId: null, x: 60.2, y: 34, z: 0.11, vx: -10, vy: 0, controlledTouch: 1, lastTouchPlayerId: passer.player.id });
    const inFlight = () => Object.assign(internals(match), { lastPasser: { id: passer.player.id, side: 'home', at: 5 } });
    internals(match)['football'].interceptTried = [];
    let rolls = 0;
    const rng = internals(match)['rng'];
    const original = rng.bool.bind(rng);
    rng.bool = (p: number) => { rolls++; return original(p); };
    for (let i = 0; i < 6; i++) { inFlight(); Object.assign(match.ball, { ownerId: null, x: 60.2 }); internals(match)['tryBallControl'](); }
    expect(internals(match)['football'].interceptTried).toEqual([defender.player.id]);
    expect(rolls).toBeLessThanOrEqual(1);
  });

  it('lets an open-field AI carrier sprint', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 30, y: 34 }, { side: 'away', index: 0, x: 90, y: 10 }], 'auto');
    const carrier = placed[0];
    Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
    carrier.decisionCooldown = 0;
    let fastest = 0;
    for (let i = 0; i < 90; i++) {
      match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
      fastest = Math.max(fastest, Math.hypot(carrier.vx, carrier.vy));
    }
    expect(fastest).toBeGreaterThan(5.8);
  });

  it('makes endurance matter and lets a standing player recover', () => {
    const drain = (endurance: number) => {
      const { match, placed } = stage([{ side: 'home', index: 0, x: 30, y: 34 }]);
      placed[0].attrs!.stamina = endurance;
      for (let i = 0; i < 300; i++) internals(match)['moveActor'](placed[0], 1, 0, true, MATCH_TICK);
      return 100 - placed[0].stamina;
    };
    expect(drain(90)).toBeLessThan(drain(30));
    const { match, placed } = stage([{ side: 'home', index: 0, x: 30, y: 34 }]);
    placed[0].stamina = 50;
    for (let i = 0; i < 600; i++) internals(match)['moveActor'](placed[0], 0, 0, false, MATCH_TICK);
    expect(placed[0].stamina).toBeGreaterThan(50);
  });

  it('keeps a human restart waiting for the kick for eight seconds', () => {
    const { match } = stage([{ side: 'home', index: 0, x: 50, y: 34 }, { side: 'away', index: 0, x: 60, y: 34 }]);
    internals(match)['setRestart']('freeKick', 'home', 50, 34);
    for (let i = 0; i < 4 * 60; i++) match.step(MATCH_TICK, command());
    expect(match.rule.phase).toBe('freeKick');
    for (let i = 0; i < 5 * 60; i++) match.step(MATCH_TICK, command());
    expect(match.rule.phase).toBe('playing');
  });
});

describe('Phase 1 – control and reaction', () => {
  it('takes a controlled first touch where the stick points', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 50, y: 34 }]);
    const receiver = placed[0];
    Object.assign(match.ball, { x: 50.2, y: 34, vx: 0, vy: 0, controlledTouch: 1 });
    receiver.facingX = 1; receiver.facingY = 0;
    internals(match)['rng'].bool = () => true;
    internals(match)['previousInput'] = command({ moveX: 0, moveY: -1 });
    internals(match)['tryBallControl']();
    expect(match.ball.ownerId).toBe(receiver.player.id);
    expect(receiver.facingY).toBeLessThan(-0.5);
    expect(match.ball.vy).toBeLessThan(0);
  });

  it('selects the receiver the moment a human pass leaves', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 40, y: 34 }, { side: 'home', index: 1, x: 48, y: 34 }]);
    const [passer, receiver] = placed;
    Object.assign(match.ball, { ownerId: passer.player.id, x: passer.x, y: passer.y });
    const aim = { aimX: match.currentAttackDirection, aimY: 0 };
    for (let i = 0; i < 10; i++) match.step(MATCH_TICK, command({ pass: true, ...aim }));
    expect(match.selectedPlayerId).toBe(passer.player.id);
    match.step(MATCH_TICK, command(aim));
    // No 12-tick wait: the stick already steers the receiver.
    expect(match.ball.ownerId).toBeNull();
    expect(match.selectedPlayerId).toBe(receiver.player.id);
  });

  it('switches to the defender best placed against a far-away carrier', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 20, y: 34 }, { side: 'home', index: 1, x: 58, y: 34 }, { side: 'away', index: 0, x: 60, y: 34 }]);
    const carrier = placed[2];
    const own = internals(match)['attackDirection']('home') > 0 ? -1 : 1;
    // Put the near defender between the carrier and the own goal.
    placed[1].x = 60 + own * 2;
    Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
    match.selectedPlayerId = placed[0].player.id;
    for (let i = 0; i < 30; i++) match.step(MATCH_TICK, command());
    expect(match.selectedPlayerId).toBe(placed[1].player.id);
  });

  it('picks the team-mate in the direction of a right-stick flick', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 40, y: 34 }, { side: 'home', index: 1, x: 40, y: 18 }, { side: 'home', index: 2, x: 40, y: 50 }]);
    const [selected, up, down] = placed;
    match.selectedPlayerId = selected.player.id;
    match.step(MATCH_TICK, command({ pickY: -1 }));
    expect(match.selectedPlayerId).toBe(up.player.id);
    match.step(MATCH_TICK, command());
    match.selectedPlayerId = selected.player.id;
    internals(match)['football'].selectionUntilTick = 0;
    match.step(MATCH_TICK, command({ pickY: 1 }));
    expect(match.selectedPlayerId).toBe(down.player.id);
  });
});

describe('Phase 1 – actions cost something', () => {
  const duel = () => {
    const stagedDuel = stage([{ side: 'home', index: 0, x: 40, y: 34 }, { side: 'away', index: 0, x: 41.2, y: 34 }]);
    const [defender, carrier] = stagedDuel.placed;
    Object.assign(stagedDuel.match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
    defender.facingX = 1; defender.facingY = 0;
    return { ...stagedDuel, defender, carrier };
  };

  it('slows a defender who missed a standing tackle', () => {
    const { match, defender } = duel();
    internals(match)['rng'].bool = () => false;
    internals(match)['attemptTackle'](defender, false);
    const until = internals(match)['football'].recoveryUntil?.[defender.player.id];
    expect(until).toBeGreaterThan(match.tick);
  });

  it('lets a slide start from further out, carries the body forward and keeps it slow afterwards', () => {
    const { match, defender, carrier } = duel();
    carrier.x = 42.8; match.ball.x = 42.8;
    internals(match)['rng'].bool = () => false;
    internals(match)['attemptTackle'](defender, true);
    expect(defender.action).toBe('slide');
    expect(defender.vx).toBeGreaterThan(4);
    expect(internals(match)['football'].recoveryUntil[defender.player.id]).toBeGreaterThanOrEqual(match.tick + 40);
    // Beyond the lunge reach nothing happens at all.
    const far = duel();
    far.carrier.x = 44; far.match.ball.x = 44;
    internals(far.match)['attemptTackle'](far.defender, true);
    expect(far.defender.action).not.toBe('slide');
  });

  it('only wrong-foots the defenders the carrier actually beats, and loses the ball against one who reads it', () => {
    const beaten = duel();
    internals(beaten.match)['rng'].bool = () => true;
    internals(beaten.match)['performSkill'](beaten.carrier, 1, 0);
    expect(beaten.defender.tackleCooldown).toBeGreaterThan(0);

    const read = duel();
    internals(read.match)['rng'].bool = () => false;
    internals(read.match)['performSkill'](read.carrier, 1, 0);
    expect(read.carrier.action).toBe('skill-failed');
    expect(read.match.ball.ownerId).toBeNull();
  });

  it('plants the body for a moment after a pass', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 40, y: 34 }, { side: 'home', index: 1, x: 48, y: 34 }]);
    const [passer] = placed;
    Object.assign(match.ball, { ownerId: passer.player.id, x: passer.x, y: passer.y });
    internals(match)['pass'](passer, false, false, 0.5, 1, 0);
    expect(internals(match)['football'].recoveryUntil[passer.player.id]).toBeGreaterThan(match.tick);
  });

  it('lets a human carrier shield the ball: slower, and harder to tackle', () => {
    const run = (shield: boolean) => {
      const { match, placed } = stage([{ side: 'home', index: 0, x: 40, y: 34 }]);
      const carrier = placed[0];
      Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
      for (let i = 0; i < 60; i++) match.step(MATCH_TICK, command({ moveX: 1, aimX: 1, sprint: true, jockey: shield }));
      return Math.hypot(carrier.vx, carrier.vy);
    };
    expect(run(true)).toBeLessThan(run(false) * 0.8);
  });
});
