import { Injectable } from '@angular/core';
import { MatchCheckpoint } from '../../models/match.model';

export const MATCH_CHECKPOINT_KEY = 'pitch-legends:match-checkpoint:v1';

@Injectable({ providedIn: 'root' })
export class MatchCheckpointService {
  load(fixtureId?: string): MatchCheckpoint | null {
    try {
      const raw = localStorage.getItem(MATCH_CHECKPOINT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<MatchCheckpoint>;
      if (
        value.version !== 1 ||
        typeof value.fixtureId !== 'string' ||
        typeof value.matchId !== 'string' ||
        typeof value.rngState !== 'number' ||
        !value.ball ||
        !Array.isArray(value.actors) ||
        !value.safeSnapshot ||
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
  }
}
