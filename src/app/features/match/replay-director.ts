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

/** Camera of the celebration close-up, in scene coordinates. */
export interface HeroShot { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number; fov: number; /** 0 to 1: how far the close-up has taken over from the match camera. */ blend: number }

const smoothstep = (value: number, from: number, to: number) => { const t = Math.min(1, Math.max(0, (value - from) / (to - from))); return t * t * (3 - 2 * t); };

/**
 * The scorer's moment: the camera drops to chest height in front of him, circles slowly while he runs off, and pulls
 * back and up as his team-mates arrive, so the group ends up in the picture. `heading` is the direction he runs in.
 */
export function celebrationShot(elapsed: number, x: number, z: number, heading: number, out: HeroShot): HeroShot {
  const wide = smoothstep(elapsed, 1.3, 2.3);
  const orbit = heading + 0.55 - elapsed * 0.3;
  const reach = 5.2 + wide * 3.2;
  out.x = x + Math.cos(orbit) * reach;
  out.y = 1.25 + wide * 1.1;
  out.z = z + Math.sin(orbit) * reach;
  out.lookX = x; out.lookY = 1.02 - wide * 0.1; out.lookZ = z;
  out.fov = 36 + wide * 4;
  out.blend = smoothstep(elapsed, 0.1, 0.8);
  return out;
}
