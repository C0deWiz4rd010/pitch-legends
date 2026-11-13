import { Side } from '../../../models/match.model';
import { playerName } from '../../ratings';
import { clamp } from '../../util';
import { actionIsPlaying } from '../action-timing';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, PITCH, distance, len2 } from '../match-types';
import { closestOpponentDistance } from '../pitch-analysis';
import { HK } from '../../rpg/effects';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

export function handlePostsAndKeeper(m: ArcadeMatch): void {
  if (m.ball.ownerId || m.ball.z > T.keeper.claimHeight) return;
  // Hands only with the ball inside the own penalty area; a dive extends the reach, coming for a cross the height.
  const keeper = m.actors.find(actor => actor.active && actor.player.positionGroup === 'GK'
    && m.ball.z <= (actor.action === 'keeper-rush' ? T.keeper.claimHeight : T.keeper.handHeight)
    && m.inOwnPenaltyArea(actor) && m.ballInPenaltyAreaOf(actor.side)
    && distance(actor, m.ball) < m.keeperReach(actor));
  if (!keeper || (m.ball.lastTouchPlayerId === keeper.player.id && m.ball.controlledTouch < 0.35)) return;
  // Back-pass rule: a deliberate pass from a team-mate may not be handled.
  if (!m.activeShot && m.ball.lastTouch === keeper.side && m.lastPasser?.side === keeper.side && m.lastPasser.id !== keeper.player.id) return;
  const shot = m.activeShot;
  if (shot?.checkedKeeper) return;
  const reaction = m.hook(keeper, HK.keeperReaction, m.stat(keeper,'goalkeeping') / 100);
  const speed = len2(m.ball.vx, m.ball.vy);
  const reachDistance = distance(keeper, m.ball);
  // Each shot meets the keeper in one fixed form (read, jump, hands). Every sub-step the ball is measured against what he can
  // really reach with that form, so a ball that passes close always meets a hand and one that is too far never does.
  let form = 0.5;
  if (shot) form = shot.keeperQuality ??= m.rng.next();
  const keeperLevel = m.aiLevel(keeper.side);
  const levelSkill = keeperLevel === 'hard' ? 0.04 : keeperLevel === 'easy' ? -0.05 : 0;
  const effectiveReach = m.keeperReach(keeper) * clamp(T.keeper.reachBase + levelSkill + reaction * 0.3 + form * 0.3 - speed * 0.004, 0.45, 1);
  if (reachDistance > 0.4 && reachDistance > effectiveReach) return;
  if (!m.legalRestartTouch(keeper)) return;
  if (shot) shot.checkedKeeper = true;
  const difficulty = speed / 95 + Math.max(0, m.ball.z - 1.2) * 0.1;
  // One on one: the shooter is close and the ball low, so the keeper smothers it at the feet; a crowded box asks for a punch.
  const shooter = shot ? m.actors.find((candidate) => candidate.player.id === shot.shooterId) : undefined;
  const oneOnOne = !!shot && shot.side !== keeper.side && !!shooter && distance(shooter, keeper) < 7.5 && m.ball.z < 0.7;
  const crowd = !shot && m.ball.z > 1.3 && m.actors.filter((other) => other.active && other.side !== keeper.side && distance(other, keeper) < 4.2).length >= 2;
  // Close to the body he holds most balls; at full stretch he still holds the slower ones instead of pushing everything away.
  const stretch = reachDistance < 1.15 ? 0 : T.keeper.stretchCatchCost;
  const catchBall = reachDistance < T.keeper.catchReach && m.rng.bool(clamp(0.45 + reaction * 0.5 - difficulty - stretch + (oneOnOne ? 0.06 : 0) - (crowd ? 0.2 : 0), stretch ? 0.03 : 0.15, 0.92));
  if (shot && shot.side !== keeper.side) {
    m.stats(keeper.side).saves++;
    m.addFocus(keeper.side, 4);
    m.ratings[keeper.player.id] = clamp((m.ratings[keeper.player.id] ?? 6.5) + 0.18 + shot.xG * 0.25, 1, 10);
    m.events.push({ minute: m.footballMinute, type: 'save', side: keeper.side, playerId: keeper.player.id, params: { keeper: playerName(keeper.player) } });
  }
  keeper.contact = { tick: m.tick, x: m.ball.x, y: m.ball.y, z: m.ball.z, kind: 'hand', foot: 'right' };
  m.ball.lastTouch = keeper.side;
  m.ball.lastTouchPlayerId = keeper.player.id;
  m.ball.controlledTouch = 0;
  if (catchBall) {
    m.ball.ownerId = keeper.player.id;
    m.ball.vx = m.ball.vy = m.ball.vz = 0;
    m.setAction(keeper, oneOnOne ? 'keeper-smother' : 'keeper-catch');
    keeper.decisionCooldown = 0.45;
    m.football.keeperHold = { id: keeper.player.id, sinceTick: m.tick };
  } else {
    const direction = m.attackDirection(keeper.side);
    if (crowd) {
      // Punched clear: high, long and to the side, away from the danger zone.
      const wide = Math.sign(m.ball.y - FIELD_WIDTH / 2) || 1;
      m.ball.vx = direction * (8 + m.stat(keeper, 'goalkeeping') * 0.04);
      m.ball.vy = wide * 3;
      m.ball.vz = 5.5;
      m.setAction(keeper, 'keeper-punch');
    } else if (shot && m.ball.z > 1.7 && m.rng.bool(0.5)) {
      // A high shot is tipped over the bar, behind the goal line: corner.
      m.ball.vx = -direction * Math.max(4, Math.abs(m.ball.vx) * 0.3);
      m.ball.vy = (m.ball.y >= keeper.y ? 1 : -1) * 1.5;
      m.ball.vz = 4.5;
    } else {
      // Parries go wide and away from goal rather than back into the danger zone.
      const wide = Math.sign(m.ball.y - FIELD_WIDTH / 2) || (m.ball.y >= keeper.y ? 1 : -1);
      m.ball.vx = direction * Math.max(3, Math.abs(m.ball.vx) * 0.3);
      m.ball.vy = wide * (4 + speed * 0.24);
      m.ball.vz = 2.2;
    }
    if (!crowd) m.setAction(keeper, oneOnOne ? 'keeper-smother' : keeper.action==='keeper-dive'||distance(keeper, m.ball) > 1.15 ? 'keeper-dive' : 'keeper-parry');
  }
  keeper.actionTarget={x:keeper.contact.x,y:keeper.contact.y,z:keeper.contact.z};
  m.activeShot = null;
  m.intendedReceiverId = null;
  if (catchBall) m.football.offsideCandidates = [];
}

