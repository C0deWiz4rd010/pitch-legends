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
import type { PenaltyShootout } from '../../models/match.model';
import { playerName, groupForPosition } from '../ratings';
import { tacticalIntent } from '../football/tactical-intent';
import { ReplayRing } from '../football/replay-ring';
import { clamp, Rng, round } from '../util';
import { createInjury, isPlayerAvailable } from '../injury-engine';
import { accelerateTowards, turnTowards } from '../football/movement';
import { actionIsPlaying, isLocomotionAction } from '../football/action-timing';
import { BALL_RADIUS, collideGoalFrame, integrateBall } from '../football/ball-physics';
import { ActiveShot, ArcadeActor, ArcadeBall, FIELD_LENGTH, FIELD_WIDTH, GOAL_HEIGHT, GOAL_WIDTH, MATCH_TICK, distance, oppositeSide } from '../football/match-types';
import { closestOpponentDistance, isOffsidePosition, passLanePressure } from '../football/pitch-analysis';
import { PlayerCollisionGrid } from '../football/collisions';
import { actorSnapshot, applyActorSnapshot, ballSnapshot, fnv1aHex, writeBallSnapshot, writePlayers } from '../football/match-snapshot';
import { keeperDiveTarget, keeperPositionIntent } from '../football/keeper-ai';
import { arrangeRestart, chooseRestartTaker } from '../football/set-pieces';
import { shotAngleQuality, shotXg } from '../football/xg';

export { FIELD_LENGTH, FIELD_WIDTH, GOAL_HEIGHT, GOAL_WIDTH, MATCH_TICK } from '../football/match-types';
export type { ArcadeActor, ArcadeBall } from '../football/match-types';

export const ARCADE_MATCH_TUNING = {
  sprintMin: 6,
  sprintMax: 9.4,
  jogRatio: 0.68,
  ballJogRatio: 0.95,
  ballSprintRatio: 0.91,
  acceleration: 18,
  braking: 30,
  maxCatchUpSteps: 8,
  aiFirstTouchAssist: 10,
  aiIntendedReceiverBonus: 8,
  /** Crowd-backed composure: slightly tighter passing/finishing, cleaner touches and tackles at home. */
  homeComposure: 0.12,
  intendedReceiverControlBias: 0.12,
} as const;

export function arcadeSprintSpeed(pace: number): number {
  const normalized = clamp((pace - 40) / 59, 0, 1);
  return ARCADE_MATCH_TUNING.sprintMin + normalized * (ARCADE_MATCH_TUNING.sprintMax - ARCADE_MATCH_TUNING.sprintMin);
}

