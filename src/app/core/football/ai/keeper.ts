import { Side } from '../../../models/match.model';
import { playerName } from '../../ratings';
import { clamp } from '../../util';
import { actionIsPlaying } from '../action-timing';
import { ArcadeActor, FIELD_WIDTH, distance, len2 } from '../match-types';
import { HK } from '../../rpg/effects';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

export function handlePostsAndKeeper(m: ArcadeMatch): void {
  if (m.ball.ownerId || m.ball.z > 2.45) return;
  // Hands only with the ball inside the own penalty area; a dive extends the reach.
  const keeper = m.actors.find(actor => actor.active && actor.player.positionGroup === 'GK'
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
  const catchBall = distance(keeper, m.ball) < 1.15 && m.rng.bool(clamp(0.45 + reaction * 0.5 - difficulty + (oneOnOne ? 0.06 : 0) - (crowd ? 0.2 : 0), 0.15, 0.92));
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
