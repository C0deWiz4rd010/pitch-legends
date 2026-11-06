import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { createNewGame } from './data/generators';
import { Rng } from './core/util';
import { Player } from './models/player.model';
import { RpgService } from './core/services/rpg.service';
import { autoSpend, autoSpendTalents, earnedSkillPoints } from './core/rpg/auto-build';
import { decayForm, formSymbol, formTrend, recordMatchForm } from './core/rpg/form';
import { createPersonalGoal } from './core/rpg/personal-goal';
import { TRAITS } from './data/traits';
import { TALENT_NODES } from './data/talents';
import { SIGNATURES } from './data/signatures';
import { QUIRKS } from './data/quirks';
import { TRAINING_DRILLS } from './data/training-drills';
import { TRANSLATIONS } from './data/translations';
import { EFFECT_CAPS, HOOK_INDEX, DerivedHook } from './core/rpg/effects';

const freshPlayer = (): Player => {
  const player = createNewGame({ managerName: 'Rpg', clubName: 'Rpg FC', seed: 4242 }).teams[3].players[5];
  player.talentRanks = {};
  player.traitIds = [];
  player.skillPoints = 0;
  return player;
};

describe('Phase 7 – form', () => {
  it('moves towards what the rating says, stays between -5 and +5 and remembers five ratings', () => {
    const player = freshPlayer();
    player.form = 0;
    recordMatchForm(player, 8.2);
    expect(player.form).toBeCloseTo(1.3, 1);
    for (let i = 0; i < 20; i++) recordMatchForm(player, 9.5);
    expect(player.form).toBeLessThanOrEqual(5);
    expect(player.form).toBeGreaterThan(4.5);
    for (let i = 0; i < 40; i++) recordMatchForm(player, 3);
    expect(player.form).toBeGreaterThanOrEqual(-5);
    expect(player.form).toBeLessThan(-4.5);
    expect(player.recentRatings).toHaveLength(5);
  });

  it('cools down towards neutral without matches', () => {
    const player = freshPlayer();
    player.form = 4;
    for (let i = 0; i < 12; i++) decayForm(player);
    expect(player.form).toBeLessThan(2.1);
    expect(player.form).toBeGreaterThan(0);
    player.form = 0.04;
    decayForm(player);
    expect(player.form).toBe(0);
  });

  it('shows the trend of the latest ratings against the ones before', () => {
    const player = freshPlayer();
    expect(formTrend(player)).toBe('flat');
    player.recentRatings = [6.2, 6.3, 6.1, 7.2, 7.4];
    expect(formTrend(player)).toBe('up');
    expect(formSymbol(player)).toBe('▲');
    player.recentRatings = [7.4, 7.2, 7.1, 6.2, 6.0];
    expect(formTrend(player)).toBe('down');
    player.recentRatings = [6.6, 6.5, 6.7, 6.6, 6.5];
    expect(formTrend(player)).toBe('flat');
  });
});

describe('Phase 7 – computer-built players', () => {
  it('counts the points a level has earned', () => {
    expect(earnedSkillPoints(1)).toBe(0);
    expect(earnedSkillPoints(2)).toBe(2);
    expect(earnedSkillPoints(5)).toBe(9);
    // Levels 2 to 10: seven levels with two points and the fifth and tenth with three.
    expect(earnedSkillPoints(10)).toBe(2 * 7 + 3 * 2);
  });

  it('spends points on the root, one branch and its elite node, the same branch every time', () => {
    const player = freshPlayer();
    player.level = 12;
    player.skillPoints = 30;
    autoSpendTalents(player);
    const owned = Object.keys(player.talentRanks);
    const nodes = TALENT_NODES.filter((node) => owned.includes(node.id));
    expect(nodes.some((node) => node.tier === 1)).toBe(true);
    expect(new Set(nodes.filter((node) => node.branch).map((node) => node.branch)).size).toBeLessThanOrEqual(1);
    const second = structuredClone(freshPlayer());
    second.level = 12; second.skillPoints = 30;
    autoSpendTalents(second);
    expect(second.talentRanks).toEqual(player.talentRanks);
    expect(player.skillPoints).toBeGreaterThanOrEqual(0);
  });

  it('does not spend what it cannot afford and leaves a low-level player alone', () => {
    const player = freshPlayer();
    player.level = 1;
    player.skillPoints = 1;
    autoSpend(player);
    // A level-1 player can afford no talent (they start at level 2 and cost two points or more), only a cheap attribute step.
    expect(player.talentRanks).toEqual({});
    expect(player.skillPoints).toBeLessThanOrEqual(1);
    player.skillPoints = 0;
    const attributes = structuredClone(player.attributes);
    autoSpend(player);
    expect(player.attributes).toEqual(attributes);
  });

  it('puts the rest into the archetype\'s attributes, within his potential, and into a trait', () => {
    const player = freshPlayer();
    player.level = 25;
    player.skillPoints = 60;
    const before = player.overall;
    autoSpend(player);
    expect(player.skillPoints).toBeLessThan(60);
    expect(player.overall).toBeGreaterThanOrEqual(before);
    expect(player.overall).toBeLessThanOrEqual(Math.max(before, player.potential));
    expect(player.traitIds.length).toBeLessThanOrEqual(4);
  });

  it('starts generated players with the talents their level earned', () => {
    const squad = createNewGame({ managerName: 'Rpg', clubName: 'Rpg FC', seed: 99 }).teams.flatMap((team) => team.players);
    const experienced = squad.filter((player) => player.level >= 10);
    expect(experienced.length).toBeGreaterThan(20);
    expect(experienced.every((player) => Object.keys(player.talentRanks).length > 0)).toBe(true);
    // Points are never created from nothing: spent plus left over equals what the level earned.
    for (const player of experienced.slice(0, 30)) {
      const spent = Object.entries(player.talentRanks).reduce((sum, [id, rank]) => sum + (TALENT_NODES.find((node) => node.id === id)?.cost ?? 0) * rank, 0);
      expect(spent + player.skillPoints).toBe(earnedSkillPoints(player.level));
    }
  });
});

