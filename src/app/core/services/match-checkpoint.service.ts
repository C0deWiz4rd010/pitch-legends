import { Injectable } from '@angular/core';
import { MatchCheckpoint } from '../../models/match.model';

export const MATCH_CHECKPOINT_KEY = 'pitch-legends:match-checkpoint:v2';
const LEGACY_MATCH_CHECKPOINT_KEY = 'pitch-legends:match-checkpoint:v1';

type IdleWindow = Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };

@Injectable({ providedIn: 'root' })
export class MatchCheckpointService {
  private pending: MatchCheckpoint | null = null;
  private pendingHandle: number | null = null;

  load(fixtureId?: string): MatchCheckpoint | null {
    this.flush();
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
    this.cancelPending();
    try {
      localStorage.setItem(MATCH_CHECKPOINT_KEY, JSON.stringify(checkpoint));
      return true;
    } catch {
      return false;
    }
  }

  /** Keeps only the newest checkpoint and writes it without blocking the running frame. */
  saveWhenIdle(checkpoint: MatchCheckpoint): void {
    this.pending = checkpoint;
    if (this.pendingHandle !== null) return;
    const idle = (typeof window !== 'undefined' ? window : undefined) as IdleWindow | undefined;
    const write = () => { this.pendingHandle = null; this.flush(); };
    this.pendingHandle = idle?.requestIdleCallback
      ? idle.requestIdleCallback(write, { timeout: 1500 })
      : setTimeout(write, 0) as unknown as number;
  }

  /** Writes an outstanding idle checkpoint immediately (leaving the match, pausing, loading). */
  flush(): boolean {
    const checkpoint = this.pending;
    if (!checkpoint) return true;
    this.pending = null;
    return this.save(checkpoint);
  }

  private cancelPending(): void {
    if (this.pendingHandle !== null) {
      const idle = (typeof window !== 'undefined' ? window : undefined) as IdleWindow | undefined;
      if (idle?.cancelIdleCallback) idle.cancelIdleCallback(this.pendingHandle);
      else clearTimeout(this.pendingHandle);
    }
    this.pendingHandle = null;
    this.pending = null;
  }

  clear(): void {
    this.cancelPending();
    localStorage.removeItem(MATCH_CHECKPOINT_KEY);
    localStorage.removeItem(LEGACY_MATCH_CHECKPOINT_KEY);
  }
}
