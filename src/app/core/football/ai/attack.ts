import { clamp } from '../../util';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH, distance } from '../match-types';
import type { PlayerPersonality } from '../../../models/player.model';
import type { ArcadeMatch } from '../../services/arcade-match';

/** How a player's character colours his attacking decisions. Neutral is 0 everywhere. */
export interface AttackStyle {
  /** Added to the shot threshold: below 0 shoots earlier, above 0 waits for a better chance. */
  shotBias: number;
  /** How much better a team-mate's chance must be before he lays it off instead of shooting. */
  unselfish: number;
  /** Multiplies the wish to take a defender on or try something cheeky. */
  flair: number;
  /** Multiplies the wish to play a give-and-go. */
  combine: number;
}

const STYLES: Record<PlayerPersonality, AttackStyle> = {
  professional: { shotBias: 0, unselfish: 0.08, flair: 0.8, combine: 1 },
  driven: { shotBias: -0.014, unselfish: 0.13, flair: 1, combine: 0.7 },
  flair: { shotBias: -0.004, unselfish: 0.09, flair: 1.7, combine: 0.9 },
  'team-player': { shotBias: 0.012, unselfish: 0.05, flair: 0.7, combine: 1.6 },
  volatile: { shotBias: -0.008, unselfish: 0.1, flair: 1.3, combine: 0.8 },
};

export function attackStyle(actor: ArcadeActor): AttackStyle {
  return STYLES[actor.player.personality] ?? STYLES.professional;
}

export interface ShotPlan {
  /** Aim across the goal, -1 to 1 (the shot's own scale: ±1 is just inside a post). */
  aimY: number;
  power: number;
  kind: 'placed' | 'finesse' | 'chip' | 'power' | 'normal';
}

/**
 * How the AI takes its chance, from what it sees: where the keeper stands from the shooter's angle decides the corner
 * (the bigger gap between him and a post), how far he has come out allows a chip, a one-on-one is passed into the corner
 * low, a good striker curls it from the edge of the box and anything from distance is hit hard.
 */
export function planShot(m: ArcadeMatch, actor: ArcadeActor, goalDistance: number): ShotPlan {
  const direction = m.attackDirection(actor.side);
  const goalX = direction > 0 ? FIELD_LENGTH : 0;
  const centre = FIELD_WIDTH / 2, half = GOAL_WIDTH / 2;
  const shooting = m.stat(actor, 'shooting');
  const keeper = m.actors.find((other) => other.active && other.side !== actor.side && other.player.positionGroup === 'GK');
  // The keeper as the shooter sees him: projected onto the goal line from the ball.
  let seenY = centre, keeperOut = 0;
  if (keeper) {
    keeperOut = Math.abs(goalX - keeper.x);
    const along = (keeper.x - actor.x) * direction;
    seenY = along > 0.5 ? actor.y + (keeper.y - actor.y) * (goalX - actor.x) / (keeper.x - actor.x) : keeper.y;
  }
  const reach = 0.9 + (keeper ? m.stat(keeper, 'goalkeeping') / 100 * 0.6 : 0);
  // Gaps between the keeper's reach and each post; the shot goes for the bigger one, a little inside the post.
  const low = centre - half, high = centre + half;
  const gapLow = clamp(seenY - reach - low, 0, GOAL_WIDTH), gapHigh = clamp(high - (seenY + reach), 0, GOAL_WIDTH);
  const side = gapHigh >= gapLow ? 1 : -1;
  const gap = Math.max(gapLow, gapHigh);
  const target = side > 0 ? high - Math.min(gap, 2.2) * 0.42 : low + Math.min(gap, 2.2) * 0.42;
  const level = m.aiLevel(actor.side);
  const noise = level === 'easy' ? 0.34 : level === 'hard' ? 0.12 : 0.2;
  const aimY = clamp((target - centre) / (GOAL_WIDTH * 0.43) + m.rng.float(-noise, noise), -1, 1);
  const style = attackStyle(actor);
  const blockersClose = m.closestOpponent(actor) < 3;
  if (keeperOut > 6 && goalDistance > keeperOut + 5 && goalDistance < 30 && shooting > 62 * (2 - style.flair) / 1.2) return { aimY: aimY * 0.6, power: 0.5, kind: 'chip' };
  if (goalDistance < 15 && !blockersClose) return { aimY, power: m.rng.float(0.55, 0.72), kind: 'placed' };
  if (goalDistance > 16 && goalDistance < 28 && shooting > 70) return { aimY, power: m.rng.float(0.58, 0.76), kind: 'finesse' };
  if (goalDistance > 24) return { aimY: aimY * 0.85, power: m.rng.float(0.82, 0.95), kind: 'power' };
  return { aimY, power: m.rng.float(0.55, 0.88), kind: 'normal' };
}

