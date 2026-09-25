import type { RuleState } from '../../models/match.model';
import type { Team } from '../../models/team.model';
import { clamp } from '../util';
import { BALL_RADIUS } from './ball-physics';
import { ArcadeActor, ArcadeBall, distance } from './match-types';

/** Nominated specialist first, then the keeper for goal kicks, then the nearest outfield player. */
export function chooseRestartTaker(rule: RuleState, team: Team, candidates: readonly ArcadeActor[], ball: ArcadeBall): ArcadeActor | undefined {
  const phase = rule.phase;
  const nominated = phase === 'penalty' ? team.tactics.penaltyTakerId : phase === 'corner' ? team.tactics.cornerTakerId : phase === 'freeKick' ? team.tactics.freeKickTakerId : null;
  return candidates.find(actor => actor.player.id === nominated)
    ?? (phase === 'goalKick' ? candidates.find(actor => actor.player.positionGroup === 'GK') : undefined)
    ?? candidates.filter(actor => actor.player.positionGroup !== 'GK').sort((a, b) => distance(a, ball) - distance(b, ball))[0]
    ?? candidates[0];
}

/** Wall size for a direct free kick: more players the closer and more central the kick. */
export function wallSize(rule: RuleState, goalDistance: number, lateral: number): number {
  if (rule.phase !== 'freeKick' || rule.indirect || goalDistance > 32 || lateral > 22) return 0;
  const base = goalDistance < 20 ? 5 : goalDistance < 25 ? 4 : goalDistance < 29 ? 3 : 2;
  return Math.max(1, base - (lateral > 14 ? 2 : lateral > 9 ? 1 : 0));
}

/** Places taker, ball and both teams legally for the restart (kick-off halves, 9.15 m, penalty arc, goal-kick box). */
export function arrangeRestart(taker: ArcadeActor, rule: RuleState, ball: ArcadeBall, actors: readonly ArcadeActor[], attackDirection: (actor: ArcadeActor) => 1 | -1): void {
  const direction = attackDirection(taker);
  taker.x = clamp(rule.spotX - direction * .45, .4, 104.6);
  taker.y = clamp(rule.spotY, .4, 67.6);
  taker.vx = taker.vy = 0;
  taker.facingX = direction; taker.facingY = 0;
  ball.x = rule.spotX; ball.y = rule.spotY; ball.z = BALL_RADIUS;
  const goalX = direction > 0 ? 105 : 0;
  const wall = wallSize(rule, Math.abs(goalX - ball.x), Math.abs(ball.y - 34));
  const wallPlayers = wall ? actors
    .filter(actor => actor.active && actor.side !== taker.side && actor.player.positionGroup !== 'GK')
    .sort((a, b) => distance(a, ball) - distance(b, ball)).slice(0, wall) : [];
  if (wallPlayers.length) {
    // The wall stands 9.15 m from the ball on the line to the goal centre, shoulder to shoulder.
    const dx = goalX - ball.x, dy = 34 - ball.y, length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    wallPlayers.forEach((actor, index) => {
      const offset = (index - (wallPlayers.length - 1) / 2) * 0.62 + 0.35;
      actor.x = clamp(ball.x + ux * 9.15 - uy * offset, .4, 104.6);
      actor.y = clamp(ball.y + uy * 9.15 + ux * offset, .4, 67.6);
      actor.vx = actor.vy = 0;
      actor.facingX = -ux; actor.facingY = -uy;
      actor.intentX = actor.x; actor.intentY = actor.y;
      actor.decisionCooldown = Math.max(actor.decisionCooldown, 0.8);
    });
  }
  for (const actor of actors) {
    if (wallPlayers.includes(actor)) continue;
    if (!actor.active || actor === taker) continue;
    actor.vx = actor.vy = 0;
    const separation = rule.phase === 'throwIn' ? 2 : 9.15;
    if (rule.phase === 'kickoff') {
      actor.x = attackDirection(actor) > 0 ? Math.min(actor.x, 51) : Math.max(actor.x, 54);
    }
    if (rule.phase === 'penalty') {
      if (actor.side !== taker.side && actor.player.positionGroup === 'GK') { actor.x = direction > 0 ? 104.89 : .11; actor.y = 34; continue; }
      actor.x = direction > 0 ? Math.min(actor.x, 87) : Math.max(actor.x, 18);
    }
    if (rule.phase === 'goalKick' && actor.side !== taker.side && Math.abs(actor.y - 34) < 20.16) {
      actor.x = direction > 0 ? Math.max(actor.x, 17) : Math.min(actor.x, 88);
    }
    if (actor.side !== taker.side && distance(actor, ball) < separation) {
      const dx = actor.x - ball.x || -direction, dy = actor.y - ball.y;
      const length = Math.hypot(dx, dy) || 1;
      actor.x = clamp(ball.x + dx / length * separation, .4, 104.6);
      actor.y = clamp(ball.y + dy / length * separation, .4, 67.6);
    }
  }
}