describe('Phase 7 – experience and growth hooks', () => {
  it('scales the experience through the xpGain hook, Wonderkid and Quick Learner together', () => {
    const service = new RpgService();
    const gain = (traits: string[]) => {
      const player = freshPlayer();
      player.level = 3; player.xp = 0; player.xpToNext = 100000; player.traitIds = traits;
      service.awardXp(player, 100);
      return player.xp;
    };
    expect(gain([])).toBe(100);
    expect(gain(['wonderkid'])).toBe(125);
    expect(gain(['quicklearner'])).toBe(110);
    expect(gain(['wonderkid', 'quicklearner'])).toBe(138);
  });
});

describe('Phase 7 – traits and sources', () => {
  it('names every trait in German and keeps their ids unique', () => {
    expect(new Set(TRAITS.map((trait) => trait.id)).size).toBe(TRAITS.length);
    for (const trait of TRAITS) {
      expect(trait.nameDe, trait.id).toBeTruthy();
      expect(trait.descriptionDe, trait.id).toBeTruthy();
    }
  });

  it('gives every derived hook at least one source in the data', () => {
    const hooks = new Set<string>();
    const add = (effects?: { hook: string }[]) => effects?.forEach((effect) => hooks.add(effect.hook));
    TRAITS.forEach((trait) => add(trait.effects));
    TALENT_NODES.forEach((node) => add(node.effects));
    SIGNATURES.forEach((signature) => add(signature.effects));
    QUIRKS.forEach((quirk) => add(quirk.effects));
    TRAINING_DRILLS.forEach((drill) => add(drill.buff?.effects));
    const missing = (Object.keys(HOOK_INDEX) as DerivedHook[]).filter((hook) => !hooks.has(hook));
    expect(missing).toEqual([]);
  });

  it('keeps every effect of a new trait within its hook\'s caps', () => {
    for (const trait of TRAITS.filter((candidate) => ['cannon', 'bender', 'visionary', 'velvet', 'bodyguard', 'skyscraper', 'longreach', 'recovery', 'composed'].includes(candidate.id))) {
      for (const effect of trait.effects ?? []) {
        const cap = EFFECT_CAPS[effect.hook];
        expect(cap, `${trait.id}: ${effect.hook}`).toBeDefined();
        const [low, high] = effect.op === 'add' ? cap!.add : cap!.mul;
        expect(effect.value).toBeGreaterThanOrEqual(low);
        expect(effect.value).toBeLessThanOrEqual(high);
      }
    }
  });

  it('has the level-up news in both languages', () => {
    for (const locale of ['de', 'en'] as const) {
      expect(TRANSLATIONS[locale]['news.levelup.title']).toBeTruthy();
      expect(TRANSLATIONS[locale]['news.levelup.body']).toContain('{player}');
    }
  });
});

describe('Phase 7 – goals and live ratings', () => {
  it('draws a goal that suits the position, including rating and appearance goals', () => {
    const types = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      for (const group of ['ATT', 'MID', 'DEF', 'GK'] as const) {
        const goal = createPersonalGoal({ positionGroup: group, overall: 70 }, new Rng(seed * 7 + group.length));
        types.add(goal.type);
        expect(goal.progress).toBe(0);
        expect(goal.completed).toBe(false);
        expect(goal.target).toBeGreaterThan(3);
        if (group === 'ATT') expect(goal.type).not.toBe('assists');
        if (group === 'GK') expect(['goals', 'assists']).not.toContain(goal.type);
      }
    }
    expect(types).toEqual(new Set(['appearances', 'rating', 'goals', 'assists', 'clean-sheets']));
  });

  it('costs the back line a goal against and rewards a clean sheet', () => {
    const { home, away } = createPracticeTeams();
    const match = new ArcadeMatch(home, away, home.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner = match as unknown as Record<string, any>;
    const keeper = match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup === 'GK')!;
    const defender = match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup === 'DEF')!;
    const striker = match.actors.find((actor) => actor.side === 'home' && actor.player.positionGroup === 'ATT')!;
    const before = [keeper, defender, striker].map((actor) => inner['ratings'][actor.player.id]);
    inner['penaliseConceding']('home');
    const after = [keeper, defender, striker].map((actor) => inner['ratings'][actor.player.id]);
    expect(after[0]).toBeCloseTo(before[0] - 0.3, 5);
    expect(after[1]).toBeCloseTo(before[1] - 0.12, 5);
    expect(after[2]).toBe(before[2]);
    inner['adjustRating']('someone-who-did-not-play', -1);
    expect(inner['ratings']['someone-who-did-not-play']).toBeUndefined();
    inner['adjustRating'](keeper.player.id, -20);
    expect(inner['ratings'][keeper.player.id]).toBe(1);
  });
});
