import { clamp } from '../../util';
import { ArcadeActor, len2 } from '../match-types';
import type { ArcadeMatch } from '../../services/arcade-match';

/** Closing speed (m/s) from which a collision between opponents can knock one of them off balance, and a hard one. */
export const KNOCK_SPEED = 4.6;
export const HARD_KNOCK_SPEED = 7.5;

/**
 * How well a player keeps his feet, 0 to 1: strength first, then fresh legs and close control; a player at full speed is
 * easier to knock over than one in control of his stride.
 */
export function bodyBalance(m: ArcadeMatch, actor: ArcadeActor): number {
  const physical = m.stat(actor, 'physical'), dribbling = m.stat(actor, 'dribbling');
  const tired = actor.stamina < 50 ? (50 - actor.stamina) / 50 : 0;
  const pace = len2(actor.vx, actor.vy) / 9;
  return clamp(0.25 + physical / 100 * 0.55 + dribbling / 100 * 0.15 - tired * 0.15 - pace * 0.08, 0.05, 1);
}

/** The weight a player puts into a challenge: his strength, how steady he is, and the speed he brings. */
function heft(m: ArcadeMatch, actor: ArcadeActor): number {
  return (0.75 + m.stat(actor, 'physical') / 100) * (0.6 + bodyBalance(m, actor) * 0.4) + len2(actor.vx, actor.vy) * 0.025;
}

/** True when `actor` runs side by side with the carrier: level with him, close, both moving the same way. */
export function runningAlongside(actor: ArcadeActor, carrier: ArcadeActor): boolean {
  const speed = len2(carrier.vx, carrier.vy);
  if (speed < 3.5 || len2(actor.vx, actor.vy) < 3) return false;
  const fx = carrier.vx / speed, fy = carrier.vy / speed;
  const dx = actor.x - carrier.x, dy = actor.y - carrier.y;
  const along = dx * fx + dy * fy, across = Math.abs(dx * fy - dy * fx);
  return Math.abs(along) < 0.7 && across < 1.45 && across > 0.35 && actor.vx * fx + actor.vy * fy > 2.5;
}

/** Knocked off balance: the player staggers (and, after a hard one, takes longer to get going), a carrier loses the ball. */
export function knockDown(m: ArcadeMatch, victim: ArcadeActor, hard: boolean, awayX: number, awayY: number): void {
  m.setAction(victim, 'stumble', true);
  m.startRecovery(victim, hard ? 42 : 22);
  victim.vx = victim.vx * 0.35 + awayX * 1.6;
  victim.vy = victim.vy * 0.35 + awayY * 1.6;
  if (m.ball.ownerId === victim.player.id) {
    // The ball runs on loose in the direction he was going.
    m.ball.ownerId = null;
    m.ball.vx = victim.vx + awayX * 1.5 + m.rng.float(-1, 1);
    m.ball.vy = victim.vy + awayY * 1.5 + m.rng.float(-1, 1);
    m.ball.controlledTouch = 0;
  }
}

/**
 * Hard contacts between opponents found by the collision pass this tick. The weaker body may stagger; a player hit from
 * behind at speed can win a free kick.
 */
export function resolveContacts(m: ArcadeMatch, contacts: readonly { a: ArcadeActor; b: ArcadeActor; speed: number }[]): void {
  for (const { a, b, speed } of contacts) {
    if (a.action === 'stumble' || b.action === 'stumble' || m.rule.phase !== 'playing') continue;
    const heftA = heft(m, a), heftB = heft(m, b);
    const [victim, other, ratio] = heftA < heftB ? [a, b, heftB / heftA] : [b, a, heftA / heftB];
    const hard = speed >= HARD_KNOCK_SPEED;
    const chance = clamp((speed - KNOCK_SPEED) * 0.12 * (ratio - 0.85) * 1.6 * (1.2 - bodyBalance(m, victim) * 0.5), 0, 0.55);
    if (!m.rng.bool(chance)) continue;
    const dx = victim.x - other.x, dy = victim.y - other.y, gap = len2(dx, dy) || 1;
    // From behind: the victim was moving away from the player who ran into him.
    const fromBehind = (victim.vx * dx + victim.vy * dy) / gap > 1 && (other.vx * dx + other.vy * dy) / gap > 2;
    knockDown(m, victim, hard, dx / gap, dy / gap);
    if (fromBehind && m.ball.lastTouchPlayerId === victim.player.id && m.rng.bool(hard ? 0.6 : 0.3)) m.callFoul(other, victim, false, speed);
  }
}

/**
 * A shoulder-to-shoulder duel in a running race for the ball. The heavier, steadier body wins it: the challenger takes the
 * ball, or bounces off and staggers. Going in from behind is a foul more often than not.
 */
export function shoulderCharge(m: ArcadeMatch, actor: ArcadeActor, carrier: ArcadeActor): void {
  actor.tackleCooldown = 0.6;
  m.setAction(actor, 'standing-tackle');
  const dx = carrier.x - actor.x, dy = carrier.y - actor.y, gap = len2(dx, dy) || 1;
  const speed = len2(carrier.vx, carrier.vy) || 1;
  const behind = (dx * carrier.vx + dy * carrier.vy) / (gap * speed) > 0.55;
  if (behind && m.rng.bool(0.55)) { m.callFoul(actor, carrier, false, len2(actor.vx - carrier.vx, actor.vy - carrier.vy) + 2); return; }
  const edge = heft(m, actor) - heft(m, carrier);
  const win = clamp(0.45 + edge * 0.9 + (m.stat(actor, 'defending') - m.stat(carrier, 'dribbling')) / 400, 0.15, 0.8);
  if (m.rng.bool(win)) {
    if (!m.legalRestartTouch(actor)) return;
    m.ball.ownerId = actor.player.id;
    m.ball.lastTouch = actor.side;
    m.ball.lastTouchPlayerId = actor.player.id;
    m.ball.controlledTouch = 0;
    actor.contact = { tick: m.tick, x: m.ball.x, y: m.ball.y, z: m.ball.z, kind: 'foot', foot: 'right' };
    m.stats(actor.side).tacklesWon++;
    // Shoved off it: a clear win puts the carrier off balance.
    if (edge > 0.25) knockDown(m, carrier, false, dx / gap, dy / gap);
    else m.startRecovery(carrier, 10);
    return;
  }
  // Bounced off: the challenger staggers away from the stronger man.
  if (edge < -0.2) knockDown(m, actor, false, -dx / gap, -dy / gap);
  else m.startRecovery(actor, 14);
  if (m.rng.bool(0.04)) m.callFoul(actor, carrier, false, 3);
}
