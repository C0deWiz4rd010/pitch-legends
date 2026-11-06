import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { ACTION_CONTACT_TICKS } from './core/football/action-timing';
import { BALL_RADIUS } from './core/football/ball-physics';
import { ArcadeActor, FIELD_WIDTH } from './core/football/match-types';
import { EMPTY_MATCH_COMMAND, MatchCommand } from './models/match.model';

/** Home attacks towards +x in the first half. */
function scene(seed = 404) {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: 'human', controlledTeamId: home.id, seed, assist: 'balanced', halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'keyboard', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true } });
  match.tick = 100;
  match.rule = { ...match.rule, phase: 'playing', restartSide: null, elapsed: 0 };
  match.phase = 'firstHalf';
  return match;
}
function tick(match: ArcadeMatch, command: Partial<MatchCommand> = {}, count = 1) {
  for (let i = 0; i < count; i++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, device: 'keyboard', ...command });
}
function isolate(match: ArcadeMatch, keep: ArcadeActor[]) {
  for (const actor of match.actors) if (!keep.includes(actor)) actor.active = false;
}
function giveBall(match: ArcadeMatch, actor: ArcadeActor) {
  Object.assign(match.ball, { x: actor.x + actor.facingX * .5, y: actor.y + actor.facingY * .5, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, ownerId: actor.player.id, lastTouch: actor.side, lastTouchPlayerId: actor.player.id, controlledTouch: 0 });
}
function selected(match: ArcadeMatch) {
  const actor = match.actors.find(item => item.player.id === match.selectedPlayerId)!;
  match.config.playerLockId = actor.player.id;
  return actor;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Hidden {
  football: any;
  callFoul: (...args: any[]) => void;
  setRestart: (...args: any[]) => void;
  shoot: (...args: any[]) => void;
  attemptTackle: (...args: any[]) => void;
}
const internals = (match: ArcadeMatch) => match as unknown as Hidden;

/** A passer with the ball and a runner ahead, everybody else out of the way. */
function passScene(seed = 404) {
  const match = scene(seed);
  const passer = selected(match);
  const runner = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'ATT' && actor !== passer)!;
  isolate(match, [passer, runner]);
  Object.assign(passer, { x: 40, y: 34, facingX: 1, facingY: 0 });
  Object.assign(runner, { x: 55, y: 34, vx: 0, vy: 0, decisionCooldown: 99, intentX: 55, intentY: 34 });
  giveBall(match, passer);
  return { match, passer, runner };
}

