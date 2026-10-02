import { autoFillLineup } from '../../data/generators';
import { createFormation, FORMATION_TEMPLATES } from '../../data/formations';
import { emptyTeamFinance } from '../../models/career.model';
import { LegendsCard, LegendsSquad, LegendsState } from '../../models/legends.model';
import { Player } from '../../models/player.model';
import { defaultTactics } from '../../models/tactics.model';
import { Team, defaultFacilities } from '../../models/team.model';
import { computeOverall, groupForPosition } from '../ratings';
import { clamp } from '../util';
import { createClubVisualIdentity, hash32 } from '../visual-identity';

export const LEGENDS_FORMATIONS = FORMATION_TEMPLATES.map((template) => ({ id: template.id, name: template.name }));

export function slotPositions(formationId: string): string[] {
  const template = FORMATION_TEMPLATES.find((candidate) => candidate.id === formationId) ?? FORMATION_TEMPLATES[0];
  return template.slots.map((slot) => slot.position);
}

/** 3 = natural position, 2 = listed alternative, 1 = same unit, 0 = out of position. */
export function positionFit(card: LegendsCard, position: string): number {
  if (card.player.position === position) return 3;
  if ((card.player.altPositions as string[]).includes(position)) return 2;
  if (card.player.positionGroup === groupForPosition(position)) return 1;
  return 0;
}

/**
 * Chemistry 0..10 per player: position fit plus links to the other starters through club,
 * league and nation (club links count most).
 */
export function playerChemistry(card: LegendsCard, position: string, starters: LegendsCard[]): number {
  const others = starters.filter((other) => other.id !== card.id);
  const club = others.filter((other) => other.clubId === card.clubId).length;
  const league = others.filter((other) => other.leagueId === card.leagueId).length;
  const nation = others.filter((other) => other.nation === card.nation).length;
  const fit = positionFit(card, position);
  const links = Math.min(3, club) + Math.min(2, Math.floor(league / 3)) + Math.min(2, Math.floor(nation / 2));
  return clamp(fit + links, 0, 10);
}

export interface SquadView {
  starters: Array<{ card: LegendsCard | null; position: string; chemistry: number }>;
  bench: LegendsCard[];
  chemistry: number;
  rating: number;
}

export function squadView(state: Pick<LegendsState, 'cards' | 'squad'>, squad: LegendsSquad = state.squad, pool: LegendsCard[] = state.cards): SquadView {
  const byId = new Map(pool.map((card) => [card.id, card]));
  const positions = slotPositions(squad.formationId);
  const cards = squad.slots.map((id) => (id ? byId.get(id) ?? null : null));
  const starters = cards.filter((card): card is LegendsCard => !!card);
  const entries = positions.map((position, index) => {
    const card = cards[index] ?? null;
    return { card, position, chemistry: card ? playerChemistry(card, position, starters) : 0 };
  });
  const chemistry = Math.round(entries.reduce((sum, entry) => sum + entry.chemistry, 0) / (positions.length * 10) * 100);
  const rating = starters.length ? Math.round(starters.reduce((sum, card) => sum + card.player.overall, 0) / positions.length) : 0;
  return { starters: entries, bench: squad.bench.map((id) => byId.get(id)).filter((card): card is LegendsCard => !!card), chemistry, rating };
}

/** Best starting eleven and seven substitutes, without two copies of the same player. */
export function autoBuild(cards: LegendsCard[], formationId: string): LegendsSquad {
  const positions = slotPositions(formationId);
  const used = new Set<string>();
  const slots: (string | null)[] = positions.map(() => null);
  // Goalkeeper first, then the rest by best weighted fit.
  const order = positions.map((position, index) => ({ position, index })).sort((a, b) => (a.position === 'GK' ? -1 : 0) - (b.position === 'GK' ? -1 : 0));
  for (const { position, index } of order) {
    const best = cards.filter((card) => !used.has(card.baseId) && positionFit(card, position) > 0)
      .sort((a, b) => b.player.overall + positionFit(b, position) * 4 - (a.player.overall + positionFit(a, position) * 4))[0];
    if (!best) continue;
    slots[index] = best.id;
    used.add(best.baseId);
  }
  for (let index = 0; index < slots.length; index++) {
    if (slots[index]) continue;
    const any = cards.filter((card) => !used.has(card.baseId)).sort((a, b) => b.player.overall - a.player.overall)[0];
    if (any) { slots[index] = any.id; used.add(any.baseId); }
  }
  const bench = cards.filter((card) => !used.has(card.baseId)).sort((a, b) => b.player.overall - a.player.overall)
    .filter((card, index, list) => list.findIndex((other) => other.baseId === card.baseId) === index).slice(0, 7).map((card) => card.id);
  return { formationId, slots, bench };
}

