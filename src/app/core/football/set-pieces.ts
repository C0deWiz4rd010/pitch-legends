import type { RuleState } from '../../models/match.model';
import type { Team } from '../../models/team.model';
import { clamp } from '../util';
import { BALL_RADIUS } from './ball-physics';
import { ArcadeActor, ArcadeBall, FIELD_LENGTH, FIELD_WIDTH, PITCH, distance, len2 } from './match-types';

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

/** Corners, and free kicks too far out or too wide for a shot, are crossed into the box. */
export function isCrossedRestart(rule: RuleState, goalDistance: number, lateral: number): boolean {
  if (rule.phase === 'corner') return true;
  return rule.phase === 'freeKick' && wallSize(rule, goalDistance, lateral) === 0 && goalDistance > 17 && goalDistance < 40;
}

/** Where the attackers wait in the box for a delivery: [metres in front of the goal line, offset from the centre towards the ball side]. */
const BOX_SPOTS: readonly (readonly [number, number])[] = [[11, 0], [5.5, 3.2], [7.5, -3.8], [16.5, -1.5], [13, 8]];

/** Corners and free kicks that will be crossed: attackers take up positions in the box, the defenders go goal-side of them. */
function placeBoxPlayers(taker: ArcadeActor, ball: ArcadeBall, actors: readonly ArcadeActor[], goalX: number, direction: 1 | -1, claimed: readonly ArcadeActor[]): void {
  const side = Math.sign(ball.y - FIELD_WIDTH / 2) || 1;
  const strength = (actor: ArcadeActor) => (actor.attrs?.physical ?? 60) + (actor.attrs?.shooting ?? 60) * 0.3;
  const attackers = actors.filter(actor => actor.active && actor.side === taker.side && actor !== taker && actor.player.positionGroup !== 'GK' && !claimed.includes(actor))
    .sort((a, b) => strength(b) - strength(a)).slice(0, BOX_SPOTS.length);
  const defenders = actors.filter(actor => actor.active && actor.side !== taker.side && actor.player.positionGroup !== 'GK' && !claimed.includes(actor))
    .sort((a, b) => ((b.attrs?.defending ?? 60) + (b.attrs?.physical ?? 60) * 0.5) - ((a.attrs?.defending ?? 60) + (a.attrs?.physical ?? 60) * 0.5)).slice(0, BOX_SPOTS.length + 1);
  const put = (actor: ArcadeActor, depth: number, offset: number, faceX: number) => {
    actor.x = clamp(goalX - direction * depth, .4, FIELD_LENGTH - .4);
    actor.y = clamp(FIELD_WIDTH / 2 + side * offset, .4, FIELD_WIDTH - .4);
    actor.vx = actor.vy = 0;
    actor.facingX = faceX; actor.facingY = 0;
    actor.intentX = actor.x; actor.intentY = actor.y;
    actor.decisionCooldown = Math.max(actor.decisionCooldown, 1.2);
  };
  attackers.forEach((actor, index) => put(actor, BOX_SPOTS[index][0], BOX_SPOTS[index][1], direction));
  // Each defender stands a step goal-side of "his" attacker; the extra one covers the near post.
  defenders.forEach((actor, index) => {
    const spot = BOX_SPOTS[Math.min(index, BOX_SPOTS.length - 1)];
    put(actor, spot[0] - 1.1, spot[1] * 0.9 + (index >= BOX_SPOTS.length ? side * 1.6 : 0), -direction);
  });
}

/** Places taker, ball and both teams legally for the restart (kick-off halves, 9.15 m, penalty arc, goal-kick box). */
export function arrangeRestart(taker: ArcadeActor, rule: RuleState, ball: ArcadeBall, actors: readonly ArcadeActor[], attackDirection: (actor: ArcadeActor) => 1 | -1): void {
  const direction = attackDirection(taker);
  taker.x = clamp(rule.spotX - direction * .45, .4, FIELD_LENGTH - .4);
  taker.y = clamp(rule.spotY, .4, FIELD_WIDTH - .4);
  taker.vx = taker.vy = 0;
  taker.facingX = direction; taker.facingY = 0;
  ball.x = rule.spotX; ball.y = rule.spotY; ball.z = BALL_RADIUS;
  const goalX = direction > 0 ? FIELD_LENGTH : 0;
  const wall = wallSize(rule, Math.abs(goalX - ball.x), Math.abs(ball.y - FIELD_WIDTH / 2));
  const wallPlayers = wall ? actors
    .filter(actor => actor.active && actor.side !== taker.side && actor.player.positionGroup !== 'GK')
    .sort((a, b) => distance(a, ball) - distance(b, ball)).slice(0, wall) : [];
  if (wallPlayers.length) {
    // The wall stands 9.15 m from the ball on the line to the goal centre, shoulder to shoulder.
    const dx = goalX - ball.x, dy = FIELD_WIDTH / 2 - ball.y, length = len2(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    wallPlayers.forEach((actor, index) => {
      const offset = (index - (wallPlayers.length - 1) / 2) * 0.62 + 0.35;
      actor.x = clamp(ball.x + ux * PITCH.restartDistance - uy * offset, .4, FIELD_LENGTH - .4);
      actor.y = clamp(ball.y + uy * PITCH.restartDistance + ux * offset, .4, FIELD_WIDTH - .4);
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
    const separation = rule.phase === 'throwIn' ? 2 : PITCH.restartDistance;
    if (rule.phase === 'kickoff') {
      actor.x = attackDirection(actor) > 0 ? Math.min(actor.x, FIELD_LENGTH / 2 - 1.5) : Math.max(actor.x, FIELD_LENGTH / 2 + 1.5);
    }
    if (rule.phase === 'penalty') {
      if (actor.side !== taker.side && actor.player.positionGroup === 'GK') { actor.x = direction > 0 ? FIELD_LENGTH - .11 : .11; actor.y = FIELD_WIDTH / 2; continue; }
      actor.x = direction > 0 ? Math.min(actor.x, FIELD_LENGTH - (PITCH.penaltyDepth + 1.5)) : Math.max(actor.x, PITCH.penaltyDepth + 1.5);
    }
    if (rule.phase === 'goalKick' && actor.side !== taker.side && Math.abs(actor.y - FIELD_WIDTH / 2) < PITCH.penaltyHalfWidth) {
      actor.x = direction > 0 ? Math.max(actor.x, PITCH.penaltyDepth + .5) : Math.min(actor.x, FIELD_LENGTH - (PITCH.penaltyDepth + .5));
    }
    if (actor.side !== taker.side && distance(actor, ball) < separation) {
      const dx = actor.x - ball.x || -direction, dy = actor.y - ball.y;
      const length = len2(dx, dy) || 1;
      actor.x = clamp(ball.x + dx / length * separation, .4, FIELD_LENGTH - .4);
      actor.y = clamp(ball.y + dy / length * separation, .4, FIELD_WIDTH - .4);
    }
  }
  // A delivery into the box: corners, and free kicks too far out or too wide for a shot.
  const crossed = rule.phase === 'corner' || (rule.phase === 'freeKick' && !wallPlayers.length && Math.abs(goalX - ball.x) < 40 && Math.abs(goalX - ball.x) > 17);
  if (crossed) placeBoxPlayers(taker, ball, actors, goalX, direction, wallPlayers);
}
