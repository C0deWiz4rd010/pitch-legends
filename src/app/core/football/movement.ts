/** Rotate an orientation through its shortest arc, including an exact half turn. */
export function turnTowards(facingX: number, facingY: number, targetX: number, targetY: number, maxRadians: number): { x: number; y: number } {
  const current = Math.atan2(facingY, facingX);
  const target = Math.atan2(targetY, targetX);
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const angle = current + Math.max(-maxRadians, Math.min(maxRadians, delta));
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** A vector acceleration budget avoids faster acceleration along diagonals. */
export function accelerateTowards(vx: number, vy: number, targetVx: number, targetVy: number, change: number): { x: number; y: number } {
  const dx = targetVx - vx;
  const dy = targetVy - vy;
  const length = Math.hypot(dx, dy);
  const scale = length > change ? change / length : 1;
  return { x: vx + dx * scale, y: vy + dy * scale };
}
