import { TestBed } from '@angular/core/testing';
import { Cond, condMatches } from './core/rpg/conditions';
import { ensureGameDna, generateDna } from './core/rpg/player-dna';
import { INHERIT_CHANCE, REVEAL_EVERY, evolveQuirks, generateQuirks, inheritQuirk, revealByAppearances, revealNext } from './core/rpg/quirks';
import { buildStatBlock, resolveAttribute, resolveHook } from './core/rpg/stat-block';
import { CHRONICLE_LIMIT, addChronicle, buildBio, chronicleLine, recordMatchStory } from './core/rpg/story';
import { createPracticeTeams } from './core/football/practice';
import { ArcadeMatch } from './core/services/arcade-match';
import { TrainingService } from './core/services/training.service';
import { deliverScoutReports } from './core/career/scouting';
import { createNewGame } from './data/generators';
import { QUIRKS, getQuirk } from './data/quirks';
import { RARITIES, RARITY_DEFS } from './data/rarity';
import { CHRONICLE_TEXT } from './data/story';
import { MatchConfig, MatchResult } from './models/match.model';
import { Player } from './models/player.model';

function playerWith(quirkIds: string[], extra: Partial<Player> = {}): Player {
  const { home } = createPracticeTeams(5);
  const player = structuredClone(home.players[8]) as Player;
  player.traitIds = [];
  player.talentRanks = {};
  player.morale = 65;
  player.form = 0;
  player.dna = { version: 3, rarity: 'epic', nickname: null, signatures: [], quirks: quirkIds.map((id) => ({ id, revealed: false })), chronicle: [] };
  return Object.assign(player, extra);
}

function config(controlledTeamId: string, extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'play', controllerMode: 'auto', controlledTeamId, halfMinutes: 3, seed: 616, difficulty: 'normal', assist: 'balanced',
    playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, ...extra,
  };
}

