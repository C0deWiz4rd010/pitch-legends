export const BALL_RADIUS = 0.11;
const FRAME_RADIUS = 0.06;

export interface MovingBall { x: number; y: number; z: number; vx: number; vy: number; vz: number; }
export interface SpinningBall extends MovingBall { spin: number; topspin: number; }

export const BALL_PHYSICS = {
  gravity: 9.81,
  /** Lateral Magnus acceleration per unit of side spin and metre per second of speed. */
  magnus: 0.048,
  /** Vertical dip (topspin) or lift (backspin) per unit of spin and metre per second. */
  topspinDip: 0.012,
  airDrag: 0.16,
  airSpinDecay: 0.8,
  groundSpinDecay: 0.35,
  restitution: 0.48,
  /** Share of horizontal speed lost on a bounce (dry / wet turf). */
  bounceFriction: { dry: 0.18, wet: 0.1 },
  /** Rolling: proportional drag plus a constant resistance (dry / wet turf). */
  rollingDrag: { dry: 0.45, wet: 0.33 },
  rollingResistance: { dry: 0.3, wet: 0.22 },
} as const;

/**
 * One integration sub-step of free ball flight: gravity, Magnus curl perpendicular to the
 * direction of travel, top/backspin, bounce friction and rolling resistance.
 */
export function integrateBall(ball: SpinningBall, h: number, wet: boolean): void {
  const p = BALL_PHYSICS;
  ball.x += ball.vx * h;
  ball.y += ball.vy * h;
  ball.z += ball.vz * h;
  ball.vz -= p.gravity * h;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (ball.z > BALL_RADIUS) {
    // Side spin bends the ball towards the left of its travel direction (positive) or the right.
    const lateral = ball.spin * p.magnus * h;
    const vx = ball.vx;
    ball.vx -= ball.vy * lateral;
    ball.vy += vx * lateral;
    ball.vz -= ball.topspin * speed * p.topspinDip * h;
    const drag = Math.exp(-p.airDrag * h);
    ball.vx *= drag;
    ball.vy *= drag;
    const decay = Math.pow(p.airSpinDecay, h);
    ball.spin *= decay;
    ball.topspin *= decay;
    return;
  }
  ball.z = BALL_RADIUS;
  if (ball.vz < -1) {
    ball.vz = -ball.vz * p.restitution;
    // Grass grips on impact; topspin kicks forward, backspin checks the ball up.
    const keep = 1 - (wet ? p.bounceFriction.wet : p.bounceFriction.dry) + clampSpin(ball.topspin) * 0.03;
    ball.vx *= keep;
    ball.vy *= keep;
    ball.topspin *= 0.5;
  } else ball.vz = 0;
  if (speed > 0) {
    const drag = Math.exp(-(wet ? p.rollingDrag.wet : p.rollingDrag.dry) * h);
    const resistance = (wet ? p.rollingResistance.wet : p.rollingResistance.dry) * h;
    const next = Math.max(0, speed * drag - (ball.vz === 0 ? resistance : 0));
    ball.vx *= next / speed;
    ball.vy *= next / speed;
  }
  ball.spin *= Math.pow(p.groundSpinDecay, h);
  ball.topspin *= Math.pow(p.groundSpinDecay, h);
}

function clampSpin(value: number): number {
  return Math.max(-4, Math.min(4, value));
}

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
