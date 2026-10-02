import { generatePlayer } from '../../data/generators';
import { extendWorldWithDivision, generateWorld, uniqueShortName } from '../../data/world-generator';
import { Position } from '../../models/enums';
import { CardClub, CardLeague, CardTier, LegendsCard, PackId } from '../../models/legends.model';
import { computeOverall, marketValueFor, weeklySalaryFor } from '../ratings';
import { Rng, clamp } from '../util';
import { createPlayerVisualIdentity, hash32 } from '../visual-identity';

export const TIER_ORDER: CardTier[] = ['bronze', 'silver', 'gold', 'legend'];
export const TIER_RANGES: Record<CardTier, [number, number]> = { bronze: [50, 64], silver: [65, 74], gold: [75, 84], legend: [86, 93] };
/** Distinct players per tier; drawing the same one twice gives a duplicate. */
export const TIER_POOL: Record<CardTier, number> = { bronze: 220, silver: 160, gold: 110, legend: 24 };
export const QUICK_SELL: Record<CardTier, number> = { bronze: 150, silver: 400, gold: 1500, legend: 6000 };

export const TIER_LABELS: Record<CardTier, { de: string; en: string }> = {
  bronze: { de: 'Bronze', en: 'Bronze' },
  silver: { de: 'Silber', en: 'Silver' },
  gold: { de: 'Gold', en: 'Gold' },
  legend: { de: 'Legende', en: 'Legend' },
};

export function tierForOverall(overall: number): CardTier {
  return overall >= 86 ? 'legend' : overall >= 75 ? 'gold' : overall >= 65 ? 'silver' : 'bronze';
}

const POSITIONS: Array<{ position: Position; alts: Position[]; weight: number }> = [
  { position: 'GK', alts: [], weight: 10 },
  { position: 'CB', alts: ['CDM'], weight: 14 },
  { position: 'LB', alts: ['LWB'], weight: 6 },
  { position: 'RB', alts: ['RWB'], weight: 6 },
  { position: 'CDM', alts: ['CM'], weight: 8 },
  { position: 'CM', alts: ['CDM', 'CAM'], weight: 12 },
  { position: 'CAM', alts: ['CM'], weight: 8 },
  { position: 'LW', alts: ['LM'], weight: 7 },
  { position: 'RW', alts: ['RM'], weight: 7 },
  { position: 'ST', alts: ['CF'], weight: 12 },
];

const worlds = new Map<number, { leagues: CardLeague[]; clubs: CardClub[] }>();

/** Two fictional leagues of twelve clubs, generated once per Legends seed. */
export function legendsWorld(seed: number): { leagues: CardLeague[]; clubs: CardClub[] } {
  const cached = worlds.get(seed);
  if (cached) return cached;
  const idsA = Array.from({ length: 12 }, (_, index) => `lc-a${index}`);
  const idsB = Array.from({ length: 12 }, (_, index) => `lc-b${index}`);
  const blueprint = generateWorld(hash32(`${seed}|legends-world`), idsA, 'Legends XI');
  const second = extendWorldWithDivision(blueprint.world, idsB, 2);
  const root = blueprint.world.country.leagueName.replace(/ Legends League$/, '');
  const leagues: CardLeague[] = [{ id: 'league-a', name: `${root} Premier` }, { id: 'league-b', name: `${root} Championship` }];
  const taken = new Set<string>();
  const clubs: CardClub[] = [
    ...blueprint.clubIdentities.slice(1).map((identity, index) => ({ id: idsA[index + 1], ...identity, leagueId: 'league-a' })),
    ...second.map((identity, index) => ({ id: idsB[index], ...identity, leagueId: 'league-b' })),
  ].map((club) => ({ ...club, short: uniqueShortName(club.name, taken) }));
  const world = { leagues, clubs };
  worlds.set(seed, world);
  return world;
}

