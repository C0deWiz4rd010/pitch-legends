import { MatchCheckpoint, PlayerActionState, PendingKick } from '../../../models/match.model';
import { clamp } from '../../util';
import { ACTION_CONTACT_TICKS } from '../action-timing';
import { ArcadeActor, distance } from '../match-types';
import { MATCH_TUNING as T } from '../tuning';
import type { ArcadeMatch } from '../../services/arcade-match';

/** A released human action: the kick is committed now and the ball is struck ACTION_CONTACT_TICKS later (the wind-up). */
export function executeFootballAction(m: ArcadeMatch, actor: ArcadeActor, action: NonNullable<NonNullable<MatchCheckpoint['runtime']['football']>['queuedAction']>): void {
  if (m.football.pendingKick) return;
  if (action.kind === 'shoot') {
    if (action.feint) { m.feint(actor); return; }
    // Lob + skill on release is a driven power shot; either alone is a chip or a finesse shot.
    const powerShot = !!action.chip && action.finesse;
    const chip = !!action.chip && !powerShot, finesse = action.finesse && !powerShot, low = action.low && !powerShot;
    m.scheduleKick(actor, { type: 'shoot', power: action.power, aimX: action.aimX, aimY: action.aimY, finesse, low, chip, driven: powerShot },
      chip ? 'chip-shot' : finesse ? 'finesse-shot' : low ? 'low-shot' : 'shot');
    return;
  }
  const through = action.kind === 'through';
  if ((action.kind === 'lob' || through) && m.inCrossingZone(actor) && m.crossRunner(actor, action.aimX, action.aimY)) {
    m.scheduleKick(actor, { type: 'cross', through, power: action.power, aimX: action.aimX, aimY: action.aimY, curl: action.curl }, through ? 'pass' : 'lob');
    return;
  }
  const lob = action.kind === 'lob' || (through && !!action.chip);
  m.scheduleKick(actor, { type: 'pass', through, lob, power: action.power, aimX: action.aimX, aimY: action.aimY, sharp: !!action.sharp && !lob, curl: action.curl },
    lob && !through ? 'lob' : through ? 'through-pass' : 'pass');
}

/**
 * Commits a kick: the actor starts the action now, the ball is struck once ACTION_CONTACT_TICKS have passed. A tackle that
 * takes the ball in between (or any other loss of the ball) cancels the strike. Without a wind-up the strike is immediate.
 */
export function scheduleKick(m: ArcadeMatch, actor: ArcadeActor, kick: Omit<PendingKick, 'actorId' | 'startTick' | 'contactTick'>, state: PlayerActionState): void {
  const full: PendingKick = { ...kick, actorId: actor.player.id, startTick: m.tick, contactTick: m.tick + (ACTION_CONTACT_TICKS[state] ?? 0) };
  if (full.contactTick <= m.tick) { m.performKick(actor, full); return; }
  m.football.pendingKick = full;
  m.setAction(actor, state, true);
}

export function processPendingKick(m: ArcadeMatch): void {
  const kick = m.football.pendingKick;
  if (!kick) return;
  const actor = m.actors.find((candidate) => candidate.player.id === kick.actorId && candidate.active);
  const aerial = kick.type === 'volley' || kick.type === 'bicycle-kick' || kick.type === 'flying-header';
  if (!actor || (aerial ? !!m.ball.ownerId : m.ball.ownerId !== actor.player.id)) { m.football.pendingKick = null; return; }
  if (m.tick < kick.contactTick) return;
  m.football.pendingKick = null;
  m.performKick(actor, kick);
}

export function performKick(m: ArcadeMatch, actor: ArcadeActor, kick: PendingKick): void {
  const forced = kick.forcedId ? m.actors.find((candidate) => candidate.active && candidate.side === actor.side && candidate.player.id === kick.forcedId) : undefined;
  switch (kick.type) {
    case 'pass':
      m.pass(actor, !!kick.through, !!kick.lob, kick.power, kick.aimX, kick.aimY, forced, !!kick.sharp, kick.curl ?? 0);
      return;
    case 'cross':
      if (!m.cross(actor, !!kick.through, kick.power, kick.aimX, kick.aimY, kick.curl ?? 0)) m.pass(actor, !!kick.through, false, kick.power, kick.aimX, kick.aimY);
      return;
    case 'shoot':
      m.shoot(actor, kick.power, kick.aimX, kick.aimY, !!kick.finesse, !!kick.low, !!kick.chip, !!kick.driven, false, kick.timed ? 0.6 : 1);
      return;
    default:
      m.strikeAerial(actor, kick);
  }
}

/** Releases the pending kick without touching the ball: a shot becomes a feint, a pass is simply not played. */
export function cancelKick(m: ArcadeMatch, actor: ArcadeActor): void {
  const kick = m.football.pendingKick;
  m.football.pendingKick = null;
  if (!kick) return;
  if (kick.type === 'shoot') m.feint(actor);
  else m.setAction(actor, 'carry', true);
}

/** Fake shot: the kicker keeps the ball, defenders close by may bite and are frozen for a moment. */
export function feint(m: ArcadeMatch, actor: ArcadeActor): void {
  m.football.pendingKick = null;
  m.setAction(actor, 'fake-shot', true);
  m.startRecovery(actor, 8);
  for (const defender of m.actors) {
    if (!defender.active || defender.side === actor.side || defender.player.positionGroup === 'GK') continue;
    const gap = distance(defender, actor);
    if (gap > 4.5) continue;
    const bite = clamp(0.7 - m.stat(defender, 'defending') / 220 - (m.aiLevel(defender.side) === 'hard' ? 0.1 : 0) - Math.max(0, gap - 2.5) * 0.08, 0.15, 0.8);
    if (!m.rng.bool(bite)) continue;
    defender.tackleCooldown = Math.max(defender.tackleCooldown, T.feint.freezeTicks / 60);
    defender.vx *= 0.25; defender.vy *= 0.25;
    m.startRecovery(defender, T.feint.freezeTicks);
    if (!m.isHumanControlled(defender)) defender.decisionCooldown += T.feint.freezeTicks / 60;
  }
}
