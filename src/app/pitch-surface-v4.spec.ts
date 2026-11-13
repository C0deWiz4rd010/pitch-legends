import { puddleSpots } from './core/football/weather';
import { SCUFF_HEIGHT, SCUFF_WIDTH, stampScuff } from './features/match/pitch-wear';
import { MAX_PUDDLES, bandWidth, mowLean, mowPattern, mowTone, snowCover } from './features/match/pitch-surface';

describe('Pitch surface (V4)', () => {
  it('gives every ground a fixed mowing pattern, and all four occur', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      expect(mowPattern(seed)).toBe(mowPattern(seed));
      seen.add(mowPattern(seed));
    }
    expect([...seen].sort()).toEqual(['checker', 'diagonal', 'rings', 'stripes']);
  });

  it('cuts the pitch into an even number of bands of about 5.5 m', () => {
    for (const length of [105, 100, 42, 30]) {
      const band = bandWidth(length);
      expect(length / band).toBeCloseTo(Math.round(length / band), 6);
      expect(band).toBeGreaterThan(4.5);
      expect(band).toBeLessThan(6.6);
    }
  });

  it('alternates the bands and flips their brightness when the camera changes sides', () => {
    const band = bandWidth(105);
    const a = mowLean('stripes', -52.5 + band * 0.5, 0, 105, 68), b = mowLean('stripes', -52.5 + band * 1.5, 0, 105, 68);
    expect(a.band).toBe(-b.band);
    // From the main stand (camera at +z) neighbouring stripes differ clearly.
    const near = mowTone(a.band, a.x, a.z, 0, 60), nearNext = mowTone(b.band, b.x, b.z, 0, 60);
    expect(Math.abs(near - nearNext)).toBeGreaterThan(0.6);
    // From the opposite side the light band becomes the dark one.
    const far = mowTone(a.band, a.x, a.z, 0, -60), farNext = mowTone(b.band, b.x, b.z, 0, -60);
    expect(Math.sign(near - nearNext)).toBe(-Math.sign(far - farNext));
    // Looking along the stripes (from behind the goal) a faint pattern remains.
    const along = Math.abs(mowTone(a.band, a.x, a.z, 80, 0) - mowTone(b.band, b.x, b.z, 80, 0));
    expect(along).toBeGreaterThan(0.1);
    expect(along).toBeLessThan(Math.abs(near - nearNext));
    for (const pattern of ['stripes', 'checker', 'rings', 'diagonal'] as const) {
      for (const [x, z] of [[3, 4], [-20, 11], [40, -30]]) {
        const lean = mowLean(pattern, x, z, 105, 68);
        expect(Math.hypot(lean.x, lean.z)).toBeCloseTo(1, 6);
        const tone = mowTone(lean.band, lean.x, lean.z, 10, 50);
        expect(tone).toBeGreaterThanOrEqual(0);
        expect(tone).toBeLessThanOrEqual(1);
      }
    }
  });

  it('lets the snow cover grow over the match', () => {
    expect(snowCover(0)).toBeLessThan(snowCover(45));
    expect(snowCover(45)).toBeLessThan(snowCover(90));
    expect(snowCover(200)).toBe(snowCover(90));
    expect(snowCover(90)).toBeLessThanOrEqual(1);
  });

  it('puts puddles at the same seeded spots, only in rain and storm, inside the pitch', () => {
    expect(puddleSpots(7, 'clear', 105, 68)).toEqual([]);
    expect(puddleSpots(7, 'snow', 105, 68)).toEqual([]);
    const rain = puddleSpots(7, 'rain', 105, 68), storm = puddleSpots(7, 'storm', 105, 68);
    expect(rain).toEqual(puddleSpots(7, 'rain', 105, 68));
    expect(rain).not.toEqual(puddleSpots(8, 'rain', 105, 68));
    expect(storm.length).toBeGreaterThan(rain.length);
    expect(storm.length).toBeLessThanOrEqual(MAX_PUDDLES);
    for (const puddle of [...rain, ...storm]) {
      expect(puddle.x).toBeGreaterThan(5); expect(puddle.x).toBeLessThan(100);
      expect(puddle.y).toBeGreaterThan(4); expect(puddle.y).toBeLessThan(64);
      expect(puddle.radius).toBeGreaterThan(1);
    }
  });

  it('scrapes a smooth streak into the scuff map', () => {
    const data = new Uint8Array(SCUFF_WIDTH * SCUFF_HEIGHT);
    for (let step = 0; step < 20; step++) stampScuff(data, 40 + step * 0.2, 30, 105, 68, 44);
    let touched = 0, peak = 0;
    for (const value of data) { if (value) touched++; peak = Math.max(peak, value); }
    expect(touched).toBeGreaterThan(8);
    expect(touched).toBeLessThan(40);
    expect(peak).toBeGreaterThan(40);
    // Corners of the pitch never write outside the map.
    for (const [x, y] of [[0, 0], [105, 68], [-3, 90], [200, -5]]) stampScuff(data, x, y, 105, 68, 255);
    expect(data.length).toBe(SCUFF_WIDTH * SCUFF_HEIGHT);
  });
});