/** The fixed player behind a pool slot: same seed, tier and index always give the same player. */
function basePlayer(seed: number, tier: CardTier, index: number, position?: Position) {
  const rng = new Rng(hash32(`${seed}|base|${tier}|${index}|${position ?? ''}`));
  const total = POSITIONS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  const slot = position ? POSITIONS.find((entry) => entry.position === position) ?? POSITIONS[0] : POSITIONS.find((entry) => (roll -= entry.weight) <= 0) ?? POSITIONS[0];
  const [min, max] = TIER_RANGES[tier];
  const target = tier === 'legend' ? rng.int(83, 87) : rng.int(min, max);
  const player = generatePlayer(rng, slot.position, slot.alts, target, rng.int(1, 40), `legends-${tier}-${index}`, seed);
  if (tier === 'legend') {
    // Legends are boosted versions of world-class players.
    for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) {
      if (key !== 'goalkeeping' || player.positionGroup === 'GK') player.attributes[key] = clamp(player.attributes[key] + rng.int(3, 6), 1, 99);
    }
    player.age = rng.int(30, 36);
  }
  player.overall = computeOverall(player.attributes, player.positionGroup);
  // Keep the card inside its tier after rounding effects.
  for (let guard = 0; tierForOverall(player.overall) !== tier && guard < 40; guard++) {
    const up = TIER_ORDER.indexOf(tierForOverall(player.overall)) < TIER_ORDER.indexOf(tier);
    for (const key of Object.keys(player.attributes) as Array<keyof typeof player.attributes>) player.attributes[key] = clamp(player.attributes[key] + (up ? 1 : -1), 1, 99);
    player.overall = computeOverall(player.attributes, player.positionGroup);
  }
  player.id = `lp-${tier}-${index}${position ? `-${position}` : ''}`;
  player.visuals = createPlayerVisualIdentity(`${seed}|${player.id}`);
  player.potential = Math.max(player.potential, player.overall);
  player.fitness = 100;
  player.morale = 75;
  player.injuryWeeks = 0;
  player.contractWeeks = 999;
  player.marketValue = marketValueFor(player.overall, player.age, player.potential);
  player.salary = weeklySalaryFor(player);
  return player;
}

export function createCard(seed: number, serial: number, tier: CardTier, options: { index?: number; position?: Position; prefix?: string } = {}): LegendsCard {
  const index = options.index ?? hash32(`${seed}|pool|${tier}|${serial}`) % TIER_POOL[tier];
  const player = basePlayer(seed, tier, index, options.position);
  const world = legendsWorld(seed);
  const club = world.clubs[hash32(`${seed}|club|${tier}|${index}`) % world.clubs.length];
  return {
    id: `${options.prefix ?? 'card'}-${serial.toString(36)}`,
    baseId: player.id,
    tier,
    player,
    clubId: club.id,
    leagueId: club.leagueId,
    nation: player.nationality,
    acquiredAt: serial,
  };
}

export function quickSellValue(card: LegendsCard): number {
  return QUICK_SELL[card.tier] + Math.max(0, card.player.overall - TIER_RANGES[card.tier][0]) * (card.tier === 'legend' ? 200 : card.tier === 'gold' ? 60 : 15);
}

export interface PackDefinition {
  id: PackId;
  de: string;
  en: string;
  price: number;
  size: number;
  odds: Record<CardTier, number>;
  /** Minimum number of cards of at least this tier. */
  guarantee: { tier: CardTier; count: number } | null;
}

export const PACKS: Record<PackId, PackDefinition> = {
  bronze: { id: 'bronze', de: 'Bronze-Pack', en: 'Bronze pack', price: 750, size: 5, odds: { bronze: 0.8, silver: 0.18, gold: 0.02, legend: 0 }, guarantee: null },
  silver: { id: 'silver', de: 'Silber-Pack', en: 'Silver pack', price: 2500, size: 5, odds: { bronze: 0.25, silver: 0.62, gold: 0.12, legend: 0.01 }, guarantee: { tier: 'silver', count: 2 } },
  gold: { id: 'gold', de: 'Gold-Pack', en: 'Gold pack', price: 7500, size: 6, odds: { bronze: 0, silver: 0.55, gold: 0.41, legend: 0.04 }, guarantee: { tier: 'gold', count: 1 } },
  premium: { id: 'premium', de: 'Premium-Pack', en: 'Premium pack', price: 15000, size: 8, odds: { bronze: 0, silver: 0.35, gold: 0.55, legend: 0.1 }, guarantee: { tier: 'gold', count: 3 } },
};

export function drawTier(rng: Rng, odds: Record<CardTier, number>): CardTier {
  let roll = rng.next();
  for (const tier of TIER_ORDER) {
    roll -= odds[tier];
    if (roll < 0) return tier;
  }
  return [...TIER_ORDER].reverse().find((tier) => odds[tier] > 0) ?? 'bronze';
}

/** Tiers of one pack, deterministic for the seed and the number of packs opened before. */
export function packTiers(seed: number, packId: PackId, packNumber: number): CardTier[] {
  const pack = PACKS[packId];
  const rng = new Rng(hash32(`${seed}|pack|${packId}|${packNumber}`));
  const tiers = Array.from({ length: pack.size }, () => drawTier(rng, pack.odds));
  if (pack.guarantee) {
    const minimum = TIER_ORDER.indexOf(pack.guarantee.tier);
    let have = tiers.filter((tier) => TIER_ORDER.indexOf(tier) >= minimum).length;
    for (let index = 0; index < tiers.length && have < pack.guarantee.count; index++) {
      if (TIER_ORDER.indexOf(tiers[index]) < minimum) { tiers[index] = pack.guarantee.tier; have++; }
    }
  }
  return tiers.sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
}
