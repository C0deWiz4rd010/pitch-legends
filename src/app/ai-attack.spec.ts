import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH } from './core/football/match-types';
import { aiTakeOn, attackStyle, planShot, wantsOneTwo } from './core/football/ai/attack';

type Internals = { rng: { bool: (chance?: number) => boolean; float: (min: number, max: number) => number } };

function scene() {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'instant', controllerMode: 'auto', controlledTeamId: home.id, seed: 77, assist: 'balanced', halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true } });
  // No noise: the plan itself is under test.
  (match as unknown as Internals).rng.float = (min, max) => (min + max) / 2;
  const shooter = match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup === 'ATT') ?? match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup !== 'GK')!;
  const keeper = match.actors.find((actor) => actor.side === 'away' && actor.player.positionGroup === 'GK')!;
  const direction = match.attackDirection('home');
  const goalX = direction > 0 ? FIELD_LENGTH : 0;
  // Everybody else far away, so only the shooter and the keeper matter.
  for (const actor of match.actors) if (actor !== shooter && actor !== keeper) Object.assign(actor, { x: FIELD_LENGTH / 2, y: 2 });
  const place = (actor: ArcadeActor, fromGoal: number, y: number) => Object.assign(actor, { x: goalX - direction * fromGoal, y, facingX: direction, facingY: 0, vx: 0, vy: 0 });
  return { match, shooter, keeper, direction, place };
}

describe('AI attack', () => {
  it('shoots into the bigger gap the keeper leaves', () => {
    const { match, shooter, keeper, place } = scene();
    place(shooter, 18, FIELD_WIDTH / 2);
    place(keeper, 1, FIELD_WIDTH / 2 - 1.6);
    expect(planShot(match, shooter, 18).aimY).toBeGreaterThan(0.3);
    place(keeper, 1, FIELD_WIDTH / 2 + 1.6);
    expect(planShot(match, shooter, 18).aimY).toBeLessThan(-0.3);
  });

  it('chips a keeper who has come far out, passes it into the corner one on one and hits it hard from distance', () => {
    const { match, shooter, keeper, place } = scene();
    place(shooter, 20, FIELD_WIDTH / 2);
    place(keeper, 10, FIELD_WIDTH / 2);
    expect(planShot(match, shooter, 20).kind).toBe('chip');
    place(shooter, 11, FIELD_WIDTH / 2 + 3);
    place(keeper, 2, FIELD_WIDTH / 2);
    expect(planShot(match, shooter, 11).kind).toBe('placed');
    place(shooter, 30, FIELD_WIDTH / 2);
    place(keeper, 1, FIELD_WIDTH / 2);
    const long = planShot(match, shooter, 30);
    expect(long.kind).toBe('power');
    expect(long.power).toBeGreaterThan(0.8);
  });

  it('lets character colour the decisions', () => {
    const actor = (personality: string) => ({ player: { personality } }) as unknown as ArcadeActor;
    expect(attackStyle(actor('driven')).shotBias).toBeLessThan(0);
    expect(attackStyle(actor('team-player')).shotBias).toBeGreaterThan(0);
    expect(attackStyle(actor('team-player')).unselfish).toBeLessThan(attackStyle(actor('driven')).unselfish);
    expect(attackStyle(actor('flair')).flair).toBeGreaterThan(attackStyle(actor('professional')).flair);
    expect(attackStyle(actor('team-player')).combine).toBeGreaterThan(attackStyle(actor('driven')).combine);
  });

  it('takes a lone defender on only with room behind him, and knocks it past him when quicker', () => {
    const { match, shooter, direction } = scene();
    (match as unknown as Internals).rng.bool = () => true;
    const defenders = match.actors.filter((actor) => actor.side === 'away' && actor.player.positionGroup !== 'GK');
    const [defender, cover] = defenders;
    Object.assign(shooter, { x: 50, y: 34, facingX: direction, facingY: 0, skillCooldown: 0 });
    Object.assign(defender, { x: 50 + direction * 2.2, y: 34 });
    // A covering defender right behind him: pass it instead.
    Object.assign(cover, { x: 50 + direction * 8, y: 34 });
    expect(aiTakeOn(match, shooter, 2.2)).toBeNull();
    Object.assign(cover, { x: 50 + direction * 30, y: 60 });
    const move = aiTakeOn(match, shooter, 2.2);
    expect(move).not.toBeNull();
    // Too close to beat him.
    expect(aiTakeOn(match, shooter, 1)).toBeNull();
  });

  it('plays a give-and-go only to a marked team-mate with space ahead of the passer', () => {
    const { match, shooter, direction } = scene();
    (match as unknown as Internals).rng.bool = () => true;
    const mate = match.actors.find((actor) => actor.side === 'home' && actor !== shooter && actor.player.positionGroup !== 'GK')!;
    Object.assign(shooter, { x: 60, y: 34, stamina: 90 });
    Object.assign(mate, { x: 60 + direction * 12, y: 30 });
    for (const actor of match.actors) if (actor.side === 'away') Object.assign(actor, { x: 5, y: 5 });
    expect(wantsOneTwo(match, shooter, mate, 6)).toBe(false);
    expect(wantsOneTwo(match, shooter, mate, 2)).toBe(true);
    // Somebody standing in the space ahead: no run to make.
    const blocker = match.actors.find((actor) => actor.side === 'away' && actor.player.positionGroup !== 'GK')!;
    Object.assign(blocker, { x: 60 + direction * 10, y: 34 });
    expect(wantsOneTwo(match, shooter, mate, 2)).toBe(false);
  });
});
