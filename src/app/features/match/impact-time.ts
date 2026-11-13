/**
 * Presentation-only time scale after a big moment (woodwork, a flying save): the picture freezes for a few frames, then
 * runs in slow motion and eases back. It scales the wall-clock time fed to the fixed-step loop and never the simulation
 * itself, so every tick stays 1/60 s and the match stays deterministic.
 */
export const IMPACT_TIME = {
  /** Seconds the picture stands still. */
  freeze: 0.09,
  /** Seconds of slow motion after the freeze, and the speed it starts at. */
  slow: 0.55,
  slowScale: 0.4,
  /** Seconds before the next moment may slow the match again. */
  cooldown: 6,
  /** Freeze on the frame the ball crosses the line, before the celebration. */
  goalFreeze: 0.12,
} as const;

export function impactTimeScale(secondsSince: number): number {
  if (!(secondsSince >= 0)) return 1;
  if (secondsSince < IMPACT_TIME.freeze) return 0;
  const progress = (secondsSince - IMPACT_TIME.freeze) / IMPACT_TIME.slow;
  if (progress >= 1) return 1;
  return IMPACT_TIME.slowScale + (1 - IMPACT_TIME.slowScale) * progress * progress;
}
