import { TestBed } from '@angular/core/testing';
import { ACHIEVEMENTS, MAX_COUNTERS, achievementProgress, unlockReached } from './core/meta/achievements';
import { applyMetaEvent } from './core/meta/meta-events';
import {
  COSMETICS, PATH_MAX_LEVEL, equipCosmetic, isCosmeticUnlocked, levelFor, pathProgress, rewardsOfLevel, wornCosmetics, xpForLevel, xpToReach,
} from './core/meta/legend-path';
import { META_STORAGE_KEY, MetaService, parseMeta } from './core/services/meta.service';
import { buildRpgRecap, recapSummary, takeRpgBaseline } from './core/career/rpg-recap';
import { buildSeasonReview, archiveEntry } from './core/career/season-review';
import { BOOT_LOOKS, setBoot, setLook } from './core/rpg/equipment';
import { buildStatBlock } from './core/rpg/stat-block';
import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import {
  ALBUM_SETS, CARD_LEVEL_XP, UPGRADE_COST, albumProgress, albumSetsComplete, awardCardXp, cardLevel, cardLevelFor, checkUpgrade, claimAlbumSet,
  draftOpponentStrength, levelBonus, suggestWeekly, upgradeCard, weeklySbc,
} from './core/legends/progression';
import { cardsToTeam } from './core/legends/squad';
import { createCard, quickSellValue, tierForOverall } from './core/legends/cards';
import { claimTask, createLegendsState, ensureTasks, sbcList, submitSbc, suggestSbc, weekKey } from './core/legends/legends-engine';
import { createNewGame } from './data/generators';
import { TRANSLATIONS } from './data/translations';
import { emptyMeta } from './models/meta.model';
import { LegendsCard, LegendsState } from './models/legends.model';
import { MatchResult } from './models/match.model';

const freshLegends = (seed = 4711): LegendsState => createLegendsState('Meta FC', seed, 1_000);

