import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { ArcadeActor, FIELD_LENGTH } from './core/football/match-types';
import { createPracticeTeams } from './core/football/practice';
import { isOffsidePosition } from './core/football/pitch-analysis';
import { tacticalIntent } from './core/football/tactical-intent';
import { actionValue, dribbleSuccess, expectedThreat, passCompletion } from './core/football/xt';
import { EMPTY_MATCH_COMMAND } from './models/match.model';

type Spec = { side: 'home' | 'away'; index: number; x: number; y: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internals = (match: ArcadeMatch) => match as unknown as Record<string, any>;

function outfield(match: ArcadeMatch, side: 'home' | 'away'): ArcadeActor[] {
  return match.actors.filter(actor => actor.side === side && actor.player.positionGroup !== 'GK');
}

function stage(specs: Spec[], extra: Partial<ConstructorParameters<typeof ArcadeMatch>[2] & object> = {}) {
  const { home, away } = createPracticeTeams();
  const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: 'auto', seed: 9931, fixtureId: 'ai-v3', controlledTeamId: home.id,
    halfMinutes: 3, difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'keyboard',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, ...extra });
  match.rule.phase = 'playing';
  match.tick = 100;
  const placed = specs.map(spec => {
    const actor = outfield(match, spec.side)[spec.index];
    Object.assign(actor, { x: spec.x, y: spec.y, homeX: spec.x, homeY: spec.y, vx: 0, vy: 0, intentX: spec.x, intentY: spec.y, decisionCooldown: 100, stamina: 100 });
    return actor;
  });
  for (const actor of match.actors) actor.active = placed.includes(actor);
  Object.assign(match.ball, { ownerId: null, x: 50, y: 34, z: 0.11, vx: 0, vy: 0, vz: 0, controlledTouch: 1, lastTouchPlayerId: null });
  return { match, placed, home, away };
}

describe('Phase 3 – expected threat', () => {
  it('rises towards the opponent\'s goal and favours the centre close to it', () => {
    expect(expectedThreat(10, 34, 1)).toBeLessThan(expectedThreat(60, 34, 1));
    expect(expectedThreat(60, 34, 1)).toBeLessThan(expectedThreat(98, 34, 1));
    expect(expectedThreat(100, 34, 1)).toBeGreaterThan(expectedThreat(100, 3, 1) * 1.3);
    // The same spot is worth the same for the side attacking the other way.
    expect(expectedThreat(FIELD_LENGTH - 98, 34, -1)).toBeCloseTo(expectedThreat(98, 34, 1), 10);
  });

  it('values a safe step forward above a risky long ball and a lost ball below zero', () => {
    const here = expectedThreat(50, 34, 1);
    const safe = actionValue(passCompletion(0, 10, 6), expectedThreat(60, 34, 1) - here, here);
    const risky = actionValue(passCompletion(1, 36, 1), expectedThreat(86, 34, 1) - here, here);
    expect(safe).toBeGreaterThan(0);
    expect(passCompletion(1, 36, 1)).toBeLessThan(passCompletion(0, 10, 6));
    expect(risky).toBeLessThan(actionValue(1, expectedThreat(86, 34, 1) - here, here));
    expect(actionValue(0, 0.1, here)).toBeLessThan(0);
    expect(dribbleSuccess(85, 6)).toBeGreaterThan(dribbleSuccess(60, 1.5));
  });
});

describe('Phase 3 – the carrier chooses by value', () => {
  it('prefers the free team-mate further up the pitch and ignores a blocked lane', () => {
    const { match, placed } = stage([
      { side: 'home', index: 0, x: 50, y: 34 }, { side: 'home', index: 1, x: 66, y: 28 }, { side: 'home', index: 2, x: 58, y: 44 },
      { side: 'away', index: 0, x: 57, y: 33 },
    ]);
    const [carrier, ahead, blocked] = placed;
    Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
    // An opponent stands right on the way to the nearer, deeper team-mate.
    placed[3].x = 54; placed[3].y = 39;
    const direction = internals(match)['attackDirection']('home') as number;
    const option = internals(match)['bestPassOption'](carrier, direction) as { target: ArcadeActor } | null;
    expect(option).not.toBeNull();
    expect(option!.target.player.id).not.toBe(blocked.player.id);
    expect([ahead.player.id, blocked.player.id]).toContain(option!.target.player.id);
  });

  it('plays the pass to the chosen team-mate', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 50, y: 34 }, { side: 'home', index: 1, x: 62, y: 20 }, { side: 'home', index: 2, x: 62, y: 48 }]);
    const [carrier, , chosen] = placed;
    Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
    internals(match)['pass'](carrier, false, false, 0.5, 1, 0, chosen);
    expect(internals(match)['intendedReceiverId']).toBe(chosen.player.id);
  });
});

