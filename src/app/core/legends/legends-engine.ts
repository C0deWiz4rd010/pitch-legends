import { generateTeam } from '../../data/generators';
import { Position } from '../../models/enums';
import { CardTier, DraftState, LegendsCard, LegendsState, LegendsTask, LegendsTaskKind, PackId } from '../../models/legends.model';
import { Team } from '../../models/team.model';
import { Rng } from '../util';
import { hash32 } from '../visual-identity';
import { PACKS, TIER_ORDER, createCard, drawTier, legendsWorld, packTiers, quickSellValue } from './cards';
import { autoBuild, cardsToTeam, slotPositions, squadView } from './squad';

export const LEGENDS_VERSION = 1;
export const RIVALS_SEASON_MATCHES = 10;
export const RIVALS_PROMOTION_POINTS = 19;
export const RIVALS_RELEGATION_POINTS = 7;
export const DRAFT_ENTRY = 1000;
export const DRAFT_ROUNDS = 4;

const STARTER: Array<{ position: Position; tier: CardTier }> = [
  ...(['GK', 'GK'] as Position[]).map((position) => ({ position, tier: 'bronze' as CardTier })),
  ...(['CB', 'CB', 'CB', 'LB', 'RB', 'LB', 'RB'] as Position[]).map((position, index) => ({ position, tier: (index < 2 ? 'silver' : 'bronze') as CardTier })),
  ...(['CDM', 'CM', 'CM', 'CAM', 'CM', 'CDM'] as Position[]).map((position, index) => ({ position, tier: (index < 2 ? 'silver' : 'bronze') as CardTier })),
  ...(['LW', 'RW', 'ST', 'ST', 'LW', 'RW'] as Position[]).map((position, index) => ({ position, tier: (index === 2 ? 'silver' : 'bronze') as CardTier })),
];

/** A new Legends club: 21 starter cards, 5000 coins and two bronze packs. Independent from any career. */
export function createLegendsState(clubName: string, seed: number, now = Date.now()): LegendsState {
  // The starter squad comes from three clubs of one league, so chemistry links exist from day one.
  const clubs = legendsWorld(seed).clubs.filter((club) => club.leagueId === 'league-a').slice(0, 3);
  const cards = STARTER.map((entry, index) => ({ ...createCard(seed, index, entry.tier, { index, position: entry.position, prefix: 'starter' }), clubId: clubs[index % clubs.length].id, leagueId: 'league-a' }));
  const state: LegendsState = {
    version: LEGENDS_VERSION,
    seed,
    createdAt: now,
    updatedAt: now,
    clubName: clubName.trim() || 'Legends XI',
    coins: 5000,
    cards,
    squad: autoBuild(cards, '4-3-3'),
    packs: ['bronze', 'bronze'],
    packsOpened: 0,
    cardSerial: cards.length,
    rivals: { division: 10, points: 0, played: 0, won: 0, drawn: 0, lost: 0, season: 1, bestDivision: 10, matchSerial: 0 },
    draft: null,
    tasks: [],
    completedSbcs: [],
    history: [],
  };
  ensureTasks(state, now);
  return state;
}

// ── Packs and the collection ────────────────────────────────────────────────

export interface PackResult { cards: LegendsCard[]; duplicates: string[] }

export function buyPack(state: LegendsState, packId: PackId): { ok: boolean; reason?: 'coins' } {
  const price = PACKS[packId].price;
  if (state.coins < price) return { ok: false, reason: 'coins' };
  state.coins -= price;
  state.packs.push(packId);
  return { ok: true };
}