describe('Phase 9 – achievements', () => {
  it('has about seventy achievements in three groups, with unique ids and rising targets inside a ladder', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(ACHIEVEMENTS.map((def) => def.id)).size).toBe(ACHIEVEMENTS.length);
    expect(new Set(ACHIEVEMENTS.map((def) => def.group))).toEqual(new Set(['skill', 'career', 'collection']));
    for (const group of ['skill', 'career', 'collection']) expect(ACHIEVEMENTS.filter((def) => def.group === group).length).toBeGreaterThanOrEqual(20);
    const ladders = new Map<string, typeof ACHIEVEMENTS>();
    for (const def of ACHIEVEMENTS) ladders.set(def.id.replace(/-\d+$/, ''), [...(ladders.get(def.id.replace(/-\d+$/, '')) ?? []), def]);
    for (const [, steps] of ladders) {
      steps.forEach((def, index) => { expect(def.step).toBe(index + 1); if (index) { expect(def.target).toBeGreaterThan(steps[index - 1].target); expect(def.xp).toBeGreaterThan(steps[index - 1].xp); } });
    }
    for (const def of ACHIEVEMENTS) {
      expect(def.name[0] && def.name[1] && def.text[0] && def.text[1]).toBeTruthy();
      expect(def.text[0]).not.toContain('{');
      expect(def.text[1]).not.toContain('{');
    }
  });

  it('unlocks an achievement exactly once, in order, and adds its experience once', () => {
    const meta = emptyMeta();
    expect(unlockReached(meta)).toEqual([]);
    meta.counters['goals'] = 1;
    const first = unlockReached(meta);
    expect(first.map((def) => def.id)).toEqual(['goals-1']);
    expect(meta.unlocked['goals-1']).toBe(1);
    expect(meta.xp).toBe(first[0].xp);
    expect(unlockReached(meta)).toEqual([]);
    expect(meta.xp).toBe(first[0].xp);
    meta.counters['goals'] = 60;
    meta.counters['wins'] = 1;
    const more = unlockReached(meta).map((def) => def.id);
    expect(more).toEqual(['goals-2', 'wins-1']);
    expect(meta.unlocked['goals-2']).toBe(2);
    expect(meta.unlocked['wins-1']).toBe(3);
    expect(achievementProgress(meta, ACHIEVEMENTS.find((def) => def.id === 'goals-3')!)).toBeCloseTo(60 / 250, 5);
  });

  it('reads the facts of every mode and keeps records as maxima', () => {
    const meta = emptyMeta();
    const play = (goalsFor: number, goalsAgainst: number, extra = {}) => applyMetaEvent(meta, { type: 'career-match', goalsFor, goalsAgainst, derby: false, league: true, hattricks: 0, motm: false, ...extra });
    play(2, 0); play(1, 0); play(0, 2); play(5, 1, { derby: true, hattricks: 1 });
    expect(meta.counters).toMatchObject({ matches: 4, wins: 3, goals: 8, cleanSheets: 2, derbyWins: 1, bigWins: 1, hattricks: 1 });
    // The running streak is 1 after the 5:1; the record keeps the 2 from the first two wins.
    expect(meta.counters['winStreak']).toBe(2);
    expect(meta.records.winStreak).toBe(2);
    expect(meta.records.biggestWin).toBe(4);
    for (const counter of MAX_COUNTERS) expect(typeof counter).toBe('string');
    applyMetaEvent(meta, { type: 'legends-collection', cards: 40, gold: 3, legends: 1, albumSets: 2 });
    applyMetaEvent(meta, { type: 'legends-collection', cards: 35, gold: 2, legends: 0, albumSets: 1 });
    expect(meta.counters).toMatchObject({ cardsMax: 40, goldMax: 3, legendMax: 1, albumSets: 2 });
    applyMetaEvent(meta, { type: 'legends-division', division: 7 });
    applyMetaEvent(meta, { type: 'legends-division', division: 9 });
    expect(meta.counters['divisionDepth']).toBe(4);
    expect(meta.records.legendsDivision).toBe(7);
    const season = applyMetaEvent(meta, { type: 'career-season', points: 70, goalsFor: 80, champion: true, promoted: false });
    expect(meta.counters).toMatchObject({ seasons: 1, titles: 1 });
    expect(season.unlocked.map((def) => def.id)).toEqual(expect.arrayContaining(['seasons-1', 'titles-1']));
    expect(meta.records).toMatchObject({ titles: 1, goalsSeason: 80, pointsSeason: 70 });
  });

  it('pays a medal once per improvement, so a medal cannot be farmed', () => {
    const meta = emptyMeta();
    applyMetaEvent(meta, { type: 'challenge', id: 'slalom', medal: 'bronze' });
    const afterBronze = meta.xp;
    applyMetaEvent(meta, { type: 'challenge', id: 'slalom', medal: 'bronze' });
    // The second bronze counts as a medal for the achievements but is worth no experience of its own.
    expect(meta.counters['medals']).toBe(2);
    expect(meta.xp - afterBronze).toBeLessThan(15);
    const before = meta.xp;
    applyMetaEvent(meta, { type: 'challenge', id: 'slalom', medal: 'gold' });
    expect(meta.xp - before).toBeGreaterThanOrEqual(40);
    expect(meta.records.medals['slalom']).toBe(3);
    applyMetaEvent(meta, { type: 'challenge', id: 'slalom', medal: null });
    expect(meta.counters['medals']).toBe(3);
  });

  it('counts a Legends win only once towards each of its counters, and nothing for a loss', () => {
    const meta = emptyMeta();
    applyMetaEvent(meta, { type: 'legends-match', mode: 'draft', goalsFor: 2, goalsAgainst: 0, won: true });
    applyMetaEvent(meta, { type: 'legends-match', mode: 'rivals', goalsFor: 0, goalsAgainst: 1, won: false });
    expect(meta.counters).toMatchObject({ matches: 2, wins: 1, legendsWins: 1, draftWins: 1, cleanSheets: 1 });
    expect(meta.counters['legendsWins']).toBe(1);
  });
});

