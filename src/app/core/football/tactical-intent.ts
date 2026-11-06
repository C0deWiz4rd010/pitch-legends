import type { ArcadeActor, ArcadeBall } from '../services/arcade-match';
import type { Team } from '../../models/team.model';
import type { Difficulty } from '../../models/game.model';
import type { PlayerActionState } from '../../models/match.model';
import { clamp } from '../util';
import { FIELD_LENGTH, FIELD_WIDTH, len2 } from './match-types';

export interface TacticalIntent { x: number; y: number; action: PlayerActionState; }

/** What every player of one side needs to know this tick, worked out once instead of for every decision. */
interface TeamFrame {
  actors: readonly ArcadeActor[];
  tick: number;
  side: string;
  opponents: ArcadeActor[];
  teammates: ArcadeActor[];
  /** Outfield players of this side, nearest to the ball (with their pressing instruction) first. */
  pressers: ArcadeActor[];
  /** Man-marking duty: defender id to the one opponent he picks up (no opponent has two markers). */
  marks: Map<string, ArcadeActor>;
  deepest: number;
  secondDeepest: number;
  /** Parallel scratch for the ordering of `pressers`. */
  scores: number[];
}

const FRAMES: Record<string, TeamFrame> = {};

function slotOf(team: Team, actor: ArcadeActor, direction: 1 | -1) {
  return team.formation.slots.find(slot => slot.playerId === actor.player.id)
    ?? team.formation.slots.reduce((best, slot) => len2(slot.x * FIELD_LENGTH - (direction > 0 ? actor.homeX : FIELD_LENGTH - actor.homeX), slot.y * FIELD_WIDTH - actor.homeY)
      < len2(best.x * FIELD_LENGTH - (direction > 0 ? actor.homeX : FIELD_LENGTH - actor.homeX), best.y * FIELD_WIDTH - actor.homeY) ? slot : best);
}

/** One reusable frame per side: refilling it allocates nothing in the usual case. */
function fillFrame(frame: TeamFrame, actors: readonly ArcadeActor[], team: Team, ball: ArcadeBall, side: string, direction: 1 | -1, tick: number): TeamFrame {
  frame.actors = actors; frame.tick = tick; frame.side = side;
  frame.opponents.length = 0; frame.teammates.length = 0; frame.pressers.length = 0; frame.marks.clear();
  let deepest = -Infinity, secondDeepest = -Infinity;
  for (const other of actors) {
    if (!other.active) continue;
    if (other.side !== side) {
      frame.opponents.push(other);
      // The second-deepest opponent (usually the last defender in front of the keeper) sets the offside line.
      const opponentDepth = direction > 0 ? other.x : FIELD_LENGTH - other.x;
      if (opponentDepth > deepest) { secondDeepest = deepest; deepest = opponentDepth; }
      else if (opponentDepth > secondDeepest) secondDeepest = opponentDepth;
    } else if (other.player.positionGroup !== 'GK') frame.teammates.push(other);
  }
  frame.deepest = deepest; frame.secondDeepest = secondDeepest;
  // Nearest to the ball first, minus his pressing instruction; a small insertion sort on parallel arrays.
  const scores = frame.scores;
  let anyMarker = false;
  for (const mate of frame.teammates) {
    const slot = team.formation.slots.find(candidate => candidate.playerId === mate.player.id);
    if (slot && slot.instruction.marking !== 'zonal') anyMarker = true;
    const score = len2(mate.x - ball.x, mate.y - ball.y) - (slot?.instruction.pressingBias ?? 0) * 2;
    let at = frame.pressers.length;
    while (at > 0 && scores[at - 1] > score) { scores[at] = scores[at - 1]; frame.pressers[at] = frame.pressers[at - 1]; at--; }
    scores[at] = score; frame.pressers[at] = mate;
  }
  if (!anyMarker) return frame;
  // Each man-marker takes the opponent nearest to his own post that nobody else has taken, closest pairs first.
  const pairs: { marker: ArcadeActor; opponent: ArcadeActor; gap: number }[] = [];
  for (const mate of frame.teammates) {
    if (slotOf(team, mate, direction).instruction.marking === 'zonal') continue;
    for (const opponent of frame.opponents) if (opponent.player.positionGroup !== 'GK') pairs.push({ marker: mate, opponent, gap: len2(opponent.x - mate.homeX, opponent.y - mate.homeY) });
  }
  pairs.sort((a, b) => a.gap - b.gap);
  const taken = new Set<ArcadeActor>();
  for (const pair of pairs) {
    if (frame.marks.has(pair.marker.player.id) || taken.has(pair.opponent)) continue;
    frame.marks.set(pair.marker.player.id, pair.opponent);
    taken.add(pair.opponent);
  }
  return frame;
}

