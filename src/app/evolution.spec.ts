import { Cond } from './core/rpg/conditions';
import { applySignatureProgress, ascendPlayers, evolveSignature, signatureQuest, signatureTitle } from './core/rpg/evolution';
import { createRuntimes, signatureEffects } from './core/rpg/signatures';
import { chronicleLine } from './core/rpg/story';
import { createNewGame } from './data/generators';
import { EVOLUTION_STAGES, PATH_NAMES, impactPoints } from './data/evolutions';
import { Rarity } from './data/rarity';
import { getSignature } from './data/signatures';
import { GameState } from './models/game.model';
import { MatchResult } from './models/match.model';
import { Player, PlayerArchetype, SignatureState } from './models/player.model';

const AT = { season: 1, week: 5 };

function signatureOf(id: string, extra: Partial<SignatureState> = {}): SignatureState {
  return { id, name: getSignature(id)!.variants[0], power: 1, level: 1, path: null, progress: { activations: 0, shots: 0, goals: 0 }, ...extra };
}

function evolver(id = 'comet', rarity: Rarity = 'rare', extra: Partial<Player> = {}): Player {
  const game = createNewGame({ managerName: 'E', clubName: 'E FC', seed: 91 });
  const player = structuredClone(game.teams[0].players[3]) as Player;
  player.archetype = 'speedster' as PlayerArchetype;
  player.level = 20;
  player.dna = { version: 3, rarity, nickname: null, signatures: [signatureOf(id)], quirks: [], chronicle: [] };
  return Object.assign(player, extra);
}

describe('Signature evolution', () => {
  it('counts activations, shots and triple-weighted goals', () => {
    expect(impactPoints({ activations: 5, shots: 4, goals: 2 })).toBe(15);
    expect(EVOLUTION_STAGES.map((stage) => stage.to)).toEqual([2, 3]);
  });

  it('shows the quest and becomes ready only when points, level and rarity are met', () => {
    const player = evolver('comet', 'rare', { level: 9 });
    const state = player.dna!.signatures![0];
    let quest = signatureQuest(player, state);
    expect(quest).toMatchObject({ points: 0, target: 40, pointsOk: false, levelOk: false, rarityOk: true, ready: false });
    state.progress = { activations: 20, shots: 15, goals: 2 };
    expect(signatureQuest(player, state).ready).toBe(false);
    player.level = 10;
    quest = signatureQuest(player, state);
    expect(quest.points).toBe(41);
    expect(quest.ready).toBe(true);
  });

  it('requires a branch for stage II, keeps it for stage III and refuses a changed branch', () => {
    const player = evolver();
    const state = player.dna!.signatures![0];
    state.progress = { activations: 100, shots: 100, goals: 50 };
    expect(evolveSignature(player, 'nope', 'a', AT)).toEqual({ ok: false, error: 'unknown-signature' });
    expect(evolveSignature(player, 'comet', null, AT)).toEqual({ ok: false, error: 'path-required' });
    expect(state.level).toBe(1);
    expect(evolveSignature(player, 'comet', 'b', AT)).toEqual({ ok: true });
    expect(state).toMatchObject({ level: 2, path: 'b' });
    expect(evolveSignature(player, 'comet', 'a', AT)).toEqual({ ok: false, error: 'path-not-allowed' });
    expect(evolveSignature(player, 'comet', null, AT)).toEqual({ ok: true });
    expect(state.level).toBe(3);
    expect(evolveSignature(player, 'comet', null, AT)).toEqual({ ok: false, error: 'not-ready' });
    expect(signatureQuest(player, state).stage).toBeNull();
    expect(player.dna!.chronicle!.map((entry) => entry.kind)).toEqual(['signature', 'signature']);
    expect(chronicleLine(player.dna!.chronicle![1], 'de')).toContain('Stufe 3');
  });

  it('keeps stage III for Rare and better', () => {
    const player = evolver('burst-lane', 'common');
    const state = player.dna!.signatures![0];
    state.progress = { activations: 500, shots: 0, goals: 0 };
    expect(evolveSignature(player, 'burst-lane', 'a', AT).ok).toBe(true);
    expect(signatureQuest(player, state)).toMatchObject({ pointsOk: true, levelOk: true, rarityOk: false, ready: false });
    expect(evolveSignature(player, 'burst-lane', null, AT)).toEqual({ ok: false, error: 'not-ready' });
  });

  it('strengthens the effects with every stage and branch A, and lengthens branch B', () => {
    const strength = (state: SignatureState) => signatureEffects(state, 0).find((effect) => effect.hook === 'acceleration')!.value;
    const base = strength(signatureOf('comet'));
    expect(strength(signatureOf('comet', { level: 2 }))).toBeGreaterThan(base);
    expect(strength(signatureOf('comet', { level: 3 }))).toBeGreaterThan(strength(signatureOf('comet', { level: 2 })));
    expect(strength(signatureOf('comet', { level: 2, path: 'a' }))).toBeGreaterThan(strength(signatureOf('comet', { level: 2 })));
    expect(strength(signatureOf('comet', { level: 2, path: 'b' }))).toBeCloseTo(strength(signatureOf('comet', { level: 2 })), 5);
    const plain = createRuntimes({ version: 3, rarity: 'rare', nickname: null, signatures: [signatureOf('comet')] })[0];
    const branch = createRuntimes({ version: 3, rarity: 'rare', nickname: null, signatures: [signatureOf('comet', { level: 2, path: 'b' })] })[0];
    expect(branch.seconds).toBeCloseTo(plain.seconds * 1.5, 5);
    expect(branch.cooldown).toBeCloseTo(plain.cooldown * 0.7, 5);
    const condition = (state: SignatureState) => signatureEffects(state, 0).find((effect) => effect.hook === 'pace')!.value;
    expect(condition(signatureOf('burst-lane', { level: 2, path: 'b' }))).toBeGreaterThan(condition(signatureOf('burst-lane', { level: 2 })));
    expect(signatureEffects(signatureOf('comet', { level: 2 }), 0)[0].when! & Cond.signature).toBeTruthy();
  });

  it('names the branch after the archetype', () => {
    const state = signatureOf('comet', { level: 2, path: 'a' });
    expect(signatureTitle(state, 'speedster', 'de')).toBe(PATH_NAMES.speedster.a[0]);
    expect(signatureTitle(signatureOf('comet'), 'speedster', 'en')).toBe(state.name[1]);
  });

  it('adds the signature lines of a match to the career tallies', () => {
    const player = evolver();
    const team = { players: [player] } as never;
    const result = { signatures: [{ playerId: player.id, playerName: 'X', side: 'home', signatureId: 'comet', name: ['a', 'b'], activations: 3, shots: 2, xG: 0.4, goals: 1 }] } as MatchResult;
    applySignatureProgress(team, result);
    applySignatureProgress(team, result);
    expect(player.dna!.signatures![0].progress).toEqual({ activations: 6, shots: 4, goals: 2 });
  });
});

