import { Injectable } from '@angular/core';
import { GameState, SAVE_VERSION } from '../../models/game.model';

const STORAGE_KEY = 'pitch-legends:save:v1';

@Injectable({ providedIn: 'root' })
export class SaveService {
  load(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GameState;
      if (!parsed || parsed.version !== SAVE_VERSION) return null;
      return parsed;
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
    const parsed = JSON.parse(json) as GameState;
    if (!parsed || typeof parsed !== 'object' || !parsed.teams || !parsed.league) {
      throw new Error('Invalid save file.');
    }
    return parsed;
  }
}
