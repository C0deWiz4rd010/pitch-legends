import { FIELD_LENGTH, FIELD_WIDTH } from '../../../core/football/match-types';
import { PlayerRuntimeSnapshot } from '../../../models/match.model';
import { poseFootballer, ProceduralFootballer } from '../three-player.factory';

/**
 * The referee: a purely visual figure built by the same player factory, in black. He is not part of the
 * simulation (no collisions, no decisions); he keeps a few metres from the ball and jogs after it, posed by the
 * same locomotion as the players, so he never slides or teleports.
 *
 * Everything here is in camera space (metres from the centre spot), the space the renderer already draws in.
 */
export class RefereeRig {
  private x = -6;
  private y = 8;
  private vx = 0;
  private vy = 0;
  private facingX = 1;
  private facingY = 0;
  private distance = 0;
  private readonly state: PlayerRuntimeSnapshot = {
    id: 'referee', side: 'home', x: 0, y: 0, homeX: 0, homeY: 0, vx: 0, vy: 0, facingX: 1, facingY: 0, fitness: 100, active: true,
    card: 'none', action: 'idle', actionStartedTick: 0, decisionCooldown: 0, skillCooldown: 0, tackleCooldown: 0, intentX: 0, intentY: 0, animationDistance: 0,
  };
  private readonly lookAt = { x: 0, y: 0 };

  constructor(readonly model: ProceduralFootballer) {}

  /** Moves towards a spot about 9 m behind the ball on the side of the pitch centre; `seconds` is simulation time. */
  update(ballX: number, ballY: number, seconds: number, poseClock: number, tick: number, reducedMotion: boolean): void {
    if (seconds > 0) {
      const towardsCentre = ballX > 0 ? -1 : 1;
      const targetX = ballX + towardsCentre * 9;
      const targetY = ballY + (ballY > 0 ? -1 : 1) * 7;
      const dx = Math.max(-FIELD_LENGTH / 2 + 1, Math.min(FIELD_LENGTH / 2 - 1, targetX)) - this.x;
      const dy = Math.max(-FIELD_WIDTH / 2 + 1, Math.min(FIELD_WIDTH / 2 - 1, targetY)) - this.y;
      const gap = Math.hypot(dx, dy);
      // He jogs after play at up to 5.5 m/s and stands still when he is where he wants to be.
      const wanted = gap < 1.6 ? 0 : Math.min(5.5, gap * 0.9);
      const tx = gap > 0.001 ? dx / gap * wanted : 0, ty = gap > 0.001 ? dy / gap * wanted : 0;
      const blend = Math.min(1, seconds * 3);
      this.vx += (tx - this.vx) * blend;
      this.vy += (ty - this.vy) * blend;
      this.x += this.vx * seconds;
      this.y += this.vy * seconds;
      this.distance += Math.hypot(this.vx, this.vy) * seconds;
    }
    const speed = Math.hypot(this.vx, this.vy);
    // Walking he faces where he is going; standing he watches the ball.
    const fx = speed > 0.6 ? this.vx / speed : ballX - this.x;
    const fy = speed > 0.6 ? this.vy / speed : ballY - this.y;
    const length = Math.hypot(fx, fy);
    if (length > 0.001) {
      const turn = Math.min(1, seconds * 8 + 0.02);
      this.facingX += (fx / length - this.facingX) * turn;
      this.facingY += (fy / length - this.facingY) * turn;
      const norm = Math.hypot(this.facingX, this.facingY) || 1;
      this.facingX /= norm; this.facingY /= norm;
    }
    const state = this.state;
    state.x = this.x; state.y = this.y; state.vx = this.vx; state.vy = this.vy;
    state.facingX = this.facingX; state.facingY = this.facingY;
    state.animationDistance = this.distance;
    state.action = speed > 5 ? 'sprint' : speed > 0.3 ? 'jog' : 'idle';
    this.lookAt.x = ballX; this.lookAt.y = ballY;
    this.model.mesh.position.set(this.x, 0, this.y);
    this.model.mesh.rotation.y = Math.atan2(this.facingX, this.facingY);
    poseFootballer(this.model, state, tick, poseClock, reducedMotion, 0, this.lookAt);
  }

  destroy(): void {
    this.model.destroy();
  }
}
