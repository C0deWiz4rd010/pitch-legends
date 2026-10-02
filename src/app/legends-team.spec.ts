import { TestBed } from '@angular/core/testing';
import { PACKS, TIER_ORDER, createCard, packTiers, tierForOverall } from './core/legends/cards';
import {
  DRAFT_ROUNDS, RIVALS_SEASON_MATCHES, applyDraftResult, applyRivalsResult, buyPack, claimDraftReward, claimTask, createLegendsState,
  dayKey, draftPick, draftTeam, ensureTasks, openPack, ownTeam, progressTask, rivalsOpponent, sellCards, setSlot, startDraft, submitSbc,
  suggestSbc, surplusDuplicates, weekKey,
} from './core/legends/legends-engine';
import { playerChemistry, squadView } from './core/legends/squad';
import { LEGENDS_STORAGE_KEY, LegendsService } from './core/services/legends.service';
import { CardTier, LegendsState } from './models/legends.model';

const NOW = new Date(2026, 9, 2, 12).getTime();

function fresh(seed = 4040): LegendsState {
  return createLegendsState('Spec XI', seed, NOW);
}

describe('Legends Team', () => {
  it('starts a club with a full, legal squad, coins and two packs', () => {
    const state = fresh();
    expect(state.cards).toHaveLength(21);
    expect(state.coins).toBe(5000);
    expect(state.packs).toEqual(['bronze', 'bronze']);
    const view = squadView(state);
    expect(view.starters.every((entry) => !!entry.card)).toBe(true);
    expect(view.bench).toHaveLength(7);
    const ids = [...state.squad.slots, ...state.squad.bench].map((id) => state.cards.find((card) => card.id === id)!.baseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(view.starters.find((entry) => entry.position === 'GK')?.card?.player.positionGroup).toBe('GK');
    expect(ownTeam(state).formation.slots.every((slot) => !!slot.playerId)).toBe(true);
  });

  it('draws pack tiers with the published odds and honours guarantees', () => {
    for (const pack of Object.values(PACKS)) {
      const counts: Record<CardTier, number> = { bronze: 0, silver: 0, gold: 0, legend: 0 };
      const runs = 3000;
      for (let index = 0; index < runs; index++) {
        const tiers = packTiers(9, pack.id, index);
        expect(tiers).toHaveLength(pack.size);
        if (pack.guarantee) {
          const minimum = TIER_ORDER.indexOf(pack.guarantee.tier);
          expect(tiers.filter((tier) => TIER_ORDER.indexOf(tier) >= minimum).length).toBeGreaterThanOrEqual(pack.guarantee.count);
        }
        for (const tier of tiers) counts[tier]++;
      }
      if (!pack.guarantee) {
        for (const tier of TIER_ORDER) expect(Math.abs(counts[tier] / (runs * pack.size) - pack.odds[tier])).toBeLessThan(0.02);
      }
      expect(packTiers(9, pack.id, 5)).toEqual(packTiers(9, pack.id, 5));
    }
  });

  it('creates cards inside their tier and the same pool slot as a duplicate', () => {
    for (const tier of TIER_ORDER) {
      const card = createCard(11, 1, tier, { index: 3 });
      expect(tierForOverall(card.player.overall)).toBe(tier);
      expect(createCard(11, 99, tier, { index: 3 }).baseId).toBe(card.baseId);
    }
  });

  it('buys, opens and sells packs; squad players and the kept copy are protected', () => {
    const state = fresh();
    expect(buyPack(state, 'premium')).toEqual({ ok: false, reason: 'coins' });
    expect(buyPack(state, 'silver').ok).toBe(true);
    expect(state.coins).toBe(2500);
    const before = state.cards.length;
    const result = openPack(state, 'silver')!;
    expect(result.cards).toHaveLength(5);
    expect(state.cards.length).toBe(before + 5);
    expect(state.tasks.find((task) => task.kind === 'open-pack')?.progress ?? 1).toBeGreaterThanOrEqual(0);
    const starter = state.squad.slots[0]!;
    expect(sellCards(state, [starter])).toBe(0);
    const spare = result.cards[0].id;
    const coins = state.coins;
    expect(sellCards(state, [spare])).toBeGreaterThan(0);
    expect(state.coins).toBeGreaterThan(coins);
    // Duplicate detection keeps exactly one copy.
    state.cards.push(structuredClone({ ...state.cards[0], id: 'copy-a' }), structuredClone({ ...state.cards[0], id: 'copy-b' }));
    const surplus = surplusDuplicates(state);
    expect(surplus).toContain('copy-a');
    expect(surplus).not.toContain(state.cards[0].id);
  });

  it('rewards chemistry for position, club, league and nation links', () => {
    const state = fresh();
    const card = state.cards.find((candidate) => candidate.player.position === 'ST')!;
    const alone = playerChemistry(card, 'ST', [card]);
    const mates = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(card), id: `mate-${index}`, baseId: `mate-${index}` }));
    expect(playerChemistry(card, 'ST', [card, ...mates])).toBeGreaterThan(alone);
    expect(playerChemistry(card, 'GK', [card])).toBeLessThan(alone);
  });

  it('refuses a second copy of a player in the squad', () => {
    const state = fresh();
    const original = state.cards.find((card) => card.id === state.squad.slots[3])!;
    state.cards.push({ ...structuredClone(original), id: 'twin' });
    expect(setSlot(state, 5, 'twin')).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('promotes after a strong Rivals season and pays a season pack', () => {
    const state = fresh();
    const opponent = rivalsOpponent(state);
    expect(opponent.players.length).toBeGreaterThanOrEqual(16);
    let last = applyRivalsResult(state, 2, 0, opponent.name, NOW);
    for (let match = 1; match < RIVALS_SEASON_MATCHES; match++) last = applyRivalsResult(state, 2, 1, 'X', NOW);
    expect(last.seasonEnded).toBe(true);
    expect(last.promoted).toBe(true);
    expect(state.rivals.division).toBe(9);
    expect(state.rivals.played).toBe(0);
    expect(state.packs).toContain('bronze');
    expect(rivalsOpponent(state).strength).toBeGreaterThan(opponent.strength - 3);
  });

  it('runs a draft from picks through four knockout rounds to the reward', () => {
    const state = fresh();
    state.coins = 5000;
    expect(startDraft(state, '2026-W40').ok).toBe(true);
    expect(startDraft(state, '2026-W40')).toEqual({ ok: false, reason: 'running' });
    const draft = state.draft!;
    expect(draft.picks).toHaveLength(11);
    for (const pick of draft.picks) {
      const choice = pick.options.find((card) => draftPick(state, pick.slotIndex, card.id));
      expect(choice).toBeTruthy();
    }
    expect(state.draft!.round).toBe(1);
    expect(draftTeam(state)!.formation.slots.every((slot) => !!slot.playerId)).toBe(true);
    for (let round = 1; round <= DRAFT_ROUNDS; round++) applyDraftResult(state, true, 2, 1, `R${round}`, NOW);
    expect(state.draft!.wins).toBe(4);
    const coins = state.coins;
    expect(claimDraftReward(state)).toEqual({ coins: 6000, pack: 'premium' });
    expect(state.coins).toBe(coins + 6000);
    expect(claimDraftReward(state)).toBeNull();
  });

  it('renews daily and weekly tasks by date and pays them once', () => {
    const state = fresh();
    expect(state.tasks.filter((task) => task.period === 'daily')).toHaveLength(3);
    expect(state.tasks.filter((task) => task.period === 'weekly')).toHaveLength(3);
    const task = state.tasks[0];
    expect(claimTask(state, task.id)).toBe(false);
    progressTask(state, task.kind, task.target);
    expect(claimTask(state, task.id)).toBe(true);
    expect(claimTask(state, task.id)).toBe(false);
    ensureTasks(state, NOW + 86400000 * 8);
    expect(state.tasks.every((entry) => entry.periodKey === dayKey(new Date(NOW + 86400000 * 8)) || entry.periodKey === weekKey(new Date(NOW + 86400000 * 8)))).toBe(true);
    expect(weekKey(new Date(2026, 0, 1))).toBe('2026-W01');
  });

  it('completes a squad building challenge only with eligible cards outside the squad', () => {
    const state = fresh();
    for (let index = 0; index < 12; index++) state.cards.push(createCard(state.seed, 500 + index, 'bronze', { index: 100 + index }));
    const cards = suggestSbc(state, 'bronze-swap')!;
    expect(cards).toHaveLength(11);
    expect(cards.some((id) => state.squad.slots.includes(id))).toBe(false);
    expect(submitSbc(state, 'bronze-swap', cards.slice(0, 10)).ok).toBe(false);
    expect(submitSbc(state, 'bronze-swap', cards).ok).toBe(true);
    expect(state.packs).toContain('silver');
    expect(state.cards.some((card) => cards.includes(card.id))).toBe(false);
  });

  it('keeps its own save and never writes the career', () => {
    localStorage.clear();
    const service = TestBed.inject(LegendsService);
    service.create('Isolated XI', 77);
    service.buy('bronze');
    service.open('bronze');
    expect(localStorage.getItem(LEGENDS_STORAGE_KEY)).toBeTruthy();
    expect(Object.keys(localStorage).filter((key) => key.startsWith('pitch-legends:save'))).toEqual([]);
  });
});
