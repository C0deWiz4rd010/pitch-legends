import { League } from './league.model';
import { MatchResult } from './match.model';
import { Team } from './team.model';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface NewsItem {
  id: string;
  week: number;
  icon: string;
  title: string;
  body: string;
}

export interface GameSettings {
  difficulty: Difficulty;
  soundEnabled: boolean;
  /** Seed for reproducible match simulation when enabled. */
  autoSave: boolean;
}

export function defaultSettings(): GameSettings {
  return { difficulty: 'normal', soundEnabled: false, autoSave: true };
}

export const SAVE_VERSION = 1;

export interface GameState {
  version: number;
  createdAt: number;
  updatedAt: number;
  managerName: string;
  clubId: string;
  teams: Team[];
  league: League;
  results: MatchResult[];
  news: NewsItem[];
  settings: GameSettings;
}
