import { clamp } from '../util';
import { ArcadeActor, FIELD_LENGTH, distance } from './match-types';

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
  const defenders = actors.filter((actor) => actor.active && actor.side !== passer.side).map((actor) => actor.x).sort((a, b) => a - b);
  if (defenders.length < 2) return false;
  return direction > 0 ? target.x > defenders.at(-2)! && target.x > passer.x : target.x < defenders[1] && target.x < passer.x;
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
    if (Math.hypot(opponent.x - px, opponent.y - py) < 2.2) pressure++;
  }
  return pressure;
}
