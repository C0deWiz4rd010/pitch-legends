import { clamp } from '../util';
import { ArcadeActor, FIELD_LENGTH, distance, len2 } from './match-types';

/** Distance to the nearest active opponent; 99 when nobody is on the pitch. */
export function closestOpponentDistance(actor: ArcadeActor, actors: readonly ArcadeActor[]): number {
  let best = 99;
  for (const candidate of actors) {
    if (!candidate.active || candidate.side === actor.side) continue;
    const gap = distance(actor, candidate);
    if (gap < best) best = gap;
  }
  return best;
}

/** Offside position when the ball is played: opponent half, beyond the second-last defender and the passer. */
export function isOffsidePosition(target: ArcadeActor, passer: ArcadeActor, actors: readonly ArcadeActor[], direction: 1 | -1): boolean {
  if ((direction > 0 && target.x < FIELD_LENGTH / 2) || (direction < 0 && target.x > FIELD_LENGTH / 2)) return false;
  // The second-last defender, found in one pass without building and sorting a list for every pass option.
  let first = direction > 0 ? -Infinity : Infinity, second = first, count = 0;
  for (const actor of actors) {
    if (!actor.active || actor.side === passer.side) continue;
    count++;
    if (direction > 0) { if (actor.x > first) { second = first; first = actor.x; } else if (actor.x > second) second = actor.x; }
    else if (actor.x < first) { second = first; first = actor.x; } else if (actor.x < second) second = actor.x;
  }
  if (count < 2) return false;
  return direction > 0 ? target.x > second && target.x > passer.x : target.x < second && target.x < passer.x;
}

/** Number of opponents within 2.2 m of the straight pass corridor. */
export function passLanePressure(from: ArcadeActor, to: { x: number; y: number }, actors: readonly ArcadeActor[]): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length2 = dx * dx + dy * dy || 1;
  let pressure = 0;
  for (const opponent of actors) {
    if (!opponent.active || opponent.side === from.side) continue;
    const t = clamp(((opponent.x - from.x) * dx + (opponent.y - from.y) * dy) / length2, 0, 1);
    const px = from.x + dx * t;
    const py = from.y + dy * t;
    if (len2(opponent.x - px, opponent.y - py) < 2.2) pressure++;
  }
  return pressure;
}
