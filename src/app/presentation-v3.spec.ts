import { lightningFlash } from './features/match/three-pitch.renderer';

describe('Phase 5 – presentation', () => {
  it('flashes once per nine-second window, for under half a second, and never outside 0 to 1', () => {
    for (let window = 0; window < 20; window++) {
      let lit = 0;
      for (let i = 0; i < 900; i++) {
        const flash = lightningFlash(window * 9 + i / 100);
        expect(flash).toBeGreaterThanOrEqual(0);
        expect(flash).toBeLessThanOrEqual(1);
        if (flash > 0) lit++;
      }
      // Half a second at 100 samples per second; the bolt is inside the window, never split by its edge.
      expect(lit).toBeGreaterThan(30);
      expect(lit).toBeLessThanOrEqual(50);
    }
  });

  it('is the same light for the same time, and bolts do not all fall at the same moment of their window', () => {
    expect(lightningFlash(12.34)).toBe(lightningFlash(12.34));
    const starts = new Set<number>();
    for (let window = 0; window < 20; window++) {
      for (let i = 0; i < 900; i++) if (lightningFlash(window * 9 + i / 100) > 0) { starts.add(Math.round(i / 100)); break; }
    }
    expect(starts.size).toBeGreaterThan(2);
  });
});
