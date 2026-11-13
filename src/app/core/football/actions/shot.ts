import { playerName } from '../../ratings';
import { clamp, round } from '../../util';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, GOAL_HEIGHT, GOAL_WIDTH, distance, len2 } from '../match-types';
import { HK } from '../../rpg/effects';
import { shotAngleQuality, shotXg } from '../xg';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

/** `accuracy` scales the strike's errors: below 1 for a timed finish, above 1 for an acrobatic one. */
export function shoot(m: ArcadeMatch, actor: ArcadeActor, power: number, aimX: number, aimY: number, finesse: boolean, low: boolean, chip = false, driven = false, forceVolley = false, accuracy = 1): void {
  if (m.ball.ownerId !== actor.player.id) return;
  const direction = m.attackDirection(actor.side);
  const goalX = direction > 0 ? FIELD_LENGTH + 0.3 : -0.3;
  const goalCentre = FIELD_WIDTH / 2;
  const inputZone = clamp(aimY, -1, 1) * (GOAL_WIDTH * 0.43);
  const distanceToGoal = len2(goalX - actor.x, goalCentre - actor.y);
  const angleQuality = shotAngleQuality(actor.y - goalCentre, FIELD_WIDTH);
  const pressure = clamp((5 - m.closestOpponent(actor)) / 5, 0, 1);
  const balance = clamp(1 - len2(actor.vx, actor.vy) / 18, 0.35, 1);
  const shotLateral = direction * (goalCentre - actor.y);
  const weakFoot = actor.player.foot === 'Both' ? 0 : actor.player.foot === 'Right' === (shotLateral < 0) ? 0.07 : 0;
  const fatigue = actor.stamina < 30 ? (30 - actor.stamina) / 120 : 0;
  // Striking a bouncing or dropping ball (volley) and hitting it with full force are both harder to place.
  const volley = forceVolley || m.ball.z > 0.35;
  const techniqueFactor = (driven ? 1.3 : 1) * (volley ? 1.2 : 1) * accuracy;
  const baseError = m.hook(actor, HK.shotError, ((100 - m.stat(actor,'shooting')) / 100 * 2.15 + pressure * 1.35 + (1 - balance) * 0.9 + weakFoot + fatigue + Math.max(0, distanceToGoal - 20) * 0.15) * techniqueFactor);
  const assistFactor = T.shot.assistError[m.config.assist];
  const manual = m.isHumanControlled(actor) && m.config.assist === 'manual';
  const manualX = Math.abs(aimX) > 0.04 ? aimX : direction * 0.04;
  const aimedY = manual ? actor.y + aimY / manualX * (goalX - actor.x) : goalCentre + inputZone;
  // Shot dispersion uses a real standard deviation (× 2.4 since Phase H: about 55 % on target); the general generator's
  // bounded averaging helper otherwise put virtually every attempt on target.
  const targetY = aimedY + m.rng.normal(0, m.composure(actor.side) * m.penaltyNerves * m.hook(actor, HK.composure, 1)) * (baseError + Math.max(0,distanceToGoal-12)*0.025) * assistFactor * T.shot.dispersion;
  // Finesse: the kicking foot decides the curl; the ball starts outside the target and bends back in.
  const curl = finesse ? m.curlSign(actor, targetY) : 0;
  const curlGain = finesse ? m.hook(actor, HK.curve, 1) : 1;
  const curlDeflection = finesse ? 0.024 * 5 * curlGain * (goalX - actor.x) ** 2 / Math.max(20, 19 + power * 14) * 0.85 : 0;
  const launchY = targetY - curl * direction * curlDeflection;
  const dx = goalX - actor.x;
  const dy = launchY - actor.y;
  const length = len2(dx, dy) || 1;
  const speed = m.hook(actor, HK.shotPower, 19 + power * 14 + m.stat(actor,'shooting') * 0.035 + (driven ? 6 : 0) + (volley ? 2 : 0));
  const xG = shotXg(distanceToGoal, actor.y - goalCentre, m.stat(actor,'shooting'), pressure, false, FIELD_WIDTH);
  const stats = m.stats(actor.side);
  stats.shots++;
  stats.xG = round(stats.xG + xG, 2);
  const flightTime = length / speed;
  const baseVz = chip ? clamp(flightTime * 4.905 + 1.6, 4, 8) : low ? 0.7 : driven ? clamp(flightTime * 4.905 * 0.6 + 0.3, 0.8, 4) : finesse ? clamp(flightTime * 4.905 + 0.8, 1.8, 6.5) : clamp(flightTime * 4.905 + (power - 0.5), 1.2, 7);
  // Height error at the goal line: power and poor technique lift shots over the bar.
  const heightSpread = chip ? 0 : low ? 0.2 : (0.55 + power * 0.75 + (100 - m.stat(actor,'shooting')) / 100 * 0.9 + pressure * 0.4) * techniqueFactor * (finesse ? 0.8 : 1);
  const heightError = heightSpread ? m.rng.normal(power * 0.35, heightSpread) : 0;
  const vz = baseVz + heightError / Math.max(0.2, flightTime);
  const heightAtGoal = m.ball.z + vz * flightTime - 4.905 * flightTime * flightTime;
  if (Math.abs(targetY - goalCentre) <= GOAL_WIDTH / 2 && heightAtGoal <= GOAL_HEIGHT) stats.shotsOnTarget++;
  m.activeShot = { shooterId: actor.player.id, side: actor.side, xG, targetY, checkedKeeper: false };
  m.registerShotForSignatures(actor, xG);
  m.intendedReceiverId = null;
  // Driven and hard shots carry topspin (they dip); chips carry backspin (they float and check up).
  const topspin = chip ? -3 : driven ? 4 : power > 0.7 && !finesse ? 1.5 : 0;
  m.releaseBall(actor, dx / length * speed, dy / length * speed, vz, curl * 5 * curlGain, topspin, 12);
  m.setAction(actor, chip ? 'chip-shot' : finesse ? 'finesse-shot' : low ? 'low-shot' : 'shot');
  m.jumpWall(actor);
  m.events.push({ minute: m.footballMinute, type: 'shot', side: actor.side, playerId: actor.player.id, params: { player: playerName(actor.player), xG, distance: round(distanceToGoal,1) } });
}

