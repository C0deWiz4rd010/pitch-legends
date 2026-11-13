import { MatchCommand, RuleState, Side } from '../../../models/match.model';
import { clamp, round } from '../../util';
import { BALL_RADIUS } from '../ball-physics';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, GOAL_HEIGHT, GOAL_WIDTH, PITCH, len2 } from '../match-types';
import { arrangeRestart, chooseRestartTaker, isCrossedRestart } from '../set-pieces';
import { Cond } from '../../rpg/conditions';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

export function setRestart(m: ArcadeMatch, phase: RuleState['phase'], side: Side, x: number, y: number, indirect = false): void {
  m.teleportEpoch++;
  m.football.queuedAction = null;
  m.football.pendingKick = null;
  m.football.oneTwoReturn = null;
  m.applyPendingCards();
  m.football.offsideCandidates = [];
  m.football.restartRelease = null;
  if (phase === 'penalty') { x = m.attackDirection(side) > 0 ? FIELD_LENGTH - PITCH.penaltySpot : PITCH.penaltySpot; y = FIELD_WIDTH / 2; }
  m.rule = m.newRule(phase, side, x, y, indirect);
  m.phase = 'stoppage';
  m.ball.ownerId = null;
  m.ball.x = clamp(x, 0, FIELD_LENGTH);
  m.ball.y = clamp(y, 0, FIELD_WIDTH);
  m.ball.z = 0;
  m.ball.vx = m.ball.vy = m.ball.vz = 0;
  m.ball.spin = m.ball.topspin = 0;
  m.activeShot = null;
  m.intendedReceiverId = null;
  m.pendingOffsideTargetId = null;
}

export function updateRestart(m: ArcadeMatch, dt: number, input: MatchCommand): void {
  if (m.rule.phase === 'halftime' || m.rule.phase === 'fulltime') return;
  const phase = m.rule.phase;
  const side = m.rule.restartSide ?? 'home';
  const team = m.teamOf(side);
  const taker = chooseRestartTaker(m.rule, team, m.actors.filter(actor => actor.active && actor.side === side), m.ball);
  if (!taker) return;
  if (m.rule.elapsed === 0) {
    m.autoSubstitutions();
    m.arrangeRestart(taker);
    m.actionHeld = {pass:0,through:0,lob:0,shoot:0};
  }
  m.rule.elapsed += dt;
  const human = side === m.controlledSide && m.config.controllerMode === 'human';
  if (human) for (const kind of ['pass','through','lob','shoot'] as const) {
    if (input[kind]) m.actionHeld[kind] = Math.min(kind === 'shoot' ? .9 : .8,m.actionHeld[kind]+dt);
    if (!input[kind] && m.previousInput[kind] && m.actionHeld[kind] > 0) {
      m.football.queuedAction = { kind, power:m.charge(m.actionHeld[kind],kind === 'shoot' ? .9 : .8),
        aimX:input.aimX*m.currentAttackDirection,aimY:input.aimY,finesse:input.skill,low:m.actionHeld[kind]<.14,expiresTick:m.tick+180 };
    }
  }
  // A human restart waits for the kick; only after a long pause is it taken automatically (never in training scenarios).
  const forced = !m.scenarioActive && m.rule.elapsed >= T.restart.autoSeconds;
  if (m.rule.elapsed < .42 || (human && !m.football.queuedAction && !forced)) return;
  const command = m.football.queuedAction;
  const indirect = m.rule.indirect;
  const direction = m.attackDirection(side);
  m.ball.ownerId = taker.player.id;
  m.ball.lastTouch = side;
  m.ball.lastTouchPlayerId = taker.player.id;
  m.ball.controlledTouch = 0;
  m.rule = m.newRule('playing',null,m.ball.x,m.ball.y);
  m.phase = m.halftimeReached ? 'secondHalf' : 'firstHalf';
  m.ambientFlags = phase === 'penalty' ? Cond.penalty | Cond.setPiece : phase === 'kickoff' ? 0 : Cond.setPiece;
  m.applyKickFlags(taker, m.ambientFlags);
  const aimX = command && len2(command.aimX,command.aimY)>.1 ? command.aimX : phase==='kickoff'?-direction:direction;
  const aimY = command?.aimY ?? 0;
  const goalDistance = Math.abs((direction > 0 ? FIELD_LENGTH : 0) - m.ball.x);
  // Unattended direct free kicks within range are struck at goal with curl, over or round the wall.
  const aiDirectFreeKick = !command && phase === 'freeKick' && !indirect && goalDistance < 28 && Math.abs(m.ball.y - FIELD_WIDTH / 2) < 16
    && m.stat(taker,'shooting') >= 62 && m.rng.bool(0.7);
  if (phase === 'penalty' || aiDirectFreeKick || command?.kind === 'shoot' && phase !== 'throwIn' && !indirect) {
    m.penaltyNerves = phase === 'penalty' ? m.penaltyComposure(taker) : 1;
    m.shoot(taker,command?.power ?? (aiDirectFreeKick ? .78 : .72),direction,command?.aimY ?? m.rng.float(-.8,.8),command?.finesse ?? aiDirectFreeKick,command?.low ?? false);
    m.penaltyNerves = 1;
    if (phase === 'penalty') m.keeperGuessesPenalty(side);
  } else {
    const lob = phase === 'corner' || command?.kind === 'lob';
    // A corner is a real delivery into the box, steered by the stick; without a target it falls back to a lofted pass.
    const delivered = isCrossedRestart({ ...m.rule, phase, indirect }, goalDistance, Math.abs(m.ball.y - FIELD_WIDTH / 2))
      && m.cross(taker, command?.kind === 'through', command?.power ?? .75, command ? aimX : 0, command ? aimY : 0);
    if (!delivered) m.pass(taker,command?.kind==='through',lob,command?.power ?? (lob?.75:.4),aimX,aimY);
    if (phase === 'throwIn') {
      // A throw leaves the hands at 8-14 m/s, not at passing speed.
      const throwSpeed = len2(m.ball.vx, m.ball.vy) || 1;
      const scaled = clamp(throwSpeed, 8, 14) / throwSpeed;
      m.ball.vx *= scaled; m.ball.vy *= scaled;
      m.ball.z = 1.65;
      m.ball.vz = 2.6;
      if (taker.contact) taker.contact.kind = 'hand';
      m.setAction(taker,'keeper-throw');
    }
  }
  m.ambientFlags = 0;
  m.applyKickFlags(taker, 0);
  if (['corner','goalKick','throwIn'].includes(phase)) {
    m.football.offsideCandidates = [];
    m.pendingOffsideTargetId = null;
  }
  m.football.restartRelease = {phase,side,takerId:taker.player.id,indirect};
  m.football.queuedAction = null;
  m.actionHeld = {pass:0,through:0,lob:0,shoot:0};
}