/** The frame of this tick; a call without a tick (tests, tools) never leaves a frame behind to be reused. */
function frameFor(actors: readonly ArcadeActor[], team: Team, ball: ArcadeBall, side: string, direction: 1 | -1, tick: number): TeamFrame {
  const frame = FRAMES[side] ??= { actors, tick: -1, side, opponents: [], teammates: [], pressers: [], marks: new Map(), deepest: 0, secondDeepest: 0, scores: [] };
  if (tick > 0 && frame.tick === tick && frame.actors === actors) return frame;
  fillFrame(frame, actors, team, ball, side, direction, tick);
  if (tick <= 0) frame.tick = -1;
  return frame;
}

/** Pure team shape: decisions share positional information and obey individual duties. */
export function tacticalIntent(actor: ArcadeActor, owner: ArcadeActor | undefined, ball: ArcadeBall,
  actors: readonly ArcadeActor[], team: Team, direction: 1 | -1, tick = 0, level: Difficulty = 'normal'): TacticalIntent {
  const t = team.tactics;
  // Distances below were tuned on 105 × 68 m; on the five-a-side cage they shrink with the pitch.
  // On the full pitch both factors are exactly 1, so the result is unchanged there.
  const sx = FIELD_LENGTH / 105;
  const sy = FIELD_WIDTH / 68;
  const slot = slotOf(team, actor, direction);
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
  const frame = frameFor(actors, team, ball, actor.side, direction, tick);
  const { opponents, teammates } = frame;
  // Easy opponents do not read the game: no lane cover, no pressing triggers, no overlapping runs.
  const reads = level !== 'easy';
  if (!owner) {
    const receiver = teammates.reduce((best, other) => len2(other.x-ball.x,other.y-ball.y)<len2(best.x-ball.x,best.y-ball.y)?other:best,teammates[0]);
    if (receiver === actor) {
      const horizon = clamp(len2(actor.x-ball.x,actor.y-ball.y)/7,0,.45);
      return {x:clamp(ball.x+ball.vx*horizon,1,FIELD_LENGTH-1),y:clamp(ball.y+ball.vy*horizon,1,FIELD_WIDTH-1),action:'press'};
    }
  }
  if (!ownBall) {
    let count = t.pressing === 'low' ? 1 : t.pressing === 'gegenpress' ? 3 : 2;
    // Pressing triggers: a carrier on the touchline or one who has just lost control of the ball is pounced on by one more player.
    if (reads && owner && count < 4 && (Math.abs(owner.y - FIELD_WIDTH / 2) > FIELD_WIDTH / 2 - 6 * sy || owner.action === 'heavy-touch')) count++;
    const rank = frame.pressers.indexOf(actor);
    if (rank < count && rank >= 0 && (t.pressing !== 'low' || ballDepth < 60 * sx || !owner)) {
      const cover = rank === 0 ? 0 : -direction * (2.5 + rank) * sx;
      return {x:clamp(ball.x+ball.vx*.22+cover,1,FIELD_LENGTH-1),y:clamp(ball.y+ball.vy*.22+(rank===0?0:(actor.y<ball.y?-1:1)*2.8*sy),1,FIELD_WIDTH-1),action:rank===0?'press':'support-press'};
    }
    depth += clamp((ballDepth-FIELD_LENGTH/2)*.35,-13*sx,9*sx);
    depth = Math.min(depth, Math.max(12*sx, ballDepth-5*sx));
    const threat = instruction.marking !== 'zonal' ? frame.marks.get(actor.player.id) : undefined;
    if (threat) {
      const gap = instruction.marking === 'aggressive' ? 1.2 : 2.5;
      depth = (direction>0?threat.x:FIELD_LENGTH-threat.x)-gap;
      y=threat.y+(FIELD_WIDTH/2-threat.y)*.035;
    } else if (reads && owner && actor.player.positionGroup !== 'ATT') {
      // Lane cover: stand in the passing lane between the carrier and the most dangerous opponent of this zone.
      let danger: typeof owner | undefined;
      let dangerDepth = -Infinity;
      for (const other of opponents) {
        if (other === owner || other.player.positionGroup === 'GK') continue;
        if (Math.abs(other.y - actor.homeY) > 16 * sy || len2(other.x - owner.x, other.y - owner.y) > 28 * sx) continue;
        const otherDepth = direction > 0 ? FIELD_LENGTH - other.x : other.x;
        if (otherDepth > dangerDepth) { dangerDepth = otherDepth; danger = other; }
      }
      if (danger) {
        const carrierDepth = direction > 0 ? owner.x : FIELD_LENGTH - owner.x;
        const dangerPos = direction > 0 ? danger.x : FIELD_LENGTH - danger.x;
        const coverDepth = carrierDepth + (dangerPos - carrierDepth) * 0.45;
        depth += (clamp(coverDepth, homeDepth - 12 * sx, homeDepth + 14 * sx) - depth) * 0.6;
        y += (owner.y + (danger.y - owner.y) * 0.45 - y) * 0.6;
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
      if (reads && owner && owner !== actor && actor.player.positionGroup === 'DEF') {
        const flank = Math.sign(actor.homeY - FIELD_WIDTH / 2);
        const wide = Math.abs(actor.homeY - FIELD_WIDTH / 2) > 16 * sy;
        if (wide && role === 'fb' && instruction.forwardRuns !== 'rarely' && Math.sign(owner.y - FIELD_WIDTH / 2) === flank && Math.abs(owner.y - FIELD_WIDTH / 2) > 15 * sy && ballDepth > 45 * sx) {
          // Overlap: the full-back runs past a winger who has the ball on his flank.
          depth = ballDepth + 6 * sx;
          y = FIELD_WIDTH / 2 + flank * (FIELD_WIDTH / 2 - 6 * sy);
        } else if (ballDepth < 38 * sx && !wide && frame.pressers.indexOf(actor) < 3) {
          // Build-up from the back: the nearest centre-backs offer angled outlets behind and beside the carrier.
          depth = ballDepth - 9 * sx;
          y = clamp(owner.y + (actor.homeY < owner.y ? -1 : 1) * 11 * sy, 5 * sy, FIELD_WIDTH - 5 * sy);
        }
      }
    }
    if (t.counterAttack && actor.player.positionGroup === 'ATT') depth+=8*sx;
    if (t.buildUp === 'play-out-of-defence' && ballDepth<40*sx) {depth=Math.min(depth,ballDepth+12*sx);y=FIELD_WIDTH/2+(actor.homeY-FIELD_WIDTH/2)*1.1;}
    if (t.buildUp === 'long-ball' && actor.player.positionGroup === 'ATT') depth=Math.max(depth,72*sx);
    const lastLine = Math.max(ballDepth,opponents.length > 1 ? frame.secondDeepest : FIELD_LENGTH);
    depth=Math.min(depth,Math.max(FIELD_LENGTH/2-.5,lastLine-1.1+lineOvershoot(actor,instruction.forwardRuns,instruction.stayInPosition,tick)*sx));
    // Local separation keeps teammates from offering exactly the same pass.
    for (const mate of teammates) if (mate!==actor && mate!==owner && len2(mate.x-actor.x,mate.y-actor.y)<4) y+=(actor.homeY>=mate.homeY?1:-1)*2;
  }
  if (instruction.stayInPosition) {
    depth=clamp(depth,homeDepth-7*sx,homeDepth+7*sx);
    y=clamp(y,actor.homeY-6*sy,actor.homeY+6*sy);
  }
  return {x:clamp(direction>0?depth:FIELD_LENGTH-depth,1,FIELD_LENGTH-1),y:clamp(y,3,FIELD_WIDTH-3),action};
}

/**
 * Attackers who like to run in behind misjudge the offside line now and then: for a second or two they
 * hover up to a few metres beyond the last defender. The roll is a pure function of player and time, so
 * matches stay deterministic.
 */
function lineOvershoot(actor: ArcadeActor, runs: string, stay: boolean, tick: number): number {
  if (actor.player.positionGroup !== 'ATT' || stay || runs === 'rarely') return 0;
  const window = Math.floor(tick / 100);
  const roll = (Math.imul(window + 1, 2654435761) ^ Math.imul(actor.player.kitNumber + 17, 40503)) >>> 0;
  const chance = runs === 'often' ? 90 : 80;
  const bucket = roll % 100;
  return bucket < chance ? 2 + (bucket / chance) * 4 : 0;
}