describe('Phase 8 follow-up – wind-up between release and ball contact', () => {
  it('starts the pass at the release and strikes the ball exactly at the contact tick', () => {
    const { match, passer } = passScene();
    tick(match, { pass: true, aimX: 1 }, 20);
    tick(match, { aimX: 1 });
    const contact = ACTION_CONTACT_TICKS.pass!;
    expect(passer.action).toBe('pass');
    expect(match.ball.ownerId).toBe(passer.player.id);
    expect(internals(match).football.pendingKick?.contactTick).toBe(passer.actionStartedTick + contact);
    expect(internals(match).football.pendingKick?.startTick).toBe(passer.actionStartedTick);
    tick(match, { aimX: 1 }, contact - 1);
    expect(match.ball.ownerId).toBe(passer.player.id);
    tick(match, { aimX: 1 }, 2);
    expect(match.ball.ownerId).toBeNull();
    expect(Math.hypot(match.ball.vx, match.ball.vy)).toBeGreaterThan(5);
    expect(internals(match).football.pendingKick).toBeNull();
  });

  it('winds up longer for a shot than for a pass', () => {
    expect(ACTION_CONTACT_TICKS.shot!).toBeGreaterThan(ACTION_CONTACT_TICKS.pass!);
    expect(ACTION_CONTACT_TICKS['bicycle-kick']!).toBeGreaterThan(ACTION_CONTACT_TICKS.volley!);
    const match = scene();
    const shooter = selected(match);
    isolate(match, [shooter]);
    Object.assign(shooter, { x: 85, y: 34, facingX: 1, facingY: 0 });
    giveBall(match, shooter);
    tick(match, { shoot: true, aimX: 1 }, 30);
    tick(match, { aimX: 1 });
    expect(shooter.action).toBe('shot');
    expect(match.ball.ownerId).toBe(shooter.player.id);
    tick(match, { aimX: 1 }, ACTION_CONTACT_TICKS.shot! + 1);
    expect(match.ball.ownerId).toBeNull();
    expect(match.ball.vx).toBeGreaterThan(8);
  });

  it('loses the strike when the ball is won in the wind-up', () => {
    const { match, passer, runner } = passScene();
    tick(match, { pass: true, aimX: 1 }, 20);
    tick(match, { aimX: 1 });
    // A defender takes the ball during the wind-up.
    const thief = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'DEF')!;
    thief.active = true;
    Object.assign(thief, { x: 40.5, y: 34, decisionCooldown: 99, intentX: 40.5, intentY: 34 });
    match.ball.ownerId = thief.player.id;
    tick(match, { aimX: 1 }, ACTION_CONTACT_TICKS.pass! + 2);
    expect(internals(match).football.pendingKick).toBeNull();
    expect(match.ball.ownerId === thief.player.id || match.ball.ownerId === null).toBe(true);
    expect(match.ball.lastTouchPlayerId).not.toBe(passer.player.id);
    expect(runner.active).toBe(true);
  });

  it('plays the AI kicks with the same wind-up: the kicker keeps the ball until the contact tick', () => {
    const { home, away } = createPracticeTeams();
    const match = new ArcadeMatch(home, away, { mode: 'instant', controllerMode: 'auto', controlledTeamId: home.id, seed: 4242, assist: 'balanced', halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true } });
    let observed = 0, waiting = 0;
    for (let i = 0; i < 12_000 && !match.finished; i++) {
      if (match.phase === 'halftime') match.resumeSecondHalf();
      if (match.phase === 'goalReplay') match.endReplay();
      match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
      const kick = internals(match).football.pendingKick;
      if (!kick) continue;
      observed++;
      expect(kick.contactTick - kick.startTick).toBeLessThanOrEqual(12);
      if (['pass', 'shoot', 'cross'].includes(kick.type)) {
        waiting++;
        // The ball is not yet away: it is still with the kicker, or a tackle has just taken it (the strike is then dropped next tick).
        const owner = match.actors.find((actor) => actor.player.id === match.ball.ownerId);
        expect(!owner || owner.player.id === kick.actorId || owner.side !== match.actors.find((actor) => actor.player.id === kick.actorId)!.side).toBe(true);
      }
    }
    expect(observed).toBeGreaterThan(20);
    expect(waiting).toBeGreaterThan(10);
  });
});

