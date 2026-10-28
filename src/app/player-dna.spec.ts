import { createNewGame } from './data/generators';
import { NICKNAMES } from './data/nicknames';
import { MYTHIC_WORLD_CAP, RARITIES, Rarity, atLeast } from './data/rarity';
import { dnaOf, enforceMythicCap, ensureGameDna, generateDna, mythicCount, rarityForRoll, rarityKnown } from './core/rpg/player-dna';
import { PlayerArchetype } from './models/player.model';

const archetype: PlayerArchetype = 'finisher';

function distribution(count: number, potential: number): Record<Rarity, number> {
  const tally = { common: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 } as Record<Rarity, number>;
  for (let index = 0; index < count; index++) tally[generateDna({ id: `ply-${index.toString(36)}-x`, archetype, potential }).rarity]++;
  return tally;
}

describe('Player DNA: rarity and nicknames', () => {
  it('rolls the documented distribution', () => {
    const tally = distribution(40_000, 65);
    const share = (rarity: Rarity) => tally[rarity] / 40_000;
    expect(share('common')).toBeGreaterThan(0.66);
    expect(share('common')).toBeLessThan(0.70);
    expect(share('rare')).toBeGreaterThan(0.205);
    expect(share('rare')).toBeLessThan(0.235);
    expect(share('epic')).toBeGreaterThan(0.065);
    expect(share('epic')).toBeLessThan(0.085);
    expect(share('legendary')).toBeGreaterThan(0.017);
    expect(share('legendary')).toBeLessThan(0.027);
    expect(share('mythic')).toBeGreaterThan(0.001);
    expect(share('mythic')).toBeLessThan(0.006);
  });

  it('lets potential improve the odds a little, never decide them', () => {
    const low = distribution(20_000, 50);
    const high = distribution(20_000, 99);
    const upper = (tally: Record<Rarity, number>) => tally.epic + tally.legendary + tally.mythic;
    expect(upper(high)).toBeGreaterThan(upper(low));
    expect(upper(high)).toBeLessThan(upper(low) * 2);
    expect(rarityForRoll(0.5, 1)).toBe('common');
    expect(rarityForRoll(0.0001)).toBe('mythic');
    expect(rarityForRoll(0.2)).toBe('rare');
  });

  it('is deterministic per player id and independent of the world', () => {
    const first = generateDna({ id: 'ply-abc', archetype, potential: 80 });
    expect(generateDna({ id: 'ply-abc', archetype, potential: 80 })).toEqual(first);
    expect(generateDna({ id: 'ply-abd', archetype, potential: 80 })).not.toBe(first);
  });

  it('gives nicknames only to epic players and better, from their archetype', () => {
    let named = 0;
    for (let index = 0; index < 4000; index++) {
      const dna = generateDna({ id: `n-${index}`, archetype, potential: 90 });
      if (atLeast(dna.rarity, 'epic')) {
        named++;
        expect(dna.nickname).not.toBeNull();
        expect(NICKNAMES[archetype]).toContainEqual(dna.nickname);
      } else expect(dna.nickname).toBeNull();
    }
    expect(named).toBeGreaterThan(100);
  });

  it('demotes mythic players beyond the world cap when asked', () => {
    let id = 0;
    let found = 0;
    while (found < 5 && id < 400_000) {
      const dna = generateDna({ id: `m-${id++}`, archetype, potential: 99 });
      if (dna.rarity === 'mythic') found++;
    }
    expect(found).toBe(5);
    expect(generateDna({ id: 'm-0', archetype, potential: 99 }, { allowMythic: false }).rarity).not.toBe('mythic');
  });

  describe('in a game', () => {
    it('assigns DNA to every player of a new world and keeps at most three mythics', () => {
      for (const seed of [11, 12, 13]) {
        const game = createNewGame({ managerName: 'Dna', clubName: 'Dna FC', seed });
        const players = game.teams.flatMap((team) => team.players);
        expect(players.every((player) => !!player.dna)).toBe(true);
        expect(mythicCount(game)).toBeLessThanOrEqual(MYTHIC_WORLD_CAP);
        expect(RARITIES).toContain(dnaOf(players[0]).rarity);
      }
    });

    it('migrates a game without DNA exactly once and never re-rolls', () => {
      const game = createNewGame({ managerName: 'Dna', clubName: 'Dna FC', seed: 21 });
      const players = game.teams.flatMap((team) => team.players);
      const before = new Map(players.map((player) => [player.id, player.dna]));
      for (const player of players) delete player.dna;
      ensureGameDna(game);
      const migrated = new Map(players.map((player) => [player.id, structuredClone(player.dna)]));
      expect(players.every((player) => !!player.dna)).toBe(true);
      ensureGameDna(game);
      for (const player of players) expect(player.dna).toEqual(migrated.get(player.id));
      // Existing DNA is never overwritten.
      const kept = players[0];
      kept.dna = { version: 1, rarity: 'legendary', nickname: null };
      ensureGameDna(game);
      expect(kept.dna.rarity).toBe('legendary');
      expect(before.size).toBe(players.length);
    });

    it('enforces the cap on a surplus of mythics', () => {
      const game = createNewGame({ managerName: 'Dna', clubName: 'Dna FC', seed: 22 });
      for (const player of game.teams.flatMap((team) => team.players)) player.dna = { version: 1, rarity: 'common', nickname: null };
      for (const player of game.teams.flatMap((team) => team.players).slice(0, 6)) player.dna = { version: 1, rarity: 'mythic', nickname: null };
      expect(mythicCount(game)).toBe(6);
      enforceMythicCap(game);
      expect(mythicCount(game)).toBe(MYTHIC_WORLD_CAP);
      expect(game.teams.flatMap((team) => team.players).filter((player) => player.dna?.rarity === 'legendary')).toHaveLength(3);
    });

    it('shows foreign rarity only after a scouting report', () => {
      const game = createNewGame({ managerName: 'Dna', clubName: 'Dna FC', seed: 23 });
      const own = game.teams.find((team) => team.id === game.clubId)!.players[0];
      const foreign = game.teams.find((team) => team.id !== game.clubId)!.players[0];
      expect(rarityKnown(game, own)).toBe(true);
      expect(rarityKnown(game, foreign)).toBe(false);
      game.transfers.reports.unshift({
        playerId: foreign.id, season: 1, createdWeek: 1, confidence: 90, overallMin: 1, overallMax: 99, potentialMin: 1, potentialMax: 99, exact: false,
      });
      expect(rarityKnown(game, foreign)).toBe(true);
    });
  });
});