/** Opens the first stored pack of this type. Duplicates are flagged, not removed. */
export function openPack(state: LegendsState, packId: PackId): PackResult | null {
  const index = state.packs.indexOf(packId);
  if (index < 0) return null;
  state.packs.splice(index, 1);
  const owned = new Set(state.cards.map((card) => card.baseId));
  const tiers = packTiers(state.seed, packId, state.packsOpened);
  state.packsOpened++;
  const cards = tiers.map((tier) => createCard(state.seed, state.cardSerial++, tier));
  const duplicates = cards.filter((card) => owned.has(card.baseId) || cards.some((other) => other !== card && other.baseId === card.baseId && cards.indexOf(other) < cards.indexOf(card))).map((card) => card.id);
  state.cards.push(...cards);
  progressTask(state, 'open-pack', 1);
  return { cards: cards.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.player.overall - b.player.overall), duplicates };
}

export function inSquad(state: LegendsState, cardId: string): boolean {
  return state.squad.slots.includes(cardId) || state.squad.bench.includes(cardId);
}

export function sellCards(state: LegendsState, cardIds: string[]): number {
  let total = 0;
  for (const id of cardIds) {
    const card = state.cards.find((candidate) => candidate.id === id);
    if (!card || inSquad(state, id)) continue;
    total += quickSellValue(card);
    state.cards = state.cards.filter((candidate) => candidate.id !== id);
  }
  state.coins += total;
  return total;
}

/** Duplicates that are not part of the squad: the copy with the higher overall is kept. */
export function surplusDuplicates(state: LegendsState): string[] {
  const groups = new Map<string, LegendsCard[]>();
  for (const card of state.cards) groups.set(card.baseId, [...(groups.get(card.baseId) ?? []), card]);
  const surplus: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = group.find((card) => inSquad(state, card.id)) ?? [...group].sort((a, b) => b.player.overall - a.player.overall)[0];
    surplus.push(...group.filter((card) => card !== keep && !inSquad(state, card.id)).map((card) => card.id));
  }
  return surplus;
}

// ── Squad ───────────────────────────────────────────────────────────────────

export function setSlot(state: LegendsState, slotIndex: number, cardId: string | null): { ok: boolean; reason?: 'duplicate' } {
  const card = cardId ? state.cards.find((candidate) => candidate.id === cardId) : null;
  if (cardId && !card) return { ok: false };
  const squad = state.squad;
  if (card) {
    const clash = [...squad.slots.map((id, index) => (index === slotIndex ? null : id)), ...squad.bench.filter((id) => id !== cardId)]
      .some((id) => id && state.cards.find((other) => other.id === id)?.baseId === card.baseId && id !== cardId);
    if (clash) return { ok: false, reason: 'duplicate' };
  }
  const previous = squad.slots[slotIndex];
  const fromSlot = cardId ? squad.slots.indexOf(cardId) : -1;
  squad.bench = squad.bench.filter((id) => id !== cardId);
  if (fromSlot >= 0) squad.slots[fromSlot] = previous; // swap inside the eleven
  else if (previous && card && squad.bench.length < 7) squad.bench.push(previous);
  squad.slots[slotIndex] = cardId;
  return { ok: true };
}

export function setFormation(state: LegendsState, formationId: string): void {
  const size = slotPositions(formationId).length;
  const slots = state.squad.slots.slice(0, size);
  while (slots.length < size) slots.push(null);
  state.squad = { ...state.squad, formationId, slots };
}

export function ownTeam(state: LegendsState): Team {
  const division = state.rivals.division;
  return cardsToTeam({ id: 'legends-own', name: state.clubName, short: state.clubName.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'LEG', primary: '#ffd34e', secondary: '#151a33', squad: state.squad, cards: state.cards, stadium: division <= 3 ? 4 : division <= 6 ? 3 : 2 });
}

// ── Division Rivals ─────────────────────────────────────────────────────────

export function divisionStrength(division: number): number {
  return Math.round(56 + (10 - division) * 3.2);
}

