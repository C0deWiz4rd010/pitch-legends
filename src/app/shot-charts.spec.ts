import { shotMarker, xgAxisEnd, xgPath, xgSteps } from './shared/components/shot-charts';
import { INTRO_SECONDS, INTRO_SECONDS_REDUCED, introLineUpTime, introPlacement, introShot } from './features/match/intro-director';
import type { ShotRecord } from './models/match.model';

const shot = (side: 'home' | 'away', minute: number, xG: number, goal = false, x = 90, y = 34): ShotRecord => ({ side, minute, xG, goal, x, y, playerId: 'p' });

describe('Shot charts', () => {
  const shots = [shot('home', 5, 0.1), shot('away', 12, 0.3), shot('home', 30, 0.45, true), shot('home', 70, 0.08)];

  it('adds up each side shot by shot', () => {
    expect(xgSteps(shots, 'home').map((step) => step.total)).toEqual([0.1, 0.55, 0.63]);
    expect(xgSteps(shots, 'away')).toEqual([{ minute: 12, total: 0.3, goal: false }]);
    expect(xgSteps(shots, 'home')[1].goal).toBe(true);
  });

  it('runs the time axis to the minute reached, or later shots', () => {
    expect(xgAxisEnd([], 45)).toBe(45);
    expect(xgAxisEnd([], 3)).toBe(15);
    expect(xgAxisEnd([shot('home', 93, 0.2)], 90)).toBe(93);
  });

  it('draws a stepped line that only ever rises and ends at the right edge', () => {
    const path = xgPath(xgSteps(shots, 'home'), 90, 1, 300, 100);
    expect(path.startsWith('M0 100')).toBe(true);
    const points = [...path.matchAll(/L([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let index = 1; index < points.length; index++) {
      expect(points[index][0]).toBeGreaterThanOrEqual(points[index - 1][0]);
      expect(points[index][1]).toBeLessThanOrEqual(points[index - 1][1]);
    }
    expect(points.at(-1)![0]).toBe(300);
  });

  it('puts the away side on the other half of the shot map and sizes dots by the chance', () => {
    const home = shotMarker(shot('home', 1, 0.5, false, 95, 30)), away = shotMarker(shot('away', 1, 0.05, false, 95, 30));
    expect(home.x).toBe(95);
    expect(away.x).toBe(10);
    expect(away.y).toBe(38);
    expect(home.r).toBeGreaterThan(away.r);
  });
});

describe('Walk-on', () => {
  it('has every player in the line before the camera leaves', () => {
    expect(introLineUpTime()).toBeLessThan(INTRO_SECONDS - 0.8);
    for (let index = 0; index < 11; index++) {
      for (const home of [true, false]) expect(introPlacement(index, home, INTRO_SECONDS).arrived).toBe(true);
    }
  });

  it('lines the home side up left of the centre and the away side right, nobody on the same spot', () => {
    const spots = new Set<string>();
    for (let index = 0; index < 11; index++) {
      const home = introPlacement(index, true, INTRO_SECONDS), away = introPlacement(index, false, INTRO_SECONDS);
      expect(home.x).toBeLessThan(0);
      expect(away.x).toBeGreaterThan(0);
      spots.add(home.x.toFixed(2)); spots.add(away.x.toFixed(2));
    }
    expect(spots.size).toBe(22);
  });

  it('starts at the tunnel, moves the camera smoothly and holds one picture with reduced motion', () => {
    expect(introPlacement(0, true, 0).arrived).toBe(false);
    let previous = introShot(0, false);
    for (let t = 0.05; t <= INTRO_SECONDS; t += 0.05) {
      const shot = introShot(t, false);
      expect(Math.hypot(shot.x - previous.x, shot.y - previous.y, shot.z - previous.z)).toBeLessThan(2.5);
      previous = shot;
    }
    expect(introShot(0.5, true)).toEqual(introShot(2, true));
    expect(INTRO_SECONDS_REDUCED).toBeLessThan(INTRO_SECONDS);
  });
});
