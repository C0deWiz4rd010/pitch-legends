import { ArcadeMatch, arcadeJogSpeed, MATCH_TICK } from './core/services/arcade-match';
import { createNewGame } from './data/generators';
import { EMPTY_MATCH_COMMAND, MatchCommand, MatchConfig } from './models/match.model';

function createSession(assist: MatchConfig['assist'] = 'balanced'): ArcadeMatch {
  const game = createNewGame({ managerName: 'Football', clubName: 'Football FC', seed: 6202 });
  const [home, away] = game.teams;
  const match = new ArcadeMatch(home, away, {
    mode: 'play', controllerMode: 'human', controlledTeamId: home.id, seed: 2202,
    halfMinutes: 3, difficulty: 'normal', assist, playerLockId: null,
    weather: 'clear', inputDevice: 'keyboard',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
  });
  match.tick = 100;
  match.rule.phase = 'playing';
  match.ball.ownerId = null;
  match.ball.x = 90;
  match.ball.y = 60;
  const selected = match.actors.find(actor => actor.player.id === match.selectedPlayerId)!;
  match.config.playerLockId = selected.player.id;
  for (const actor of match.actors) actor.active = actor === selected;
  Object.assign(selected, { x: 40, y: 34, vx: 0, vy: 0, facingX: 1, facingY: 0, stamina: 100 });
  selected.player.attributes.pace = 70;
  selected.player.attributes.dribbling = 70;
  return match;
}

function advance(match: ArcadeMatch, ticks: number, command: Partial<MatchCommand> = {}): void {
  for (let index = 0; index < ticks; index++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, device: 'keyboard', ...command });
}

describe('Football 2.0 movement and contact', () => {
  it('turns through an exact 180 degree reversal and continues moving in the requested direction', () => {
    const match = createSession();
    const actor = match.actors.find(item => item.player.id === match.selectedPlayerId)!;
    advance(match, 20, { moveX: -1 });
    expect(actor.facingX).toBeLessThan(-0.99);
    expect(Math.abs(actor.facingY)).toBeLessThan(0.01);
    expect(actor.x).toBeLessThan(40);
    expect(Math.hypot(actor.facingX, actor.facingY)).toBeCloseTo(1, 8);
  });

  it('reaches ninety percent jogging speed within 280 ms and brakes without sliding', () => {
    const match = createSession();
    const actor = match.actors.find(item => item.player.id === match.selectedPlayerId)!;
    advance(match, 16, { moveX: 1 });
    expect(actor.vx).toBeGreaterThanOrEqual(arcadeJogSpeed(70) * 0.9);
    advance(match, 11);
    expect(Math.hypot(actor.vx, actor.vy)).toBe(0);
  });

  it('uses the same acceleration budget for diagonal and straight movement', () => {
    const straight = createSession();
    const diagonal = createSession();
    advance(straight, 4, { moveX: 1 });
    advance(diagonal, 4, { moveX: 1, moveY: 1 });
    const a = straight.actors.find(item => item.player.id === straight.selectedPlayerId)!;
    const b = diagonal.actors.find(item => item.player.id === diagonal.selectedPlayerId)!;
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(Math.hypot(b.vx, b.vy), 8);
  });

  it('retains a pass follow-through across movement ticks then returns to locomotion', () => {
    const match = createSession();
    const actor = match.actors.find(item => item.player.id === match.selectedPlayerId)!;
    Object.assign(match.ball, { ownerId: actor.player.id, x: actor.x + 0.6, y: actor.y, z: 0 });
    advance(match, 3, { pass: true, aimX: 1 });
    advance(match, 1, { aimX: 1 });
    expect(actor.action).toBe('pass');
    advance(match, 10, { moveY: 1 });
    expect(actor.action).toBe('pass');
    advance(match, 15, { moveY: 1 });
    expect(actor.action).toBe('jog');
  });

  it('ignores nonpositive and invalid time steps without consuming the command', () => {
    const match = createSession();
    const initial = match.stateHash();
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) match.step(dt, { ...EMPTY_MATCH_COMMAND, moveX: 1 });
    expect(match.stateHash()).toBe(initial);
  });
});
