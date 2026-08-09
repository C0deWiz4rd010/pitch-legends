import { Injectable } from '@angular/core';
import { defaultSettings, GameState, SAVE_VERSION } from '../../models/game.model';
import { ensureGameVisuals } from '../visual-identity';

const STORAGE_KEY = 'pitch-legends:save:v4';
const V3_STORAGE_KEY = 'pitch-legends:save:v3';
const V2_STORAGE_KEY = 'pitch-legends:save:v2';
const LEGACY_STORAGE_KEY = 'pitch-legends:save:v1';

@Injectable({ providedIn: 'root' })
export class SaveService {
  load(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GameState;
      if (!this.validateBase(parsed)) return null;
      parsed.settings = { ...defaultSettings(), ...parsed.settings };
      parsed.trainingWeek = this.normaliseTrainingWeek(parsed.trainingWeek);
      return ensureGameVisuals(parsed);
    } catch {
      return null;
    }
  }

  save(state: GameState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable — fail silently, the game stays playable.
    }
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  hasSave(): boolean {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  hasLegacySave(): boolean {
    return !!localStorage.getItem(LEGACY_STORAGE_KEY) || !!localStorage.getItem(V2_STORAGE_KEY) || !!localStorage.getItem(V3_STORAGE_KEY);
  }

  /** Serialise the current state to a downloadable JSON file. */
  exportToFile(state: GameState): void {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pitch-legends-${state.managerName}-s${state.league.season}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Parse an imported JSON string into a GameState (throws on invalid data). */
  parseImport(json: string): GameState {
    const parsed: unknown = JSON.parse(json);
    if (!this.validateBase(parsed)) {
      throw new Error('Invalid save file.');
    }
    const game = parsed as GameState;
    game.settings = { ...defaultSettings(), ...game.settings };
    game.trainingWeek = this.normaliseTrainingWeek(game.trainingWeek);
    return ensureGameVisuals(game);
  }

  private normaliseTrainingWeek(training: GameState['trainingWeek']): GameState['trainingWeek'] {
    return {
      season: training.season,
      week: training.week,
      slotsUsed: Math.max(0, Math.min(3, training.slotsUsed ?? 0)),
      maxSlots: 3,
      completedSessions: Array.isArray(training.completedSessions) ? training.completedSessions : [],
    };
  }

  private validateBase(value: unknown): value is GameState {
    if (!value || typeof value !== 'object') return false;
    const g = value as Partial<GameState>;
    if (g.version !== SAVE_VERSION || typeof g.clubId !== 'string') return false;
    if (!Array.isArray(g.teams) || !g.teams.length || !g.league || !Array.isArray(g.league.fixtures)) return false;
    if (!g.settings || !['de', 'en'].includes(g.settings.locale) || ![3, 5, 8].includes(g.settings.matchDuration)) return false;
    if (!g.manager || !g.trainingWeek || !Array.isArray(g.objectives) || !g.transfers) return false;
    if (!Array.isArray(g.transfers.freeAgents) || !Array.isArray(g.transfers.negotiations) || !Array.isArray(g.transfers.loans)) return false;
    return g.teams.every(
      (team) =>
        !!team &&
        typeof team.id === 'string' &&
        Array.isArray(team.players) &&
        team.players.every((player) => !!player.archetype && !!player.talentRanks && !!player.personalGoal),
    );
  }
}
