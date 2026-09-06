import { Player } from '../../models/player.model';
import {
  AssistPreset,
  BallSnapshot,
  EMPTY_MATCH_COMMAND,
  InputFrame,
  MatchCheckpoint,
  MatchCommand,
  MatchConfig,
  MatchControllerMode,
  MatchContribution,
  MatchEvent,
  MatchKeyframe,
  MatchPhase,
  MatchResult,
  MatchRenderState,
  MatchSnapshot,
  PlayerActionState,
  PlayerRuntimeSnapshot,
  RuleState,
  Side,
  TeamMatchStats,
  emptyContribution,
  emptyTeamMatchStats,
} from '../../models/match.model';
import { Team } from '../../models/team.model';
import { Tactics } from '../../models/tactics.model';
import { Difficulty } from '../../models/game.model';
import { playerName, groupForPosition } from '../ratings';
import { tacticalIntent } from '../football/tactical-intent';
import { clamp, Rng, round } from '../util';
import { createInjury, isPlayerAvailable } from '../injury-engine';
import { accelerateTowards, turnTowards } from '../football/movement';
import { actionIsPlaying, isLocomotionAction } from '../football/action-timing';
import { BALL_RADIUS, collideGoalFrame } from '../football/ball-physics';

export const FIELD_LENGTH = 105;
export const FIELD_WIDTH = 68;
export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;
export const MATCH_TICK = 1 / 60;
export const ARCADE_MATCH_TUNING = {
  sprintMin: 6,
  sprintMax: 9.4,
  jogRatio: 0.82,
  ballJogRatio: 0.95,
  ballSprintRatio: 0.91,
  acceleration: 28,
  braking: 38,
  maxCatchUpSteps: 8,
  aiFirstTouchAssist: 10,
  aiIntendedReceiverBonus: 8,
  intendedReceiverControlBias: 0.12,
  homeKeeperComposure: 0.06,
  awayKeeperComposure: -0.035,
} as const;

export function arcadeSprintSpeed(pace: number): number {
  const normalized = clamp((pace - 40) / 59, 0, 1);
  return ARCADE_MATCH_TUNING.sprintMin + normalized * (ARCADE_MATCH_TUNING.sprintMax - ARCADE_MATCH_TUNING.sprintMin);
}

export function arcadeJogSpeed(pace: number): number {
  return arcadeSprintSpeed(pace) * ARCADE_MATCH_TUNING.jogRatio;
}

export interface ArcadeActor {
  contact?: PlayerRuntimeSnapshot['contact'];
  player: Player;
  side: Side;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  stamina: number;
  facingX: number;
  facingY: number;
  active: boolean;
  card: 'none' | 'yellow' | 'red';
  action: PlayerActionState;
  actionStartedTick: number;
  decisionCooldown: number;
  skillCooldown: number;
  tackleCooldown: number;
  intentX: number;
  intentY: number;
  animationDistance: number;
}

export interface ArcadeBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  ownerId: string | null;
  lastTouch: Side;
  lastTouchPlayerId: string | null;
  controlledTouch: number;
}

interface ActiveShot {
  shooterId: string;
  side: Side;
  xG: number;
  targetY: number;
  checkedKeeper: boolean;
}

const DEFAULT_CONFIG: Omit<MatchConfig, 'controlledTeamId' | 'seed'> = {
  mode: 'play',
  controllerMode: 'human',
  halfMinutes: 3,
  difficulty: 'normal',
  assist: 'balanced',
  playerLockId: null,
  weather: 'clear',
  inputDevice: 'keyboard',
  camera: { zoom: 1, lookAhead: 0.18, shake: true, reducedMotion: false },
};

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normaliseCommand(input: InputFrame | MatchCommand): MatchCommand {
  return {
    ...EMPTY_MATCH_COMMAND,
    ...input,
    aimX: 'aimX' in input ? input.aimX : input.moveX,
    aimY: 'aimY' in input ? input.aimY : input.moveY,
  };
}

/**
 * Deterministic 60 Hz match simulation shared by PLAY, COACH and headless SIM.
 * World values are metres; the renderer is deliberately only a consumer.
 */
export class ArcadeMatch {
  readonly home: Team;
  readonly away: Team;
  readonly config: MatchConfig;
  readonly controlledTeamId: string;
  readonly controlledSide: Side;
  readonly matchId: string;
  readonly actors: ArcadeActor[] = [];
  readonly ball: ArcadeBall = {
    x: FIELD_LENGTH / 2,
    y: FIELD_WIDTH / 2,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    spin: 0,
    ownerId: null,
    lastTouch: 'home',
    lastTouchPlayerId: null,
    controlledTouch: 0,
  };
  readonly events: MatchEvent[] = [];
  readonly keyframes: MatchKeyframe[] = [];
  readonly homeStats = emptyTeamMatchStats();
  readonly awayStats = emptyTeamMatchStats();
  readonly ratings: Record<string, number> = {};
  readonly contributions: Record<string, MatchContribution> = {};
  readonly heatmaps: Record<string, { x: number; y: number; weight: number }[]> = {};

  homeScore = 0;
  awayScore = 0;
  elapsed = 0;
  tick = 0;
  paused = false;
  finished = false;
  selectedPlayerId = '';
  phase: MatchPhase = 'firstHalf';
  rule: RuleState = this.newRule('kickoff', 'home', FIELD_LENGTH / 2, FIELD_WIDTH / 2);
  actionPower = 0;
  subsUsed = 0;
  substitutionWindows = 0;
  controllerChangedAtTick = 0;

  private readonly rng: Rng;
  private readonly totalSeconds: number;
  private previousInput: MatchCommand = { ...EMPTY_MATCH_COMMAND };
  private actionHeld = { pass: 0, through: 0, lob: 0, shoot: 0 };
  private possessionHomeSeconds = 0;
  private possessionAwaySeconds = 0;
  private lastKeyframeMinute = -1;
  private finalResult: MatchResult | null = null;
  private halftimeReached = false;
  private halftimeRecoveryApplied = false;
  private readonly passAttempts: Record<Side, number> = { home: 0, away: 0 };
  private readonly passCompletions: Record<Side, number> = { home: 0, away: 0 };
  private lastPasser: { id: string; side: Side; at: number; received?: boolean } | null = null;
  private pendingOffsideTargetId: string | null = null;
  private intendedReceiverId: string | null = null;
  private football: NonNullable<MatchCheckpoint['runtime']['football']> = {
    selectionUntilTick: 0, queuedAction: null, offsideCandidates: [],
    oneTwoRunnerId: null, oneTwoUntilTick: 0,
  };
  private activeShot: ActiveShot | null = null;
  private safeSnapshot!: MatchSnapshot;
  private readonly replayBuffer: MatchSnapshot[] = [];
  private frozenReplay: MatchSnapshot[] = [];
  private lastSubAt = -100;
  private readonly collisionGrid: ArcadeActor[][] = Array.from({ length: 216 }, () => []);
  private readonly usedCollisionBuckets: number[] = [];

  constructor(
    home: Team,
    away: Team,
    configOrControlledTeamId: MatchConfig | string,
    halfMinutes: 3 | 5 | 8 = 3,
    seed = 1,
    difficulty: Difficulty = 'normal',
    private readonly managerTacticsRank = 0,
  ) {
    this.home = structuredClone(home);
    this.away = structuredClone(away);
    this.config = typeof configOrControlledTeamId === 'string'
      ? {
          ...DEFAULT_CONFIG,
          controlledTeamId: configOrControlledTeamId,
          halfMinutes,
          seed: seed >>> 0,
          difficulty,
          camera: { ...DEFAULT_CONFIG.camera },
        }
      : {
          ...DEFAULT_CONFIG,
          ...configOrControlledTeamId,
          seed: configOrControlledTeamId.seed >>> 0,
          camera: { ...DEFAULT_CONFIG.camera, ...configOrControlledTeamId.camera },
        };
    this.controlledTeamId = this.config.controlledTeamId;
    this.controlledSide = away.id === this.controlledTeamId ? 'away' : 'home';
    this.controllerChangedAtTick = this.config.controllerMode === 'human' ? -15 : 0;
    this.matchId = `match-${this.config.fixtureId ?? `${home.id}-${away.id}`}-${this.config.seed}`;
    this.rng = new Rng(this.config.seed);
    this.totalSeconds = this.config.halfMinutes * 120;
    this.buildActors(this.home, 'home');
    this.buildActors(this.away, 'away');
    this.selectedPlayerId = this.initialControlledActor().player.id;
    this.events.push({ minute: 0, type: 'kickoff', side: null, playerId: null, messageKey: 'match.kickoff' });
    this.resetKickoff('home');
    this.safeSnapshot = this.snapshot();
  }

  get footballMinute(): number {
    return Math.min(90, Math.floor((this.elapsed / this.totalSeconds) * 90));
  }

  get progress(): number {
    return clamp(this.elapsed / this.totalSeconds, 0, 1);
  }

  get controlledTeam(): Team {
    return this.controlledSide === 'home' ? this.home : this.away;
  }

  get controllerMode(): MatchControllerMode {
    return this.config.controllerMode;
  }

  setControllerMode(mode: MatchControllerMode): void {
    if (this.config.mode === 'instant' || this.config.controllerMode === mode) return;
    this.config.controllerMode = mode;
    this.controllerChangedAtTick = this.tick;
    this.previousInput = { ...EMPTY_MATCH_COMMAND };
    this.actionHeld = { pass: 0, through: 0, lob: 0, shoot: 0 };
    if (mode === 'human') {
      const locked = this.config.playerLockId
        ? this.actors.find((actor) => actor.active && actor.player.id === this.config.playerLockId)
        : undefined;
      this.selectedPlayerId = (locked ?? this.bestControlledActor()).player.id;
    }
  }

  get half(): 1 | 2 {
    return this.halftimeReached ? 2 : 1;
  }

  get currentAttackDirection(): 1 | -1 {
    return this.attackDirection(this.controlledSide);
  }

  attackDirection(side: Side): 1 | -1 {
    const initial = side === 'home' ? 1 : -1;
    return (this.halftimeReached ? -initial : initial) as 1 | -1;
  }

