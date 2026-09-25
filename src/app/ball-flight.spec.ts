import { BALL_RADIUS, integrateBall, SpinningBall } from './core/football/ball-physics';

const H = 1 / 240;
function ball(overrides: Partial<SpinningBall>): SpinningBall {
  return { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0, spin: 0, topspin: 0, ...overrides };
}
function fly(state: SpinningBall, seconds: number, wet = false): SpinningBall {
  for (let t = 0; t < seconds; t += H) integrateBall(state, H, wet);
  return state;
}
function carry(topspin: number): number {
  const state = ball({ z: BALL_RADIUS + 0.01, vx: 28, vz: 5, topspin });
  for (let i = 0; i < 2400 && !(state.z <= BALL_RADIUS && state.vz === 0 && i > 10); i++) {
    integrateBall(state, H, false);
    if (state.z <= BALL_RADIUS + 1e-9 && i > 10) break;
  }
  return state.x;
}

describe('Ball flight', () => {
  it('curls perpendicular to the direction of travel, whichever way the ball flies', () => {
    const east = fly(ball({ z: 1.2, vx: 25, vz: 2, spin: 5 }), 0.5);
    const west = fly(ball({ z: 1.2, vx: -25, vz: 2, spin: 5 }), 0.5);
    const north = fly(ball({ z: 1.2, vy: 25, vz: 2, spin: 5 }), 0.5);
    expect(east.y).toBeGreaterThan(0.5);
    expect(west.y).toBeLessThan(-0.5);
    expect(north.x).toBeLessThan(-0.5);
    expect(Math.abs(east.y)).toBeCloseTo(Math.abs(north.x), 6);
  });

  it('lets side spin fade in the air', () => {
    const state = fly(ball({ z: 30, vx: 20, spin: 5 }), 1);
    expect(state.spin).toBeLessThan(4.1);
    expect(state.spin).toBeGreaterThan(3.9);
  });

  it('loses energy on every bounce and grips more on dry turf', () => {
    const dry = ball({ z: BALL_RADIUS, vx: 10, vz: -6 });
    const wet = ball({ z: BALL_RADIUS, vx: 10, vz: -6 });
    integrateBall(dry, H, false);
    integrateBall(wet, H, true);
    expect(dry.vz).toBeGreaterThan(0);
    expect(dry.vz).toBeLessThan(6);
    expect(dry.vx).toBeLessThan(wet.vx);
    expect(wet.vx).toBeLessThan(10);
  });

  it('stops a slow rolling ball quickly while a firm pass keeps its range', () => {
    const slow = fly(ball({ z: BALL_RADIUS, vx: 3 }), 6);
    const firm = fly(ball({ z: BALL_RADIUS, vx: 15 }), 10);
    expect(slow.vx).toBe(0);
    expect(slow.x).toBeLessThan(5);
    expect(firm.x).toBeGreaterThan(22);
    expect(firm.x).toBeLessThan(30);
    const wetFirm = fly(ball({ z: BALL_RADIUS, vx: 15 }), 10, true);
    expect(wetFirm.x).toBeGreaterThan(firm.x);
  });

  it('makes topspin dip earlier and backspin float further', () => {
    expect(carry(4)).toBeLessThan(carry(0) - 1);
    expect(carry(-3)).toBeGreaterThan(carry(0) + 0.5);
  });
});
