import { hash32 } from '../../visual-identity';
import { playerName } from '../../ratings';
import { clamp } from '../../util';
import { turnTowards } from '../movement';
import { ArcadeActor, distance, len2 } from '../match-types';
import { passLanePressure } from '../pitch-analysis';
import { HK } from '../../rpg/effects';
import { partnerBonus } from '../../rpg/partners';
import { ARCADE_MATCH_TUNING, MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

export function tieOrder(m: ArcadeMatch, actor: ArcadeActor): number {
  return hash32(`${m.tick}|${actor.player.id}`);
}

export function tryBallControl(m: ArcadeMatch): void {
  if (m.ball.z > 1.4) { m.tryHeader(); return; }
  const speed = len2(m.ball.vx, m.ball.vy);
  let candidate: ArcadeActor | undefined;
  let candidateScore = Number.POSITIVE_INFINITY;
  const striker = m.football.pendingKick?.actorId;
  for (const actor of m.actors) {
    if (!actor.active || (m.ball.controlledTouch < 0.14 && actor.player.id === m.ball.lastTouchPlayerId)) continue;
    // A player who has committed to a strike at this ball (volley, side volley, scissor kick, diving header) hits it; he does not kill it first.
    if (striker === actor.player.id) continue;
    const intended = actor.player.id === m.intendedReceiverId;
    // A defender gets exactly one try at a pass in flight, and not every defender goes for it; no tick-parity gate any more.
    const interceptsFlight = !intended && !!m.lastPasser && !m.lastPasser.received && actor.side !== m.lastPasser.side;
    if (interceptsFlight && m.football.interceptTried?.includes(actor.player.id)) continue;
    const controlRadius = m.ball.z > 0.75 ? 0.7 : intended ? 1.05 : 0.95;
    // Chest and thigh control up to 1.4 m; very hard balls at that height cannot be killed.
    if (m.ball.z > 0.75 && speed > 17) continue;
    const controlDistance = distance(actor, m.ball);
    if (controlDistance >= controlRadius) continue;
    const score = controlDistance - (intended ? ARCADE_MATCH_TUNING.intendedReceiverControlBias : 0);
    // Equal distances are settled by a fixed pseudo-random order, not by the order of the player list.
    if (score < candidateScore - 1e-9 || (candidate && Math.abs(score - candidateScore) <= 1e-9 && m.tieOrder(actor) < m.tieOrder(candidate))) {
      candidate = actor;
      candidateScore = score;
    }
  }
  if (!candidate) return;
  if (!m.legalRestartTouch(candidate)) return;
  if (m.lastPasser && !m.lastPasser.received && candidate.side !== m.lastPasser.side && candidate.player.id !== m.intendedReceiverId) {
    (m.football.interceptTried ??= []).push(candidate.player.id);
    // Some defenders read the pass too late; the share is a fixed seeded draw per pass and defender.
    if (hash32(`${m.lastPasser.at}|${candidate.player.id}`) % 100 >= T.reception.interceptShare) return;
  }
  if (m.pendingOffsideTargetId === candidate.player.id || m.football.offsideCandidates.includes(candidate.player.id)) {
    m.stats(candidate.side).offsides++;
    m.events.push({ minute: m.footballMinute, type: 'foul', side: candidate.side, playerId: candidate.player.id, messageKey: 'match.offside', params: { player: playerName(candidate.player) } });
    m.pendingOffsideTargetId = null;
    m.setRestart('freeKick', m.opposite(candidate.side), candidate.x, candidate.y, true);
    return;
  }
  const aerialPenalty = m.ball.z > 0.75 ? 10 + speed * 0.5 : 0;
  const fromPartner = m.lastPasser && !m.lastPasser.received && m.lastPasser.side === candidate.side ? m.actors.find((other) => other.player.id === m.lastPasser!.id) : undefined;
  const partnerTouch = fromPartner ? partnerBonus(m.partnerStrength(fromPartner, candidate)).firstTouchAdd : 0;
  const firstTouch = m.hook(candidate, HK.firstTouch, m.stat(candidate,'dribbling') + candidate.stamina * 0.25 - speed * 1.4 - aerialPenalty + partnerTouch);
  const weatherPenalty = m.config.weather === 'rain' ? 8 : m.config.weather === 'storm' ? 11 : m.config.weather === 'snow' ? 9 : 0;
  const humanReceiver = m.config.controllerMode === 'human' && candidate.side === m.controlledSide;
  const intendedAiReceiverBonus = !humanReceiver && candidate.player.id === m.intendedReceiverId
    ? ARCADE_MATCH_TUNING.aiIntendedReceiverBonus
    : 0;
  const assistBonus = humanReceiver
    ? m.config.assist === 'assisted' ? 14 : m.config.assist === 'balanced' ? 7 : 1
    : ARCADE_MATCH_TUNING.aiFirstTouchAssist + intendedAiReceiverBonus;
  const homeTouch = candidate.side === 'home' ? ARCADE_MATCH_TUNING.homeComposure * 50 : 0;
  if (m.rng.bool(clamp((firstTouch + assistBonus + homeTouch - weatherPenalty) / 100, 0.18, 0.96))) {
    const incomingX = m.ball.vx, incomingY = m.ball.vy;
    m.ball.ownerId = candidate.player.id;
    m.ball.vx = candidate.vx;
    m.ball.vy = candidate.vy;
    m.ball.vz = -0.5;
    m.ball.controlledTouch = 0.18;
    // The controlled receiver takes the ball where the stick points: body and ball turn into the touch, a poor touch runs away.
    const stick = humanReceiver && candidate.player.id === m.selectedPlayerId ? len2(m.previousInput.moveX, m.previousInput.moveY) : 0;
    if (stick > 0.3) {
      const wx = m.previousInput.moveX * m.currentAttackDirection / stick, wy = m.previousInput.moveY / stick;
      const quality = clamp(firstTouch / 100, 0.2, 1);
      const carry = Math.max(len2(candidate.vx, candidate.vy), 2.2);
      const turned = turnTowards(candidate.facingX, candidate.facingY, wx, wy, 1.2);
      candidate.facingX = turned.x; candidate.facingY = turned.y;
      candidate.vx = candidate.vx * 0.5 + wx * carry * 0.5;
      candidate.vy = candidate.vy * 0.5 + wy * carry * 0.5;
      if (m.previousInput.sprint && !m.football.queuedAction && speed > 4) {
        // Let the ball run: with sprint held the receiver does not kill the ball but lets it roll on in the direction of the
        // run; a better first touch keeps more of the incoming pace, and the ball is left alone for a moment.
        const keep = clamp(0.45 + quality * 0.4, 0.45, 0.85);
        const run = Math.min(speed * keep, 6.5);
        const bx = incomingX / speed * 0.55 + wx * 0.45, by = incomingY / speed * 0.55 + wy * 0.45, bl = len2(bx, by) || 1;
        m.ball.vx = bx / bl * run;
        m.ball.vy = by / bl * run;
        m.ball.controlledTouch = 0;
      } else {
        m.ball.vx = candidate.vx + wx * (1 + (1 - quality) * 2.2);
        m.ball.vy = candidate.vy + wy * (1 + (1 - quality) * 2.2);
      }
    }
    m.ball.lastTouch = candidate.side;
    m.ball.lastTouchPlayerId = candidate.player.id;
    if (m.lastPasser && !m.lastPasser.received && m.elapsed - m.lastPasser.at <= 5) {
      if (candidate.side === m.lastPasser.side && candidate.player.id !== m.lastPasser.id) {
        m.lastPasser.received = true;
        m.passCompletions[candidate.side]++;
        m.stats(candidate.side).passesCompleted++;
        m.addFocus(candidate.side, 0.5);
        m.ratings[m.lastPasser.id] = clamp((m.ratings[m.lastPasser.id] ?? 6.5) + 0.025, 1, 10);
      } else if (candidate.side !== m.lastPasser.side) {
        m.adjustRating(m.lastPasser.id, -0.04);
        m.lastPasser = null;
        m.stats(candidate.side).interceptions++;
        m.addFocus(candidate.side, 3);
      }
    }
    m.pendingOffsideTargetId = null;
    m.football.offsideCandidates = [];
    m.intendedReceiverId = null;
    m.activeShot = null;
    if (!m.isHumanControlled(candidate)) {
      const settle = 0.08 + (100 - m.stat(candidate,'dribbling')) * 0.0012;
      candidate.decisionCooldown = Math.max(candidate.decisionCooldown, settle);
    }
    if (candidate.side === m.controlledSide && m.config.controllerMode==='human') candidate.decisionCooldown=Math.max(candidate.decisionCooldown,.30);
    if (candidate.side === m.controlledSide && (m.config.autoSwitch!=='manual'||candidate.player.id===m.selectedPlayerId) && m.football.queuedAction && m.football.queuedAction.expiresTick >= m.tick) {
      m.executeFootballAction(candidate, m.football.queuedAction);
      m.football.queuedAction = null;
    }
    const giveAndGo = m.football.oneTwoReturn;
    if (giveAndGo && giveAndGo.receiverId === candidate.player.id && !m.isHumanControlled(candidate)) {
      // The AI give-and-go: the receiver plays the ball straight back into the run of the passer.
      m.football.oneTwoReturn = null;
      const runner = m.tick <= giveAndGo.untilTick ? m.actors.find((other) => other.active && other.side === candidate.side && other.player.id === giveAndGo.runnerId) : undefined;
      if (runner && !m.football.pendingKick && m.passLanePressure(candidate, runner) === 0) {
        m.scheduleKick(candidate, { type: 'pass', through: true, power: 0.55, aimX: runner.x - candidate.x, aimY: runner.y - candidate.y, forcedId: runner.player.id }, 'through-pass');
      }
    }
  } else {
    m.ball.lastTouchPlayerId = candidate.player.id;
    m.ball.lastTouch = candidate.side;
    m.ball.controlledTouch = 0;
    // Damp along the ball's own direction of travel and knock it sideways; damping only x let cross-field balls run on.
    const heavyKick = m.rng.float(-2.5, 2.5);
    const heavySpeed = len2(m.ball.vx, m.ball.vy);
    const sideX = heavySpeed > 0.1 ? -m.ball.vy / heavySpeed : 0, sideY = heavySpeed > 0.1 ? m.ball.vx / heavySpeed : 1;
    m.ball.vx = m.ball.vx * 0.48 + sideX * heavyKick;
    m.ball.vy = m.ball.vy * 0.48 + sideY * heavyKick;
    m.setAction(candidate, 'heavy-touch');
  }
}
