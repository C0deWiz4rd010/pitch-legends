import { clamp } from '../util';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH } from './match-types';

const MINIMUM_GAP = 1.05;

/**
 * Mass-weighted player separation. With at most 22 players a direct pair test with an early
 * axis rejection is cheaper than a spatial grid; each overlapping pair is separated once per tick,
 * the player with the smaller id first, as before.
 */
export class PlayerCollisionGrid {
  /** Opponents who ran into each other this tick faster than `knockSpeed` (reused, refilled by every resolve). */
  readonly contacts: { a: ArcadeActor; b: ArcadeActor; speed: number }[] = [];
  private contactCount = 0;

  resolve(actors: readonly ArcadeActor[], knockSpeed = Infinity): void {
    const count = actors.length;
    this.contactCount = 0;
    for (let first = 0; first < count; first++) {
      const a = actors[first];
      if (!a.active) continue;
      for (let second = first + 1; second < count; second++) {
        const b = actors[second];
        if (!b.active) continue;
        const dx = b.x - a.x;
        if (dx >= MINIMUM_GAP || dx <= -MINIMUM_GAP) continue;
        const dy = b.y - a.y;
        if (dy >= MINIMUM_GAP || dy <= -MINIMUM_GAP) continue;
        const closing = a.player.id < b.player.id ? separate(a, b) : separate(b, a);
        if (closing >= knockSpeed && a.side !== b.side) {
          const slot = this.contacts[this.contactCount] ??= { a, b, speed: 0 };
          slot.a = a; slot.b = b; slot.speed = closing;
          this.contactCount++;
        }
      }
    }
    this.contacts.length = this.contactCount;
  }
}

/** Returns the speed at which the two were closing in on each other (0 when they were not). */
function separate(actor: ArcadeActor, other: ArcadeActor): number {
  const dx = other.x - actor.x;
  const dy = other.y - actor.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared >= MINIMUM_GAP * MINIMUM_GAP) return 0;
  const length = Math.sqrt(lengthSquared) || 0.001;
  const normalX = dx / length;
  const normalY = dy / length;
  const penetration = Math.max(0, MINIMUM_GAP - length - 0.02);
  const push = penetration * 0.78;
  // The strength the player has this tick (form, traits and signatures included), not the raw attribute.
  const massA = 0.75 + (actor.attrs?.physical ?? actor.player.attributes.physical) / 100;
  const massB = 0.75 + (other.attrs?.physical ?? other.player.attributes.physical) / 100;
  const totalMass = massA + massB;
  actor.x = clamp(actor.x - normalX * push * (massB / totalMass), 0.8, FIELD_LENGTH - 0.8);
  actor.y = clamp(actor.y - normalY * push * (massB / totalMass), 0.8, FIELD_WIDTH - 0.8);
  other.x = clamp(other.x + normalX * push * (massA / totalMass), 0.8, FIELD_LENGTH - 0.8);
  other.y = clamp(other.y + normalY * push * (massA / totalMass), 0.8, FIELD_WIDTH - 0.8);
  const closingSpeed = (other.vx - actor.vx) * normalX + (other.vy - actor.vy) * normalY;
  if (closingSpeed < 0) {
    const impulse = -closingSpeed * 0.32;
    actor.vx -= normalX * impulse * (massB / totalMass);
    actor.vy -= normalY * impulse * (massB / totalMass);
    other.vx += normalX * impulse * (massA / totalMass);
    other.vy += normalY * impulse * (massA / totalMass);
  }
  return Math.max(0, -closingSpeed);
}
