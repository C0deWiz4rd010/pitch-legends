import { TestBed } from '@angular/core/testing';
import { SaveService } from './core/services/save.service';
import { AudioService } from './core/services/audio.service';
import { GameStateService } from './core/services/game-state.service';
import { PersistentStore } from './core/storage/persistent-store';
import { createCard, TIER_ORDER, TIER_RARITY } from './core/legends/cards';
import { ensureCardDna } from './core/services/legends.service';
import { dnaOf, raritySpark } from './core/rpg/player-dna';
import { estimateTraining } from './core/rpg/training-rules';
import { marketValueFor, rarityValueFactor } from './core/ratings';
import { createNewGame } from './data/generators';
import { SAVE_VERSION, GameState } from './models/game.model';
import { LegendsState } from './models/legends.model';
import { Player } from './models/player.model';
import { RarityGemComponent } from './shared/components/rarity-gem.component';

function legacySave(version: 5 | 6): string {
  const game = createNewGame({ managerName: 'Old', clubName: 'Old FC', seed: 777 });
  for (const player of game.teams.flatMap((team) => team.players)) { delete player.dna; delete player.training; }
  game.version = version as never;
  delete (game.trainingWeek as { eventChoice?: unknown }).eventChoice;
  return JSON.stringify(game);
}

describe('Save version 7', () => {
  beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({}); });

  it('is the current version and still reads versions 5 and 6', () => {
    expect(SAVE_VERSION).toBe(7);
    const service = TestBed.inject(SaveService);
    expect(service.parseImport(legacySave(6)).version).toBe(7);
    expect(service.parseImport(legacySave(5)).version).toBe(7);
  });

  it('gives every player DNA and the managed club an estimated training state', () => {
    const service = TestBed.inject(SaveService);
    const game = service.parseImport(legacySave(6));
    const players = game.teams.flatMap((team) => team.players);
    expect(players.every((player) => !!player.dna?.signatures?.length && !!player.dna.quirks?.length)).toBe(true);
    const own = game.teams.find((team) => team.id === game.clubId)!;
    for (const player of own.players) {
      expect(player.training).toBeDefined();
      for (const value of Object.values(player.training!.mastery)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(60);
      }
    }
    expect(game.teams.filter((team) => team.id !== game.clubId).every((team) => team.players.every((player) => !player.training))).toBe(true);
    expect(game.trainingWeek.eventChoice).toBeNull();
  });

  it('is idempotent and never overwrites what exists', () => {
    const service = TestBed.inject(SaveService);
    const once = service.parseImport(legacySave(6));
    const twice = service.parseImport(JSON.stringify(once));
    expect(twice.teams.flatMap((team) => team.players.map((player) => player.dna))).toEqual(once.teams.flatMap((team) => team.players.map((player) => player.dna)));
    const own = twice.teams.find((team) => team.id === twice.clubId)!.players[0];
    own.training!.mastery.pace = 77;
    own.dna!.chronicle = [{ season: 1, week: 1, kind: 'debut' }];
    const third = service.parseImport(JSON.stringify(twice));
    const same = third.teams.find((team) => team.id === third.clubId)!.players[0];
    expect(same.training!.mastery.pace).toBe(77);
    expect(same.dna!.chronicle).toHaveLength(1);
  });

  it('estimates mastery from level and attribute without handing out traits', () => {
    const game = createNewGame({ managerName: 'E', clubName: 'E FC', seed: 12 });
    const player = structuredClone(game.teams[0].players.find((candidate) => candidate.positionGroup === 'ATT')!) as Player;
    player.level = 30;
    player.attributes.shooting = 99;
    const training = estimateTraining(player);
    expect(training.mastery.shooting).toBe(60);
    expect(Object.keys(training.mastery).sort()).toEqual(['dribbling', 'pace', 'shooting']);
    player.level = 1;
    player.attributes.shooting = 40;
    expect(estimateTraining(player).mastery.shooting).toBe(2);
  });
});

