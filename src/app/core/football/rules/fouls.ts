import { MatchEvent } from '../../../models/match.model';
import { playerName } from '../../ratings';
import { clamp } from '../../util';
import { createInjury } from '../../injury-engine';
import { ArcadeActor, FIELD_LENGTH, FIELD_WIDTH, PITCH, distance, len2 } from '../match-types';
import type { ArcadeMatch } from '../../services/arcade-match';

export function callFoul(m: ArcadeMatch, defender: ArcadeActor, victim: ArcadeActor, sliding: boolean, speed: number): void {
  const stats = m.stats(defender.side);
  stats.fouls++;
  const severity = speed + (sliding ? 4 : 0);
  const victimDirection = m.attackDirection(victim.side);
  const inBox = Math.abs(victim.y - FIELD_WIDTH / 2) <= PITCH.penaltyHalfWidth && (victimDirection > 0 ? victim.x > FIELD_LENGTH - PITCH.penaltyDepth : victim.x < PITCH.penaltyDepth);
  const advantageLikely = !inBox && victim.action !== 'injured' && len2(victim.vx, victim.vy) > 1 && !m.football.pendingYellow;
  const yellow = severity > 8 || m.rng.bool(clamp(severity / 26, 0.06, 0.55));
  const straightRed = severity > 11 && m.rng.bool(clamp((severity - 9) / 75, 0.025, 0.16));
  let eventType: MatchEvent['type'] = 'foul';
  if (straightRed || (yellow && defender.card === 'yellow')) {
    defender.card = 'red';
    defender.active = false;
    m.addStoppage(0.5);
    m.coverSentOffPlayer(defender);
    stats.reds++;
    m.contributions[defender.player.id].reds++;
    eventType = 'red';
  } else if (yellow && advantageLikely) {
    // Advantage is played: the yellow card is shown at the next stoppage (see applyPendingCards).
    m.football.pendingYellow = defender.player.id;
  } else if (yellow) {
    m.addStoppage(0.3);
    defender.card = 'yellow';
    stats.yellows++;
    m.contributions[defender.player.id].yellows++;
    eventType = 'yellow';
  }
  m.adjustRating(defender.player.id, eventType === 'red' ? -1.4 : eventType === 'yellow' ? -0.25 : -0.05);
  const params = { player: playerName(defender.player) };
  if (inBox && eventType !== 'foul') {
    // A penalty with a card reports both decisions.
    m.events.push({ minute: m.footballMinute, type: 'foul', side: defender.side, playerId: defender.player.id, messageKey: 'match.penalty', params });
    m.events.push({ minute: m.footballMinute, type: eventType, side: defender.side, playerId: defender.player.id, messageKey: eventType === 'red' ? 'match.red' : 'match.yellow', params });
  } else m.events.push({ minute: m.footballMinute, type: eventType, side: defender.side, playerId: defender.player.id, messageKey: inBox ? 'match.penalty' : eventType === 'red' ? 'match.red' : eventType === 'yellow' ? 'match.yellow' : 'match.freeKick', params });
  if (m.rng.bool(m.injuryChance(victim, clamp((severity - 8) / 220, 0.005, 0.06)))) {
    m.setAction(victim, 'injured');
    if (!m.isInjured(victim.player.id)) (m.football.injuredIds ??= []).push(victim.player.id);
    m.addStoppage(1);
    const injury = createInjury({ seed: m.config.seed ^ m.tick, player: victim.player, cause: 'contact', season: 0, week: 0, fixtureId: m.config.fixtureId, matchMinute: m.footballMinute, severityBias: severity / 20 });
    m.events.push({ minute: m.footballMinute, type: 'injury', side: victim.side, playerId: victim.player.id, messageKey: 'match.injury', params: { player: playerName(victim.player), diagnosis: injury.diagnosisId }, injury });
  }
  const canPlayAdvantage = !inBox && victim.action !== 'injured' && len2(victim.vx, victim.vy) > 1;
  if (canPlayAdvantage) {
    m.rule = m.newRule('advantage', victim.side, victim.x, victim.y);
    m.rule.advantageSide = victim.side;
  } else {
    m.setRestart(inBox ? 'penalty' : 'freeKick', victim.side, victim.x, victim.y);
  }
  if (!defender.active && defender.player.id === m.selectedPlayerId) m.selectedPlayerId = m.bestControlledActor().player.id;
}

/** The wall jumps when a direct free kick is struck at goal: a pose cue for the defenders standing 7 to 11.5 m away. */
export function jumpWall(m: ArcadeMatch, kicker: ArcadeActor): void {
  const release = m.football.restartRelease;
  if (!release || release.phase !== 'freeKick' || release.indirect || release.side !== kicker.side) return;
  for (const defender of m.actors) {
    if (!defender.active || defender.side === kicker.side || defender.player.positionGroup === 'GK') continue;
    const gap = distance(defender, kicker);
    if (gap > 7 && gap < 11.5) m.setAction(defender, 'wall-jump');
  }
}

/** A yellow card held back during an advantage is shown at the next stoppage. */
export function applyPendingCards(m: ArcadeMatch): void {
  const id = m.football.pendingYellow;
  if (!id) return;
  m.football.pendingYellow = null;
  const defender = m.actors.find((actor) => actor.player.id === id);
  if (!defender || !defender.active || defender.card !== 'none') return;
  defender.card = 'yellow';
  m.addStoppage(0.3);
  m.stats(defender.side).yellows++;
  m.contributions[defender.player.id].yellows++;
  m.adjustRating(defender.player.id, -0.25);
  m.events.push({ minute: m.footballMinute, type: 'yellow', side: defender.side, playerId: defender.player.id, messageKey: 'match.yellow', params: { player: playerName(defender.player) } });
}
