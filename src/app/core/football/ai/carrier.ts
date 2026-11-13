import { tacticalIntent } from '../tactical-intent';
import { clamp } from '../../util';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, distance, len2 } from '../match-types';
import { closestOpponentDistance, passLanePressure } from '../pitch-analysis';
import { keeperPositionIntent } from '../keeper-ai';
import { keeperClaimTarget, keeperDistribute, keeperIsAlone } from './keeper';
import { actionValue, dribbleSuccess, expectedThreat, passCompletion } from '../xt';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

export function chooseAiIntent(m: ArcadeMatch, actor: ArcadeActor): void {
  const owner = m.owner();
  const team = m.teamOf(actor.side);
  const direction = m.attackDirection(actor.side);
  m.setAction(actor, 'formation');
  if (owner?.player.id === actor.player.id) {
    // A kick is already in its wind-up: nothing more to decide until the ball is struck.
    if (m.football.pendingKick?.actorId === actor.player.id) return;
    m.setAction(actor, 'carry');
    const goalDistance = direction > 0 ? FIELD_LENGTH - actor.x : actor.x;
    const pressureDistance = m.closestOpponent(actor);
    const pressured = pressureDistance < 4;
    // Shooting range and lane were tuned on 105 × 68 m and shrink with the five-a-side cage (factor 1 on the full pitch).
    const shootingLane = Math.abs(actor.y - FIELD_WIDTH / 2) < 18 * FIELD_WIDTH / 68;
    const openLane = [-0.65, 0, 0.65].map(lateral => {
      const target = { x: clamp(actor.x + direction * 8,1,FIELD_LENGTH - 1), y:clamp(actor.y + lateral * 8,2,FIELD_WIDTH - 2) };
      const clearance = Math.min(...m.actors.filter(other=>other.active && other.side!==actor.side).map(other=>distance(other,target)));
      return { ...target, score: clearance - Math.abs(target.y-FIELD_WIDTH/2)*0.09 };
    }).sort((a,b)=>b.score-a.score)[0];
    actor.intentX = openLane.x;
    actor.intentY = openLane.y;
    const shotRange = 39 * FIELD_LENGTH / 105;
    const shotValue = goalDistance < shotRange && shootingLane ? m.shotValue(actor) : 0;
    const level = m.aiLevel(actor.side);
    // Phase H balance: a little more willing to shoot (about 11 shots per team instead of 9), see the wider shot dispersion.
    const shotThreshold = level === 'easy' ? .16 : level === 'hard' ? .09 : .098;
    const captain = team.tactics.captainId === actor.player.id;
    const patience = team.tactics.tempo === 'slow' ? .16 : team.tactics.tempo === 'fast' ? .40 : .26;
    if (actor.player.positionGroup === 'GK') {
      keeperDistribute(m, actor, direction, pressureDistance);
    } else if (goalDistance < shotRange && shootingLane && shotValue >= shotThreshold && !m.betterPlacedTeammate(actor, shotValue)) {
      const keeper = m.actors.find(other=>other.active && other.side!==actor.side && other.player.positionGroup==='GK');
      const farCorner = keeper && keeper.y > FIELD_WIDTH/2 ? -.78 : .78;
      const level = m.aiLevel(actor.side);
      const accuracy = level === 'easy' ? .45 : level === 'hard' ? .10 : .25;
      const power = m.rng.float(.50,.93);
      const aimY = clamp(farCorner+m.rng.float(-accuracy,accuracy),-1,1);
      const finesse = goalDistance > 18 && m.stat(actor,'shooting') > 72, low = goalDistance < 14;
      m.scheduleKick(actor, { type: 'shoot', power, aimX: direction, aimY, finesse, low }, finesse ? 'finesse-shot' : low ? 'low-shot' : 'shot');
    } else if (m.tryAiSkill(actor, pressureDistance)) {
      // Took the defender on.
    } else {
      // Options are weighed by expected threat: what a pass or a dribble gains, how likely it works, what a lost ball costs.
      const option = m.bestPassOption(actor, direction);
      const here = expectedThreat(actor.x, actor.y, direction);
      const dribble = actionValue(dribbleSuccess(m.stat(actor,'dribbling'), pressureDistance), expectedThreat(openLane.x, openLane.y, direction) - here, here);
      // Patient teams pass later, fast ones earlier; a captain keeps the ball moving.
      const bias = .003 + (team.tactics.tempo === 'slow' ? .003 : team.tactics.tempo === 'fast' ? -.003 : 0) - (captain ? .001 : 0);
      const passes = !!option && option.value > dribble + bias;
      if (pressured || passes || (shotValue >= shotThreshold && goalDistance < shotRange)) {
        const cross = goalDistance < 26 && Math.abs(actor.y-FIELD_WIDTH/2) > Math.min(16, FIELD_WIDTH/4);
        if (cross) {
          const driven = m.rng.bool(.3);
          if (m.crossRunner(actor, 0, 0)) {
            m.scheduleKick(actor, { type: 'cross', through: driven, power: .7, aimX: 0, aimY: 0 }, driven ? 'pass' : 'lob');
            return;
          }
        }
        if (option) {
          const target = option.target;
          const gap = distance(actor, target);
          const forward = (target.x - actor.x) * direction;
          // A ball behind the line for a runner is a through ball; far targets are played long.
          const through = (forward > 16 && len2(target.vx, target.vy) > 4) || (team.tactics.counterAttack && forward > 8 && m.rng.bool(.25));
          const long = gap > 30 || (team.tactics.buildUp === 'long-ball' && forward > 15);
          m.scheduleKick(actor, { type: 'pass', through, lob: long, power: clamp(.25 + gap * .012, .3, .85), aimX: target.x - actor.x, aimY: target.y - actor.y, forcedId: target.player.id },
            long && !through ? 'lob' : through ? 'through-pass' : 'pass');
          // Give-and-go: a short forward pass in the opposition half is sometimes followed by a run for the return ball.
          if (!through && !long && forward > 2 && gap < 22 && goalDistance < FIELD_LENGTH * 0.62 && (!m.football.oneTwoReturn || m.football.oneTwoReturn.untilTick < m.tick) && m.rng.bool(level === 'hard' ? .2 : level === 'easy' ? .05 : .13)) {
            m.football.oneTwoRunnerId = actor.player.id;
            m.football.oneTwoUntilTick = m.tick + 150;
            m.football.oneTwoReturn = { receiverId: target.player.id, runnerId: actor.player.id, untilTick: m.tick + 150 };
          }
        } else {
          const through = team.tactics.counterAttack && m.rng.bool(.25);
          const long = team.tactics.buildUp === 'long-ball' && m.rng.bool(.3);
          const aimY = m.rng.float(-.4,.4);
          m.scheduleKick(actor, { type: 'pass', through, lob: long, power: long?.76:team.tactics.passing==='short'?.38:.60, aimX: direction, aimY },
            long && !through ? 'lob' : through ? 'through-pass' : 'pass');
        }
      }
    }
    return;
  }

  if (actor.player.positionGroup === 'GK') {
    // Without the ball there is nothing left to hold (a whistle or a lost ball ends it).
    if (m.football.keeperHold?.id === actor.player.id) m.football.keeperHold = null;
    const claim = keeperClaimTarget(m, actor, direction);
    const intent = claim ? { action: 'keeper-rush' as const, ...claim } : keeperPositionIntent(actor, m.ball, !!owner, direction, keeperIsAlone(m, actor, owner, direction));
    m.setAction(actor, intent.action);
    actor.intentX = intent.x;
    actor.intentY = intent.y;
    return;
  }

  if (!owner && actor.player.id === m.intendedReceiverId) {
    const horizon = clamp(distance(actor,m.ball)/m.maxSpeed(actor,false),0,.35);
    actor.intentX = clamp(m.ball.x + m.ball.vx*horizon,1,FIELD_LENGTH-1);
    actor.intentY = clamp(m.ball.y + m.ball.vy*horizon,1,FIELD_WIDTH-1);
    m.setAction(actor,'receive');
    return;
  }
  const request = m.football.runRequest;
  if (request && request.id === actor.player.id) {
    if (m.tick >= request.untilTick || (owner && owner.side !== actor.side)) m.football.runRequest = null;
    else {
      // A requested run: along the last defender's line, as deep as it goes without being offside, towards the half-space.
      let first = -Infinity, second = -Infinity;
      for (const other of m.actors) {
        if (!other.active || other.side === actor.side) continue;
        const depth = direction > 0 ? other.x : FIELD_LENGTH - other.x;
        if (depth > first) { second = first; first = depth; } else if (depth > second) second = depth;
      }
      const own = direction > 0 ? actor.x : FIELD_LENGTH - actor.x;
      const targetDepth = Math.min(second > 0 ? second - 0.6 : FIELD_LENGTH - 3, own + 24, FIELD_LENGTH - 3);
      actor.intentX = clamp(direction > 0 ? targetDepth : FIELD_LENGTH - targetDepth, 1, FIELD_LENGTH - 1);
      actor.intentY = clamp(actor.y + (FIELD_WIDTH / 2 - actor.y) * 0.3, 3, FIELD_WIDTH - 3);
      m.setAction(actor, 'formation');
      return;
    }
  }
  const intent = tacticalIntent(actor, owner, m.ball, m.actors, team, direction, m.tick, m.aiLevel(actor.side));
  m.setAction(actor, intent.action);
  actor.intentX = intent.x;
  actor.intentY = intent.y;
  if (m.football.oneTwoRunnerId === actor.player.id && m.tick < m.football.oneTwoUntilTick) {
    actor.intentX = clamp(actor.x + direction * 12, 1, FIELD_LENGTH - 1);
    actor.intentY = clamp(actor.y + (actor.y < FIELD_WIDTH / 2 ? -1 : 1) * 3, 2, FIELD_WIDTH - 2);
  }
}