/**
 * Taking a defender on, read from the picture instead of a dice roll: one opponent in front within reach, nobody else
 * close, and room behind him. The move fits the duel: a quicker player knocks it past him, otherwise a roll to the side
 * with more space or a feint to wrong-foot him. Returns the stick direction for the move, or null.
 */
export function aiTakeOn(m: ArcadeMatch, actor: ArcadeActor, pressureDistance: number): { dx: number; dy: number } | null {
  const dribbling = m.stat(actor, 'dribbling');
  if (actor.skillCooldown > 0 || dribbling < 60 || pressureDistance < 1.2 || pressureDistance > 3.4) return null;
  let opponent: ArcadeActor | undefined, second = Infinity;
  for (const other of m.actors) {
    if (!other.active || other.side === actor.side || other.player.positionGroup === 'GK') continue;
    const gap = distance(other, actor);
    if (!opponent || gap < distance(opponent, actor)) { if (opponent) second = Math.min(second, distance(opponent, actor)); opponent = other; }
    else second = Math.min(second, gap);
  }
  if (!opponent || second < 4.2) return null;
  const ahead = (opponent.x - actor.x) * actor.facingX + (opponent.y - actor.y) * actor.facingY;
  if (ahead <= 0) return null;
  // Room behind him in the direction of play.
  const direction = m.attackDirection(actor.side);
  const behindX = opponent.x + direction * 7, behindY = opponent.y;
  for (const other of m.actors) {
    if (other.active && other !== opponent && other.side !== actor.side && distance(other, { x: behindX, y: behindY }) < 4.5) return null;
  }
  const level = m.aiLevel(actor.side);
  const edge = (dribbling - m.stat(opponent, 'defending')) / 100;
  const chance = clamp((0.1 + edge * 0.6) * attackStyle(actor).flair * (level === 'hard' ? 1.5 : level === 'easy' ? 0.5 : 1), 0, 0.45);
  if (!m.rng.bool(chance)) return null;
  const lateral = actor.facingX * (opponent.y - actor.y) - actor.facingY * (opponent.x - actor.x);
  const away = lateral > 0 ? -1 : 1;
  // Quicker and with a run behind him: push it past. Square-on: a feint. Otherwise a roll to the open side.
  if (m.stat(actor, 'pace') > m.stat(opponent, 'pace') + 6) return { dx: actor.facingX, dy: actor.facingY };
  if (Math.abs(lateral) < 0.35) return { dx: 0, dy: 0 };
  return { dx: -actor.facingY * away, dy: actor.facingX * away };
}

/**
 * A give-and-go is worth it when the receiver is tightly marked (he cannot turn, so he lays it back) and there is room
 * to run into ahead of the passer.
 */
export function wantsOneTwo(m: ArcadeMatch, actor: ArcadeActor, receiver: ArcadeActor, receiverPressure: number): boolean {
  if (actor.stamina < 40 || receiverPressure > 3.6) return false;
  const direction = m.attackDirection(actor.side);
  const spaceX = actor.x + direction * 10, spaceY = actor.y;
  for (const other of m.actors) {
    if (other.active && other.side !== actor.side && distance(other, { x: spaceX, y: spaceY }) < 5) return false;
  }
  const level = m.aiLevel(actor.side);
  return m.rng.bool(clamp(0.35 * attackStyle(actor).combine * (level === 'hard' ? 1.3 : level === 'easy' ? 0.5 : 1), 0, 0.7)) && distance(actor, receiver) < 22;
}
