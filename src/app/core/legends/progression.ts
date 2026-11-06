import { LegendsCard, LegendsState, PackId } from '../../models/legends.model';
import { MatchResult } from '../../models/match.model';
import { computeOverall } from '../ratings';
import { clamp } from '../util';
import { hash32 } from '../visual-identity';
import { TIER_ORDER, TIER_RANGES, TIER_RARITY, legendsWorld, tierForOverall } from './cards';
import { dnaForRarity } from '../rpg/player-dna';

/**
 * Progression of the Legends Team beyond the packs: card experience and levels, the upgrade of a card to the next tier,
 * the album with rewards for complete sets, the weekly squad challenge and the draft opponents that scale. All of it is
 * pure and works on the state; optional fields keep every older save valid.
 */

// ── Card experience ─────────────────────────────────────────────────────────

/** Experience at which a card reaches level 0 to 5. */
export const CARD_LEVEL_XP = [0, 60, 160, 320, 560, 900];
export const CARD_MAX_LEVEL = CARD_LEVEL_XP.length - 1;

export function cardLevelFor(xp: number): number {
  let level = 0;
  while (level < CARD_MAX_LEVEL && xp >= CARD_LEVEL_XP[level + 1]) level++;
  return level;
}

export function cardXp(state: Pick<LegendsState, 'cardXp'>, card: Pick<LegendsCard, 'baseId'>): number {
  return state.cardXp?.[card.baseId] ?? 0;
}

export function cardLevel(state: Pick<LegendsState, 'cardXp'>, card: Pick<LegendsCard, 'baseId'>): number {
  return cardLevelFor(cardXp(state, card));
}

/** The attribute points a level gives: one at levels 2 and 3, two at 4 and 5. Small on purpose: a card does not outgrow its tier. */
export function levelBonus(level: number): number {
  return Math.floor(level / 2);
}

/**
 * Experience for the cards that played a match of the squad: showing up, goals, the man of the match. Cards of the
 * draft are not part of the collection and earn nothing. Returns the cards that gained a level.
 */
export function awardCardXp(state: LegendsState, result: MatchResult, cards: readonly LegendsCard[]): LegendsCard[] {
  const xp = (state.cardXp ??= {});
  const levelled: LegendsCard[] = [];
  const won = result.homeScore > result.awayScore;
  for (const card of cards) {
    const goals = result.contributions[card.player.id]?.goals ?? 0;
    const assists = result.contributions[card.player.id]?.assists ?? 0;
    const gain = 12 + goals * 6 + assists * 3 + (won ? 4 : 0) + (result.manOfTheMatchId === card.player.id ? 20 : 0);
    const before = cardLevelFor(xp[card.baseId] ?? 0);
    xp[card.baseId] = (xp[card.baseId] ?? 0) + gain;
    if (cardLevelFor(xp[card.baseId]) > before) levelled.push(card);
  }
  return levelled;
}

// ── Upgrading a card ────────────────────────────────────────────────────────

/** What an upgrade to the next tier asks for: the card's level, and duplicates or upgrade tokens. */
export const UPGRADE_COST: Record<'bronze' | 'silver', { level: number; duplicates: number; tokens: number }> = {
  bronze: { level: 2, duplicates: 1, tokens: 2 },
  silver: { level: 3, duplicates: 2, tokens: 4 },
};

export function upgradableTier(card: Pick<LegendsCard, 'tier'>): 'bronze' | 'silver' | null {
  return card.tier === 'bronze' || card.tier === 'silver' ? card.tier : null;
}

function inSquadOrBench(state: LegendsState, id: string): boolean {
  return state.squad.slots.includes(id) || state.squad.bench.includes(id);
}

/** The spare copies of a card: same player, not in the squad. */
export function spareCopies(state: LegendsState, card: LegendsCard): LegendsCard[] {
  return state.cards.filter((other) => other.baseId === card.baseId && other.id !== card.id && !inSquadOrBench(state, other.id));
}

