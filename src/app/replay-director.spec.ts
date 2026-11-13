import { flashLit, pickReplayShot } from './features/match/replay-director';
import type { MatchSnapshot } from './models/match.model';

const LENGTH = 105, WIDTH = 68;

/** A replay of `count` frames; `at(index)` describes the ball and the scorer in each. */
function replay(count: number, at: (index: number) => { x: number; y: number; owned: boolean; action?: string }): MatchSnapshot[] {
  return Array.from({ length: count }, (_, index) => {
    const frame = at(index);
    return {
      ball: { x: frame.x, y: frame.y, z: 0.11, vx: 0, vy: 0, vz: 0, spin: 0, ownerId: frame.owned ? 'scorer' : null, controlledTouch: 0 },
      players: [{ id: 'scorer', action: frame.action ?? 'carry' }],
    } as unknown as MatchSnapshot;
  });
}

describe('Replay director', () => {
  it('falls back to the broadcast camera without a scorer or frames', () => {
    expect(pickReplayShot([], 'scorer', LENGTH, WIDTH)).toBe('broadcast');
    expect(pickReplayShot(replay(10, () => ({ x: 100, y: 34, owned: false })), null, LENGTH, WIDTH)).toBe('broadcast');
  });

  it('watches a long-range strike from behind the goal', () => {
    const frames = replay(120, (index) => index < 60 ? { x: 75, y: 30, owned: true } : { x: 75 + (index - 60) * 0.5, y: 32, owned: false });
    expect(pickReplayShot(frames, 'scorer', LENGTH, WIDTH)).toBe('behind-goal');
  });

  it('shows headers and volleys from the low touchline camera', () => {
    const frames = replay(120, (index) => ({ x: 96 + index * 0.08, y: 34, owned: false, action: index > 80 && index < 100 ? 'header' : 'jog' }));
    expect(pickReplayShot(frames, 'scorer', LENGTH, WIDTH)).toBe('touchline');
    const volley = replay(120, (index) => ({ x: 96 + index * 0.08, y: 34, owned: false, action: index > 80 ? 'side-volley' : 'jog' }));
    expect(pickReplayShot(volley, 'scorer', LENGTH, WIDTH)).toBe('touchline');
  });

  it('chases a solo run and separates central from wide close finishes', () => {
    const solo = replay(360, (index) => index < 340 ? { x: 50 + index * 0.13, y: 34, owned: true } : { x: 95 + (index - 340) * 0.5, y: 34, owned: false });
    expect(pickReplayShot(solo, 'scorer', LENGTH, WIDTH)).toBe('chase');
    const central = replay(120, (index) => index < 60 ? { x: 93, y: 36, owned: index > 20 } : { x: 93 + (index - 60) * 0.2, y: 35, owned: false });
    expect(pickReplayShot(central, 'scorer', LENGTH, WIDTH)).toBe('behind-goal');
    const wide = replay(120, (index) => index < 60 ? { x: 95, y: 18, owned: index > 20 } : { x: 95 + (index - 60) * 0.2, y: 30, owned: false });
    expect(pickReplayShot(wide, 'scorer', LENGTH, WIDTH)).toBe('touchline');
  });

  it('attacks the goal the ball ended in, also on the left', () => {
    const frames = replay(120, (index) => index < 60 ? { x: 30, y: 30, owned: true } : { x: 30 - (index - 60) * 0.5, y: 32, owned: false });
    expect(pickReplayShot(frames, 'scorer', LENGTH, WIDTH)).toBe('behind-goal');
  });

  it('flickers a small, changing share of the camera flashes', () => {
    const lit = (seconds: number) => Array.from({ length: 200 }, (_, index) => flashLit(index, seconds));
    const first = lit(1), later = lit(1.5);
    const count = first.filter(Boolean).length;
    expect(count).toBeGreaterThan(2);
    expect(count).toBeLessThan(40);
    expect(first).not.toEqual(later);
    // Stable inside one flicker step, so a bulb is lit for more than a single frame.
    expect(lit(1.001)).toEqual(first);
  });
});

import { HeroShot, celebrationShot } from './features/match/replay-director';

describe('Celebration close-up', () => {
  const shot = (elapsed: number, heading = 0): HeroShot => celebrationShot(elapsed, 10, -5, heading, { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0, fov: 0, blend: 0 });
  const reach = (hero: HeroShot) => Math.hypot(hero.x - 10, hero.z + 5);

  it('takes over from the match camera within a second and looks at the scorer', () => {
    expect(shot(0).blend).toBe(0);
    expect(shot(0.4).blend).toBeGreaterThan(0.2);
    expect(shot(1).blend).toBe(1);
    const hero = shot(1);
    expect([hero.lookX, hero.lookZ]).toEqual([10, -5]);
    expect(hero.lookY).toBeGreaterThan(0.9);
  });

  it('starts close at chest height in front of him and pulls back and up for the group', () => {
    const close = shot(0.8), wide = shot(2.4);
    expect(reach(close)).toBeLessThan(5.8);
    expect(close.y).toBeLessThan(1.5);
    // In front: on the side he runs towards.
    expect(close.x - 10).toBeGreaterThan(2);
    expect(reach(wide)).toBeGreaterThan(reach(close) + 2.5);
    expect(wide.y).toBeGreaterThan(close.y + 0.8);
    expect(wide.fov).toBeGreaterThan(close.fov);
  });

  it('circles him as the seconds pass and follows the way he runs', () => {
    const early = shot(0.5), later = shot(2);
    expect(Math.atan2(early.z + 5, early.x - 10)).not.toBeCloseTo(Math.atan2(later.z + 5, later.x - 10), 1);
    const turned = shot(0.8, Math.PI);
    expect(turned.x - 10).toBeLessThan(-2);
  });
});