describe('Legends cards and rarity', () => {
  it('lets the card tier decide the rarity, signatures and nickname of the player', () => {
    for (const tier of TIER_ORDER) {
      const card = createCard(2026, 1, tier, { index: 3 });
      expect(dnaOf(card.player).rarity).toBe(TIER_RARITY[tier]);
      expect(card.player.dna!.signatures!.length).toBeGreaterThan(0);
      expect(!!card.player.dna!.nickname).toBe(tier === 'gold' || tier === 'legend');
    }
    expect(createCard(2026, 1, 'gold', { index: 3 }).player.dna).toEqual(createCard(2026, 9, 'gold', { index: 3 }).player.dna);
  });

  it('repairs stored cards without DNA once', () => {
    const card = createCard(2026, 1, 'silver', { index: 4 });
    const expected = structuredClone(card.player.dna);
    delete card.player.dna;
    const state = { cards: [card] } as unknown as LegendsState;
    ensureCardDna(state);
    expect(card.player.dna).toEqual(expected);
    ensureCardDna(state);
    expect(card.player.dna).toEqual(expected);
  });
});

describe('Market value and rarity', () => {
  it('raises the value with rarity and evolved signatures, never beyond +35 %', () => {
    expect(rarityValueFactor(undefined)).toBe(1);
    expect(rarityValueFactor({ rarity: 'common' })).toBe(1);
    const base = marketValueFor(70, 24, 78);
    const legendary = marketValueFor(70, 24, 78, { rarity: 'legendary', signatures: [] });
    expect(legendary).toBeGreaterThan(base * 1.15);
    const maxed = rarityValueFactor({ rarity: 'mythic', signatures: [{ id: 'a', name: ['a', 'a'], power: 1, level: 3, path: 'a' }, { id: 'b', name: ['b', 'b'], power: 1, level: 3, path: 'b' }] });
    expect(maxed).toBe(1.35);
    expect(rarityValueFactor({ rarity: 'epic', signatures: [{ id: 'a', name: ['a', 'a'], power: 1, level: 2, path: 'a' }] })).toBeCloseTo(1.14, 5);
  });

  it('prices generated players with their rarity', () => {
    const game = createNewGame({ managerName: 'V', clubName: 'V FC', seed: 33 });
    for (const player of game.teams.flatMap((team) => team.players)) {
      expect(player.marketValue).toBe(marketValueFor(player.overall, player.age, player.potential, player.dna));
    }
  });
});

describe('Academy spark', () => {
  it('hints at rare and epic talents without naming the rarity', () => {
    const game = createNewGame({ managerName: 'S', clubName: 'S FC', seed: 44 });
    const player = game.teams[0].players[0];
    for (const [rarity, spark] of [['common', 'none'], ['rare', 'faint'], ['epic', 'bright'], ['legendary', 'bright'], ['mythic', 'bright']] as const) {
      player.dna = { ...player.dna!, rarity };
      expect(raritySpark(player)).toBe(spark);
    }
  });

  it('shows a spark only where it is asked for and keeps the question mark otherwise', () => {
    TestBed.configureTestingModule({});
    const gs = TestBed.inject(GameStateService);
    const game: GameState = createNewGame({ managerName: 'S', clubName: 'S FC', seed: 45 });
    gs.importState(game);
    const prospect = structuredClone(game.teams.find((team) => team.id !== game.clubId)!.players[0]) as Player;
    prospect.id = 'ply-prospect-spark';
    prospect.dna = { ...prospect.dna!, rarity: 'epic' };
    game.academy.prospects = [prospect];
    gs.importState(game);
    const render = (spark: boolean) => {
      const fixture = TestBed.createComponent(RarityGemComponent);
      fixture.componentRef.setInput('player', prospect);
      fixture.componentRef.setInput('spark', spark);
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).querySelector('.gem')!;
    };
    expect(render(true).getAttribute('data-rarity')).toBe('spark-bright');
    expect(render(false).getAttribute('data-rarity')).toBe('unknown');
  });
});

describe('Volume preferences', () => {
  beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({}); });

  it('keeps the slider out of the career state', () => {
    const gs = TestBed.inject(GameStateService);
    gs.importState(createNewGame({ managerName: 'A', clubName: 'A FC', seed: 55 }));
    const audio = TestBed.inject(AudioService);
    const store = TestBed.inject(PersistentStore);
    const before = gs.game()!.settings.musicVolume;
    const mutate = vi.spyOn(gs, 'mutate');
    audio.setVolume('musicVolume', 0.2);
    audio.setVolume('crowdVolume', 5);
    expect(mutate).not.toHaveBeenCalled();
    expect(audio.settings().musicVolume).toBe(0.2);
    expect(audio.settings().crowdVolume).toBe(1);
    expect(gs.game()!.settings.musicVolume).toBe(before);
    expect(JSON.parse(store.get('pitch-legends:audio-volumes:v1')!)).toEqual({ musicVolume: 0.2, crowdVolume: 1 });
  });
});