export type UpgradeCheck =
  | { ok: true; via: 'duplicates' | 'tokens'; duplicates: number; tokens: number }
  | { ok: false; reason: 'card' | 'top-tier' | 'level' | 'material' };

/** Whether a card can go up a tier now and what it would cost: duplicates first, upgrade tokens from tasks when there are none. */
export function checkUpgrade(state: LegendsState, cardId: string): UpgradeCheck {
  const card = state.cards.find((candidate) => candidate.id === cardId);
  if (!card) return { ok: false, reason: 'card' };
  const tier = upgradableTier(card);
  if (!tier) return { ok: false, reason: 'top-tier' };
  const cost = UPGRADE_COST[tier];
  if (cardLevel(state, card) < cost.level) return { ok: false, reason: 'level' };
  if (spareCopies(state, card).length >= cost.duplicates) return { ok: true, via: 'duplicates', duplicates: cost.duplicates, tokens: 0 };
  if ((state.tokens ?? 0) >= cost.tokens) return { ok: true, via: 'tokens', duplicates: 0, tokens: cost.tokens };
  return { ok: false, reason: 'material' };
}

/** Raises every attribute until the card sits a few points inside its new tier, as `basePlayer` does for a fresh card. */
function liftInto(card: LegendsCard, tier: LegendsCard['tier']): void {
  const target = TIER_RANGES[tier][0] + 3;
  const player = card.player;
  for (let guard = 0; guard < 40 && player.overall < target; guard++) {
    for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) {
      if (key !== 'goalkeeping' || player.positionGroup === 'GK') player.attributes[key] = clamp(player.attributes[key] + 1, 1, 99);
    }
    player.overall = computeOverall(player.attributes, player.positionGroup);
  }
  // Rounding must not leave the card in the tier below or above.
  while (tierForOverall(player.overall) !== tier && player.overall < 99 && TIER_ORDER.indexOf(tierForOverall(player.overall)) < TIER_ORDER.indexOf(tier)) {
    for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = clamp(player.attributes[key] + 1, 1, 99);
    player.overall = computeOverall(player.attributes, player.positionGroup);
  }
  player.potential = Math.max(player.potential, player.overall);
}

/** Takes the cost and moves the card up a tier: stronger, with the rarity (signatures, quirks) of the new tier. */
export function upgradeCard(state: LegendsState, cardId: string): UpgradeCheck {
  const check = checkUpgrade(state, cardId);
  if (!check.ok) return check;
  const card = state.cards.find((candidate) => candidate.id === cardId)!;
  if (check.via === 'duplicates') {
    const gone = new Set(spareCopies(state, card).slice(0, check.duplicates).map((copy) => copy.id));
    state.cards = state.cards.filter((candidate) => !gone.has(candidate.id));
  } else state.tokens = (state.tokens ?? 0) - check.tokens;
  const next = TIER_ORDER[TIER_ORDER.indexOf(card.tier) + 1];
  card.tier = next;
  liftInto(card, next);
  card.player.dna = dnaForRarity(card.player, TIER_RARITY[next]);
  return check;
}

// ── Album ───────────────────────────────────────────────────────────────────

export interface AlbumSet {
  id: string;
  name: [string, string];
  text: [string, string];
  need: number;
  reward: { coins: number; pack: PackId | null };
  /** How many the collection has towards it. */
  have: (cards: readonly LegendsCard[], seed: number) => number;
}

const distinct = (cards: readonly LegendsCard[], keep: (card: LegendsCard) => boolean = () => true) => new Set(cards.filter(keep).map((card) => card.baseId)).size;

