import { hash32 } from '../../visual-identity';
import { PlayerActionState, PendingKick } from '../../../models/match.model';
import { playerName } from '../../ratings';
import { clamp, round } from '../../util';
import { integrateBall } from '../ball-physics';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH, MATCH_TICK, distance, len2 } from '../match-types';
import { passLanePressure } from '../pitch-analysis';
import { HK } from '../../rpg/effects';
import { canUse } from '../../rpg/stat-block';
import { shotXg } from '../xg';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch, Point, AerialKind } from '../../services/arcade-match';

export function tryHeader(m: ArcadeMatch): void {
  if (m.ball.z > 2.95 || m.ball.z < 1.4) return;
  // An aerial duel: how high a player gets depends on his strength (the best reach 2.9 m), and the contest is won on
  // aerial ability, position and a little timing. No player takes it from outside his own jump.
  let actor: ArcadeActor | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of m.actors) {
    if (!candidate.active || candidate.player.positionGroup === 'GK' || (candidate.player.id === m.ball.lastTouchPlayerId && m.ball.controlledTouch < 0.3)) continue;
    const gap = distance(candidate, m.ball);
    if (gap >= 0.9) continue;
    const aerial = m.hook(candidate, HK.aerial, m.stat(candidate,'physical') * 0.75 + m.stat(candidate,'defending') * 0.15 + m.stat(candidate,'shooting') * 0.10);
    if (m.ball.z > 2.2 + aerial / 100 * 0.7) continue;
    const score = aerial * 0.5 + (0.9 - gap) * 30 + m.rng.float(0, 15);
    if (score > bestScore) { actor = candidate; bestScore = score; }
  }
  if (!actor) return;
  const queued = actor.side === m.controlledSide ? m.football.queuedAction : null;
  const goalX = m.attackDirection(actor.side) > 0 ? FIELD_LENGTH : 0;
  const goalDistance = Math.abs(goalX - actor.x);
  const attempt = queued?.kind === 'shoot' || (!m.isHumanControlled(actor) && goalDistance < 18);
  if (!attempt) {
    // Every other arriving high ball is met: clearances near the own goal, headed passes elsewhere.
    if (len2(m.ball.vx, m.ball.vy) > 4 && distance(actor, m.ball) < 0.6 && m.legalRestartTouch(actor)) m.defensiveHeader(actor, goalDistance);
    return;
  }
  if (!m.legalRestartTouch(actor)) return;
  if (m.football.offsideCandidates.includes(actor.player.id)) {
    m.stats(actor.side).offsides++;
    m.events.push({ minute: m.footballMinute, type: 'foul', side: actor.side, playerId: actor.player.id, messageKey: 'match.offside', params: { player: playerName(actor.player) } });
    m.setRestart('freeKick', m.opposite(actor.side), actor.x, actor.y, true);
    return;
  }
  m.headAtGoal(actor, queued?.aimY ?? m.rng.float(-0.6, 0.6));
}

