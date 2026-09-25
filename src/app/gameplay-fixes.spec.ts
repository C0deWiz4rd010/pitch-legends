import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { BALL_RADIUS } from './core/football/ball-physics';
import { Difficulty } from './models/game.model';
import { EMPTY_MATCH_COMMAND, MatchCommand } from './models/match.model';

function scene(difficulty: Difficulty = 'normal', seed = 721) {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: 'human', controlledTeamId: home.id, seed, assist: 'balanced', halfMinutes: 3, difficulty, playerLockId: null, weather: 'clear', inputDevice: 'keyboard', camera: { zoom: 1, lookAhead: .18, shake: false, reducedMotion: true } });
  match.tick = 100;
  return match;
}
function play(match: ArcadeMatch) {
  match.rule = { ...match.rule, phase: 'playing', restartSide: null, elapsed: 0 };
  match.phase = 'firstHalf';
}
function tick(match: ArcadeMatch, command: Partial<MatchCommand> = {}, count = 1) {
  for (let i = 0; i < count; i++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, device: 'keyboard', ...command });
}

describe('Gameplay fixes', () => {
  it('credits a defender deflection into the own net as an own goal', () => {
    const match = scene();
    play(match);
    const defender = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'DEF')!;
    for (const actor of match.actors) if (actor !== defender) { actor.x = 60; actor.y = 60; }
    defender.x = 20; defender.y = 10;
    Object.assign(match.ball, { x: 1.2, y: 34, z: BALL_RADIUS, vx: -14, vy: 0, vz: 0, ownerId: null, lastTouch: 'home', lastTouchPlayerId: defender.player.id, controlledTouch: 1 });
    tick(match, {}, 12);
    expect(match.awayScore).toBe(1);
    const goal = match.events.filter(event => event.type === 'goal').at(-1)!;
    expect(goal.ownGoal).toBe(true);
    expect(goal.messageKey).toBe('match.goal.own');
    expect(match.contributions[defender.player.id].goals).toBe(0);
    expect(match.ratings[defender.player.id]).toBeLessThan(6.5);
  });

  it('never lets the human-controlled defender steal the ball without input', () => {
    const match = scene();
    play(match);
    const defender = match.actors.find(actor => actor.player.id === match.selectedPlayerId)!;
    const carrier = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'MID')!;
    for (const actor of match.actors) if (actor !== defender && actor !== carrier) actor.active = false;
    match.config.playerLockId = defender.player.id;
    Object.assign(carrier, { x: 50, y: 34, vx: 0, vy: 0, decisionCooldown: 99, intentX: 50, intentY: 34 });
    // The away carrier faces -x and keeps the ball on that side: stand right next to it.
    Object.assign(defender, { x: 49.0, y: 34.3, vx: 0, vy: 0 });
    Object.assign(match.ball, { x: 49.6, y: 34, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, ownerId: carrier.player.id, lastTouch: 'away', lastTouchPlayerId: carrier.player.id });
    let attempts = 0;
    for (let i = 0; i < 600; i++) {
      carrier.decisionCooldown = 99;
      tick(match);
      if (defender.action === 'standing-tackle' || defender.action === 'slide') attempts++;
      expect(match.ball.ownerId).not.toBe(defender.player.id);
    }
    expect(attempts).toBe(0);
    expect(match.homeStats.tacklesWon).toBe(0);
  });

  it('applies difficulty to the opponent only', () => {
    for (const difficulty of ['easy', 'hard'] as const) {
      const match = scene(difficulty);
      expect(match.aiLevel(match.controlledSide)).toBe('normal');
      expect(match.aiLevel(match.controlledSide === 'home' ? 'away' : 'home')).toBe(difficulty);
    }
  });

  it('ignores the keeper rush command when the ball is far from the own goal', () => {
    const match = scene();
    play(match);
    const keeper = match.actors.find(actor => actor.side === 'home' && actor.player.positionGroup === 'GK')!;
    Object.assign(match.ball, { x: 60, y: 34, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0, ownerId: null });
    const start = keeper.x;
    tick(match, { keeperRush: true }, 20);
    expect(keeper.action).not.toBe('keeper-rush');
    expect(keeper.x - start).toBeLessThan(6);
  });

  it('substitutes an injured opponent at the next stoppage', () => {
    const match = scene();
    const injured = match.actors.find(actor => actor.side === 'away' && actor.player.positionGroup === 'MID')!;
    const injuredId = injured.player.id;
    const save = match.checkpoint();
    save.runtime.football!.injuredIds = [injuredId];
    save.rule = { ...save.rule, phase: 'freeKick', restartSide: 'home', spotX: 50, spotY: 34, elapsed: 0 };
    save.phase = 'stoppage';
    match.restore(save);
    expect(match.isInjured(injuredId)).toBe(true);
    tick(match);
    const sub = match.events.find(event => event.type === 'sub' && event.side === 'away');
    expect(sub).toBeTruthy();
    expect(injured.player.id).toBe(sub!.playerId);
    expect(injured.player.positionGroup).toBe('MID');
    expect(match.isInjured(injuredId)).toBe(false);
    expect(match.benchFor('away').some(player => player.id === injuredId)).toBe(false);
  });
});