describe('Phase 9 – the Legends Path', () => {
  it('rises level by level to a top level, with more experience needed each time', () => {
    expect(levelFor(0)).toBe(1);
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(xpForLevel(1));
    for (let level = 1; level < PATH_MAX_LEVEL; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
      expect(levelFor(xpToReach(level + 1))).toBe(level + 1);
      expect(levelFor(xpToReach(level + 1) - 1)).toBe(level);
    }
    expect(levelFor(10_000_000)).toBe(PATH_MAX_LEVEL);
    expect(pathProgress(10_000_000)).toEqual({ level: PATH_MAX_LEVEL, into: 0, needed: 0, percent: 100 });
    expect(pathProgress(xpToReach(5) + xpForLevel(5) / 2).percent).toBe(50);
  });

  it('opens each cosmetic at its level, lets only an unlocked one be worn, and falls back to the default', () => {
    const meta = emptyMeta();
    expect(new Set(COSMETICS.map((cosmetic) => `${cosmetic.slot}:${cosmetic.id}`)).size).toBe(COSMETICS.length);
    expect(COSMETICS.every((cosmetic) => cosmetic.level >= 1 && cosmetic.level <= PATH_MAX_LEVEL)).toBe(true);
    expect(new Set(COSMETICS.map((cosmetic) => cosmetic.slot))).toEqual(new Set(['boots', 'cheer', 'ball', 'decor', 'kit']));
    expect(equipCosmetic(meta, 'ball', 'neon')).toBe(false);
    expect(equipCosmetic(meta, 'ball', 'nonsense')).toBe(false);
    meta.xp = xpToReach(5);
    expect(rewardsOfLevel(5).map((cosmetic) => cosmetic.id)).toEqual(['neon']);
    expect(equipCosmetic(meta, 'ball', 'neon')).toBe(true);
    expect(wornCosmetics(meta).ball?.id).toBe('neon');
    expect(equipCosmetic(meta, 'ball', null)).toBe(true);
    expect(wornCosmetics(meta)).toEqual({});
    // A worn cosmetic that is no longer unlocked (a reset save) is not shown.
    meta.equipped.kit = 'pinstripes';
    expect(wornCosmetics(meta).kit).toBeUndefined();
    expect(isCosmeticUnlocked({ xp: xpToReach(29) }, COSMETICS.find((cosmetic) => cosmetic.id === 'pinstripes')!)).toBe(true);
  });

  it('is only a look: no cosmetic touches a stat block, a match or a career', () => {
    const game = createNewGame({ managerName: 'Look', clubName: 'Look FC', seed: 616 });
    const player = game.teams[0].players[4];
    setBoot(player, 'speed');
    const reference = JSON.stringify(buildStatBlock(player));
    for (const look of BOOT_LOOKS) { expect(setLook(player, look.id)).toBe(true); expect(JSON.stringify(buildStatBlock(player))).toBe(reference); }
    expect(BOOT_LOOKS.length).toBeGreaterThan(6);
    // Cosmetics carry colours, celebration numbers and pattern names; nothing that the effect pipeline could read.
    for (const cosmetic of COSMETICS) expect(Object.keys(cosmetic).sort()).toEqual(['id', 'level', 'name', 'slot', 'value']);
    const before = JSON.stringify(game);
    const meta = emptyMeta();
    meta.xp = xpToReach(PATH_MAX_LEVEL);
    for (const slot of ['ball', 'cheer', 'decor', 'kit'] as const) COSMETICS.filter((cosmetic) => cosmetic.slot === slot).forEach((cosmetic) => equipCosmetic(meta, slot, cosmetic.id));
    expect(JSON.stringify(game)).toBe(before);
    // The same match gives the same result whatever is worn: the engine is never told.
    const run = () => { const { home, away } = createPracticeTeams(); return new ArcadeMatch(home, away, home.id).result(); };
    const first = run(), second = run();
    expect([first.homeScore, first.awayScore]).toEqual([second.homeScore, second.awayScore]);
  }, 60_000);
});

