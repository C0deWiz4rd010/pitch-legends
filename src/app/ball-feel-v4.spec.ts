import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { BALL_RADIUS } from './core/football/ball-physics';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, distance } from './core/football/match-types';
import { MATCH_TUNING } from './core/football/tuning';
import { ACTION_CONTACT_TICKS, ACTION_DURATION_TICKS } from './core/football/action-timing';
import { EMPTY_MATCH_COMMAND, MatchCommand } from './models/match.model';

function scene(seed = 404) {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: 'human', controlledTeamId: home.id, seed, assist: 'balanced', halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'keyboard', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true } });
  match.tick = 100;
  match.rule = { ...match.rule, phase: 'playing', restartSide: null, elapsed: 0 };
  match.phase = 'firstHalf';
  const actor = match.actors.find((item) => item.player.id === match.selectedPlayerId)!;
  match.config.playerLockId = actor.player.id;
  for (const other of match.actors) if (other !== actor) other.active = false;
  Object.assign(actor, { x: 40, y: 34, vx: 0, vy: 0, facingX: 1, facingY: 0 });
  return { match, actor };
}
function giveBall(match: ArcadeMatch, actor: ArcadeActor) {
  Object.assign(match.ball, { x: actor.x + actor.facingX * .5, y: actor.y + actor.facingY * .5, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, ownerId: actor.player.id, lastTouch: actor.side, lastTouchPlayerId: actor.player.id, controlledTouch: 1 });
}
function tick(match: ArcadeMatch, command: Partial<MatchCommand> = {}, count = 1) {
  for (let i = 0; i < count; i++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, device: 'keyboard', ...command });
}
const speedOf = (actor: ArcadeActor) => Math.hypot(actor.vx, actor.vy);

describe('Close control', () => {
  it('keeps the ball nearer and the player slower than a normal carry', () => {
    const carry = scene(), close = scene();
    giveBall(carry.match, carry.actor); giveBall(close.match, close.actor);
    let carryGap = 0, closeGap = 0;
    for (let i = 0; i < 90; i++) {
      tick(carry.match, { moveX: 1 });
      tick(close.match, { moveX: 1, jockey: true });
      if (i >= 30) { carryGap = Math.max(carryGap, distance(carry.actor, carry.match.ball)); closeGap = Math.max(closeGap, distance(close.actor, close.match.ball)); }
    }
    expect(close.actor.action).toBe('close-control');
    expect(close.match.ball.ownerId).toBe(close.actor.player.id);
    expect(closeGap).toBeLessThan(carryGap);
    expect(speedOf(close.actor)).toBeLessThan(speedOf(carry.actor) * (MATCH_TUNING.dribble.closeSpeed + 0.08));
  });

  it('turns the body faster and still shields when standing', () => {
    const carry = scene(), close = scene();
    giveBall(carry.match, carry.actor); giveBall(close.match, close.actor);
    tick(carry.match, { moveX: 1 }, 30); tick(close.match, { moveX: 1, jockey: true }, 30);
    // Three ticks into a turn straight up the screen.
    tick(carry.match, { moveY: -1 }, 3); tick(close.match, { moveY: -1, jockey: true }, 3);
    expect(close.actor.facingY).toBeLessThan(carry.actor.facingY);
    tick(close.match, { jockey: true }, 2);
    expect(close.actor.action).toBe('jockey');
  });
});

describe('Turn inertia', () => {
  it('plants the standing leg on a turn back at full speed, shorter for a good dribbler', () => {
    const { match, actor } = scene();
    tick(match, { moveX: 1, sprint: true }, 90);
    expect(speedOf(actor)).toBeGreaterThan(MATCH_TUNING.turn.minSpeed);
    tick(match, { moveX: -1, sprint: true });
    const until = match.football.recoveryUntil?.[actor.player.id] ?? 0;
    const expected = Math.round(MATCH_TUNING.turn.plantTicks - actor.attrs!.dribbling * MATCH_TUNING.turn.plantPerDribbling);
    expect(until - match.tick).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(4);
    expect(expected).toBeLessThanOrEqual(10);
  });

  it('leaves jogging turns and gentle changes of direction alone', () => {
    const jog = scene(), curve = scene();
    tick(jog.match, { moveX: 1 }, 90);
    tick(jog.match, { moveX: -1 });
    expect(jog.match.football.recoveryUntil?.[jog.actor.player.id] ?? 0).toBeLessThanOrEqual(jog.match.tick);
    tick(curve.match, { moveX: 1, sprint: true }, 90);
    // 90 degrees: a sharp cut, but no turn back.
    tick(curve.match, { moveY: 1, sprint: true });
    expect(curve.match.football.recoveryUntil?.[curve.actor.player.id] ?? 0).toBeLessThanOrEqual(curve.match.tick);
  });
});

describe('Side volley', () => {
  it('has its own wind-up between the volley and the scissor kick', () => {
    expect(ACTION_CONTACT_TICKS['side-volley']).toBeGreaterThan(ACTION_CONTACT_TICKS['volley']!);
    expect(ACTION_CONTACT_TICKS['side-volley']).toBeLessThan(ACTION_CONTACT_TICKS['bicycle-kick']!);
    expect(ACTION_DURATION_TICKS['side-volley']).toBeGreaterThan(ACTION_CONTACT_TICKS['side-volley']!);
  });

  it('meets a hip-high cross side-on when the player asks for a shot', () => {
    const { match, actor } = scene();
    const direction = match.attackDirection(actor.side);
    const goalX = direction > 0 ? FIELD_LENGTH : 0;
    Object.assign(actor, { x: goalX - direction * 11, y: FIELD_WIDTH / 2, facingX: direction, facingY: 0 });
    // A cross from the wing: travelling across the pitch, dropping to hip height at the player six ticks from now.
    const vy = 12, vz = 0.4, ticks = 6, seconds = ticks / 60;
    Object.assign(match.ball, {
      ownerId: null, x: actor.x + direction * 0.4, y: actor.y - vy * seconds, z: 1.2 - vz * seconds + 4.905 * seconds * seconds,
      vx: 0, vy, vz, spin: 0, topspin: 0, lastTouch: actor.side, lastTouchPlayerId: 'somebody-else', controlledTouch: 1,
    });
    match.football.queuedAction = { kind: 'shoot', expiresTick: match.tick + 11, power: 0.6, aimX: direction, aimY: 0, finesse: false, low: false };
    tick(match);
    expect(match.football.pendingKick?.type).toBe('side-volley');
    expect(actor.action).toBe('side-volley');
    tick(match, {}, ACTION_CONTACT_TICKS['side-volley']! + 1);
    // Struck towards goal, hard.
    expect(match.ball.vx * direction).toBeGreaterThan(15);
    expect(match.ball.lastTouchPlayerId).toBe(actor.player.id);
  });
});
