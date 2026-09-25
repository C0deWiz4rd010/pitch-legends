import { ArcadeMatch, MATCH_TICK, arcadeJogSpeed, arcadeSprintSpeed } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { BALL_RADIUS } from './core/football/ball-physics';
import { ArcadeActor } from './core/football/match-types';
import { EMPTY_MATCH_COMMAND, MatchCommand } from './models/match.model';

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

describe('Gameplay actions', () => {
  it('makes sprinting clearly faster than jogging and pace matter', () => {
    expect(arcadeJogSpeed(70) / arcadeSprintSpeed(70)).toBeCloseTo(0.68, 2);
    const jog = scene(), sprint = scene();
    const a = selected(jog), b = selected(sprint);
    tick(jog, { moveX: 1 }, 60);
    tick(sprint, { moveX: 1, sprint: true }, 60);
    expect(Math.hypot(b.vx, b.vy)).toBeGreaterThan(Math.hypot(a.vx, a.vy) * 1.3);
  });

  it('tackles on the press itself instead of waiting for the release', () => {
    const match = scene();
    const defender = selected(match);
    const carrier = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'MID')!;
    isolate(match, [defender, carrier]);
    Object.assign(carrier, { x: 50, y: 34, facingX: -1, facingY: 0, decisionCooldown: 99, intentX: 50, intentY: 34 });
    Object.assign(defender, { x: 48.9, y: 34, facingX: 1, facingY: 0 });
    giveBall(match, carrier);
    tick(match, { pass: true });
    expect(defender.action).toBe('standing-tackle');
  });

  it('jockeys goal-side while facing the ball carrier', () => {
    const match = scene();
    const defender = selected(match);
    const carrier = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'ATT')!;
    isolate(match, [defender, carrier]);
    Object.assign(carrier, { x: 40, y: 30, decisionCooldown: 99, intentX: 40, intentY: 30 });
    Object.assign(defender, { x: 42, y: 36 });
    giveBall(match, carrier);
    for (let i = 0; i < 120; i++) { carrier.decisionCooldown = 99; tick(match, { jockey: true }); }
    expect(defender.action).toBe('jockey');
    // Home defends x = 0 in the first half: stay between carrier and goal.
    expect(defender.x).toBeLessThan(carrier.x);
    const toCarrier = Math.atan2(carrier.y - defender.y, carrier.x - defender.x);
    expect(Math.abs(Math.atan2(Math.sin(Math.atan2(defender.facingY, defender.facingX) - toCarrier), Math.cos(Math.atan2(defender.facingY, defender.facingX) - toCarrier)))).toBeLessThan(0.35);
    expect(Math.hypot(defender.x - carrier.x, defender.y - carrier.y)).toBeLessThan(3.2);
  });

  it('plays a through ball into the space ahead of the runner', () => {
    const match = scene();
    const passer = selected(match);
    const runner = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'ATT' && actor !== passer)!;
    isolate(match, [passer, runner]);
    Object.assign(passer, { x: 40, y: 34, facingX: 1, facingY: 0 });
    Object.assign(runner, { x: 55, y: 34, vx: 0, vy: 0, decisionCooldown: 99, intentX: 55, intentY: 34 });
    giveBall(match, passer);
    tick(match, { through: true, aimX: 1 }, 30);
    tick(match, { aimX: 1 });
    expect(match.ball.ownerId).toBeNull();
    // The ball travels towards a point well beyond the runner.
    const heading = match.ball.vy / match.ball.vx;
    expect(match.ball.vx).toBeGreaterThan(0);
    expect(Math.abs(heading)).toBeLessThan(0.2);
    let furthest = match.ball.x;
    for (let i = 0; i < 120 && Math.hypot(match.ball.vx, match.ball.vy) > 1; i++) { runner.decisionCooldown = 99; runner.active = false; tick(match); furthest = match.ball.x; }
    expect(furthest).toBeGreaterThan(runner.x + 3);
  });

  it('delivers a high cross that reaches the runner at header height', () => {
    const match = scene();
    const crosser = selected(match);
    const runner = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'ATT' && actor !== crosser)!;
    isolate(match, [crosser, runner]);
    Object.assign(crosser, { x: 88, y: 60, facingX: 1, facingY: 0 });
    Object.assign(runner, { x: 96, y: 34, vx: 0, vy: 0, decisionCooldown: 99, intentX: 96, intentY: 34 });
    giveBall(match, crosser);
    tick(match, { lob: true, aimX: 0, aimY: -1 }, 20);
    tick(match, { aimY: -1 });
    expect(crosser.action).toBe('lob');
    runner.active = false;
    let heightAtRunner = 0;
    for (let i = 0; i < 180; i++) {
      tick(match);
      if (Math.abs(match.ball.y - runner.y) < 1.2) { heightAtRunner = match.ball.z; break; }
    }
    expect(heightAtRunner).toBeGreaterThan(1.2);
    expect(heightAtRunner).toBeLessThan(2.6);
  });

  it('decides skill moves by timing: too close loses the ball, the right distance wrong-foots', () => {
    for (const [gap, expected] of [[0.9, 'skill-failed'], [2.2, 'ball-roll']] as const) {
      const match = scene();
      const carrier = selected(match);
      const defender = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'DEF')!;
      isolate(match, [carrier, defender]);
      Object.assign(carrier, { x: 50, y: 34, facingX: 1, facingY: 0, skillCooldown: 0 });
      Object.assign(defender, { x: 50 + gap, y: 34, tackleCooldown: 0, decisionCooldown: 99, intentX: 50 + gap, intentY: 34 });
      giveBall(match, carrier);
      match.performSkill(carrier, 0, 1);
      expect(carrier.action).toBe(expected);
      if (expected === 'ball-roll') {
        expect(match.ball.ownerId).toBe(carrier.player.id);
        expect(defender.tackleCooldown).toBeGreaterThan(0.2);
      } else expect(match.ball.ownerId).toBeNull();
    }
  });

  it('drives a power shot harder than a normal shot', () => {
    const speeds = [false, true].map(power => {
      const match = scene();
      const shooter = selected(match);
      isolate(match, [shooter]);
      Object.assign(shooter, { x: 80, y: 34, facingX: 1, facingY: 0 });
      giveBall(match, shooter);
      tick(match, { shoot: true, aimX: 1, lob: power, skill: power }, 40);
      tick(match, { aimX: 1, lob: power, skill: power });
      return Math.hypot(match.ball.vx, match.ball.vy);
    });
    expect(speeds[1]).toBeGreaterThan(speeds[0] + 3);
  });
});
