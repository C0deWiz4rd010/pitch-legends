import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { BALL_RADIUS } from './core/football/ball-physics';
import { ArcadeActor } from './core/football/match-types';
import { EMPTY_MATCH_COMMAND, MatchCommand, MatchConfig } from './models/match.model';
import { aimFromSticks } from './features/match/aim-input';

function scene(assist: MatchConfig['assist'] = 'assisted') {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: 'human', controlledTeamId: home.id, seed: 404, assist, halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'keyboard', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true } });
  match.tick = 100;
  match.rule = { ...match.rule, phase: 'playing', restartSide: null, elapsed: 0 };
  match.phase = 'firstHalf';
  const actor = match.actors.find((item) => item.player.id === match.selectedPlayerId)!;
  match.config.playerLockId = actor.player.id;
  // In midfield, away from the crossing zone, facing the opposition goal.
  Object.assign(actor, { x: 45, y: 34, vx: 0, vy: 0, facingX: 1, facingY: 0 });
  giveBall(match, actor);
  return { match, actor };
}
function giveBall(match: ArcadeMatch, actor: ArcadeActor) {
  Object.assign(match.ball, { x: actor.x + .5, y: actor.y, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, ownerId: actor.player.id, lastTouch: actor.side, lastTouchPlayerId: actor.player.id, controlledTouch: 1 });
}
function hold(match: ArcadeMatch, command: Partial<MatchCommand>, ticks: number) {
  for (let i = 0; i < ticks; i++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, device: 'gamepad', ...command });
}
function last(path: { points: Float32Array; count: number }) {
  const at = (path.count - 1) * 3;
  return { x: path.points[at], y: path.points[at + 1], z: path.points[at + 2] };
}

describe('Aim input', () => {
  it('follows the movement stick until a second stick is held while charging', () => {
    expect(aimFromSticks(true, 0, 0, 0.6, -0.2)).toEqual({ aimX: 0.6, aimY: -0.2, curl: 0, aiming: false });
    // Not charging: the right stick keeps picking team-mates.
    expect(aimFromSticks(false, 1, 0, 0, 1).aiming).toBe(false);
    const aimed = aimFromSticks(true, 0.8, 0, 0, 0);
    expect(aimed).toEqual({ aimX: 1, aimY: 0, curl: 0, aiming: true });
  });

  it('bends towards the side the movement stick points to', () => {
    expect(aimFromSticks(true, 1, 0, 0, 1).curl).toBeCloseTo(1);
    expect(aimFromSticks(true, 1, 0, 0, -1).curl).toBeCloseTo(-1);
    // Pushing along the aim is no bend.
    expect(aimFromSticks(true, 1, 0, 1, 0).curl).toBe(0);
  });
});

describe('Aim preview', () => {
  it('shows nothing until a lob is charged with the ball at the feet', () => {
    const { match } = scene();
    expect(match.aimPreview()).toBeNull();
    hold(match, { moveX: 1, aimX: 1 }, 10);
    expect(match.aimPreview()).toBeNull();
    hold(match, { lob: true, aimX: 1 }, 10);
    const path = match.aimPreview();
    expect(path).not.toBeNull();
    expect(path!.count).toBeGreaterThan(8);
  });

  it('draws the whole flight with its landing spot on assisted, less on the other levels', () => {
    const counts: Record<string, number> = {};
    for (const assist of ['assisted', 'balanced', 'manual'] as const) {
      const { match, actor } = scene(assist);
      hold(match, { lob: true, aimX: 1 }, 30);
      const path = match.aimPreview()!;
      counts[assist] = path.count;
      expect(path.landing).toBe(assist === 'assisted');
      if (assist === 'assisted') {
        const end = last(path);
        // It comes down on the grass, well ahead of the kicker in the direction of the aim.
        expect(end.z).toBeLessThan(0.3);
        expect((end.x - actor.x) * match.currentAttackDirection).toBeGreaterThan(8);
        // In between the ball is in the air.
        expect(path.points[Math.floor(path.count / 2) * 3 + 2]).toBeGreaterThan(1.5);
      }
    }
    expect(counts['assisted']).toBeGreaterThan(counts['balanced']);
    expect(counts['balanced']).toBeGreaterThan(counts['manual']);
  });

  it('carries further with more charge', () => {
    const short = scene(), long = scene();
    hold(short.match, { lob: true, aimX: 1 }, 6);
    hold(long.match, { lob: true, aimX: 1 }, 45);
    const near = last(short.match.aimPreview()!), far = last(long.match.aimPreview()!);
    expect(Math.abs(far.x - long.actor.x)).toBeGreaterThan(Math.abs(near.x - short.actor.x) + 3);
  });

  it('bends with the curl input and never changes the match', () => {
    const straight = scene(), bent = scene();
    for (const actor of [...straight.match.actors, ...bent.match.actors]) if (actor.side === 'home' && actor.player.id !== straight.actor.player.id && actor.player.id !== bent.actor.player.id) actor.active = false;
    hold(straight.match, { lob: true, aimX: 1 }, 30);
    hold(bent.match, { lob: true, aimX: 1, curl: 1 }, 30);
    const before = bent.match.stateHash();
    const a = last(straight.match.aimPreview()!), b = last(bent.match.aimPreview()!);
    expect(bent.match.stateHash()).toBe(before);
    expect(Math.abs(b.y - a.y)).toBeGreaterThan(0.8);
    // A second look gives the same picture.
    const again = last(bent.match.aimPreview()!);
    expect(again).toEqual(b);
  });

  it('marks where a ball in the air comes down', () => {
    const { match } = scene();
    expect(match.flightLanding()).toBeNull();
    Object.assign(match.ball, { ownerId: null, x: 40, y: 30, z: 0.2, vx: 14, vy: 2, vz: 8, spin: 0, topspin: 0 });
    match.tick++;
    const landing = match.flightLanding()!;
    expect(landing).not.toBeNull();
    expect(landing.x).toBeGreaterThan(55);
    expect(landing.seconds).toBeGreaterThan(1.2);
  });
});
