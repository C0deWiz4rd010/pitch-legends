import { Cond } from './core/rpg/conditions';
import { ensureGameDna, generateDna } from './core/rpg/player-dna';
import { generateSignatures, scaleEffect, signatureEffects, signaturePower } from './core/rpg/signatures';
import { buildStatBlock, resolveAttribute, resolveHook } from './core/rpg/stat-block';
import { createPracticeTeams } from './core/football/practice';
import { ArcadeActor, MATCH_TICK } from './core/football/match-types';
import { ArcadeMatch } from './core/services/arcade-match';
import { createNewGame } from './data/generators';
import { ARCHETYPES_BY_GROUP } from './data/talents';
import { Rarity } from './data/rarity';
import { SIGNATURES, getSignature, signaturesFor } from './data/signatures';
import { MatchConfig } from './models/match.model';
import { Player, PlayerArchetype, SignatureState } from './models/player.model';

const ALL_ARCHETYPES = Object.values(ARCHETYPES_BY_GROUP).flat() as PlayerArchetype[];

function config(controlledTeamId: string, extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'instant', controllerMode: 'auto', controlledTeamId, halfMinutes: 3, seed: 5150, difficulty: 'normal', assist: 'balanced',
    playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, ...extra,
  };
}

function withSignature(id: string, power = 1): SignatureState {
  const definition = getSignature(id)!;
  return { id, name: definition.variants[0], power, level: 1, path: null };
}

interface Internals {
  actorFlags(actor: ArcadeActor, shared: number, owner: ArcadeActor | undefined): number;
  updateSignatures(actor: ArcadeActor, base: number): number;
  fireSignature(event: string, target: ArcadeActor | null, side: 'home' | 'away' | null): void;
}