/** Expected value of shooting now: chance quality, blocked lanes and a keeper caught off the line. */
export function shotValue(m: ArcadeMatch, actor: ArcadeActor): number {
  const direction = m.attackDirection(actor.side);
  const goalX = direction > 0 ? FIELD_LENGTH : 0;
  const goalDistance = Math.abs(goalX - actor.x);
  const pressure = clamp((5 - m.closestOpponent(actor)) / 5, 0, 1);
  const xG = shotXg(goalDistance, actor.y - FIELD_WIDTH / 2, m.stat(actor,'shooting'), pressure, false, FIELD_WIDTH);
  const goal = { x: goalX, y: FIELD_WIDTH / 2 };
  let blockers = 0;
  for (const other of m.actors) {
    if (!other.active || other.side === actor.side || other.player.positionGroup === 'GK') continue;
    const dx = goal.x - actor.x, dy = goal.y - actor.y, length2 = dx * dx + dy * dy || 1;
    const t = ((other.x - actor.x) * dx + (other.y - actor.y) * dy) / length2;
    if (t <= 0 || t >= 1) continue;
    if (len2(other.x - (actor.x + dx * t), other.y - (actor.y + dy * t)) < 1.3) blockers++;
  }
  const keeper = m.actors.find(other => other.active && other.side !== actor.side && other.player.positionGroup === 'GK');
  const offLine = keeper ? clamp(Math.abs(keeper.y - (FIELD_WIDTH / 2 + (actor.y - FIELD_WIDTH / 2) * 0.12)) / 3, 0, 1) : 1;
  return xG * Math.pow(0.4, blockers) * (1 + offLine * 0.35);
}

/** +1 curls to the left of the travel direction (right foot), -1 to the right (left foot). */
export function curlSign(m: ArcadeMatch, actor: ArcadeActor, targetY: number): number {
  if (actor.player.foot === 'Right') return 1;
  if (actor.player.foot === 'Left') return -1;
  // Two-footed players bend the ball back towards the goal centre.
  return Math.sign((targetY - actor.y) * m.attackDirection(actor.side)) || 1;
}

/** Outfield players in the path (including a wall) block shots below about 1.9 m. */
export function blockShot(m: ArcadeMatch): boolean {
  const shot = m.activeShot!;
  if (m.ball.z > 1.9 || m.ball.controlledTouch < 0.1) return false;
  for (const actor of m.actors) {
    if (!actor.active || actor.side === shot.side || actor.player.positionGroup === 'GK') continue;
    if (len2(actor.x - m.ball.x, actor.y - m.ball.y) > 0.45) continue;
    const speed = len2(m.ball.vx, m.ball.vy);
    const angle = m.rng.float(-1.1, 1.1);
    const back = -Math.atan2(m.ball.vy, m.ball.vx);
    m.ball.vx = Math.cos(Math.PI - back + angle) * speed * 0.3;
    m.ball.vy = Math.sin(Math.PI - back + angle) * speed * 0.3;
    m.ball.vz = Math.abs(m.ball.vz) * 0.4 + 1;
    m.ball.spin = m.ball.topspin = 0;
    m.ball.lastTouch = actor.side;
    m.ball.lastTouchPlayerId = actor.player.id;
    m.ball.controlledTouch = 0;
    actor.contact = { tick: m.tick, x: m.ball.x, y: m.ball.y, z: m.ball.z, kind: m.ball.z > 1.4 ? 'head' : 'foot', foot: 'right' };
    m.stats(actor.side).blocks = (m.stats(actor.side).blocks ?? 0) + 1;
    m.ratings[actor.player.id] = clamp((m.ratings[actor.player.id] ?? 6.5) + 0.08, 1, 10);
    m.events.push({ minute: m.footballMinute, type: 'commentary', side: actor.side, playerId: actor.player.id, messageKey: 'match.blocked', params: { player: playerName(actor.player) } });
    m.activeShot = null;
    return true;
  }
  return false;
}
