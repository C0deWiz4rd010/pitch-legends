import { GameState } from '../../models/game.model';
import { Player } from '../../models/player.model';
import { playerName } from '../ratings';

/**
 * The RPG look back of a season: which players gained levels, which signatures evolved and which are the best ones.
 * The baseline is taken when a season starts and compared with the state when it ends, so nothing has to be counted
 * along the way and an old save simply starts with no baseline (and shows an empty recap for its first season).
 */
export interface RpgBaseline {
  season: number;
  /** Level per player id of the managed club. */
  levels: Record<string, number>;
  /** Signature level per `playerId|signatureId`. */
  signatures: Record<string, number>;
  /** Quirks tamed so far. */
  tamed: number;
}

export interface RpgRecap {
  levelUps: { playerId: string; name: string; from: number; to: number }[];
  evolutions: { playerId: string; name: string; signature: [string, string]; level: number }[];
  /** The three strongest signatures of the squad by stage and power. */
  bestSignatures: { playerId: string; name: string; signature: [string, string]; level: number; power: number }[];
  tamed: number;
  /** Total levels gained and the player who gained the most. */
  levelsGained: number;
  topClimber: { playerId: string; name: string; levels: number } | null;
}

export function ownPlayers(game: GameState): Player[] {
  return game.teams.find((team) => team.id === game.clubId)?.players ?? [];
}

function tamedCount(players: readonly Player[]): number {
  return players.reduce((sum, player) => sum + (player.dna?.quirks ?? []).filter((quirk) => quirk.tamed).length, 0);
}

export function takeRpgBaseline(game: GameState): RpgBaseline {
  const players = ownPlayers(game);
  const levels: Record<string, number> = {};
  const signatures: Record<string, number> = {};
  for (const player of players) {
    levels[player.id] = player.level;
    for (const signature of player.dna?.signatures ?? []) signatures[`${player.id}|${signature.id}`] = signature.level;
  }
  return { season: game.league.season, levels, signatures, tamed: tamedCount(players) };
}

export function buildRpgRecap(game: GameState): RpgRecap {
  const players = ownPlayers(game);
  const baseline = game.rpgBaseline && game.rpgBaseline.season === game.league.season ? game.rpgBaseline : null;
  const levelUps: RpgRecap['levelUps'] = [];
  const evolutions: RpgRecap['evolutions'] = [];
  const all: RpgRecap['bestSignatures'] = [];
  for (const player of players) {
    const before = baseline?.levels[player.id];
    if (before !== undefined && player.level > before) levelUps.push({ playerId: player.id, name: playerName(player), from: before, to: player.level });
    for (const signature of player.dna?.signatures ?? []) {
      const was = baseline?.signatures[`${player.id}|${signature.id}`];
      if (was !== undefined && signature.level > was) evolutions.push({ playerId: player.id, name: playerName(player), signature: signature.name, level: signature.level });
      all.push({ playerId: player.id, name: playerName(player), signature: signature.name, level: signature.level, power: Math.round(signature.power * 100) });
    }
  }
  levelUps.sort((a, b) => b.to - b.from - (a.to - a.from) || b.to - a.to || a.name.localeCompare(b.name));
  const levelsGained = levelUps.reduce((sum, entry) => sum + entry.to - entry.from, 0);
  const top = levelUps[0];
  return {
    levelUps,
    evolutions,
    bestSignatures: all.sort((a, b) => b.level - a.level || b.power - a.power || a.name.localeCompare(b.name)).slice(0, 3),
    tamed: baseline ? Math.max(0, tamedCount(players) - baseline.tamed) : 0,
    levelsGained,
    topClimber: top ? { playerId: top.playerId, name: top.name, levels: top.to - top.from } : null,
  };
}

/** What the archive keeps of a recap, so the Hall of Fame can show past seasons. */
export function recapSummary(recap: RpgRecap): { levelsGained: number; evolutions: number; topClimber: string | null; bestSignature: string | null } {
  return {
    levelsGained: recap.levelsGained,
    evolutions: recap.evolutions.length,
    topClimber: recap.topClimber ? `${recap.topClimber.name} (+${recap.topClimber.levels})` : null,
    bestSignature: recap.bestSignatures[0] ? `${recap.bestSignatures[0].name}: ${recap.bestSignatures[0].signature[0]}` : null,
  };
}
