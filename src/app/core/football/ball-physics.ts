export const BALL_RADIUS = 0.11;
const FRAME_RADIUS = 0.06;

export interface MovingBall { x: number; y: number; z: number; vx: number; vy: number; vz: number; }

/** Resolve both posts and the crossbar before checking the goal line. */
export function collideGoalFrame(ball: MovingBall, goalX: number, goalCentre: number, width: number, height: number): boolean {
  const reach = BALL_RADIUS + FRAME_RADIUS;
  if (Math.abs(ball.x - goalX) > reach) return false;
  let hit = false;
  for (const postY of [goalCentre - width / 2, goalCentre + width / 2]) {
    if (ball.z > height + reach) continue;
    const dx = ball.x - goalX;
    const dy = ball.y - postY;
    const length = Math.hypot(dx, dy);
    if (length >= reach) continue;
    const nx = length > 0.00001 ? dx / length : -Math.sign(ball.vx || 1);
    const ny = length > 0.00001 ? dy / length : 0;
    const incoming = ball.vx * nx + ball.vy * ny;
    if (incoming >= 0) continue;
    ball.x = goalX + nx * reach;
    ball.y = postY + ny * reach;
    ball.vx -= incoming * nx * 1.72;
    ball.vy -= incoming * ny * 1.72;
    hit = true;
  }
  if (Math.abs(ball.y - goalCentre) < width / 2 + FRAME_RADIUS) {
    const dx = ball.x - goalX;
    const dz = ball.z - height;
    const length = Math.hypot(dx, dz);
    if (length < reach) {
      const nx = length > 0.00001 ? dx / length : -Math.sign(ball.vx || 1);
      const nz = length > 0.00001 ? dz / length : 0;
      const incoming = ball.vx * nx + ball.vz * nz;
      if (incoming < 0) {
        ball.x = goalX + nx * reach;
        ball.z = height + nz * reach;
        ball.vx -= incoming * nx * 1.72;
        ball.vz -= incoming * nz * 1.72;
        hit = true;
      }
    }
  }
  return hit;
}
