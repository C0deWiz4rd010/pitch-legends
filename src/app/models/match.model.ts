export type MatchEventType =
  | 'kickoff'
  | 'chance'
  | 'shot'
  | 'save'
  | 'goal'
  | 'foul'
  | 'yellow'
  | 'red'
  | 'injury'
  | 'sub'
  | 'corner'
  | 'halftime'
  | 'fulltime'
  | 'commentary';

export type Side = 'home' | 'away';
export type MatchMode = 'play' | 'coach' | 'instant';

export interface MatchConfig {
  mode: MatchMode;
  controlledTeamId: string;
  halfMinutes: 3 | 5 | 8;
  seed?: number;
}

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  side: Side | null;
  playerId: string | null;
  playerName?: string;
  assistName?: string;
  messageKey?: string;
  params?: Record<string, string | number>;
  /** Fallback for legacy/internal commentary while every event is localised. */
  text?: string;
}

export interface InputFrame {
  moveX: number;
  moveY: number;
  sprint: boolean;
  pass: boolean;
  through: boolean;
  shoot: boolean;
  switchPlayer: boolean;
}

export interface TeamMatchStats {
  possession: number; // percentage 0-100
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  yellows: number;
  reds: number;
  passAccuracy: number;
}

export function emptyTeamMatchStats(): TeamMatchStats {
  return {
    possession: 50,
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    fouls: 0,
    yellows: 0,
    reds: 0,
    passAccuracy: 80,
  };
}

/** A lightweight positional snapshot used by the canvas renderer. */
export interface MatchKeyframe {
  minute: number;
  /** Ball position in normalised pitch coords (0-1, 0-1). */
  ball: { x: number; y: number };
  /** true when the possession/attack belongs to home. */
  homeInPossession: boolean;
}

export interface MatchResult {
  id: string;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  homeStats: TeamMatchStats;
  awayStats: TeamMatchStats;
  keyframes: MatchKeyframe[];
  manOfTheMatchId: string | null;
  /** Per-player match ratings keyed by player id. */
  ratings: Record<string, number>;
  /** Per-player goal/assist/card tallies keyed by player id. */
  contributions: Record<string, MatchContribution>;
  played: boolean;
}

export interface MatchContribution {
  goals: number;
  assists: number;
  yellows: number;
  reds: number;
}

export function emptyContribution(): MatchContribution {
  return { goals: 0, assists: 0, yellows: 0, reds: 0 };
}