/** A fresh opponent for the next Rivals match, stronger in higher divisions. */
export function rivalsOpponent(state: LegendsState): Team {
  const world = legendsWorld(state.seed);
  const serial = state.rivals.matchSerial;
  const rng = new Rng(hash32(`${state.seed}|rivals|${serial}`));
  const club = world.clubs[hash32(`${state.seed}|rival-club|${serial}`) % world.clubs.length];
  const team = generateTeam(rng, { name: club.name, short: club.short, primary: club.primary, secondary: club.secondary }, divisionStrength(state.rivals.division) + rng.int(-2, 2), false);
  team.id = `rival-${serial}`;
  for (const player of team.players) { player.fitness = 100; player.injuryWeeks = 0; }
  return team;
}

export interface RivalsOutcome { coins: number; seasonEnded: boolean; promoted: boolean; relegated: boolean; rewardPack: PackId | null }

export function applyRivalsResult(state: LegendsState, goalsFor: number, goalsAgainst: number, opponentName: string, now = Date.now()): RivalsOutcome {
  const rivals = state.rivals;
  const won = goalsFor > goalsAgainst, drew = goalsFor === goalsAgainst;
  const coins = Math.round((won ? 500 : drew ? 250 : 120) * (1 + (10 - rivals.division) * 0.2));
  rivals.played++;
  rivals.matchSerial++;
  if (won) { rivals.won++; rivals.points += 3; } else if (drew) { rivals.drawn++; rivals.points += 1; } else rivals.lost++;
  state.coins += coins;
  state.history.unshift({ id: `rivals-${rivals.matchSerial}`, mode: 'rivals', at: now, opponent: opponentName, goalsFor, goalsAgainst, coins });
  state.history = state.history.slice(0, 40);
  progressTask(state, 'play', 1);
  progressTask(state, 'goals', goalsFor);
  if (won) progressTask(state, 'win-rivals', 1);
  if (goalsAgainst === 0) progressTask(state, 'clean-sheet', 1);
  const outcome: RivalsOutcome = { coins, seasonEnded: false, promoted: false, relegated: false, rewardPack: null };
  if (rivals.played >= RIVALS_SEASON_MATCHES) {
    outcome.seasonEnded = true;
    outcome.rewardPack = rivals.division <= 3 ? 'gold' : rivals.division <= 6 ? 'silver' : 'bronze';
    if (rivals.points >= RIVALS_PROMOTION_POINTS && rivals.division > 1) { rivals.division--; outcome.promoted = true; }
    else if (rivals.points <= RIVALS_RELEGATION_POINTS && rivals.division < 10) { rivals.division++; outcome.relegated = true; }
    rivals.bestDivision = Math.min(rivals.bestDivision, rivals.division);
    state.packs.push(outcome.rewardPack);
    Object.assign(rivals, { points: 0, played: 0, won: 0, drawn: 0, lost: 0, season: rivals.season + 1 });
  }
  return outcome;
}

// ── Draft tournament ────────────────────────────────────────────────────────

export const DRAFT_ODDS: Record<CardTier, number> = { bronze: 0.05, silver: 0.35, gold: 0.52, legend: 0.08 };
export const DRAFT_REWARDS: Array<{ coins: number; pack: PackId | null }> = [
  { coins: 300, pack: null }, { coins: 800, pack: null }, { coins: 1500, pack: 'silver' }, { coins: 3000, pack: 'gold' }, { coins: 6000, pack: 'premium' },
];

