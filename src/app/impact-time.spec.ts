import { IMPACT_TIME, impactTimeScale } from './features/match/impact-time';

describe('Impact time scale', () => {
  it('freezes, then eases from slow motion back to full speed', () => {
    expect(impactTimeScale(-1)).toBe(1);
    expect(impactTimeScale(Infinity)).toBe(1);
    expect(impactTimeScale(0)).toBe(0);
    expect(impactTimeScale(IMPACT_TIME.freeze + 0.001)).toBeCloseTo(IMPACT_TIME.slowScale, 2);
    const middle = impactTimeScale(IMPACT_TIME.freeze + IMPACT_TIME.slow / 2);
    expect(middle).toBeGreaterThan(IMPACT_TIME.slowScale);
    expect(middle).toBeLessThan(1);
    expect(impactTimeScale(IMPACT_TIME.freeze + IMPACT_TIME.slow)).toBe(1);
  });
});
