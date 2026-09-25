import type { PlayerActionState } from '../../models/match.model';
import { clamp } from '../util';
import { ActiveShot, ArcadeActor, ArcadeBall, FIELD_LENGTH, distance } from './match-types';

export interface KeeperIntent { action: PlayerActionState; x: number; y: number; }

/** Angle play between the posts, or sweeping a loose ball close to goal. */
export function keeperPositionIntent(keeper: ArcadeActor, ball: ArcadeBall, ballOwned: boolean, direction: 1 | -1): KeeperIntent {
  const goalX = direction > 0 ? 0 : FIELD_LENGTH;
  const ballDepth = Math.abs(ball.x - goalX);
  const sweeper = !ballOwned && ballDepth < 15 && distance(keeper, ball) < 9 && ball.z < 1.3;
  if (sweeper) return { action: 'keeper-rush', x: ball.x + ball.vx * 0.15, y: ball.y + ball.vy * 0.15 };
  const depth = clamp(ballDepth * 0.11, 1.1, 5);
  const x = goalX + direction * depth;
  const incoming = ball.vx * direction < -3;
  const flight = incoming ? clamp((x - ball.x) / ball.vx, 0, 0.75) : 0;
  const angleY = 34 + (ball.y - 34) * depth / Math.max(depth, ballDepth);
  return { action: 'keeper-ready', x, y: clamp(incoming ? ball.y + ball.vy * flight : angleY, 29.3, 38.7) };
}

/** Dive target for a reachable shot that is too wide to meet with a side-step. */
export function keeperDiveTarget(keeper: ArcadeActor, ball: ArcadeBall, shot: ActiveShot | null): { x: number; y: number; z: number } | null {
  if (keeper.action !== 'keeper-ready' || !shot || shot.side === keeper.side || ball.ownerId || Math.abs(ball.vx) <= 8) return null;
  const flight = (keeper.x - ball.x) / ball.vx;
  const targetY = ball.y + ball.vy * flight;
  const lateral = Math.abs(targetY - keeper.y);
  const targetHeight = ball.z + ball.vz * flight - 4.905 * flight * flight;
  if (flight > .02 && flight < .24 && lateral > .65 && lateral < 1.8 && targetHeight < 2.3 && targetHeight > -.1) {
    return { x: keeper.x, y: targetY, z: clamp(targetHeight, .15, 2.3) };
  }
  return null;
}
