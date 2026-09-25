import { clamp } from '../util';

/** Angle quality from the lateral offset to the goal centre: 1 central, 0.25 at the touchline. */
export function shotAngleQuality(lateralOffset: number): number {
  return clamp(1 - Math.abs(lateralOffset) / 31, 0.25, 1);
}

/** Expected-goals estimate for a foot shot; headers use a lower conversion. */
export function shotXg(distanceToGoal: number, lateralOffset: number, finishing: number, pressure: number, header = false): number {
  const base = 0.65 * Math.exp(-distanceToGoal / 13) * shotAngleQuality(lateralOffset) + finishing / 1800 - pressure * 0.025;
  return clamp(header ? base * 0.55 : base, 0.015, 0.75);
}
