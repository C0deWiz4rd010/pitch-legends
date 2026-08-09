/// <reference lib="webworker" />

import { MatchResult } from '../../models/match.model';
import { ArcadeMatch } from './arcade-match';
import type { HeadlessMatchRequest } from './match-engine.service';

addEventListener('message', ({ data }: MessageEvent<HeadlessMatchRequest>) => {
  const match = new ArcadeMatch(data.home, data.away, data.config);
  match.simulateToEnd();
  const result: MatchResult = match.result();
  result.week = data.week;
  postMessage(result);
});
