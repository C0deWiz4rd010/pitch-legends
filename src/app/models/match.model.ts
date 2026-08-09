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
export type AssistPreset = 'assisted' | 'balanced' | 'manual';
export type MatchWeather = 'clear' | 'rain' | 'storm';
export type InputDevice = 'keyboard' | 'gamepad' | 'touch' | 'ai';
export type MatchPhase =
  | 'preMatch'
  | 'intro'
  | 'firstHalf'
  | 'stoppage'
  | 'goalReplay'
  | 'halftime'
  | 'secondHalf'
  | 'fulltime'
  | 'report'
  | 'paused';
export type RulePhase =
  | 'playing'
  | 'advantage'
  | 'freeKick'
  | 'corner'
  | 'throwIn'
  | 'goalKick'
  | 'penalty'
  | 'kickoff'
  | 'halftime'
  | 'fulltime';

export interface MatchConfig {
  mode: MatchMode;
  controlledTeamId: string;
  halfMinutes: 3 | 5 | 8;
  seed: number;
  fixtureId?: string;
  difficulty: 'easy' | 'normal' | 'hard';
  assist: AssistPreset;
  playerLockId: string | null;
  weather: MatchWeather;
  inputDevice: InputDevice;
  camera: MatchCameraSettings;
}

export interface MatchCameraSettings {
  zoom: number;
  lookAhead: number;
  shake: boolean;
  reducedMotion: boolean;
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
  lob?: boolean;
  skill?: boolean;
  keeperRush?: boolean;
  tacticX?: number;
  tacticY?: number;
  pause?: boolean;
  device?: InputDevice;
}

export interface MatchCommand extends Required<InputFrame> {
  aimX: number;
  aimY: number;
}

export const EMPTY_MATCH_COMMAND: MatchCommand = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  sprint: false,
  pass: false,
  through: false,
  lob: false,
  shoot: false,
  skill: false,
  switchPlayer: false,
  keeperRush: false,
  tacticX: 0,
  tacticY: 0,
  pause: false,
  device: 'ai',
};

export interface TeamMatchStats {
  possession: number; // percentage 0-100
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  yellows: number;
  reds: number;
  passAccuracy: number;
  xG: number;
  passesAttempted: number;
  passesCompleted: number;
  tacklesWon: number;
  interceptions: number;
  saves: number;
  offsides: number;
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
    xG: 0,
    passesAttempted: 0,
    passesCompleted: 0,
    tacklesWon: 0,
    interceptions: 0,
    saves: 0,
    offsides: 0,
  };
}

export interface RuleState {
  phase: RulePhase;
  restartSide: Side | null;
  spotX: number;
  spotY: number;
  elapsed: number;
  indirect: boolean;
  advantageSide: Side | null;
  pendingCardPlayerId: string | null;
}

export interface PlayerRuntimeSnapshot {
  id: string;
  side: Side;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  fitness: number;
  active: boolean;
  card: 'none' | 'yellow' | 'red';
  action: string;
  decisionCooldown: number;
  skillCooldown: number;
  tackleCooldown: number;
  intentX: number;
  intentY: number;
}

export interface BallSnapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  ownerId: string | null;
}

export interface MatchSnapshot {
  tick: number;
  phase: MatchPhase;
  footballMinute: number;
  elapsed: number;
  homeScore: number;
  awayScore: number;
  controlledPlayerId: string;
  attackDirection: 1 | -1;
  rule: RuleState;
  ball: BallSnapshot;
  players: PlayerRuntimeSnapshot[];
}

export interface MatchCheckpoint {
  version: 1;
  fixtureId: string;
  matchId: string;
  config: MatchConfig;
  tick: number;
  elapsed: number;
  phase: MatchPhase;
  rngState: number;
  homeScore: number;
  awayScore: number;
  selectedPlayerId: string;
  ball: BallSnapshot & { lastTouch: Side; lastTouchPlayerId: string | null };
  actors: PlayerRuntimeSnapshot[];
  rule: RuleState;
  events: MatchEvent[];
  homeStats: TeamMatchStats;
  awayStats: TeamMatchStats;
  ratings: Record<string, number>;
  contributions: Record<string, MatchContribution>;
  safeSnapshot: MatchSnapshot;
  runtime: {
    previousInput: MatchCommand;
    actionHeld: { pass: number; through: number; lob: number; shoot: number };
    possessionHomeSeconds: number;
    possessionAwaySeconds: number;
    passAttempts: Record<Side, number>;
    passCompletions: Record<Side, number>;
    lastPasser: { id: string; side: Side; at: number } | null;
    pendingOffsideTargetId: string | null;
    intendedReceiverId: string | null;
    activeShot: { shooterId: string; side: Side; xG: number; targetY: number; checkedKeeper: boolean } | null;
    halftimeReached: boolean;
    halftimeRecoveryApplied: boolean;
    subsUsed: number;
    substitutionWindows: number;
    lastSubAt: number;
    keyframes: MatchKeyframe[];
    heatmaps: Record<string, { x: number; y: number; weight: number }[]>;
  };
  savedAt: number;
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
  /** Stable career commit key. Older saves may not contain it. */
  fixtureId?: string;
  matchSeed?: number;
  weather?: MatchWeather;
  heatmaps?: Record<string, { x: number; y: number; weight: number }[]>;
  endingFitness?: Record<string, number>;
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