/** A header at goal. `errorScale` and `speedBonus` make an acrobatic header harder to place and harder to hit. */
export function headAtGoal(m: ArcadeMatch, actor: ArcadeActor, aimInput: number, errorScale = 1, speedBonus = 0, action: PlayerActionState = 'header'): void {
  const direction = m.attackDirection(actor.side);
  const goalX = direction > 0 ? FIELD_LENGTH : 0;
  const goalDistance = Math.abs(goalX - actor.x);
  const aimedY = FIELD_WIDTH / 2 + aimInput * 2.6;
  // Heading accuracy depends on strength, finishing and distance; wide headers really miss.
  const headingError = ((100 - (m.stat(actor,'physical') + m.stat(actor,'shooting')) / 2) / 100 * 1.8 + goalDistance * 0.06) * errorScale;
  const targetY = aimedY + m.rng.normal(0, headingError);
  const headerXg = shotXg(goalDistance, actor.y - FIELD_WIDTH / 2, m.stat(actor,'shooting'), clamp((3 - m.closestOpponent(actor)) / 3, 0, 1), true, FIELD_WIDTH);
  const length = len2(goalX - actor.x, targetY - actor.y);
  // The power-header talent: the head drives through the ball.
  const powerHeader = canUse(m.statsOf(actor), 'power-header') ? 2.4 : 0;
  const speed = 11 + m.stat(actor,'physical') * 0.07 + speedBonus + powerHeader;
  m.releaseBall(actor, (goalX - actor.x) / length * speed, (targetY - actor.y) / length * speed, -1.4, 0, 0, 0);
  if (actor.contact) actor.contact.kind = 'head';
  m.setAction(actor, action);
  m.stats(actor.side).shots++;
  if (Math.abs(targetY - FIELD_WIDTH / 2) <= GOAL_WIDTH / 2) m.stats(actor.side).shotsOnTarget++;
  m.stats(actor.side).xG = round(m.stats(actor.side).xG + headerXg, 2);
  m.activeShot = { shooterId: actor.player.id, side: actor.side, xG: headerXg, targetY, checkedKeeper: false };
  m.registerShotForSignatures(actor, headerXg);
  m.football.queuedAction = null;
  m.events.push({ minute: m.footballMinute, type: 'shot', side: actor.side, playerId: actor.player.id, params: { player: playerName(actor.player), xG: round(headerXg, 2), distance: round(goalDistance, 1) } });
}

/** Where the ball will be after `ticks` more ticks of free flight; samples are taken at each tick listed in `at`. */
export function predictBall(m: ArcadeMatch, at: readonly number[]): Point[] {
  const scratch = m.predictScratch;
  Object.assign(scratch, { x: m.ball.x, y: m.ball.y, z: m.ball.z, vx: m.ball.vx, vy: m.ball.vy, vz: m.ball.vz, spin: m.ball.spin, topspin: m.ball.topspin });
  const wet = m.config.weather !== 'clear';
  const out: Point[] = [];
  const last = at[at.length - 1];
  for (let tick = 1; tick <= last; tick++) {
    integrateBall(scratch, MATCH_TICK / 2, wet);
    integrateBall(scratch, MATCH_TICK / 2, wet);
    if (at.includes(tick)) out.push({ x: scratch.x, y: scratch.y, z: scratch.z });
  }
  return out;
}

/**
 * Explicit acrobatic strikes at a ball that is not controlled first: a volley (half-volley) at foot height, a diving header at a
 * low ball and a scissor kick at a ball high behind the player. The human asks for them with a shoot press as the ball arrives;
 * the AI takes a share of them for balls its team-mates played. Returns true when a strike was committed.
 */