describe('Rarity ascension', () => {
  function world(): { game: GameState; players: Player[] } {
    const game = createNewGame({ managerName: 'E', clubName: 'E FC', seed: 92 });
    const players = game.teams.flatMap((team) => team.players);
    for (const player of players) {
      player.dna = { version: 3, rarity: 'common', nickname: null, signatures: [], quirks: [], chronicle: [] };
      player.seasonStats.goals = 0;
      player.seasonStats.motmAwards = 0;
      player.seasonStats.appearances = 5;
      player.career = undefined;
    }
    return { game, players };
  }

  it('lifts the top scorer one tier, once, keeping signature levels and adding the new one', () => {
    const { game, players } = world();
    const scorer = players.find((player) => player.archetype === 'finisher') ?? players[0];
    scorer.archetype = 'finisher';
    scorer.seasonStats.goals = 14;
    scorer.dna!.signatures = [signatureOf('cold-blood', { level: 2, path: 'a' })];
    const changes = ascendPlayers(game);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: 'common', to: 'rare' });
    expect(changes[0].reason.id).toBe('top-scorer');
    expect(scorer.dna).toMatchObject({ rarity: 'rare', ascended: true });
    expect(scorer.dna!.signatures!.find((signature) => signature.id === 'cold-blood')).toMatchObject({ level: 2, path: 'a' });
    expect(scorer.dna!.chronicle!.at(-1)!.kind).toBe('ascension');
    expect(chronicleLine(scorer.dna!.chronicle!.at(-1)!, 'en')).toContain('Common');
    scorer.seasonStats.goals = 14;
    expect(ascendPlayers(game)).toHaveLength(0);
  });

  it('rewards five MVP awards and 100 appearances, needs 10 goals for the scorer title', () => {
    const { game, players } = world();
    players[0].seasonStats.motmAwards = 5;
    players[1].career = { seasons: 6, appearances: 96, goals: 0, assists: 0, clubs: [] };
    players[2].seasonStats.goals = 9;
    const changes = ascendPlayers(game);
    expect(changes.map((change) => change.reason.id).sort()).toEqual(['club-legend', 'mvp-season']);
    expect(players[2].dna!.ascended).toBeUndefined();
  });

  it('gives a nickname when a player reaches Epic and never goes beyond Legendary', () => {
    const { game, players } = world();
    const rare = players[0];
    rare.dna!.rarity = 'rare';
    rare.seasonStats.motmAwards = 6;
    const legend = players[1];
    legend.dna!.rarity = 'legendary';
    legend.seasonStats.motmAwards = 6;
    ascendPlayers(game);
    expect(rare.dna).toMatchObject({ rarity: 'epic' });
    expect(rare.dna!.nickname).not.toBeNull();
    expect(legend.dna!.rarity).toBe('legendary');
    expect(legend.dna!.ascended).toBeUndefined();
  });
});
