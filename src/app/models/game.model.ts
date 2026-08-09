import { League } from './league.model';
import { AssistPreset, MatchResult } from './match.model';
import { Team } from './team.model';
import { TransferState } from './transfer.model';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Locale = 'de' | 'en';
export type MatchDuration = 3 | 5 | 8;
export type ManagerPerkPath = 'coaching' | 'tactics' | 'scouting' | 'leadership';
export type InputAction = 'move' | 'pass' | 'through' | 'lob' | 'shoot' | 'sprint' | 'skill' | 'switch' | 'tactics' | 'keeper';

export interface ControlLearningState {
  introSeen: boolean;
  completedActions: InputAction[];
  dismissedHints: InputAction[];
  preferredDevice: import('./match.model').InputDevice;
}

export type MessageParams = Record<string, string | number>;

export interface NewsItem {
  id: string;
  week: number;
  icon: string;
  titleKey: string;
  bodyKey: string;
  params?: MessageParams;
}

export interface ManagerProfile {
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  perks: Partial<Record<ManagerPerkPath, number>>;
}

export interface TrainingWeekState {
  season: number;
  week: number;
  slotsUsed: number;
  maxSlots: number;
}

export interface CareerObjective {
  id: string;
  type: 'league-position' | 'player-growth' | 'wins';
  target: number;
  progress: number;
  rewardCoins: number;
  rewardXp: number;
  completed: boolean;
}

export interface GameSettings {
  difficulty: Difficulty;
  soundEnabled: boolean;
  autoSave: boolean;
  locale: Locale;
  matchDuration: MatchDuration;
  musicVolume: number;
  sfxVolume: number;
  assistPreset: AssistPreset;
  cameraShake: boolean;
  reducedMotion: boolean;
  controlLearning: ControlLearningState;
}

export function defaultSettings(): GameSettings {
  return {
    difficulty: 'normal',
    soundEnabled: true,
    autoSave: true,
    locale: 'de',
    matchDuration: 3,
    musicVolume: 0.35,
    sfxVolume: 0.65,
    assistPreset: 'balanced',
    cameraShake: true,
    reducedMotion: false,
    controlLearning: {
      introSeen: false,
      completedActions: [],
      dismissedHints: [],
      preferredDevice: 'keyboard',
    },
  };
}

export const SAVE_VERSION = 4;

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
  manager: ManagerProfile;
  trainingWeek: TrainingWeekState;
  objectives: CareerObjective[];
  transfers: TransferState;
}
