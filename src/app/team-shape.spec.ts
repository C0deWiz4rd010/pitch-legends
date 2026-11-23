import { createPracticeTeams } from './core/football/practice';
import { ShapeContext, tacticalIntent } from './core/football/tactical-intent';
import { ArcadeMatch } from './core/services/arcade-match';
import { ArcadeActor, FIELD_WIDTH } from './core/football/match-types';

const neutral: ShapeContext = { scoreDiff: 0, minute: 30, lostTicks: 100000, shortHanded: false };

/** The away side has the ball in midfield; the home side defends, attacking towards +x. */
function defending() {
  const teams = createPracticeTeams();
  const match = new ArcadeMatch(teams.home, teams.away, teams.home.id);
  const owner = match.actors.find((a) => a.side === 'away' && a.player.positionGroup === 'MID')!;
  Object.assign(owner, { x: 55, y: 34, facingX: -1, facingY: 0, action: 'carry' });
  Object.assign(match.ball, { x: 55, y: 34, ownerId: owner.player.id, lastTouch: 'away' });
  const home = match.actors.filter((a) => a.side === 'home');
  const intent = (actor: ArcadeActor, context = neutral) => tacticalIntent(actor, owner, match.ball, match.actors, match.home, 1, 500, 'normal', context);
  return { match, owner, home, intent };
}

describe('Team shape without the ball', () => {
  it('shifts the whole block towards the ball side', () => {
    const { match, owner, home, intent } = defending();
    const defenders = home.filter((a) => a.player.positionGroup === 'DEF');
    const meanY = () => defenders.reduce((sum, a) => sum + intent(a).y, 0) / defenders.length;
    Object.assign(owner, { y: 10 }); Object.assign(match.ball, { y: 10 });
    const left = meanY();
    Object.assign(owner, { y: 58 }); Object.assign(match.ball, { y: 58 });
    const right = meanY();
    expect(right - left).toBeGreaterThan(12);
  });

  it('steps the back line up together when the carrier turns towards his own goal', () => {
    const { owner, home, intent } = defending();
    const defender = home.find((a) => a.player.positionGroup === 'DEF' && Math.abs(a.homeY - FIELD_WIDTH / 2) < 12)!;
    const facingUs = intent(defender).x;
    Object.assign(owner, { facingX: 1 });
    expect(intent(defender).x).toBeGreaterThan(facingUs + 3);
  });

  it('counter-presses right after losing the ball high up, and sits deeper protecting a late lead', () => {
    const { match, owner, home, intent } = defending();
    Object.assign(owner, { x: 75 }); Object.assign(match.ball, { x: 75 });
    const pressing = (context: ShapeContext) => home.filter((a) => a.player.positionGroup !== 'GK' && ['press', 'support-press'].includes(intent(a, context).action)).length;
    expect(pressing({ ...neutral, lostTicks: 60 })).toBeGreaterThan(pressing(neutral));
    Object.assign(owner, { x: 55 }); Object.assign(match.ball, { x: 55 });
    const defender = home.find((a) => a.player.positionGroup === 'DEF' && Math.abs(a.homeY - FIELD_WIDTH / 2) < 12)!;
    expect(intent(defender, { ...neutral, scoreDiff: 1, minute: 85 }).x).toBeLessThan(intent(defender).x - 2);
  });

  it('closes up a man down', () => {
    const { home, intent } = defending();
    const outfield = home.filter((a) => a.player.positionGroup !== 'GK');
    const spread = (context: ShapeContext) => { const ys = outfield.map((a) => intent(a, context).y); return Math.max(...ys) - Math.min(...ys); };
    expect(spread({ ...neutral, shortHanded: true })).toBeLessThan(spread(neutral));
  });
});

describe('Team shape with the ball', () => {
  it('pushes midfield and forwards up when chasing the game late on, and keeps the centre-backs back', () => {
    const teams = createPracticeTeams();
    const match = new ArcadeMatch(teams.home, teams.away, teams.home.id);
    const owner = match.actors.find((a) => a.side === 'home' && a.player.positionGroup === 'MID')!;
    Object.assign(owner, { x: 60, y: 34 });
    Object.assign(match.ball, { x: 60, y: 34, ownerId: owner.player.id, lastTouch: 'home' });
    const intent = (actor: ArcadeActor, context: ShapeContext) => tacticalIntent(actor, owner, match.ball, match.actors, match.home, 1, 500, 'normal', context);
    const mid = match.actors.find((a) => a.side === 'home' && a.player.positionGroup === 'MID' && a !== owner)!;
    const centreBack = match.actors.find((a) => a.side === 'home' && a.player.positionGroup === 'DEF' && Math.abs(a.homeY - FIELD_WIDTH / 2) < 12)!;
    const chasing = { ...neutral, scoreDiff: -1, minute: 85 };
    expect(intent(mid, chasing).x).toBeGreaterThan(intent(mid, neutral).x + 2);
    expect(intent(centreBack, chasing).x).toBeCloseTo(intent(centreBack, neutral).x, 5);
  });
});
