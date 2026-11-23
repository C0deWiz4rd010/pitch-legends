import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { BALL_RADIUS } from './core/football/ball-physics';
import { ArcadeActor } from './core/football/match-types';
import { HARD_KNOCK_SPEED, bodyBalance, resolveContacts, runningAlongside, shoulderCharge } from './core/football/actions/duel';

type Rng = { bool: (chance?: number) => boolean; float: (min: number, max: number) => number };

function scene() {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'instant', controllerMode: 'auto', controlledTeamId: home.id, seed: 31, assist: 'balanced', halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true } });
  match.rule = { ...match.rule, phase: 'playing', restartSide: null, elapsed: 0 };
  const rng = (match as unknown as { rng: Rng }).rng;
  // Decisions by the odds: anything better than even happens, the rest does not.
  rng.bool = (chance = 0.5) => chance > 0.5;
  rng.float = (min, max) => (min + max) / 2;
  const carrier = match.actors.find((a) => a.side === 'home' && a.player.positionGroup === 'ATT')!;
  const defender = match.actors.find((a) => a.side === 'away' && a.player.positionGroup === 'DEF')!;
  // Running up the pitch side by side.
  Object.assign(carrier, { x: 50, y: 30, vx: 7, vy: 0, facingX: 1, facingY: 0, stamina: 90 });
  Object.assign(defender, { x: 50, y: 31, vx: 7, vy: 0, facingX: 1, facingY: 0, stamina: 90, tackleCooldown: 0 });
  Object.assign(match.ball, { x: 50.5, y: 30, z: BALL_RADIUS, vx: 7, vy: 0, vz: 0, ownerId: carrier.player.id, lastTouch: 'home', lastTouchPlayerId: carrier.player.id });
  const strength = (actor: ArcadeActor, physical: number) => { actor.attrs = { ...actor.attrs!, physical }; };
  return { match, rng, carrier, defender, strength };
}

describe('Body balance', () => {
  it('rises with strength and falls at full speed and with tired legs', () => {
    const { match, carrier, strength } = scene();
    strength(carrier, 50);
    const weak = bodyBalance(match, carrier);
    strength(carrier, 90);
    const strong = bodyBalance(match, carrier);
    expect(strong).toBeGreaterThan(weak + 0.15);
    const running = bodyBalance(match, carrier);
    Object.assign(carrier, { vx: 0, vy: 0 });
    expect(bodyBalance(match, carrier)).toBeGreaterThan(running);
    carrier.stamina = 10;
    expect(bodyBalance(match, carrier)).toBeLessThan(strong);
  });
});

describe('Running duels', () => {
  it('knows when two players run side by side', () => {
    const { carrier, defender } = scene();
    expect(runningAlongside(defender, carrier)).toBe(true);
    Object.assign(defender, { x: 52, y: 30.2 });
    expect(runningAlongside(defender, carrier)).toBe(false);
    Object.assign(defender, { x: 50, y: 31, vx: -7 });
    expect(runningAlongside(defender, carrier)).toBe(false);
  });

  it('gives the ball to the stronger man in a shoulder charge, and staggers the weaker one', () => {
    const strong = scene();
    strong.strength(strong.defender, 95); strong.strength(strong.carrier, 45);
    shoulderCharge(strong.match, strong.defender, strong.carrier);
    expect(strong.match.ball.ownerId).toBe(strong.defender.player.id);
    expect(strong.carrier.action).toBe('stumble');

    const weak = scene();
    weak.strength(weak.defender, 40); weak.strength(weak.carrier, 95);
    shoulderCharge(weak.match, weak.defender, weak.carrier);
    expect(weak.match.ball.ownerId).toBe(weak.carrier.player.id);
    expect(weak.defender.action).toBe('stumble');
  });

  it('turns a standing tackle beside the carrier into a shoulder charge', () => {
    const { match, carrier, defender, strength } = scene();
    strength(defender, 95); strength(carrier, 45);
    match.attemptTackle(defender, false);
    expect(match.ball.ownerId).toBe(defender.player.id);
  });

  it('whistles a charge from behind', () => {
    const { match, rng, carrier, defender } = scene();
    rng.bool = () => true;
    Object.assign(defender, { x: 49.2, y: 30.3 });
    const fouls = match.awayStats.fouls;
    shoulderCharge(match, defender, carrier);
    expect(match.awayStats.fouls).toBe(fouls + 1);
  });
});

describe('Hard contacts', () => {
  it('knocks the weaker body off balance and loose goes the ball', () => {
    const { match, rng, carrier, defender, strength } = scene();
    // Whether it happens is a roll; who goes down is not.
    rng.bool = () => true;
    strength(defender, 95); strength(carrier, 40);
    resolveContacts(match, [{ a: carrier, b: defender, speed: HARD_KNOCK_SPEED + 1 }]);
    expect(carrier.action).toBe('stumble');
    expect(defender.action).not.toBe('stumble');
    expect(match.ball.ownerId).toBeNull();
  });

  it('lets an even, gentle contact pass', () => {
    const { match, carrier, defender, strength } = scene();
    strength(defender, 70); strength(carrier, 70);
    resolveContacts(match, [{ a: carrier, b: defender, speed: 5 }]);
    expect(carrier.action).not.toBe('stumble');
    expect(match.ball.ownerId).toBe(carrier.player.id);
  });
});