export const ALBUM_SETS: AlbumSet[] = [
  { id: 'bronze-30', name: ['Bronze-Sammlung', 'Bronze collection'], text: ['30 verschiedene Bronze-Karten', '30 different bronze cards'], need: 30, reward: { coins: 1000, pack: null }, have: (cards) => distinct(cards, (card) => card.tier === 'bronze') },
  { id: 'silver-25', name: ['Silber-Sammlung', 'Silver collection'], text: ['25 verschiedene Silber-Karten', '25 different silver cards'], need: 25, reward: { coins: 0, pack: 'silver' }, have: (cards) => distinct(cards, (card) => card.tier === 'silver') },
  { id: 'gold-15', name: ['Gold-Sammlung', 'Gold collection'], text: ['15 verschiedene Gold-Karten', '15 different gold cards'], need: 15, reward: { coins: 0, pack: 'gold' }, have: (cards) => distinct(cards, (card) => card.tier === 'gold') },
  { id: 'legend-3', name: ['Ahnengalerie', 'Hall of legends'], text: ['3 verschiedene Legenden', '3 different legends'], need: 3, reward: { coins: 0, pack: 'premium' }, have: (cards) => distinct(cards, (card) => card.tier === 'legend') },
  { id: 'league-a-30', name: ['Premier-Fan', 'Premier fan'], text: ['30 verschiedene Spieler der ersten Liga', '30 different players of the top league'], need: 30, reward: { coins: 1500, pack: null }, have: (cards) => distinct(cards, (card) => card.leagueId === 'league-a') },
  { id: 'league-b-30', name: ['Championship-Fan', 'Championship fan'], text: ['30 verschiedene Spieler der zweiten Liga', '30 different players of the second league'], need: 30, reward: { coins: 1500, pack: null }, have: (cards) => distinct(cards, (card) => card.leagueId === 'league-b') },
  { id: 'nations-12', name: ['Weltenbummler', 'Globetrotter'], text: ['Karten aus 12 verschiedenen Nationen', 'Cards from 12 different nations'], need: 12, reward: { coins: 2000, pack: null }, have: (cards) => new Set(cards.map((card) => card.nation)).size },
  { id: 'positions-3', name: ['Voller Kader', 'Full squad'], text: ['Von jeder der zehn Positionen drei verschiedene Spieler', 'Three different players of each of the ten positions'], need: 10, reward: { coins: 0, pack: 'gold' }, have: (cards) => {
    const byPosition = new Map<string, Set<string>>();
    for (const card of cards) byPosition.set(card.player.position, (byPosition.get(card.player.position) ?? new Set()).add(card.baseId));
    return [...byPosition.values()].filter((players) => players.size >= 3).length;
  } },
];

export interface AlbumEntry {
  set: AlbumSet;
  have: number;
  complete: boolean;
  claimed: boolean;
}

export function albumProgress(state: LegendsState): AlbumEntry[] {
  return ALBUM_SETS.map((set) => {
    const have = Math.min(set.need, set.have(state.cards, state.seed));
    return { set, have, complete: have >= set.need, claimed: !!state.albumClaimed?.includes(set.id) };
  });
}

/** Sets that are complete, claimed or not: the achievements count these. */
export function albumSetsComplete(state: LegendsState): number {
  return albumProgress(state).filter((entry) => entry.complete).length;
}

export function claimAlbumSet(state: LegendsState, setId: string): { coins: number; pack: PackId | null } | null {
  const entry = albumProgress(state).find((candidate) => candidate.set.id === setId);
  if (!entry || !entry.complete || entry.claimed) return null;
  (state.albumClaimed ??= []).push(setId);
  state.coins += entry.set.reward.coins;
  if (entry.set.reward.pack) state.packs.push(entry.set.reward.pack);
  return { ...entry.set.reward };
}

// ── The weekly squad challenge ──────────────────────────────────────────────

export interface WeeklySbc {
  id: string;
  kind: 'rating' | 'club' | 'young';
  de: string;
  en: string;
  descriptionDe: string;
  descriptionEn: string;
  size: number;
  reward: PackId;
  /** The average overall asked for (rating and young) or the club the five cards must share. */
  minAverage: number;
  maxAge: number;
  check: (cards: LegendsCard[]) => boolean;
}

const average = (cards: readonly LegendsCard[]) => cards.reduce((sum, card) => sum + card.player.overall, 0) / Math.max(1, cards.length);

