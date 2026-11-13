import { clamp } from '../../util';
import { ArcadeActor, distance, len2 } from '../match-types';
import { HK } from '../../rpg/effects';
import { canUse } from '../../rpg/stat-block';
import { ARCADE_MATCH_TUNING, MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

export function resolvePressureTackles(m: ArcadeMatch, dt: number): void {
  const owner = m.owner();
  if (!owner) return;
  for (const defender of m.actors) {
    if (!defender.active || defender.side === owner.side || defender.player.positionGroup === 'GK' || defender.tackleCooldown > 0) continue;
    // The human-controlled defender only tackles on input.
    if (m.isHumanControlled(defender)) continue;
    if (distance(defender, owner) > 1.25) continue;
    const pressing = m.teamOf(defender.side).tactics.pressing;
    const press = pressing === 'gegenpress' ? 1.45 : pressing === 'high' ? 1.2 : 1;
    if (m.rng.bool(dt * m.hook(defender, HK.pressTackle, 0.22 + m.stat(defender,'defending') / 115) * press)) {
      const slideChance = pressing === 'gegenpress' ? 0.08 : pressing === 'high' ? 0.04 : pressing === 'medium' ? 0.01 : 0.004;
      m.attemptTackle(defender, m.rng.bool(slideChance));
    }
  }
}

export function attemptTackle(m: ArcadeMatch, actor: ArcadeActor, sliding: boolean): void {
  const owner = m.owner();
  if (!owner || owner.side === actor.side || actor.tackleCooldown > 0) return;
  // The Kaiser slide: a clean, well-timed slide that reaches a little further.
  const kaiser = sliding && canUse(m.statsOf(actor), 'kaiser-slide');
  const reach = sliding ? (kaiser ? 2.55 : 2.25) : 1.45;
  const gap = distance(actor, owner);
  // A slide can be started from further out: the lunge carries the player forward and, when short, leaves him on the floor.
  if (gap > (sliding ? T.tackle.slideLungeReach : reach)) return;
  actor.tackleCooldown = sliding ? 1.15 : 0.45;
  m.setAction(actor, sliding ? 'slide' : 'standing-tackle');
  // A keeper who has the ball in his own area is protected: going in on him is mostly a foul.
  if (owner.player.positionGroup === 'GK' && m.inOwnPenaltyArea(owner) && m.rng.bool(0.8)) {
    m.callFoul(actor, owner, sliding, len2(actor.vx - owner.vx, actor.vy - owner.vy));
    return;
  }
  if (sliding) {
    const lunge = Math.max(gap, 0.1);
    actor.vx = actor.vx * 0.4 + (owner.x - actor.x) / lunge * 5.5;
    actor.vy = actor.vy * 0.4 + (owner.y - actor.y) / lunge * 5.5;
  }
  if (gap > reach) { m.startRecovery(actor, T.recovery.slideMissTicks); return; }
  const relativeX = owner.x - actor.x;
  const relativeY = owner.y - actor.y;
  const approach = (relativeX * actor.facingX + relativeY * actor.facingY) / Math.max(0.1, len2(relativeX, relativeY));
  const speed = len2(actor.vx - owner.vx, actor.vy - owner.vy);
  // A carrier who is not sprinting, with the defender behind, shields the ball.
  const behind = (-relativeX * owner.facingX - relativeY * owner.facingY) / Math.max(0.1, len2(relativeX, relativeY)) < -0.2;
  const shieldingBase = behind && len2(owner.vx, owner.vy) < m.maxSpeed(owner, false) * 0.95 ? 0.12 * m.stat(owner,'physical') / 80 : 0;
  // A carrier who actively shields (held button) is protected on top of that.
  const shielding = m.hook(owner, HK.shielding, shieldingBase + (m.isHumanControlled(owner) && m.previousInput.jockey ? 0.14 : 0));
  const jockeyBonus = (actor.action === 'jockey' ? 0.06 : 0) + (actor.side === 'home' ? ARCADE_MATCH_TUNING.homeComposure * 0.3 : 0);
  const winChance = clamp(m.hook(actor, HK.tackleWin, 0.28 + m.stat(actor,'defending') / 170 - m.stat(owner,'dribbling') / 260 + approach * 0.12 + (sliding ? 0.08 : 0) + (kaiser ? 0.05 : 0) - shielding + jockeyBonus), 0.12, 0.82);
  const ballReach = distance(actor, m.ball) <= (sliding ? 1.9 : 1.15) && m.ball.z < .65;
  if (ballReach && m.rng.bool(winChance)) {
    if (!m.legalRestartTouch(actor)) return;
    m.ball.ownerId = actor.player.id;
    m.ball.lastTouch = actor.side;
    m.ball.lastTouchPlayerId = actor.player.id;
    m.ball.controlledTouch = 0;
    actor.contact = {tick:m.tick,x:m.ball.x,y:m.ball.y,z:m.ball.z,kind:'foot',foot:'right'};
    m.stats(actor.side).tacklesWon++;
    m.ratings[actor.player.id] = clamp((m.ratings[actor.player.id] ?? 6.5) + 0.09, 1, 10);
    m.adjustRating(owner.player.id, -0.06);
    m.startRecovery(actor, 6);
    return;
  }
  // A carrier who leans on a defender while shielding can give away a foul himself.
  if (behind && shielding >= 0.2 && !sliding && m.rng.bool(0.035)) {
    m.callFoul(owner, actor, false, 2.5);
    return;
  }
  // Missing costs time: the player is out of the play for a moment.
  m.startRecovery(actor, sliding ? T.recovery.slideMissTicks * 0.75 : T.recovery.tackleMissTicks);
  const foulRisk = clamp((sliding ? 0.22 : 0.07) + speed * 0.018 + Math.max(0, -approach) * 0.12, 0.03, 0.68);
  if (m.rng.bool(foulRisk)) m.callFoul(actor, owner, sliding, speed);
}
