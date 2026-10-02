import { Injectable, signal } from '@angular/core';
import { MatchResult, MatchWeather } from '../../models/match.model';
import { Team } from '../../models/team.model';

/** Settings of a match outside the career: Legends Team, quick match, challenges, small-sided. */
export interface ExhibitionRequest {
  id: string;
  home: Team;
  away: Team;
  controlledTeamId: string;
  seed: number;
  title: { de: string; en: string };
  /** Where the "continue" button leads after the match. */
  returnUrl: string;
  returnLabel: { de: string; en: string };
  knockout?: boolean;
  weather?: MatchWeather;
  halfMinutes?: 3 | 5 | 8;
  /** Skip the preview and kick off immediately. */
  autoStart?: boolean;
  /** Offer "rematch" instead of reporting a result. */
  rematch?: boolean;
  smallSided?: boolean;
  challengeId?: string;
  onResult?: (result: MatchResult) => void;
}

/**
 * Hands a match to the match page without touching the career. The request lives in memory only;
 * a reload falls back to the standard practice match.
 */
@Injectable({ providedIn: 'root' })
export class ExhibitionService {
  private readonly pending = signal<ExhibitionRequest | null>(null);
  readonly current = this.pending.asReadonly();

  start(request: ExhibitionRequest): void {
    this.pending.set(request);
  }

  /** Reports the result once and keeps the request for a possible rematch. */
  report(result: MatchResult): void {
    const request = this.pending();
    if (!request?.onResult) return;
    const handler = request.onResult;
    this.pending.set({ ...request, onResult: undefined });
    handler(result);
  }

  clear(): void {
    this.pending.set(null);
  }
}