/** The team-mate whose pass gains most threat once the chance of losing the ball is counted, or null when nobody is a sound option. */
export function bestPassOption(m: ArcadeMatch, actor: ArcadeActor, direction: 1 | -1): { target: ArcadeActor; value: number } | null {
  const here = expectedThreat(actor.x, actor.y, direction);
  let best: { target: ArcadeActor; value: number } | null = null;
  for (const mate of m.actors) {
    if (!mate.active || mate.side !== actor.side || mate === actor || mate.player.positionGroup === 'GK') continue;
    const gap = distance(actor, mate);
    if (gap < 4 || gap > 36) continue;
    const lane = m.passLanePressure(actor, mate);
    if (lane >= 1) continue;
    // The receiver is judged where he will be a moment later.
    const there = expectedThreat(clamp(mate.x + mate.vx * 0.6, 1, FIELD_LENGTH - 1), clamp(mate.y + mate.vy * 0.6, 1, FIELD_WIDTH - 1), direction);
    const completion = passCompletion(lane, gap, closestOpponentDistance(mate, m.actors));
    // A target who looks offside is still found now and then (attackers hover on the line), at a price.
    const value = actionValue(completion, there - here, here) - (m.isOffside(mate, actor) ? T.ai.offsidePassCost : 0);
    if (!best || value > best.value) best = { target: mate, value };
  }
  return best;
}

/** A clearly better chance for a free team-mate turns a speculative shot into a cut-back. */
export function betterPlacedTeammate(m: ArcadeMatch, actor: ArcadeActor, ownValue: number): boolean {
  for (const mate of m.actors) {
    if (!mate.active || mate.side !== actor.side || mate === actor || mate.player.positionGroup === 'GK') continue;
    if (distance(mate, actor) > 22 || m.passLanePressure(actor, mate) > 0 || m.isOffside(mate, actor)) continue;
    if (m.shotValue(mate) > ownValue + 0.08) return true;
  }
  return false;
}
