import { Injectable } from '@angular/core';
import { Team } from '../../models/team.model';
import { MatchConfig, MatchResult } from '../../models/match.model';
import { ArcadeMatch, MATCH_TICK } from './arcade-match';

export interface HeadlessMatchRequest {
  home: Team;
  away: Team;
  week: number;
  config: MatchConfig;
}

@Injectable({ providedIn: 'root' })
export class MatchEngineService {
  createSession(home: Team, away: Team, config: MatchConfig, managerTacticsRank = 0): ArcadeMatch {
    return new ArcadeMatch(home, away, config, config.halfMinutes, config.seed, config.difficulty, managerTacticsRank);
  }

  /** Fast full simulation used for league fixtures. It is the same core as PLAY. */
  simulate(home: Team, away: Team, week: number, seed?: number, fixtureId?: string): MatchResult {
    const match = this.createSession(home, away, this.headlessConfig(home, away, week, seed, fixtureId));
    match.simulateToEnd();
    const result = match.result();
    result.week = week;
    return result;
  }

  /** Worker-first simulation for the visible instant-SIM action. */
  simulateAsync(home: Team, away: Team, week: number, seed?: number, fixtureId?: string): Promise<MatchResult> {
    const request: HeadlessMatchRequest = {
      home: structuredClone(home),
      away: structuredClone(away),
      week,
      config: this.headlessConfig(home, away, week, seed, fixtureId),
    };
    if (typeof Worker === 'undefined') return this.simulateCooperatively(request);
    return new Promise((resolve) => {
      let settled = false;
      let worker: Worker;
      try {
        worker = new Worker(new URL('./match.worker', import.meta.url), { type: 'module' });
      } catch {
        void this.simulateCooperatively(request).then(resolve);
        return;
      }
      const fallback = () => {
        if (settled) return;
        settled = true;
        worker.terminate();
        void this.simulateCooperatively(request).then(resolve);
      };
      worker.onmessage = ({ data }: MessageEvent<MatchResult>) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        resolve(data);
      };
      worker.onerror = fallback;
      worker.postMessage(request);
    });
  }

  private simulateCooperatively(request: HeadlessMatchRequest): Promise<MatchResult> {
    const match = this.createSession(request.home, request.away, request.config);
    return new Promise((resolve) => {
      const run = () => {
        for (let count = 0; count < 720 && !match.finished; count++) {
          if (match.phase === 'halftime') match.resumeSecondHalf();
          if (match.phase === 'goalReplay') match.endReplay();
          match.step(MATCH_TICK);
        }
        if (match.finished) {
          const result = match.result();
          result.week = request.week;
          resolve(result);
        } else {
          setTimeout(run, 0);
        }
      };
      run();
    });
  }

  private headlessConfig(home: Team, away: Team, week: number, seed?: number, fixtureId?: string): MatchConfig {
    return {
      mode: 'instant',
      seed: seed ?? this.stableSeed(`${home.id}|${away.id}|${week}`),
      fixtureId,
      controlledTeamId: home.id,
      halfMinutes: 3,
      difficulty: 'normal',
      assist: 'balanced',
      playerLockId: null,
      weather: 'clear',
      inputDevice: 'ai',
      camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
    };
  }

  private stableSeed(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
}