/** Five cards to choose from for every slot of the formation. Draft cards never enter the collection. */
export function startDraft(state: LegendsState, weekKey: string): { ok: boolean; reason?: 'coins' | 'running' } {
  if (state.draft && !state.draft.rewardClaimed) return { ok: false, reason: 'running' };
  if (state.coins < DRAFT_ENTRY) return { ok: false, reason: 'coins' };
  state.coins -= DRAFT_ENTRY;
  const id = `draft-${weekKey}-${hash32(`${state.seed}|draft|${state.cardSerial}|${state.history.length}`).toString(36)}`;
  const rng = new Rng(hash32(id));
  const formationId = rng.pick(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2']);
  const positions = slotPositions(formationId);
  const draft: DraftState = {
    id, week: weekKey, formationId, round: 0, wins: 0, eliminated: false, rewardClaimed: false,
    picks: positions.map((position, slotIndex) => ({
      slotIndex,
      chosenId: null,
      options: Array.from({ length: 5 }, (_, option) => createCard(state.seed, hash32(`${id}|${slotIndex}|${option}`), drawTier(rng, DRAFT_ODDS), { position: position as Position, prefix: `draft-${slotIndex}-${option}` })),
    })),
  };
  state.draft = draft;
  return { ok: true };
}

export function draftPick(state: LegendsState, slotIndex: number, cardId: string): boolean {
  const draft = state.draft;
  const pick = draft?.picks[slotIndex];
  if (!draft || !pick || draft.round !== 0 || !pick.options.some((card) => card.id === cardId)) return false;
  const card = pick.options.find((option) => option.id === cardId)!;
  // The same player cannot be drafted twice.
  if (draft.picks.some((other) => other !== pick && other.chosenId && other.options.find((option) => option.id === other.chosenId)?.baseId === card.baseId)) return false;
  pick.chosenId = cardId;
  if (draft.picks.every((entry) => entry.chosenId)) draft.round = 1;
  return true;
}

export function draftCards(draft: DraftState): LegendsCard[] {
  return draft.picks.map((pick) => pick.options.find((option) => option.id === pick.chosenId)).filter((card): card is LegendsCard => !!card);
}

export function draftTeam(state: LegendsState): Team | null {
  const draft = state.draft;
  if (!draft || draft.round === 0) return null;
  const cards = draftCards(draft);
  return cardsToTeam({ id: 'legends-draft', name: `${state.clubName} Draft`, short: 'DRF', primary: '#37d8ff', secondary: '#101733', squad: { formationId: draft.formationId, slots: cards.map((card) => card.id), bench: [] }, cards, stadium: 3 });
}

export function draftChemistry(draft: DraftState): { chemistry: number; rating: number } {
  const cards = draftCards(draft);
  const view = squadView({ cards, squad: { formationId: draft.formationId, slots: draft.picks.map((pick) => pick.chosenId), bench: [] } });
  return { chemistry: view.chemistry, rating: view.rating };
}

export function draftOpponent(state: LegendsState): Team | null {
  const draft = state.draft;
  if (!draft || draft.round < 1 || draft.round > DRAFT_ROUNDS || draft.eliminated) return null;
  const world = legendsWorld(state.seed);
  const rng = new Rng(hash32(`${draft.id}|opponent|${draft.round}`));
  const club = world.clubs[hash32(`${draft.id}|club|${draft.round}`) % world.clubs.length];
  const team = generateTeam(rng, { name: club.name, short: club.short, primary: club.primary, secondary: club.secondary }, 72 + draft.round * 3, false);
  team.id = `draft-opponent-${draft.round}`;
  for (const player of team.players) { player.fitness = 100; player.injuryWeeks = 0; }
  return team;
}

export function applyDraftResult(state: LegendsState, won: boolean, goalsFor: number, goalsAgainst: number, opponentName: string, now = Date.now()): void {
  const draft = state.draft;
  if (!draft || draft.round < 1 || draft.round > DRAFT_ROUNDS || draft.eliminated) return;
  state.history.unshift({ id: `${draft.id}-r${draft.round}`, mode: 'draft', at: now, opponent: opponentName, goalsFor, goalsAgainst, coins: 0 });
  progressTask(state, 'play', 1);
  progressTask(state, 'goals', goalsFor);
  if (won) { draft.wins++; draft.round++; progressTask(state, 'draft-win', 1); } else draft.eliminated = true;
  if (draft.round > DRAFT_ROUNDS) draft.round = DRAFT_ROUNDS + 1;
}

export function claimDraftReward(state: LegendsState): { coins: number; pack: PackId | null } | null {
  const draft = state.draft;
  if (!draft || draft.rewardClaimed || !(draft.eliminated || draft.round > DRAFT_ROUNDS)) return null;
  const reward = DRAFT_REWARDS[Math.min(draft.wins, DRAFT_REWARDS.length - 1)];
  state.coins += reward.coins;
  if (reward.pack) state.packs.push(reward.pack);
  draft.rewardClaimed = true;
  return reward;
}

// ── Daily and weekly tasks ──────────────────────────────────────────────────

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** ISO week, e.g. 2026-W40. */
export function weekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const DAILY: Array<Pick<LegendsTask, 'kind' | 'target' | 'reward'>> = [
  { kind: 'win-rivals', target: 1, reward: { coins: 500, pack: null } },
  { kind: 'play', target: 2, reward: { coins: 300, pack: null } },
  { kind: 'goals', target: 3, reward: { coins: 0, pack: 'bronze' } },
  { kind: 'open-pack', target: 1, reward: { coins: 250, pack: null } },
  { kind: 'clean-sheet', target: 1, reward: { coins: 400, pack: null } },
];
const WEEKLY: Array<Pick<LegendsTask, 'kind' | 'target' | 'reward'>> = [
  { kind: 'win-rivals', target: 5, reward: { coins: 0, pack: 'silver' } },
  { kind: 'draft-win', target: 2, reward: { coins: 0, pack: 'gold' } },
  { kind: 'sbc', target: 1, reward: { coins: 2000, pack: null } },
  { kind: 'goals', target: 12, reward: { coins: 0, pack: 'silver' } },
];

/** Replaces expired tasks: three daily and three weekly ones, chosen by date. */
export function ensureTasks(state: LegendsState, now = Date.now()): void {
  const date = new Date(now);
  const keys = { daily: dayKey(date), weekly: weekKey(date) };
  state.tasks = state.tasks.filter((task) => task.periodKey === keys[task.period]);
  for (const period of ['daily', 'weekly'] as const) {
    if (state.tasks.some((task) => task.period === period)) continue;
    const pool = period === 'daily' ? DAILY : WEEKLY;
    const rng = new Rng(hash32(`${state.seed}|tasks|${keys[period]}`));
    for (const template of rng.shuffle(pool).slice(0, 3)) {
      state.tasks.push({ id: `task-${keys[period]}-${template.kind}`, period, periodKey: keys[period], ...template, reward: { ...template.reward }, progress: 0, claimed: false });
    }
  }
}

export function progressTask(state: LegendsState, kind: LegendsTaskKind, amount: number): void {
  for (const task of state.tasks) if (task.kind === kind && !task.claimed) task.progress = Math.min(task.target, task.progress + amount);
}

export function claimTask(state: LegendsState, taskId: string): boolean {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.claimed || task.progress < task.target) return false;
  task.claimed = true;
  state.coins += task.reward.coins;
  if (task.reward.pack) state.packs.push(task.reward.pack);
  return true;
}

