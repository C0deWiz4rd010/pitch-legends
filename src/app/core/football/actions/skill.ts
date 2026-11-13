import { PlayerActionState } from '../../../models/match.model';
import { clamp } from '../../util';
import { ArcadeActor, distance, len2 } from '../match-types';
import { canUse } from '../../rpg/stat-block';
import type { ArcadeMatch } from '../../services/arcade-match';

/**
 * Direction relative to the carrier picks the move: none = body feint, sideways = ball roll,
 * back = drag back, forward = knock-on. Timing decides the outcome, not a dice roll: too close
 * (under 1.05 m) loses the ball, 1.05-3.6 m wrong-foots nearby defenders, further away is a free move.
 */
export function performSkill(m: ArcadeMatch, actor: ArcadeActor, dx: number, dy: number): void {
  if (actor.skillCooldown > 0 || m.ball.ownerId !== actor.player.id) return;
  actor.skillCooldown = 0.75;
  const opponentGap = m.closestOpponent(actor);
  if (opponentGap < 1.05) {
    m.releaseBall(actor, actor.facingX * 4 + m.rng.float(-2, 2), actor.facingY * 4 + m.rng.float(-2, 2), 0.5, 0, 0, 0);
    m.setAction(actor, 'skill-failed');
    return;
  }
  const magnitude = len2(dx, dy);
  const forward = magnitude > 0.25 ? (dx * actor.facingX + dy * actor.facingY) / magnitude : 0;
  const side = magnitude > 0.25 ? (actor.facingX * dy - actor.facingY * dx) / magnitude : 0;
  const move: PlayerActionState = magnitude <= 0.25 ? 'body-feint' : Math.abs(side) > 0.6 ? 'ball-roll' : forward < -0.5 ? 'drag-back' : 'knock-on';
  // A skill changes momentum; displacement still goes through the fixed-step integrator.
  if (move === 'ball-roll' || move === 'drag-back') {
    const lateral = move === 'ball-roll';
    const skillX = lateral ? -actor.facingY * Math.sign(side || 1) : -actor.facingX;
    const skillY = lateral ? actor.facingX * Math.sign(side || 1) : -actor.facingY;
    actor.vx = actor.vx * 0.45 + skillX * 2.7;
    actor.vy = actor.vy * 0.45 + skillY * 2.7;
    m.ball.vx = actor.vx + skillX * 1.3;
    m.ball.vy = actor.vy + skillY * 1.3;
  } else if (move === 'knock-on') {
    const burst = 5.5 + m.stat(actor,'pace') / 40;
    m.ball.vx = actor.vx + actor.facingX * burst;
    m.ball.vy = actor.vy + actor.facingY * burst;
  } else {
    actor.vx *= 0.6; actor.vy *= 0.6;
  }
  m.ball.controlledTouch = 0;
  m.setAction(actor, move);
  if (opponentGap > 3.6) return;
  const quality = m.stat(actor,'dribbling') / 100 * (actor.stamina > 20 ? 1 : 0.7);
  actor.stamina = clamp(actor.stamina - 0.5, 0, 100);
  let beaten = false;
  let engagedBeatsYou = false;
  for (const opponent of m.actors) {
    if (!opponent.active || opponent.side === actor.side || opponent.player.positionGroup === 'GK') continue;
    const gap = distance(opponent, actor);
    if (gap > 3.6) continue;
    // Each defender is beaten (or not) on his own: dribbling against defending, and whether he faces the carrier.
    const facing = gap > 0.01 ? (opponent.facingX * (actor.x - opponent.x) + opponent.facingY * (actor.y - opponent.y)) / gap : 1;
    // The step-over talent: a rehearsed move that wrong-foots a little more often.
    const stepOver = canUse(m.statsOf(actor), 'step-over') ? 0.06 : 0;
    const chance = clamp(0.62 + quality * 0.38 - m.stat(opponent,'defending') / 100 * 0.40 - Math.max(0, facing) * 0.10 + (facing < -0.2 ? 0.15 : 0) + stepOver, 0.2, 0.95);
    if (!m.rng.bool(chance)) {
      if (gap <= 1.8) engagedBeatsYou = true;
      continue;
    }
    beaten = true;
    opponent.tackleCooldown = Math.max(opponent.tackleCooldown, 0.2 + quality * 0.35);
    opponent.vx *= 0.5; opponent.vy *= 0.5;
    if (!m.isHumanControlled(opponent)) opponent.decisionCooldown += 0.15 + quality * 0.25;
  }
  if (engagedBeatsYou && m.ball.ownerId === actor.player.id) {
    // The defender next to the carrier read the move: the touch goes wrong.
    m.releaseBall(actor, actor.facingX * 3 + m.rng.float(-2, 2), actor.facingY * 3 + m.rng.float(-2, 2), 0.4, 0, 0, 0);
    m.setAction(actor, 'skill-failed');
    return;
  }
  if (beaten && m.anySignatureEvents) m.fireSignature('skillWon', actor, null);
}

/** Good dribblers take a defender on when one closes down from the front. */
export function tryAiSkill(m: ArcadeMatch, actor: ArcadeActor, pressureDistance: number): boolean {
  if (actor.skillCooldown > 0 || m.stat(actor,'dribbling') < 68 || pressureDistance < 1.2 || pressureDistance > 3.4) return false;
  const opponent = m.actors.filter(other => other.active && other.side !== actor.side && other.player.positionGroup !== 'GK')
    .sort((a, b) => distance(a, actor) - distance(b, actor))[0];
  if (!opponent || (opponent.x - actor.x) * actor.facingX + (opponent.y - actor.y) * actor.facingY <= 0) return false;
  const level = m.aiLevel(actor.side);
  if (!m.rng.bool(level === 'hard' ? .28 : level === 'easy' ? .08 : .16)) return false;
  const away = (actor.facingX * (opponent.y - actor.y) - actor.facingY * (opponent.x - actor.x)) > 0 ? -1 : 1;
  m.performSkill(actor, -actor.facingY * away, actor.facingX * away);
  return true;
}

/** Dribbling alternates feet like running does: the strong foot takes two touches in three, a two-footed player alternates. */
export function dribbleFoot(m: ArcadeMatch, actor: ArcadeActor): 'left' | 'right' {
  const touch = Math.floor(m.tick / 11) % 3;
  if (actor.player.foot === 'Both') return touch % 2 ? 'left' : 'right';
  const strong = actor.player.foot === 'Left' ? 'left' : 'right';
  return touch === 2 ? (strong === 'left' ? 'right' : 'left') : strong;
}
