import { Injectable } from '@angular/core';
import { MatchCheckpoint } from '../../models/match.model';

export const MATCH_CHECKPOINT_KEY = 'pitch-legends:match-checkpoint:v2';
const LEGACY_MATCH_CHECKPOINT_KEY = 'pitch-legends:match-checkpoint:v1';

@Injectable({ providedIn: 'root' })
export class MatchCheckpointService {
  load(fixtureId?: string): MatchCheckpoint | null {
    try {
      const raw = localStorage.getItem(MATCH_CHECKPOINT_KEY) ?? localStorage.getItem(LEGACY_MATCH_CHECKPOINT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as any;
      if (value.version === 1 && value.config) {
        const controllerMode = value.config.mode === 'play' ? 'human' : 'auto';
        value.version = 2;
        value.controllerMode = controllerMode;
        value.controllerChangedAtTick = value.tick ?? 0;
        value.config.controllerMode = controllerMode;
        localStorage.setItem(MATCH_CHECKPOINT_KEY, JSON.stringify(value));
      }
      if (
        value.version !== 2 ||
        !['human', 'auto'].includes(value.controllerMode ?? '') ||
        typeof value.controllerChangedAtTick !== 'number' ||
        typeof value.fixtureId !== 'string' ||
        typeof value.matchId !== 'string' ||
        typeof value.rngState !== 'number' ||
        !value.ball ||
        !Array.isArray(value.actors) ||
        !value.safeSnapshot ||
        !value.runtime ||
        (fixtureId && value.fixtureId !== fixtureId)
      ) {
        this.clear();
        return null;
      }
      return value as MatchCheckpoint;
    } catch {
      this.clear();
      return null;
    }
  }

  save(checkpoint: MatchCheckpoint): boolean {
    try {
      localStorage.setItem(MATCH_CHECKPOINT_KEY, JSON.stringify(checkpoint));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    localStorage.removeItem(MATCH_CHECKPOINT_KEY);
    localStorage.removeItem(LEGACY_MATCH_CHECKPOINT_KEY);
  }
}
