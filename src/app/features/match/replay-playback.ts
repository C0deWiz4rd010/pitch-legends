/** Replay timing: 0.65x speed, slowing to 0.3x for the last 1.5 s before the goal (constant with reduced motion). */
export function replayPlayback(frameCount: number, elapsed: number, reducedMotion: boolean): { cursor: number; done: boolean } {
  const last = Math.max(0, frameCount - 1);
  const slowFrames = reducedMotion ? 0 : Math.min(90, last);
  const fastFrames = last - slowFrames;
  const fastSeconds = fastFrames / 60 / 0.65;
  const slowSeconds = slowFrames / 60 / 0.3;
  const total = Math.max(1, fastSeconds + slowSeconds);
  if (elapsed >= total) return { cursor: last, done: true };
  const cursor = elapsed < fastSeconds ? elapsed * 60 * 0.65 : fastFrames + (elapsed - fastSeconds) * 60 * 0.3;
  return { cursor: Math.min(last, cursor), done: false };
}