describe('Quirks', () => {
  it('has a coherent catalogue with a plus and a minus each', () => {
    expect(QUIRKS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(QUIRKS.map((quirk) => quirk.id)).size).toBe(QUIRKS.length);
    for (const quirk of QUIRKS) {
      expect(quirk.effects.length, quirk.id).toBeGreaterThan(1);
      expect(quirk.plus[0].length, quirk.id).toBeGreaterThan(5);
      expect(quirk.minus[1].length, quirk.id).toBeGreaterThan(5);
      if (quirk.evolve) {
        const target = getQuirk(quirk.evolve.to);
        expect(target, quirk.id).toBeDefined();
        expect(target!.rollable, quirk.evolve.to).toBe(false);
      }
    }
  });

  it('writes a drawback as "otherwise" with unless and ignores unknown flags', () => {
    expect(condMatches(Cond.home, undefined, Cond.derby)).toBe(true);
    expect(condMatches(Cond.home | Cond.derby, undefined, Cond.derby)).toBe(false);
    expect(condMatches(Cond.home, Cond.home, Cond.away)).toBe(true);
  });

  it('rolls one to three hidden quirks by rarity, deterministically and without evolution results', () => {
    for (const rarity of RARITIES) {
      const [min, max] = RARITY_DEFS[rarity].quirkSlots;
      for (let index = 0; index < 120; index++) {
        const quirks = generateQuirks({ id: `q-${rarity}-${index}` }, rarity);
        expect(quirks.length).toBeGreaterThanOrEqual(min);
        expect(quirks.length).toBeLessThanOrEqual(max);
        expect(new Set(quirks.map((quirk) => quirk.id)).size).toBe(quirks.length);
        for (const quirk of quirks) {
          expect(quirk.revealed).toBe(false);
          expect(getQuirk(quirk.id)!.rollable).not.toBe(false);
        }
      }
    }
    expect(generateQuirks({ id: 'same' }, 'epic')).toEqual(generateQuirks({ id: 'same' }, 'epic'));
  });

  it('acts through the effect pipeline from the first match, revealed or not', () => {
    const derby = buildStatBlock(playerWith(['derby-hero']));
    const calm = resolveAttribute(derby, 'shooting', 0);
    expect(resolveAttribute(derby, 'shooting', Cond.derby)).toBeCloseTo(calm + 5, 5);
    expect(resolveAttribute(derby, 'pace', 0)).toBeLessThan(resolveAttribute(derby, 'pace', Cond.derby));
    const rain = buildStatBlock(playerWith(['rain-man']));
    expect(resolveAttribute(rain, 'dribbling', Cond.rain)).toBeGreaterThan(resolveAttribute(rain, 'dribbling', Cond.clear));
    const home = buildStatBlock(playerWith(['home-kid']));
    expect(resolveAttribute(home, 'passing', Cond.home)).toBeGreaterThan(resolveAttribute(home, 'passing', Cond.away));
    const rubber = buildStatBlock(playerWith(['rubber-band']));
    const glass = buildStatBlock(playerWith(['glass-bones']));
    expect(resolveHook(rubber, 'injuryRisk', 1, 0)).toBeLessThan(1);
    expect(resolveHook(glass, 'injuryRisk', 1, 0)).toBeGreaterThan(1);
  });

  it('reveals one hidden quirk after every three appearances and never more than the player has', () => {
    const player = playerWith(['derby-hero', 'rain-man', 'iron-lungs']);
    player.seasonStats.appearances = 2;
    expect(revealByAppearances(player)).toHaveLength(0);
    player.seasonStats.appearances = REVEAL_EVERY;
    expect(revealByAppearances(player).map((quirk) => quirk.id)).toEqual(['derby-hero']);
    expect(revealByAppearances(player)).toHaveLength(0);
    player.seasonStats.appearances = 100;
    expect(revealByAppearances(player)).toHaveLength(2);
    expect(player.dna!.quirks!.every((quirk) => quirk.revealed)).toBe(true);
    expect(revealNext(player)).toBeNull();
  });

  it('evolves a revealed quirk at its milestone and keeps it hidden until then', () => {
    const player = playerWith(['nervous']);
    player.seasonStats.motmAwards = 6;
    expect(evolveQuirks(player)).toEqual([]);
    player.dna!.quirks![0].revealed = true;
    expect(evolveQuirks(player)).toEqual([{ from: 'nervous', to: 'ice-heart' }]);
    expect(player.dna!.quirks![0]).toEqual({ id: 'ice-heart', revealed: true });
    expect(evolveQuirks(player)).toEqual([]);
    const late = playerWith(['late-bloomer']);
    late.dna!.quirks![0].revealed = true;
    late.career = { seasons: 2, appearances: 30, goals: 0, assists: 0, clubs: [] };
    late.seasonStats.appearances = 10;
    expect(evolveQuirks(late)[0].to).toBe('veteran-calm');
  });

  it('lets a mentor pass inheritable quirks on without exceeding the slots', () => {
    const senior = playerWith(['derby-hero', 'rain-man', 'hothead']);
    for (const quirk of senior.dna!.quirks!) quirk.revealed = true;
    let inherited = 0;
    for (let index = 0; index < 400; index++) {
      const junior = playerWith([]);
      junior.dna!.rarity = 'common';
      const id = inheritQuirk([senior], junior, `seed-${index}`);
      if (id) {
        inherited++;
        expect(getQuirk(id)!.inheritable).toBe(true);
        expect(junior.dna!.quirks).toEqual([{ id, revealed: false }]);
        expect(inheritQuirk([senior], junior, `again-${index}`)).toBeNull();
      }
    }
    expect(inherited).toBeGreaterThan(400 * INHERIT_CHANCE * 0.5);
    expect(inherited).toBeLessThan(400 * INHERIT_CHANCE * 1.7);
    const hiddenSenior = playerWith(['derby-hero']);
    expect(inheritQuirk([hiddenSenior], playerWith([]), 'x'.repeat(3))).toBeNull();
  });

  it('migrates DNA without quirks and keeps rarity and signatures', () => {
    const game = createNewGame({ managerName: 'Q', clubName: 'Q FC', seed: 71 });
    const players = game.teams.flatMap((team) => team.players);
    const before = new Map(players.map((player) => [player.id, { rarity: player.dna!.rarity, signatures: player.dna!.signatures }]));
    for (const player of players) player.dna = { version: 2, rarity: player.dna!.rarity, nickname: player.dna!.nickname, signatures: player.dna!.signatures };
    ensureGameDna(game);
    for (const player of players) {
      expect(player.dna!.quirks!.length).toBeGreaterThan(0);
      expect(player.dna!.version).toBe(3);
      expect({ rarity: player.dna!.rarity, signatures: player.dna!.signatures }).toEqual(before.get(player.id));
    }
  });

  it('reveals the first quirk with a scouting report', () => {
    const game = createNewGame({ managerName: 'Q', clubName: 'Q FC', seed: 72 });
    const foreign = game.teams.find((team) => team.id !== game.clubId)!.players.slice(0, 3);
    deliverScoutReports(game, foreign, 3);
    for (const player of foreign) expect(player.dna!.quirks![0].revealed).toBe(true);
  });

  describe('in the match engine', () => {
    it('raises the derby, big-match, night and clear-weather situations', () => {
      const { home, away } = createPracticeTeams(9);
      home.visuals.stadium.atmosphere = 'night';
      const match = new ArcadeMatch(home, away, config(home.id, { derby: true, bigMatch: true }));
      const internals = match as unknown as { sideFlagsThisTick(owner: undefined, into: [number, number]): [number, number] };
      const flags = internals.sideFlagsThisTick(undefined, [0, 0])[0];
      expect(flags & Cond.derby).toBeTruthy();
      expect(flags & Cond.bigMatch).toBeTruthy();
      expect(flags & Cond.night).toBeTruthy();
      expect(flags & Cond.clear).toBeTruthy();
      const rainy = new ArcadeMatch(home, away, config(home.id, { weather: 'rain' }));
      const rainFlags = (rainy as unknown as typeof internals).sideFlagsThisTick(undefined, [0, 0])[0];
      expect(rainFlags & Cond.rain).toBeTruthy();
      expect(rainFlags & Cond.clear).toBeFalsy();
      expect(rainFlags & Cond.derby).toBeFalsy();
    });
  });

  describe('in the training camp', () => {
    it('scales the injury risk of a session with the quirk', () => {
      TestBed.configureTestingModule({});
      const service = TestBed.inject(TrainingService);
      const game = createNewGame({ managerName: 'Q', clubName: 'Q FC', seed: 73 });
      const club = game.teams.find((team) => team.id === game.clubId)!;
      const [first, second] = club.players.filter((player) => player.positionGroup === 'ATT');
      first.dna!.quirks = [{ id: 'glass-bones', revealed: false }];
      second.dna!.quirks = [{ id: 'rubber-band', revealed: false }];
      for (const player of [first, second]) { player.fitness = 100; player.injuryWeeks = 0; }
      const risk = (player: Player) => service.preview(game, [{ id: 'q', slot: 0, drillId: 'finishing', scope: 'individual', intensity: 'normal', targetIds: [player.id] }]).sessions[0].players[0].injuryRisk;
      expect(risk(first)).toBeGreaterThan(risk(second) * 1.8);
    });
  });
});

