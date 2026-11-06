import { GameState } from '../../models/game.model';
import { SupplierTier } from '../rpg/equipment';
import { book } from './finance';

/**
 * The kit supplier of the managed club. The deal only decides the tier of the boots' gain (see core/rpg/equipment.ts):
 * a better supplier sharpens what the boots give, never what they cost, and it costs money every week. Without a
 * contract the club plays in basic boots. Other clubs have no suppliers, so the AI is not touched.
 */
export interface SupplierDef {
  id: string;
  tier: SupplierTier;
  name: [string, string];
  text: [string, string];
  weeklyFee: number;
  minReputation: number;
}

export const SUPPLIERS: SupplierDef[] = [
  {
    id: 'basic',
    tier: 1,
    name: ['Vereinsausstatter', 'Club kit'],
    text: ['Schlichte Schuhe, kostenlos.', 'Plain boots, free of charge.'],
    weeklyFee: 0,
    minReputation: 0,
  },
  {
    id: 'regional',
    tier: 2,
    name: ['Regionaler Ausrüster', 'Regional supplier'],
    text: ['Bessere Schuhe: die Stärke der Stollen voll ausgespielt.', 'Better boots: the gain at full strength.'],
    weeklyFee: 2200,
    minReputation: 45,
  },
  {
    id: 'global',
    tier: 3,
    name: ['Weltmarke', 'Global brand'],
    text: ['Spitzenschuhe: 20 % mehr Stärke, die Schwäche bleibt gleich.', 'Top boots: 20 % more gain, the drawback stays the same.'],
    weeklyFee: 5600,
    minReputation: 70,
  },
];

export function supplierById(id: string | undefined): SupplierDef | undefined {
  return SUPPLIERS.find((candidate) => candidate.id === id);
}

/** The deal in force: the signed one while it runs, else the basic one. */
export function activeSupplier(game: Pick<GameState, 'supplier' | 'league'>): SupplierDef {
  const contract = game.supplier;
  const def = supplierById(contract?.id);
  if (def && contract && contract.untilSeason >= game.league.season) return def;
  return SUPPLIERS[0];
}

export type SignFailure = 'club' | 'unknown' | 'running' | 'reputation';

/** Signs a supplier for the rest of this season. Only possible while the basic deal is in force. */
export function signSupplier(game: GameState, id: string): { ok: true } | { ok: false; reason: SignFailure } {
  const club = game.teams.find((team) => team.id === game.clubId);
  const def = supplierById(id);
  if (!club) return { ok: false, reason: 'club' };
  if (!def || def.id === 'basic') return { ok: false, reason: 'unknown' };
  if (activeSupplier(game).id !== 'basic') return { ok: false, reason: 'running' };
  if (club.reputation < def.minReputation) return { ok: false, reason: 'reputation' };
  game.supplier = { id: def.id, signedSeason: game.league.season, untilSeason: game.league.season };
  syncEquipment(game);
  return { ok: true };
}

/** The weekly fee, booked as upkeep of the managed club. */
export function paySupplier(game: GameState): number {
  const club = game.teams.find((team) => team.id === game.clubId);
  const fee = activeSupplier(game).weeklyFee;
  if (club && fee) book(game, club, 'upkeep', fee);
  return fee;
}

/**
 * Keeps the boots in line with the deal: the managed club's players carry the supplier's tier, everybody else
 * plays without boots effects (a player who moves on leaves his boots behind). Idempotent.
 */
export function syncEquipment(game: GameState): void {
  const tier = activeSupplier(game).tier;
  for (const team of game.teams) {
    for (const player of team.players) {
      if (!player.equipment) continue;
      if (team.id === game.clubId) player.equipment.tier = tier;
      else delete player.equipment;
    }
  }
}
