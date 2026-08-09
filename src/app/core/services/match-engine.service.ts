import { Injectable } from '@angular/core';
import { Team } from '../../models/team.model';
import { MatchResult } from '../../models/match.model';
import { Rng } from '../util';
import { LiveMatch, finalizeMatch, initMatchState, simulateMinute } from './match-sim';

@Injectable({ providedIn: 'root' })
export class MatchEngineService {
  /** Fast full simulation used for AI-vs-AI fixtures. */
  simulate(home: Team, away: Team, week: number, seed?: number): MatchResult {
    const state = initMatchState(home, away, week, new Rng(seed ?? (Date.now() >>> 0)));
    for (let minute = 1; minute <= 90; minute++) {
      simulateMinute(state, minute);
    }
    return finalizeMatch(state);
  }

  /** Interactive match the manager can influence live (used for their own fixture). */
  createLiveMatch(home: Team, away: Team, week: number, controlledTeamId = home.id, seed?: number): LiveMatch {
    return new LiveMatch(home, away, week, controlledTeamId, seed);
  }
}
