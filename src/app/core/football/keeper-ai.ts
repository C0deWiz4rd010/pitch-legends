import type { PlayerActionState } from '../../models/match.model';
import { clamp } from '../util';
import { MATCH_TUNING as T } from './tuning';
import { ActiveShot, ArcadeActor, ArcadeBall, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH, distance } from './match-types';

export interface KeeperIntent { action: PlayerActionState; x: number; y: number; }

/** Angle play between the posts, or sweeping a loose ball close to goal. */
export function keeperPositionIntent(keeper: ArcadeActor, ball: ArcadeBall, ballOwned: boolean, direction: 1 | -1, oneOnOne = false): KeeperIntent {
  const goalX = direction > 0 ? 0 : FIELD_LENGTH;
  const ballDepth = Math.abs(ball.x - goalX);
  const sweeper = !ballOwned && ballDepth < 15 && distance(keeper, ball) < 9 && ball.z < 1.3;
  if (sweeper) return { action: 'keeper-rush', x: ball.x + ball.vx * 0.15, y: ball.y + ball.vy * 0.15 };
  // Alone against the carrier he comes well off his line to narrow the angle, but never past the ball.
  const depth = oneOnOne ? clamp(ballDepth * T.keeper.oneOnOneDepth, 2.5, 9) : clamp(ballDepth * 0.11, 1.1, 5);
  const x = goalX + direction * depth;
  const incoming = ball.vx * direction < -3;
  const flight = incoming ? clamp((x - ball.x) / ball.vx, 0, 0.75) : 0;
  const centre = FIELD_WIDTH / 2, reach = GOAL_WIDTH / 2 + 1.04;
  const angleY = centre + (ball.y - centre) * depth / Math.max(depth, ballDepth);
  return { action: 'keeper-ready', x, y: clamp(incoming ? ball.y + ball.vy * flight : angleY, centre - reach, centre + reach) };
}

/**
 * Dive target for a shot that is too wide to meet with a side-step. What he can cover is his reaction time plus the push
 * of the dive in the flight time that is left: a far shot can be reached in either corner, a close one only near the body.
 */
export function keeperDiveTarget(keeper: ArcadeActor, ball: ArcadeBall, shot: ActiveShot | null, skill = 70): { x: number; y: number; z: number } | null {
  if (keeper.action !== 'keeper-ready' || !shot || shot.side === keeper.side || ball.ownerId || Math.abs(ball.vx) <= 8) return null;
  const flight = (keeper.x - ball.x) / ball.vx;
  const targetY = ball.y + ball.vy * flight;
  const lateral = Math.abs(targetY - keeper.y);
  const targetHeight = ball.z + ball.vz * flight - 4.905 * flight * flight;
  if (!(flight > .02 && flight < T.keeper.diveHorizon)) return null;
  const diveSpeed = 5.2 + skill / 38;
  const reaction = T.keeper.reactionBase - skill * T.keeper.reactionPerSkill;
  const cover = T.keeper.diveBodyReach + diveSpeed * clamp(flight - reaction, 0, .34);
  // He goes when the ball asks for it: a dive begun too early is over before the ball arrives.
  if (lateral > .65 && lateral < cover && flight < lateral / diveSpeed + .16 && targetHeight < 2.3 && targetHeight > -.1) {
    return { x: keeper.x, y: targetY, z: clamp(targetHeight, .15, 2.3) };
  }
  return null;
}
