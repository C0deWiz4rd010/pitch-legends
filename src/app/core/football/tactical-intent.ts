import type { ArcadeActor, ArcadeBall } from '../services/arcade-match';
import type { Team } from '../../models/team.model';
import type { PlayerActionState } from '../../models/match.model';
import { clamp } from '../util';

export interface TacticalIntent { x: number; y: number; action: PlayerActionState; }

/** Pure team shape: decisions share positional information and obey individual duties. */
export function tacticalIntent(actor: ArcadeActor, owner: ArcadeActor | undefined, ball: ArcadeBall,
  actors: readonly ArcadeActor[], team: Team, direction: 1 | -1): TacticalIntent {
  const t = team.tactics;
  const slot = team.formation.slots.find(slot => slot.playerId === actor.player.id)
    ?? team.formation.slots.reduce((best, slot) => Math.hypot(slot.x * 105 - (direction > 0 ? actor.homeX : 105 - actor.homeX), slot.y * 68 - actor.homeY)
      < Math.hypot(best.x * 105 - (direction > 0 ? actor.homeX : 105 - actor.homeX), best.y * 68 - actor.homeY) ? slot : best);
  const instruction = slot.instruction;
  const role = slot.roleId;
  const ownBall = owner ? owner.side === actor.side : ball.lastTouch === actor.side && Math.hypot(ball.vx,ball.vy) > 2;
  const carrier = owner ?? ball;
  const width = t.width === 'wide' ? 1.18 : t.width === 'narrow' ? .72 : 1;
  const mentality = { 'ultra-defensive':-7, defensive:-4, balanced:0, attacking:5, 'ultra-attacking':9 }[t.mentality];
  const line = t.defensiveLine === 'high' ? 7 : t.defensiveLine === 'deep' ? -7 : 0;
  const ballDepth = direction > 0 ? ball.x : 105 - ball.x;
  const homeDepth = direction > 0 ? actor.homeX : 105 - actor.homeX;
  const duty = instruction.duty === 'attack' ? 5 : instruction.duty === 'defend' ? -4 : 0;
  let depth = homeDepth + mentality + (actor.player.positionGroup === 'DEF' ? line : line * .3);
  let y = 34 + (actor.homeY - 34) * width + (ball.y - 34) * .1;
  let action: PlayerActionState = 'formation';
  const opponents = actors.filter(other => other.active && other.side !== actor.side);
  const teammates = actors.filter(other => other.active && other.side === actor.side && other.player.positionGroup !== 'GK');
  if (!owner) {
    const receiver = teammates.reduce((best, other) => Math.hypot(other.x-ball.x,other.y-ball.y)<Math.hypot(best.x-ball.x,best.y-ball.y)?other:best,teammates[0]);
    if (receiver === actor) {
      const horizon = clamp(Math.hypot(actor.x-ball.x,actor.y-ball.y)/7,0,.45);
      return {x:clamp(ball.x+ball.vx*horizon,1,104),y:clamp(ball.y+ball.vy*horizon,1,67),action:'press'};
    }
  }
  if (!ownBall) {
    const pressers = teammates.map(other => ({actor:other,score: Math.hypot(other.x-ball.x,other.y-ball.y)
      - (team.formation.slots.find(slot => slot.playerId === other.player.id)?.instruction.pressingBias ?? 0)*2}))
      .sort((a,b) => a.score-b.score);
    const count = t.pressing === 'low' ? 1 : t.pressing === 'gegenpress' ? 3 : 2;
    const rank = pressers.findIndex(item=>item.actor===actor);
    if (rank < count && rank >= 0 && (t.pressing !== 'low' || ballDepth < 60 || !owner)) {
      const cover = rank === 0 ? 0 : -direction * (2.5 + rank);
      return {x:clamp(ball.x+ball.vx*.22+cover,1,104),y:clamp(ball.y+ball.vy*.22+(rank===0?0:(actor.y<ball.y?-1:1)*2.8),1,67),action:rank===0?'press':'support-press'};
    }
    depth += clamp((ballDepth-52.5)*.35,-13,9);
    depth = Math.min(depth, Math.max(12, ballDepth-5));
    if (instruction.marking !== 'zonal') {
      const threat = opponents.filter(other=>other.player.positionGroup !== 'GK').sort((a,b)=>Math.hypot(a.x-actor.homeX,a.y-actor.homeY)-Math.hypot(b.x-actor.homeX,b.y-actor.homeY))[0];
      if (threat) {
        const gap = instruction.marking === 'aggressive' ? 1.2 : 2.5;
        depth = (direction>0?threat.x:105-threat.x)-gap;
        y=threat.y+(34-threat.y)*.035;
      }
    }
    if (t.offsideTrap && actor.player.positionGroup === 'DEF' && ballDepth > 34) depth = clamp(ballDepth-8+line,20,53);
  } else {
    action = 'formation';
    depth += duty + clamp((ballDepth-52.5)*.38,-10,15);
    const runners = instruction.forwardRuns === 'often' ? 7 : instruction.forwardRuns === 'rarely' ? -5 : 0;
    if (!instruction.stayInPosition) {
      depth += runners;
      if (actor.player.positionGroup === 'MID') {
        // Distinct upper/lower channels give the carrier a pair of angled outlets.
        const ahead = instruction.duty === 'attack' || ['ap','ss','b2b','mezzala'].includes(role);
        depth = ballDepth+(ahead?9:-9)+duty+mentality;
        y = clamp(carrier.y+(actor.homeY<34?-1:1)*(t.width==='narrow'?8:13),5,63);
      }
      if (['wb','w','mezzala'].includes(role)) {y=actor.homeY<34?7:61;depth+=6;}
      if (['ifb','iw','if'].includes(role)) {y=34+(actor.homeY-34)*.40;depth+=role==='if'?7:2;}
      if (['anchor','dlp'].includes(role)) {depth=ballDepth-13;y=34+(actor.homeY-34)*.4;}
      if (role==='f9') {depth=ballDepth+3;y=34;}
      if (role==='tm') {depth=ballDepth+12;y=34+(actor.homeY-34)*.4;}
      if (role==='poacher') {depth+=7;y=34+(actor.homeY-34)*.35;}
    }
    if (t.counterAttack && actor.player.positionGroup === 'ATT') depth+=8;
    if (t.buildUp === 'play-out-of-defence' && ballDepth<40) {depth=Math.min(depth,ballDepth+12);y=34+(actor.homeY-34)*1.1;}
    if (t.buildUp === 'long-ball' && actor.player.positionGroup === 'ATT') depth=Math.max(depth,72);
    const defenders = opponents.map(other => direction>0?other.x:105-other.x).sort((a,b)=>b-a);
    const lastLine = Math.max(ballDepth,defenders[1]??105);
    depth=Math.min(depth,Math.max(52,lastLine-1.1));
    // Local separation keeps teammates from offering exactly the same pass.
    for (const mate of teammates) if (mate!==actor && mate!==owner && Math.hypot(mate.x-actor.x,mate.y-actor.y)<4) y+=(actor.homeY>=mate.homeY?1:-1)*2;
  }
  if (instruction.stayInPosition) {
    depth=clamp(depth,homeDepth-7,homeDepth+7);
    y=clamp(y,actor.homeY-6,actor.homeY+6);
  }
  return {x:clamp(direction>0?depth:105-depth,1,104),y:clamp(y,3,65),action};
}