describe('Phase 9 – the meta service', () => {
  beforeEach(() => { localStorage.clear(); TestBed.configureTestingModule({}); });
  afterEach(() => { localStorage.clear(); TestBed.resetTestingModule(); });

  it('keeps its own save, shows a toast for every unlock and level, and survives a reload', () => {
    const service = TestBed.inject(MetaService);
    service.record({ type: 'career-match', goalsFor: 3, goalsAgainst: 0, derby: false, league: true, hattricks: 1, motm: true });
    const titles = service.toasts().map((toast) => toast.title[0]);
    expect(titles.some((title) => title.startsWith('Torjäger'))).toBe(true);
    expect(titles.some((title) => title.startsWith('Sieger'))).toBe(true);
    expect(service.state().unlocked['goals-1']).toBeGreaterThan(0);
    // The toast is one per achievement: a second identical match unlocks nothing new in the first ladder step.
    const before = service.toasts().length;
    service.record({ type: 'career-match', goalsFor: 0, goalsAgainst: 1, derby: false, league: true, hattricks: 0, motm: false });
    expect(service.toasts().length).toBe(before);
    const stored = localStorage.getItem(META_STORAGE_KEY);
    expect(stored).toBeTruthy();
    const reloaded = parseMeta(stored);
    expect(reloaded.unlocked).toEqual(service.state().unlocked);
    expect(reloaded.xp).toBe(service.state().xp);
    service.dismiss(service.toasts()[0].id);
    expect(service.toasts().length).toBe(before - 1);
  });

  it('announces a level of the path with the cosmetic it opens, and only wears what is unlocked', () => {
    const service = TestBed.inject(MetaService);
    for (let i = 0; i < 40; i++) service.record({ type: 'career-season', points: 60, goalsFor: 50, champion: false, promoted: false });
    expect(service.progress().level).toBeGreaterThan(5);
    expect(service.toasts().some((toast) => toast.kind === 'level')).toBe(true);
    expect(service.equip('decor', 'royal')).toBe(false);
    expect(service.equip('ball', 'neon')).toBe(true);
    expect(service.worn().ball?.id).toBe('neon');
    expect(service.equip('ball', null)).toBe(true);
    service.reset();
    expect(service.state().xp).toBe(0);
  });

  it('repairs a damaged or foreign save instead of failing', () => {
    expect(parseMeta(null).xp).toBe(0);
    expect(parseMeta('not json').xp).toBe(0);
    expect(parseMeta(JSON.stringify({ version: 2, xp: 5 })).xp).toBe(0);
    const repaired = parseMeta(JSON.stringify({ version: 1, xp: 120.7, counters: { goals: 5, bad: 'x' }, unlocked: { 'goals-1': 1, ghost: 2 }, records: { titles: 2 } }));
    expect(repaired.xp).toBe(120);
    expect(repaired.counters).toEqual({ goals: 5 });
    expect(Object.keys(repaired.unlocked)).toEqual(['goals-1']);
    expect(repaired.records.titles).toBe(2);
    expect(repaired.records.goalsSeason).toBe(0);
  });

  it('has the texts of the page and the toasts in both languages', () => {
    for (const locale of ['de', 'en'] as const) expect(TRANSLATIONS[locale]['nav.meta']).toBeTruthy();
  });
});