describe('Signature abilities', () => {
  it('has a passive and a triggered signature for every archetype', () => {
    for (const archetype of ALL_ARCHETYPES) {
      const options = signaturesFor(archetype);
      expect(options.some((definition) => definition.minRarity === 'common'), archetype).toBe(true);
      expect(options.some((definition) => definition.minRarity === 'rare'), archetype).toBe(true);
    }
    expect(SIGNATURES.length).toBeGreaterThanOrEqual(22);
    expect(new Set(SIGNATURES.map((definition) => definition.id)).size).toBe(SIGNATURES.length);
  });

  it('binds every effect to the signature flag and gives every definition names to vary', () => {
    for (const definition of SIGNATURES) {
      expect(definition.variants.length, definition.id).toBeGreaterThanOrEqual(3);
      expect(definition.effects.length, definition.id).toBeGreaterThan(0);
      for (const effect of definition.effects) expect((effect.when ?? 0) & Cond.signature, definition.id).toBeTruthy();
    }
  });

  it('hands out signatures by rarity: passive, triggered, or both', () => {
    const count = (rarity: Rarity) => generateSignatures({ id: 'ply-count', archetype: 'finisher' }, rarity);
    expect(count('common').map((signature) => signature.id)).toEqual(['cold-blood']);
    expect(count('rare').map((signature) => signature.id)).toEqual(['poacher']);
    expect(count('epic').map((signature) => signature.id)).toEqual(['poacher']);
    expect(count('legendary').map((signature) => signature.id)).toEqual(['cold-blood', 'poacher']);
    expect(count('mythic')).toHaveLength(2);
    expect(count('mythic')).toEqual(count('mythic'));
    expect(signaturePower('mythic')).toBeGreaterThan(signaturePower('common'));
  });

  it('gives players of one archetype different names and slightly different power', () => {
    const names = new Set<string>();
    const powers = new Set<number>();
    for (let index = 0; index < 60; index++) {
      const [signature] = generateSignatures({ id: `ply-${index}`, archetype: 'speedster' }, 'rare');
      names.add(signature.name[0]);
      powers.add(signature.power);
    }
    expect(names.size).toBe(3);
    expect(powers.size).toBeGreaterThan(20);
  });

  it('scales effects around their neutral point and maps them to the slot flag', () => {
    expect(scaleEffect({ hook: 'passing', op: 'add', value: 6 }, 1.2).value).toBeCloseTo(7.2, 5);
    expect(scaleEffect({ hook: 'shotError', op: 'mul', value: 0.7 }, 1.2).value).toBeCloseTo(0.64, 5);
    const first = signatureEffects(withSignature('cold-blood'), 0);
    const second = signatureEffects(withSignature('cold-blood'), 1);
    expect(first[0].when! & Cond.signature).toBeTruthy();
    expect(second[0].when! & Cond.signature2).toBeTruthy();
    expect(second[0].when! & Cond.signature).toBeFalsy();
  });

  it('lets a signature act only while it is awake', () => {
    const { home } = createPracticeTeams(3);
    const player = structuredClone(home.players.find((candidate) => candidate.archetype === 'finisher') ?? home.players[10]) as Player;
    player.traitIds = [];
    player.dna = { version: 2, rarity: 'common', nickname: null, signatures: [withSignature('cold-blood')] };
    const block = buildStatBlock(player);
    expect(resolveHook(block, 'shotError', 1, 0)).toBe(1);
    const awake = resolveHook(block, 'shotError', 1, Cond.signature);
    expect(awake).toBeLessThan(1);
    expect(awake).toBeGreaterThan(0.65);
    expect(resolveAttribute(block, 'shooting', Cond.signature)).toBeGreaterThan(resolveAttribute(block, 'shooting', 0));
  });

  describe('in the match engine', () => {
    function setup(signatureId: string, power = 1) {
      const { home, away } = createPracticeTeams(17);
      const target = home.players.find((candidate) => candidate.positionGroup === 'ATT')!;
      target.traitIds = [];
      target.dna = { version: 2, rarity: 'rare', nickname: null, signatures: [withSignature(signatureId, power)] };
      const match = new ArcadeMatch(home, away, config(home.id, { mode: 'play' }));
      const actor = match.actors.find((candidate) => candidate.player.id === target.id)!;
      return { match, actor, internals: match as unknown as Internals };
    }

    it('wakes a condition signature when its situation arises, then lets it rest', () => {
      const { actor, internals } = setup('cold-blood');
      actor.x = 100; actor.y = 34;
      const calm = internals.actorFlags(actor, Cond.home | Cond.level, undefined);
      expect(internals.updateSignatures(actor, calm) & Cond.signature).toBeFalsy();
      const late = internals.actorFlags(actor, Cond.home | Cond.level | Cond.late, undefined);
      expect(late & Cond.inOppBox).toBeTruthy();
      expect(internals.updateSignatures(actor, late) & Cond.signature).toBeTruthy();
      expect(internals.updateSignatures(actor, calm) & Cond.signature).toBeFalsy();
    });

    it('wakes an event signature for its duration and honours the cooldown', () => {
      const { match, actor, internals } = setup('comet');
      internals.fireSignature('ballWon', actor, null);
      const flags = () => internals.updateSignatures(actor, 0) & Cond.signature;
      expect(flags()).toBeTruthy();
      for (let tick = 0; tick < 60 * 3 + 2; tick++) match.step(MATCH_TICK);
      expect(flags()).toBeFalsy();
      internals.fireSignature('ballWon', actor, null);
      expect(flags()).toBeFalsy();
      for (let tick = 0; tick < 60 * 12; tick++) match.step(MATCH_TICK);
      internals.fireSignature('ballWon', actor, null);
      expect(flags()).toBeTruthy();
      expect(match.events.some((event) => event.messageKey === 'match.signature' && event.playerId === actor.player.id)).toBe(true);
    });

    it('honours the extra condition of an event trigger', () => {
      const { actor, internals } = setup('poacher');
      actor.x = 40; actor.y = 34;
      actor.flags = internals.actorFlags(actor, 0, undefined);
      internals.fireSignature('passReceived', actor, null);
      expect(internals.updateSignatures(actor, 0) & Cond.signature).toBeFalsy();
      actor.x = 100;
      actor.flags = internals.actorFlags(actor, 0, undefined);
      internals.fireSignature('passReceived', actor, null);
      expect(internals.updateSignatures(actor, 0) & Cond.signature).toBeTruthy();
    });

    it('refills stamina once per match', () => {
      const { actor, internals } = setup('second-wind');
      actor.stamina = 20;
      const flags = Cond.lowStamina | Cond.late;
      internals.updateSignatures(actor, flags);
      expect(actor.stamina).toBe(45);
      internals.updateSignatures(actor, 0);
      actor.sig![0].readyAt = 0;
      actor.stamina = 20;
      internals.updateSignatures(actor, flags);
      expect(actor.stamina).toBe(20);
    });

    it('reports activations, shots and goals of a whole simulated match', () => {
      const { home, away } = createPracticeTeams(29);
      for (const team of [home, away]) team.players.forEach((player) => { player.dna = generateDna(player, { usePotential: false }); });
      const result = new ArcadeMatch(home, away, config(home.id, { seed: 31 })).result();
      expect(result.signatures?.length ?? 0).toBeGreaterThan(0);
      for (const entry of result.signatures!) {
        expect(entry.activations).toBeGreaterThan(0);
        expect(entry.goals).toBeLessThanOrEqual(entry.shots + 1);
      }
      const again = new ArcadeMatch(home, away, config(home.id, { seed: 31 })).result();
      expect({ ...again, id: undefined }).toEqual({ ...result, id: undefined });
    }, 60_000);

    it('ignores signatures when effects are switched off', () => {
      const { home, away } = createPracticeTeams(29);
      for (const team of [home, away]) team.players.forEach((player) => { player.dna = generateDna(player, { usePotential: false }); });
      const result = new ArcadeMatch(home, away, config(home.id, { seed: 31, effects: false })).result();
      expect(result.signatures).toBeUndefined();
    }, 60_000);
  });

  it('adds signatures to DNA that predates them without touching rarity or nickname', () => {
    const game = createNewGame({ managerName: 'Sig', clubName: 'Sig FC', seed: 41 });
    const players = game.teams.flatMap((team) => team.players);
    const before = new Map(players.map((player) => [player.id, { rarity: player.dna!.rarity, nickname: player.dna!.nickname }]));
    for (const player of players) player.dna = { version: 1, rarity: player.dna!.rarity, nickname: player.dna!.nickname };
    ensureGameDna(game);
    for (const player of players) {
      expect(player.dna!.signatures!.length).toBeGreaterThan(0);
      expect({ rarity: player.dna!.rarity, nickname: player.dna!.nickname }).toEqual(before.get(player.id));
    }
  });
});
