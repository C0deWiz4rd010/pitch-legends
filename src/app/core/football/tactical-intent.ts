import type { ArcadeActor, ArcadeBall } from '../services/arcade-match';
import type { Team } from '../../models/team.model';
import type { PlayerActionState } from '../../models/match.model';
import { clamp } from '../util';
import { FIELD_LENGTH, FIELD_WIDTH, len2 } from './match-types';

export interface TacticalIntent { x: number; y: number; action: PlayerActionState; }

/** Pure team shape: decisions share positional information and obey individual duties. */
export function tacticalIntent(actor: ArcadeActor, owner: ArcadeActor | undefined, ball: ArcadeBall,
  actors: readonly ArcadeActor[], team: Team, direction: 1 | -1): TacticalIntent {
  const t = team.tactics;
  // Distances below were tuned on 105 × 68 m; on the five-a-side cage they shrink with the pitch.
  // On the full pitch both factors are exactly 1, so the result is unchanged there.
  const sx = FIELD_LENGTH / 105;
  const sy = FIELD_WIDTH / 68;
  const slot = team.formation.slots.find(slot => slot.playerId === actor.player.id)
    ?? team.formation.slots.reduce((best, slot) => len2(slot.x * FIELD_LENGTH - (direction > 0 ? actor.homeX : FIELD_LENGTH - actor.homeX), slot.y * FIELD_WIDTH - actor.homeY)
      < len2(best.x * FIELD_LENGTH - (direction > 0 ? actor.homeX : FIELD_LENGTH - actor.homeX), best.y * FIELD_WIDTH - actor.homeY) ? slot : best);
  const instruction = slot.instruction;
  const role = slot.roleId;
  const ownBall = owner ? owner.side === actor.side : ball.lastTouch === actor.side && len2(ball.vx,ball.vy) > 2;
  const carrier = owner ?? ball;
  const width = t.width === 'wide' ? 1.18 : t.width === 'narrow' ? .72 : 1;
  const mentality = { 'ultra-defensive':-7, defensive:-4, balanced:0, attacking:5, 'ultra-attacking':9 }[t.mentality] * sx;
  const line = (t.defensiveLine === 'high' ? 7 : t.defensiveLine === 'deep' ? -7 : 0) * sx;
  const ballDepth = direction > 0 ? ball.x : FIELD_LENGTH - ball.x;
  const homeDepth = direction > 0 ? actor.homeX : FIELD_LENGTH - actor.homeX;
  const duty = (instruction.duty === 'attack' ? 5 : instruction.duty === 'defend' ? -4 : 0) * sx;
  let depth = homeDepth + mentality + (actor.player.positionGroup === 'DEF' ? line : line * .3);
  let y = FIELD_WIDTH/2 + (actor.homeY - FIELD_WIDTH/2) * width + (ball.y - FIELD_WIDTH/2) * .1;
  let action: PlayerActionState = 'formation';
  const opponents = actors.filter(other => other.active && other.side !== actor.side);
  const teammates = actors.filter(other => other.active && other.side === actor.side && other.player.positionGroup !== 'GK');
  if (!owner) {
    const receiver = teammates.reduce((best, other) => len2(other.x-ball.x,other.y-ball.y)<len2(best.x-ball.x,best.y-ball.y)?other:best,teammates[0]);
    if (receiver === actor) {
      const horizon = clamp(len2(actor.x-ball.x,actor.y-ball.y)/7,0,.45);
      return {x:clamp(ball.x+ball.vx*horizon,1,FIELD_LENGTH-1),y:clamp(ball.y+ball.vy*horizon,1,FIELD_WIDTH-1),action:'press'};
    }
  }
  if (!ownBall) {
    const pressingBias = new Map<string, number>();
    for (const slot of team.formation.slots) if (slot.playerId) pressingBias.set(slot.playerId, slot.instruction.pressingBias);
    const pressers = teammates.map(other => ({actor:other,score: len2(other.x-ball.x,other.y-ball.y)
      - (pressingBias.get(other.player.id) ?? 0)*2}))
      .sort((a,b) => a.score-b.score);
    const count = t.pressing === 'low' ? 1 : t.pressing === 'gegenpress' ? 3 : 2;
    const rank = pressers.findIndex(item=>item.actor===actor);
    if (rank < count && rank >= 0 && (t.pressing !== 'low' || ballDepth < 60 * sx || !owner)) {
      const cover = rank === 0 ? 0 : -direction * (2.5 + rank) * sx;
      return {x:clamp(ball.x+ball.vx*.22+cover,1,FIELD_LENGTH-1),y:clamp(ball.y+ball.vy*.22+(rank===0?0:(actor.y<ball.y?-1:1)*2.8*sy),1,FIELD_WIDTH-1),action:rank===0?'press':'support-press'};
    }
    depth += clamp((ballDepth-FIELD_LENGTH/2)*.35,-13*sx,9*sx);
    depth = Math.min(depth, Math.max(12*sx, ballDepth-5*sx));
    if (instruction.marking !== 'zonal') {
      const threat = opponents.filter(other=>other.player.positionGroup !== 'GK').sort((a,b)=>len2(a.x-actor.homeX,a.y-actor.homeY)-len2(b.x-actor.homeX,b.y-actor.homeY))[0];
      if (threat) {
        const gap = instruction.marking === 'aggressive' ? 1.2 : 2.5;
        depth = (direction>0?threat.x:FIELD_LENGTH-threat.x)-gap;
        y=threat.y+(FIELD_WIDTH/2-threat.y)*.035;
      }
    }
    if (t.offsideTrap && actor.player.positionGroup === 'DEF' && ballDepth > FIELD_WIDTH/2) depth = clamp(ballDepth-8*sx+line,20*sx,FIELD_LENGTH/2+.5);
  } else {
    action = 'formation';
    depth += duty + clamp((ballDepth-FIELD_LENGTH/2)*.38,-10*sx,15*sx);
    const runners = (instruction.forwardRuns === 'often' ? 7 : instruction.forwardRuns === 'rarely' ? -5 : 0) * sx;
    if (!instruction.stayInPosition) {
      depth += runners;
      if (actor.player.positionGroup === 'MID') {
        // Distinct upper/lower channels give the carrier a pair of angled outlets.
        const ahead = instruction.duty === 'attack' || ['ap','ss','b2b','mezzala'].includes(role);
        depth = ballDepth+(ahead?9:-9)*sx+duty+mentality;
        y = clamp(carrier.y+(actor.homeY<FIELD_WIDTH/2?-1:1)*(t.width==='narrow'?8:13)*sy,5*sy,FIELD_WIDTH-5*sy);
      }
      if (['wb','w','mezzala'].includes(role)) {y=actor.homeY<FIELD_WIDTH/2?7*sy:FIELD_WIDTH-7*sy;depth+=6*sx;}
      if (['ifb','iw','if'].includes(role)) {y=FIELD_WIDTH/2+(actor.homeY-FIELD_WIDTH/2)*.40;depth+=(role==='if'?7:2)*sx;}
      if (['anchor','dlp'].includes(role)) {depth=ballDepth-13*sx;y=FIELD_WIDTH/2+(actor.homeY-FIELD_WIDTH/2)*.4;}
      if (role==='f9') {depth=ballDepth+3*sx;y=FIELD_WIDTH/2;}
      if (role==='tm') {depth=ballDepth+12*sx;y=FIELD_WIDTH/2+(actor.homeY-FIELD_WIDTH/2)*.4;}
      if (role==='poacher') {depth+=7*sx;y=FIELD_WIDTH/2+(actor.homeY-FIELD_WIDTH/2)*.35;}
    }
    if (t.counterAttack && actor.player.positionGroup === 'ATT') depth+=8*sx;
    if (t.buildUp === 'play-out-of-defence' && ballDepth<40*sx) {depth=Math.min(depth,ballDepth+12*sx);y=FIELD_WIDTH/2+(actor.homeY-FIELD_WIDTH/2)*1.1;}
    if (t.buildUp === 'long-ball' && actor.player.positionGroup === 'ATT') depth=Math.max(depth,72*sx);
    // The second-deepest opponent (usually the last defender in front of the keeper) sets the offside line.
    let deepest = -Infinity, secondDeepest = -Infinity;
    for (const other of opponents) {
      const opponentDepth = direction>0?other.x:FIELD_LENGTH-other.x;
      if (opponentDepth > deepest) { secondDeepest = deepest; deepest = opponentDepth; }
      else if (opponentDepth > secondDeepest) secondDeepest = opponentDepth;
    }
    const lastLine = Math.max(ballDepth,opponents.length > 1 ? secondDeepest : FIELD_LENGTH);
    depth=Math.min(depth,Math.max(FIELD_LENGTH/2-.5,lastLine-1.1));
    // Local separation keeps teammates from offering exactly the same pass.
    for (const mate of teammates) if (mate!==actor && mate!==owner && len2(mate.x-actor.x,mate.y-actor.y)<4) y+=(actor.homeY>=mate.homeY?1:-1)*2;
  }
  if (instruction.stayInPosition) {
    depth=clamp(depth,homeDepth-7*sx,homeDepth+7*sx);
    y=clamp(y,actor.homeY-6*sy,actor.homeY+6*sy);
  }
  return {x:clamp(direction>0?depth:FIELD_LENGTH-depth,1,FIELD_LENGTH-1),y:clamp(y,3,FIELD_WIDTH-3),action};
}