describe('Story: chronicle and bio', () => {
  function resultFor(player: Player, teamId: string, otherId: string, extra: Partial<MatchResult> = {}): MatchResult {
    return {
      id: 'm', week: 4, homeTeamId: teamId, awayTeamId: otherId, homeTeamName: 'A', awayTeamName: 'B', homeScore: 3, awayScore: 0, events: [],
      homeStats: {} as never, awayStats: {} as never, keyframes: [], manOfTheMatchId: null, ratings: { [player.id]: 7 },
      contributions: { [player.id]: { goals: 0, assists: 0, yellows: 0, reds: 0 } }, played: true, ...extra,
    } as MatchResult;
  }

  it('has a text for every kind in both languages', () => {
    for (const [de, en] of Object.values(CHRONICLE_TEXT)) {
      expect(de.length).toBeGreaterThan(5);
      expect(en.length).toBeGreaterThan(5);
    }
  });

  it('records debut, first goal, hat-trick, man of the match and level milestones', () => {
    const game = createNewGame({ managerName: 'S', clubName: 'S FC', seed: 81 });
    const team = game.teams.find((candidate) => candidate.id === game.clubId)!;
    const other = game.teams.find((candidate) => candidate.id !== game.clubId)!;
    const player = team.players[0];
    player.dna!.chronicle = [];
    player.level = 10;
    player.seasonStats.appearances = 1;
    player.seasonStats.goals = 3;
    const result = resultFor(player, team.id, other.id, { manOfTheMatchId: player.id, contributions: { [player.id]: { goals: 3, assists: 0, yellows: 0, reds: 0 } } });
    const beats = recordMatchStory(game, team, result);
    const kinds = player.dna!.chronicle!.map((entry) => entry.kind);
    expect(kinds).toEqual(expect.arrayContaining(['debut', 'firstGoal', 'hattrick', 'motm', 'level']));
    expect(beats.some((beat) => beat.kind === 'firstGoal')).toBe(true);
    // The same milestone is not logged twice.
    player.seasonStats.appearances = 2;
    player.seasonStats.goals = 4;
    recordMatchStory(game, team, resultFor(player, team.id, other.id, { contributions: { [player.id]: { goals: 1, assists: 0, yellows: 0, reds: 0 } } }));
    expect(player.dna!.chronicle!.filter((entry) => entry.kind === 'level')).toHaveLength(1);
    expect(player.dna!.chronicle!.filter((entry) => entry.kind === 'firstGoal')).toHaveLength(1);
  });

  it('turns revealed quirks and evolutions into story and news beats', () => {
    const game = createNewGame({ managerName: 'S', clubName: 'S FC', seed: 82 });
    const team = game.teams.find((candidate) => candidate.id === game.clubId)!;
    const other = game.teams.find((candidate) => candidate.id !== game.clubId)!;
    const player = team.players[1];
    player.dna!.chronicle = [];
    player.dna!.quirks = [{ id: 'nervous', revealed: false }];
    player.seasonStats.appearances = 3;
    const beats = recordMatchStory(game, team, resultFor(player, team.id, other.id));
    expect(beats.map((beat) => beat.kind)).toContain('quirk');
    player.seasonStats.motmAwards = 5;
    const later = recordMatchStory(game, team, resultFor(player, team.id, other.id));
    expect(later.some((beat) => beat.kind === 'evolution' && beat.quirkId === 'ice-heart')).toBe(true);
    const text = player.dna!.chronicle!.map((entry) => chronicleLine(entry, 'de')).join(' | ');
    expect(text).toContain('Nervenbündel');
    expect(text).toContain('Eisherz');
  });

  it('keeps at most 40 entries and drops the oldest', () => {
    const player = playerWith([]);
    for (let index = 0; index < CHRONICLE_LIMIT + 10; index++) addChronicle(player, { season: 1, week: index, kind: 'motm', params: { opponent: `T${index}` } });
    expect(player.dna!.chronicle).toHaveLength(CHRONICLE_LIMIT);
    expect(player.dna!.chronicle![0].week).toBe(10);
  });

  it('writes a deterministic bio with the hometown and the rarity line', () => {
    const game = createNewGame({ managerName: 'S', clubName: 'S FC', seed: 83 });
    const player = game.teams[1].players[0];
    player.dna = { ...player.dna!, rarity: 'legendary', nickname: ['Der Fels', 'The Rock'] };
    const bio = buildBio(player, game, 'de');
    expect(buildBio(player, game, 'de')).toBe(bio);
    expect(bio).toContain('„Der Fels“');
    expect(buildBio(player, game, 'en')).toContain('“The Rock”');
    expect(game.world.cities.some((city) => bio.includes(city.name))).toBe(true);
  });

  it('generates complete DNA for a new player', () => {
    const dna = generateDna({ id: 'ply-full', archetype: 'finisher', potential: 80 });
    expect(dna.quirks!.length).toBeGreaterThan(0);
    expect(dna.chronicle).toEqual([]);
    expect(dna.version).toBe(3);
  });
});
