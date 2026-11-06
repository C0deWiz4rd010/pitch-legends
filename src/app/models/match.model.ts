import type { Team } from './team.model';

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
export type MatchControllerMode = 'human' | 'auto';
export type AssistPreset = 'assisted' | 'balanced' | 'manual';
export type MatchWeather = 'clear' | 'rain' | 'storm';
export type InputDevice = 'keyboard' | 'gamepad' | 'touch' | 'ai';
export type PlayerActionState =
  | 'formation'
  | 'idle'
  | 'jog'
  | 'sprint'
  | 'carry'
  | 'close-control'
  | 'receive'
  | 'heavy-touch'
  | 'pass'
  | 'through-pass'
  | 'lob'
  | 'shot'
  | 'low-shot'
  | 'finesse-shot'
  | 'chip-shot'
  | 'header'
  | 'ball-roll'
  | 'drag-back'
  | 'body-feint'
  | 'knock-on'
  | 'jockey'
  | 'skill-failed'
  | 'press'
  | 'support-press'
  | 'standing-tackle'
  | 'slide'
  | 'stumble'
  | 'injured'
  | 'celebrate'
  | 'keeper-ready'
  | 'keeper-rush'
  | 'keeper-catch'
  | 'keeper-parry'
  | 'keeper-dive'
  | 'keeper-throw'
  | 'keeper-kick'
  | 'keeper-punch'
  | 'keeper-smother'
  | 'volley'
  | 'bicycle-kick'
  | 'flying-header'
  | 'wall-jump'
  | 'fake-shot'
  | 'subbed-on';
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
  controllerMode: MatchControllerMode;
  controlledTeamId: string;
  halfMinutes: 3 | 5 | 8;
  seed: number;
  fixtureId?: string;
  difficulty: 'easy' | 'normal' | 'hard';
  /** How well the player's own AI team-mates play; omitted means normal. */
  teammateAi?: 'easy' | 'normal' | 'hard';
  assist: AssistPreset;
  autoSwitch?: 'receivers' | 'assisted' | 'manual';
  playerLockId: string | null;
  weather: MatchWeather;
  /** Set to false to ignore traits, form and morale (balance comparisons); default on. */
  effects?: boolean;
  /** Rarity rings in the match: on (default), subtle or off. */
  auras?: 'on' | 'subtle' | 'off';
  /** Play a drawn knockout tie's penalties yourself (default on in PLAY mode). */
  interactiveShootout?: boolean;
  /** A match against a rival; quirks such as Derby Hero react to it. */
  derby?: boolean;
  /** A cup or top-of-the-table match for the Big-Game quirk. */
  bigMatch?: boolean;
  inputDevice: InputDevice;
  camera: MatchCameraSettings;
  /** Cup ties: a draw after 90 minutes goes to extra time and then penalties. */
  knockout?: boolean;
  /** Five-a-side cage: small pitch and goals, boards instead of touchlines, no offside. */
  smallSided?: boolean;
}

export interface PenaltyShootout {
  home: boolean[];
  away: boolean[];
  takers: { home: string[]; away: string[] };
  winner: Side;
}

export type MatchCameraPreset = 'arcade' | 'tv' | 'tactic';

export interface MatchCameraSettings {
  /** Broadcast angle; older configs derive it from the zoom value. */
  preset?: MatchCameraPreset;
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
  /** Goal credited to the opponents after the last touch of a defending player. */
  ownGoal?: boolean;
  messageKey?: string;
  params?: Record<string, string | number>;
  /** Fallback for legacy/internal commentary while every event is localised. */
  text?: string;
  injury?: import('./player.model').InjuryRecord;
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
  /** Contain the ball carrier: stay goal-side, face the ball, move with restraint. */
  jockey?: boolean;
  /** Fire the Mythic ultimate of the team (needs a full focus meter). */
  ultimate?: boolean;
  /**
   * Modifier button. Held when a pass is released it plays a sharp, flat ball; held (or tapped) when a shot is released
   * or during the wind-up it turns the kick into a feint (a pass is only cancelled).
   */
  modifier?: boolean;
  /** Asks the team-mate nearest to the ball and furthest forward for a run in behind. */
  request?: boolean;
  /** Right stick: flick in a direction to pick the team-mate that way (screen convention, like move). */
  pickX?: number;
  pickY?: number;
  tacticX?: number;
  tacticY?: number;
  pause?: boolean;
  device?: InputDevice;
}