describe('Phase 9 – the season review recap', () => {
  it('shows what the squad gained since the season began: levels, evolutions and the best signatures', () => {
    const game = createNewGame({ managerName: 'Recap', clubName: 'Recap FC', seed: 303 });
    const club = game.teams.find((team) => team.id === game.clubId)!;
    expect(game.rpgBaseline?.season).toBe(game.league.season);
    expect(buildRpgRecap(game)).toMatchObject({ levelUps: [], evolutions: [], levelsGained: 0, topClimber: null });
    game.rpgBaseline = takeRpgBaseline(game);
    const climber = club.players[3], other = club.players[5];
    climber.level += 3;
    other.level += 1;
    const signature = other.dna!.signatures![0];
    signature.level = Math.min(3, signature.level + 1) as 1 | 2 | 3;
    const recap = buildRpgRecap(game);
    expect(recap.levelsGained).toBe(4);
    expect(recap.levelUps.map((entry) => entry.playerId)).toEqual([climber.id, other.id]);
    expect(recap.topClimber).toMatchObject({ playerId: climber.id, levels: 3 });
    expect(recap.evolutions).toHaveLength(signature.level > 1 ? 1 : 0);
    expect(recap.bestSignatures.length).toBeGreaterThan(0);
    expect(recap.bestSignatures.length).toBeLessThanOrEqual(3);
    const summary = recapSummary(recap);
    expect(summary.levelsGained).toBe(4);
    expect(summary.topClimber).toContain('+3');
    // The review and its archive entry carry it.
    const review = buildSeasonReview(game);
    expect(review.rpg.levelsGained).toBe(4);
    expect(archiveEntry(game, review).rpg?.levelsGained).toBe(4);
  });

  it('ignores a baseline from another season and counts tamed quirks since it', () => {
    const game = createNewGame({ managerName: 'Old', clubName: 'Old FC', seed: 304 });
    game.rpgBaseline = { ...takeRpgBaseline(game), season: game.league.season - 1 };
    const club = game.teams.find((team) => team.id === game.clubId)!;
    club.players[0].level += 5;
    expect(buildRpgRecap(game).levelsGained).toBe(0);
    game.rpgBaseline = takeRpgBaseline(game);
    const quirk = club.players[1].dna!.quirks![0];
    quirk.revealed = true;
    quirk.tamed = true;
    expect(buildRpgRecap(game).tamed).toBe(1);
  });
});