/** Chemistry sharpens or blunts every attribute by up to three points. */
function withChemistry(player: Player, chemistry: number): Player {
  const copy = structuredClone(player);
  const bonus = Math.round((chemistry - 5) * 0.6);
  for (const key of Object.keys(copy.attributes) as Array<keyof Player['attributes']>) copy.attributes[key] = clamp(copy.attributes[key] + bonus, 1, 99);
  copy.overall = computeOverall(copy.attributes, copy.positionGroup);
  return copy;
}

/** The engine side for a squad of cards. */
export function cardsToTeam(options: { id: string; name: string; short: string; primary: string; secondary: string; squad: LegendsSquad; cards: LegendsCard[]; stadium?: number }): Team {
  const view = squadView({ cards: options.cards, squad: options.squad });
  const formation = createFormation(options.squad.formationId);
  const players: Player[] = [];
  const kits = new Set<number>();
  const kitFor = (preferred: number) => { let kit = preferred; while (kits.has(kit)) kit = kit >= 99 ? 1 : kit + 1; kits.add(kit); return kit; };
  view.starters.forEach((entry, index) => {
    if (!entry.card) return;
    const player = withChemistry(entry.card.player, entry.chemistry);
    player.kitNumber = kitFor(player.positionGroup === 'GK' ? 1 : index + 2);
    formation.slots[index].playerId = player.id;
    players.push(player);
  });
  for (const card of view.bench) {
    const player = structuredClone(card.player);
    player.kitNumber = kitFor(12 + players.length);
    players.push(player);
  }
  const team: Team = {
    id: options.id,
    name: options.name,
    shortName: options.short,
    kit: { primary: options.primary, secondary: options.secondary },
    visuals: createClubVisualIdentity(options.name, options.short, options.primary, options.secondary, hash32(options.id)),
    players,
    formation,
    tactics: defaultTactics(),
    facilities: { ...defaultFacilities(), stadium: options.stadium ?? 2 },
    coins: 0,
    reputation: 60,
    wageBudget: 0,
    isPlayerControlled: true,
    strength: view.rating,
    managerId: `${options.id}-manager`,
    cityId: `${options.id}-city`,
    rivalTeamIds: [],
    finance: emptyTeamFinance(1),
  };
  // Fill any empty slot from the bench so the engine always has eleven players.
  if (formation.slots.some((slot) => !slot.playerId)) autoFillLineup(team);
  return team;
}

const clubTeams = new Map<string, Team>();

/** A minimal club object so card portraits wear the right kit. */
export function clubTeam(club: { id: string; name: string; short: string; primary: string; secondary: string }): Team {
  const cached = clubTeams.get(club.id + club.primary);
  if (cached) return cached;
  const team: Team = {
    id: club.id, name: club.name, shortName: club.short, kit: { primary: club.primary, secondary: club.secondary },
    visuals: createClubVisualIdentity(club.name, club.short, club.primary, club.secondary, hash32(club.id)),
    players: [], formation: createFormation('4-3-3'), tactics: defaultTactics(), facilities: defaultFacilities(),
    coins: 0, reputation: 50, wageBudget: 0, isPlayerControlled: false, strength: 60,
    managerId: `${club.id}-manager`, cityId: `${club.id}-city`, rivalTeamIds: [], finance: emptyTeamFinance(1),
  };
  clubTeams.set(club.id + club.primary, team);
  return team;
}
