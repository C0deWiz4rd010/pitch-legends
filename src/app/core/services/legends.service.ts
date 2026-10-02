import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LegendsState, PackId } from '../../models/legends.model';
import { MatchResult } from '../../models/match.model';
import {
  RivalsOutcome, applyDraftResult, applyRivalsResult, buyPack, claimDraftReward, claimTask, createLegendsState, draftOpponent,
  draftPick, draftTeam, ensureTasks, openPack, ownTeam, PackResult, rivalsOpponent, sellCards, setFormation, setSlot, startDraft,
  submitSbc, suggestSbc, surplusDuplicates, weekKey,
} from '../legends/legends-engine';
import { autoBuild, squadView } from '../legends/squad';
import { ExhibitionService } from './exhibition.service';

export const LEGENDS_STORAGE_KEY = 'pitch-legends:legends:v1';

export interface LegendsMatchReport {
  mode: 'rivals' | 'draft';
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  won: boolean;
  rivals?: RivalsOutcome;
}

/** The Legends Team mode: its own save and currency, never connected to the career. */
@Injectable({ providedIn: 'root' })
export class LegendsService {
  private readonly exhibitions = inject(ExhibitionService);
  private readonly router = inject(Router);
  private readonly stateSignal = signal<LegendsState | null>(this.load());
  readonly state = this.stateSignal.asReadonly();
  readonly hasClub = computed(() => !!this.stateSignal());
  readonly squad = computed(() => { const state = this.stateSignal(); return state ? squadView(state) : null; });
  readonly lastReport = signal<LegendsMatchReport | null>(null);
  readonly storageError = signal(false);

  private load(): LegendsState | null {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGENDS_STORAGE_KEY) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LegendsState;
      if (parsed?.version !== 1 || !Array.isArray(parsed.cards) || !parsed.squad) return null;
      ensureTasks(parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(state: LegendsState | null): void {
    try {
      if (state) localStorage.setItem(LEGENDS_STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(LEGENDS_STORAGE_KEY);
      this.storageError.set(false);
    } catch {
      this.storageError.set(true);
    }
  }

  private mutate<T>(fn: (draft: LegendsState) => T): T | null {
    const current = this.stateSignal();
    if (!current) return null;
    const draft = structuredClone(current);
    const result = fn(draft);
    draft.updatedAt = Date.now();
    this.stateSignal.set(draft);
    this.persist(draft);
    return result;
  }

  create(clubName: string, seed = Date.now() >>> 0): void {
    const state = createLegendsState(clubName, seed);
    this.stateSignal.set(state);
    this.persist(state);
  }

  deleteClub(): void {
    this.stateSignal.set(null);
    this.persist(null);
  }

  refreshTasks(): void { this.mutate((draft) => ensureTasks(draft)); }
  buy(packId: PackId) { return this.mutate((draft) => buyPack(draft, packId)) ?? { ok: false }; }
  open(packId: PackId): PackResult | null { return this.mutate((draft) => openPack(draft, packId)); }
  sell(cardIds: string[]): number { return this.mutate((draft) => sellCards(draft, cardIds)) ?? 0; }
  sellDuplicates(): number { return this.mutate((draft) => sellCards(draft, surplusDuplicates(draft))) ?? 0; }
  duplicates(): string[] { const state = this.stateSignal(); return state ? surplusDuplicates(state) : []; }
  setSlot(slotIndex: number, cardId: string | null) { return this.mutate((draft) => setSlot(draft, slotIndex, cardId)) ?? { ok: false }; }
  setFormation(formationId: string): void { this.mutate((draft) => setFormation(draft, formationId)); }
  autoBuild(): void { this.mutate((draft) => { draft.squad = autoBuild(draft.cards, draft.squad.formationId); }); }
  claimTask(taskId: string): boolean { return this.mutate((draft) => claimTask(draft, taskId)) ?? false; }
  startDraft() { return this.mutate((draft) => startDraft(draft, weekKey(new Date()))) ?? { ok: false }; }
  draftPick(slotIndex: number, cardId: string): boolean { return this.mutate((draft) => draftPick(draft, slotIndex, cardId)) ?? false; }
  claimDraft() { return this.mutate((draft) => claimDraftReward(draft)); }
  suggestSbc(sbcId: string): string[] | null { const state = this.stateSignal(); return state ? suggestSbc(state, sbcId) : null; }
  submitSbc(sbcId: string, cardIds: string[]) { return this.mutate((draft) => submitSbc(draft, sbcId, cardIds)) ?? { ok: false }; }

  /** Opens the match page with the Legends squad against the next Rivals opponent. */
  playRivals(): void {
    const state = this.stateSignal();
    if (!state) return;
    const home = ownTeam(state);
    const away = rivalsOpponent(state);
    this.exhibitions.start({
      id: `legends-rivals-${state.seed}-${state.rivals.matchSerial}`,
      home, away, controlledTeamId: home.id,
      seed: (state.seed + state.rivals.matchSerial * 7919) >>> 0,
      title: { de: `Division Rivals · Division ${state.rivals.division}`, en: `Division Rivals · Division ${state.rivals.division}` },
      returnUrl: '/legends', returnLabel: { de: 'Legends Team', en: 'Legends Team' },
      onResult: (result) => this.finishRivals(result, away.name),
    });
    void this.router.navigateByUrl('/play');
  }

  playDraft(): void {
    const state = this.stateSignal();
    const home = state ? draftTeam(state) : null;
    const away = state ? draftOpponent(state) : null;
    if (!state?.draft || !home || !away) return;
    const round = state.draft.round;
    this.exhibitions.start({
      id: `${state.draft.id}-r${round}`,
      home, away, controlledTeamId: home.id, knockout: true,
      seed: (state.seed + round * 104729) >>> 0,
      title: { de: `Draft-Turnier · Runde ${round}/4`, en: `Draft tournament · round ${round}/4` },
      returnUrl: '/legends', returnLabel: { de: 'Legends Team', en: 'Legends Team' },
      onResult: (result) => this.finishDraft(result, away.name),
    });
    void this.router.navigateByUrl('/play');
  }

  private finishRivals(result: MatchResult, opponent: string): void {
    const outcome = this.mutate((draft) => applyRivalsResult(draft, result.homeScore, result.awayScore, opponent));
    this.lastReport.set({ mode: 'rivals', opponent, goalsFor: result.homeScore, goalsAgainst: result.awayScore, won: result.homeScore > result.awayScore, rivals: outcome ?? undefined });
  }

  private finishDraft(result: MatchResult, opponent: string): void {
    const won = result.homeScore > result.awayScore || (result.homeScore === result.awayScore && result.shootout?.winner === 'home');
    this.mutate((draft) => applyDraftResult(draft, won, result.homeScore, result.awayScore, opponent));
    this.lastReport.set({ mode: 'draft', opponent, goalsFor: result.homeScore, goalsAgainst: result.awayScore, won });
  }
}