export function tryAerialStrike(m: ArcadeMatch): boolean {
  const ball = m.ball;
  if (m.football.pendingKick || ball.ownerId || ball.z > 2.7 || m.config.smallSided) return false;
  const speed = len2(ball.vx, ball.vy);
  if (speed < 3 || speed > 26) return false;
  const queued = m.football.queuedAction;
  const passer = m.lastPasser;
  let plan: { t4: Point; t10: Point; t12: Point } | undefined;
  for (const actor of m.actors) {
    if (!actor.active || actor.player.positionGroup === 'GK') continue;
    if (Math.abs(actor.x - ball.x) > 4 || Math.abs(actor.y - ball.y) > 4) continue;
    if (actor.player.id === ball.lastTouchPlayerId && ball.controlledTouch < 0.3) continue;
    const human = m.isHumanControlled(actor);
    if (human ? !queued || queued.kind !== 'shoot' || queued.feint || queued.expiresTick < m.tick : !passer || passer.received || passer.side !== actor.side || passer.id === actor.player.id) continue;
    const direction = m.attackDirection(actor.side);
    const goalX = direction > 0 ? FIELD_LENGTH : 0;
    const goalDistance = Math.abs(goalX - actor.x);
    if (goalDistance > (human ? 34 : 24) || Math.abs(actor.y - FIELD_WIDTH / 2) > 18) continue;
    const skill = (m.stat(actor, 'shooting') - 60) / 8;
    const roll = (kind: string, share: number) => human || hash32(`${passer!.at}|${actor.player.id}|${kind}`) % 100 < share + skill;
    if (!plan) { const [t4, t10, t12] = m.predictBall([4, 10, 12]); plan = { t4, t10, t12 }; }
    const behind = (ball.x - actor.x) * direction;
    let type: AerialKind | null = null;
    const near = (point: Point) => len2(point.x - actor.x, point.y - actor.y);
    if (goalDistance < 20 && behind < -0.3 && behind > -2.8 && ball.z > 1.1 && plan.t10.z > 1.0 && plan.t10.z < 2.6 && near(plan.t10) < 1.4 && roll('bicycle', T.ai.bicycleShare)) type = 'bicycle-kick';
    else if (goalDistance < 16 && speed >= 5 && ball.z > 0.2 && ball.z < 1.2 && plan.t12.z > 0.25 && plan.t12.z < 1.0 && near(plan.t12) > 0.9 && near(plan.t12) < 2.6 && roll('flying', T.ai.flyingHeaderShare)) type = 'flying-header';
    else if (ball.z > 0.12 && ball.z < 1.3 && plan.t4.z > 0.12 && plan.t4.z < 1.1 && near(plan.t4) < 0.95 && roll('volley', T.ai.volleyShare)) type = 'volley';
    if (!type) continue;
    let aimY: number;
    let power: number;
    if (human) { aimY = queued!.aimY; power = queued!.power; }
    else {
      const keeper = m.actors.find((other) => other.active && other.side !== actor.side && other.player.positionGroup === 'GK');
      aimY = clamp((keeper && keeper.y > FIELD_WIDTH / 2 ? -0.7 : 0.7) + m.rng.float(-0.3, 0.3), -1, 1);
      power = m.rng.float(0.55, 0.9);
    }
    m.football.queuedAction = null;
    m.scheduleKick(actor, { type, power, aimX: direction, aimY }, type);
    if (type === 'flying-header' || type === 'bicycle-kick') {
      // The body commits: a dive towards where the ball will be, or a hop back for the scissor kick.
      if (type === 'flying-header') {
        const gap = near(plan.t12) || 1;
        const lunge = Math.min(7, gap / 0.2 * 0.8);
        actor.vx = (plan.t12.x - actor.x) / gap * lunge;
        actor.vy = (plan.t12.y - actor.y) / gap * lunge;
      } else {
        actor.vx = -direction * 1.2;
        actor.vy = 0;
      }
      actor.facingX = direction; actor.facingY = 0;
    }
    return true;
  }
  return false;
}

