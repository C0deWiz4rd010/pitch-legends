import { ArcadeMatch, MATCH_TICK, FIELD_LENGTH, GOAL_WIDTH } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { EMPTY_MATCH_COMMAND, MatchCommand } from './models/match.model';
import { BALL_RADIUS, collideGoalFrame } from './core/football/ball-physics';

function scene() {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: 'human', controlledTeamId: home.id, seed: 721, assist: 'manual', halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'keyboard', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true } });
  match.tick = 100;
  match.rule.phase = 'playing';
  const actor = match.actors.find(a => a.player.id === match.selectedPlayerId)!;
  for (const a of match.actors) a.active = a === actor;
  match.config.playerLockId = actor.player.id;
  Object.assign(actor, { x: 40, y: 34, vx: 0, vy: 0, facingX: 1, facingY: 0, stamina: 100 });
  actor.player.attributes.dribbling = 99;
  Object.assign(match.ball, { ownerId: null, x: 43, y: 34, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, controlledTouch: 1 });
  return { match, actor };
}
function tick(match: ArcadeMatch, command: Partial<MatchCommand> = {}, count = 1) {
  for (let i = 0; i < count; i++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, device: 'keyboard', ...command });
}

describe('Spatial football contacts', () => {
  it('cannot control a ball three metres away, even as the intended receiver', () => {
    const { match, actor } = scene();
    const save = match.checkpoint();
    save.runtime.intendedReceiverId = actor.player.id;
    expect(match.restore(save)).toBe(true);
    tick(match, {}, 10);
    expect(match.ball.ownerId).toBeNull();
    expect(match.ball.x).toBe(43);
  });
  it('dribbles through discrete velocity contacts without teleporting the ball', () => {
    const { match, actor } = scene();
    Object.assign(match.ball, { ownerId: actor.player.id, x: 40.5, controlledTouch: 0.18 });
    let previous = match.ball.x;
    let lost = 0;
    for (let i = 0; i < 180; i++) {
      tick(match, { moveX: 1, sprint: true });
      expect(Math.abs(match.ball.x - previous)).toBeLessThan(0.3);
      if (!match.ball.ownerId) lost++;
      previous = match.ball.x;
    }
    expect(actor.x).toBeGreaterThan(55);
    expect(Math.hypot(match.ball.x - actor.x, match.ball.y - actor.y)).toBeLessThan(2);
    expect(lost).toBeLessThan(15);
  });
  it('executes a buffered first-time pass on arrival and restores the same queued action', () => {
    const { match } = scene();
    Object.assign(match.ball, { x: 41.6, vx: -8 });
    tick(match, { pass: true, aimX: 1 });
    tick(match, { aimX: 1 });
    const save = match.checkpoint();
    const twin = scene().match;
    expect(twin.restore(save)).toBe(true);
    tick(match, { aimX: 1 }, 10);
    tick(twin, { aimX: 1 }, 10);
    expect(match.homeStats.passesAttempted).toBe(1);
    expect(match.ball.vx).toBeGreaterThan(8);
    expect(match.stateHash()).toBe(twin.stateHash());
  });
  it('lets a stale first-time command expire before a later reception', () => {
    const { match, actor } = scene();
    tick(match, { pass: true });
    tick(match, {}, 15);
    Object.assign(match.ball, { x: actor.x + 0.5, vx: 0 });
    tick(match, {}, 8);
    expect(match.homeStats.passesAttempted).toBe(0);
  });
  it('reflects a fast shot at a post before checking whether a goal was scored', () => {
    const { match } = scene();
    Object.assign(match.ball, { x: FIELD_LENGTH - 0.5, y: 34 + GOAL_WIDTH / 2, vx: 42, z: 0.5 });
    tick(match);
    expect(match.ball.vx).toBeLessThan(0);
    expect(match.homeScore + match.awayScore).toBe(0);
  });
  it('requires the whole ball to cross the line', () => {
    const { match } = scene();
    Object.assign(match.ball, { x: FIELD_LENGTH + BALL_RADIUS / 2, y: 34, vx: 0 });
    tick(match);
    expect(match.homeScore + match.awayScore).toBe(0);
    match.ball.x = FIELD_LENGTH + BALL_RADIUS + 0.01;
    tick(match);
    expect(match.homeScore + match.awayScore).toBe(1);
  });
  it('resolves a crossbar collision without adding energy', () => {
    const ball = { x: 104.9, y: 34, z: 2.44, vx: 30, vy: 0, vz: 0 };
    expect(collideGoalFrame(ball, 105, 34, 7.32, 2.44)).toBe(true);
    expect(ball.vx).toBeLessThan(0);
    expect(Math.hypot(ball.vx, ball.vy, ball.vz)).toBeLessThanOrEqual(30);
  });
  it('never lets a distant keeper teleport a shot into his hands', () => {
    const { match } = scene();
    const keeper = match.actors.find(a => a.side === 'away' && a.player.positionGroup === 'GK')!;
    Object.assign(keeper, { active: true, x: 103, y: 26, decisionCooldown: 10, intentX: 103, intentY: 26 });
    Object.assign(match.ball, { x: 100, y: 35, vx: 30, z: 0.5 });
    tick(match, {}, 14);
    expect(match.awayStats.saves).toBe(0);
    expect(match.ball.ownerId).not.toBe(keeper.player.id);
    expect(match.homeScore).toBe(1);
  });
});
