import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { clamp } from '../util';
import { socialRole } from './social';

/**
 * Duo chemistry. Players who often start together, share a nation or grew up in the same academy become
 * partners: at most one partner each, never a loner. The strength (0..1) reaches the stat block through the
 * `linkPartner` hook (see `StatContext.partner` in stat-block.ts). Agent-side wiring is deliberately small: when
 * the ball goes between two partners the engine may apply `partnerBonus(strength)`; nothing else is needed.
 */
export type PartnerLinks = Record<string, number>;

export interface PartnerLink {
  partnerId: string;
  /** 0.15 (just became partners) to 1 (inseparable). */
  strength: number;
  score: number;
}

/** Matches together are worth half a point each, up to 24 of them. */
export const TOGETHER_CAP = 24;
export const NATION_POINTS = 4;
export const ACADEMY_POINTS = 5;
export const PARTNER_THRESHOLD = 12;
export const PARTNER_MAX = 21;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Adds one match to every pair among the eleven starters. */
export function recordTogether(links: PartnerLinks, starterIds: readonly string[]): void {
  for (let i = 0; i < starterIds.length; i++)
    for (let j = i + 1; j < starterIds.length; j++) {
      const key = pairKey(starterIds[i], starterIds[j]);
      links[key] = (links[key] ?? 0) + 1;
    }
}

/** At the turn of the season old pairs cool: a fifth is forgotten, pairs at zero or of players who left are dropped. */
export function coolLinks(links: PartnerLinks, present: ReadonlySet<string>): PartnerLinks {
  const next: PartnerLinks = {};
  for (const [key, value] of Object.entries(links)) {
    const [a, b] = key.split('|');
    const cooled = Math.floor(value * 0.8);
    if (cooled > 0 && present.has(a) && present.has(b)) next[key] = cooled;
  }
  return next;
}

/** How well two players fit: matches together, a shared nation and a shared academy. Loners score nothing. */
export function pairScore(a: Player, b: Player, together: number): number {
  if (socialRole(a) === 'loner' || socialRole(b) === 'loner') return 0;
  return (
    Math.min(together, TOGETHER_CAP) * 0.5 +
    (a.nationality === b.nationality ? NATION_POINTS : 0) +
    (a.fromAcademy && a.fromAcademy === b.fromAcademy ? ACADEMY_POINTS : 0)
  );
}

/**
 * The partners of a squad, assigned greedily from the best pair down so everyone has at most one. Pure: the same
 * links and squad always give the same partners. A pair needs at least one match together, so nationality alone
 * does not make partners of strangers.
 */
export function duoPartners(
  players: readonly Player[],
  links: PartnerLinks,
): Map<string, PartnerLink> {
  const pairs: { a: Player; b: Player; score: number }[] = [];
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++) {
      const together = links[pairKey(players[i].id, players[j].id)] ?? 0;
      if (together < 1) continue;
      const score = pairScore(players[i], players[j], together);
      if (score >= PARTNER_THRESHOLD) pairs.push({ a: players[i], b: players[j], score });
    }
  pairs.sort(
    (x, y) =>
      y.score - x.score || pairKey(x.a.id, x.b.id).localeCompare(pairKey(y.a.id, y.b.id)),
  );
  const result = new Map<string, PartnerLink>();
  for (const pair of pairs) {
    if (result.has(pair.a.id) || result.has(pair.b.id)) continue;
    const strength = clamp(
      (pair.score - PARTNER_THRESHOLD) / (PARTNER_MAX - PARTNER_THRESHOLD),
      0.15,
      1,
    );
    result.set(pair.a.id, { partnerId: pair.b.id, strength, score: pair.score });
    result.set(pair.b.id, { partnerId: pair.a.id, strength, score: pair.score });
  }
  return result;
}

/** The partner of a player, if he has one. */
export function partnerOf(
  partners: ReadonlyMap<string, PartnerLink>,
  playerId: string,
): PartnerLink | undefined {
  return partners.get(playerId);
}

/** The partners of a club from the links the career keeps. */
export function clubPartners(team: Pick<Team, 'players'>, links: PartnerLinks | undefined) {
  return duoPartners(team.players, links ?? {});
}

/** Largest effects a bond can have: passes between partners miss up to 6 % less, first touch is up to 4 points better. */
export const PARTNER_PASS_ERROR = 0.06;
export const PARTNER_FIRST_TOUCH = 4;

/** What the engine applies when the ball goes between two partners. Already within the caps of the hooks it feeds. */
export function partnerBonus(strength: number): { passErrorMul: number; firstTouchAdd: number } {
  const s = clamp(strength, 0, 1);
  return { passErrorMul: 1 - PARTNER_PASS_ERROR * s, firstTouchAdd: PARTNER_FIRST_TOUCH * s };
}