describe('Phase 8 follow-up – new actions', () => {
  it('hits a sharp pass harder and flatter than a normal one', () => {
    const speeds = [false, true].map(modifier => {
      const { match } = passScene();
      tick(match, { pass: true, aimX: 1, modifier }, 18);
      tick(match, { aimX: 1, modifier }, ACTION_CONTACT_TICKS.pass! + 1);
      return { speed: Math.hypot(match.ball.vx, match.ball.vy), vz: match.ball.vz };
    });
    expect(speeds[1].speed).toBeGreaterThan(speeds[0].speed * 1.15);
    expect(speeds[1].vz).toBeLessThan(0.15);
  });

  it('fakes a shot with the modifier: the ball stays, the action is a feint and close defenders may bite', () => {
    const match = scene();
    const shooter = selected(match);
    const defender = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'DEF')!;
    isolate(match, [shooter, defender]);
    Object.assign(shooter, { x: 85, y: 34, facingX: 1, facingY: 0 });
    Object.assign(defender, { x: 87.6, y: 34, decisionCooldown: 99, intentX: 87.6, intentY: 34, tackleCooldown: 0 });
    giveBall(match, shooter);
    tick(match, { shoot: true, aimX: 1, modifier: true }, 25);
    tick(match, { aimX: 1, modifier: true });
    expect(shooter.action).toBe('fake-shot');
    tick(match, { aimX: 1 }, 10);
    expect(match.ball.ownerId).toBe(shooter.player.id);
  });

  it('cancels a pass during the wind-up with the modifier', () => {
    const { match, passer } = passScene();
    tick(match, { pass: true, aimX: 1 }, 20);
    tick(match, { aimX: 1 });
    expect(internals(match).football.pendingKick).not.toBeNull();
    tick(match, { aimX: 1, modifier: true });
    tick(match, { aimX: 1 }, ACTION_CONTACT_TICKS.pass! + 2);
    expect(match.ball.ownerId).toBe(passer.player.id);
    expect(internals(match).football.pendingKick).toBeNull();
  });

  it('sends the most advanced team-mate on a run in behind when a run is requested', () => {
    const { match, passer, runner } = passScene();
    tick(match, { aimX: 1 });
    expect(internals(match).football.runRequest).toBeFalsy();
    tick(match, { request: true });
    const request = internals(match).football.runRequest;
    expect(request.id).toBe(runner.player.id);
    expect(request.side).toBe(passer.side);
    // The runner heads for the space behind the line of the last defender.
    const before = runner.x;
    runner.decisionCooldown = 0;
    tick(match, {}, 30);
    expect(runner.x).toBeGreaterThan(before + 1);
    // The request lapses after about two seconds.
    tick(match, {}, 130);
    expect(internals(match).football.runRequest).toBeNull();
  });

  it('holds a yellow card back during an advantage and shows it at the next stoppage', () => {
    const match = scene();
    const defender = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'DEF')!;
    const victim = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'MID')!;
    Object.assign(victim, { x: 50, y: 34, vx: 5, vy: 0 });
    Object.assign(defender, { x: 50.5, y: 34 });
    defender.card = 'none';
    const yellowsBefore = match.awayStats.yellows;
    // Call fouls until one is a yellow that is held back (the roll depends on the speed and the seed).
    let held = false;
    for (let attempt = 0; attempt < 400 && !held; attempt++) {
      match.rule = { ...match.rule, phase: 'playing', advantageSide: null, restartSide: null };
      internals(match).football.pendingYellow = null;
      Object.assign(victim, { vx: 5, vy: 0, action: 'carry' });
      internals(match).callFoul(defender, victim, true, 10);
      held = internals(match).football.pendingYellow === defender.player.id;
      if (defender.card !== 'none' && !held) defender.card = 'none';
    }
    expect(held).toBe(true);
    expect(match.rule.phase).toBe('advantage');
    expect(defender.card).toBe('none');
    const stats = match.awayStats.yellows;
    // The next stoppage shows it.
    internals(match).setRestart('throwIn', 'home', 50, 0);
    expect(defender.card).toBe('yellow');
    expect(match.awayStats.yellows).toBe(stats + 1);
    expect(match.awayStats.yellows).toBeGreaterThan(yellowsBefore);
    expect(internals(match).football.pendingYellow).toBeNull();
    expect(match.events.some(event => event.type === 'yellow' && event.playerId === defender.player.id)).toBe(true);
  });

  it('makes the wall jump when a direct free kick is struck at goal', () => {
    const match = scene();
    const kicker = selected(match);
    const wall = match.actors.filter(actor => actor.side === 'away' && actor.player.positionGroup !== 'GK').slice(0, 3);
    isolate(match, [kicker, ...wall]);
    Object.assign(kicker, { x: 80, y: 30, facingX: 1, facingY: 0 });
    wall.forEach((player, index) => Object.assign(player, { x: 89, y: 30 + index * 0.7 }));
    giveBall(match, kicker);
    internals(match).football.restartRelease = { phase: 'freeKick', side: kicker.side, indirect: false, tick: match.tick };
    internals(match).shoot(kicker, 0.9, 1, 0, false, false);
    for (const player of wall) expect(player.action).toBe('wall-jump');
  });

  it('strikes a ball in the air as a volley when the shot is asked for and the ball is at foot height', () => {
    const match = scene();
    const striker = selected(match);
    isolate(match, [striker]);
    Object.assign(striker, { x: 95, y: 34, facingX: 1, facingY: 0, vx: 0, vy: 0 });
    Object.assign(match.ball, { x: 94.7, y: 34, z: 0.6, vx: 5, vy: 0, vz: 0, ownerId: null, lastTouch: 'home', lastTouchPlayerId: 'someone-else', controlledTouch: 1 });
    internals(match).football.queuedAction = { kind: 'shoot', expiresTick: match.tick + 12, power: 0.8, aimX: 1, aimY: 0, chip: false, finesse: false, low: false };
    tick(match);
    const pending = internals(match).football.pendingKick;
    expect(pending?.type).toBe('volley');
    expect(striker.action).toBe('volley');
    tick(match, {}, ACTION_CONTACT_TICKS.volley! + 2);
    // Either the ball was struck at goal or it was missed and runs on: it is no longer controlled on the spot.
    expect(internals(match).football.pendingKick).toBeNull();
  });

  it('lets keepers punch a crowded cross and smother a low shot one on one over many matches', () => {
    let punches = 0, smothers = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const match = scene(seed);
      const keeper = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'GK')!;
      const attackers = match.actors.filter(actor => actor.side === 'home' && actor.player.positionGroup !== 'GK').slice(0, 3);
      isolate(match, [keeper, ...attackers]);
      const goalX = 105;
      Object.assign(keeper, { x: goalX - 4, y: FIELD_WIDTH / 2, facingX: -1, facingY: 0 });
      attackers.forEach((actor, index) => Object.assign(actor, { x: goalX - 7 - index, y: FIELD_WIDTH / 2 + (index - 1) * 1.6, decisionCooldown: 99, intentX: goalX - 7 - index, intentY: FIELD_WIDTH / 2 }));
      Object.assign(match.ball, { x: goalX - 5.2, y: FIELD_WIDTH / 2, z: 1.8, vx: 3, vy: 0, vz: 0, ownerId: null, lastTouch: 'home', lastTouchPlayerId: attackers[0].player.id, controlledTouch: 1 });
      tick(match, {}, 4);
      if (keeper.action === 'keeper-punch') punches++;
    }
    for (let seed = 1; seed <= 120; seed++) {
      const match = scene(seed);
      const keeper = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'GK')!;
      const striker = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'ATT')!;
      isolate(match, [keeper, striker]);
      Object.assign(keeper, { x: 99, y: FIELD_WIDTH / 2, facingX: -1, facingY: 0 });
      Object.assign(striker, { x: 93, y: FIELD_WIDTH / 2, facingX: 1, facingY: 0 });
      giveBall(match, striker);
      internals(match).shoot(striker, 0.5, 1, 0.05, false, true);
      tick(match, {}, ACTION_CONTACT_TICKS.shot! + 40);
      if (keeper.action === 'keeper-smother') smothers++;
    }
    expect(punches).toBeGreaterThan(0);
    expect(smothers).toBeGreaterThan(0);
  });
});

describe('Phase 8 follow-up – fouls', () => {
  it('protects a keeper who has the ball in his own area: going in on him is mostly a foul', () => {
    let fouls = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const match = scene(seed);
      const keeper = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'GK')!;
      const attacker = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'ATT')!;
      isolate(match, [keeper, attacker]);
      Object.assign(keeper, { x: 100, y: FIELD_WIDTH / 2, facingX: -1, facingY: 0, decisionCooldown: 99 });
      Object.assign(attacker, { x: 99, y: FIELD_WIDTH / 2, facingX: 1, facingY: 0, tackleCooldown: 0 });
      giveBall(match, keeper);
      const before = match.homeStats.fouls;
      internals(match).attemptTackle(attacker, false);
      if (match.homeStats.fouls > before) fouls++;
    }
    expect(fouls).toBeGreaterThan(30);
    expect(fouls).toBeLessThan(60);
  });
});
