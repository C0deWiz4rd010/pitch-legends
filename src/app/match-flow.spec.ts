import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { BALL_RADIUS } from './core/football/ball-physics';
import { wallSize } from './core/football/set-pieces';
import { EMPTY_MATCH_COMMAND, MatchConfig, MatchCommand, RuleState } from './models/match.model';

function config(homeId: string, overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { mode: 'play', controllerMode: 'auto', controlledTeamId: homeId, seed: 515, assist: 'balanced', halfMinutes: 3, difficulty: 'normal', playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true }, ...overrides };
}
function scene(overrides: Partial<MatchConfig> = {}) {
  const { home, away } = createPracticeTeams();
  return new ArcadeMatch(home, away, config(home.id, overrides));
}
function tick(match: ArcadeMatch, command: Partial<MatchCommand> = {}, count = 1) {
  for (let i = 0; i < count; i++) {
    if (match.phase === 'goalReplay') match.endReplay();
    match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, ...command });
  }
}
function restart(match: ArcadeMatch, phase: RuleState['phase'], x: number, y: number, side: 'home' | 'away' = 'home') {
  const save = match.checkpoint();
  save.rule = { ...save.rule, phase, restartSide: side, spotX: x, spotY: y, elapsed: 0, indirect: false };
  save.phase = 'stoppage';
  save.ball = { ...save.ball, ownerId: null, x, y, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0 };
  match.restore(save);
}

describe('Match flow and set pieces', () => {
  it('plays announced stoppage time before the half-time whistle', () => {
    const match = scene();
    // Three-minute halves: 180 s per half, one football minute every 4 s.
    for (let i = 0; i < 20_000 && match.phase !== 'halftime'; i++) tick(match);
    expect(match.phase).toBe('halftime');
    expect(match.announcedStoppage).toBeGreaterThanOrEqual(1);
    expect(match.elapsed).toBeGreaterThanOrEqual(180 + match.announcedStoppage * 4 - 0.02);
    expect(match.footballMinute).toBe(45);
    match.resumeSecondHalf();
    tick(match, {}, 120);
    expect(match.footballMinute).toBeGreaterThanOrEqual(45);
    expect(match.footballMinute).toBeLessThan(48);
  });

  it('builds a wall of 2-5 defenders 9.15 m from a central free kick', () => {
    expect(wallSize({ phase: 'freeKick', indirect: false } as RuleState, 18, 2)).toBe(5);
    expect(wallSize({ phase: 'freeKick', indirect: false } as RuleState, 30, 4)).toBe(2);
    expect(wallSize({ phase: 'freeKick', indirect: true } as RuleState, 18, 2)).toBe(0);
    const match = scene();
    restart(match, 'freeKick', 85, 34);
    tick(match);
    const wall = match.actors.filter(actor => actor.side === 'away' && actor.active && Math.abs(Math.hypot(actor.x - 85, actor.y - 34) - 9.15) < 0.4);
    expect(wall.length).toBeGreaterThanOrEqual(4);
    for (const actor of wall) expect(actor.x).toBeGreaterThan(85);
  });

  it('lets an outfield player block a shot in their path', () => {
    const match = scene({ controllerMode: 'human' });
    match.rule = { ...match.rule, phase: 'playing', restartSide: null };
    match.phase = 'firstHalf';
    match.tick = 100;
    const shooter = match.actors.find(actor => actor.player.id === match.selectedPlayerId)!;
    const blocker = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'DEF')!;
    for (const actor of match.actors) if (actor !== shooter && actor !== blocker) actor.active = false;
    match.config.playerLockId = shooter.player.id;
    Object.assign(shooter, { x: 80, y: 34, facingX: 1, facingY: 0 });
    Object.assign(blocker, { x: 84, y: 34, decisionCooldown: 99, intentX: 84, intentY: 34 });
    Object.assign(match.ball, { x: 80.5, y: 34, z: BALL_RADIUS, ownerId: shooter.player.id, lastTouch: 'home', lastTouchPlayerId: shooter.player.id });
    tick(match, { shoot: true, aimX: 1 }, 4);
    tick(match, { aimX: 1 }, 20);
    expect(match.events.some(event => event.messageKey === 'match.blocked')).toBe(true);
    expect(match.awayStats.blocks).toBe(1);
    expect(match.ball.vx).toBeLessThan(0.5 * 25);
  });

  it('releases throw-ins at a realistic 8-14 m/s', () => {
    const match = scene();
    restart(match, 'throwIn', 50, 0);
    for (let i = 0; i < 400 && match.rule.phase === 'throwIn'; i++) tick(match);
    expect(match.rule.phase).toBe('playing');
    const speed = Math.hypot(match.ball.vx, match.ball.vy);
    expect(speed).toBeGreaterThanOrEqual(7.5);
    expect(speed).toBeLessThanOrEqual(14.2);
  });

  it('commits the keeper to a side as a penalty is struck', () => {
    const match = scene();
    restart(match, 'penalty', 94, 34);
    for (let i = 0; i < 400 && match.rule.phase === 'penalty'; i++) tick(match);
    const keeper = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'GK')!;
    const events = match.events.filter(event => event.type === 'shot');
    expect(events.length).toBeGreaterThan(0);
    expect(['keeper-dive', 'keeper-ready', 'keeper-catch', 'keeper-parry']).toContain(keeper.action);
  });

  it('settles a drawn knockout tie with extra time and a penalty shoot-out', () => {
    for (let seed = 1; seed < 80; seed++) {
      const { home, away } = createPracticeTeams();
      const draw = new ArcadeMatch(home, away, config(home.id, { mode: 'instant', seed })).result();
      if (draw.homeScore !== draw.awayScore) continue;
      const cup = new ArcadeMatch(home, away, config(home.id, { mode: 'instant', seed, knockout: true })).result();
      expect(cup.extraTime).toBe(true);
      expect(cup.events.some(event => event.messageKey === 'match.extraTime')).toBe(true);
      if (cup.homeScore === cup.awayScore) {
        const shootout = cup.shootout!;
        const scored = { home: shootout.home.filter(Boolean).length, away: shootout.away.filter(Boolean).length };
        expect(scored[shootout.winner]).toBeGreaterThan(scored[shootout.winner === 'home' ? 'away' : 'home']);
        expect(Math.abs(shootout.home.length - shootout.away.length)).toBeLessThanOrEqual(1);
      } else expect(cup.shootout).toBeUndefined();
      expect(draw.extraTime).toBeUndefined();
      return;
    }
    throw new Error('no drawn seed found');
  });
});