// ── Squad Building Challenges ───────────────────────────────────────────────

export interface SbcDefinition {
  id: string;
  de: string;
  en: string;
  descriptionDe: string;
  descriptionEn: string;
  size: number;
  repeatable: boolean;
  reward: PackId;
  check: (cards: LegendsCard[]) => boolean;
}

const average = (cards: LegendsCard[]) => cards.reduce((sum, card) => sum + card.player.overall, 0) / Math.max(1, cards.length);

export const SBCS: SbcDefinition[] = [
  { id: 'bronze-swap', de: 'Bronze-Tausch', en: 'Bronze swap', descriptionDe: '11 Bronze-Karten', descriptionEn: '11 bronze cards', size: 11, repeatable: true, reward: 'silver', check: (cards) => cards.every((card) => card.tier === 'bronze') },
  { id: 'nation-mix', de: 'Nationen-Mix', en: 'Nation mix', descriptionDe: '11 Karten, mindestens 4 Nationen, Ø-Wertung ≥ 64', descriptionEn: '11 cards, at least 4 nations, average ≥ 64', size: 11, repeatable: false, reward: 'gold', check: (cards) => new Set(cards.map((card) => card.nation)).size >= 4 && average(cards) >= 64 },
  { id: 'league-loyalty', de: 'Ligatreue', en: 'League loyalty', descriptionDe: '11 Karten aus derselben Liga, Ø-Wertung ≥ 66', descriptionEn: '11 cards from one league, average ≥ 66', size: 11, repeatable: false, reward: 'gold', check: (cards) => new Set(cards.map((card) => card.leagueId)).size === 1 && average(cards) >= 66 },
  { id: 'gold-upgrade', de: 'Gold-Upgrade', en: 'Gold upgrade', descriptionDe: '5 Gold-Karten', descriptionEn: '5 gold cards', size: 5, repeatable: true, reward: 'premium', check: (cards) => cards.every((card) => card.tier === 'gold') },
];