/** A new challenge every week, the same for the same Legends club and week: three kinds with changing demands. */
export function weeklySbc(seed: number, week: string): WeeklySbc {
  const roll = hash32(`${seed}|weekly-sbc|${week}`);
  const kind = (['rating', 'club', 'young'] as const)[roll % 3];
  const id = `weekly-${week}`;
  if (kind === 'rating') {
    const minAverage = 60 + (roll >>> 4) % 9;
    return { id, kind, size: 11, minAverage, maxAge: 99, reward: minAverage >= 66 ? 'gold' : 'silver', de: 'Wochenaufgabe: Qualität', en: 'Weekly: quality', descriptionDe: `11 Karten, Ø-Wertung ≥ ${minAverage}`, descriptionEn: `11 cards, average ≥ ${minAverage}`, check: (cards) => average(cards) >= minAverage };
  }
  if (kind === 'club') {
    return { id, kind, size: 5, minAverage: 0, maxAge: 99, reward: 'silver', de: 'Wochenaufgabe: Vereinstreue', en: 'Weekly: club loyalty', descriptionDe: '5 Karten desselben Vereins', descriptionEn: '5 cards of the same club', check: (cards) => new Set(cards.map((card) => card.clubId)).size === 1 };
  }
  const maxAge = 24 + (roll >>> 6) % 4;
  return { id, kind, size: 11, minAverage: 62, maxAge, reward: 'gold', de: 'Wochenaufgabe: Junges Blut', en: 'Weekly: young blood', descriptionDe: `11 Karten, alle höchstens ${maxAge} Jahre, Ø-Wertung ≥ 62`, descriptionEn: `11 cards, all at most ${maxAge} years old, average ≥ 62`, check: (cards) => cards.every((card) => card.player.age <= maxAge) && average(cards) >= 62 };
}

/** Cards for the weekly challenge: the cheapest that still fit, or null when the collection cannot. `free` excludes the squad. */
export function suggestWeekly(sbc: WeeklySbc, free: readonly LegendsCard[], value: (card: LegendsCard) => number): LegendsCard[] | null {
  const byValue = [...free].sort((a, b) => value(a) - value(b));
  if (sbc.kind === 'club') {
    for (const clubId of new Set(byValue.map((card) => card.clubId))) {
      const pool = byValue.filter((card) => card.clubId === clubId);
      const found = [...new Map(pool.map((card) => [card.baseId, card])).values()].slice(0, sbc.size);
      if (found.length === sbc.size) return found;
    }
    return null;
  }
  const pool = sbc.kind === 'young' ? byValue.filter((card) => card.player.age <= sbc.maxAge) : byValue;
  // Start from the best cards and swap the most valuable one for the cheapest unused card while the average still fits.
  const chosen = [...pool].sort((a, b) => b.player.overall - a.player.overall).slice(0, sbc.size);
  if (chosen.length < sbc.size || !sbc.check(chosen)) return null;
  const spare = pool.filter((card) => !chosen.includes(card));
  for (const cheap of spare) {
    const dearest = chosen.reduce((best, card) => (value(card) > value(best) ? card : best), chosen[0]);
    if (value(cheap) >= value(dearest)) break;
    const trial = chosen.map((card) => (card === dearest ? cheap : card));
    if (sbc.check(trial)) chosen[chosen.indexOf(dearest)] = cheap;
  }
  return chosen;
}

// ── Draft opponents that grow with the squad ────────────────────────────────

/** The strength of the draft opponent of a round: the old 72 + 3 per round, moved by how strong the drafted team is. */
export function draftOpponentStrength(round: number, teamRating: number): number {
  const base = 72 + round * 3;
  // A team rated 74 meets the old opponents; every two points above or below move the opponent by one, within -3 and +6.
  const adjustment = clamp(Math.round((teamRating - 74) / 2), -3, 6);
  return base + adjustment;
}

/** Number of different leagues in a Legends world, so the album sets never name one that does not exist. */
export function leagueCount(seed: number): number {
  return legendsWorld(seed).leagues.length;
}
