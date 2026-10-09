import { Injectable, inject } from '@angular/core';
import { MatchCheckpoint } from '../../models/match.model';
import { PersistentStore, SaveResult, StoreOperation } from '../storage/persistent-store';

export const MATCH_CHECKPOINT_KEY = 'pitch-legends:match-checkpoint:v2';
const LEGACY_MATCH_CHECKPOINT_KEY = 'pitch-legends:match-checkpoint:v1';

type IdleWindow = Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };

@Injectable({ providedIn: 'root' })
export class MatchCheckpointService {
  private readonly store = inject(PersistentStore);
  private pending: MatchCheckpoint | null = null;
  private pendingHandle: number | null = null;

  load(fixtureId?: string): MatchCheckpoint | null {
    this.flush();
    try {
      const raw = this.store.get(MATCH_CHECKPOINT_KEY) ?? this.store.get(LEGACY_MATCH_CHECKPOINT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as any;
      if (value.version === 1 && value.config) {
        const controllerMode = value.config.mode === 'play' ? 'human' : 'auto';
        value.version = 2;
        value.controllerMode = controllerMode;
        value.controllerChangedAtTick = value.tick ?? 0;
        value.config.controllerMode = controllerMode;
        void this.store.batch([{ key: MATCH_CHECKPOINT_KEY, value: JSON.stringify(value) }, { key: LEGACY_MATCH_CHECKPOINT_KEY, value: null }]);
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

  save(checkpoint: MatchCheckpoint): Promise<SaveResult> {
    this.cancelPending();
    try {
      return this.store.set(MATCH_CHECKPOINT_KEY, JSON.stringify(checkpoint));
    } catch (error) {
      return Promise.resolve({ ok: false, reason: 'unknown', message: String(error) });
    }
  }

  /** Keeps only the newest checkpoint and serialises it without blocking the running frame. */
  saveWhenIdle(checkpoint: MatchCheckpoint): void {
    this.pending = checkpoint;
    if (this.pendingHandle !== null) return;
    const idle = (typeof window !== 'undefined' ? window : undefined) as IdleWindow | undefined;
    const write = () => { this.pendingHandle = null; void this.flush(); };
    this.pendingHandle = idle?.requestIdleCallback
      ? idle.requestIdleCallback(write, { timeout: 1500 })
      : setTimeout(write, 0) as unknown as number;
  }

  /** Writes an outstanding idle checkpoint immediately (leaving the match, pausing, loading). */
  flush(): Promise<SaveResult> {
    const checkpoint = this.pending;
    if (!checkpoint) return Promise.resolve({ ok: true });
    this.pending = null;
    return this.save(checkpoint);
  }

  /**
   * Drops any outstanding checkpoint and returns the operations that delete the stored one,
   * to be written in the same transaction as the career that records the finished match.
   */
  takeClearOperations(): StoreOperation[] {
    this.cancelPending();
    return [MATCH_CHECKPOINT_KEY, LEGACY_MATCH_CHECKPOINT_KEY].map((key) => ({ key, value: null }));
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
    void this.store.batch(this.takeClearOperations());
  }
}