export function keeperReach(m: ArcadeMatch, keeper: ArcadeActor): number {
  const base = m.hook(keeper, HK.keeperReach, 1.3 + m.stat(keeper,'goalkeeping') * 0.006);
  if (keeper.action !== 'keeper-dive' || !actionIsPlaying('keeper-dive', keeper.actionStartedTick, m.tick)) return base;
  const age = (m.tick - keeper.actionStartedTick) / 60;
  return base + 0.75 * clamp(age / 0.22, 0, 1) * (age < 0.6 ? 1 : 0.4);
}

/** The keeper commits to a side (or stays central) as the penalty is struck. */
export function keeperGuessesPenalty(m: ArcadeMatch, shootingSide: Side): void {
  const keeper = m.actors.find(actor => actor.active && actor.side !== shootingSide && actor.player.positionGroup === 'GK');
  if (!keeper) return;
  let guessY: number;
  if (m.config.controllerMode === 'human' && keeper.side === m.controlledSide) {
    // The defending player picks the corner with the stick (up or down the screen); a neutral stick stays in the middle.
    const stick = m.previousInput.moveY;
    if (Math.abs(stick) < 0.35) return;
    guessY = FIELD_WIDTH / 2 + Math.sign(stick) * 2.4;
  } else {
    const roll = m.rng.next();
    if (roll < 0.2) return;
    guessY = FIELD_WIDTH / 2 + (roll < 0.6 ? -1 : 1) * 2.4;
  }
  m.setAction(keeper, 'keeper-dive');
  keeper.actionTarget = { x: keeper.x, y: guessY, z: 0.7 };
}

const CLAIM_TICKS = [6, 12, 18, 24, 30, 36, 42, 48, 54, 60] as const;

/**
 * Coming for a cross: the first point of the ball's flight inside the claiming zone that he reaches with his hands before
 * the ball does and before any opponent. Without such a point he stays on his line.
 */
export function keeperClaimTarget(m: ArcadeMatch, keeper: ArcadeActor, direction: 1 | -1): { x: number; y: number } | null {
  const ball = m.ball;
  if (ball.ownerId || m.activeShot || (ball.z < 1.2 && ball.vz < 2)) return null;
  const goalX = direction > 0 ? 0 : FIELD_LENGTH;
  if (Math.abs(ball.x - goalX) > 42) return null;
  const centre = FIELD_WIDTH / 2;
  const path = m.predictBall(CLAIM_TICKS);
  for (let index = 0; index < path.length; index++) {
    const point = path[index];
    if (point.z > T.keeper.claimHeight - 0.1 || point.z < 0.4) continue;
    if (Math.abs(point.x - goalX) > PITCH.penaltyDepth * 0.72 || Math.abs(point.y - centre) > PITCH.penaltyHalfWidth * 0.7) continue;
    const seconds = CLAIM_TICKS[index] / 60;
    const own = len2(point.x - keeper.x, point.y - keeper.y);
    if ((own - 0.6) / 6.2 > seconds) continue;
    for (const other of m.actors) {
      // An attacker who is there first heads it: the keeper stays at home.
      if (other.active && other.side !== keeper.side && len2(point.x - other.x, point.y - other.y) < own - 1) return null;
    }
    return { x: point.x, y: point.y };
  }
  return null;
}