export function arcadeJogSpeed(pace: number): number {
  return arcadeSprintSpeed(pace) * ARCADE_MATCH_TUNING.jogRatio;
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
    topspin: 0,
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
  private shootout: PenaltyShootout | null = null;
  /** Temporary error multiplier while a penalty is being struck. */
  private penaltyNerves = 1;
  private safeSnapshot!: MatchSnapshot;
  private readonly replayBuffer = new ReplayRing();
  private frozenReplay: MatchSnapshot[] = [];
  private lastSubAt = -100;
  private readonly collisions = new PlayerCollisionGrid();

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
    const half = this.totalSeconds / 2;
    const extra = this.football.extra;
    if (extra) return Math.min(120, 90 + (extra.period - 1) * 15 + Math.floor(((this.elapsed - extra.periodStart) / this.totalSeconds) * 90));
    if (!this.halftimeReached) return Math.min(45, Math.floor((this.elapsed / this.totalSeconds) * 90));
    const overrun = this.football.stoppage?.overrun ?? 0;
    return Math.min(90, 45 + Math.floor(((this.elapsed - half - overrun) / this.totalSeconds) * 90));
  }

  /** Whole added minutes announced for the current half (shown as +N once regular time is up). */
  get announcedStoppage(): number {
    const added = this.football.stoppage?.added ?? [0, 0];
    return Math.min(5, Math.max(1, Math.round(added[this.halftimeReached ? 1 : 0])));
  }

  /** Minutes played beyond 45/90 in the current half; 0 during regular time. */
  get stoppageMinute(): number {
    if (this.football.extra) return 0;
    const half = this.totalSeconds / 2;
    const regularEnd = this.halftimeReached ? this.totalSeconds + (this.football.stoppage?.overrun ?? 0) : half;
    return this.elapsed <= regularEnd ? 0 : Math.floor((this.elapsed - regularEnd) / this.totalSeconds * 90) + 1;
  }

  /** Stoppages add time: goals, substitutions, injuries and cards. */
  private addStoppage(footballMinutes: number): void {
    const stoppage = (this.football.stoppage ??= { added: [0, 0], overrun: 0 });
    stoppage.added[this.halftimeReached ? 1 : 0] += footballMinutes;
  }

  /** Regular time plus announced stoppage time is over; the whistle waits for a calm moment (max. 8 s). */
  private periodOver(regularEndSeconds: number): boolean {
    const extra = this.announcedStoppage * this.totalSeconds / 90;
    if (this.elapsed < regularEndSeconds + extra) return false;
    const calm = !this.activeShot && Math.abs(this.ball.x - FIELD_LENGTH / 2) < 22;
    return calm || this.elapsed >= regularEndSeconds + extra + 8;
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
    // Extra time restarts with the first-half ends and changes again after 15 minutes.
    const swapped = this.football.extra ? this.football.extra.period === 2 : this.halftimeReached;
    return (swapped ? -initial : initial) as 1 | -1;
  }

  get inExtraTime(): boolean {
    return !!this.football.extra;
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
      // Rushing out is only possible for a ball close to the own goal, never across the pitch.
      const keeperRush = input.keeperRush && actor.side === this.controlledSide && actor.player.positionGroup === 'GK' && ownerBeforeMovement?.side !== actor.side
        && Math.abs(this.ball.x - (this.attackDirection(actor.side) > 0 ? 0 : FIELD_LENGTH)) < 22;
      if (actor.action === 'injured' && actionIsPlaying('injured', actor.actionStartedTick, this.tick)) {
        this.moveActor(actor, 0, 0, false, safeDt);
      } else if (keeperRush || supportPresser?.player.id === actor.player.id) {
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

    const extra = this.football.extra;
    if (!this.halftimeReached && this.periodOver(this.totalSeconds / 2)) this.enterHalftime();
    else if (this.halftimeReached && !extra && !this.finished && this.periodOver(this.totalSeconds + (this.football.stoppage?.overrun ?? 0))) {
      if (this.config.knockout && this.homeScore === this.awayScore) this.startExtraTime();
      else this.finish();
    } else if (extra && !this.finished && this.extraPeriodOver(extra.periodStart)) {
      if (extra.period === 1) this.changeEndsInExtraTime();
      else {
        if (this.homeScore === this.awayScore) this.resolveShootout();
        this.finish();
      }
    }
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
    if (this.football.extra) {
      // The short break before extra time: new ends, kick-off to the home side.
      this.football.extra.periodStart = this.elapsed;
      this.phase = 'secondHalf';
      this.paused = false;
      this.rebaseFormation();
      this.resetKickoff('home');
      return;
    }
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
    return this.benchFor(this.controlledSide);
  }

  makeSub(outId: string, inId: string): boolean {
    return this.substitute(this.controlledSide, outId, inId);
  }

  /** Players available to come on for either side. */
  benchFor(side: Side): Player[] {
    const onPitch = new Set(this.actors.filter((actor) => actor.side === side && actor.active).map((actor) => actor.player.id));
    return this.teamOf(side).players.filter((player) => !onPitch.has(player.id) && !this.football.subbedOutIds?.includes(player.id) && isPlayerAvailable(player));
  }

  isInjured(playerId: string): boolean {
    return !!this.football.injuredIds?.includes(playerId);
  }

  private substitute(side: Side, outId: string, inId: string): boolean {
    const managed = side === this.controlledSide;
    const budget = managed ? { used: this.subsUsed, windows: this.substitutionWindows, lastAt: this.lastSubAt }
      : (this.football.opponentSubs ??= { used: 0, windows: 0, lastAt: -100 });
    if (budget.used >= 5) return false;
    const actor = this.actors.find((candidate) => candidate.player.id === outId && candidate.side === side && candidate.active);
    const team = this.teamOf(side);
    const incoming = team.players.find((player) => player.id === inId);
    if (!actor || !incoming || this.benchFor(side).every((player) => player.id !== inId)) return false;
    const isHalftime = this.phase === 'halftime';
    if (!isHalftime && this.elapsed - budget.lastAt > 3) {
      if (budget.windows >= 3) return false;
      budget.windows++;
    }
    (this.football.subbedOutIds ??= []).push(outId);
    if (this.football.injuredIds) this.football.injuredIds = this.football.injuredIds.filter(id => id !== outId);
    const slot = team.formation.slots.find(slot => slot.playerId === outId);
    if (slot) slot.playerId = inId;
    if (managed && this.config.playerLockId === outId) this.config.playerLockId = inId;
    budget.lastAt = this.elapsed;
    budget.used++;
    if (managed) { this.subsUsed = budget.used; this.substitutionWindows = budget.windows; this.lastSubAt = budget.lastAt; }
    if (!isHalftime) this.addStoppage(0.5);
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
      side,
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

  /** Pass a frame that is no longer displayed to reuse its objects. */
  renderState(reuse?: MatchRenderState): MatchRenderState {
    let activeSignature = '';
    for (const actor of this.actors) if (actor.active) activeSignature += actor.player.id + ',';
    const discontinuityKey = `${this.half}|${this.phase}|${this.rule.phase}|${this.homeScore}:${this.awayScore}|${activeSignature}`;
    if (reuse) {
      reuse.tick = this.tick;
      reuse.controlledPlayerId = this.selectedPlayerId;
      reuse.attackDirection = this.currentAttackDirection;
      reuse.discontinuityKey = discontinuityKey;
      writeBallSnapshot(this.ball, reuse.ball);
      writePlayers(this.actors, reuse.players);
      return reuse;
    }
    return {
      tick: this.tick,
      controlledPlayerId: this.selectedPlayerId,
      attackDirection: this.currentAttackDirection,
      discontinuityKey,
      ball: this.ballSnapshot(),
      players: this.actors.map((actor) => this.actorSnapshot(actor)),
    };
  }

  private snapshotInto(reuse: MatchSnapshot | undefined): MatchSnapshot {
    if (!reuse) return this.snapshot();
    reuse.tick = this.tick;
    reuse.phase = this.phase;
    reuse.footballMinute = this.footballMinute;
    reuse.elapsed = this.elapsed;
    reuse.homeScore = this.homeScore;
    reuse.awayScore = this.awayScore;
    reuse.controlledPlayerId = this.selectedPlayerId;
    reuse.attackDirection = this.currentAttackDirection;
    reuse.rule = Object.assign(reuse.rule, this.rule);
    writeBallSnapshot(this.ball, reuse.ball);
    writePlayers(this.actors, reuse.players);
    return reuse;
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
    this.config.autoSwitch = checkpoint.config.autoSwitch;
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
    return fnv1aHex(json);
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
    const selected=this.actors.find(actor=>actor.player.id===this.selectedPlayerId&&actor.active);
    const policy=this.config.autoSwitch ?? 'receivers';
    const canAutoSwitch=this.tick>=this.football.selectionUntilTick && policy!=='manual';
    let candidate:ArcadeActor|undefined;
    if(!selected) this.selectedPlayerId=this.bestControlledActor().player.id;
    if(canAutoSwitch && owner?.side===this.controlledSide && owner.player.positionGroup!=='GK') candidate=owner;
    if(canAutoSwitch && !owner && policy==='assisted' && selected) {
      const best=this.bestControlledActor();
      if(distance(best,this.ball)<5 && distance(selected,this.ball)>distance(best,this.ball)+3.5) candidate=best;
    }
    if(candidate && candidate.player.id!==this.selectedPlayerId) {
      if(this.football.switchCandidate?.id!==candidate.player.id) this.football.switchCandidate={id:candidate.player.id,sinceTick:this.tick};
      if(this.tick-this.football.switchCandidate.sinceTick>=12) {
        this.selectedPlayerId=candidate.player.id;
        this.football.selectionUntilTick=this.tick+45;
        this.football.switchCandidate=null;
      }
    } else this.football.switchCandidate=null;
    if (input.switchPlayer && !this.previousInput.switchPlayer) {
      this.football.selectionUntilTick = this.tick + 90;
      this.football.switchCandidate=null;
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
    const carrier = this.owner();
    if (input.jockey && carrier && carrier.side !== actor.side) {
      // Contain: hold a goal-side position 1.9 m from the carrier, face the ball and give ground under control.
      const goalX = this.attackDirection(actor.side) > 0 ? 0 : FIELD_LENGTH;
      const gx = goalX - carrier.x, gy = FIELD_WIDTH / 2 - carrier.y, gl = Math.hypot(gx, gy) || 1;
      const holdX = carrier.x + gx / gl * 1.9, holdY = carrier.y + gy / gl * 1.9;
      const { facingX, facingY } = actor;
      this.moveActor(actor, worldX * 0.6 + (holdX - actor.x) * 0.9, input.moveY * 0.6 + (holdY - actor.y) * 0.9, false, dt, 0.78);
      // Side-steps and backward steps keep the body facing the ball.
      const facing = turnTowards(facingX, facingY, carrier.x - actor.x, carrier.y - actor.y, 12 * dt);
      actor.facingX = facing.x; actor.facingY = facing.y;
      this.setAction(actor, 'jockey');
      return;
    }
    this.moveActor(actor, worldX, input.moveY, input.sprint, dt);
    const moving = Math.hypot(worldX, input.moveY) > 0.1;
    this.setAction(actor, !moving ? 'idle' : input.sprint ? 'sprint' : this.ball.ownerId === actor.player.id ? 'carry' : 'jog');
    if (input.skill && !this.previousInput.skill) this.performSkill(actor, worldX, input.moveY);
  }

  private moveActor(actor: ArcadeActor, dx: number, dy: number, sprint: boolean, dt: number, speedScale = 1): void {
    const previousX = actor.x;
    const previousY = actor.y;
    const magnitude = Math.hypot(dx, dy);
    const nx = magnitude > 0.001 ? dx / magnitude : 0;
    const ny = magnitude > 0.001 ? dy / magnitude : 0;
    const ownsBall = this.ball.ownerId === actor.player.id;
    const targetSpeed = magnitude > 0.05 ? this.maxSpeed(actor, sprint) * Math.min(1, magnitude) * speedScale : 0;
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
      // Momentum: the faster a player runs, the wider the turn.
      const speedRatio = clamp(Math.hypot(actor.vx, actor.vy) / ARCADE_MATCH_TUNING.sprintMax, 0, 1);
      const turnRate = (11 + actor.player.attributes.dribbling / 24) * (1 - speedRatio * 0.4) * dt / (sprint ? 1.18 : 1);
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
    if(actor.player.positionGroup==='GK') {
      const dive=keeperDiveTarget(actor,this.ball,this.activeShot);
      if(dive) {
        this.setAction(actor,'keeper-dive');
        actor.actionTarget=dive;
      }
    }
    if(actor.player.positionGroup==='GK' && (actor.action==='keeper-dive'||actor.action==='keeper-catch'||actor.action==='keeper-parry') && actionIsPlaying(actor.action,actor.actionStartedTick,this.tick)) {
      const age=(this.tick-actor.actionStartedTick)/60;
      if(actor.action==='keeper-dive' && actor.actionTarget && age<.34) {
        // The dive really covers ground: a fast lateral push towards the target, faster for better keepers.
        const diveSpeed=5.2+actor.player.attributes.goalkeeping/38;
        const dy=actor.actionTarget.y-actor.y;
        const step=clamp(dy,-diveSpeed*dt,diveSpeed*dt);
        actor.y=clamp(actor.y+step,.8,FIELD_WIDTH-.8);
        actor.vy=step/dt; actor.vx=0;
        actor.animationDistance+=Math.abs(step);
      } else this.moveActor(actor,0,0,false,dt);
      return;
    }
    actor.decisionCooldown -= dt;
    if (actor.decisionCooldown <= 0) {
      this.chooseAiIntent(actor);
      const level = this.aiLevel(actor.side);
      const base = level === 'easy' ? 0.3 : level === 'hard' ? 0.11 : 0.18;
      const spread = level === 'easy' ? 0.2 : level === 'hard' ? 0.09 : 0.12;
      const tempo = this.teamOf(actor.side).tactics.tempo;
      const tempoFactor = tempo === 'fast' ? 0.78 : tempo === 'slow' ? 1.3 : 1;
      // Manager perk "Tactics": the managed side reads situations 4 % faster per rank.
      const perk = actor.side === this.controlledSide ? 1 - clamp(this.managerTacticsRank, 0, 5) * 0.04 : 1;
      actor.decisionCooldown = (base + this.rng.float(0, spread)) * tempoFactor * perk;
    }
    const dx = actor.intentX - actor.x;
    const dy = actor.intentY - actor.y;
    const sprint = distance(actor, { x: actor.intentX, y: actor.intentY }) > 14 && actor.stamina > 25;
    this.moveActor(actor, dx, dy, sprint, dt);
    if(actor.player.positionGroup==='GK' && actor.action==='keeper-ready') {
      const facing=turnTowards(actor.facingX,actor.facingY,this.ball.x-actor.x,this.ball.y-actor.y,10*dt);
      actor.facingX=facing.x;actor.facingY=facing.y;
    }
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
      const shotValue = goalDistance < 39 && shootingLane ? this.shotValue(actor) : 0;
      const level = this.aiLevel(actor.side);
      const shotThreshold = level === 'easy' ? .16 : level === 'hard' ? .12 : .14;
      const captain = team.tactics.captainId === actor.player.id;
      const patience = team.tactics.tempo === 'slow' ? .16 : team.tactics.tempo === 'fast' ? .40 : .26;
      if (actor.player.positionGroup === 'GK') {
        const long = team.tactics.buildUp === 'long-ball' || pressureDistance < 6;
        this.pass(actor, false, long, long ? .85 : .40, direction, this.rng.float(-.4,.4));
        this.setAction(actor, long ? 'keeper-kick' : 'keeper-throw');
        if(!long && actor.contact) { actor.contact.kind='hand';this.ball.vz=1.8; }
      } else if (goalDistance < 39 && shootingLane && shotValue >= shotThreshold && !this.betterPlacedTeammate(actor, shotValue)) {
        const keeper = this.actors.find(other=>other.active && other.side!==actor.side && other.player.positionGroup==='GK');
        const farCorner = keeper && keeper.y > 34 ? -.78 : .78;
        const level = this.aiLevel(actor.side);
        const accuracy = level === 'easy' ? .45 : level === 'hard' ? .10 : .25;
        this.shoot(actor, this.rng.float(.50,.93), direction, clamp(farCorner+this.rng.float(-accuracy,accuracy),-1,1), goalDistance > 18 && actor.player.attributes.shooting > 72, goalDistance < 14);
      } else if (this.tryAiSkill(actor, pressureDistance)) {
        // Took the defender on.
      } else if (pressured || this.rng.bool(patience+(captain?.03:0)) || (shotValue >= shotThreshold && goalDistance < 39)) {
        const cross = goalDistance < 26 && Math.abs(actor.y-34) > 16;
        if (cross && this.cross(actor, this.rng.bool(.3), .7)) return;
        const through = team.tactics.counterAttack && this.rng.bool(.25);
        const long = cross || team.tactics.buildUp === 'long-ball' && this.rng.bool(.3);
        this.pass(actor, through, long, long?.76:team.tactics.passing==='short'?.38:.60, direction, cross ? (34-actor.y)/25 : this.rng.float(-.4,.4));
      }
      return;
    }

    if (actor.player.positionGroup === 'GK') {
      const intent = keeperPositionIntent(actor, this.ball, !!owner, direction);
      this.setAction(actor, intent.action);
      actor.intentX = intent.x;
      actor.intentY = intent.y;
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
    const carrier = this.owner();
    const defending = !!carrier && carrier.side !== actor.side;
    for (const kind of ['pass', 'through', 'lob', 'shoot'] as const) {
      if (defending) {
        // Tackles fire on the press itself: no release delay against a dribbler.
        if (input[kind] && !this.previousInput[kind]) this.attemptTackle(actor, kind === 'shoot' || kind === 'lob');
        this.actionHeld[kind] = 0;
        continue;
      }
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
      } else this.football.queuedAction = action;
      this.actionHeld[kind] = 0;
    }
    if (this.football.queuedAction && this.football.queuedAction.expiresTick < this.tick) this.football.queuedAction = null;
    if (this.football.queuedAction && this.ball.ownerId === actor.player.id) {
      this.executeFootballAction(actor, this.football.queuedAction);
      this.football.queuedAction = null;
    }
  }

  private executeFootballAction(actor: ArcadeActor, action: NonNullable<NonNullable<MatchCheckpoint['runtime']['football']>['queuedAction']>): void {
    if (action.kind === 'shoot') {
      // Lob + skill on release is a driven power shot; either alone is a chip or a finesse shot.
      const powerShot = !!action.chip && action.finesse;
      this.shoot(actor, action.power, action.aimX, action.aimY, action.finesse && !powerShot, action.low && !powerShot, !!action.chip && !powerShot, powerShot);
      return;
    }
    if ((action.kind === 'lob' || action.kind === 'through') && this.inCrossingZone(actor) && this.cross(actor, action.kind === 'through', action.power)) return;
    const lofted = action.kind === 'through' && !!action.chip;
    this.pass(actor, action.kind === 'through', action.kind === 'lob' || lofted, action.power, action.aimX, action.aimY);
  }

  private inCrossingZone(actor: ArcadeActor): boolean {
    const goalDistance = this.attackDirection(actor.side) > 0 ? FIELD_LENGTH - actor.x : actor.x;
    return goalDistance < 34 && Math.abs(actor.y - FIELD_WIDTH / 2) > 13;
  }

  /** Delivery to the best-placed runner in the box, timed to arrive at head height (high) or at the feet (driven). */
  private cross(actor: ArcadeActor, driven: boolean, power: number): boolean {
    if (this.ball.ownerId !== actor.player.id) return false;
    const direction = this.attackDirection(actor.side);
    const goalX = direction > 0 ? FIELD_LENGTH : 0;
    const teammates = this.actors.filter(candidate => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id);
    const runner = teammates
      .filter(candidate => candidate.player.positionGroup !== 'GK' && Math.abs(goalX - candidate.x) < 18 && Math.abs(candidate.y - FIELD_WIDTH / 2) < 17)
      .map(candidate => ({ candidate, score: this.passLanePressure(actor, candidate) * 1.4 + Math.abs(candidate.y - FIELD_WIDTH / 2) * 0.05
        + Math.abs(goalX - candidate.x) * 0.04 - Math.max(0, candidate.vx * direction) * 0.08 + (this.isOffside(candidate, actor) ? 5 : 0) }))
      .sort((a, b) => a.score - b.score)[0]?.candidate;
    if (!runner) return false;
    const rough = distance(actor, runner);
    const speed = driven ? clamp(14 + rough * 0.35 + power * 4, 16, 26) : clamp(12 + rough * 0.3 + power * 5, 14, 24);
    const flight = rough / speed;
    const targetX = clamp(runner.x + runner.vx * flight * 0.8, 1, FIELD_LENGTH - 1);
    const targetY = clamp(runner.y + runner.vy * flight * 0.8, 1, FIELD_WIDTH - 1);
    const dx = targetX - actor.x, dy = targetY - actor.y, length = Math.hypot(dx, dy) || 1;
    const pressure = clamp((5 - this.closestOpponent(actor)) / 5, 0, 1);
    const error = this.rng.normal(0, (100 - actor.player.attributes.passing) / 100 * 0.07 + pressure * 0.04);
    const cos = Math.cos(error), sin = Math.sin(error);
    const px = dx / length * cos - dy / length * sin, py = dx / length * sin + dy / length * cos;
    const time = length / speed;
    // High crosses arrive at about 1.8 m (header height); driven crosses skim the grass.
    const vz = driven ? 0.6 : clamp((1.7 + 4.905 * time * time) / time, 3, 11);
    this.registerPass(actor, runner, teammates);
    this.releaseBall(actor, px * speed, py * speed, vz, 0);
    this.setAction(actor, driven ? 'pass' : 'lob');
    return true;
  }

  /** Bookkeeping shared by passes and crosses: stats, offside snapshot at the moment of release, receiver. */
  private registerPass(actor: ArcadeActor, target: ArcadeActor | undefined, teammates: readonly ArcadeActor[]): void {
    this.passAttempts[actor.side]++;
    this.stats(actor.side).passesAttempted++;
    this.lastPasser = { id: actor.player.id, side: actor.side, at: this.elapsed };
    this.football.offsideCandidates = teammates.filter(candidate => this.isOffside(candidate, actor)).map(candidate => candidate.player.id);
    this.pendingOffsideTargetId = target && this.isOffside(target, actor) ? target.player.id : null;
    this.intendedReceiverId = target?.player.id ?? null;
    this.activeShot = null;
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
    // A through ball is played into the space ahead of the runner, further with more power.
    const lead = through ? clamp(4 + power * 9, 4, 13) : 0;
    const targetX = target ? clamp(target.x + target.vx * travelEstimate * 0.65 + this.attackDirection(actor.side) * lead, 1, FIELD_LENGTH - 1) : manualTarget.x;
    const targetY = target ? clamp(target.y + target.vy * travelEstimate * 0.65, 1, FIELD_WIDTH - 1) : manualTarget.y;
    const dx = targetX - actor.x;
    const dy = targetY - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const pressure = clamp((5 - this.closestOpponent(actor)) / 5, 0, 1);
    // Lateral side relative to the passer's facing, so the weak foot survives the change of ends.
    const lateral = actor.facingX * dy - actor.facingY * dx;
    const weakFoot = actor.player.foot !== 'Both' && ((actor.player.foot === 'Right' && lateral < -1) || (actor.player.foot === 'Left' && lateral > 1)) ? 1 : 0;
    const fatigue = actor.stamina < 30 ? (30 - actor.stamina) / 30 : 0;
    const manualFactor = humanPass
      ? this.config.assist === 'manual' ? 1.2 : this.config.assist === 'assisted' ? 0.55 : 0.82
      : this.aiLevel(actor.side) === 'easy' ? 0.54 : this.aiLevel(actor.side) === 'hard' ? 0.24 : 0.30;
    const error = (100 - actor.player.attributes.passing) / 100 * 0.075 + pressure * 0.045 + weakFoot * 0.018 + fatigue * 0.04;
    const angleError = this.rng.gaussian(0, error * manualFactor * this.composure(actor.side));
    const cos = Math.cos(angleError);
    const sin = Math.sin(angleError);
    const px = dx / length * cos - dy / length * sin;
    const py = dx / length * sin + dy / length * cos;
    const lofted = lob && through;
    const speed = target && !lob
      ? clamp(8 + length * 0.48 + power * 4.5 + (through ? 2.8 : 0), 12, 25)
      : (lofted ? 16 : lob ? 14 : through ? 14.5 : 11.8) + power * (lob ? 12 : 13.5) + actor.player.attributes.passing * 0.025;
    this.registerPass(actor, target, teammates);
    const vz = lofted ? clamp(length / speed * 4.905 * 0.8 + 0.3, 2.5, 6) : lob ? clamp(length / speed * 4.905 + 0.5, 3, 9) : 0.15;
    this.releaseBall(actor, px * speed, py * speed, vz, lob ? this.rng.float(-2, 2) : 0, lob ? -2 : 0);
    this.setAction(actor, lob && !through ? 'lob' : through ? 'through-pass' : 'pass');
  }

  private shoot(actor: ArcadeActor, power: number, aimX: number, aimY: number, finesse: boolean, low: boolean, chip = false, driven = false): void {
    if (this.ball.ownerId !== actor.player.id) return;
    const direction = this.attackDirection(actor.side);
    const goalX = direction > 0 ? FIELD_LENGTH + 0.3 : -0.3;
    const goalCentre = FIELD_WIDTH / 2;
    const inputZone = clamp(aimY, -1, 1) * (GOAL_WIDTH * 0.43);
    const distanceToGoal = Math.hypot(goalX - actor.x, goalCentre - actor.y);
    const angleQuality = shotAngleQuality(actor.y - goalCentre);
    const pressure = clamp((5 - this.closestOpponent(actor)) / 5, 0, 1);
    const balance = clamp(1 - Math.hypot(actor.vx, actor.vy) / 18, 0.35, 1);
    const shotLateral = direction * (goalCentre - actor.y);
    const weakFoot = actor.player.foot === 'Both' ? 0 : actor.player.foot === 'Right' === (shotLateral < 0) ? 0.07 : 0;
    const fatigue = actor.stamina < 30 ? (30 - actor.stamina) / 120 : 0;
    // Striking a bouncing or dropping ball (volley) and hitting it with full force are both harder to place.
    const volley = this.ball.z > 0.35;
    const techniqueFactor = (driven ? 1.3 : 1) * (volley ? 1.2 : 1);
    const baseError = ((100 - actor.player.attributes.shooting) / 100 * 2.15 + pressure * 1.35 + (1 - balance) * 0.9 + weakFoot + fatigue + Math.max(0, distanceToGoal - 20) * 0.15) * techniqueFactor;
    const assistFactor = this.config.assist === 'assisted' ? 0.72 : this.config.assist === 'manual' ? 1.18 : 0.92;
    const manual = this.isHumanControlled(actor) && this.config.assist === 'manual';
    const manualX = Math.abs(aimX) > 0.04 ? aimX : direction * 0.04;
    const aimedY = manual ? actor.y + aimY / manualX * (goalX - actor.x) : goalCentre + inputZone;
    // Shot dispersion uses a real standard deviation; the general generator's
    // bounded averaging helper otherwise put virtually every attempt on target.
    const targetY = aimedY + this.rng.normal(0, this.composure(actor.side) * this.penaltyNerves) * (baseError + Math.max(0,distanceToGoal-12)*0.025) * assistFactor * 1.9;
    // Finesse: the kicking foot decides the curl; the ball starts outside the target and bends back in.
    const curl = finesse ? this.curlSign(actor, targetY) : 0;
    const curlDeflection = finesse ? 0.024 * 5 * (goalX - actor.x) ** 2 / Math.max(20, 19 + power * 14) * 0.85 : 0;
    const launchY = targetY - curl * direction * curlDeflection;
    const dx = goalX - actor.x;
    const dy = launchY - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const speed = 19 + power * 14 + actor.player.attributes.shooting * 0.035 + (driven ? 6 : 0) + (volley ? 2 : 0);
    const xG = shotXg(distanceToGoal, actor.y - goalCentre, actor.player.attributes.shooting, pressure);
    const stats = this.stats(actor.side);
    stats.shots++;
    stats.xG = round(stats.xG + xG, 2);
    const flightTime = length / speed;
    const baseVz = chip ? clamp(flightTime * 4.905 + 1.6, 4, 8) : low ? 0.7 : driven ? clamp(flightTime * 4.905 * 0.6 + 0.3, 0.8, 4) : finesse ? clamp(flightTime * 4.905 + 0.8, 1.8, 6.5) : clamp(flightTime * 4.905 + (power - 0.5), 1.2, 7);
    // Height error at the goal line: power and poor technique lift shots over the bar.
    const heightSpread = chip ? 0 : low ? 0.2 : (0.55 + power * 0.75 + (100 - actor.player.attributes.shooting) / 100 * 0.9 + pressure * 0.4) * techniqueFactor * (finesse ? 0.8 : 1);
    const heightError = heightSpread ? this.rng.normal(power * 0.35, heightSpread) : 0;
    const vz = baseVz + heightError / Math.max(0.2, flightTime);
    const heightAtGoal = this.ball.z + vz * flightTime - 4.905 * flightTime * flightTime;
    if (Math.abs(targetY - goalCentre) <= GOAL_WIDTH / 2 && heightAtGoal <= GOAL_HEIGHT) stats.shotsOnTarget++;
    this.activeShot = { shooterId: actor.player.id, side: actor.side, xG, targetY, checkedKeeper: false };
    this.intendedReceiverId = null;
    // Driven and hard shots carry topspin (they dip); chips carry backspin (they float and check up).
    const topspin = chip ? -3 : driven ? 4 : power > 0.7 && !finesse ? 1.5 : 0;
    this.releaseBall(actor, dx / length * speed, dy / length * speed, vz, curl * 5, topspin);
    this.setAction(actor, chip ? 'chip-shot' : finesse ? 'finesse-shot' : low ? 'low-shot' : 'shot');
    this.events.push({ minute: this.footballMinute, type: 'shot', side: actor.side, playerId: actor.player.id, params: { player: playerName(actor.player), xG, distance: round(distanceToGoal,1) } });
  }

  /**
   * Direction relative to the carrier picks the move: none = body feint, sideways = ball roll,
   * back = drag back, forward = knock-on. Timing decides the outcome, not a dice roll: too close
   * (under 1.05 m) loses the ball, 1.05-3.6 m wrong-foots nearby defenders, further away is a free move.
   */
  performSkill(actor: ArcadeActor, dx: number, dy: number): void {
    if (actor.skillCooldown > 0 || this.ball.ownerId !== actor.player.id) return;
    actor.skillCooldown = 0.75;
    const opponentGap = this.closestOpponent(actor);
    if (opponentGap < 1.05) {
      this.releaseBall(actor, actor.facingX * 4 + this.rng.float(-2, 2), actor.facingY * 4 + this.rng.float(-2, 2), 0.5, 0);
      this.setAction(actor, 'skill-failed');
      return;
    }
    const magnitude = Math.hypot(dx, dy);
    const forward = magnitude > 0.25 ? (dx * actor.facingX + dy * actor.facingY) / magnitude : 0;
    const side = magnitude > 0.25 ? (actor.facingX * dy - actor.facingY * dx) / magnitude : 0;
    const move: PlayerActionState = magnitude <= 0.25 ? 'body-feint' : Math.abs(side) > 0.6 ? 'ball-roll' : forward < -0.5 ? 'drag-back' : 'knock-on';
    // A skill changes momentum; displacement still goes through the fixed-step integrator.
    if (move === 'ball-roll' || move === 'drag-back') {
      const lateral = move === 'ball-roll';
      const skillX = lateral ? -actor.facingY * Math.sign(side || 1) : -actor.facingX;
      const skillY = lateral ? actor.facingX * Math.sign(side || 1) : -actor.facingY;
      actor.vx = actor.vx * 0.45 + skillX * 2.7;
      actor.vy = actor.vy * 0.45 + skillY * 2.7;
      this.ball.vx = actor.vx + skillX * 1.3;
      this.ball.vy = actor.vy + skillY * 1.3;
    } else if (move === 'knock-on') {
      const burst = 5.5 + actor.player.attributes.pace / 40;
      this.ball.vx = actor.vx + actor.facingX * burst;
      this.ball.vy = actor.vy + actor.facingY * burst;
    } else {
      actor.vx *= 0.6; actor.vy *= 0.6;
    }
    this.ball.controlledTouch = 0;
    this.setAction(actor, move);
    if (opponentGap > 3.6) return;
    const quality = actor.player.attributes.dribbling / 100 * (actor.stamina > 20 ? 1 : 0.7);
    for (const opponent of this.actors) {
      if (!opponent.active || opponent.side === actor.side || opponent.player.positionGroup === 'GK' || distance(opponent, actor) > 3.6) continue;
      opponent.tackleCooldown = Math.max(opponent.tackleCooldown, 0.2 + quality * 0.35);
      opponent.vx *= 0.5; opponent.vy *= 0.5;
      if (!this.isHumanControlled(opponent)) opponent.decisionCooldown += 0.15 + quality * 0.25;
    }
  }

  /** Expected value of shooting now: chance quality, blocked lanes and a keeper caught off the line. */
  private shotValue(actor: ArcadeActor): number {
    const direction = this.attackDirection(actor.side);
    const goalX = direction > 0 ? FIELD_LENGTH : 0;
    const goalDistance = Math.abs(goalX - actor.x);
    const pressure = clamp((5 - this.closestOpponent(actor)) / 5, 0, 1);
    const xG = shotXg(goalDistance, actor.y - FIELD_WIDTH / 2, actor.player.attributes.shooting, pressure);
    const goal = { x: goalX, y: FIELD_WIDTH / 2 };
    let blockers = 0;
    for (const other of this.actors) {
      if (!other.active || other.side === actor.side || other.player.positionGroup === 'GK') continue;
      const dx = goal.x - actor.x, dy = goal.y - actor.y, length2 = dx * dx + dy * dy || 1;
      const t = ((other.x - actor.x) * dx + (other.y - actor.y) * dy) / length2;
      if (t <= 0 || t >= 1) continue;
      if (Math.hypot(other.x - (actor.x + dx * t), other.y - (actor.y + dy * t)) < 1.3) blockers++;
    }
    const keeper = this.actors.find(other => other.active && other.side !== actor.side && other.player.positionGroup === 'GK');
    const offLine = keeper ? clamp(Math.abs(keeper.y - (FIELD_WIDTH / 2 + (actor.y - FIELD_WIDTH / 2) * 0.12)) / 3, 0, 1) : 1;
    return xG * Math.pow(0.4, blockers) * (1 + offLine * 0.35);
  }

  /** A clearly better chance for a free team-mate turns a speculative shot into a cut-back. */
  private betterPlacedTeammate(actor: ArcadeActor, ownValue: number): boolean {
    for (const mate of this.actors) {
      if (!mate.active || mate.side !== actor.side || mate === actor || mate.player.positionGroup === 'GK') continue;
      if (distance(mate, actor) > 22 || this.passLanePressure(actor, mate) > 0 || this.isOffside(mate, actor)) continue;
      if (this.shotValue(mate) > ownValue + 0.08) return true;
    }
    return false;
  }

  /** Good dribblers take a defender on when one closes down from the front. */
  private tryAiSkill(actor: ArcadeActor, pressureDistance: number): boolean {
    if (actor.skillCooldown > 0 || actor.player.attributes.dribbling < 68 || pressureDistance < 1.2 || pressureDistance > 3.4) return false;
    const opponent = this.actors.filter(other => other.active && other.side !== actor.side && other.player.positionGroup !== 'GK')
      .sort((a, b) => distance(a, actor) - distance(b, actor))[0];
    if (!opponent || (opponent.x - actor.x) * actor.facingX + (opponent.y - actor.y) * actor.facingY <= 0) return false;
    const level = this.aiLevel(actor.side);
    if (!this.rng.bool(level === 'hard' ? .28 : level === 'easy' ? .08 : .16)) return false;
    const away = (actor.facingX * (opponent.y - actor.y) - actor.facingY * (opponent.x - actor.x)) > 0 ? -1 : 1;
    this.performSkill(actor, -actor.facingY * away, actor.facingX * away);
    return true;
  }

  /** +1 curls to the left of the travel direction (right foot), -1 to the right (left foot). */
  private curlSign(actor: ArcadeActor, targetY: number): number {
    if (actor.player.foot === 'Right') return 1;
    if (actor.player.foot === 'Left') return -1;
    // Two-footed players bend the ball back towards the goal centre.
    return Math.sign((targetY - actor.y) * this.attackDirection(actor.side)) || 1;
  }

  private releaseBall(actor: ArcadeActor, vx: number, vy: number, vz: number, spin: number, topspin = 0): void {
    this.ball.ownerId = null;
    actor.contact = { tick: this.tick, x: this.ball.x, y: this.ball.y, z: this.ball.z, kind: 'foot', foot: actor.player.foot === 'Left' ? 'left' : 'right' };
    // The ball leaves its actual contact point, preserving visual continuity.
    this.ball.z = Math.max(BALL_RADIUS, this.ball.z);
    this.ball.vx = vx;
    this.ball.vy = vy;
    this.ball.vz = vz;
    this.ball.spin = spin;
    this.ball.topspin = topspin;
    this.ball.lastTouch = actor.side;
    this.ball.lastTouchPlayerId = actor.player.id;
    this.ball.controlledTouch = 0;
  }

  private resolvePressureTackles(dt: number): void {
    const owner = this.owner();
    if (!owner) return;
    for (const defender of this.actors) {
      if (!defender.active || defender.side === owner.side || defender.player.positionGroup === 'GK' || defender.tackleCooldown > 0) continue;
      // The human-controlled defender only tackles on input.
      if (this.isHumanControlled(defender)) continue;
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
    // A carrier who is not sprinting, with the defender behind, shields the ball.
    const behind = (-relativeX * owner.facingX - relativeY * owner.facingY) / Math.max(0.1, Math.hypot(relativeX, relativeY)) < -0.2;
    const shielding = behind && Math.hypot(owner.vx, owner.vy) < this.maxSpeed(owner, false) * 0.95 ? 0.12 * owner.player.attributes.physical / 80 : 0;
    const jockeyBonus = (actor.action === 'jockey' ? 0.06 : 0) + (actor.side === 'home' ? ARCADE_MATCH_TUNING.homeComposure * 0.3 : 0);
    const winChance = clamp(0.28 + actor.player.attributes.defending / 170 - owner.player.attributes.dribbling / 260 + approach * 0.12 + (sliding ? 0.08 : 0) - shielding + jockeyBonus, 0.12, 0.82);
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
      this.addStoppage(0.5);
      this.coverSentOffPlayer(defender);
      stats.reds++;
      this.contributions[defender.player.id].reds++;
      eventType = 'red';
    } else if (yellow) {
      this.addStoppage(0.3);
      defender.card = 'yellow';
      stats.yellows++;
      this.contributions[defender.player.id].yellows++;
      eventType = 'yellow';
    }
    const victimDirection = this.attackDirection(victim.side);
    const inBox = Math.abs(victim.y - FIELD_WIDTH / 2) <= 20.16 && (victimDirection > 0 ? victim.x > FIELD_LENGTH - 16.5 : victim.x < 16.5);
    const params = { player: playerName(defender.player) };
    if (inBox && eventType !== 'foul') {
      // A penalty with a card reports both decisions.
      this.events.push({ minute: this.footballMinute, type: 'foul', side: defender.side, playerId: defender.player.id, messageKey: 'match.penalty', params });
      this.events.push({ minute: this.footballMinute, type: eventType, side: defender.side, playerId: defender.player.id, messageKey: eventType === 'red' ? 'match.red' : 'match.yellow', params });
    } else this.events.push({ minute: this.footballMinute, type: eventType, side: defender.side, playerId: defender.player.id, messageKey: inBox ? 'match.penalty' : eventType === 'red' ? 'match.red' : eventType === 'yellow' ? 'match.yellow' : 'match.freeKick', params });
    if (this.rng.bool(clamp((severity - 8) / 220, 0.005, 0.06))) {
      this.setAction(victim, 'injured');
      if (!this.isInjured(victim.player.id)) (this.football.injuredIds ??= []).push(victim.player.id);
      this.addStoppage(1);
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
    if(owner?.player.positionGroup==='GK' && owner.action==='keeper-catch') {
      const blend=1-Math.exp(-16*dt);
      this.ball.x+=(owner.x+owner.facingX*.35-this.ball.x)*blend;
      this.ball.y+=(owner.y+owner.facingY*.35-this.ball.y)*blend;
      this.ball.z+=(1.10-this.ball.z)*blend;
      this.ball.vx=this.ball.vy=this.ball.vz=0;
      return;
    }
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
          owner.contact = { tick: this.tick, x: this.ball.x, y: this.ball.y, z: this.ball.z, kind: 'foot', foot: owner.player.foot === 'Left' ? 'left' : 'right', dribble: true };
          this.ball.lastTouch = owner.side;
          this.ball.lastTouchPlayerId = owner.player.id;
        }
      }
    }
    // At most 8 cm per substep: even a full-power shot cannot tunnel through a post.
    const count = Math.max(1, Math.ceil(Math.hypot(this.ball.vx, this.ball.vy, this.ball.vz) * dt / 0.08));
    const h = dt / count;
    let reportedFrameContact=false;
    for (let i = 0; i < count; i++) {
      integrateBall(this.ball, h, this.config.weather !== 'clear');
      const post = collideGoalFrame(this.ball, 0, FIELD_WIDTH / 2, GOAL_WIDTH, GOAL_HEIGHT);
      const otherPost = collideGoalFrame(this.ball, FIELD_LENGTH, FIELD_WIDTH / 2, GOAL_WIDTH, GOAL_HEIGHT);
      if (post || otherPost) {
        if(!reportedFrameContact) this.events.push({minute:this.footballMinute,type:'commentary',side:this.ball.lastTouch,playerId:this.ball.lastTouchPlayerId,messageKey:'match.post'});
        reportedFrameContact=true;
        this.ball.ownerId = null;
        if (this.activeShot) this.activeShot.checkedKeeper = false;
      }
      if (!this.ball.ownerId && this.activeShot && this.blockShot()) break;
      if (!this.ball.ownerId) this.handlePostsAndKeeper();
      if (this.rule.phase !== 'playing' && this.rule.phase !== 'advantage') return;
      if (this.handleBoundary()) return;
    }
    if (!this.ball.ownerId) this.tryBallControl();
  }

  private handlePostsAndKeeper(): void {
    if (this.ball.ownerId || this.ball.z > 2.45) return;
    // Hands only with the ball inside the own penalty area; a dive extends the reach.
    const keeper = this.actors.find(actor => actor.active && actor.player.positionGroup === 'GK'
      && this.inOwnPenaltyArea(actor) && this.ballInPenaltyAreaOf(actor.side)
      && distance(actor, this.ball) < this.keeperReach(actor));
    if (!keeper || (this.ball.lastTouchPlayerId === keeper.player.id && this.ball.controlledTouch < 0.35)) return;
    // Back-pass rule: a deliberate pass from a team-mate may not be handled.
    if (!this.activeShot && this.ball.lastTouch === keeper.side && this.lastPasser?.side === keeper.side && this.lastPasser.id !== keeper.player.id) return;
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
      // Parries go wide and away from goal rather than back into the danger zone.
      const wide = Math.sign(this.ball.y - FIELD_WIDTH / 2) || (this.ball.y >= keeper.y ? 1 : -1);
      this.ball.vx = direction * Math.max(3, Math.abs(this.ball.vx) * 0.3);
      this.ball.vy = wide * (4 + speed * 0.24);
      this.ball.vz = 2.2;
      this.setAction(keeper, keeper.action==='keeper-dive'||distance(keeper, this.ball) > 1.15 ? 'keeper-dive' : 'keeper-parry');
    }
    keeper.actionTarget={x:keeper.contact.x,y:keeper.contact.y,z:keeper.contact.z};
    this.activeShot = null;
    this.intendedReceiverId = null;
    if (catchBall) this.football.offsideCandidates = [];
  }

  /** Outfield players in the path (including a wall) block shots below about 1.9 m. */
  private blockShot(): boolean {
    const shot = this.activeShot!;
    if (this.ball.z > 1.9 || this.ball.controlledTouch < 0.1) return false;
    for (const actor of this.actors) {
      if (!actor.active || actor.side === shot.side || actor.player.positionGroup === 'GK') continue;
      if (Math.hypot(actor.x - this.ball.x, actor.y - this.ball.y) > 0.45) continue;
      const speed = Math.hypot(this.ball.vx, this.ball.vy);
      const angle = this.rng.float(-1.1, 1.1);
      const back = -Math.atan2(this.ball.vy, this.ball.vx);
      this.ball.vx = Math.cos(Math.PI - back + angle) * speed * 0.3;
      this.ball.vy = Math.sin(Math.PI - back + angle) * speed * 0.3;
      this.ball.vz = Math.abs(this.ball.vz) * 0.4 + 1;
      this.ball.spin = this.ball.topspin = 0;
      this.ball.lastTouch = actor.side;
      this.ball.lastTouchPlayerId = actor.player.id;
      this.ball.controlledTouch = 0;
      actor.contact = { tick: this.tick, x: this.ball.x, y: this.ball.y, z: this.ball.z, kind: this.ball.z > 1.4 ? 'head' : 'foot', foot: 'right' };
      this.stats(actor.side).blocks = (this.stats(actor.side).blocks ?? 0) + 1;
      this.ratings[actor.player.id] = clamp((this.ratings[actor.player.id] ?? 6.5) + 0.08, 1, 10);
      this.events.push({ minute: this.footballMinute, type: 'commentary', side: actor.side, playerId: actor.player.id, messageKey: 'match.blocked', params: { player: playerName(actor.player) } });
      this.activeShot = null;
      return true;
    }
    return false;
  }

  private ballInPenaltyAreaOf(side: Side): boolean {
    const goalDistance = this.attackDirection(side) > 0 ? this.ball.x : FIELD_LENGTH - this.ball.x;
    return goalDistance <= 16.5 + BALL_RADIUS && Math.abs(this.ball.y - FIELD_WIDTH / 2) <= 20.16 + BALL_RADIUS;
  }

  private keeperReach(keeper: ArcadeActor): number {
    const base = 1.3 + keeper.player.attributes.goalkeeping * 0.006;
    if (keeper.action !== 'keeper-dive' || !actionIsPlaying('keeper-dive', keeper.actionStartedTick, this.tick)) return base;
    const age = (this.tick - keeper.actionStartedTick) / 60;
    return base + 0.75 * clamp(age / 0.22, 0, 1) * (age < 0.6 ? 1 : 0.4);
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
      // Chest and thigh control up to 1.4 m; very hard balls at that height cannot be killed.
      if (this.ball.z > 0.75 && speed > 17) continue;
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
    const aerialPenalty = this.ball.z > 0.75 ? 10 + speed * 0.5 : 0;
    const firstTouch = candidate.player.attributes.dribbling + candidate.stamina * 0.25 - speed * 1.4 - aerialPenalty;
    const weatherPenalty = this.config.weather === 'rain' ? 8 : this.config.weather === 'storm' ? 11 : 0;
    const humanReceiver = this.config.controllerMode === 'human' && candidate.side === this.controlledSide;
    const intendedAiReceiverBonus = !humanReceiver && candidate.player.id === this.intendedReceiverId
      ? ARCADE_MATCH_TUNING.aiIntendedReceiverBonus
      : 0;
    const assistBonus = humanReceiver
      ? this.config.assist === 'assisted' ? 14 : this.config.assist === 'balanced' ? 7 : 1
      : ARCADE_MATCH_TUNING.aiFirstTouchAssist + intendedAiReceiverBonus;
    const homeTouch = candidate.side === 'home' ? ARCADE_MATCH_TUNING.homeComposure * 50 : 0;
    if (this.rng.bool(clamp((firstTouch + assistBonus + homeTouch - weatherPenalty) / 100, 0.18, 0.96))) {
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
      if (candidate.side === this.controlledSide && this.config.controllerMode==='human') candidate.decisionCooldown=Math.max(candidate.decisionCooldown,.30);
      if (candidate.side === this.controlledSide && (this.config.autoSwitch!=='manual'||candidate.player.id===this.selectedPlayerId) && this.football.queuedAction && this.football.queuedAction.expiresTick >= this.tick) {
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
    if (!attempt) {
      // Every other arriving high ball is met: clearances near the own goal, headed passes elsewhere.
      if (Math.hypot(this.ball.vx, this.ball.vy) > 4 && distance(actor, this.ball) < 0.6 && this.legalRestartTouch(actor)) this.defensiveHeader(actor, goalDistance);
      return;
    }
    if (!this.legalRestartTouch(actor)) return;
    if (this.football.offsideCandidates.includes(actor.player.id)) {
      this.stats(actor.side).offsides++;
      this.events.push({ minute: this.footballMinute, type: 'foul', side: actor.side, playerId: actor.player.id, messageKey: 'match.offside', params: { player: playerName(actor.player) } });
      this.setRestart('freeKick', this.opposite(actor.side), actor.x, actor.y, true);
      return;
    }
    const aimedY = 34 + (queued?.aimY ?? this.rng.float(-0.6, 0.6)) * 2.6;
    // Heading accuracy depends on strength, finishing and distance; wide headers really miss.
    const headingError = (100 - (actor.player.attributes.physical + actor.player.attributes.shooting) / 2) / 100 * 1.8 + goalDistance * 0.06;
    const targetY = aimedY + this.rng.normal(0, headingError);
    const headerXg = shotXg(goalDistance, actor.y - 34, actor.player.attributes.shooting, clamp((3 - this.closestOpponent(actor)) / 3, 0, 1), true);
    const length = Math.hypot(goalX - actor.x, targetY - actor.y);
    const speed = 11 + actor.player.attributes.physical * 0.07;
    this.releaseBall(actor, (goalX - actor.x) / length * speed, (targetY - actor.y) / length * speed, -1.4, 0);
    if (actor.contact) actor.contact.kind = 'head';
    this.setAction(actor, 'header');
    this.stats(actor.side).shots++;
    if (Math.abs(targetY - 34) <= GOAL_WIDTH / 2) this.stats(actor.side).shotsOnTarget++;
    this.stats(actor.side).xG = round(this.stats(actor.side).xG + headerXg, 2);
    this.activeShot = { shooterId: actor.player.id, side: actor.side, xG: headerXg, targetY, checkedKeeper: false };
    this.football.queuedAction = null;
    this.events.push({ minute: this.footballMinute, type: 'shot', side: actor.side, playerId: actor.player.id, params: { player: playerName(actor.player), xG: round(headerXg, 2), distance: round(goalDistance, 1) } });
  }

  private defensiveHeader(actor: ArcadeActor, attackingGoalDistance: number): void {
    if (this.football.offsideCandidates.includes(actor.player.id)) {
      this.stats(actor.side).offsides++;
      this.events.push({ minute: this.footballMinute, type: 'foul', side: actor.side, playerId: actor.player.id, messageKey: 'match.offside', params: { player: playerName(actor.player) } });
      this.setRestart('freeKick', this.opposite(actor.side), actor.x, actor.y, true);
      return;
    }
    const direction = this.attackDirection(actor.side);
    const strength = actor.player.attributes.physical;
    const teammates = this.actors.filter(candidate => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id);
    if (attackingGoalDistance > 70) {
      const wide = actor.y < FIELD_WIDTH / 2 ? -1 : 1;
      const speed = 13 + strength * 0.06;
      this.releaseBall(actor, direction * speed * 0.85, wide * speed * 0.5, 5, 0);
      this.intendedReceiverId = null;
    } else {
      const target = teammates
        .filter(candidate => candidate.player.positionGroup !== 'GK' && distance(candidate, actor) > 4 && distance(candidate, actor) < 20
          && ((candidate.x - actor.x) * actor.facingX + (candidate.y - actor.y) * actor.facingY) > 0)
        .sort((a, b) => this.passLanePressure(actor, a) - this.passLanePressure(actor, b) || distance(a, actor) - distance(b, actor))[0];
      const aimX = target ? target.x - actor.x : actor.facingX, aimY = target ? target.y - actor.y : actor.facingY;
      const length = Math.hypot(aimX, aimY) || 1;
      this.registerPass(actor, target, teammates);
      this.releaseBall(actor, aimX / length * 11, aimY / length * 11, 2.4, 0);
    }
    if (actor.contact) actor.contact.kind = 'head';
    this.setAction(actor, 'header');
    this.activeShot = null;
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
    this.addStoppage(0.7);
    const lastToucher = this.actors.find((actor) => actor.player.id === this.ball.lastTouchPlayerId);
    // A deflection or clearance into the own net is an own goal: no goal credit, a rating penalty.
    const ownGoal = !!lastToucher && lastToucher.side !== side;
    const scorer = ownGoal ? undefined : lastToucher;
    if (scorer) {
      this.contributions[scorer.player.id].goals++;
      this.ratings[scorer.player.id] = clamp(this.ratings[scorer.player.id] + 1.2, 1, 10);
    }
    if (ownGoal && lastToucher) this.ratings[lastToucher.player.id] = clamp(this.ratings[lastToucher.player.id] - 0.6, 1, 10);
    const assister = !ownGoal && this.lastPasser && this.lastPasser.side === side && this.elapsed - this.lastPasser.at <= 8 && this.lastPasser.id !== scorer?.player.id
      ? this.actors.find((actor) => actor.player.id === this.lastPasser!.id)
      : undefined;
    if (assister) {
      this.contributions[assister.player.id].assists++;
      this.ratings[assister.player.id] = clamp(this.ratings[assister.player.id] + 0.65, 1, 10);
    }
    if (ownGoal && lastToucher) {
      this.events.push({
        minute: this.footballMinute, type: 'goal', side, playerId: null, ownGoal: true,
        playerName: playerName(lastToucher.player), messageKey: 'match.goal.own',
        params: { player: playerName(lastToucher.player), team: this.teamOf(side).shortName },
      });
    } else this.events.push({
      minute: this.footballMinute,
      type: 'goal',
      side,
      playerId: scorer?.player.id ?? null,
      playerName: scorer ? playerName(scorer.player) : undefined,
      assistName: assister ? playerName(assister.player) : undefined,
      messageKey: assister ? 'match.goal.assist' : 'match.goal.solo',
      params: { player: scorer ? playerName(scorer.player) : this.teamOf(side).shortName, ...(assister ? { assist: playerName(assister.player) } : {}) },
    });
    // Include the actual line crossing before placing the next kickoff.
    if (this.config.mode !== 'instant') this.replayBuffer.push(this.snapshot());
    this.frozenReplay = this.replayBuffer.latest(360);
    this.replayBuffer.clear();
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
    this.ball.spin = this.ball.topspin = 0;
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
    const taker = chooseRestartTaker(this.rule, team, this.actors.filter(actor => actor.active && actor.side === side), this.ball);
    if (!taker) return;
    if (this.rule.elapsed === 0) {
      this.autoSubstitutions();
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
    const goalDistance = Math.abs((direction > 0 ? FIELD_LENGTH : 0) - this.ball.x);
    // Unattended direct free kicks within range are struck at goal with curl, over or round the wall.
    const aiDirectFreeKick = !command && phase === 'freeKick' && !indirect && goalDistance < 28 && Math.abs(this.ball.y - FIELD_WIDTH / 2) < 16
      && taker.player.attributes.shooting >= 62 && this.rng.bool(0.7);
    if (phase === 'penalty' || aiDirectFreeKick || command?.kind === 'shoot' && phase !== 'throwIn' && !indirect) {
      this.penaltyNerves = phase === 'penalty' ? this.penaltyComposure(taker) : 1;
      this.shoot(taker,command?.power ?? (aiDirectFreeKick ? .78 : .72),direction,command?.aimY ?? this.rng.float(-.8,.8),command?.finesse ?? aiDirectFreeKick,command?.low ?? false);
      this.penaltyNerves = 1;
      if (phase === 'penalty') this.keeperGuessesPenalty(side);
    } else {
      const lob = phase === 'corner' || command?.kind === 'lob';
      this.pass(taker,command?.kind==='through',lob,command?.power ?? (lob?.75:.4),aimX,aimY);
      if (phase === 'throwIn') {
        // A throw leaves the hands at 8-14 m/s, not at passing speed.
        const throwSpeed = Math.hypot(this.ball.vx, this.ball.vy) || 1;
        const scaled = clamp(throwSpeed, 8, 14) / throwSpeed;
        this.ball.vx *= scaled; this.ball.vy *= scaled;
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
    arrangeRestart(taker, this.rule, this.ball, this.actors, actor => this.attackDirection(actor.side));
    if (taker.side === this.controlledSide && !this.config.playerLockId) this.selectedPlayerId = taker.player.id;
  }

  /** The side the player does not manage (and, in instant simulation, both) changes injured and exhausted players at stoppages. */
  private autoSubstitutions(): void {
    for (const side of ['home', 'away'] as const) {
      if (side === this.controlledSide && this.config.mode !== 'instant') continue;
      const onPitch = this.actors.filter(actor => actor.active && actor.side === side);
      const injured = onPitch.filter(actor => this.isInjured(actor.player.id));
      const tired = this.footballMinute >= 55
        ? onPitch.filter(actor => actor.player.positionGroup !== 'GK' && actor.stamina < 45).sort((a, b) => a.stamina - b.stamina)
        : [];
      for (const actor of [...injured, ...tired.slice(0, 1)]) {
        const bench = this.benchFor(side);
        const sameGroup = bench.filter(player => player.positionGroup === actor.player.positionGroup);
        const pool = sameGroup.length ? sameGroup : actor.player.positionGroup === 'GK' ? [] : bench.filter(player => player.positionGroup !== 'GK');
        const incoming = [...pool].sort((a, b) => b.overall - a.overall)[0];
        if (incoming) this.substitute(side, actor.player.id, incoming.id);
      }
    }
  }

  /** After a red card the most advanced forward drops into the vacated defensive position (a 4-4-1 style shape). */
  private coverSentOffPlayer(sentOff: ArcadeActor): void {
    if (sentOff.player.positionGroup !== 'DEF') return;
    const direction = this.attackDirection(sentOff.side);
    const forward = this.actors
      .filter(actor => actor.active && actor.side === sentOff.side && actor.player.positionGroup === 'ATT')
      .sort((a, b) => (b.homeX - a.homeX) * direction)[0];
    if (!forward) return;
    forward.homeX = sentOff.homeX;
    forward.homeY = sentOff.homeY;
  }

  /** Error multiplier from the spot: shooting quality and the "Ice in the Veins" trait calm the nerves. */
  private penaltyComposure(taker: ArcadeActor): number {
    const iceVeins = taker.player.traitIds?.includes('iceveins') ? 8 : 0;
    return clamp(1.25 - (taker.player.attributes.shooting + iceVeins) / 200, 0.7, 1.1);
  }

  /** The keeper commits to a side (or stays central) as the penalty is struck. */
  private keeperGuessesPenalty(shootingSide: Side): void {
    const keeper = this.actors.find(actor => actor.active && actor.side !== shootingSide && actor.player.positionGroup === 'GK');
    if (!keeper) return;
    const roll = this.rng.next();
    if (roll < 0.2) return;
    const guessY = FIELD_WIDTH / 2 + (roll < 0.6 ? -1 : 1) * 2.4;
    this.setAction(keeper, 'keeper-dive');
    keeper.actionTarget = { x: keeper.x, y: guessY, z: 0.7 };
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
    this.ball.vx = this.ball.vy = this.ball.vz = this.ball.spin = this.ball.topspin = 0;
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

  private extraPeriodOver(periodStart: number): boolean {
    const end = periodStart + this.totalSeconds / 6;
    if (this.elapsed < end) return false;
    return (!this.activeShot && Math.abs(this.ball.x - FIELD_LENGTH / 2) < 22) || this.elapsed >= end + 8;
  }

  private startExtraTime(): void {
    this.football.extra = { period: 1, periodStart: this.elapsed };
    this.phase = 'halftime';
    this.paused = true;
    this.rule = this.newRule('halftime', null, this.ball.x, this.ball.y);
    this.events.push({ minute: 90, type: 'commentary', side: null, playerId: null, messageKey: 'match.extraTime', params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore } });
  }

  private changeEndsInExtraTime(): void {
    this.football.extra = { period: 2, periodStart: this.elapsed };
    this.rebaseFormation();
    this.resetKickoff('away');
    this.events.push({ minute: 105, type: 'commentary', side: null, playerId: null, messageKey: 'match.extraTimeHalf' });
  }

  /**
   * Penalties after a drawn knockout tie: five each in alternation (decided early when out of reach),
   * then sudden death. Conversion depends on the taker, the "Ice in the Veins" trait and the keeper.
   */
  private resolveShootout(): void {
    const order = (side: Side) => this.actors
      .filter(actor => actor.active && actor.side === side)
      .sort((a, b) => (a.player.positionGroup === 'GK' ? 1 : 0) - (b.player.positionGroup === 'GK' ? 1 : 0)
        || (b.player.attributes.shooting + (b.player.traitIds?.includes('iceveins') ? 8 : 0)) - (a.player.attributes.shooting + (a.player.traitIds?.includes('iceveins') ? 8 : 0)));
    const takers = { home: order('home'), away: order('away') };
    const keeper = (side: Side) => this.actors.find(actor => actor.active && actor.side === side && actor.player.positionGroup === 'GK');
    const shootout: PenaltyShootout = { home: [], away: [], takers: { home: [], away: [] }, winner: 'home' };
    const goals = { home: 0, away: 0 };
    let decided = false;
    for (let round = 0; round < 30 && !decided; round++) {
      for (const side of ['home', 'away'] as const) {
        const list = takers[side];
        const taker = list[round % Math.max(1, list.length)];
        if (!taker) continue;
        const opponentKeeper = keeper(this.opposite(side));
        const ice = taker.player.traitIds?.includes('iceveins') ? 0.05 : 0;
        const chance = clamp(0.76 + (taker.player.attributes.shooting - 70) / 200 + ice - ((opponentKeeper?.player.attributes.goalkeeping ?? 60) - 70) / 250, 0.55, 0.92);
        const scored = this.rng.bool(chance);
        shootout[side].push(scored);
        shootout.takers[side].push(taker.player.id);
        if (scored) goals[side]++;
        this.events.push({ minute: 120, type: 'commentary', side, playerId: taker.player.id, messageKey: scored ? 'match.shootoutScored' : 'match.shootoutMissed', params: { player: playerName(taker.player), home: goals.home, away: goals.away } });
        // Within the first five each, stop as soon as one side can no longer catch up.
        if (round < 5 && (goals.home + 5 - shootout.home.length < goals.away || goals.away + 5 - shootout.away.length < goals.home)) { decided = true; break; }
      }
      if (!decided && round >= 4 && goals.home !== goals.away) decided = true;
    }
    shootout.winner = goals.home > goals.away ? 'home' : 'away';
    this.shootout = shootout;
    this.events.push({ minute: 120, type: 'commentary', side: shootout.winner, playerId: null, messageKey: 'match.shootoutWinner', params: { team: this.teamOf(shootout.winner).shortName, home: goals.home, away: goals.away } });
  }

  private enterHalftime(): void {
    (this.football.stoppage ??= { added: [0, 0], overrun: 0 }).overrun = this.elapsed - this.totalSeconds / 2;
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
      ...(this.football.extra ? { extraTime: true } : {}),
      ...(this.shootout ? { shootout: structuredClone(this.shootout) } : {}),
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
    if (this.config.mode !== 'instant' && this.phase !== 'goalReplay') {
      this.replayBuffer.record(reuse => this.snapshotInto(reuse));
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
    this.collisions.resolve(this.actors);
  }

  private isOffside(target: ArcadeActor, passer: ArcadeActor): boolean {
    return isOffsidePosition(target, passer, this.actors, this.attackDirection(passer.side));
  }

  private passLanePressure(from: ArcadeActor, to: ArcadeActor): number {
    return passLanePressure(from, to, this.actors);
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
    return actorSnapshot(actor);
  }

  private applyActorSnapshot(actor: ArcadeActor, saved: PlayerRuntimeSnapshot): void {
    applyActorSnapshot(actor, saved, this.tick);
  }

  private ballSnapshot(): BallSnapshot {
    return ballSnapshot(this.ball);
  }

  private newRule(phase: RuleState['phase'], restartSide: Side | null, spotX: number, spotY: number, indirect = false): RuleState {
    return { phase, restartSide, spotX, spotY, elapsed: 0, indirect, advantageSide: null, pendingCardPlayerId: null };
  }

  private setAction(actor: ArcadeActor, action: PlayerActionState): void {
    if (isLocomotionAction(action) && actionIsPlaying(actor.action, actor.actionStartedTick, this.tick)) return;
    if (actor.action === action) return;
    actor.actionTarget=undefined;
    actor.action = action;
    actor.actionStartedTick = this.tick;
  }

  private maxSpeed(actor: ArcadeActor, sprint: boolean): number {
    const base = arcadeSprintSpeed(actor.player.attributes.pace);
    const fitness = actor.stamina < 40 ? 0.82 + actor.stamina * 0.0045 : 1;
    const ownsBall = this.ball.ownerId === actor.player.id;
    const ball = ownsBall ? sprint ? ARCADE_MATCH_TUNING.ballSprintRatio : ARCADE_MATCH_TUNING.ballJogRatio : 1;
    const injured = this.football.injuredIds?.length && this.isInjured(actor.player.id) ? 0.6 : 1;
    return base * fitness * ball * injured * (sprint ? 1 : ARCADE_MATCH_TUNING.jogRatio);
  }

  private owner(): ArcadeActor | undefined {
    return this.actors.find((actor) => actor.active && actor.player.id === this.ball.ownerId);
  }

  /** Difficulty tunes the opponent only; the player's own AI teammates always play at the normal level. */
  /** Error multiplier: below 1 for the home side. */
  private composure(side: Side): number {
    return side === 'home' ? 1 - ARCADE_MATCH_TUNING.homeComposure : 1;
  }

  aiLevel(side: Side): Difficulty {
    return side === this.controlledSide ? 'normal' : this.config.difficulty;
  }

  private teamOf(side: Side): Team {
    return side === 'home' ? this.home : this.away;
  }

  private stats(side: Side): TeamMatchStats {
    return side === 'home' ? this.homeStats : this.awayStats;
  }

  private opposite(side: Side): Side {
    return oppositeSide(side);
  }

  private sideAttackingDirection(direction: 1 | -1): Side {
    return this.attackDirection('home') === direction ? 'home' : 'away';
  }

  private closestOpponent(actor: ArcadeActor): number {
    return closestOpponentDistance(actor, this.actors);
  }

  private pushCommentary(messageKey: string, params: Record<string, string | number>): void {
    this.events.push({ minute: this.footballMinute, type: 'commentary', side: this.controlledSide, playerId: null, messageKey, params });
  }
}