/** A kick that has been released but whose ball contact (see ACTION_CONTACT_TICKS) has not happened yet. */
export interface PendingKick {
  actorId: string;
  startTick: number;
  contactTick: number;
  type: 'pass' | 'shoot' | 'cross' | 'volley' | 'bicycle-kick' | 'flying-header';
  power: number;
  aimX: number;
  aimY: number;
  through?: boolean;
  lob?: boolean;
  forcedId?: string;
  /** Sharp flat pass (modifier held at release). */
  sharp?: boolean;
  finesse?: boolean;
  low?: boolean;
  chip?: boolean;
  driven?: boolean;
  /** Second shoot press inside the wind-up: the finish is cleaner. */
  timed?: boolean;
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
  jockey: false,
  ultimate: false,
  modifier: false,
  request: false,
  pickX: 0,
  pickY: 0,
  tacticX: 0,
  tacticY: 0,
  pause: false,
  device: 'ai',
};

export interface TeamMatchStats {
  /** Shots blocked by outfield players. */
  blocks?: number;
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

export interface FootballContact {
  tick: number;
  x: number;
  y: number;
  z: number;
  kind: 'foot' | 'head' | 'hand';
  foot: 'left' | 'right';
  /** Close-control touches while dribbling are presented quieter than strikes. */
  dribble?: boolean;
}

export interface PlayerRuntimeSnapshot {
  contact?: FootballContact;
  actionTarget?: {x:number;y:number;z:number};
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
  action: PlayerActionState;
  actionStartedTick: number;
  decisionCooldown: number;
  skillCooldown: number;
  tackleCooldown: number;
  intentX: number;
  intentY: number;
  /** Presentation-only locomotion phase in travelled metres; excluded from simulation hashes. */
  animationDistance: number;
}

export interface BallSnapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  /** Positive topspin dips and kicks on, negative backspin floats and checks up. */
  topspin?: number;
  ownerId: string | null;
  controlledTouch: number;
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

/** Small immutable state consumed by the renderer between fixed simulation ticks. */
export interface MatchRenderState {
  tick: number;
  controlledPlayerId: string;
  attackDirection: 1 | -1;
  /** Bumps whenever players or ball are placed rather than moved (restarts, kick-off, substitutions, restores). */
  teleportEpoch: number;
  ball: BallSnapshot;
  players: PlayerRuntimeSnapshot[];
}

export interface MatchRenderFrame {
  previous: MatchRenderState;
  current: MatchRenderState;
  alpha: number;
  deltaSeconds: number;
}

/** Throttled reactive projection for Angular HUD elements. */
export interface MatchViewState {
  footballMinute: number;
  homeScore: number;
  awayScore: number;
  phase: MatchPhase;
  rulePhase: RulePhase;
  momentumHome: number;
  controlledPlayerId: string;
  controlledFitness: number;
  controllerMode: MatchControllerMode;
  eventRevision: number;
  /** Announced added minutes (0 before the end of regular time). */
  stoppage: number;
  /** Minutes already played beyond 45/90. */
  stoppageMinute: number;
  extraTime: boolean;
  /** Focus meter of the controlled side (0-100), and whether it has a Mythic player to use it. */
  focus: number;
  hasUltimate: boolean;
  /** Seconds left before a waiting human restart is taken automatically (0 when none waits). */
  restartSeconds: number;
}

export interface MatchCheckpoint {
  version: 2;
  controllerMode: MatchControllerMode;
  controllerChangedAtTick: number;
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
    teamState?: Record<Side, Pick<Team, 'formation' | 'tactics'>>;
    football?: {
      selectionUntilTick: number;
      switchCandidate?: {id:string;sinceTick:number} | null;
      queuedAction: { kind: 'pass' | 'through' | 'lob' | 'shoot'; expiresTick: number; power: number; aimX: number; aimY: number; finesse: boolean; low: boolean; chip?: boolean; sharp?: boolean; feint?: boolean } | null;
      offsideCandidates: string[];
      oneTwoRunnerId: string | null;
      oneTwoUntilTick: number;
      restartRelease?: { phase: RuleState['phase']; side: Side; takerId: string; indirect?: boolean } | null;
      subbedOutIds?: string[];
      /** Players hurt during this match; they limp until substituted. */
      injuredIds?: string[];
      /** Substitution budget of the side that is not managed by the player. */
      opponentSubs?: { used: number; windows: number; lastAt: number };
      /** Added football minutes per half and the real seconds the first half ran over. */
      stoppage?: { added: [number, number]; overrun: number };
      /** Extra time of a knockout tie: current period and the elapsed time it started at. */
      extra?: { period: 1 | 2; periodStart: number };
      /** Defenders that already had their one try at the pass currently in flight. */
      interceptTried?: string[];
      /** Per player: the tick until which a kick, tackle or lunge still slows the body down. */
      recoveryUntil?: Record<string, number>;
      /** The kick between release and ball contact (wind-up); at most one, as only one player owns the ball. */
      pendingKick?: PendingKick | null;
      /** The release of a shoot press that only served as the timing tap of a finish is not a shot of its own. */
      ignoreRelease?: boolean;
      /** A team-mate sent on a run in behind (the "request run" button). */
      runRequest?: { id: string; side: Side; untilTick: number } | null;
      /** AI give-and-go: the receiver hands the ball straight back to the runner. */
      oneTwoReturn?: { receiverId: string; runnerId: string; untilTick: number } | null;
      /** A yellow card held back during an advantage; shown at the next stoppage. */
      pendingYellow?: string | null;
      /** Cards waiting for the next stoppage because the referee played advantage. */
      pendingCards?: { playerId: string; side: Side; card: 'yellow' | 'red' }[];
    };
    previousInput: MatchCommand;
    actionHeld: { pass: number; through: number; lob: number; shoot: number };
    possessionHomeSeconds: number;
    possessionAwaySeconds: number;
    passAttempts: Record<Side, number>;
    passCompletions: Record<Side, number>;
    lastPasser: { id: string; side: Side; at: number; received?: boolean } | null;
    pendingOffsideTargetId: string | null;
    intendedReceiverId: string | null;
    activeShot: { shooterId: string; side: Side; xG: number; targetY: number; checkedKeeper: boolean } | null;
    /** Effect pipeline state that decides later ticks: situation flags, awake signatures and their tallies. */
    effects?: {
      possessionGainedTick: Record<Side, number>;
      lastOwnerSide: Side | null;
      lastOwnerId: string | null;
      sharedFlags: number;
      sharedFlagsTick: number;
      focus?: Record<Side, number>;
      ultimateUntil?: Record<Side, number>;
      ultimateUser?: Record<Side, string | null>;
      actors: Record<string, { flags: number; sig: { until: number; readyAt: number; awake: boolean; refilled: boolean }[] }>;
      signatureStats: SignatureReport[];
    };
    /** The match was waiting for the player's penalties when the checkpoint was written. */
    shootoutPending?: boolean;
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
  extraTime?: boolean;
  shootout?: PenaltyShootout;
  signatures?: SignatureReport[];
}

/** What a signature did in one match; shown in the report tab. */
export interface SignatureReport {
  playerId: string;
  playerName: string;
  side: Side;
  signatureId: string;
  name: [string, string];
  activations: number;
  /** Shots and xG of the player while the signature was awake, and goals scored then. */
  shots: number;
  xG: number;
  goals: number;
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
