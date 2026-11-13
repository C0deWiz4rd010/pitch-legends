import { AssistPreset } from '../../../models/match.model';
import { clamp } from '../../util';
import { BALL_RADIUS } from '../ball-physics';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, distance, len2 } from '../match-types';
import { passLanePressure } from '../pitch-analysis';
import { HK } from '../../rpg/effects';
import { partnerBonus } from '../../rpg/partners';
import { canUse } from '../../rpg/stat-block';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

export function inCrossingZone(m: ArcadeMatch, actor: ArcadeActor): boolean {
  const goalDistance = m.attackDirection(actor.side) > 0 ? FIELD_LENGTH - actor.x : actor.x;
  return goalDistance < 34 && Math.abs(actor.y - FIELD_WIDTH / 2) > 13;
}

/** Delivery to the best-placed runner in the box, timed to arrive at head height (high) or at the feet (driven). */
export function cross(m: ArcadeMatch, actor: ArcadeActor, driven: boolean, power: number, aimX = 0, aimY = 0): boolean {
  if (m.ball.ownerId !== actor.player.id) return false;
  const direction = m.attackDirection(actor.side);
  const teammates = m.actors.filter(candidate => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id);
  const runner = m.crossRunner(actor, aimX, aimY);
  if (!runner) return false;
  const rough = distance(actor, runner);
  const speed = driven ? clamp(14 + rough * 0.35 + power * 4, 16, 26) : clamp(12 + rough * 0.3 + power * 5, 14, 24);
  const flight = rough / speed;
  const targetX = clamp(runner.x + runner.vx * flight * 0.8, 1, FIELD_LENGTH - 1);
  const targetY = clamp(runner.y + runner.vy * flight * 0.8, 1, FIELD_WIDTH - 1);
  const dx = targetX - actor.x, dy = targetY - actor.y, length = len2(dx, dy) || 1;
  const pressure = clamp((5 - m.closestOpponent(actor)) / 5, 0, 1);
  const error = m.rng.normal(0, m.hook(actor, HK.passError, (100 - m.stat(actor,'passing')) / 100 * 0.07 + pressure * 0.04));
  const cos = Math.cos(error), sin = Math.sin(error);
  const px = dx / length * cos - dy / length * sin, py = dx / length * sin + dy / length * cos;
  const time = length / speed;
  // High crosses arrive at about 1.8 m (header height); driven crosses skim the grass.
  const vz = driven ? 0.6 : clamp((1.7 + 4.905 * time * time) / time, 3, 11);
  m.registerPass(actor, runner, teammates);
  if (m.isHumanControlled(actor)) m.selectReceiver(runner);
  // Crosses bend in towards goal (an in-swinger), more with a good curve.
  const inward = Math.sign(direction * (FIELD_WIDTH / 2 - actor.y)) || 1;
  m.releaseBall(actor, px * speed, py * speed, vz, m.hook(actor, HK.curve, 3 * inward));
  m.setAction(actor, driven ? 'pass' : 'lob');
  return true;
}

/** The team-mate a cross is aimed at. The stick chooses: a direction picks the runner that way, pulling back looks for the cut-back at the edge of the box. */
export function crossRunner(m: ArcadeMatch, actor: ArcadeActor, aimX: number, aimY: number): ArcadeActor | undefined {
  const direction = m.attackDirection(actor.side);
  const goalX = direction > 0 ? FIELD_LENGTH : 0;
  const aim = len2(aimX, aimY);
  const stick = aim > 0.35;
  const cutBack = stick && aimX * direction < -0.4;
  return m.actors
    .filter(candidate => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id
      && candidate.player.positionGroup !== 'GK' && Math.abs(candidate.y - FIELD_WIDTH / 2) < 17
      && (cutBack ? Math.abs(goalX - candidate.x) > 9 && Math.abs(goalX - candidate.x) < 30 : Math.abs(goalX - candidate.x) < 18))
    .map(candidate => {
      const gap = distance(actor, candidate) || 1;
      const alignment = stick && !cutBack ? ((candidate.x - actor.x) * aimX + (candidate.y - actor.y) * aimY) / (gap * aim) : 0;
      return { candidate, score: m.passLanePressure(actor, candidate) * 1.4 + Math.abs(candidate.y - FIELD_WIDTH / 2) * 0.05
        + Math.abs(goalX - candidate.x) * 0.04 - Math.max(0, candidate.vx * direction) * 0.08 + (m.isOffside(candidate, actor) ? T.ai.offsideRiskPenalty : 0) - alignment * 1.6 };
    })
    .sort((a, b) => a.score - b.score)[0]?.candidate;
}