  step(dt: number, rawInput: InputFrame | MatchCommand = EMPTY_MATCH_COMMAND): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.paused || this.finished || this.phase === 'halftime' || this.phase === 'goalReplay') return;
    const acceptsHumanInput = this.config.controllerMode === 'human' && this.tick - this.controllerChangedAtTick >= 15;
    const input = acceptsHumanInput ? normaliseCommand(rawInput) : EMPTY_MATCH_COMMAND;
    const safeDt = Math.min(dt, MATCH_TICK);
    this.tick++;

    if (this.rule.phase !== 'playing' && this.rule.phase !== 'advantage') {
      this.updateRestart(safeDt, input);
      this.previousInput = acceptsHumanInput ? { ...input } : EMPTY_MATCH_COMMAND;
      return;
    }

    this.elapsed += safeDt;
    this.handleSelection(input);
    const ownerBeforeMovement = this.owner();
    const supportPresser = input.skill && ownerBeforeMovement && ownerBeforeMovement.side !== this.controlledSide
      ? this.actors
          .filter((actor) => actor.active && actor.side === this.controlledSide && actor.player.id !== this.selectedPlayerId && actor.player.positionGroup !== 'GK')
          .sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0]
      : undefined;
    for (const actor of this.actors) {
      if (!actor.active) continue;
      actor.skillCooldown = Math.max(0, actor.skillCooldown - safeDt);
      actor.tackleCooldown = Math.max(0, actor.tackleCooldown - safeDt);
      const keeperRush = input.keeperRush && actor.side === this.controlledSide && actor.player.positionGroup === 'GK' && ownerBeforeMovement?.side !== actor.side;
      if (keeperRush || supportPresser?.player.id === actor.player.id) {
        this.setAction(actor, keeperRush ? 'keeper-rush' : 'support-press');
        this.moveActor(actor, this.ball.x - actor.x, this.ball.y - actor.y, true, safeDt);
      } else if (this.isHumanControlled(actor)) this.moveControlled(actor, input, safeDt);
      else this.moveAi(actor, safeDt);
    }
    this.resolvePlayerCollisions();
    this.handleActions(input, safeDt);
    this.resolvePressureTackles(safeDt);
    this.updateBall(safeDt);
    this.updatePossessionStats(safeDt);
    this.updateAdvantage(safeDt);
    this.recordTelemetry();
    this.validateState();

    if (!this.halftimeReached && this.elapsed >= this.totalSeconds / 2) this.enterHalftime();
    if (this.elapsed >= this.totalSeconds && !this.finished) this.finish();
    this.previousInput = acceptsHumanInput ? { ...input } : EMPTY_MATCH_COMMAND;
  }

  simulateToEnd(): void {
    this.config.mode = 'instant';
    this.config.controllerMode = 'auto';
    this.football.queuedAction = null;
    let guard = 0;
    while (!this.finished && guard < 150000) {
      if (this.phase === 'halftime') this.resumeSecondHalf();
      if (this.phase === 'goalReplay') this.endReplay();
      if (this.paused) this.paused = false;
      this.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
      guard++;
    }
    if (!this.finished) this.finish();
  }

  setPaused(value: boolean): void {
    if (this.finished) return;
    this.paused = value;
    if (value) this.phase = 'paused';
    else this.phase = this.halftimeReached ? 'secondHalf' : 'firstHalf';
  }

  resumeSecondHalf(): void {
    if (this.phase !== 'halftime') return;
    if (!this.halftimeRecoveryApplied) {
      for (const actor of this.actors) {
        const recovery = 2 + actor.player.attributes.stamina / 35;
        actor.stamina = clamp(actor.stamina + recovery, 0, 100);
      }
      this.halftimeRecoveryApplied = true;
    }
    this.phase = 'secondHalf';
    this.paused = false;
    this.rebaseFormation();
    this.resetKickoff('away');
  }

  endReplay(): void {
    if (this.phase !== 'goalReplay') return;
    this.phase = this.halftimeReached ? 'secondHalf' : 'firstHalf';
    this.paused = false;
  }

  replaySnapshots(): readonly MatchSnapshot[] {
    return this.frozenReplay;
  }

  setMentality(value: Tactics['mentality']): void {
    this.controlledTeam.tactics.mentality = value;
    this.pushCommentary('match.mentality', { value });
  }

  setPressing(value: Tactics['pressing']): void {
    this.controlledTeam.tactics.pressing = value;
    this.pushCommentary('match.pressing', { value });
  }

  setWidth(value: Tactics['width']): void {
    this.controlledTeam.tactics.width = value;
    this.pushCommentary('match.width', { value });
  }

  toggleCounter(): void {
    this.controlledTeam.tactics.counterAttack = !this.controlledTeam.tactics.counterAttack;
    this.pushCommentary('match.counter', { value: this.controlledTeam.tactics.counterAttack ? 'on' : 'off' });
  }

  bench(): Player[] {
    const onPitch = new Set(this.actors.filter((actor) => actor.side === this.controlledSide && actor.active).map((actor) => actor.player.id));
    return this.controlledTeam.players.filter((player) => !onPitch.has(player.id) && !this.football.subbedOutIds?.includes(player.id) && isPlayerAvailable(player));
  }

  makeSub(outId: string, inId: string): boolean {
    if (this.subsUsed >= 5) return false;
    const actor = this.actors.find((candidate) => candidate.player.id === outId && candidate.side === this.controlledSide && candidate.active);
    const incoming = this.controlledTeam.players.find((player) => player.id === inId);
    if (!actor || !incoming || this.bench().every((player) => player.id !== inId)) return false;
    const isHalftime = this.phase === 'halftime';
    if (!isHalftime && this.elapsed - this.lastSubAt > 3) {
      if (this.substitutionWindows >= 3) return false;
      this.substitutionWindows++;
    }
    (this.football.subbedOutIds ??= []).push(outId);
    const slot = this.controlledTeam.formation.slots.find(slot => slot.playerId === outId);
    if (slot) slot.playerId = inId;
    if (this.config.playerLockId === outId) this.config.playerLockId = inId;
    this.lastSubAt = this.elapsed;
    this.subsUsed++;
    const outgoing = actor.player;
    actor.player = incoming;
    actor.stamina = incoming.fitness;
    actor.card = 'none';
    this.setAction(actor, 'subbed-on');
    this.ratings[incoming.id] = 6.5;
    this.contributions[incoming.id] = emptyContribution();
    this.heatmaps[incoming.id] = [];
    if (this.selectedPlayerId === outId || this.config.playerLockId === outId) this.selectedPlayerId = incoming.id;
    this.events.push({
      minute: this.footballMinute,
      type: 'sub',
      side: this.controlledSide,
      playerId: incoming.id,
      messageKey: 'match.sub',
      params: { incoming: playerName(incoming), outgoing: playerName(outgoing) },
    });
    return true;
  }

  result(): MatchResult {
    if (!this.finished) this.simulateToEnd();
    return this.finalResult!;
  }

  forfeitControlled(): MatchResult {
    const losingByAtLeastThree = this.controlledSide === 'home'
      ? this.awayScore - this.homeScore >= 3
      : this.homeScore - this.awayScore >= 3;
    if (!losingByAtLeastThree) {
      if (this.controlledSide === 'home') {
        this.homeScore = 0;
        this.awayScore = 3;
      } else {
        this.homeScore = 3;
        this.awayScore = 0;
      }
    }
    this.events.push({ minute: this.footballMinute, type: 'commentary', side: this.controlledSide, playerId: null, text: 'Match forfeited.' });
    this.finish();
    return this.finalResult!;
  }

  snapshot(): MatchSnapshot {
    return {
      tick: this.tick,
      phase: this.phase,
      footballMinute: this.footballMinute,
      elapsed: this.elapsed,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      controlledPlayerId: this.selectedPlayerId,
      attackDirection: this.currentAttackDirection,
      rule: { ...this.rule },
      ball: this.ballSnapshot(),
      players: this.actors.map((actor) => this.actorSnapshot(actor)),
    };
  }

  renderState(): MatchRenderState {
    const activeSignature = this.actors
      .filter((actor) => actor.active)
      .map((actor) => actor.player.id)
      .join(',');
    return {
      tick: this.tick,
      controlledPlayerId: this.selectedPlayerId,
      attackDirection: this.currentAttackDirection,
      discontinuityKey: `${this.half}|${this.phase}|${this.rule.phase}|${this.homeScore}:${this.awayScore}|${activeSignature}`,
      ball: this.ballSnapshot(),
      players: this.actors.map((actor) => this.actorSnapshot(actor)),
    };
  }

  checkpoint(): MatchCheckpoint {
    return {
      version: 2,
      controllerMode: this.config.controllerMode,
      controllerChangedAtTick: this.controllerChangedAtTick,
      fixtureId: this.config.fixtureId ?? `${this.home.id}-${this.away.id}`,
      matchId: this.matchId,
      config: structuredClone(this.config),
      tick: this.tick,
      elapsed: this.elapsed,
      phase: this.phase,
      rngState: this.rng.snapshot(),
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      selectedPlayerId: this.selectedPlayerId,
      ball: { ...this.ballSnapshot(), lastTouch: this.ball.lastTouch, lastTouchPlayerId: this.ball.lastTouchPlayerId },
      actors: this.actors.map((actor) => this.actorSnapshot(actor)),
      rule: { ...this.rule },
      events: structuredClone(this.events),
      homeStats: { ...this.homeStats },
      awayStats: { ...this.awayStats },
      ratings: { ...this.ratings },
      contributions: structuredClone(this.contributions),
      safeSnapshot: structuredClone(this.safeSnapshot),
      runtime: {
        teamState: structuredClone({ home: {formation:this.home.formation,tactics:this.home.tactics}, away: {formation:this.away.formation,tactics:this.away.tactics} }),
        football: structuredClone(this.football),
        previousInput: { ...this.previousInput },
        actionHeld: { ...this.actionHeld },
        possessionHomeSeconds: this.possessionHomeSeconds,
        possessionAwaySeconds: this.possessionAwaySeconds,
        passAttempts: { ...this.passAttempts },
        passCompletions: { ...this.passCompletions },
        lastPasser: this.lastPasser ? { ...this.lastPasser } : null,
        pendingOffsideTargetId: this.pendingOffsideTargetId,
        intendedReceiverId: this.intendedReceiverId,
        activeShot: this.activeShot ? { ...this.activeShot } : null,
        halftimeReached: this.halftimeReached,
        halftimeRecoveryApplied: this.halftimeRecoveryApplied,
        subsUsed: this.subsUsed,
        substitutionWindows: this.substitutionWindows,
        lastSubAt: this.lastSubAt,
        keyframes: structuredClone(this.keyframes),
        heatmaps: structuredClone(this.heatmaps),
      },
      savedAt: Date.now(),
    };
  }

  restore(checkpoint: MatchCheckpoint): boolean {
    if (checkpoint.version !== 2 || checkpoint.matchId !== this.matchId) return false;
    if (checkpoint.runtime.teamState) for (const side of ['home','away'] as const) {
      Object.assign(this.teamOf(side), structuredClone(checkpoint.runtime.teamState[side]));
    }
    this.config.playerLockId = checkpoint.config.playerLockId;
    const players = [...this.home.players, ...this.away.players];
    for (let index = 0; index < checkpoint.actors.length; index++) {
      const saved = checkpoint.actors[index];
      let actor = this.actors.find((candidate) => candidate.player.id === saved.id);
      if (!actor) actor = this.actors.filter((candidate) => candidate.side === saved.side)[index % 11];
      const player = players.find((candidate) => candidate.id === saved.id);
      if (!actor || !player) return false;
      actor.player = player;
      this.applyActorSnapshot(actor, saved);
    }
    Object.assign(this.ball, checkpoint.ball);
    this.tick = checkpoint.tick;
    this.config.controllerMode = checkpoint.controllerMode;
    this.controllerChangedAtTick = checkpoint.controllerChangedAtTick;
    this.elapsed = checkpoint.elapsed;
    this.phase = checkpoint.phase;
    this.paused = checkpoint.phase === 'paused' || checkpoint.phase === 'halftime';
    this.halftimeReached = checkpoint.elapsed >= this.totalSeconds / 2;
    this.homeScore = checkpoint.homeScore;
    this.awayScore = checkpoint.awayScore;
    this.selectedPlayerId = checkpoint.selectedPlayerId;
    this.rule = { ...checkpoint.rule };
    this.events.splice(0, this.events.length, ...structuredClone(checkpoint.events));
    Object.assign(this.homeStats, checkpoint.homeStats);
    Object.assign(this.awayStats, checkpoint.awayStats);
    Object.assign(this.ratings, checkpoint.ratings);
    Object.assign(this.contributions, structuredClone(checkpoint.contributions));
    this.safeSnapshot = structuredClone(checkpoint.safeSnapshot);
    this.football = structuredClone(checkpoint.runtime.football ?? {
      selectionUntilTick: 0, queuedAction: null, offsideCandidates: [], oneTwoRunnerId: null, oneTwoUntilTick: 0,
    });
    this.previousInput = { ...checkpoint.runtime.previousInput };
    this.actionHeld = { ...checkpoint.runtime.actionHeld };
    this.possessionHomeSeconds = checkpoint.runtime.possessionHomeSeconds;
    this.possessionAwaySeconds = checkpoint.runtime.possessionAwaySeconds;
    Object.assign(this.passAttempts, checkpoint.runtime.passAttempts);
    Object.assign(this.passCompletions, checkpoint.runtime.passCompletions);
    this.lastPasser = checkpoint.runtime.lastPasser ? { ...checkpoint.runtime.lastPasser } : null;
    this.pendingOffsideTargetId = checkpoint.runtime.pendingOffsideTargetId;
    this.intendedReceiverId = checkpoint.runtime.intendedReceiverId;
    this.activeShot = checkpoint.runtime.activeShot ? { ...checkpoint.runtime.activeShot } : null;
    this.halftimeReached = checkpoint.runtime.halftimeReached;
    this.halftimeRecoveryApplied = checkpoint.runtime.halftimeRecoveryApplied;
    this.subsUsed = checkpoint.runtime.subsUsed;
    this.substitutionWindows = checkpoint.runtime.substitutionWindows;
    this.lastSubAt = checkpoint.runtime.lastSubAt;
    this.keyframes.splice(0, this.keyframes.length, ...structuredClone(checkpoint.runtime.keyframes));
    for (const key of Object.keys(this.heatmaps)) delete this.heatmaps[key];
    Object.assign(this.heatmaps, structuredClone(checkpoint.runtime.heatmaps));
    this.rng.restore(checkpoint.rngState);
    return this.isFiniteState();
  }

  stateHash(): string {
    const snapshot = this.snapshot();
    const players = snapshot.players.map(({ animationDistance: _presentationOnly, ...player }) => player);
    const json = JSON.stringify({ snapshot: { ...snapshot, players }, rng: this.rng.snapshot(), events: this.events, football: this.football, previousInput: this.previousInput, actionHeld: this.actionHeld, activeShot: this.activeShot, intendedReceiverId: this.intendedReceiverId, lastPasser: this.lastPasser });
    let hash = 2166136261;
    for (let index = 0; index < json.length; index++) {
      hash ^= json.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private buildActors(team: Team, side: Side): void {
    const used = new Set<string>();
    for (const slot of team.formation.slots.slice(0, 11)) {
      let player = team.players.find((candidate) => candidate.id === slot.playerId && isPlayerAvailable(candidate) && !used.has(candidate.id));
      if (!player) {
        player = team.players
          .filter((candidate) => isPlayerAvailable(candidate) && !used.has(candidate.id))
          .sort((a, b) => {
            const aFit = a.position === slot.position ? 20 : a.positionGroup === groupForPosition(slot.position) ? 5 : 0;
            const bFit = b.position === slot.position ? 20 : b.positionGroup === groupForPosition(slot.position) ? 5 : 0;
            return b.overall + bFit - (a.overall + aFit);
          })[0];
      }
      if (!player) continue;
      used.add(player.id);
      const x = side === 'home' ? slot.x * FIELD_LENGTH : (1 - slot.x) * FIELD_LENGTH;
      const y = slot.y * FIELD_WIDTH;
      this.actors.push({
        player,
        side,
        x,
        y,
        homeX: x,
        homeY: y,
        vx: 0,
        vy: 0,
        stamina: player.fitness,
        facingX: side === 'home' ? 1 : -1,
        facingY: 0,
        active: true,
        card: 'none',
        action: 'formation',
        actionStartedTick: this.tick,
        decisionCooldown: this.rng.float(0.05, 0.35),
        skillCooldown: 0,
        tackleCooldown: 0,
        intentX: x,
        intentY: y,
        animationDistance: 0,
      });
      this.ratings[player.id] = 6.5;
      this.contributions[player.id] = emptyContribution();
      this.heatmaps[player.id] = [];
    }
  }

  private initialControlledActor(): ArcadeActor {
    const locked = this.config.playerLockId
      ? this.actors.find((actor) => actor.player.id === this.config.playerLockId && actor.side === this.controlledSide && actor.active)
      : undefined;
    return locked ?? this.bestControlledActor();
  }

  private bestControlledActor(): ArcadeActor {
    const candidates = this.actors
      .filter((actor) => actor.active && actor.side === this.controlledSide && actor.player.positionGroup !== 'GK')
      .sort((a, b) => this.interceptTime(a) - this.interceptTime(b));
    return candidates[0] ?? this.actors.find((actor) => actor.active && actor.side === this.controlledSide)!;
  }

  private interceptTime(actor: ArcadeActor): number {
    const projected = { x: this.ball.x + this.ball.vx * 0.35, y: this.ball.y + this.ball.vy * 0.35 };
    return distance(actor, projected) / Math.max(1, this.maxSpeed(actor, false));
  }

  private isHumanControlled(actor: ArcadeActor): boolean {
    return this.config.mode !== 'instant' && this.config.controllerMode === 'human' && this.tick - this.controllerChangedAtTick >= 15 && actor.player.id === this.selectedPlayerId;
  }

  private handleSelection(input: MatchCommand): void {
    if (this.config.playerLockId) {
      const locked = this.actors.find((actor) => actor.player.id === this.config.playerLockId && actor.active);
      this.selectedPlayerId = locked?.player.id ?? this.bestControlledActor().player.id;
      return;
    }
    const owner = this.owner();
    const canAutoSwitch = this.tick >= this.football.selectionUntilTick;
    if (canAutoSwitch && owner?.side === this.controlledSide) this.selectedPlayerId = owner.player.id;
    const looseAutoSwitch = !owner && this.config.assist === 'assisted';
    const obviousBalanced = !owner && this.config.assist === 'balanced' && distance(this.bestControlledActor(), this.ball) < 5;
    if (canAutoSwitch && (looseAutoSwitch || obviousBalanced)) this.selectedPlayerId = this.bestControlledActor().player.id;
    if (input.switchPlayer && !this.previousInput.switchPlayer) {
      this.football.selectionUntilTick = this.tick + 36;
      const direction = Math.hypot(input.aimX, input.aimY);
      const candidates = this.actors
        .filter((actor) => actor.active && actor.side === this.controlledSide && actor.player.positionGroup !== 'GK')
        .map((actor) => {
          const dx = actor.x - this.ball.x;
          const dy = actor.y - this.ball.y;
          const directional = direction > 0.25 ? (dx * input.aimX * this.currentAttackDirection + dy * input.aimY) / Math.max(1, Math.hypot(dx, dy)) : 0;
          return { actor, score: this.interceptTime(actor) - directional * 0.22 };
        })
        .sort((a, b) => a.score - b.score)
        .slice(0, 3);
      const index = candidates.findIndex(({ actor }) => actor.player.id === this.selectedPlayerId);
      this.selectedPlayerId = candidates[(index + 1) % Math.max(1, candidates.length)]?.actor.player.id ?? this.selectedPlayerId;
    }
  }

  private moveControlled(actor: ArcadeActor, input: MatchCommand, dt: number): void {
    const worldX = input.moveX * this.currentAttackDirection;
    this.moveActor(actor, worldX, input.moveY, input.sprint, dt);
    const moving = Math.hypot(worldX, input.moveY) > 0.1;
    this.setAction(actor, !moving ? 'idle' : input.sprint ? 'sprint' : this.ball.ownerId === actor.player.id ? 'carry' : 'jog');
    if (input.skill && !this.previousInput.skill) this.performSkill(actor, worldX, input.moveY);
  }

  private moveActor(actor: ArcadeActor, dx: number, dy: number, sprint: boolean, dt: number): void {
    const previousX = actor.x;
    const previousY = actor.y;
    const magnitude = Math.hypot(dx, dy);
    const nx = magnitude > 0.001 ? dx / magnitude : 0;
    const ny = magnitude > 0.001 ? dy / magnitude : 0;
    const ownsBall = this.ball.ownerId === actor.player.id;
    const targetSpeed = magnitude > 0.05 ? this.maxSpeed(actor, sprint) * Math.min(1, magnitude) : 0;
    const targetVx = nx * targetSpeed;
    const targetVy = ny * targetSpeed;
    const fitnessPenalty = actor.stamina < 40 ? 0.78 + actor.stamina * 0.0055 : 1;
    const acceleration = ARCADE_MATCH_TUNING.acceleration * (0.88 + actor.player.attributes.pace * 0.0012 + actor.player.attributes.dribbling * 0.0005) * fitnessPenalty;
    const braking = ARCADE_MATCH_TUNING.braking * (0.9 + actor.player.attributes.dribbling * 0.0015);
    const counterSteering = actor.vx * targetVx + actor.vy * targetVy < 0;
    const rate = targetSpeed === 0 || counterSteering ? braking : acceleration;
    const velocity = accelerateTowards(actor.vx, actor.vy, targetVx, targetVy, rate * dt);
    actor.vx = velocity.x;
    actor.vy = velocity.y;
    if (magnitude > 0.08) {
      const turnRate = (11 + actor.player.attributes.dribbling / 24) * dt / (sprint ? 1.18 : 1);
      const facing = turnTowards(actor.facingX, actor.facingY, nx, ny, turnRate);
      actor.facingX = facing.x;
      actor.facingY = facing.y;
    }
    actor.x = clamp(actor.x + actor.vx * dt, 0.8, FIELD_LENGTH - 0.8);
    actor.y = clamp(actor.y + actor.vy * dt, 0.8, FIELD_WIDTH - 0.8);
    actor.animationDistance += Math.hypot(actor.x - previousX, actor.y - previousY);
    const footballMinutes = dt * 90 / this.totalSeconds;
    const pressureCost = this.teamOf(actor.side).tactics.pressing === 'gegenpress' ? 0.16 : 0;
    const drain = (magnitude > 0.1 ? 0.2 : 0.06) + (sprint ? 0.56 : 0) + (ownsBall ? 0.05 : 0) + pressureCost;
    actor.stamina = clamp(actor.stamina - footballMinutes * drain, 0, 100);
  }

  private moveAi(actor: ArcadeActor, dt: number): void {
    actor.decisionCooldown -= dt;
    if (actor.decisionCooldown <= 0) {
      this.chooseAiIntent(actor);
      const base = this.config.difficulty === 'easy' ? 0.3 : this.config.difficulty === 'hard' ? 0.11 : 0.18;
      const spread = this.config.difficulty === 'easy' ? 0.2 : this.config.difficulty === 'hard' ? 0.09 : 0.12;
      const tempo = this.teamOf(actor.side).tactics.tempo;
      const tempoFactor = tempo === 'fast' ? 0.78 : tempo === 'slow' ? 1.3 : 1;
      actor.decisionCooldown = (base + this.rng.float(0, spread)) * tempoFactor;
    }
    const dx = actor.intentX - actor.x;
    const dy = actor.intentY - actor.y;
    const sprint = distance(actor, { x: actor.intentX, y: actor.intentY }) > 14 && actor.stamina > 25;
    this.moveActor(actor, dx, dy, sprint, dt);
    if (actor.action === 'formation' || actor.action === 'idle' || actor.action === 'jog' || actor.action === 'sprint') {
      this.setAction(actor, Math.hypot(actor.vx, actor.vy) < 0.15 ? 'idle' : sprint ? 'sprint' : 'jog');
    }
  }

  private chooseAiIntent(actor: ArcadeActor): void {
    const owner = this.owner();
    const team = this.teamOf(actor.side);
    const direction = this.attackDirection(actor.side);
    this.setAction(actor, 'formation');
    if (owner?.player.id === actor.player.id) {
      this.setAction(actor, 'carry');
      const goalDistance = direction > 0 ? FIELD_LENGTH - actor.x : actor.x;
      const pressureDistance = this.closestOpponent(actor);
      const pressured = pressureDistance < 4;
      const shootingLane = Math.abs(actor.y - FIELD_WIDTH / 2) < 18;
      const openLane = [-0.65, 0, 0.65].map(lateral => {
        const target = { x: clamp(actor.x + direction * 8,1,104), y:clamp(actor.y + lateral * 8,2,66) };
        const clearance = Math.min(...this.actors.filter(other=>other.active && other.side!==actor.side).map(other=>distance(other,target)));
        return { ...target, score: clearance - Math.abs(target.y-34)*0.09 };
      }).sort((a,b)=>b.score-a.score)[0];
      actor.intentX = openLane.x;
      actor.intentY = openLane.y;
      const shotProbability = goalDistance < 20 ? .29 : goalDistance < 30 ? .17 : .045;
      const captain = team.tactics.captainId === actor.player.id;
      const patience = team.tactics.tempo === 'slow' ? .16 : team.tactics.tempo === 'fast' ? .40 : .26;
      if (actor.player.positionGroup === 'GK') {
        const long = team.tactics.buildUp === 'long-ball' || pressureDistance < 6;
        this.pass(actor, false, long, long ? .85 : .40, direction, this.rng.float(-.4,.4));
        this.setAction(actor, long ? 'keeper-kick' : 'keeper-throw');
      } else if (goalDistance < 39 && shootingLane && this.rng.bool(shotProbability)) {
        const keeper = this.actors.find(other=>other.active && other.side!==actor.side && other.player.positionGroup==='GK');
        const farCorner = keeper && keeper.y > 34 ? -.70 : .70;
        const accuracy = this.config.difficulty === 'easy' ? .45 : this.config.difficulty === 'hard' ? .10 : .25;
        this.shoot(actor, this.rng.float(.50,.93), direction, clamp(farCorner+this.rng.float(-accuracy,accuracy),-1,1), goalDistance > 18 && actor.player.attributes.shooting > 72, goalDistance < 14);
      } else if (pressured || this.rng.bool(patience+(captain?.03:0))) {
        const cross = goalDistance < 26 && Math.abs(actor.y-34) > 16;
        const through = team.tactics.counterAttack && this.rng.bool(.25);
        const long = cross || team.tactics.buildUp === 'long-ball' && this.rng.bool(.3);
        this.pass(actor, through, long, long?.76:team.tactics.passing==='short'?.38:.60, direction, cross ? (34-actor.y)/25 : this.rng.float(-.4,.4));
      }
      return;
    }

    if (actor.player.positionGroup === 'GK') {
      const goalX = direction > 0 ? 0 : FIELD_LENGTH;
      const ballDepth = Math.abs(this.ball.x - goalX);
      const sweeper = !owner && ballDepth < 15 && distance(actor, this.ball) < 9 && this.ball.z < 1.3;
      if (sweeper) {
        this.setAction(actor, 'keeper-rush');
        actor.intentX = this.ball.x + this.ball.vx * 0.15;
        actor.intentY = this.ball.y + this.ball.vy * 0.15;
      } else {
        this.setAction(actor, 'keeper-ready');
        const depth = clamp(ballDepth * 0.11, 1.1, 5);
        actor.intentX = goalX + direction * depth;
        const incoming = this.ball.vx * direction < -3;
        const flight = incoming ? clamp((actor.intentX - this.ball.x) / this.ball.vx, 0, 0.75) : 0;
        const angleY = 34 + (this.ball.y - 34) * depth / Math.max(depth, ballDepth);
        actor.intentY = clamp(incoming ? this.ball.y + this.ball.vy * flight : angleY, 29.3, 38.7);
      }
      return;
    }

    if (!owner && actor.player.id === this.intendedReceiverId) {
      const horizon = clamp(distance(actor,this.ball)/this.maxSpeed(actor,false),0,.35);
      actor.intentX = clamp(this.ball.x + this.ball.vx*horizon,1,104);
      actor.intentY = clamp(this.ball.y + this.ball.vy*horizon,1,67);
      this.setAction(actor,'receive');
      return;
    }
    const intent = tacticalIntent(actor, owner, this.ball, this.actors, team, direction);
    this.setAction(actor, intent.action);
    actor.intentX = intent.x;
    actor.intentY = intent.y;
    if (this.football.oneTwoRunnerId === actor.player.id && this.tick < this.football.oneTwoUntilTick) {
      actor.intentX = clamp(actor.x + direction * 12, 1, FIELD_LENGTH - 1);
      actor.intentY = clamp(actor.y + (actor.y < FIELD_WIDTH / 2 ? -1 : 1) * 3, 2, FIELD_WIDTH - 2);
    }
  }

  private handleActions(input: MatchCommand, dt: number): void {
    const actor = this.actors.find((candidate) => candidate.player.id === this.selectedPlayerId && candidate.active);
    if (!actor) return;
    this.actionHeld.pass = input.pass ? Math.min(0.8, this.actionHeld.pass + dt) : this.actionHeld.pass;
    this.actionHeld.through = input.through ? Math.min(0.8, this.actionHeld.through + dt) : this.actionHeld.through;
    this.actionHeld.lob = input.lob ? Math.min(0.8, this.actionHeld.lob + dt) : this.actionHeld.lob;
    this.actionHeld.shoot = input.shoot ? Math.min(0.9, this.actionHeld.shoot + dt) : this.actionHeld.shoot;
    this.actionPower = Math.max(this.actionHeld.pass / 0.8, this.actionHeld.through / 0.8, this.actionHeld.lob / 0.8, this.actionHeld.shoot / 0.9);
    const aimX = (Math.abs(input.aimX) + Math.abs(input.aimY) > 0.1 ? input.aimX : 1) * this.currentAttackDirection;
    const aimY = input.aimY;
    for (const kind of ['pass', 'through', 'lob', 'shoot'] as const) {
      if (input[kind] || !this.previousInput[kind]) continue;
      const action = {
        kind, expiresTick: this.tick + 11, power: this.charge(this.actionHeld[kind], kind === 'shoot' ? 0.9 : 0.8),
        aimX, aimY, chip: input.lob || this.previousInput.lob, finesse: input.skill || this.previousInput.skill, low: this.actionHeld.shoot < 0.14,
      };
      if (this.ball.ownerId === actor.player.id) {
        this.executeFootballAction(actor, action);
        if (kind === 'pass' && input.sprint) {
          this.football.oneTwoRunnerId = actor.player.id;
          this.football.oneTwoUntilTick = this.tick + 180;
        }
      } else if (!this.owner() || this.owner()?.side === actor.side) {
        this.football.queuedAction = action;
      } else this.attemptTackle(actor, kind === 'shoot' || kind === 'lob');
      this.actionHeld[kind] = 0;
    }
    if (this.football.queuedAction && this.football.queuedAction.expiresTick < this.tick) this.football.queuedAction = null;
    if (this.football.queuedAction && this.ball.ownerId === actor.player.id) {
      this.executeFootballAction(actor, this.football.queuedAction);
      this.football.queuedAction = null;
    }
  }

  private executeFootballAction(actor: ArcadeActor, action: NonNullable<NonNullable<MatchCheckpoint['runtime']['football']>['queuedAction']>): void {
    if (action.kind === 'shoot') this.shoot(actor, action.power, action.aimX, action.aimY, action.finesse, action.low, action.chip);
    else this.pass(actor, action.kind === 'through', action.kind === 'lob', action.power, action.aimX, action.aimY);
  }

  private charge(value: number, maximum: number): number {
    return clamp(0.3 + value / maximum * 0.7, 0.3, 1);
  }

  private pass(actor: ArcadeActor, through: boolean, lob: boolean, power: number, aimX: number, aimY: number): void {
    if (this.ball.ownerId !== actor.player.id) return;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    const nx = aimX / aimLength;
    const ny = aimY / aimLength;
    const assistCone: Record<AssistPreset, number> = { assisted: Math.PI * 0.38, balanced: Math.PI * 0.22, manual: 0 };
    const humanPass = this.isHumanControlled(actor);
    const teammates = this.actors.filter((candidate) => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id);
    const targetOptions = teammates
      .map((candidate) => {
        const dx = candidate.x - actor.x;
        const dy = candidate.y - actor.y;
        const length = Math.hypot(dx, dy) || 1;
        const angle = Math.acos(clamp((dx / length) * nx + (dy / length) * ny, -1, 1));
        const lanePressure = this.passLanePressure(actor, candidate);
        const runBonus = through ? Math.max(0, (candidate.vx * this.attackDirection(actor.side) + 1) * 0.12) : 0;
        const forwardGain = (candidate.x - actor.x) * this.attackDirection(actor.side);
        const preferredDistance = this.teamOf(actor.side).tactics.passing === 'direct' ? 25 : this.teamOf(actor.side).tactics.passing === 'short' ? 10 : 17;
        return { candidate, angle, length, lanePressure, score: angle * (humanPass ? 2.2 : 0.25) + Math.abs(length - (humanPass ? 8 + power * 24 : preferredDistance)) * 0.035 + lanePressure * (humanPass ? 0.45 : 1.8) - runBonus - (humanPass ? 0 : forwardGain * 0.025) + (this.isOffside(candidate, actor) ? 4 : 0) };
      })
      .sort((a, b) => a.score - b.score);
    const assistedOptions = humanPass
      ? targetOptions.filter(({ angle, length }) => angle <= assistCone[this.config.assist] && length < 50)
      : targetOptions.filter(({ length, lanePressure }) => length < (lob ? 48 : 36) && lanePressure === 0);
    const target = humanPass
      ? this.config.assist === 'manual' ? undefined : assistedOptions[0]?.candidate
      : (assistedOptions.length ? assistedOptions : targetOptions)[0]?.candidate;
    const manualTarget = { x: actor.x + nx * (8 + power * 24), y: actor.y + ny * (8 + power * 24) };
    const rawDistance = target ? distance(actor, target) : Math.hypot(manualTarget.x - actor.x, manualTarget.y - actor.y);
    const travelEstimate = rawDistance / 19;
    const targetX = target ? clamp(target.x + target.vx * travelEstimate * 0.65 + (through ? this.attackDirection(actor.side) * 2.5 : 0), 1, FIELD_LENGTH - 1) : manualTarget.x;
    const targetY = target ? clamp(target.y + target.vy * travelEstimate * 0.65, 1, FIELD_WIDTH - 1) : manualTarget.y;
    const dx = targetX - actor.x;
    const dy = targetY - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const pressure = clamp((5 - this.closestOpponent(actor)) / 5, 0, 1);
    const weakFoot = actor.player.foot !== 'Both' && ((actor.player.foot === 'Right' && dy < -1) || (actor.player.foot === 'Left' && dy > 1)) ? 1 : 0;
    const fatigue = actor.stamina < 30 ? (30 - actor.stamina) / 30 : 0;
    const manualFactor = humanPass
      ? this.config.assist === 'manual' ? 1.2 : this.config.assist === 'assisted' ? 0.55 : 0.82
      : this.config.difficulty === 'easy' ? 0.58 : this.config.difficulty === 'hard' ? 0.26 : 0.34;
    const error = (100 - actor.player.attributes.passing) / 100 * 0.075 + pressure * 0.045 + weakFoot * 0.018 + fatigue * 0.04;
    const angleError = this.rng.gaussian(0, error * manualFactor);
    const cos = Math.cos(angleError);
    const sin = Math.sin(angleError);
    const px = dx / length * cos - dy / length * sin;
    const py = dx / length * sin + dy / length * cos;
    const speed = target && !lob
      ? clamp(8 + length * 0.48 + power * 4.5 + (through ? 2.8 : 0), 12, 25)
      : (lob ? 14 : through ? 14.5 : 11.8) + power * (lob ? 12 : 13.5) + actor.player.attributes.passing * 0.025;
    this.passAttempts[actor.side]++;
    this.stats(actor.side).passesAttempted++;
    this.lastPasser = { id: actor.player.id, side: actor.side, at: this.elapsed };
    this.football.offsideCandidates = teammates.filter(candidate => this.isOffside(candidate, actor)).map(candidate => candidate.player.id);
    this.pendingOffsideTargetId = target && this.isOffside(target, actor) ? target.player.id : null;
    this.intendedReceiverId = target?.player.id ?? null;
    this.activeShot = null;
    this.releaseBall(actor, px * speed, py * speed, lob ? clamp(length / speed * 4.905 + 0.5, 3, 9) : 0.15, lob ? this.rng.float(-2, 2) : 0);
    this.setAction(actor, lob ? 'lob' : through ? 'through-pass' : 'pass');
  }

  private shoot(actor: ArcadeActor, power: number, aimX: number, aimY: number, finesse: boolean, low: boolean, chip = false): void {
    if (this.ball.ownerId !== actor.player.id) return;
    const direction = this.attackDirection(actor.side);
    const goalX = direction > 0 ? FIELD_LENGTH + 0.3 : -0.3;
    const goalCentre = FIELD_WIDTH / 2;
    const inputZone = clamp(aimY, -1, 1) * (GOAL_WIDTH * 0.43);
    const distanceToGoal = Math.hypot(goalX - actor.x, goalCentre - actor.y);
    const angleQuality = clamp(1 - Math.abs(actor.y - goalCentre) / 31, 0.25, 1);
    const pressure = clamp((5 - this.closestOpponent(actor)) / 5, 0, 1);
    const balance = clamp(1 - Math.hypot(actor.vx, actor.vy) / 18, 0.35, 1);
    const weakFoot = actor.player.foot === 'Both' ? 0 : actor.player.foot === 'Right' === (actor.y > goalCentre) ? 0.07 : 0;
    const fatigue = actor.stamina < 30 ? (30 - actor.stamina) / 120 : 0;
    const baseError = (100 - actor.player.attributes.shooting) / 100 * 2.15 + pressure * 1.35 + (1 - balance) * 0.9 + weakFoot + fatigue + Math.max(0, distanceToGoal - 20) * 0.15;
    const assistFactor = this.config.assist === 'assisted' ? 0.72 : this.config.assist === 'manual' ? 1.18 : 0.92;
    const manual = this.isHumanControlled(actor) && this.config.assist === 'manual';
    const manualX = Math.abs(aimX) > 0.04 ? aimX : direction * 0.04;
    const aimedY = manual ? actor.y + aimY / manualX * (goalX - actor.x) : goalCentre + inputZone;
    // Shot dispersion uses a real standard deviation; the general generator's
    // bounded averaging helper otherwise put virtually every attempt on target.
    const normal = Math.sqrt(-2 * Math.log(Math.max(1e-9, this.rng.next()))) * Math.cos(2 * Math.PI * this.rng.next());
    const targetY = aimedY + normal * (baseError + Math.max(0,distanceToGoal-12)*0.025) * assistFactor * 1.5;
    const dx = goalX - actor.x;
    const dy = targetY - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const speed = 19 + power * 14 + actor.player.attributes.shooting * 0.035;
    const xG = clamp(0.65 * Math.exp(-distanceToGoal / 13) * angleQuality + actor.player.attributes.shooting / 1800 - pressure * 0.025, 0.015, 0.75);
    const stats = this.stats(actor.side);
    stats.shots++;
    stats.xG = round(stats.xG + xG, 2);
    if (Math.abs(targetY - goalCentre) <= GOAL_WIDTH / 2 + 0.4) stats.shotsOnTarget++;
    const flightTime = length / speed;
    const vz = chip ? clamp(flightTime * 4.905 + 1.6, 4, 8) : low ? 0.7 : finesse ? clamp(flightTime * 4.905 + 0.8, 1.8, 6.5) : clamp(flightTime * 4.905 + (power - 0.5), 1.2, 7);
    this.activeShot = { shooterId: actor.player.id, side: actor.side, xG, targetY, checkedKeeper: false };
    this.intendedReceiverId = null;
    this.releaseBall(actor, dx / length * speed, dy / length * speed, vz, finesse ? -direction * 5 : 0);
    this.setAction(actor, chip ? 'chip-shot' : finesse ? 'finesse-shot' : low ? 'low-shot' : 'shot');
    this.events.push({ minute: this.footballMinute, type: 'shot', side: actor.side, playerId: actor.player.id, params: { player: playerName(actor.player), xG, distance: round(distanceToGoal,1) } });
  }

  private performSkill(actor: ArcadeActor, dx: number, dy: number): void {
    if (actor.skillCooldown > 0 || this.ball.ownerId !== actor.player.id) return;
    const opponent = this.closestOpponent(actor);
    const success = clamp(0.35 + actor.player.attributes.dribbling / 150 + actor.stamina / 500 - Math.max(0, 3 - opponent) * 0.08, 0.2, 0.9);
    actor.skillCooldown = 0.75;
    if (this.rng.bool(success)) {
      const lateral = Math.abs(dy) > Math.abs(dx);
      // A skill changes momentum; displacement still goes through the fixed-step integrator.
      const skillX = lateral ? -actor.facingY * Math.sign(dy || 1) : -actor.facingX;
      const skillY = lateral ? actor.facingX * Math.sign(dy || 1) : -actor.facingY;
      actor.vx = actor.vx * 0.45 + skillX * 2.7;
      actor.vy = actor.vy * 0.45 + skillY * 2.7;
      this.ball.vx = actor.vx + skillX * 1.3;
      this.ball.vy = actor.vy + skillY * 1.3;
      this.ball.controlledTouch = 0;
      this.setAction(actor, lateral ? 'ball-roll' : 'drag-back');
    } else {
      this.releaseBall(actor, actor.facingX * 4 + this.rng.float(-2, 2), actor.facingY * 4 + this.rng.float(-2, 2), 0.5, 0);
      this.setAction(actor, 'skill-failed');
    }
  }

  private releaseBall(actor: ArcadeActor, vx: number, vy: number, vz: number, spin: number): void {
    this.ball.ownerId = null;
    actor.contact = { tick: this.tick, x: this.ball.x, y: this.ball.y, z: this.ball.z, kind: 'foot', foot: actor.player.foot === 'Left' ? 'left' : 'right' };
    // The ball leaves its actual contact point, preserving visual continuity.
    this.ball.z = Math.max(BALL_RADIUS, this.ball.z);
    this.ball.vx = vx;
    this.ball.vy = vy;
    this.ball.vz = vz;
    this.ball.spin = spin;
    this.ball.lastTouch = actor.side;
    this.ball.lastTouchPlayerId = actor.player.id;
    this.ball.controlledTouch = 0;
  }

  private resolvePressureTackles(dt: number): void {
    const owner = this.owner();
    if (!owner) return;
    for (const defender of this.actors) {
      if (!defender.active || defender.side === owner.side || defender.player.positionGroup === 'GK' || defender.tackleCooldown > 0) continue;
      if (distance(defender, owner) > 1.25) continue;
      const pressing = this.teamOf(defender.side).tactics.pressing;
      const press = pressing === 'gegenpress' ? 1.45 : pressing === 'high' ? 1.2 : 1;
      if (this.rng.bool(dt * (0.22 + defender.player.attributes.defending / 115) * press)) {
        const slideChance = pressing === 'gegenpress' ? 0.08 : pressing === 'high' ? 0.04 : pressing === 'medium' ? 0.01 : 0.004;
        this.attemptTackle(defender, this.rng.bool(slideChance));
      }
    }
  }

  private attemptTackle(actor: ArcadeActor, sliding: boolean): void {
    const owner = this.owner();
    if (!owner || owner.side === actor.side || actor.tackleCooldown > 0) return;
    const reach = sliding ? 2.25 : 1.45;
    if (distance(actor, owner) > reach) return;
    actor.tackleCooldown = sliding ? 1.15 : 0.45;
    this.setAction(actor, sliding ? 'slide' : 'standing-tackle');
    const relativeX = owner.x - actor.x;
    const relativeY = owner.y - actor.y;
    const approach = (relativeX * actor.facingX + relativeY * actor.facingY) / Math.max(0.1, Math.hypot(relativeX, relativeY));
    const speed = Math.hypot(actor.vx - owner.vx, actor.vy - owner.vy);
    const winChance = clamp(0.28 + actor.player.attributes.defending / 170 - owner.player.attributes.dribbling / 260 + approach * 0.12 + (sliding ? 0.08 : 0), 0.12, 0.82);
    const ballReach = distance(actor, this.ball) <= (sliding ? 1.9 : 1.15) && this.ball.z < .65;
    if (ballReach && this.rng.bool(winChance)) {
      if (!this.legalRestartTouch(actor)) return;
      this.ball.ownerId = actor.player.id;
      this.ball.lastTouch = actor.side;
      this.ball.lastTouchPlayerId = actor.player.id;
      this.ball.controlledTouch = 0;
      actor.contact = {tick:this.tick,x:this.ball.x,y:this.ball.y,z:this.ball.z,kind:'foot',foot:'right'};
      this.stats(actor.side).tacklesWon++;
      this.ratings[actor.player.id] = clamp((this.ratings[actor.player.id] ?? 6.5) + 0.09, 1, 10);
      return;
    }
    const foulRisk = clamp((sliding ? 0.22 : 0.07) + speed * 0.018 + Math.max(0, -approach) * 0.12, 0.03, 0.68);
    if (this.rng.bool(foulRisk)) this.callFoul(actor, owner, sliding, speed);
  }

  private callFoul(defender: ArcadeActor, victim: ArcadeActor, sliding: boolean, speed: number): void {
    const stats = this.stats(defender.side);
    stats.fouls++;
    const severity = speed + (sliding ? 4 : 0);
    const yellow = severity > 8 || this.rng.bool(clamp(severity / 26, 0.06, 0.55));
    const straightRed = severity > 11 && this.rng.bool(clamp((severity - 9) / 75, 0.025, 0.16));
    let eventType: MatchEvent['type'] = 'foul';
    if (straightRed || (yellow && defender.card === 'yellow')) {
      defender.card = 'red';
      defender.active = false;
      stats.reds++;
      this.contributions[defender.player.id].reds++;
      eventType = 'red';
    } else if (yellow) {
      defender.card = 'yellow';
      stats.yellows++;
      this.contributions[defender.player.id].yellows++;
      eventType = 'yellow';
    }
    const victimDirection = this.attackDirection(victim.side);
    const inBox = Math.abs(victim.y - FIELD_WIDTH / 2) <= 20.16 && (victimDirection > 0 ? victim.x > FIELD_LENGTH - 16.5 : victim.x < 16.5);
    this.events.push({ minute: this.footballMinute, type: eventType, side: defender.side, playerId: defender.player.id, messageKey: inBox ? 'match.penalty' : eventType === 'red' ? 'match.red' : eventType === 'yellow' ? 'match.yellow' : 'match.freeKick', params: { player: playerName(defender.player) } });
    if (this.rng.bool(clamp((severity - 8) / 220, 0.005, 0.06))) {
      this.setAction(victim, 'injured');
      const injury = createInjury({ seed: this.config.seed ^ this.tick, player: victim.player, cause: 'contact', season: 0, week: 0, fixtureId: this.config.fixtureId, matchMinute: this.footballMinute, severityBias: severity / 20 });
      this.events.push({ minute: this.footballMinute, type: 'injury', side: victim.side, playerId: victim.player.id, messageKey: 'match.injury', params: { player: playerName(victim.player), diagnosis: injury.diagnosisId }, injury });
    }
    const canPlayAdvantage = !inBox && victim.action !== 'injured' && Math.hypot(victim.vx, victim.vy) > 1;
    if (canPlayAdvantage) {
      this.rule = this.newRule('advantage', victim.side, victim.x, victim.y);
      this.rule.advantageSide = victim.side;
    } else {
      this.setRestart(inBox ? 'penalty' : 'freeKick', victim.side, victim.x, victim.y);
    }
    if (!defender.active && defender.player.id === this.selectedPlayerId) this.selectedPlayerId = this.bestControlledActor().player.id;
  }

  private updateBall(dt: number): void {
    const owner = this.owner();
    this.ball.controlledTouch += dt;
    if (owner) {
      const speed = Math.hypot(owner.vx, owner.vy);
      const sprinting = speed > this.maxSpeed(owner, false) * 0.98;
      const close = owner.action === 'ball-roll' || owner.action === 'drag-back';
      const reach = sprinting ? 2.0 : 1.35;
      if (distance(owner, this.ball) > reach || this.ball.z > 1.4) {
        this.ball.ownerId = null;
      } else {
        const interval = close ? 0.12 : sprinting ? 0.25 : 0.18;
        if (this.ball.controlledTouch >= interval) {
          const lead = close ? 0.35 : sprinting ? 0.95 : 0.5;
          const targetX = owner.x + owner.facingX * lead;
          const targetY = owner.y + owner.facingY * lead;
          const correction = accelerateTowards(this.ball.vx, this.ball.vy,
            owner.vx + (targetX - this.ball.x) / interval,
            owner.vy + (targetY - this.ball.y) / interval, 9);
          this.ball.vx = correction.x;
          this.ball.vy = correction.y;
          this.ball.vz = speed > 1 ? 0.35 : 0;
          this.ball.controlledTouch = 0;
          owner.contact = { tick: this.tick, x: this.ball.x, y: this.ball.y, z: this.ball.z, kind: 'foot', foot: owner.player.foot === 'Left' ? 'left' : 'right' };
          this.ball.lastTouch = owner.side;
          this.ball.lastTouchPlayerId = owner.player.id;
        }
      }
    }
    // At most 8 cm per substep: even a full-power shot cannot tunnel through a post.
    const count = Math.max(1, Math.ceil(Math.hypot(this.ball.vx, this.ball.vy, this.ball.vz) * dt / 0.08));
    const h = dt / count;
    for (let i = 0; i < count; i++) {
      this.ball.x += this.ball.vx * h;
      this.ball.y += this.ball.vy * h;
      this.ball.z += this.ball.vz * h;
      this.ball.vz -= 9.81 * h;
      this.ball.vy += this.ball.spin * Math.abs(this.ball.vx) * 0.048 * h;
      if (this.ball.z <= BALL_RADIUS) {
        this.ball.z = BALL_RADIUS;
        this.ball.vz = this.ball.vz < -1 ? -this.ball.vz * 0.48 : 0;
        const friction = Math.exp(-(this.config.weather === 'clear' ? 0.55 : 0.4) * h);
        this.ball.vx *= friction;
        this.ball.vy *= friction;
        this.ball.spin *= Math.pow(0.35, h);
      } else {
        this.ball.vx *= Math.exp(-0.16 * h);
        this.ball.vy *= Math.exp(-0.16 * h);
      }
      const post = collideGoalFrame(this.ball, 0, FIELD_WIDTH / 2, GOAL_WIDTH, GOAL_HEIGHT);
      const otherPost = collideGoalFrame(this.ball, FIELD_LENGTH, FIELD_WIDTH / 2, GOAL_WIDTH, GOAL_HEIGHT);
      if (post || otherPost) {
        this.ball.ownerId = null;
        if (this.activeShot) this.activeShot.checkedKeeper = false;
      }
      if (!this.ball.ownerId) this.handlePostsAndKeeper();
      if (this.rule.phase !== 'playing' && this.rule.phase !== 'advantage') return;
      if (this.handleBoundary()) return;
    }
    if (!this.ball.ownerId) this.tryBallControl();
  }

  private handlePostsAndKeeper(): void {
    if (this.ball.ownerId || this.ball.z > 2.45) return;
    const keeper = this.actors.find(actor => actor.active && actor.player.positionGroup === 'GK'
      && this.inOwnPenaltyArea(actor) && distance(actor, this.ball) < 1.3 + actor.player.attributes.goalkeeping * 0.006);
    if (!keeper || (this.ball.lastTouchPlayerId === keeper.player.id && this.ball.controlledTouch < 0.35)) return;
    const shot = this.activeShot;
    if (shot?.checkedKeeper) return;
    if (shot) shot.checkedKeeper = true;
    const reaction = keeper.player.attributes.goalkeeping / 100;
    const speed = Math.hypot(this.ball.vx, this.ball.vy);
    const reachDistance = distance(keeper, this.ball);
    const blockChance = clamp(0.84 + reaction * 0.24 - speed * 0.0015 - reachDistance * 0.025, 0.45, 0.98);
    if (reachDistance > 0.4 && !this.rng.bool(blockChance)) return;
    if (!this.legalRestartTouch(keeper)) return;
    const difficulty = speed / 95 + Math.max(0, this.ball.z - 1.2) * 0.1;
    const catchBall = distance(keeper, this.ball) < 1.15 && this.rng.bool(clamp(0.45 + reaction * 0.5 - difficulty, 0.15, 0.92));
    if (shot && shot.side !== keeper.side) {
      this.stats(keeper.side).saves++;
      this.ratings[keeper.player.id] = clamp((this.ratings[keeper.player.id] ?? 6.5) + 0.18 + shot.xG * 0.25, 1, 10);
      this.events.push({ minute: this.footballMinute, type: 'save', side: keeper.side, playerId: keeper.player.id, params: { keeper: playerName(keeper.player) } });
    }
    keeper.contact = { tick: this.tick, x: this.ball.x, y: this.ball.y, z: this.ball.z, kind: 'hand', foot: 'right' };
    this.ball.lastTouch = keeper.side;
    this.ball.lastTouchPlayerId = keeper.player.id;
    this.ball.controlledTouch = 0;
    if (catchBall) {
      this.ball.ownerId = keeper.player.id;
      this.ball.vx = this.ball.vy = this.ball.vz = 0;
      this.setAction(keeper, 'keeper-catch');
      keeper.decisionCooldown = 0.45;
    } else {
      const direction = this.attackDirection(keeper.side);
      this.ball.vx = direction * Math.max(3, Math.abs(this.ball.vx) * 0.38);
      this.ball.vy = (this.ball.y >= keeper.y ? 1 : -1) * (3 + speed * 0.18);
      this.ball.vz = 2.2;
      this.setAction(keeper, distance(keeper, this.ball) > 1.15 ? 'keeper-dive' : 'keeper-parry');
    }
    this.activeShot = null;
    this.intendedReceiverId = null;
    if (catchBall) this.football.offsideCandidates = [];
  }

  private inOwnPenaltyArea(actor: ArcadeActor): boolean {
    const goalDistance = this.attackDirection(actor.side) > 0 ? actor.x : FIELD_LENGTH - actor.x;
    return goalDistance <= 16.5 && Math.abs(actor.y - FIELD_WIDTH / 2) <= 20.16;
  }

  private handleBoundary(): boolean {
    if (this.ball.x < -BALL_RADIUS || this.ball.x > FIELD_LENGTH + BALL_RADIUS) {
      const inGoal = Math.abs(this.ball.y - FIELD_WIDTH / 2) <= GOAL_WIDTH / 2 - BALL_RADIUS && this.ball.z <= GOAL_HEIGHT - BALL_RADIUS;
      if (inGoal) {
        const scoringSide = this.ball.x > FIELD_LENGTH ? this.sideAttackingDirection(1) : this.sideAttackingDirection(-1);
        const restart = this.football.restartRelease;
        if (restart && (scoringSide !== restart.side || restart.phase==='throwIn' || restart.indirect)) {
          const own = scoringSide !== restart.side;
          const endX=this.ball.x<0?0:FIELD_LENGTH;
          this.setRestart(own?'corner':'goalKick',own?scoringSide:this.opposite(scoringSide),own?endX:endX===0?5.5:99.5,own?0:34);
          return true;
        }
        this.scoreGoal(this.ball.x > FIELD_LENGTH ? this.sideAttackingDirection(1) : this.sideAttackingDirection(-1));
        return true;
      }
      const attacking = this.ball.x > FIELD_LENGTH ? this.sideAttackingDirection(1) : this.sideAttackingDirection(-1);
      const corner = this.ball.lastTouch !== attacking;
      if (corner) this.stats(attacking).corners++;
      this.events.push({ minute: this.footballMinute, type: corner ? 'corner' : 'commentary', side: corner ? attacking : null, playerId: null, messageKey: corner ? 'match.corner' : 'match.goalKick', params: { team: this.teamOf(attacking).shortName } });
      const endX = this.ball.x < 0 ? 0 : FIELD_LENGTH;
      this.setRestart(corner ? 'corner' : 'goalKick', corner ? attacking : this.opposite(attacking), corner ? endX : endX === 0 ? 5.5 : FIELD_LENGTH - 5.5, corner ? this.ball.y < FIELD_WIDTH / 2 ? 0 : FIELD_WIDTH : FIELD_WIDTH / 2);
      return true;
    }
    if (this.ball.y < -BALL_RADIUS || this.ball.y > FIELD_WIDTH + BALL_RADIUS) {
      const side = this.opposite(this.ball.lastTouch);
      this.events.push({ minute: this.footballMinute, type: 'commentary', side, playerId: null, messageKey: 'match.throwIn', params: { team: this.teamOf(side).shortName } });
      this.setRestart('throwIn', side, clamp(this.ball.x, 1, FIELD_LENGTH - 1), clamp(this.ball.y, 0, FIELD_WIDTH));
      return true;
    }
    return false;
  }

  private tryBallControl(): void {
    if (this.ball.z > 1.4) { this.tryHeader(); return; }
    const speed = Math.hypot(this.ball.vx, this.ball.vy);
    let candidate: ArcadeActor | undefined;
    let candidateScore = Number.POSITIVE_INFINITY;
    for (const actor of this.actors) {
      if (!actor.active || (this.ball.controlledTouch < 0.14 && actor.player.id === this.ball.lastTouchPlayerId)) continue;
      const intended = actor.player.id === this.intendedReceiverId;
      const controlRadius = this.ball.z > 0.75 ? 0.7 : intended ? 1.05 : 0.95;
      if (this.ball.z > 0.75 && speed > 12) continue;
      const controlDistance = distance(actor, this.ball);
      if (controlDistance >= controlRadius) continue;
      const score = controlDistance - (intended ? ARCADE_MATCH_TUNING.intendedReceiverControlBias : 0);
      if (score < candidateScore) {
        candidate = actor;
        candidateScore = score;
      }
    }
    if (!candidate) return;
    if (!this.legalRestartTouch(candidate)) return;
    if (this.pendingOffsideTargetId === candidate.player.id || this.football.offsideCandidates.includes(candidate.player.id)) {
      this.stats(candidate.side).offsides++;
      this.events.push({ minute: this.footballMinute, type: 'foul', side: candidate.side, playerId: candidate.player.id, messageKey: 'match.offside', params: { player: playerName(candidate.player) } });
      this.pendingOffsideTargetId = null;
      this.setRestart('freeKick', this.opposite(candidate.side), candidate.x, candidate.y, true);
      return;
    }
    const firstTouch = candidate.player.attributes.dribbling + candidate.stamina * 0.25 - speed * 1.4;
    const weatherPenalty = this.config.weather === 'rain' ? 8 : this.config.weather === 'storm' ? 11 : 0;
    const humanReceiver = this.config.controllerMode === 'human' && candidate.side === this.controlledSide;
    const intendedAiReceiverBonus = !humanReceiver && candidate.player.id === this.intendedReceiverId
      ? ARCADE_MATCH_TUNING.aiIntendedReceiverBonus
      : 0;
    const assistBonus = humanReceiver
      ? this.config.assist === 'assisted' ? 14 : this.config.assist === 'balanced' ? 7 : 1
      : ARCADE_MATCH_TUNING.aiFirstTouchAssist + intendedAiReceiverBonus;
    if (this.rng.bool(clamp((firstTouch + assistBonus - weatherPenalty) / 100, 0.18, 0.96))) {
      this.ball.ownerId = candidate.player.id;
      this.ball.vx = candidate.vx;
      this.ball.vy = candidate.vy;
      this.ball.vz = -0.5;
      this.ball.controlledTouch = 0.18;
      this.ball.lastTouch = candidate.side;
      this.ball.lastTouchPlayerId = candidate.player.id;
      if (this.lastPasser && !this.lastPasser.received && this.elapsed - this.lastPasser.at <= 5) {
        if (candidate.side === this.lastPasser.side && candidate.player.id !== this.lastPasser.id) {
          this.lastPasser.received = true;
          this.passCompletions[candidate.side]++;
          this.stats(candidate.side).passesCompleted++;
          this.ratings[this.lastPasser.id] = clamp((this.ratings[this.lastPasser.id] ?? 6.5) + 0.025, 1, 10);
        } else if (candidate.side !== this.lastPasser.side) {
          this.lastPasser = null;
          this.stats(candidate.side).interceptions++;
        }
      }
      this.pendingOffsideTargetId = null;
      this.football.offsideCandidates = [];
      this.intendedReceiverId = null;
      this.activeShot = null;
      if (!this.isHumanControlled(candidate)) {
        const settle = 0.08 + (100 - candidate.player.attributes.dribbling) * 0.0012;
        candidate.decisionCooldown = Math.max(candidate.decisionCooldown, settle);
      }
      if (candidate.side === this.controlledSide && !this.config.playerLockId && this.tick >= this.football.selectionUntilTick) this.selectedPlayerId = candidate.player.id;
      if (candidate.side === this.controlledSide && this.football.queuedAction && this.football.queuedAction.expiresTick >= this.tick) {
        this.executeFootballAction(candidate, this.football.queuedAction);
        this.football.queuedAction = null;
      }
    } else {
      this.ball.lastTouchPlayerId = candidate.player.id;
      this.ball.lastTouch = candidate.side;
      this.ball.controlledTouch = 0;
      this.ball.vx *= 0.48;
      this.ball.vy += this.rng.float(-2.5, 2.5);
      this.setAction(candidate, 'heavy-touch');
    }
  }

  private tryHeader(): void {
    if (this.ball.z > 2.45 || this.ball.z < 1.4) return;
    const actor = this.actors.find(a => a.active && a.player.positionGroup !== 'GK'
      && distance(a, this.ball) < 0.7 && !(a.player.id === this.ball.lastTouchPlayerId && this.ball.controlledTouch < 0.3));
    if (!actor) return;
    const queued = actor.side === this.controlledSide ? this.football.queuedAction : null;
    const direction = this.attackDirection(actor.side);
    const goalX = direction > 0 ? FIELD_LENGTH : 0;
    const goalDistance = Math.abs(goalX - actor.x);
    const attempt = queued?.kind === 'shoot' || (!this.isHumanControlled(actor) && goalDistance < 18);
    if (!attempt) return;
    if (!this.legalRestartTouch(actor)) return;
    if (this.football.offsideCandidates.includes(actor.player.id)) {
      this.stats(actor.side).offsides++;
      this.setRestart('freeKick', this.opposite(actor.side), actor.x, actor.y, true);
      return;
    }
    const targetY = 34 + (queued?.aimY ?? this.rng.float(-0.6, 0.6)) * 2.6;
    const length = Math.hypot(goalX - actor.x, targetY - actor.y);
    const speed = 11 + actor.player.attributes.physical * 0.07;
    this.releaseBall(actor, (goalX - actor.x) / length * speed, (targetY - actor.y) / length * speed, -1.4, 0);
    if (actor.contact) actor.contact.kind = 'head';
    this.setAction(actor, 'header');
    this.stats(actor.side).shots++;
    this.stats(actor.side).shotsOnTarget++;
    this.stats(actor.side).xG = round(this.stats(actor.side).xG + 0.18, 2);
    this.activeShot = { shooterId: actor.player.id, side: actor.side, xG: 0.18, targetY, checkedKeeper: false };
    this.football.queuedAction = null;
    this.events.push({ minute: this.footballMinute, type: 'shot', side: actor.side, playerId: actor.player.id, params: { player: playerName(actor.player), xG: 0.18 } });
  }

  private scoreGoal(side: Side): void {
    if (!this.activeShot) {
      const stats = this.stats(side);
      stats.shots++;
      stats.shotsOnTarget++;
      stats.xG = round(stats.xG + 0.04, 2);
    }
    if (side === 'home') this.homeScore++;
    else this.awayScore++;
    const scorer = this.actors.find((actor) => actor.player.id === this.ball.lastTouchPlayerId);
    if (scorer) {
      this.contributions[scorer.player.id].goals++;
      this.ratings[scorer.player.id] = clamp(this.ratings[scorer.player.id] + 1.2, 1, 10);
    }
    const assister = this.lastPasser && this.lastPasser.side === side && this.elapsed - this.lastPasser.at <= 8 && this.lastPasser.id !== scorer?.player.id
      ? this.actors.find((actor) => actor.player.id === this.lastPasser!.id)
      : undefined;
    if (assister) {
      this.contributions[assister.player.id].assists++;
      this.ratings[assister.player.id] = clamp(this.ratings[assister.player.id] + 0.65, 1, 10);
    }
    this.events.push({
      minute: this.footballMinute,
      type: 'goal',
      side,
      playerId: scorer?.player.id ?? null,
      playerName: scorer ? playerName(scorer.player) : undefined,
      assistName: assister ? playerName(assister.player) : undefined,
      messageKey: assister ? 'match.goal.assist' : 'match.goal.solo',
      params: { player: scorer ? playerName(scorer.player) : this.teamOf(side).shortName, ...(assister ? { assist: playerName(assister.player) } : {}) },
    });
    this.frozenReplay = this.replayBuffer.slice(-40).map((snapshot) => structuredClone(snapshot));
    this.lastPasser = null;
    this.activeShot = null;
    this.resetKickoff(this.opposite(side));
    if (this.config.mode !== 'instant') {
      this.phase = 'goalReplay';
      this.paused = true;
    }
  }

  private setRestart(phase: RuleState['phase'], side: Side, x: number, y: number, indirect = false): void {
    this.football.queuedAction = null;
    this.football.offsideCandidates = [];
    this.football.restartRelease = null;
    if (phase === 'penalty') { x = this.attackDirection(side) > 0 ? 94 : 11; y = 34; }
    this.rule = this.newRule(phase, side, x, y, indirect);
    this.phase = 'stoppage';
    this.ball.ownerId = null;
    this.ball.x = clamp(x, 0, FIELD_LENGTH);
    this.ball.y = clamp(y, 0, FIELD_WIDTH);
    this.ball.z = 0;
    this.ball.vx = this.ball.vy = this.ball.vz = 0;
    this.activeShot = null;
    this.intendedReceiverId = null;
    this.pendingOffsideTargetId = null;
  }

  private updateAdvantage(dt: number): void {
    if (this.rule.phase !== 'advantage') return;
    this.rule.elapsed += dt;
    const owner = this.owner();
    if (owner && owner.side !== this.rule.advantageSide) {
      this.setRestart('freeKick', this.rule.advantageSide ?? this.opposite(owner.side), this.rule.spotX, this.rule.spotY);
    } else if (this.rule.elapsed >= 2.4) {
      this.rule = this.newRule('playing', null, this.ball.x, this.ball.y);
    }
  }

  private updateRestart(dt: number, input: MatchCommand): void {
    if (this.rule.phase === 'halftime' || this.rule.phase === 'fulltime') return;
    const phase = this.rule.phase;
    const side = this.rule.restartSide ?? 'home';
    const team = this.teamOf(side);
    const nominated = phase === 'penalty' ? team.tactics.penaltyTakerId : phase === 'corner' ? team.tactics.cornerTakerId : phase === 'freeKick' ? team.tactics.freeKickTakerId : null;
    const candidates = this.actors.filter(actor => actor.active && actor.side === side);
    const taker = candidates.find(actor => actor.player.id === nominated)
      ?? (phase === 'goalKick' ? candidates.find(actor => actor.player.positionGroup === 'GK') : undefined)
      ?? candidates.filter(actor=>actor.player.positionGroup!=='GK').sort((a,b)=>distance(a,this.ball)-distance(b,this.ball))[0]
      ?? candidates[0];
    if (!taker) return;
    if (this.rule.elapsed === 0) {
      this.arrangeRestart(taker);
      this.actionHeld = {pass:0,through:0,lob:0,shoot:0};
    }
    this.rule.elapsed += dt;
    const human = side === this.controlledSide && this.config.controllerMode === 'human';
    if (human) for (const kind of ['pass','through','lob','shoot'] as const) {
      if (input[kind]) this.actionHeld[kind] = Math.min(.9,this.actionHeld[kind]+dt);
      if (!input[kind] && this.previousInput[kind] && this.actionHeld[kind] > 0) {
        this.football.queuedAction = { kind, power:this.charge(this.actionHeld[kind],.9),
          aimX:input.aimX*this.currentAttackDirection,aimY:input.aimY,finesse:input.skill,low:this.actionHeld[kind]<.14,expiresTick:this.tick+180 };
      }
    }
    const forced = this.rule.elapsed >= 3;
    if (this.rule.elapsed < .42 || (human && !this.football.queuedAction && !forced)) return;
    const command = this.football.queuedAction;
    const indirect = this.rule.indirect;
    const direction = this.attackDirection(side);
    this.ball.ownerId = taker.player.id;
    this.ball.lastTouch = side;
    this.ball.lastTouchPlayerId = taker.player.id;
    this.ball.controlledTouch = 0;
    this.rule = this.newRule('playing',null,this.ball.x,this.ball.y);
    this.phase = this.halftimeReached ? 'secondHalf' : 'firstHalf';
    const aimX = command && Math.hypot(command.aimX,command.aimY)>.1 ? command.aimX : phase==='kickoff'?-direction:direction;
    const aimY = command?.aimY ?? 0;
    if (phase === 'penalty' || command?.kind === 'shoot' && phase !== 'throwIn' && !indirect) {
      this.shoot(taker,command?.power ?? .72,direction,command?.aimY ?? this.rng.float(-.75,.75),command?.finesse ?? false,command?.low ?? false);
    } else {
      const lob = phase === 'corner' || command?.kind === 'lob';
      this.pass(taker,command?.kind==='through',lob,command?.power ?? (lob?.75:.4),aimX,aimY);
      if (phase === 'throwIn') {
        this.ball.z = 1.65;
        this.ball.vz = 2.6;
        if (taker.contact) taker.contact.kind = 'hand';
        this.setAction(taker,'keeper-throw');
      }
    }
    if (['corner','goalKick','throwIn'].includes(phase)) {
      this.football.offsideCandidates = [];
      this.pendingOffsideTargetId = null;
    }
    this.football.restartRelease = {phase,side,takerId:taker.player.id,indirect};
    this.football.queuedAction = null;
    this.actionHeld = {pass:0,through:0,lob:0,shoot:0};
  }

  private arrangeRestart(taker: ArcadeActor): void {
    const rule = this.rule;
    const direction = this.attackDirection(taker.side);
    taker.x = clamp(rule.spotX - direction*.45,.4,104.6);
    taker.y = clamp(rule.spotY,.4,67.6);
    taker.vx = taker.vy = 0;
    taker.facingX = direction; taker.facingY = 0;
    this.ball.x = rule.spotX; this.ball.y = rule.spotY; this.ball.z = BALL_RADIUS;
    if (taker.side === this.controlledSide && !this.config.playerLockId) this.selectedPlayerId = taker.player.id;
    for (const actor of this.actors) {
      if (!actor.active || actor===taker) continue;
      actor.vx=actor.vy=0;
      const separation = rule.phase==='throwIn'?2:9.15;
      if (rule.phase==='kickoff') {
        actor.x = this.attackDirection(actor.side)>0 ? Math.min(actor.x,51) : Math.max(actor.x,54);
      }
      if (rule.phase==='penalty') {
        if (actor.side!==taker.side && actor.player.positionGroup==='GK') { actor.x=direction>0?104.89:.11; actor.y=34; continue; }
        actor.x=direction>0?Math.min(actor.x,87):Math.max(actor.x,18);
      }
      if (rule.phase==='goalKick' && actor.side!==taker.side && Math.abs(actor.y-34)<20.16) {
        actor.x=direction>0?Math.max(actor.x,17):Math.min(actor.x,88);
      }
      if (actor.side!==taker.side && distance(actor,this.ball)<separation) {
        const dx=actor.x-this.ball.x || -direction,dy=actor.y-this.ball.y;
        const length=Math.hypot(dx,dy)||1;
        actor.x=clamp(this.ball.x+dx/length*separation,.4,104.6);
        actor.y=clamp(this.ball.y+dy/length*separation,.4,67.6);
      }
    }
  }

  private legalRestartTouch(actor: ArcadeActor): boolean {
    const restart = this.football.restartRelease;
    if (!restart) return true;
    if (restart.takerId === actor.player.id) {
      this.setRestart('freeKick',this.opposite(actor.side),this.ball.x,this.ball.y,true);
      return false;
    }
    this.football.restartRelease = null;
    return true;
  }

  private resetKickoff(side: Side): void {
    this.football.restartRelease = null;
    this.football.queuedAction = null;
    for (const actor of this.actors) {
      if (!actor.active) continue;
      actor.x = actor.homeX;
      actor.y = actor.homeY;
      actor.vx = actor.vy = 0;
      actor.intentX = actor.homeX;
      actor.intentY = actor.homeY;
    }
    this.ball.x = FIELD_LENGTH / 2;
    this.ball.y = FIELD_WIDTH / 2;
    this.ball.z = 0;
    this.ball.vx = this.ball.vy = this.ball.vz = this.ball.spin = 0;
    this.ball.ownerId = null;
    this.ball.lastTouch = side;
    this.ball.lastTouchPlayerId = null;
    this.activeShot = null;
    this.intendedReceiverId = null;
    this.pendingOffsideTargetId = null;
    this.rule = this.newRule('kickoff', side, this.ball.x, this.ball.y);
    this.phase = 'stoppage';
    this.paused = false;
  }

  private enterHalftime(): void {
    this.halftimeReached = true;
    this.phase = 'halftime';
    this.paused = true;
    this.rule = this.newRule('halftime', null, this.ball.x, this.ball.y);
    this.events.push({ minute: 45, type: 'halftime', side: null, playerId: null, messageKey: 'match.halftime', params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore } });
  }

  private rebaseFormation(): void {
    for (const actor of this.actors) {
      actor.homeX = FIELD_LENGTH - actor.homeX;
      actor.facingX *= -1;
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.paused = true;
    this.elapsed = this.totalSeconds;
    this.phase = 'fulltime';
    this.rule = this.newRule('fulltime', null, this.ball.x, this.ball.y);
    this.events.push({ minute: 90, type: 'fulltime', side: null, playerId: null, messageKey: 'match.fulltime', params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore } });
    const motm = [...this.actors].filter((actor) => actor.active || this.ratings[actor.player.id] !== undefined).sort((a, b) => (this.ratings[b.player.id] ?? 0) - (this.ratings[a.player.id] ?? 0))[0]?.player.id ?? null;
    this.finalResult = {
      id: this.matchId,
      fixtureId: this.config.fixtureId,
      matchSeed: this.config.seed,
      weather: this.config.weather,
      week: 0,
      homeTeamId: this.home.id,
      awayTeamId: this.away.id,
      homeTeamName: this.home.name,
      awayTeamName: this.away.name,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      events: [...this.events],
      homeStats: this.finishStats(this.homeStats, 'home'),
      awayStats: this.finishStats(this.awayStats, 'away'),
      keyframes: [...this.keyframes],
      manOfTheMatchId: motm,
      ratings: { ...this.ratings },
      contributions: structuredClone(this.contributions),
      heatmaps: structuredClone(this.heatmaps),
      endingFitness: Object.fromEntries(this.actors.map((actor) => [actor.player.id, round(actor.stamina, 1)])),
      played: true,
    };
  }

  private finishStats(stats: TeamMatchStats, side: Side): TeamMatchStats {
    stats.passesAttempted = this.passAttempts[side];
    stats.passesCompleted = this.passCompletions[side];
    stats.passAccuracy = stats.passesAttempted ? clamp(Math.round(stats.passesCompleted / stats.passesAttempted * 100), 0, 100) : 0;
    return { ...stats };
  }

  private recordTelemetry(): void {
    const minute = this.footballMinute;
    if (minute % 3 === 0 && minute !== this.lastKeyframeMinute) {
      this.lastKeyframeMinute = minute;
      this.keyframes.push({ minute, ball: { x: clamp(this.ball.x / FIELD_LENGTH, 0, 1), y: clamp(this.ball.y / FIELD_WIDTH, 0, 1) }, homeInPossession: this.owner()?.side === 'home' });
    }
    if (this.config.mode !== 'instant' && this.tick % 6 === 0) {
      this.replayBuffer.push(this.snapshot());
      if (this.replayBuffer.length > 60) this.replayBuffer.shift();
    }
    const heatmapInterval = this.config.mode === 'instant' ? 180 : 60;
    if (this.tick % heatmapInterval === 0) {
      for (const actor of this.actors) {
        if (!actor.active) continue;
        const list = this.heatmaps[actor.player.id] ?? (this.heatmaps[actor.player.id] = []);
        const cell = list.find((point) => Math.abs(point.x - actor.x) < 5 && Math.abs(point.y - actor.y) < 5);
        if (cell) cell.weight++;
        else if (list.length < 48) list.push({ x: round(actor.x, 1), y: round(actor.y, 1), weight: 1 });
      }
    }
    if (this.config.mode !== 'instant' && this.tick % 30 === 0) this.safeSnapshot = this.snapshot();
  }

  private updatePossessionStats(dt: number): void {
    const owner = this.owner();
    if (owner?.side === 'home') this.possessionHomeSeconds += dt;
    else if (owner?.side === 'away') this.possessionAwaySeconds += dt;
    const total = this.possessionHomeSeconds + this.possessionAwaySeconds || 1;
    this.homeStats.possession = Math.round(this.possessionHomeSeconds / total * 100);
    this.awayStats.possession = 100 - this.homeStats.possession;
  }

  private resolvePlayerCollisions(): void {
    const cellSize = 6;
    const columns = 18;
    const rows = 12;
    for (const index of this.usedCollisionBuckets) this.collisionGrid[index].length = 0;
    this.usedCollisionBuckets.length = 0;
    for (const actor of this.actors) {
      if (!actor.active) continue;
      const gx = Math.min(columns - 1, Math.floor(actor.x / cellSize));
      const gy = Math.min(rows - 1, Math.floor(actor.y / cellSize));
      const index = gy * columns + gx;
      if (this.collisionGrid[index].length === 0) this.usedCollisionBuckets.push(index);
      this.collisionGrid[index].push(actor);
    }
    for (const actor of this.actors) {
      if (!actor.active) continue;
      const gx = Math.floor(actor.x / cellSize);
      const gy = Math.floor(actor.y / cellSize);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cx = gx + ox;
        const cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= columns || cy >= rows) continue;
        for (const other of this.collisionGrid[cy * columns + cx]) {
          if (other === actor || other.player.id < actor.player.id) continue;
          const dx = other.x - actor.x;
          const dy = other.y - actor.y;
          const minimum = 1.05;
          const lengthSquared = dx * dx + dy * dy;
          if (lengthSquared >= minimum * minimum) continue;
          const length = Math.sqrt(lengthSquared) || 0.001;
          const normalX = dx / length;
          const normalY = dy / length;
          const penetration = Math.max(0, minimum - length - 0.02);
          const push = penetration * 0.78;
          const massA = 0.75 + actor.player.attributes.physical / 100;
          const massB = 0.75 + other.player.attributes.physical / 100;
          const totalMass = massA + massB;
          actor.x = clamp(actor.x - normalX * push * (massB / totalMass), 0.8, FIELD_LENGTH - 0.8);
          actor.y = clamp(actor.y - normalY * push * (massB / totalMass), 0.8, FIELD_WIDTH - 0.8);
          other.x = clamp(other.x + normalX * push * (massA / totalMass), 0.8, FIELD_LENGTH - 0.8);
          other.y = clamp(other.y + normalY * push * (massA / totalMass), 0.8, FIELD_WIDTH - 0.8);
          const closingSpeed = (other.vx - actor.vx) * normalX + (other.vy - actor.vy) * normalY;
          if (closingSpeed < 0) {
            const impulse = -closingSpeed * 0.32;
            actor.vx -= normalX * impulse * (massB / totalMass);
            actor.vy -= normalY * impulse * (massB / totalMass);
            other.vx += normalX * impulse * (massA / totalMass);
            other.vy += normalY * impulse * (massA / totalMass);
          }
        }
      }
    }
  }

  private isOffside(target: ArcadeActor, passer: ArcadeActor): boolean {
    const direction = this.attackDirection(passer.side);
    if ((direction > 0 && target.x < FIELD_LENGTH / 2) || (direction < 0 && target.x > FIELD_LENGTH / 2)) return false;
    const defenders = this.actors.filter((actor) => actor.active && actor.side !== passer.side).map((actor) => actor.x).sort((a, b) => a - b);
    if (defenders.length < 2) return false;
    return direction > 0 ? target.x > defenders.at(-2)! && target.x > passer.x : target.x < defenders[1] && target.x < passer.x;
  }

  private passLanePressure(from: ArcadeActor, to: ArcadeActor): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length2 = dx * dx + dy * dy || 1;
    let pressure = 0;
    for (const opponent of this.actors.filter((actor) => actor.active && actor.side !== from.side)) {
      const t = clamp(((opponent.x - from.x) * dx + (opponent.y - from.y) * dy) / length2, 0, 1);
      const px = from.x + dx * t;
      const py = from.y + dy * t;
      if (Math.hypot(opponent.x - px, opponent.y - py) < 2.2) pressure++;
    }
    return pressure;
  }

  private validateState(): void {
    if (this.tick % 15 !== 0) return;
    if (this.isFiniteState()) return;
    this.applySnapshot(this.safeSnapshot);
    this.events.push({ minute: this.footballMinute, type: 'commentary', side: null, playerId: null, text: 'Simulation recovered from an invalid state.' });
    this.paused = true;
    this.phase = 'paused';
  }

  private isFiniteState(): boolean {
    if (![this.ball.x, this.ball.y, this.ball.z, this.ball.vx, this.ball.vy, this.ball.vz].every(Number.isFinite)) return false;
    for (const actor of this.actors) {
      if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y) || !Number.isFinite(actor.vx) || !Number.isFinite(actor.vy) || !Number.isFinite(actor.stamina)) return false;
    }
    return true;
  }

  private applySnapshot(snapshot: MatchSnapshot): void {
    this.tick = snapshot.tick;
    this.elapsed = snapshot.elapsed;
    this.homeScore = snapshot.homeScore;
    this.awayScore = snapshot.awayScore;
    this.selectedPlayerId = snapshot.controlledPlayerId;
    this.phase = snapshot.phase;
    this.rule = { ...snapshot.rule };
    Object.assign(this.ball, snapshot.ball);
    for (const saved of snapshot.players) {
      const actor = this.actors.find((candidate) => candidate.player.id === saved.id);
      if (actor) this.applyActorSnapshot(actor, saved);
    }
  }

  private actorSnapshot(actor: ArcadeActor): PlayerRuntimeSnapshot {
    return {
      contact: actor.contact ? { ...actor.contact } : undefined,
      id: actor.player.id,
      side: actor.side,
      x: actor.x,
      y: actor.y,
      homeX: actor.homeX,
      homeY: actor.homeY,
      vx: actor.vx,
      vy: actor.vy,
      facingX: actor.facingX,
      facingY: actor.facingY,
      fitness: actor.stamina,
      active: actor.active,
      card: actor.card,
      action: actor.action,
      actionStartedTick: actor.actionStartedTick,
      decisionCooldown: actor.decisionCooldown,
      skillCooldown: actor.skillCooldown,
      tackleCooldown: actor.tackleCooldown,
      intentX: actor.intentX,
      intentY: actor.intentY,
      animationDistance: actor.animationDistance,
    };
  }

  private applyActorSnapshot(actor: ArcadeActor, saved: PlayerRuntimeSnapshot): void {
    actor.contact = saved.contact ? { ...saved.contact } : undefined;
    actor.x = saved.x;
    actor.y = saved.y;
    actor.homeX = saved.homeX;
    actor.homeY = saved.homeY;
    actor.vx = saved.vx;
    actor.vy = saved.vy;
    actor.facingX = saved.facingX;
    actor.facingY = saved.facingY;
    actor.stamina = saved.fitness;
    actor.active = saved.active;
    actor.card = saved.card;
    actor.action = saved.action;
    actor.actionStartedTick = saved.actionStartedTick ?? this.tick;
    actor.decisionCooldown = saved.decisionCooldown;
    actor.skillCooldown = saved.skillCooldown;
    actor.tackleCooldown = saved.tackleCooldown;
    actor.intentX = saved.intentX;
    actor.intentY = saved.intentY;
    actor.animationDistance = saved.animationDistance ?? 0;
  }

  private ballSnapshot(): BallSnapshot {
    const { x, y, z, vx, vy, vz, spin, ownerId, controlledTouch } = this.ball;
    return { x, y, z, vx, vy, vz, spin, ownerId, controlledTouch };
  }

  private newRule(phase: RuleState['phase'], restartSide: Side | null, spotX: number, spotY: number, indirect = false): RuleState {
    return { phase, restartSide, spotX, spotY, elapsed: 0, indirect, advantageSide: null, pendingCardPlayerId: null };
  }

  private setAction(actor: ArcadeActor, action: PlayerActionState): void {
    if (isLocomotionAction(action) && actionIsPlaying(actor.action, actor.actionStartedTick, this.tick)) return;
    if (actor.action === action) return;
    actor.action = action;
    actor.actionStartedTick = this.tick;
  }

  private maxSpeed(actor: ArcadeActor, sprint: boolean): number {
    const base = arcadeSprintSpeed(actor.player.attributes.pace);
    const fitness = actor.stamina < 40 ? 0.82 + actor.stamina * 0.0045 : 1;
    const ownsBall = this.ball.ownerId === actor.player.id;
    const ball = ownsBall ? sprint ? ARCADE_MATCH_TUNING.ballSprintRatio : ARCADE_MATCH_TUNING.ballJogRatio : 1;
    return base * fitness * ball * (sprint ? 1 : ARCADE_MATCH_TUNING.jogRatio);
  }

  private approach(current: number, target: number, amount: number): number {
    return current < target ? Math.min(target, current + amount) : Math.max(target, current - amount);
  }

  private owner(): ArcadeActor | undefined {
    return this.actors.find((actor) => actor.active && actor.player.id === this.ball.ownerId);
  }

  private teamOf(side: Side): Team {
    return side === 'home' ? this.home : this.away;
  }

  private stats(side: Side): TeamMatchStats {
    return side === 'home' ? this.homeStats : this.awayStats;
  }

  private opposite(side: Side): Side {
    return side === 'home' ? 'away' : 'home';
  }

  private sideAttackingDirection(direction: 1 | -1): Side {
    return this.attackDirection('home') === direction ? 'home' : 'away';
  }

  private closestOpponent(actor: ArcadeActor): number {
    return Math.min(...this.actors.filter((candidate) => candidate.active && candidate.side !== actor.side).map((candidate) => distance(actor, candidate)), 99);
  }

  private pushCommentary(messageKey: string, params: Record<string, string | number>): void {
    this.events.push({ minute: this.footballMinute, type: 'commentary', side: this.controlledSide, playerId: null, messageKey, params });
  }
}
