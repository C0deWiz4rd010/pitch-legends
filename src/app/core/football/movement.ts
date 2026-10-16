import { len2 } from './match-types';
/** Rotate an orientation through its shortest arc, including an exact half turn. */
export function turnTowards(facingX: number, facingY: number, targetX: number, targetY: number, maxRadians: number): { x: number; y: number } {
  const facing = { facingX, facingY };
  turnFacing(facing, targetX, targetY, maxRadians);
  return { x: facing.facingX, y: facing.facingY };
}

/** In-place form of `turnTowards` for the per-tick movement of every player. */
export function turnFacing(actor: { facingX: number; facingY: number }, targetX: number, targetY: number, maxRadians: number): void {
  const facingX = actor.facingX;
  const facingY = actor.facingY;
  // Works on unit vectors: one atan2 for the signed angle, trigonometry only when the turn is limited.
  const facingLength = len2(facingX, facingY);
  const targetLength = len2(targetX, targetY);
  const cx = facingLength > 0 ? facingX / facingLength : 1;
  const cy = facingLength > 0 ? facingY / facingLength : 0;
  const ux = targetLength > 0 ? targetX / targetLength : 1;
  const uy = targetLength > 0 ? targetY / targetLength : 0;
  const cross = cx * uy - cy * ux;
  const dot = cx * ux + cy * uy;
  // An exact half turn goes counter-clockwise, as before.
  const delta = cross === 0 && dot < 0 ? Math.PI : Math.atan2(cross, dot);
  if (Math.abs(delta) <= maxRadians) {
    actor.facingX = ux;
    actor.facingY = uy;
    return;
  }
  const step = delta > 0 ? maxRadians : -maxRadians;
  const cos = Math.cos(step);
  const sin = Math.sin(step);
  actor.facingX = cx * cos - cy * sin;
  actor.facingY = cx * sin + cy * cos;
}

/** A vector acceleration budget avoids faster acceleration along diagonals. */
export function accelerateTowards(vx: number, vy: number, targetVx: number, targetVy: number, change: number): { x: number; y: number } {
  const dx = targetVx - vx;
  const dy = targetVy - vy;
  const length = len2(dx, dy);
  const scale = length > change ? change / length : 1;
  return { x: vx + dx * scale, y: vy + dy * scale };
}