export function legalRestartTouch(m: ArcadeMatch, actor: ArcadeActor): boolean {
  const restart = m.football.restartRelease;
  if (!restart) return true;
  if (restart.takerId === actor.player.id) {
    m.setRestart('freeKick',m.opposite(actor.side),m.ball.x,m.ball.y,true);
    return false;
  }
  m.football.restartRelease = null;
  return true;
}

export function resetKickoff(m: ArcadeMatch, side: Side): void {
  m.teleportEpoch++;
  m.football.restartRelease = null;
  m.football.queuedAction = null;
  m.football.pendingKick = null;
  m.football.runRequest = null;
  m.football.oneTwoReturn = null;
  m.applyPendingCards();
  for (const actor of m.actors) {
    if (!actor.active) continue;
    actor.x = actor.homeX;
    actor.y = actor.homeY;
    actor.vx = actor.vy = 0;
    actor.intentX = actor.homeX;
    actor.intentY = actor.homeY;
  }
  m.ball.x = FIELD_LENGTH / 2;
  m.ball.y = FIELD_WIDTH / 2;
  m.ball.z = 0;
  m.ball.vx = m.ball.vy = m.ball.vz = m.ball.spin = m.ball.topspin = 0;
  m.ball.ownerId = null;
  m.ball.lastTouch = side;
  m.ball.lastTouchPlayerId = null;
  m.activeShot = null;
  m.intendedReceiverId = null;
  m.pendingOffsideTargetId = null;
  m.rule = m.newRule('kickoff', side, m.ball.x, m.ball.y);
  m.phase = 'stoppage';
  m.paused = false;
}

export function handleBoundary(m: ArcadeMatch): boolean {
  if (m.config.smallSided && m.bounceOffBoards()) return false;
  if (m.ball.x < -BALL_RADIUS || m.ball.x > FIELD_LENGTH + BALL_RADIUS) {
    const inGoal = Math.abs(m.ball.y - FIELD_WIDTH / 2) <= GOAL_WIDTH / 2 - BALL_RADIUS && m.ball.z <= GOAL_HEIGHT - BALL_RADIUS;
    if (inGoal) {
      const scoringSide = m.ball.x > FIELD_LENGTH ? m.sideAttackingDirection(1) : m.sideAttackingDirection(-1);
      const restart = m.football.restartRelease;
      if (restart && (scoringSide !== restart.side || restart.phase==='throwIn' || restart.indirect)) {
        const own = scoringSide !== restart.side;
        const endX=m.ball.x<0?0:FIELD_LENGTH;
        m.setRestart(own?'corner':'goalKick',own?scoringSide:m.opposite(scoringSide),own?endX:endX===0?PITCH.goalAreaDepth:FIELD_LENGTH-PITCH.goalAreaDepth,own?0:FIELD_WIDTH/2);
        return true;
      }
      m.scoreGoal(m.ball.x > FIELD_LENGTH ? m.sideAttackingDirection(1) : m.sideAttackingDirection(-1));
      return true;
    }
    const attacking = m.ball.x > FIELD_LENGTH ? m.sideAttackingDirection(1) : m.sideAttackingDirection(-1);
    const corner = m.ball.lastTouch !== attacking;
    if (corner) m.stats(attacking).corners++;
    m.events.push({ minute: m.footballMinute, type: corner ? 'corner' : 'commentary', side: corner ? attacking : null, playerId: null, messageKey: corner ? 'match.corner' : 'match.goalKick', params: { team: m.teamOf(attacking).shortName } });
    const endX = m.ball.x < 0 ? 0 : FIELD_LENGTH;
    m.setRestart(corner ? 'corner' : 'goalKick', corner ? attacking : m.opposite(attacking), corner ? endX : endX === 0 ? PITCH.goalAreaDepth : FIELD_LENGTH - PITCH.goalAreaDepth, corner ? m.ball.y < FIELD_WIDTH / 2 ? 0 : FIELD_WIDTH : FIELD_WIDTH / 2);
    return true;
  }
  if (m.ball.y < -BALL_RADIUS || m.ball.y > FIELD_WIDTH + BALL_RADIUS) {
    const side = m.opposite(m.ball.lastTouch);
    m.events.push({ minute: m.footballMinute, type: 'commentary', side, playerId: null, messageKey: 'match.throwIn', params: { team: m.teamOf(side).shortName } });
    m.setRestart('throwIn', side, clamp(m.ball.x, 1, FIELD_LENGTH - 1), clamp(m.ball.y, 0, FIELD_WIDTH));
    return true;
  }
  return false;
}
