import { Injectable } from '@angular/core';
import { defaultSettings, GameState, SAVE_VERSION } from '../../models/game.model';
import { ensureGameVisuals } from '../visual-identity';

const STORAGE_KEY = 'pitch-legends:save:v3';
const V2_STORAGE_KEY = 'pitch-legends:save:v2';
const LEGACY_STORAGE_KEY = 'pitch-legends:save:v1';

@Injectable({ providedIn: 'root' })
export class SaveService {
  load(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(V2_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GameState;
      if (!this.validateBase(parsed)) return null;
      parsed.settings = { ...defaultSettings(), ...parsed.settings };
      const migrated = ensureGameVisuals(parsed);
      if (parsed.version !== SAVE_VERSION) this.save(migrated);
      return migrated;
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
    localStorage.removeItem(V2_STORAGE_KEY);
  }

  hasSave(): boolean {
    return !!localStorage.getItem(STORAGE_KEY) || !!localStorage.getItem(V2_STORAGE_KEY);
  }

  hasLegacySave(): boolean {
    return !!localStorage.getItem(LEGACY_STORAGE_KEY) || (!!localStorage.getItem(V2_STORAGE_KEY) && !localStorage.getItem(STORAGE_KEY));
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
    return ensureGameVisuals(game);
  }

  private validateBase(value: unknown): value is GameState {
    if (!value || typeof value !== 'object') return false;
    const g = value as Partial<GameState>;
    if (![2, SAVE_VERSION].includes(g.version ?? -1) || typeof g.clubId !== 'string') return false;
    if (!Array.isArray(g.teams) || !g.teams.length || !g.league || !Array.isArray(g.league.fixtures)) return false;
    if (!g.settings || !['de', 'en'].includes(g.settings.locale) || ![3, 5, 8].includes(g.settings.matchDuration)) return false;
    if (!g.manager || !g.trainingWeek || !Array.isArray(g.objectives) || !Array.isArray(g.transferMarket)) return false;
    return g.teams.every(
      (team) =>
        !!team &&
        typeof team.id === 'string' &&
        Array.isArray(team.players) &&
        team.players.every((player) => !!player.archetype && !!player.talentRanks && !!player.personalGoal),
    );
  }
}