/** The ball is struck: only when it is really within reach at this tick, otherwise the strike misses and the ball runs on. */
export function strikeAerial(m: ArcadeMatch, actor: ArcadeActor, kick: PendingKick): void {
  const ball = m.ball;
  const reach = kick.type === 'flying-header' ? 1.8 : kick.type === 'bicycle-kick' ? 1.55 : 1.3;
  const height = kick.type === 'volley' ? 1.5 : 2.9;
  const direction = m.attackDirection(actor.side);
  if (kick.type !== 'volley') m.startRecovery(actor, 40);
  if (len2(ball.x - actor.x, ball.y - actor.y) > reach || ball.z > height || !m.legalRestartTouch(actor)) return;
  if (m.football.offsideCandidates.includes(actor.player.id)) {
    m.stats(actor.side).offsides++;
    m.events.push({ minute: m.footballMinute, type: 'foul', side: actor.side, playerId: actor.player.id, messageKey: 'match.offside', params: { player: playerName(actor.player) } });
    m.setRestart('freeKick', m.opposite(actor.side), actor.x, actor.y, true);
    return;
  }
  const passer = m.lastPasser;
  if (passer && !passer.received && m.elapsed - passer.at <= 5 && passer.side === actor.side && passer.id !== actor.player.id) {
    passer.received = true;
    m.passCompletions[actor.side]++;
    m.stats(actor.side).passesCompleted++;
    m.addFocus(actor.side, 0.5);
    m.ratings[passer.id] = clamp((m.ratings[passer.id] ?? 6.5) + 0.025, 1, 10);
  }
  m.pendingOffsideTargetId = null;
  m.football.offsideCandidates = [];
  const accuracy = kick.timed ? 0.6 : 1;
  if (kick.type === 'volley') {
    ball.ownerId = actor.player.id;
    m.shoot(actor, kick.power, kick.aimX, kick.aimY, false, false, false, false, true, accuracy);
  } else if (kick.type === 'flying-header') {
    m.headAtGoal(actor, kick.aimY, 1.35, 3, 'flying-header');
  } else {
    // The scissor kick needs the right body: strength in the air and a finisher's technique. A mishit just sends the ball away.
    const aerial = m.hook(actor, HK.aerial, m.stat(actor, 'physical') * 0.75 + m.stat(actor, 'defending') * 0.15 + m.stat(actor, 'shooting') * 0.1);
    if (m.rng.bool(clamp(0.2 + aerial / 100 * 0.4 + m.stat(actor, 'shooting') / 100 * 0.3, 0.2, 0.85))) {
      ball.ownerId = actor.player.id;
      m.shoot(actor, 0.8, kick.aimX, kick.aimY, false, false, false, true, true, 1.5);
    } else {
      ball.lastTouch = actor.side; ball.lastTouchPlayerId = actor.player.id; ball.controlledTouch = 0;
      ball.vx = direction * (3 + m.rng.float(0, 4)); ball.vy = m.rng.float(-4, 4); ball.vz = 2.5;
      actor.contact = { tick: m.tick, x: ball.x, y: ball.y, z: ball.z, kind: 'foot', foot: actor.player.foot === 'Left' ? 'left' : 'right' };
      m.activeShot = null;
      m.intendedReceiverId = null;
    }
  }
  // The strike keeps its own pose; the generic shot or header action set inside is replaced.
  m.setAction(actor, kick.type as AerialKind, true);
  actor.actionStartedTick = kick.startTick;
}

export function defensiveHeader(m: ArcadeMatch, actor: ArcadeActor, attackingGoalDistance: number): void {
  if (m.football.offsideCandidates.includes(actor.player.id)) {
    m.stats(actor.side).offsides++;
    m.events.push({ minute: m.footballMinute, type: 'foul', side: actor.side, playerId: actor.player.id, messageKey: 'match.offside', params: { player: playerName(actor.player) } });
    m.setRestart('freeKick', m.opposite(actor.side), actor.x, actor.y, true);
    return;
  }
  const direction = m.attackDirection(actor.side);
  const strength = m.stat(actor,'physical');
  const teammates = m.actors.filter(candidate => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id);
  if (attackingGoalDistance > 70) {
    const wide = actor.y < FIELD_WIDTH / 2 ? -1 : 1;
    const speed = 13 + strength * 0.06;
    m.releaseBall(actor, direction * speed * 0.85, wide * speed * 0.5, 5, 0);
    m.intendedReceiverId = null;
  } else {
    const target = teammates
      .filter(candidate => candidate.player.positionGroup !== 'GK' && distance(candidate, actor) > 4 && distance(candidate, actor) < 20
        && ((candidate.x - actor.x) * actor.facingX + (candidate.y - actor.y) * actor.facingY) > 0)
      .sort((a, b) => m.passLanePressure(actor, a) - m.passLanePressure(actor, b) || distance(a, actor) - distance(b, actor))[0];
    const aimX = target ? target.x - actor.x : actor.facingX, aimY = target ? target.y - actor.y : actor.facingY;
    const length = len2(aimX, aimY) || 1;
    m.registerPass(actor, target, teammates);
    m.releaseBall(actor, aimX / length * 11, aimY / length * 11, 2.4, 0);
  }
  if (actor.contact) actor.contact.kind = 'head';
  m.setAction(actor, 'header');
  m.activeShot = null;
}