describe('Phase 9 – card experience and levels', () => {
  const result = (home: number, away: number, ids: Record<string, { goals: number; assists: number }>, motm = ''): MatchResult => ({
    homeScore: home, awayScore: away, contributions: ids, manOfTheMatchId: motm,
  } as unknown as MatchResult);

  it('turns experience into five levels and a small attribute bonus that stops at two points', () => {
    expect(CARD_LEVEL_XP).toHaveLength(6);
    expect(cardLevelFor(0)).toBe(0);
    expect(cardLevelFor(59)).toBe(0);
    expect(cardLevelFor(60)).toBe(1);
    expect(cardLevelFor(900)).toBe(5);
    expect(cardLevelFor(99999)).toBe(5);
    expect([0, 1, 2, 3, 4, 5].map(levelBonus)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('pays the cards that played: showing up, goals, assists and the man of the match, and reports a level gained', () => {
    const state = freshLegends();
    const [a, b] = state.cards;
    const gained = awardCardXp(state, result(2, 0, { [a.player.id]: { goals: 2, assists: 0 } }, a.player.id), [a, b]);
    expect(state.cardXp![a.baseId]).toBe(12 + 12 + 4 + 20);
    expect(state.cardXp![b.baseId]).toBe(12 + 4);
    // 48 points are not yet the 60 of level 1; the next match brings the card over.
    expect(gained).toEqual([]);
    expect(cardLevel(state, a)).toBe(0);
    const next = awardCardXp(state, result(1, 0, { [a.player.id]: { goals: 1, assists: 0 } }), [a, b]);
    expect(next.map((card) => card.id)).toEqual([a.id]);
    expect(cardLevel(state, a)).toBe(1);
    awardCardXp(state, result(0, 1, {}), [b]);
    expect(state.cardXp![b.baseId]).toBe(12 + 4 + 12 + 4 + 12);
  });

  it('makes a card with a high level a little sharper in the match, and an older save needs nothing', () => {
    const state = freshLegends();
    delete state.cardXp;
    expect(cardLevel(state, state.cards[0])).toBe(0);
    const options = (cardXp?: Record<string, number>) => ({ id: 't', name: 'T', short: 'T', primary: '#fff', secondary: '#000', squad: state.squad, cards: state.cards, cardXp });
    const plain = cardsToTeam(options());
    const boosted = cardsToTeam(options(Object.fromEntries(state.cards.map((card) => [card.baseId, CARD_LEVEL_XP[5]]))));
    const slot = plain.formation.slots[0].playerId!;
    const before = plain.players.find((player) => player.id === slot)!.attributes.passing;
    const after = boosted.players.find((player) => player.id === slot)!.attributes.passing;
    expect(after - before).toBe(2);
  });
});

describe('Phase 9 – upgrading a card', () => {
  function bronzeWithCopies(copies: number): { state: LegendsState; card: LegendsCard } {
    const state = freshLegends();
    const base = createCard(state.seed, 9001, 'bronze', { index: 11 });
    state.cards = state.cards.filter((card) => card.baseId !== base.baseId);
    state.squad.slots = state.squad.slots.map((id) => (state.cards.some((card) => card.id === id) ? id : null));
    state.squad.bench = state.squad.bench.filter((id) => state.cards.some((card) => card.id === id));
    state.cards.push(base);
    for (let i = 0; i < copies; i++) state.cards.push({ ...structuredClone(base), id: `copy-${i}` });
    return { state, card: base };
  }

  it('asks for level, then duplicates or upgrade tokens, and says what is missing', () => {
    const { state, card } = bronzeWithCopies(1);
    expect(checkUpgrade(state, card.id)).toEqual({ ok: false, reason: 'level' });
    state.cardXp = { [card.baseId]: CARD_LEVEL_XP[UPGRADE_COST.bronze.level] };
    expect(checkUpgrade(state, card.id)).toEqual({ ok: true, via: 'duplicates', duplicates: 1, tokens: 0 });
    const { state: lonely, card: single } = bronzeWithCopies(0);
    lonely.cardXp = { [single.baseId]: CARD_LEVEL_XP[5] };
    expect(checkUpgrade(lonely, single.id)).toEqual({ ok: false, reason: 'material' });
    lonely.tokens = UPGRADE_COST.bronze.tokens;
    expect(checkUpgrade(lonely, single.id)).toEqual({ ok: true, via: 'tokens', duplicates: 0, tokens: 2 });
    expect(checkUpgrade(lonely, 'nobody')).toEqual({ ok: false, reason: 'card' });
  });

  it('moves the card to the next tier with a copy: stronger, inside the new tier, with the rarity of the tier', () => {
    const { state, card } = bronzeWithCopies(1);
    state.cardXp = { [card.baseId]: CARD_LEVEL_XP[3] };
    const before = card.player.overall;
    const count = state.cards.length;
    expect(upgradeCard(state, card.id).ok).toBe(true);
    expect(state.cards).toHaveLength(count - 1);
    expect(card.tier).toBe('silver');
    expect(card.player.overall).toBeGreaterThan(before);
    expect(tierForOverall(card.player.overall)).toBe('silver');
    expect(card.player.dna?.rarity).toBe('rare');
    expect(card.baseId).toBe(createCard(state.seed, 1, 'bronze', { index: 11 }).baseId);
    expect(quickSellValue(card)).toBeGreaterThan(300);
  });

  it('spends tokens when there is no copy, and a gold card cannot go up', () => {
    const { state, card } = bronzeWithCopies(0);
    state.cardXp = { [card.baseId]: CARD_LEVEL_XP[5] };
    state.tokens = 5;
    expect(upgradeCard(state, card.id).ok).toBe(true);
    expect(state.tokens).toBe(3);
    // Silver to gold costs four tokens: three are not enough.
    expect(upgradeCard(state, card.id)).toEqual({ ok: false, reason: 'material' });
    state.tokens = 4;
    expect(upgradeCard(state, card.id).ok).toBe(true);
    expect(card.tier).toBe('gold');
    expect(upgradeCard(state, card.id)).toEqual({ ok: false, reason: 'top-tier' });
  });

  it('never takes a copy from the squad', () => {
    const { state, card } = bronzeWithCopies(1);
    state.cardXp = { [card.baseId]: CARD_LEVEL_XP[5] };
    state.squad.bench.push('copy-0');
    expect(checkUpgrade(state, card.id)).toEqual({ ok: false, reason: 'material' });
  });

  it('gives upgrade tokens for claimed tasks: two for a weekly, one for a daily', () => {
    const state = freshLegends();
    ensureTasks(state, 1_000);
    for (const task of state.tasks) task.progress = task.target;
    const daily = state.tasks.find((task) => task.period === 'daily')!, weekly = state.tasks.find((task) => task.period === 'weekly')!;
    expect(claimTask(state, daily.id)).toBe(true);
    expect(state.tokens).toBe(1);
    expect(claimTask(state, weekly.id)).toBe(true);
    expect(state.tokens).toBe(3);
    expect(claimTask(state, weekly.id)).toBe(false);
    expect(state.tokens).toBe(3);
  });
});

describe('Phase 9 – the album', () => {
  it('counts different players per set, completes a set once and pays its reward once', () => {
    const state = freshLegends();
    expect(albumProgress(state).map((entry) => entry.set.id)).toEqual(ALBUM_SETS.map((set) => set.id));
    expect(albumSetsComplete(state)).toBe(0);
    state.cards = Array.from({ length: 31 }, (_, index) => createCard(state.seed, index, 'bronze', { index, prefix: 'album' }));
    const bronze = albumProgress(state).find((entry) => entry.set.id === 'bronze-30')!;
    expect(bronze).toMatchObject({ have: 30, complete: true, claimed: false });
    // A copy of the same player counts once.
    const duplicate = [...state.cards, { ...structuredClone(state.cards[0]), id: 'dup' }];
    expect(albumProgress({ ...state, cards: duplicate }).find((entry) => entry.set.id === 'bronze-30')!.have).toBe(30);
    const coins = state.coins;
    expect(claimAlbumSet(state, 'bronze-30')).toEqual({ coins: 1000, pack: null });
    expect(state.coins).toBe(coins + 1000);
    expect(claimAlbumSet(state, 'bronze-30')).toBeNull();
    expect(state.coins).toBe(coins + 1000);
    expect(claimAlbumSet(state, 'gold-15')).toBeNull();
    expect(claimAlbumSet(state, 'nonsense')).toBeNull();
    expect(albumSetsComplete(state)).toBeGreaterThanOrEqual(1);
    expect(albumProgress(state).find((entry) => entry.set.id === 'bronze-30')!.claimed).toBe(true);
  });

  it('pays a pack for the bigger sets', () => {
    const state = freshLegends();
    state.cards = Array.from({ length: 16 }, (_, index) => createCard(state.seed, index, 'gold', { index, prefix: 'gold' }));
    const packs = state.packs.length;
    expect(claimAlbumSet(state, 'gold-15')).toEqual({ coins: 0, pack: 'gold' });
    expect(state.packs).toHaveLength(packs + 1);
    expect(state.packs[state.packs.length - 1]).toBe('gold');
  });
});

describe('Phase 9 – the weekly squad challenge', () => {
  it('is the same for the same club and week, different from week to week, and has all three kinds over the year', () => {
    const a = weeklySbc(4711, '2026-W40'), b = weeklySbc(4711, '2026-W40');
    expect([a.id, a.kind, a.descriptionDe, a.reward]).toEqual([b.id, b.kind, b.descriptionDe, b.reward]);
    expect(a.id).toBe('weekly-2026-W40');
    const kinds = new Set(Array.from({ length: 52 }, (_, week) => weeklySbc(4711, `2026-W${String(week + 1).padStart(2, '0')}`).kind));
    expect(kinds).toEqual(new Set(['rating', 'club', 'young']));
    for (let week = 1; week <= 52; week++) {
      const sbc = weeklySbc(99, `2027-W${String(week).padStart(2, '0')}`);
      expect(sbc.de && sbc.en && sbc.descriptionDe && sbc.descriptionEn).toBeTruthy();
      expect(['silver', 'gold']).toContain(sbc.reward);
      expect(sbc.size).toBe(sbc.kind === 'club' ? 5 : 11);
    }
  });

  it('is offered next to the fixed challenges, once per week, and can be solved with the suggestion', () => {
    const state = freshLegends();
    const now = Date.UTC(2026, 9, 1);
    const list = sbcList(state, now);
    const weekly = list[list.length - 1];
    expect(list.length).toBeGreaterThan(4);
    expect(weekly.id).toBe(`weekly-${weekKey(new Date(now))}`);
    expect(weekly.repeatable).toBe(false);
    // A collection built for it: strong cards of one club, young enough, so any kind of the week is fillable.
    state.squad = { formationId: '4-3-3', slots: Array(11).fill(null), bench: [] };
    state.cards = Array.from({ length: 24 }, (_, index) => {
      const card = createCard(state.seed, 500 + index, 'gold', { index, prefix: 'week' });
      card.clubId = 'lc-a1';
      card.player.age = 22;
      return card;
    });
    const suggestion = suggestSbc(state, weekly.id, now);
    expect(suggestion).not.toBeNull();
    expect(new Set(suggestion).size).toBe(weekly.size);
    const packs = state.packs.length;
    expect(submitSbc(state, weekly.id, suggestion!, now)).toEqual({ ok: true });
    expect(state.packs).toHaveLength(packs + 1);
    expect(state.completedSbcs).toContain(weekly.id);
    expect(submitSbc(state, weekly.id, suggestion!, now).ok).toBe(false);
    expect(suggestSbc(state, weekly.id, now)).toBeNull();
    // Next week there is a new one.
    expect(sbcList(state, now + 8 * 86_400_000).at(-1)!.id).not.toBe(weekly.id);
  });

  it('finds the cheapest fitting cards and gives up when the collection cannot do it', () => {
    const state = freshLegends();
    const cards = Array.from({ length: 20 }, (_, index) => createCard(state.seed, 700 + index, index < 10 ? 'gold' : 'bronze', { index, prefix: 'mix' }));
    const rating = { ...weeklySbc(state.seed, 'x'), kind: 'rating' as const, size: 11, minAverage: 66, maxAge: 99, check: (list: LegendsCard[]) => list.reduce((sum, card) => sum + card.player.overall, 0) / list.length >= 66 };
    const found = suggestWeekly(rating, cards, quickSellValue)!;
    expect(found).toHaveLength(11);
    expect(rating.check(found)).toBe(true);
    // Cheaper than simply taking the eleven best.
    const best = [...cards].sort((a, b) => b.player.overall - a.player.overall).slice(0, 11);
    expect(found.reduce((sum, card) => sum + quickSellValue(card), 0)).toBeLessThanOrEqual(best.reduce((sum, card) => sum + quickSellValue(card), 0));
    expect(suggestWeekly(rating, cards.slice(10), quickSellValue)).toBeNull();
    const club = { ...rating, kind: 'club' as const, size: 5, check: (list: LegendsCard[]) => new Set(list.map((card) => card.clubId)).size === 1 };
    expect(suggestWeekly(club, cards.map((card, index) => ({ ...card, clubId: index < 4 ? 'a' : `other-${index}` })), quickSellValue)).toBeNull();
  });
});

describe('Phase 9 – draft opponents that grow with the squad', () => {
  it('keeps the old strength for a team of 74 and moves it by one for every two points, between -3 and +6', () => {
    for (let round = 1; round <= 4; round++) {
      expect(draftOpponentStrength(round, 74)).toBe(72 + round * 3);
      expect(draftOpponentStrength(round, 80)).toBe(72 + round * 3 + 3);
      expect(draftOpponentStrength(round, 70)).toBe(72 + round * 3 - 2);
      expect(draftOpponentStrength(round, 120)).toBe(72 + round * 3 + 6);
      expect(draftOpponentStrength(round, 30)).toBe(72 + round * 3 - 3);
    }
    expect(draftOpponentStrength(3, 85)).toBeGreaterThan(draftOpponentStrength(3, 75));
  });
});