describe('Phase 3 – team shape without the ball', () => {
  const direction = (match: ArcadeMatch) => internals(match)['attackDirection']('home') as 1 | -1;

  it('gives every man-marker a different opponent', () => {
    const { match, placed, home } = stage([
      { side: 'home', index: 0, x: 40, y: 32 }, { side: 'home', index: 1, x: 40, y: 33 },
      { side: 'home', index: 2, x: 58, y: 34 }, { side: 'home', index: 3, x: 60, y: 30 }, { side: 'home', index: 4, x: 62, y: 38 }, { side: 'home', index: 5, x: 60, y: 34 },
      { side: 'away', index: 0, x: 38, y: 30 }, { side: 'away', index: 1, x: 38, y: 40 }, { side: 'away', index: 2, x: 70, y: 34 },
    ]);
    for (const slot of home.formation.slots) slot.instruction.marking = 'man';
    const [first, second] = placed;
    const carrier = placed[8];
    Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
    const a = tacticalIntent(first, carrier, match.ball, match.actors, home, direction(match), 500);
    const b = tacticalIntent(second, carrier, match.ball, match.actors, home, direction(match), 500);
    // Both defenders' posts are nearest to the opponent at y = 30; only one of them may pick him up.
    expect(Math.abs(a.y - b.y)).toBeGreaterThan(4);
  });

  it('sends one more player after a carrier on the touchline, but not against an easy side', () => {
    const run = (carrierY: number, level: 'easy' | 'normal') => {
      const { match, placed, home } = stage([
        { side: 'home', index: 0, x: 52, y: 34 }, { side: 'home', index: 1, x: 54, y: 34 }, { side: 'home', index: 2, x: 58, y: 34 }, { side: 'home', index: 3, x: 66, y: 34 },
        { side: 'away', index: 0, x: 45, y: carrierY },
      ]);
      const carrier = placed[4];
      Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
      return tacticalIntent(placed[2], carrier, match.ball, match.actors, home, direction(match), 600 + carrierY, level).action;
    };
    expect(run(34, 'normal')).not.toBe('support-press');
    expect(run(3, 'normal')).toBe('support-press');
    expect(run(3, 'easy')).not.toBe('support-press');
  });

  it('covers the passing lane against the most dangerous opponent of the zone', () => {
    const run = (level: 'easy' | 'normal') => {
      const { match, placed, home } = stage([
        { side: 'home', index: 0, x: 30, y: 34 },
        { side: 'home', index: 1, x: 44, y: 20 }, { side: 'home', index: 2, x: 46, y: 48 }, { side: 'home', index: 3, x: 50, y: 34 },
        { side: 'away', index: 0, x: 62, y: 34 }, { side: 'away', index: 1, x: 40, y: 38 },
      ]);
      const carrier = placed[4];
      Object.assign(match.ball, { ownerId: carrier.player.id, x: carrier.x, y: carrier.y });
      return tacticalIntent(placed[0], carrier, match.ball, match.actors, home, direction(match), 700, level);
    };
    const normal = run('normal'), easy = run('easy');
    expect(Math.hypot(normal.x - easy.x, normal.y - easy.y)).toBeGreaterThan(1);
  });

  it('keeps a player who closes the ball down aimed at it between decisions', () => {
    const { match, placed } = stage([{ side: 'home', index: 0, x: 40, y: 20 }, { side: 'away', index: 0, x: 90, y: 60 }]);
    const presser = placed[0];
    presser.action = 'press'; presser.actionStartedTick = match.tick;
    Object.assign(match.ball, { ownerId: null, x: 55, y: 30, vx: 0, vy: 0, lastTouch: 'away', lastTouchPlayerId: placed[1].player.id });
    presser.intentX = 0; presser.intentY = 0;
    match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    expect(presser.intentX).toBeCloseTo(55, 0);
    expect(presser.intentY).toBeCloseTo(30, 0);
  });
});

describe('Phase 3 – settings and helpers', () => {
  it('plays the team-mates of the managed side at the chosen level', () => {
    const { match } = stage([{ side: 'home', index: 0, x: 40, y: 34 }], { teammateAi: 'hard', difficulty: 'easy' });
    expect(match.aiLevel('home')).toBe('hard');
    expect(match.aiLevel('away')).toBe('easy');
    expect(stage([{ side: 'home', index: 0, x: 40, y: 34 }]).match.aiLevel('home')).toBe('normal');
  });

  it('finds the offside line exactly like the sorted reference', () => {
    const { match } = stage([{ side: 'home', index: 0, x: 40, y: 34 }]);
    const reference = (target: ArcadeActor, passer: ArcadeActor, actors: readonly ArcadeActor[], direction: 1 | -1) => {
      if ((direction > 0 && target.x < FIELD_LENGTH / 2) || (direction < 0 && target.x > FIELD_LENGTH / 2)) return false;
      const defenders = actors.filter(actor => actor.active && actor.side !== passer.side).map(actor => actor.x).sort((a, b) => a - b);
      if (defenders.length < 2) return false;
      return direction > 0 ? target.x > defenders.at(-2)! && target.x > passer.x : target.x < defenders[1] && target.x < passer.x;
    };
    for (const actor of match.actors) actor.active = true;
    const [passer] = outfield(match, 'home');
    const home = outfield(match, 'home');
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 60; round++) {
      for (const actor of match.actors) actor.x = random() * FIELD_LENGTH;
      const direction = round % 2 === 0 ? 1 : -1;
      for (const target of home.slice(1, 4)) {
        expect(isOffsidePosition(target, passer, match.actors, direction)).toBe(reference(target, passer, match.actors, direction));
      }
    }
  });
});
