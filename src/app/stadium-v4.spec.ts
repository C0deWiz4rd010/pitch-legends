import { CROWD_POSES } from './features/match/stadium/crowd';
import { beamOpacity } from './features/match/stadium/ground';
import { END_STAND_START, LONG_STAND_START, mosaicColor, seatRoll, stadiumPlan, stadiumSeats } from './features/match/stadium/stadium-plan';

describe('Stadium and crowd (V5)', () => {
  it('grows from a village pitch to a closed two-tier bowl', () => {
    const plans = [1, 2, 3, 4, 5].map((level) => stadiumPlan(level, 'classic'));
    expect(plans[0].banks).toBe(true);
    expect(plans[0].terrace).toBe(true);
    expect(plans[0].endRows).toBe(0);
    expect(plans[0].roof).toBe('none');
    expect(plans[4].corners).toBe(true);
    expect(plans[4].upperRows).toBeGreaterThan(0);
    expect(plans[4].roof).toBe('all');
    // The biggest ground hangs its lamps under the roof.
    expect(plans[4].mastHeight).toBe(0);
    for (let level = 1; level < 5; level++) {
      const small = plans[level - 1], big = plans[level];
      expect(big.farRows + big.upperRows).toBeGreaterThanOrEqual(small.farRows + small.upperRows);
      expect(big.endRows).toBeGreaterThanOrEqual(small.endRows);
      expect(big.fill).toBeGreaterThan(small.fill);
      expect(stadiumSeats(big, 9, 1).length).toBeGreaterThan(stadiumSeats(small, 9, 1).length);
    }
    // Out-of-range levels fall back to the nearest one; styles shift the rows.
    expect(stadiumPlan(0, 'classic')).toEqual(plans[0]);
    expect(stadiumPlan(9, 'classic')).toEqual(plans[4]);
    expect(stadiumPlan(3, 'compact').farRows).toBeLessThan(stadiumPlan(3, 'bowl').farRows);
    expect(stadiumPlan(4, 'bowl').corners).toBe(true);
  });

  it('seats supporters on the stands, away fans in their block and nobody in the tunnel', () => {
    const plan = stadiumPlan(4, 'classic');
    const seats = stadiumSeats(plan, 21, 0.9);
    expect(seats).toEqual(stadiumSeats(plan, 21, 0.9));
    expect(seats.length).toBeGreaterThan(1500);
    expect(seats.length).toBeLessThan(6000);
    const away = seats.filter((seat) => seat.block === 1);
    expect(away.length).toBeGreaterThan(40);
    expect(away.length).toBeLessThan(seats.length * 0.2);
    for (const seat of away) { expect(seat.x).toBeGreaterThan(END_STAND_START - 1); expect(seat.z).toBeLessThan(-10); }
    for (const seat of seats) {
      // Outside the pitch and its walls, above the ground, on the way round the ground.
      expect(Math.abs(seat.z) >= LONG_STAND_START - 0.01 || Math.abs(seat.x) >= END_STAND_START - 0.01).toBe(true);
      expect(seat.y).toBeGreaterThan(0.3);
      expect(seat.around).toBeGreaterThanOrEqual(0);
      expect(seat.around).toBeLessThanOrEqual(1);
      // The mouth of the players' tunnel stays free.
      expect(seat.z < 0 && seat.y < 0.7 + 3.5 * 0.62 && Math.abs(seat.x) < 3.4 && Math.abs(seat.z) < 46).toBe(false);
    }
    // The camera-side stand is a set of its own, and only the far stand takes part in the mosaic.
    const main = seats.filter((seat) => seat.main);
    expect(main.length).toBeGreaterThan(300);
    for (const seat of main) { expect(seat.z).toBeGreaterThan(0); expect(seat.u).toBe(-1); }
    const mosaic = seats.filter((seat) => seat.u >= 0);
    expect(mosaic.length).toBeGreaterThan(300);
    for (const seat of mosaic) { expect(seat.z).toBeLessThan(0); expect(seat.u).toBeLessThanOrEqual(1); expect(seat.v).toBeLessThanOrEqual(1); }
    // A denser step gives more people; the fill of the plan thins them out.
    expect(stadiumSeats(plan, 21, 0.66).length).toBeGreaterThan(seats.length);
    expect(stadiumSeats({ ...plan, fill: 0.4 }, 21, 0.9).length).toBeLessThan(seats.length * 0.6);
  });

  it('rolls a stable, even number per seat', () => {
    let sum = 0;
    for (let index = 0; index < 4000; index++) {
      const roll = seatRoll(5, index);
      expect(roll).toBe(seatRoll(5, index));
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
      sum += roll;
    }
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
  });

  it('lays the mosaic out in the pattern of the ground', () => {
    for (const pattern of ['solid', 'halves', 'quarters', 'stripe', 'hoops', 'sash', 'chevron'] as const) {
      const seen = new Set<number>();
      for (let u = 0.05; u < 1; u += 0.05) for (let v = 0.05; v < 0.9; v += 0.05) seen.add(mosaicColor(pattern, u, v));
      // Two colours inside, the trim as a frame.
      expect(seen.has(0) && seen.has(1)).toBe(true);
      expect(mosaicColor(pattern, 0.5, 0.95)).toBe(2);
      expect(mosaicColor(pattern, 0.005, 0.5)).toBe(2);
    }
    expect(mosaicColor('halves', 0.3, 0.5)).not.toBe(mosaicColor('halves', 0.7, 0.5));
    expect(mosaicColor('hoops', 0.5, 0.1)).not.toBe(mosaicColor('hoops', 0.5, 0.3));
  });

  it('shows the cones of the floodlights only when they are on, and more in bad weather', () => {
    expect(beamOpacity('day', 'storm')).toBe(0);
    expect(beamOpacity('night', 'clear')).toBeGreaterThan(0);
    expect(beamOpacity('night', 'rain')).toBeGreaterThan(beamOpacity('night', 'clear'));
    expect(beamOpacity('night', 'storm')).toBeGreaterThan(beamOpacity('night', 'rain'));
    expect(beamOpacity('sunset', 'rain')).toBeLessThan(beamOpacity('night', 'rain'));
    expect(beamOpacity('night', 'storm')).toBeLessThan(0.12);
    expect(CROWD_POSES.length).toBe(5);
  });
});
