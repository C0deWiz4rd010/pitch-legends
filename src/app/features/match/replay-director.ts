import type { MatchSnapshot } from '../../models/match.model';

/** The camera a goal replay is shown from. */
export type ReplayShot = 'broadcast' | 'behind-goal' | 'touchline' | 'chase';

const AERIAL = new Set(['header', 'flying-header', 'bicycle-kick', 'volley', 'side-volley']);

/**
 * Picks the replay camera from what happened: a long-range strike is watched from behind the goal it flies at, a header
 * or volley from the low touchline camera that shows the jump, a solo run from a camera chasing the dribbler, a close
 * finish from behind the goal when it came through the middle and from the touchline when it came from the side.
 */
export function pickReplayShot(frames: readonly MatchSnapshot[], scorerId: string | null, pitchLength: number, pitchWidth: number): ReplayShot {
  if (!frames.length || !scorerId) return 'broadcast';
  // The strike: the last frame in which the scorer still had the ball at his feet.
  let strike = -1;
  for (let index = frames.length - 1; index >= 0; index--) {
    if (frames[index].ball.ownerId === scorerId) { strike = index; break; }
  }
  const last = frames[frames.length - 1];
  const goalX = last.ball.x > pitchLength / 2 ? pitchLength : 0;
  // Struck without being controlled first: look at how the scorer met the ball.
  for (let index = Math.max(0, strike); index < frames.length; index++) {
    const scorer = frames[index].players.find((player) => player.id === scorerId);
    if (scorer && AERIAL.has(scorer.action)) return 'touchline';
  }
  if (strike < 0) return 'behind-goal';
  let carried = 0;
  for (let index = strike; index >= 0 && frames[index].ball.ownerId === scorerId; index--) carried++;
  if (carried >= 150) return 'chase';
  const ball = frames[strike].ball;
  const distance = Math.abs(goalX - ball.x);
  if (distance > 22 * pitchLength / 105) return 'behind-goal';
  return Math.abs(ball.y - pitchWidth / 2) < 8 * pitchWidth / 68 ? 'behind-goal' : 'touchline';
}

/** Camera flashes in the stands after a goal: which of the bulbs is lit at this moment (a short, irregular flicker). */
export function flashLit(index: number, seconds: number): boolean {
  const step = Math.floor(seconds * 16);
  return ((index * 37 + step * 101 + ((index * step) % 7) * 13) % 19) === 0;
}