/** Alone against the carrier: nobody of his own between the ball and the goal. */
export function keeperIsAlone(m: ArcadeMatch, keeper: ArcadeActor, owner: ArcadeActor | undefined, direction: 1 | -1): boolean {
  if (!owner || owner.side === keeper.side) return false;
  const depth = direction > 0 ? owner.x : FIELD_LENGTH - owner.x;
  if (depth > 26 * FIELD_LENGTH / 105) return false;
  for (const mate of m.actors) {
    if (!mate.active || mate.side !== keeper.side || mate === keeper) continue;
    const mateDepth = direction > 0 ? mate.x : FIELD_LENGTH - mate.x;
    if (mateDepth < depth + 1 && Math.abs(mate.y - owner.y) < 6) return false;
  }
  return true;
}

/**
 * Distribution with the ball in his hands. He waits a moment for the picture: a direct side sends the long kick to a free
 * runner up the pitch, everybody else throws to a free team-mate nearby; only when nothing opens up does he kick long.
 */
export function keeperDistribute(m: ArcadeMatch, keeper: ArcadeActor, direction: 1 | -1, pressureDistance: number): void {
  let hold = m.football.keeperHold;
  if (!hold || hold.id !== keeper.player.id) hold = m.football.keeperHold = { id: keeper.player.id, sinceTick: m.tick };
  // Distances were tuned on the full pitch and shrink with the five-a-side cage.
  const scale = FIELD_LENGTH / 105;
  const held = (m.tick - hold.sinceTick) / 60;
  // With the ball in his hands he is protected, so only an opponent right on top of him hurries the release.
  const pressured = pressureDistance < 3 * scale;
  keeper.intentX = keeper.x;
  keeper.intentY = keeper.y;
  if (held < (pressured ? 0.3 : T.keeper.holdMin)) { m.setAction(keeper, 'keeper-ready'); return; }
  const team = m.teamOf(keeper.side);
  const longBall = team.tactics.buildUp === 'long-ball';
  // The furthest free team-mate who is onside: the outlet of a counter, or the target of a clearance.
  let runner: ArcadeActor | undefined, furthest: ArcadeActor | undefined, runnerGain = 0, furthestGain = 0;
  for (const mate of m.actors) {
    if (!mate.active || mate.side !== keeper.side || mate === keeper) continue;
    const gain = (mate.x - keeper.x) * direction;
    if (gain > furthestGain) { furthestGain = gain; furthest = mate; }
    if (gain > 30 * scale && gain > runnerGain && closestOpponentDistance(mate, m.actors) > 6 * scale && !m.isOffside(mate, keeper)) { runnerGain = gain; runner = mate; }
  }
  const short = longBall ? null : m.bestPassOption(keeper, direction);
  const safeShort = short && distance(keeper, short.target) < 30 && closestOpponentDistance(short.target, m.actors) > 5 * scale ? short.target : undefined;
  const expired = held >= T.keeper.holdMax;
  // The long ball is a choice of the side (long-ball build-up, counter-attacks), otherwise the last resort.
  const direct = longBall || team.tactics.counterAttack;
  if (runner && direct) release(m, keeper, runner);
  else if (longBall && furthest) release(m, keeper, furthest);
  else if (safeShort ?? ((pressured || expired) && short)) release(m, keeper, safeShort ?? short!.target);
  else if (pressured || expired) {
    const target = runner ?? furthest;
    if (target) release(m, keeper, target);
    else { m.pass(keeper, false, true, 0.85, direction, 0); m.setAction(keeper, 'keeper-kick'); }
  } else return;
  m.football.keeperHold = null;
}

/** A team-mate within throwing range gets the ball from the hand, flat and safe; anybody further away the long kick. */
function release(m: ArcadeMatch, keeper: ArcadeActor, target: ArcadeActor): void {
  const gap = distance(keeper, target);
  if (gap > T.keeper.throwRange) {
    m.pass(keeper, false, true, clamp(0.5 + gap * 0.007, 0.6, 0.95), target.x - keeper.x, target.y - keeper.y, target);
    m.setAction(keeper, 'keeper-kick');
    return;
  }
  m.pass(keeper, false, false, clamp(0.3 + gap * 0.012, 0.35, 0.7), target.x - keeper.x, target.y - keeper.y, target);
  m.setAction(keeper, 'keeper-throw');
  if (keeper.contact) { keeper.contact.kind = 'hand'; m.ball.vz = 1.8; }
}
