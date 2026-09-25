import { Injectable, computed, inject, signal } from '@angular/core';
import { GameState } from '../../models/game.model';
import { Team } from '../../models/team.model';
import { Player } from '../../models/player.model';
import { Fixture, StandingRow } from '../../models/league.model';
import { createNewGame, NewGameOptions } from '../../data/generators';
import { playerName } from '../ratings';
import { SaveService } from './save.service';
import { prepareTravelEvent } from '../travel-engine';
import { computeStandings } from '../standings';

@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly saves = inject(SaveService);
  private readonly state = signal<GameState | null>(null);
  private pendingSave: GameState | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.flushSave());
  }

  readonly game = this.state.asReadonly();
  readonly hasGame = computed(() => this.state() !== null);

  readonly playerTeam = computed<Team | null>(() => {
    const g = this.state();
    if (!g) return null;
    return g.teams.find((t) => t.id === g.clubId) ?? null;
  });

  readonly squad = computed<Player[]>(() => this.playerTeam()?.players ?? []);
  readonly coins = computed(() => this.playerTeam()?.coins ?? 0);
  readonly currentWeek = computed(() => this.state()?.league.currentWeek ?? 1);
  readonly season = computed(() => this.state()?.league.season ?? 1);
  readonly totalWeeks = computed(() => this.state()?.league.totalWeeks ?? 0);
  readonly news = computed(() => this.state()?.news ?? []);
  readonly trainingSlotsRemaining = computed(() => {
    const training = this.state()?.trainingWeek;
    return training ? Math.max(0, training.maxSlots - training.slotsUsed) : 0;
  });
  readonly manager = computed(() => this.state()?.manager ?? null);

  /** Full league standings sorted by points, then goal difference, then goals. */
  readonly standings = computed<StandingRow[]>(() => {
    const g = this.state();
    return g ? computeStandings(g.teams, g.league.fixtures) : [];
  });

  readonly nextFixture = computed<Fixture | null>(() => {
    const g = this.state();
    const team = this.playerTeam();
    if (!g || !team) return null;
    return (
      g.league.fixtures.find(
        (f) => !f.played && (f.homeTeamId === team.id || f.awayTeamId === team.id),
      ) ?? null
    );
  });

  readonly seasonOver = computed(() => {
    const g = this.state();
    if (!g) return false;
    return g.league.fixtures.every((f) => f.played);
  });

  readonly topScorers = computed(() => {
    const g = this.state();
    if (!g) return [];
    return g.teams
      .flatMap((t) => t.players.map((p) => ({ player: p, teamName: t.shortName })))
      .filter((e) => e.player.seasonStats.goals > 0)
      .sort((a, b) => b.player.seasonStats.goals - a.player.seasonStats.goals)
      .slice(0, 12);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  newGame(opts: NewGameOptions): void {
    const g = createNewGame(opts);
    this.discardPendingSave();
    prepareTravelEvent(g);
    this.state.set(g);
    this.saves.save(g);
  }

  loadFromStorage(): boolean {
    const g = this.saves.load();
    this.discardPendingSave();
    if (g) {
      prepareTravelEvent(g);
      this.state.set(g);
      return true;
    }
    return false;
  }

  importState(g: GameState): void {
    this.discardPendingSave();
    this.state.set(g);
    this.saves.save(g);
  }

  deleteGame(): void {
    this.discardPendingSave();
    this.saves.clear();
    this.state.set(null);
  }

  exportSave(): void {
    const g = this.state();
    if (g) this.saves.exportToFile(g);
  }

  hasStoredSave(): boolean {
    return this.saves.hasSave();
  }

  hasLegacySave(): boolean {
    return this.saves.hasLegacySave();
  }

  /**
   * Apply a mutation to a cloned copy of state and persist it. All game logic
   * goes through here so persistence & change-detection stay consistent.
   */
  mutate(fn: (draft: GameState) => void): void {
    const current = this.state();
    if (!current) return;
    const draft = structuredClone(current) as GameState;
    fn(draft);
    draft.updatedAt = Date.now();
    this.state.set(draft);
    if (draft.settings.autoSave) this.scheduleSave(draft);
  }

  /** Bursts of mutations (season simulation, bulk edits) serialise the career once. */
  private scheduleSave(state: GameState): void {
    this.pendingSave = state;
    if (this.saveTimer === null) this.saveTimer = setTimeout(() => this.flushSave(), 150);
  }

  private discardPendingSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pendingSave = null;
  }

  /** Persists a pending autosave immediately. */
  flushSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const state = this.pendingSave;
    this.pendingSave = null;
    if (state) this.saves.save(state);
  }

  /** Convenience lookup helpers. */
  teamById(id: string): Team | undefined {
    return this.state()?.teams.find((t) => t.id === id);
  }

  managerForTeam(teamId: string) {
    const game = this.state();
    if (!game) return undefined;
    return teamId === game.clubId ? game.manager : game.managers.find((manager) => manager.clubId === teamId);
  }

  cityForTeam(teamId: string) {
    return this.state()?.world.cities.find((city) => city.teamId === teamId);
  }

  playerLabel(id: string | null): string {
    if (!id) return '—';
    const p = this.state()
      ?.teams.flatMap((t) => t.players)
      .find((pl) => pl.id === id);
    return p ? playerName(p) : '—';
  }
}