export function sbcAvailable(state: LegendsState, sbc: SbcDefinition): boolean {
  return sbc.repeatable || !state.completedSbcs.includes(sbc.id);
}

/** Cheapest eligible cards outside the squad, or null if the collection cannot complete it. */
export function suggestSbc(state: LegendsState, sbcId: string): string[] | null {
  const sbc = SBCS.find((candidate) => candidate.id === sbcId);
  if (!sbc || !sbcAvailable(state, sbc)) return null;
  const free = state.cards.filter((card) => !inSquad(state, card.id)).sort((a, b) => quickSellValue(a) - quickSellValue(b));
  const attempt = (pool: LegendsCard[]) => {
    const pick = pool.slice(0, sbc.size);
    return pick.length === sbc.size && sbc.check(pick) ? pick.map((card) => card.id) : null;
  };
  if (sbcId === 'bronze-swap') return attempt(free.filter((card) => card.tier === 'bronze'));
  if (sbcId === 'gold-upgrade') return attempt(free.filter((card) => card.tier === 'gold'));
  if (sbcId === 'league-loyalty') {
    for (const leagueId of new Set(free.map((card) => card.leagueId))) {
      // Highest-rated cards of the league until the average fits, then the cheapest that keep it.
      const pool = free.filter((card) => card.leagueId === leagueId).sort((a, b) => b.player.overall - a.player.overall).slice(0, sbc.size);
      const found = attempt(pool);
      if (found) return found;
    }
    return null;
  }
  // Nation mix: one card from each of four nations, then fill by rating.
  const byNation = new Map<string, LegendsCard>();
  for (const card of [...free].sort((a, b) => b.player.overall - a.player.overall)) if (!byNation.has(card.nation)) byNation.set(card.nation, card);
  const seeds = [...byNation.values()].slice(0, 4);
  const rest = free.filter((card) => !seeds.includes(card)).sort((a, b) => b.player.overall - a.player.overall);
  return attempt([...seeds, ...rest]);
}

export function submitSbc(state: LegendsState, sbcId: string, cardIds: string[]): { ok: boolean; reason?: 'invalid' | 'done' } {
  const sbc = SBCS.find((candidate) => candidate.id === sbcId);
  if (!sbc) return { ok: false, reason: 'invalid' };
  if (!sbcAvailable(state, sbc)) return { ok: false, reason: 'done' };
  const cards = cardIds.map((id) => state.cards.find((card) => card.id === id)).filter((card): card is LegendsCard => !!card && !inSquad(state, card.id));
  if (new Set(cardIds).size !== sbc.size || cards.length !== sbc.size || !sbc.check(cards)) return { ok: false, reason: 'invalid' };
  state.cards = state.cards.filter((card) => !cardIds.includes(card.id));
  state.packs.push(sbc.reward);
  if (!state.completedSbcs.includes(sbc.id)) state.completedSbcs.push(sbc.id);
  progressTask(state, 'sbc', 1);
  return { ok: true };
}