/** Bookkeeping shared by passes and crosses: stats, offside snapshot at the moment of release, receiver. */
export function registerPass(m: ArcadeMatch, actor: ArcadeActor, target: ArcadeActor | undefined, teammates: readonly ArcadeActor[]): void {
  m.passAttempts[actor.side]++;
  m.stats(actor.side).passesAttempted++;
  m.lastPasser = { id: actor.player.id, side: actor.side, at: m.elapsed };
  m.football.interceptTried = [];
  m.football.offsideCandidates = teammates.filter(candidate => m.isOffside(candidate, actor)).map(candidate => candidate.player.id);
  m.pendingOffsideTargetId = target && m.isOffside(target, actor) ? target.player.id : null;
  m.intendedReceiverId = target?.player.id ?? null;
  m.activeShot = null;
}

/** The intended receiver of a human pass is controlled at once; the stick already steers his run. */
export function selectReceiver(m: ArcadeMatch, receiver: ArcadeActor): void {
  if (m.config.playerLockId || (m.config.autoSwitch ?? 'receivers') === 'manual' || receiver.player.positionGroup === 'GK') return;
  m.selectedPlayerId = receiver.player.id;
  m.football.selectionUntilTick = m.tick + 45;
  m.football.switchCandidate = null;
}

export function pass(m: ArcadeMatch, actor: ArcadeActor, through: boolean, lob: boolean, power: number, aimX: number, aimY: number, forced?: ArcadeActor, sharp = false): void {
  if (m.ball.ownerId !== actor.player.id) return;
  const aimLength = len2(aimX, aimY) || 1;
  const nx = aimX / aimLength;
  const ny = aimY / aimLength;
  const assistCone: Record<AssistPreset, number> = { assisted: Math.PI * 0.38, balanced: Math.PI * 0.22, manual: 0 };
  const humanPass = m.isHumanControlled(actor);
  const teammates = m.actors.filter((candidate) => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id);
  const targetOptions = teammates
    .map((candidate) => {
      const dx = candidate.x - actor.x;
      const dy = candidate.y - actor.y;
      const length = len2(dx, dy) || 1;
      const angle = Math.acos(clamp((dx / length) * nx + (dy / length) * ny, -1, 1));
      const lanePressure = m.passLanePressure(actor, candidate);
      const runBonus = through ? Math.max(0, (candidate.vx * m.attackDirection(actor.side) + 1) * 0.12) : 0;
      const forwardGain = (candidate.x - actor.x) * m.attackDirection(actor.side);
      const preferredDistance = m.teamOf(actor.side).tactics.passing === 'direct' ? 25 : m.teamOf(actor.side).tactics.passing === 'short' ? 10 : 17;
      return { candidate, angle, length, lanePressure, score: angle * (humanPass ? 2.2 : 0.25) + Math.abs(length - (humanPass ? 8 + power * 24 : preferredDistance)) * 0.035 + lanePressure * (humanPass ? 0.45 : T.ai.laneCaution) - runBonus - (humanPass ? 0 : forwardGain * 0.025) + (m.isOffside(candidate, actor) ? T.ai.offsideRiskPenalty * 0.8 : 0) };
    })
    .sort((a, b) => a.score - b.score);
  const assistedOptions = humanPass
    ? targetOptions.filter(({ angle, length }) => angle <= assistCone[m.config.assist] && length < 50)
    : targetOptions.filter(({ length, lanePressure }) => length < (lob ? 48 : 36) && lanePressure === 0);
  const target = forced ?? (humanPass
    ? m.config.assist === 'manual' ? undefined : assistedOptions[0]?.candidate
    : (assistedOptions.length ? assistedOptions : targetOptions)[0]?.candidate);
  const manualTarget = { x: actor.x + nx * (8 + power * 24), y: actor.y + ny * (8 + power * 24) };
  const rawDistance = target ? distance(actor, target) : len2(manualTarget.x - actor.x, manualTarget.y - actor.y);
  const travelEstimate = rawDistance / 19;
  // A through ball is played into the space ahead of the runner, further with more power.
  const lead = through ? m.hook(actor, HK.throughLead, clamp(4 + power * 9, 4, 13)) : 0;
  // The lead follows the runner's own path (blended with the direction of attack); a standing receiver gets it towards goal.
  let leadX = m.attackDirection(actor.side), leadY = 0;
  const runSpeed = target ? len2(target.vx, target.vy) : 0;
  if (target && lead > 0 && runSpeed > 1.2) {
    leadX = (target.vx / runSpeed) * 0.7 + leadX * 0.3;
    leadY = (target.vy / runSpeed) * 0.7;
    const leadLength = len2(leadX, leadY) || 1;
    leadX /= leadLength; leadY /= leadLength;
  }
  const targetX = target ? clamp(target.x + target.vx * travelEstimate * 0.65 + leadX * lead, 1, FIELD_LENGTH - 1) : manualTarget.x;
  const targetY = target ? clamp(target.y + target.vy * travelEstimate * 0.65 + leadY * lead, 1, FIELD_WIDTH - 1) : manualTarget.y;
  const dx = targetX - actor.x;
  const dy = targetY - actor.y;
  const length = len2(dx, dy) || 1;
  const pressure = clamp((5 - m.closestOpponent(actor)) / 5, 0, 1);
  // Lateral side relative to the passer's facing, so the weak foot survives the change of ends.
  const lateral = actor.facingX * dy - actor.facingY * dx;
  const weakFoot = actor.player.foot !== 'Both' && ((actor.player.foot === 'Right' && lateral < -1) || (actor.player.foot === 'Left' && lateral > 1)) ? 1 : 0;
  const fatigue = actor.stamina < 30 ? (30 - actor.stamina) / 30 : 0;
  const manualFactor = humanPass
    ? m.config.assist === 'manual' ? 1.2 : m.config.assist === 'assisted' ? 0.55 : 0.82
    : m.aiLevel(actor.side) === 'easy' ? 0.54 : m.aiLevel(actor.side) === 'hard' ? 0.24 : 0.30;
  // A sharp pass is hit harder and flatter; the shorter flight leaves less room for the receiver and the error is larger.
  const flat = sharp && !lob;
  // A duo partner at the other end: the bond makes the pass a little cleaner (managed club only).
  // The trivela pass: bent with the outside of the boot, it finds its man through traffic a little more often.
  const trivela = !flat && pressure > 0.25 && canUse(m.statsOf(actor), 'trivela-pass') ? 0.88 : 1;
  const partnerPass = (target ? partnerBonus(m.partnerStrength(actor, target)).passErrorMul : 1) * trivela;
  const error = m.hook(actor, HK.passError, ((100 - m.stat(actor,'passing')) / 100 * 0.075 + pressure * 0.045 + weakFoot * 0.018 + fatigue * 0.04) * (humanPass ? 1 : T.ai.passSkill) * (flat ? 1.3 : 1) * partnerPass);
  const angleError = m.rng.gaussian(0, error * manualFactor * m.composure(actor.side));
  const cos = Math.cos(angleError);
  const sin = Math.sin(angleError);
  const px = dx / length * cos - dy / length * sin;
  const py = dx / length * sin + dy / length * cos;
  const lofted = lob && through;
  const baseSpeed = target && !lob
    ? clamp(8 + length * 0.48 + power * 4.5 + (through ? 2.8 : 0), 12, 25)
    : (lofted ? 16 : lob ? 14 : through ? 14.5 : 11.8) + power * (lob ? 12 : 13.5) + m.stat(actor,'passing') * 0.025;
  const speed = flat ? clamp(baseSpeed * 1.32, 15, 31) : baseSpeed;
  m.registerPass(actor, target, teammates);
  if (humanPass && target) m.selectReceiver(target);
  const vz = flat ? 0.05 : lofted ? clamp(length / speed * 4.905 * 0.8 + 0.3, 2.5, 6) : lob ? clamp(length / speed * 4.905 + 0.5, 3, 9) : 0.15;
  m.releaseBall(actor, px * speed, py * speed, vz, lob ? m.rng.float(-2, 2) : 0, lob ? -2 : 0);
  m.setAction(actor, lob && !through ? 'lob' : through ? 'through-pass' : 'pass');
}

export function releaseBall(m: ArcadeMatch, actor: ArcadeActor, vx: number, vy: number, vz: number, spin: number, topspin = 0, recoveryTicks = 7): void {
  m.ball.ownerId = null;
  m.startRecovery(actor, recoveryTicks);
  actor.contact = { tick: m.tick, x: m.ball.x, y: m.ball.y, z: m.ball.z, kind: 'foot', foot: actor.player.foot === 'Left' ? 'left' : 'right' };
  // The ball leaves its actual contact point, preserving visual continuity.
  m.ball.z = Math.max(BALL_RADIUS, m.ball.z);
  m.ball.vx = vx;
  m.ball.vy = vy;
  m.ball.vz = vz;
  m.ball.spin = spin;
  m.ball.topspin = topspin;
  m.ball.lastTouch = actor.side;
  m.ball.lastTouchPlayerId = actor.player.id;
  m.ball.controlledTouch = 0;
}
