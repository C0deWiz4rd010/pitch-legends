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

/** Places taker, ball and both teams legally for the restart (kick-off halves, 9.15 m, penalty arc, goal-kick box). */
export function arrangeRestart(taker: ArcadeActor, rule: RuleState, ball: ArcadeBall, actors: readonly ArcadeActor[], attackDirection: (actor: ArcadeActor) => 1 | -1): void {
  const direction = attackDirection(taker);
  taker.x = clamp(rule.spotX - direction * .45, .4, 104.6);
  taker.y = clamp(rule.spotY, .4, 67.6);
  taker.vx = taker.vy = 0;
  taker.facingX = direction; taker.facingY = 0;
  ball.x = rule.spotX; ball.y = rule.spotY; ball.z = BALL_RADIUS;
  for (const actor of actors) {
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
