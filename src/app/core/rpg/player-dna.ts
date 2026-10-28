import { AURA_FROM, MYTHIC_WORLD_CAP, RARITIES, RARITY_DEFS, Rarity, atLeast, rarityRank } from '../../data/rarity';
import { NICKNAMES } from '../../data/nicknames';
import { GameState } from '../../models/game.model';
import { Player, PlayerDNA } from '../../models/player.model';
import { generateSignatures } from './signatures';
import { clamp } from '../util';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';

export const DNA_VERSION = 2;

/** The seed depends on the player id only, so a player keeps the same DNA in every save and context. */
function dnaSeed(playerId: string): number {
  return hash32(`${playerId}|dna-v${DNA_VERSION}`);
}

/** Maps a unit roll to a tier. Lower rolls are rarer; `nudge` (0..1) pulls the roll down. */
export function rarityForRoll(roll: number, nudge = 0): Rarity {
  const adjusted = roll * (1 - 0.35 * clamp(nudge, 0, 1));
  for (const rarity of [...RARITIES].reverse()) {
    if (rarity !== 'common' && adjusted < RARITY_DEFS[rarity].threshold) return rarity;
  }
  return 'common';
}

export interface DnaOptions {
  /** Let a high potential improve the odds. Off for players that already exist in a save. */
  usePotential?: boolean;
  /** Mythic is only rolled while the world still has room (see MYTHIC_WORLD_CAP). */
  allowMythic?: boolean;
}

/** Deterministic DNA for a player; never consumes the world generator's random stream. */
export function generateDna(player: Pick<Player, 'id' | 'archetype' | 'potential'>, options: DnaOptions = {}): PlayerDNA {
  const rng = new Rng(dnaSeed(player.id));
  const roll = rng.next();
  const nudge = options.usePotential === false ? 0 : (player.potential - 65) / 35;
  let rarity = rarityForRoll(roll, nudge);
  if (rarity === 'mythic' && options.allowMythic === false) rarity = 'legendary';
  const nicknames = NICKNAMES[player.archetype] ?? [];
  const nickname = atLeast(rarity, AURA_FROM) && nicknames.length ? nicknames[rng.int(0, nicknames.length - 1)] : null;
  return { version: DNA_VERSION, rarity, nickname, signatures: generateSignatures(player, rarity) };
}

/** The DNA of a player, or a plain common one for data from before DNA existed and not yet migrated. */
export function dnaOf(player: Player): PlayerDNA {
  return player.dna ?? { version: DNA_VERSION, rarity: 'common', nickname: null, signatures: [] };
}

/** Gives every player without DNA its permanent DNA. Idempotent, so it doubles as the save migration. */
export function ensureDna(players: Iterable<Player>, mythicTaken = 0): number {
  let mythic = mythicTaken;
  for (const player of players) {
    if (player.dna) {
      // DNA from before signatures existed keeps its rarity and nickname and gains its signatures.
      if (!player.dna.signatures) player.dna = { ...player.dna, version: DNA_VERSION, signatures: generateSignatures(player, player.dna.rarity) };
      continue;
    }
    const dna = generateDna(player, { usePotential: false, allowMythic: mythic < MYTHIC_WORLD_CAP });
    if (dna.rarity === 'mythic') mythic++;
    player.dna = dna;
  }
  return mythic;
}

function everyPlayer(game: GameState): Player[] {
  return [...game.teams.flatMap((team) => team.players), ...game.transfers.freeAgents, ...(game.academy?.prospects ?? [])];
}

/** Gives every player of a game its permanent DNA and enforces the mythic cap. Safe to run on every load. */
export function ensureGameDna(game: GameState): void {
  ensureDna(everyPlayer(game), mythicCount(game));
  enforceMythicCap(game);
}

export function mythicCount(game: GameState): number {
  return everyPlayer(game).filter((player) => player.dna?.rarity === 'mythic').length;
}

/** Keeps the world rule: at most three mythic players. The surplus drops to legendary, lowest roll stays. */
export function enforceMythicCap(game: GameState): void {
  const mythics = everyPlayer(game).filter((player) => player.dna?.rarity === 'mythic');
  if (mythics.length <= MYTHIC_WORLD_CAP) return;
  mythics.sort((a, b) => dnaSeed(a.id) - dnaSeed(b.id));
  for (const player of mythics.slice(MYTHIC_WORLD_CAP)) player.dna = { ...player.dna!, rarity: 'legendary', signatures: generateSignatures(player, 'legendary') };
}

/** Rarity of a player is public for the own club and after a scouting report; otherwise it stays a "?". */
export function rarityKnown(game: GameState, player: Player): boolean {
  if (game.teams.find((team) => team.id === game.clubId)?.players.some((own) => own.id === player.id)) return true;
  if (game.academy?.prospects.some((prospect) => prospect.id === player.id)) return true;
  return game.transfers.reports.some((report) => report.playerId === player.id);
}

export function rarityRankOf(player: Player): number {
  return rarityRank(dnaOf(player).rarity);
}
