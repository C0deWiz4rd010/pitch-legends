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
