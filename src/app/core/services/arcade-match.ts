import { hash32 } from '../visual-identity';
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
  PendingKick,
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
import type { PenaltyShootout, SignatureReport } from '../../models/match.model';
import { playerName, groupForPosition } from '../ratings';
import { tacticalIntent } from '../football/tactical-intent';
import { ReplayRing } from '../football/replay-ring';
import { clamp, Rng, round } from '../util';
import { createInjury, isPlayerAvailable } from '../injury-engine';
import { accelerateTowards, turnFacing, turnTowards } from '../football/movement';
import { ACTION_CONTACT_TICKS, ACTION_DURATION_TICKS, actionIsPlaying, isLocomotionAction } from '../football/action-timing';
import { BALL_RADIUS, collideGoalFrame, integrateBall } from '../football/ball-physics';
import { ActiveShot, ArcadeActor, ArcadeBall, FIELD_LENGTH, FIELD_WIDTH, FULL_PITCH, GOAL_HEIGHT, GOAL_WIDTH, MATCH_TICK, PITCH, PitchGeometry, SMALL_PITCH, applyPitch, distance, oppositeSide, len2, len3 } from '../football/match-types';
import { closestOpponentDistance, isOffsidePosition, passLanePressure } from '../football/pitch-analysis';
import { PlayerCollisionGrid } from '../football/collisions';
import { actorSnapshot, applyActorSnapshot, ballSnapshot, fnv1aHex, writeBallSnapshot, writePlayers } from '../football/match-snapshot';
import { keeperDiveTarget, keeperPositionIntent } from '../football/keeper-ai';
import { arrangeRestart, chooseRestartTaker, isCrossedRestart } from '../football/set-pieces';
import { actionValue, dribbleSuccess, expectedThreat, passCompletion } from '../football/xt';
import { shootoutConversionChance } from '../football/penalty';
import { Aim, KickOutcome, ShootoutHost, ShootoutPrompt, ShootoutSession } from '../football/shootout';
import { AttributeKey } from '../../models/enums';
import { Cond, condMatches } from '../rpg/conditions';
import { SignatureRuntime, ULTIMATE_COST, ULTIMATE_SECONDS, createRuntimes, signatureBit } from '../rpg/signatures';
import { SigEvent } from '../../data/signatures';
import { HK, HOOK_BIT, HOOK_COUNT, hookName } from '../rpg/effects';
import { partnerBonus } from '../rpg/partners';
import { canUse } from '../rpg/stat-block';
import { StatBlock, buildStatBlock, newAttributes, rawStatBlock, refreshAttributes, refreshHooks, resolveAttribute, resolveHook } from '../rpg/stat-block';
import { shotAngleQuality, shotXg } from '../football/xg';
import { ARCADE_MATCH_TUNING, MATCH_TUNING as T } from '../football/tuning';

import { inCrossingZone, cross, crossRunner, registerPass, selectReceiver, pass, releaseBall } from '../football/actions/pass';
import { shoot, shotValue, curlSign, blockShot } from '../football/actions/shot';
import { executeFootballAction, scheduleKick, processPendingKick, performKick, cancelKick, feint } from '../football/actions/kick';
import { tieOrder, tryBallControl } from '../football/actions/reception';
import { resolvePressureTackles, attemptTackle } from '../football/actions/tackle';
import { performSkill, tryAiSkill, dribbleFoot } from '../football/actions/skill';
import { tryHeader, headAtGoal, predictBall, tryAerialStrike, strikeAerial, defensiveHeader } from '../football/actions/aerial';
import { chooseAiIntent, bestPassOption, betterPlacedTeammate } from '../football/ai/carrier';
import { handlePostsAndKeeper, keeperReach, keeperGuessesPenalty } from '../football/ai/keeper';
import { callFoul, jumpWall, applyPendingCards } from '../football/rules/fouls';
import { updateAdvantage } from '../football/rules/advantage';
import { setRestart, updateRestart, legalRestartTouch, resetKickoff, handleBoundary } from '../football/rules/restarts';

import { FlightLanding, FlightPath, aimPreview, flightLanding } from '../football/aim-preview';

export { ARCADE_MATCH_TUNING } from '../football/tuning';

export { FIELD_LENGTH, FIELD_WIDTH, GOAL_HEIGHT, GOAL_WIDTH, MATCH_TICK, PITCH, applyPitch } from '../football/match-types';

export interface ScenarioSetup {
  home: Array<{ index: number; x: number; y: number }>;
  away: Array<{ index: number; x: number; y: number }>;
  ball: { x: number; y: number; owner?: { side: Side; index: number } };
  restart?: { phase: 'penalty' | 'freeKick'; side: Side };
}
export type { ArcadeActor, ArcadeBall } from '../football/match-types';

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

export type { ShootoutPrompt } from '../football/shootout';

export type Point = { x: number; y: number; z: number };
export type AerialKind = 'volley' | 'bicycle-kick' | 'flying-header';

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
  /** Full pitch, or the five-a-side cage with boards instead of touchlines and no offside. */
  readonly pitch: PitchGeometry;
  readonly actors: ArcadeActor[] = [];
  /** Render-only: bumped when players or the ball are placed instead of moved, so frames are not interpolated across it. */
  teleportEpoch = 0;
  /** Training scenarios never take a restart on the player's behalf. */
  scenarioActive = false;
  ownerCache: ArcadeActor | undefined;
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

  readonly rng: Rng;
  readonly totalSeconds: number;
  previousInput: MatchCommand = { ...EMPTY_MATCH_COMMAND };
  actionHeld = { pass: 0, through: 0, lob: 0, shoot: 0 };
  possessionHomeSeconds = 0;
  possessionAwaySeconds = 0;
  lastKeyframeMinute = -1;
  finalResult: MatchResult | null = null;
  halftimeReached = false;
  halftimeRecoveryApplied = false;
  readonly passAttempts: Record<Side, number> = { home: 0, away: 0 };
  readonly passCompletions: Record<Side, number> = { home: 0, away: 0 };
  lastPasser: { id: string; side: Side; at: number; received?: boolean } | null = null;
  pendingOffsideTargetId: string | null = null;
  intendedReceiverId: string | null = null;
  football: NonNullable<MatchCheckpoint['runtime']['football']> = {
    selectionUntilTick: 0, queuedAction: null, offsideCandidates: [],
    oneTwoRunnerId: null, oneTwoUntilTick: 0,
  };
  activeShot: ActiveShot | null = null;
  shootout: PenaltyShootout | null = null;
  /** Temporary error multiplier while a penalty is being struck. */
  penaltyNerves = 1;
  safeSnapshot!: MatchSnapshot;
  readonly replayBuffer = new ReplayRing();
  frozenReplay: MatchSnapshot[] = [];
  lastSubAt = -100;
  /** Cond flags that apply to every player right now (dead-ball kicks, penalties). */
  ambientFlags = 0;
  lastOwnerSide: Side | null = null;
  lastOwnerId: string | null = null;
  /** Focus meter per side (0-100): the Mythic ultimate of a side needs it full. */
  readonly focus: Record<Side, number> = { home: 0, away: 0 };
  readonly ultimateUntil: Record<Side, number> = { home: 0, away: 0 };
  readonly ultimateUser: Record<Side, string | null> = { home: null, away: null };
  readonly mythicSide: Record<Side, boolean> = { home: false, away: false };
  /** A shoot-out the player plays kick by kick; null when none is running. */
  shootoutRun: ShootoutSession | null = null;
  sideFlagsTick = -1;
  sharedFlagsTick = -1;
  sharedFlags = 0;
  sideFlagsValue: [number, number] = [0, 0];
  /** True when anybody on the pitch carries an event-driven signature, so events can be skipped otherwise. */
  anySignatureEvents = false;
  readonly signatureStats = new Map<string, SignatureReport>();
  readonly possessionGainedTick: Record<Side, number> = { home: -100000, away: -100000 };
  readonly collisions = new PlayerCollisionGrid();
  readonly predictScratch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, topspin: 0 };

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
    this.pitch = this.config.smallSided ? SMALL_PITCH : FULL_PITCH;
    applyPitch(this.pitch);
    // Field initialisers ran before the pitch was known.
    this.ball.x = FIELD_LENGTH / 2;
    this.ball.y = FIELD_WIDTH / 2;
    this.rule = this.newRule('kickoff', 'home', FIELD_LENGTH / 2, FIELD_WIDTH / 2);
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
  addStoppage(footballMinutes: number): void {
    const stoppage = (this.football.stoppage ??= { added: [0, 0], overrun: 0 });
    stoppage.added[this.halftimeReached ? 1 : 0] += footballMinutes;
  }

  /** Regular time plus announced stoppage time is over; the whistle waits for a calm moment (max. 8 s). */
  periodOver(regularEndSeconds: number): boolean {
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
    applyPitch(this.pitch);
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.paused || this.finished || this.phase === 'halftime' || this.phase === 'goalReplay' || this.shootoutRun) return;
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
    if (this.mythicSide.home) this.addFocus('home', 0.08 * safeDt);
    if (this.mythicSide.away) this.addFocus('away', 0.08 * safeDt);
    if (input.ultimate && !this.previousInput.ultimate) this.triggerUltimate(this.controlledSide);
    if ((this.mythicSide.home || this.mythicSide.away) && this.tick % 20 === 0) this.aiUltimate();
    this.handleSelection(input);
    const ownerBeforeMovement = this.owner();
    const supportPresser = input.skill && ownerBeforeMovement && ownerBeforeMovement.side !== this.controlledSide
      ? this.actors
          .filter((actor) => actor.active && actor.side === this.controlledSide && actor.player.id !== this.selectedPlayerId && actor.player.positionGroup !== 'GK')
          .sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0]
      : undefined;
    // The same button tackles and sends the keeper out: a defender in tackling range tackles, anyone further away rushes the keeper.
    const controlledDefender = acceptsHumanInput && ownerBeforeMovement && ownerBeforeMovement.side !== this.controlledSide
      ? this.actors.find((candidate) => candidate.player.id === this.selectedPlayerId && candidate.active)
      : undefined;
    const canTackle = !!controlledDefender && distance(controlledDefender, ownerBeforeMovement!) <= 1.6;
    let slot = 0;
    for (const actor of this.actors) {
      if (!actor.active) continue;
      this.refreshActorState(actor, ++slot, ownerBeforeMovement);
      actor.skillCooldown = Math.max(0, actor.skillCooldown - safeDt);
      actor.tackleCooldown = Math.max(0, actor.tackleCooldown - safeDt);
      // Rushing out is only possible for a ball close to the own goal, never across the pitch.
      const keeperRush = input.keeperRush && !canTackle && actor.side === this.controlledSide && actor.player.positionGroup === 'GK' && ownerBeforeMovement?.side !== actor.side
        && Math.abs(this.ball.x - (this.attackDirection(actor.side) > 0 ? 0 : FIELD_LENGTH)) < 22;
      if (actor.action === 'injured' && actionIsPlaying('injured', actor.actionStartedTick, this.tick)) {
        this.moveActor(actor, 0, 0, false, safeDt);
      } else if ((actor.action === 'flying-header' || actor.action === 'bicycle-kick') && actionIsPlaying(actor.action, actor.actionStartedTick, this.tick)) {
        this.committedMove(actor, safeDt);
      } else if (keeperRush || supportPresser?.player.id === actor.player.id) {
        this.setAction(actor, keeperRush ? 'keeper-rush' : 'support-press');
        this.moveActor(actor, this.ball.x - actor.x, this.ball.y - actor.y, true, safeDt);
      } else if (this.isHumanControlled(actor)) this.moveControlled(actor, input, safeDt);
      else this.moveAi(actor, safeDt);
    }
    this.resolvePlayerCollisions();
    if (input.request && !this.previousInput.request) this.requestRun();
    this.processPendingKick();
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
        if (this.homeScore === this.awayScore) {
          // A human managing a side takes the kicks himself; everybody else gets the automatic shoot-out.
          if (this.beginInteractiveShootout()) return;
          this.resolveShootout();
        }
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
        const recovery = 2 + this.stat(actor,'stamina') / 35;
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

  /**
   * Training challenges: places the listed players (index in formation order per side), takes all
   * others off the pitch and starts open play, or a penalty / free kick for the given side.
   */
  setupScenario(setup: ScenarioSetup): void {
    this.teleportEpoch++;
    this.scenarioActive = true;
    applyPitch(this.pitch);
    const listed = new Map<ArcadeActor, { x: number; y: number }>();
    for (const side of ['home', 'away'] as const) {
      const team = this.actors.filter((actor) => actor.side === side);
      for (const spot of setup[side]) if (team[spot.index]) listed.set(team[spot.index], spot);
    }
    for (const actor of this.actors) {
      const spot = listed.get(actor);
      actor.active = !!spot;
      actor.card = 'none';
      actor.vx = actor.vy = 0;
      actor.stamina = 100;
      actor.decisionCooldown = 0.3;
      if (!spot) { actor.x = actor.homeX = -20; actor.y = actor.homeY = -20; continue; }
      actor.x = actor.homeX = actor.intentX = spot.x;
      actor.y = actor.homeY = actor.intentY = spot.y;
      actor.facingX = this.attackDirection(actor.side);
      actor.facingY = 0;
      this.setAction(actor, 'formation');
    }
    const owner = setup.ball.owner ? this.actors.filter((actor) => actor.side === setup.ball.owner!.side)[setup.ball.owner.index] : undefined;
    Object.assign(this.ball, { x: setup.ball.x, y: setup.ball.y, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, topspin: 0, ownerId: owner?.player.id ?? null, lastTouch: owner?.side ?? 'home', lastTouchPlayerId: owner?.player.id ?? null, controlledTouch: 0 });
    if (owner && owner.side === this.controlledSide) this.selectedPlayerId = owner.player.id;
    else {
      const first = this.actors.find((actor) => actor.active && actor.side === this.controlledSide && actor.player.positionGroup !== 'GK') ?? this.actors.find((actor) => actor.active && actor.side === this.controlledSide);
      if (first) this.selectedPlayerId = first.player.id;
    }
    this.activeShot = null;
    this.lastPasser = null;
    this.intendedReceiverId = null;
    this.pendingOffsideTargetId = null;
    this.football.queuedAction = null;
    this.football.pendingKick = null;
    this.football.runRequest = null;
    this.football.oneTwoReturn = null;
    this.football.restartRelease = null;
    this.paused = false;
    this.phase = this.halftimeReached ? 'secondHalf' : 'firstHalf';
    this.rule = this.newRule('playing', null, this.ball.x, this.ball.y);
    if (setup.restart) this.setRestart(setup.restart.phase, setup.restart.side, setup.ball.x, setup.ball.y);
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

  substitute(side: Side, outId: string, inId: string): boolean {
    this.teleportEpoch++;
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
    this.initAttrs(actor);
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
    if (reuse) {
      reuse.tick = this.tick;
      reuse.controlledPlayerId = this.selectedPlayerId;
      reuse.attackDirection = this.currentAttackDirection;
      reuse.teleportEpoch = this.teleportEpoch;
      writeBallSnapshot(this.ball, reuse.ball);
      writePlayers(this.actors, reuse.players);
      return reuse;
    }
    return {
      tick: this.tick,
      controlledPlayerId: this.selectedPlayerId,
      attackDirection: this.currentAttackDirection,
      teleportEpoch: this.teleportEpoch,
      ball: this.ballSnapshot(),
      players: this.actors.map((actor) => this.actorSnapshot(actor)),
    };
  }

  snapshotInto(reuse: MatchSnapshot | undefined): MatchSnapshot {
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
        effects: {
          possessionGainedTick: { ...this.possessionGainedTick },
          lastOwnerSide: this.lastOwnerSide,
          lastOwnerId: this.lastOwnerId,
          sharedFlags: this.sharedFlags,
          sharedFlagsTick: this.sharedFlagsTick,
          focus: { ...this.focus },
          ultimateUntil: { ...this.ultimateUntil },
          ultimateUser: { ...this.ultimateUser },
          actors: Object.fromEntries(this.actors.map((actor) => [actor.player.id, {
            flags: actor.flags ?? 0,
            sig: (actor.sig ?? []).map((runtime) => ({ until: runtime.until, readyAt: runtime.readyAt, awake: runtime.awake, refilled: runtime.refilled })),
          }])),
          signatureStats: structuredClone([...this.signatureStats.values()]),
        },
        shootoutPending: !!this.shootoutRun,
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
      this.initAttrs(actor);
      this.applyActorSnapshot(actor, saved);
    }
    this.teleportEpoch++;
    Object.assign(this.ball, checkpoint.ball);
    this.tick = checkpoint.tick;
    this.restoreEffects(checkpoint.runtime.effects);
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
    // A reload in the middle of an interactive shoot-out cannot bring the kicks back: it is settled automatically.
    if (checkpoint.runtime.shootoutPending) {
      this.shootoutRun = null;
      this.resolveShootout();
      this.finish();
    }
    return this.isFiniteState();
  }

  stateHash(): string {
    const snapshot = this.snapshot();
    const players = snapshot.players.map(({ animationDistance: _presentationOnly, ...player }) => player);
    const json = JSON.stringify({ snapshot: { ...snapshot, players }, rng: this.rng.snapshot(), events: this.events, football: this.football, previousInput: this.previousInput, actionHeld: this.actionHeld, activeShot: this.activeShot, intendedReceiverId: this.intendedReceiverId, lastPasser: this.lastPasser });
    return fnv1aHex(json);
  }

  buildActors(team: Team, side: Side): void {
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
        slotPosition: slot.position,
        stats: undefined,
        flags: 0,
        attrs: undefined,
        attrBuffer: undefined,
        sig: undefined,
        hookAdd: undefined,
        hookMul: undefined,
      });
      this.initAttrs(this.actors[this.actors.length - 1]);
      this.ratings[player.id] = 6.5;
      this.contributions[player.id] = emptyContribution();
      this.heatmaps[player.id] = [];
    }
  }

  initialControlledActor(): ArcadeActor {
    const locked = this.config.playerLockId
      ? this.actors.find((actor) => actor.player.id === this.config.playerLockId && actor.side === this.controlledSide && actor.active)
      : undefined;
    return locked ?? this.bestControlledActor();
  }

  bestControlledActor(): ArcadeActor {
    const candidates = this.actors
      .filter((actor) => actor.active && actor.side === this.controlledSide && actor.player.positionGroup !== 'GK')
      .sort((a, b) => this.interceptTime(a) - this.interceptTime(b));
    return candidates[0] ?? this.actors.find((actor) => actor.active && actor.side === this.controlledSide)!;
  }

  interceptTime(actor: ArcadeActor): number {
    const projected = { x: this.ball.x + this.ball.vx * 0.35, y: this.ball.y + this.ball.vy * 0.35 };
    return distance(actor, projected) / Math.max(1, this.maxSpeed(actor, false));
  }

  isHumanControlled(actor: ArcadeActor): boolean {
    return this.config.mode !== 'instant' && this.config.controllerMode === 'human' && this.tick - this.controllerChangedAtTick >= 15 && actor.player.id === this.selectedPlayerId;
  }

  handleSelection(input: MatchCommand): void {
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
    if(canAutoSwitch && owner && owner.side!==this.controlledSide && selected && !candidate) {
      // Defending: when the controlled player is far from the carrier, take the team-mate best placed between ball and goal.
      const best=this.bestDefenderAgainst(owner);
      if(best && best.player.id!==selected.player.id && distance(selected,owner)>12 && distance(best,owner)<distance(selected,owner)-4) candidate=best;
    }
    if(candidate && candidate.player.id!==this.selectedPlayerId) {
      if(this.football.switchCandidate?.id!==candidate.player.id) this.football.switchCandidate={id:candidate.player.id,sinceTick:this.tick};
      if(this.tick-this.football.switchCandidate.sinceTick>=12) {
        this.selectedPlayerId=candidate.player.id;
        this.football.selectionUntilTick=this.tick+45;
        this.football.switchCandidate=null;
      }
    } else this.football.switchCandidate=null;
    if (len2(input.pickX, input.pickY) > 0.65 && len2(this.previousInput.pickX, this.previousInput.pickY) <= 0.65 && selected) {
      // Right stick flick: the team-mate in that direction from the current player.
      const dx = input.pickX * this.currentAttackDirection, dy = input.pickY, flick = len2(dx, dy);
      let pick: ArcadeActor | undefined;
      let pickScore = -Infinity;
      for (const mate of this.actors) {
        if (!mate.active || mate.side !== this.controlledSide || mate === selected || mate.player.positionGroup === 'GK') continue;
        const gap = distance(mate, selected);
        if (gap < 0.5 || gap > 45) continue;
        const alignment = ((mate.x - selected.x) * dx + (mate.y - selected.y) * dy) / (gap * flick);
        if (alignment < 0.5) continue;
        const score = alignment * 3 - gap * 0.04;
        if (score > pickScore) { pickScore = score; pick = mate; }
      }
      if (pick) {
        this.selectedPlayerId = pick.player.id;
        this.football.selectionUntilTick = this.tick + 90;
        this.football.switchCandidate = null;
      }
    }
    if (input.switchPlayer && !this.previousInput.switchPlayer) {
      this.football.selectionUntilTick = this.tick + 90;
      this.football.switchCandidate=null;
      const direction = len2(input.aimX, input.aimY);
      const candidates = this.actors
        .filter((actor) => actor.active && actor.side === this.controlledSide && actor.player.positionGroup !== 'GK')
        .map((actor) => {
          const dx = actor.x - this.ball.x;
          const dy = actor.y - this.ball.y;
          const directional = direction > 0.25 ? (dx * input.aimX * this.currentAttackDirection + dy * input.aimY) / Math.max(1, len2(dx, dy)) : 0;
          return { actor, score: this.interceptTime(actor) - directional * 0.22 };
        })
        .sort((a, b) => a.score - b.score)
        .slice(0, 3);
      const index = candidates.findIndex(({ actor }) => actor.player.id === this.selectedPlayerId);
      this.selectedPlayerId = candidates[(index + 1) % Math.max(1, candidates.length)]?.actor.player.id ?? this.selectedPlayerId;
    }
  }

  /** The outfield player of the controlled side who is best placed to meet this ball carrier: near, and goal-side. */
  bestDefenderAgainst(carrier: ArcadeActor): ArcadeActor | undefined {
    const ownGoalX = this.attackDirection(this.controlledSide) > 0 ? 0 : FIELD_LENGTH;
    let best: ArcadeActor | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const actor of this.actors) {
      if (!actor.active || actor.side !== this.controlledSide || actor.player.positionGroup === 'GK') continue;
      const goalSide = Math.abs(actor.x - carrier.x) < 1 || Math.sign(ownGoalX - carrier.x) === Math.sign(actor.x - carrier.x);
      const score = distance(actor, carrier) + (goalSide ? 0 : 6);
      if (score < bestScore) { bestScore = score; best = actor; }
    }
    return best;
  }

  moveControlled(actor: ArcadeActor, input: MatchCommand, dt: number): void {
    const worldX = input.moveX * this.currentAttackDirection;
    const carrier = this.owner();
    if (input.jockey && carrier && carrier.side !== actor.side) {
      // Contain: hold a goal-side position 1.9 m from the carrier, face the ball and give ground under control.
      const goalX = this.attackDirection(actor.side) > 0 ? 0 : FIELD_LENGTH;
      const gx = goalX - carrier.x, gy = FIELD_WIDTH / 2 - carrier.y, gl = len2(gx, gy) || 1;
      const holdX = carrier.x + gx / gl * 1.9, holdY = carrier.y + gy / gl * 1.9;
      const { facingX, facingY } = actor;
      this.moveActor(actor, worldX * 0.6 + (holdX - actor.x) * 0.9, input.moveY * 0.6 + (holdY - actor.y) * 0.9, false, dt, 0.78);
      // Side-steps and backward steps keep the body facing the ball.
      const facing = turnTowards(facingX, facingY, carrier.x - actor.x, carrier.y - actor.y, 12 * dt);
      actor.facingX = facing.x; actor.facingY = facing.y;
      this.setAction(actor, 'jockey');
      return;
    }
    // With the ball, the same button shields it: slower, but the carrier is much harder to tackle.
    const shielding = !!input.jockey && this.ball.ownerId === actor.player.id;
    this.moveActor(actor, worldX, input.moveY, input.sprint && !shielding, dt, shielding ? 0.62 : 1);
    const moving = len2(worldX, input.moveY) > 0.1;
    // A shielding carrier shows the wide, low stance of a defender with his back to the opponent.
    this.setAction(actor, shielding ? 'jockey' : !moving ? 'idle' : input.sprint ? 'sprint' : this.ball.ownerId === actor.player.id ? 'carry' : 'jog');
    if (input.skill && !this.previousInput.skill) this.performSkill(actor, worldX, input.moveY);
  }

  /** A kick, tackle or lunge plants the body: for a few ticks the player moves at a fraction of his speed. */
  startRecovery(actor: ArcadeActor, ticks: number): void {
    if (ticks <= 0) return;
    (this.football.recoveryUntil ??= {})[actor.player.id] = this.tick + ticks;
  }

  moveActor(actor: ArcadeActor, dx: number, dy: number, sprint: boolean, dt: number, speedScale = 1): void {
    const recoveringUntil = this.football.recoveryUntil?.[actor.player.id];
    if (recoveringUntil !== undefined && recoveringUntil > this.tick) speedScale *= T.recovery.speed;
    const previousX = actor.x;
    const previousY = actor.y;
    const magnitude = len2(dx, dy);
    const nx = magnitude > 0.001 ? dx / magnitude : 0;
    const ny = magnitude > 0.001 ? dy / magnitude : 0;
    const ownsBall = this.ball.ownerId === actor.player.id;
    const targetSpeed = magnitude > 0.05 ? this.maxSpeed(actor, sprint) * Math.min(1, magnitude) * speedScale : 0;
    const targetVx = nx * targetSpeed;
    const targetVy = ny * targetSpeed;
    const fitnessPenalty = actor.stamina < 40 ? 0.78 + actor.stamina * 0.0055 : 1;
    const attrs = actor.attrs!;
    const accelerationBase = ARCADE_MATCH_TUNING.acceleration * (0.88 + attrs.pace * 0.0012 + attrs.dribbling * 0.0005) * fitnessPenalty;
    const acceleration = (actor.stats!.hookMask & HOOK_BIT.acceleration) !== 0 ? this.hook(actor, HK.acceleration, accelerationBase) : accelerationBase;
    const braking = ARCADE_MATCH_TUNING.braking * (0.9 + attrs.dribbling * 0.0015);
    const counterSteering = actor.vx * targetVx + actor.vy * targetVy < 0;
    const rate = targetSpeed === 0 || counterSteering ? braking : acceleration;
    // Inline form of accelerateTowards: no temporary object for every player and tick.
    const changeX = targetVx - actor.vx;
    const changeY = targetVy - actor.vy;
    const changeLength = Math.sqrt(changeX * changeX + changeY * changeY);
    const budget = rate * dt;
    const scale = changeLength > budget ? budget / changeLength : 1;
    actor.vx += changeX * scale;
    actor.vy += changeY * scale;
    if (magnitude > 0.08) {
      // Momentum: the faster a player runs, the wider the turn.
      const speedRatio = clamp(len2(actor.vx, actor.vy) / ARCADE_MATCH_TUNING.sprintMax, 0, 1);
      const turnRate = (11 + attrs.dribbling / 24) * (1 - speedRatio * 0.4) * dt / (sprint ? 1.18 : 1);
      turnFacing(actor, nx, ny, turnRate);
    }
    actor.x = clamp(actor.x + actor.vx * dt, 0.8, FIELD_LENGTH - 0.8);
    actor.y = clamp(actor.y + actor.vy * dt, 0.8, FIELD_WIDTH - 0.8);
    actor.animationDistance += len2(actor.x - previousX, actor.y - previousY);
    const footballMinutes = dt * 90 / this.totalSeconds;
    const pressureCost = this.teamOf(actor.side).tactics.pressing === 'gegenpress' ? 0.16 : 0;
    // Endurance now matters: strong players tire slower, weak ones faster, and standing still recovers a little.
    const endurance = 1 + (50 - attrs.stamina) * 0.008;
    const resting = magnitude <= 0.1 && len2(actor.vx, actor.vy) < 1;
    const drainBase = resting ? -this.hook(actor, HK.staminaRecovery, 0.02 + attrs.stamina * 0.0006)
      : ((magnitude > 0.1 ? 0.2 : 0.06) + (sprint ? 0.56 : 0) + (ownsBall ? 0.05 : 0) + pressureCost) * endurance;
    const drain = drainBase > 0 && (actor.stats!.hookMask & HOOK_BIT.staminaDrain) !== 0 ? this.hook(actor, HK.staminaDrain, drainBase) : drainBase;
    actor.stamina = clamp(actor.stamina - footballMinutes * drain, 0, 100);
  }

  moveAi(actor: ArcadeActor, dt: number): void {
    if(actor.player.positionGroup==='GK') {
      const dive=keeperDiveTarget(actor,this.ball,this.activeShot,this.stat(actor,'goalkeeping'));
      if(dive) {
        this.setAction(actor,'keeper-dive');
        actor.actionTarget=dive;
      }
    }
    if(actor.player.positionGroup==='GK' && (actor.action==='keeper-dive'||actor.action==='keeper-catch'||actor.action==='keeper-parry') && actionIsPlaying(actor.action,actor.actionStartedTick,this.tick)) {
      const age=(this.tick-actor.actionStartedTick)/60;
      if(actor.action==='keeper-dive' && actor.actionTarget && age<.34) {
        // The dive really covers ground: a fast lateral push towards the target, faster for better keepers.
        const diveSpeed=5.2+this.stat(actor,'goalkeeping')/38;
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
    // A player who is closing the ball down keeps re-aiming at it every tick instead of running to a spot chosen up to half a second ago.
    if (actor.action === 'press' && this.ball.ownerId !== actor.player.id && this.aiLevel(actor.side) !== 'easy') {
      actor.intentX = clamp(this.ball.x + this.ball.vx * .22, 1, FIELD_LENGTH - 1);
      actor.intentY = clamp(this.ball.y + this.ball.vy * .22, 1, FIELD_WIDTH - 1);
    }
    const dx = actor.intentX - actor.x;
    const dy = actor.intentY - actor.y;
    // A carrier in open space sprints; before, the 8 m target ahead never reached the 14 m sprint threshold.
    const carrying = this.ball.ownerId === actor.player.id && actor.player.positionGroup !== 'GK';
    const openSpace = carrying && this.closestOpponent(actor) > 5.5;
    const sprint = (dx * dx + dy * dy > 14 * 14 && actor.stamina > 25) || (openSpace && actor.stamina > 35);
    this.moveActor(actor, dx, dy, sprint, dt);
    if(actor.player.positionGroup==='GK' && actor.action==='keeper-ready') {
      const facing=turnTowards(actor.facingX,actor.facingY,this.ball.x-actor.x,this.ball.y-actor.y,10*dt);
      actor.facingX=facing.x;actor.facingY=facing.y;
    }
    if (actor.action === 'formation' || actor.action === 'idle' || actor.action === 'jog' || actor.action === 'sprint') {
      this.setAction(actor, len2(actor.vx, actor.vy) < 0.15 ? 'idle' : sprint ? 'sprint' : 'jog');
    }
  }

  chooseAiIntent(actor: ArcadeActor): void { return chooseAiIntent(this, actor); }

  handleActions(input: MatchCommand, dt: number): void {
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
    const winding = this.football.pendingKick;
    if (winding && winding.actorId === actor.player.id && this.isHumanControlled(actor)) {
      // Inside the wind-up: the modifier cancels the kick (a shot becomes a feint), a second shoot press times the finish.
      if (input.modifier && !this.previousInput.modifier) this.cancelKick(actor);
      else if (winding.type === 'shoot' && !winding.timed && T.shot.timedFinish[this.config.assist] && input.shoot && !this.previousInput.shoot) {
        winding.timed = true;
        this.football.ignoreRelease = true;
      }
    }
    for (const kind of ['pass', 'through', 'lob', 'shoot'] as const) {
      if (defending) {
        // Tackles fire on the press itself: no release delay against a dribbler.
        if (input[kind] && !this.previousInput[kind]) this.attemptTackle(actor, kind === 'shoot' || kind === 'lob');
        this.actionHeld[kind] = 0;
        continue;
      }
      if (input[kind] || !this.previousInput[kind]) continue;
      if (kind === 'shoot' && this.football.ignoreRelease) {
        // The second press of a timed finish: its release is no new shot.
        this.football.ignoreRelease = false;
        this.actionHeld.shoot = 0;
        continue;
      }
      const modifier = input.modifier || this.previousInput.modifier;
      const action = {
        kind, expiresTick: this.tick + 11, power: this.charge(this.actionHeld[kind], kind === 'shoot' ? 0.9 : 0.8),
        aimX, aimY, chip: input.lob || this.previousInput.lob, finesse: input.skill || this.previousInput.skill, low: this.actionHeld.shoot < 0.14,
        sharp: modifier && (kind === 'pass' || kind === 'through'), feint: modifier && kind === 'shoot',
        // The screen is mirrored along the pitch when the side attacks from right to left, and with it the sense of the bend.
        curl: clamp(input.curl, -1, 1) * this.currentAttackDirection,
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

  executeFootballAction(actor: ArcadeActor, action: NonNullable<NonNullable<MatchCheckpoint['runtime']['football']>['queuedAction']>): void { return executeFootballAction(this, actor, action); }

  scheduleKick(actor: ArcadeActor, kick: Omit<PendingKick, 'actorId' | 'startTick' | 'contactTick'>, state: PlayerActionState): void { return scheduleKick(this, actor, kick, state); }

  processPendingKick(): void { return processPendingKick(this); }

  performKick(actor: ArcadeActor, kick: PendingKick): void { return performKick(this, actor, kick); }

  cancelKick(actor: ArcadeActor): void { return cancelKick(this, actor); }

  feint(actor: ArcadeActor): void { return feint(this, actor); }

  /** The "request run" button: the team-mate furthest forward near the ball sprints in behind the line for about two seconds. */
  requestRun(): void {
    const selected = this.actors.find((candidate) => candidate.player.id === this.selectedPlayerId && candidate.active);
    if (!selected) return;
    const direction = this.attackDirection(selected.side);
    let best: ArcadeActor | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const mate of this.actors) {
      if (!mate.active || mate.side !== selected.side || mate === selected || mate.player.positionGroup === 'GK' || mate.player.positionGroup === 'DEF') continue;
      const ahead = (mate.x - selected.x) * direction;
      if (ahead < -2) continue;
      const score = distance(mate, selected) * 0.55 - ahead * 0.5 - (mate.player.positionGroup === 'ATT' ? 4 : 0);
      if (score < bestScore) { bestScore = score; best = mate; }
    }
    if (!best) return;
    this.football.runRequest = { id: best.player.id, side: best.side, untilTick: this.tick + T.run.requestTicks };
    best.decisionCooldown = 0;
  }

  inCrossingZone(actor: ArcadeActor): boolean { return inCrossingZone(this, actor); }

  cross(actor: ArcadeActor, driven: boolean, power: number, aimX = 0, aimY = 0, curl = 0): boolean { return cross(this, actor, driven, power, aimX, aimY, curl); }

  crossRunner(actor: ArcadeActor, aimX: number, aimY: number): ArcadeActor | undefined { return crossRunner(this, actor, aimX, aimY); }

  registerPass(actor: ArcadeActor, target: ArcadeActor | undefined, teammates: readonly ArcadeActor[]): void { return registerPass(this, actor, target, teammates); }

  selectReceiver(receiver: ArcadeActor): void { return selectReceiver(this, receiver); }

  /** The flight a held lob or cross would take right now; null when nothing is being charged. Presentation only. */
  aimPreview(): FlightPath | null { return aimPreview(this); }

  /** Where a ball in the air comes down; null for a ball on the ground or at somebody's feet. Presentation only. */
  flightLanding(): FlightLanding | null { return flightLanding(this); }

  charge(value: number, maximum: number): number {
    return clamp(0.3 + value / maximum * 0.7, 0.3, 1);
  }

  pass(actor: ArcadeActor, through: boolean, lob: boolean, power: number, aimX: number, aimY: number, forced?: ArcadeActor, sharp = false, curl = 0): void { return pass(this, actor, through, lob, power, aimX, aimY, forced, sharp, curl); }

  shoot(actor: ArcadeActor, power: number, aimX: number, aimY: number, finesse: boolean, low: boolean, chip = false, driven = false, forceVolley = false, accuracy = 1): void { return shoot(this, actor, power, aimX, aimY, finesse, low, chip, driven, forceVolley, accuracy); }

  performSkill(actor: ArcadeActor, dx: number, dy: number): void { return performSkill(this, actor, dx, dy); }

  shotValue(actor: ArcadeActor): number { return shotValue(this, actor); }

  bestPassOption(actor: ArcadeActor, direction: 1 | -1): { target: ArcadeActor; value: number } | null { return bestPassOption(this, actor, direction); }

  betterPlacedTeammate(actor: ArcadeActor, ownValue: number): boolean { return betterPlacedTeammate(this, actor, ownValue); }

  tryAiSkill(actor: ArcadeActor, pressureDistance: number): boolean { return tryAiSkill(this, actor, pressureDistance); }

  curlSign(actor: ArcadeActor, targetY: number): number { return curlSign(this, actor, targetY); }

  releaseBall(actor: ArcadeActor, vx: number, vy: number, vz: number, spin: number, topspin = 0, recoveryTicks = 7): void { return releaseBall(this, actor, vx, vy, vz, spin, topspin, recoveryTicks); }

  resolvePressureTackles(dt: number): void { return resolvePressureTackles(this, dt); }

  attemptTackle(actor: ArcadeActor, sliding: boolean): void { return attemptTackle(this, actor, sliding); }

  callFoul(defender: ArcadeActor, victim: ArcadeActor, sliding: boolean, speed: number): void { return callFoul(this, defender, victim, sliding, speed); }

  jumpWall(kicker: ArcadeActor): void { return jumpWall(this, kicker); }

  /** Strength 0..1 of the duo bond between two players of the same side, 0 when they are no partners. */
  partnerStrength(a: ArcadeActor, b: ArcadeActor): number {
    if (a.side !== b.side) return 0;
    const link = this.teamOf(a.side).partners?.[a.player.id];
    return link && link.partnerId === b.player.id ? link.strength : 0;
  }

  applyPendingCards(): void { return applyPendingCards(this); }

  dribbleFoot(actor: ArcadeActor): 'left' | 'right' { return dribbleFoot(this, actor); }

  /** Changes a live match rating, for players who have one (those who took part). */
  adjustRating(playerId: string, delta: number): void {
    const current = this.ratings[playerId];
    if (current !== undefined) this.ratings[playerId] = clamp(current + delta, 1, 10);
  }

  /** A goal against marks the keeper most, the defenders a little, the midfield hardly. */
  penaliseConceding(side: Side): void {
    for (const actor of this.actors) {
      if (!actor.active || actor.side !== side) continue;
      this.adjustRating(actor.player.id, actor.player.positionGroup === 'GK' ? -0.3 : actor.player.positionGroup === 'DEF' ? -0.12 : actor.player.positionGroup === 'MID' ? -0.05 : 0);
    }
  }

  updateBall(dt: number): void {
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
      const speed = len2(owner.vx, owner.vy);
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
          owner.contact = { tick: this.tick, x: this.ball.x, y: this.ball.y, z: this.ball.z, kind: 'foot', foot: this.dribbleFoot(owner), dribble: true };
          this.ball.lastTouch = owner.side;
          this.ball.lastTouchPlayerId = owner.player.id;
        }
      }
    }
    // At most 8 cm per substep: even a full-power shot cannot tunnel through a post.
    const count = Math.max(1, Math.ceil(len3(this.ball.vx, this.ball.vy, this.ball.vz) * dt / 0.08));
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
    if (!this.ball.ownerId && !this.tryAerialStrike()) this.tryBallControl();
  }

  handlePostsAndKeeper(): void { return handlePostsAndKeeper(this); }

  blockShot(): boolean { return blockShot(this); }

  ballInPenaltyAreaOf(side: Side): boolean {
    const goalDistance = this.attackDirection(side) > 0 ? this.ball.x : FIELD_LENGTH - this.ball.x;
    return goalDistance <= PITCH.penaltyDepth + BALL_RADIUS && Math.abs(this.ball.y - FIELD_WIDTH / 2) <= PITCH.penaltyHalfWidth + BALL_RADIUS;
  }

  keeperReach(keeper: ArcadeActor): number { return keeperReach(this, keeper); }

  inOwnPenaltyArea(actor: ArcadeActor): boolean {
    const goalDistance = this.attackDirection(actor.side) > 0 ? actor.x : FIELD_LENGTH - actor.x;
    return goalDistance <= PITCH.penaltyDepth && Math.abs(actor.y - FIELD_WIDTH / 2) <= PITCH.penaltyHalfWidth;
  }

  handleBoundary(): boolean { return handleBoundary(this); }

  /** A stable per-tick pseudo-random rank used to settle exact ties between players. */
  /** Dive or scissor kick: the body flies on its committed line, then lies still until the action is over. */
  committedMove(actor: ArcadeActor, dt: number): void {
    const age = this.tick - actor.actionStartedTick;
    const flight = ACTION_CONTACT_TICKS[actor.action] ?? 0;
    if (age < flight + 6) {
      actor.x = clamp(actor.x + actor.vx * dt, 0.8, FIELD_LENGTH - 0.8);
      actor.y = clamp(actor.y + actor.vy * dt, 0.8, FIELD_WIDTH - 0.8);
      actor.animationDistance += len2(actor.vx, actor.vy) * dt;
      if (age >= flight) { actor.vx *= 0.9; actor.vy *= 0.9; }
    } else this.moveActor(actor, 0, 0, false, dt);
  }

  tieOrder(actor: ArcadeActor): number { return tieOrder(this, actor); }

  tryBallControl(): void { return tryBallControl(this); }

  tryHeader(): void { return tryHeader(this); }

  headAtGoal(actor: ArcadeActor, aimInput: number, errorScale = 1, speedBonus = 0, action: PlayerActionState = 'header'): void { return headAtGoal(this, actor, aimInput, errorScale, speedBonus, action); }

  predictBall(at: readonly number[]): Point[] { return predictBall(this, at); }

  tryAerialStrike(): boolean { return tryAerialStrike(this); }

  strikeAerial(actor: ArcadeActor, kick: PendingKick): void { return strikeAerial(this, actor, kick); }

  defensiveHeader(actor: ArcadeActor, attackingGoalDistance: number): void { return defensiveHeader(this, actor, attackingGoalDistance); }

  scoreGoal(side: Side): void {
    if (!this.activeShot) {
      const stats = this.stats(side);
      stats.shots++;
      stats.shotsOnTarget++;
      stats.xG = round(stats.xG + 0.04, 2);
    }
    if (side === 'home') this.homeScore++;
    else this.awayScore++;
    this.addFocus(side, 8);
    this.addStoppage(0.7);
    const lastToucher = this.actors.find((actor) => actor.player.id === this.ball.lastTouchPlayerId);
    // A deflection or clearance into the own net is an own goal: no goal credit, a rating penalty.
    const ownGoal = !!lastToucher && lastToucher.side !== side;
    const scorer = ownGoal ? undefined : lastToucher;
    if (scorer) {
      this.recordSignatureGoal(scorer);
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
    this.penaliseConceding(this.opposite(side));
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

  setRestart(phase: RuleState['phase'], side: Side, x: number, y: number, indirect = false): void { return setRestart(this, phase, side, x, y, indirect); }

  updateAdvantage(dt: number): void { return updateAdvantage(this, dt); }

  updateRestart(dt: number, input: MatchCommand): void { return updateRestart(this, dt, input); }

  arrangeRestart(taker: ArcadeActor): void {
    arrangeRestart(taker, this.rule, this.ball, this.actors, actor => this.attackDirection(actor.side));
    if (taker.side === this.controlledSide && !this.config.playerLockId) this.selectedPlayerId = taker.player.id;
  }

  /** The side the player does not manage (and, in instant simulation, both) changes injured and exhausted players at stoppages. */
  autoSubstitutions(): void {
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
  coverSentOffPlayer(sentOff: ArcadeActor): void {
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
  penaltyComposure(taker: ArcadeActor): number {
    return clamp(1.25 - this.statWith(taker, 'shooting', Cond.penalty) / 200, 0.7, 1.1);
  }

  keeperGuessesPenalty(shootingSide: Side): void { return keeperGuessesPenalty(this, shootingSide); }

  legalRestartTouch(actor: ArcadeActor): boolean { return legalRestartTouch(this, actor); }

  resetKickoff(side: Side): void { return resetKickoff(this, side); }

  extraPeriodOver(periodStart: number): boolean {
    const end = periodStart + this.totalSeconds / 6;
    if (this.elapsed < end) return false;
    return (!this.activeShot && Math.abs(this.ball.x - FIELD_LENGTH / 2) < 22) || this.elapsed >= end + 8;
  }

  startExtraTime(): void {
    this.football.extra = { period: 1, periodStart: this.elapsed };
    this.phase = 'halftime';
    this.paused = true;
    this.rule = this.newRule('halftime', null, this.ball.x, this.ball.y);
    this.events.push({ minute: 90, type: 'commentary', side: null, playerId: null, messageKey: 'match.extraTime', params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore } });
  }

  changeEndsInExtraTime(): void {
    this.football.extra = { period: 2, periodStart: this.elapsed };
    this.rebaseFormation();
    this.resetKickoff('away');
    this.events.push({ minute: 105, type: 'commentary', side: null, playerId: null, messageKey: 'match.extraTimeHalf' });
  }

  /**
   * Penalties after a drawn knockout tie: five each in alternation (decided early when out of reach),
   * then sudden death. Conversion depends on the taker, the "Ice in the Veins" trait and the keeper.
   */
  /** Hands a drawn knockout tie to the shoot-out: interactive for a human manager, automatic otherwise. */
  shootoutHost(): ShootoutHost {
    return {
      controlledSide: this.controlledSide,
      rng: this.rng,
      actors: this.actors,
      events: this.events,
      shooting: (actor) => this.statWith(actor, 'shooting', Cond.penalty),
      goalkeeping: (actor) => this.stat(actor, 'goalkeeping'),
      shortName: (side) => this.teamOf(side).shortName,
      complete: (shootout) => {
        this.shootout = shootout;
        this.shootoutRun = null;
        this.finish();
      },
    };
  }

  /**
   * Starts a shoot-out the managing human plays kick by kick (shoot: aim and power, defend: pick a corner
   * to dive to). Returns false when the match should resolve it automatically instead.
   */
  beginInteractiveShootout(): boolean {
    if (this.config.mode !== 'play' || this.config.controllerMode !== 'human' || this.config.interactiveShootout === false) return false;
    this.shootoutRun = new ShootoutSession(this.shootoutHost());
    this.paused = true;
    return true;
  }

  /** What the player has to decide right now, or null when no interactive shoot-out is running. */
  get shootoutPrompt(): ShootoutPrompt | null {
    return this.shootoutRun?.prompt ?? null;
  }

  /**
   * Plays the next kick. As the shooter the human passes aim and power, as the keeper only `dive`;
   * the other side is decided by the AI. Returns the outcome, or null when nothing is pending.
   */
  playShootoutKick(choice: { aim?: Aim; power?: boolean; dive?: Aim }): (KickOutcome & { side: Side; takerId: string }) | null {
    return this.shootoutRun?.play(choice) ?? null;
  }

  /** The automatic shoot-out: every kick is a roll against the taker's and the keeper's ratings. */
  resolveShootout(): void {
    this.shootout = new ShootoutSession(this.shootoutHost()).resolveAutomatically();
  }

  enterHalftime(): void {
    (this.football.stoppage ??= { added: [0, 0], overrun: 0 }).overrun = this.elapsed - this.totalSeconds / 2;
    this.halftimeReached = true;
    this.phase = 'halftime';
    this.paused = true;
    this.rule = this.newRule('halftime', null, this.ball.x, this.ball.y);
    this.events.push({ minute: 45, type: 'halftime', side: null, playerId: null, messageKey: 'match.halftime', params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore } });
  }

  rebaseFormation(): void {
    for (const actor of this.actors) {
      actor.homeX = FIELD_LENGTH - actor.homeX;
      actor.facingX *= -1;
    }
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.paused = true;
    this.elapsed = this.totalSeconds;
    this.phase = 'fulltime';
    this.rule = this.newRule('fulltime', null, this.ball.x, this.ball.y);
    this.events.push({ minute: 90, type: 'fulltime', side: null, playerId: null, messageKey: 'match.fulltime', params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore } });
    // A clean sheet is worth something to the keeper and the back line.
    for (const side of ['home', 'away'] as const) {
      if ((side === 'home' ? this.awayScore : this.homeScore) !== 0) continue;
      for (const actor of this.actors) {
        if (actor.side !== side) continue;
        this.adjustRating(actor.player.id, actor.player.positionGroup === 'GK' ? 0.4 : actor.player.positionGroup === 'DEF' ? 0.25 : 0);
      }
    }
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
      ...(this.signatureStats.size ? { signatures: [...this.signatureStats.values()].map((entry) => ({ ...entry, xG: round(entry.xG, 2) })) } : {}),
    };
  }

  finishStats(stats: TeamMatchStats, side: Side): TeamMatchStats {
    stats.passesAttempted = this.passAttempts[side];
    stats.passesCompleted = this.passCompletions[side];
    stats.passAccuracy = stats.passesAttempted ? clamp(Math.round(stats.passesCompleted / stats.passesAttempted * 100), 0, 100) : 0;
    return { ...stats };
  }

  recordTelemetry(): void {
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
        // Stored in attack-right space, so both halves land on the same end of the heatmap.
        const forward = this.attackDirection(actor.side) > 0;
        const x = forward ? actor.x : FIELD_LENGTH - actor.x, y = forward ? actor.y : FIELD_WIDTH - actor.y;
        const list = this.heatmaps[actor.player.id] ?? (this.heatmaps[actor.player.id] = []);
        const cell = list.find((point) => Math.abs(point.x - x) < 5 && Math.abs(point.y - y) < 5);
        if (cell) cell.weight++;
        else if (list.length < 48) list.push({ x: round(x, 1), y: round(y, 1), weight: 1 });
      }
    }
    if (this.config.mode !== 'instant' && this.tick % 30 === 0) this.safeSnapshot = this.snapshotInto(this.safeSnapshot);
  }

  updatePossessionStats(dt: number): void {
    const owner = this.owner();
    if (owner) {
      const previousSide = this.lastOwnerSide;
      if (previousSide && previousSide !== owner.side) {
        this.possessionGainedTick[owner.side] = this.tick;
        if (this.anySignatureEvents) {
          this.fireSignature('ballWon', owner, null);
          this.fireSignature('ballLost', null, previousSide);
        }
      } else if (this.anySignatureEvents && previousSide === owner.side && owner.player.id !== this.lastOwnerId) {
        this.fireSignature('passReceived', owner, null);
      }
      this.lastOwnerSide = owner.side;
      this.lastOwnerId = owner.player.id;
    }
    if (owner?.side === 'home') this.possessionHomeSeconds += dt;
    else if (owner?.side === 'away') this.possessionAwaySeconds += dt;
    const total = this.possessionHomeSeconds + this.possessionAwaySeconds || 1;
    this.homeStats.possession = Math.round(this.possessionHomeSeconds / total * 100);
    this.awayStats.possession = 100 - this.homeStats.possession;
  }

  resolvePlayerCollisions(): void {
    this.collisions.resolve(this.actors);
  }

  /**
   * Five-a-side boards: the ball rebounds from the side boards and from the end boards next to the
   * goal, so it never leaves play except into the net. Returns true when it bounced.
   */
  bounceOffBoards(): boolean {
    const ball = this.ball;
    let bounced = false;
    if (ball.y < BALL_RADIUS || ball.y > FIELD_WIDTH - BALL_RADIUS) {
      ball.y = clamp(ball.y, BALL_RADIUS, FIELD_WIDTH - BALL_RADIUS);
      ball.vy = -ball.vy * 0.62;
      ball.vx *= 0.9;
      bounced = true;
    }
    const inMouth = Math.abs(ball.y - FIELD_WIDTH / 2) <= GOAL_WIDTH / 2 - BALL_RADIUS && ball.z <= GOAL_HEIGHT - BALL_RADIUS;
    if (!inMouth && (ball.x < BALL_RADIUS || ball.x > FIELD_LENGTH - BALL_RADIUS)) {
      ball.x = clamp(ball.x, BALL_RADIUS, FIELD_LENGTH - BALL_RADIUS);
      ball.vx = -ball.vx * 0.62;
      ball.vy *= 0.9;
      bounced = true;
    }
    if (bounced) {
      ball.ownerId = null;
      this.activeShot = null;
    }
    return bounced;
  }

  isOffside(target: ArcadeActor, passer: ArcadeActor): boolean {
    if (this.config.smallSided) return false;
    return isOffsidePosition(target, passer, this.actors, this.attackDirection(passer.side));
  }

  passLanePressure(from: ArcadeActor, to: ArcadeActor): number {
    return passLanePressure(from, to, this.actors);
  }

  validateState(): void {
    if (this.tick % 15 !== 0) return;
    if (this.isFiniteState()) return;
    this.applySnapshot(this.safeSnapshot);
    this.events.push({ minute: this.footballMinute, type: 'commentary', side: null, playerId: null, text: 'Simulation recovered from an invalid state.' });
    this.paused = true;
    this.phase = 'paused';
  }

  isFiniteState(): boolean {
    if (![this.ball.x, this.ball.y, this.ball.z, this.ball.vx, this.ball.vy, this.ball.vz].every(Number.isFinite)) return false;
    for (const actor of this.actors) {
      if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y) || !Number.isFinite(actor.vx) || !Number.isFinite(actor.vy) || !Number.isFinite(actor.stamina)) return false;
    }
    return true;
  }

  applySnapshot(snapshot: MatchSnapshot): void {
    this.teleportEpoch++;
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

  actorSnapshot(actor: ArcadeActor): PlayerRuntimeSnapshot {
    return actorSnapshot(actor);
  }

  applyActorSnapshot(actor: ArcadeActor, saved: PlayerRuntimeSnapshot): void {
    applyActorSnapshot(actor, saved, this.tick);
  }

  ballSnapshot(): BallSnapshot {
    return ballSnapshot(this.ball);
  }

  newRule(phase: RuleState['phase'], restartSide: Side | null, spotX: number, spotY: number, indirect = false): RuleState {
    return { phase, restartSide, spotX, spotY, elapsed: 0, indirect, advantageSide: null, pendingCardPlayerId: null };
  }

  setAction(actor: ArcadeActor, action: PlayerActionState, restart = false): void {
    if (!restart) {
      if (isLocomotionAction(action) && actionIsPlaying(actor.action, actor.actionStartedTick, this.tick)) return;
      if (actor.action === action) return;
    }
    actor.actionTarget=undefined;
    actor.action = action;
    actor.actionStartedTick = this.tick;
  }

  maxSpeed(actor: ArcadeActor, sprint: boolean): number {
    const pace = arcadeSprintSpeed(actor.attrs!.pace);
    const base = (actor.stats!.hookMask & HOOK_BIT.sprintBurst) !== 0 ? this.hook(actor, HK.sprintBurst, pace) : pace;
    const fitness = actor.stamina < 40 ? 0.82 + actor.stamina * 0.0045 : 1;
    const ownsBall = this.ball.ownerId === actor.player.id;
    // A carrier at full tilt gives up 10-15 % of his speed, less with better dribbling (it used to be a flat 9 %).
    const ball = ownsBall ? sprint ? 0.8 + clamp(actor.attrs!.dribbling, 0, 100) / 100 * 0.1 : ARCADE_MATCH_TUNING.ballJogRatio : 1;
    const injured = this.football.injuredIds?.length && this.isInjured(actor.player.id) ? 0.6 : 1;
    return base * fitness * ball * injured * (sprint ? 1 : ARCADE_MATCH_TUNING.jogRatio);
  }

  owner(): ArcadeActor | undefined {
    // Called many times per tick; the last owner is remembered and only looked up again when it changes.
    const ownerId = this.ball.ownerId;
    if (!ownerId) return undefined;
    const cached = this.ownerCache;
    if (cached && cached.active && cached.player.id === ownerId) return cached;
    this.ownerCache = this.actors.find((actor) => actor.active && actor.player.id === ownerId);
    return this.ownerCache;
  }

  /** Difficulty tunes the opponent only; the player's own AI teammates always play at the normal level. */
  /** Error multiplier: below 1 for the home side. */
  composure(side: Side): number {
    return side === 'home' ? 1 - ARCADE_MATCH_TUNING.homeComposure : 1;
  }

  aiLevel(side: Side): Difficulty {
    return side === this.controlledSide ? this.config.teammateAi ?? 'normal' : this.config.difficulty;
  }

  teamOf(side: Side): Team {
    return side === 'home' ? this.home : this.away;
  }

  stats(side: Side): TeamMatchStats {
    return side === 'home' ? this.homeStats : this.awayStats;
  }

  opposite(side: Side): Side {
    return oppositeSide(side);
  }

  sideAttackingDirection(direction: 1 | -1): Side {
    return this.attackDirection('home') === direction ? 'home' : 'away';
  }

  /**
   * Keeps the resolved attribute view, hook factors and signature state of an actor current. Situations last
   * for seconds, so each player re-reads them only every sixth tick (100 ms, staggered by slot).
   */
  refreshActorState(actor: ArcadeActor, slot: number, owner: ArcadeActor | undefined): void {
    // Every change of `actor.player` goes through initAttrs, so the block is always current here.
    const block = actor.stats!;
    if (!block.hasMods) {
      if (actor.attrs !== block.base) actor.attrs = block.base;
      return;
    }
    if (actor.attrs !== undefined && actor.attrs === actor.attrBuffer && (this.tick + slot) % 6 !== 0) return;
    if (this.sideFlagsTick !== this.tick) {
      this.sideFlagsTick = this.tick;
      this.sideFlagsThisTick(owner, this.sideFlagsValue);
    }
    let flags = this.actorFlags(actor, this.sideFlagsValue[actor.side === 'home' ? 0 : 1], owner);
    if (actor.sig) flags = this.updateSignatures(actor, flags);
    // Only the flags some modifier looks at can change a value, so other changes cost nothing.
    const changed = ((flags ^ (actor.flags ?? 0)) & block.flagMask) !== 0;
    actor.flags = flags;
    if (changed || actor.attrs === undefined || actor.attrs !== actor.attrBuffer) {
      actor.attrs = refreshAttributes(block, flags, actor.attrBuffer ??= newAttributes(block.base));
      if (actor.hookAdd) refreshHooks(block, flags, actor.hookAdd, actor.hookMul!);
    }
  }

  /** Puts the effect pipeline back exactly as it was, so a resumed match plays on identically. */
  restoreEffects(effects: MatchCheckpoint['runtime']['effects']): void {
    this.sideFlagsTick = -1;
    if (!effects) return;
    Object.assign(this.possessionGainedTick, effects.possessionGainedTick);
    this.lastOwnerSide = effects.lastOwnerSide;
    this.lastOwnerId = effects.lastOwnerId;
    this.sharedFlags = effects.sharedFlags;
    this.sharedFlagsTick = effects.sharedFlagsTick;
    if (effects.focus) Object.assign(this.focus, effects.focus);
    if (effects.ultimateUntil) Object.assign(this.ultimateUntil, effects.ultimateUntil);
    if (effects.ultimateUser) Object.assign(this.ultimateUser, effects.ultimateUser);
    for (const actor of this.actors) {
      const saved = effects.actors[actor.player.id];
      if (!saved) continue;
      actor.flags = saved.flags;
      this.initAttrs(actor);
      actor.sig?.forEach((runtime, index) => { if (saved.sig[index]) Object.assign(runtime, saved.sig[index]); });
    }
    this.signatureStats.clear();
    for (const entry of effects.signatureStats) this.signatureStats.set(`${entry.playerId}|${entry.signatureId}`, structuredClone(entry));
  }

  /** Adds to a side's focus meter; only sides with a Mythic player on the pitch collect it. */
  addFocus(side: Side, amount: number): void {
    if (!this.mythicSide[side] || !this.effectsEnabled) return;
    this.focus[side] = Math.min(ULTIMATE_COST, this.focus[side] + amount);
  }

  /** The Mythic player of a side who carries the ultimate (the best one if there are several). */
  mythicUser(side: Side): ArcadeActor | undefined {
    let best: ArcadeActor | undefined;
    for (const actor of this.actors) {
      if (!actor.active || actor.side !== side || actor.player.dna?.rarity !== 'mythic' || !actor.sig) continue;
      if (!best || actor.player.overall > best.player.overall) best = actor;
    }
    return best;
  }

  canTriggerUltimate(side: Side): boolean {
    return this.effectsEnabled && this.focus[side] >= ULTIMATE_COST && this.tick >= this.ultimateUntil[side] && !!this.mythicUser(side);
  }

  /** Whole seconds until a restart the human has to take is kicked automatically; 0 when none is waiting. */
  get restartCountdown(): number {
    const waiting = this.rule.phase !== 'playing' && this.rule.phase !== 'advantage' && this.rule.phase !== 'halftime' && this.rule.phase !== 'fulltime'
      && this.rule.restartSide === this.controlledSide && this.config.controllerMode === 'human' && !this.scenarioActive && !this.football.queuedAction;
    return waiting ? Math.max(0, Math.ceil(T.restart.autoSeconds - this.rule.elapsed)) : 0;
  }

  hasUltimate(side: Side): boolean {
    return this.effectsEnabled && this.mythicSide[side];
  }

  /** Spends the full focus meter: both signatures of the Mythic player run for six seconds with a bonus on top. */
  triggerUltimate(side: Side): boolean {
    if (!this.canTriggerUltimate(side)) return false;
    const user = this.mythicUser(side)!;
    this.focus[side] = 0;
    this.ultimateUntil[side] = this.tick + ULTIMATE_SECONDS * 60;
    this.ultimateUser[side] = user.player.id;
    const entry = this.signatureStats.get(`${user.player.id}|ultimate`) ?? { playerId: user.player.id, playerName: playerName(user.player), side, signatureId: 'ultimate', name: ['Ultimate', 'Ultimate'] as [string, string], activations: 0, shots: 0, xG: 0, goals: 0 };
    entry.activations++;
    this.signatureStats.set(`${user.player.id}|ultimate`, entry);
    if (this.config.mode !== 'instant') {
      this.events.push({ minute: this.footballMinute, type: 'commentary', side, playerId: user.player.id, messageKey: 'match.ultimate', params: { player: playerName(user.player) } });
    }
    return true;
  }

  /** AI sides fire the ultimate when it counts: the Mythic player attacking in the opposing half, or a deep defence under pressure. */
  aiUltimate(): void {
    const owner = this.owner();
    for (const side of ['home', 'away'] as const) {
      if (!this.mythicSide[side] || (side === this.controlledSide && this.config.controllerMode === 'human')) continue;
      if (!this.canTriggerUltimate(side)) continue;
      const user = this.mythicUser(side)!;
      const fromOwnGoal = this.attackDirection(side) > 0 ? this.ball.x : FIELD_LENGTH - this.ball.x;
      const attacking = owner === user && fromOwnGoal > FIELD_LENGTH * 0.55;
      const defending = owner !== undefined && owner.side !== side && fromOwnGoal < FIELD_LENGTH * 0.3;
      if (attacking || defending) this.triggerUltimate(side);
    }
  }

  /** Wakes and puts to sleep the signatures of an actor; returns the flags with the awake bits added. */
  updateSignatures(actor: ArcadeActor, base: number): number {
    let flags = base;
    const list = actor.sig!;
    const ultimate = this.ultimateUntil[actor.side] > this.tick && this.ultimateUser[actor.side] === actor.player.id;
    if (ultimate) flags |= Cond.ultimate;
    for (let index = 0; index < list.length; index++) {
      const runtime = list[index];
      let awake: boolean;
      if (ultimate) awake = true;
      else if (runtime.isCondition) {
        awake = false;
        const masks = runtime.masks;
        for (let m = 0; m < masks.length; m++) if ((base & masks[m]) === masks[m]) { awake = true; break; }
        // A condition may flicker; it counts (and is announced) at most every 15 seconds.
        if (awake && !runtime.awake && this.tick >= runtime.readyAt) {
          runtime.readyAt = this.tick + 900;
          this.wakeSignature(actor, runtime);
        }
      } else awake = this.tick < runtime.until;
      runtime.awake = awake;
      if (awake) flags |= signatureBit(runtime.slot);
    }
    return flags;
  }

  /** An event happened: wakes the matching signatures of one player (`target`) or of a whole side. */
  fireSignature(event: SigEvent, target: ArcadeActor | null, side: Side | null): void {
    for (const actor of this.actors) {
      if (!actor.sig || !actor.active) continue;
      if (target ? actor !== target : actor.side !== side) continue;
      for (const runtime of actor.sig) {
        const trigger = runtime.definition.trigger;
        if (trigger.kind !== 'event' || trigger.event !== event || this.tick < runtime.readyAt) continue;
        if (trigger.requires && !condMatches(actor.flags ?? 0, trigger.requires)) continue;
        runtime.until = this.tick + Math.round(runtime.seconds * 60);
        runtime.readyAt = this.tick + Math.round(runtime.cooldown * 60);
        this.wakeSignature(actor, runtime);
      }
    }
  }

  wakeSignature(actor: ArcadeActor, runtime: SignatureRuntime): void {
    const entry = this.signatureEntry(actor, runtime);
    entry.activations++;
    const refill = runtime.definition.restoresStamina;
    if (refill && !runtime.refilled) {
      runtime.refilled = true;
      actor.stamina = Math.min(100, actor.stamina + refill);
    }
    if (this.config.mode === 'instant') return;
    this.events.push({
      minute: this.footballMinute, type: 'commentary', side: actor.side, playerId: actor.player.id, messageKey: 'match.signature',
      params: { player: playerName(actor.player), nameDe: runtime.state.name[0], nameEn: runtime.state.name[1] },
    });
  }

  signatureEntry(actor: ArcadeActor, runtime: SignatureRuntime): SignatureReport {
    const key = `${actor.player.id}|${runtime.state.id}`;
    let entry = this.signatureStats.get(key);
    if (!entry) {
      entry = { playerId: actor.player.id, playerName: playerName(actor.player), side: actor.side, signatureId: runtime.state.id, name: runtime.state.name, activations: 0, shots: 0, xG: 0, goals: 0 };
      this.signatureStats.set(key, entry);
    }
    return entry;
  }

  /** A shot: credits awake signatures of the shooter and wakes the defenders' reactions. */
  registerShotForSignatures(shooter: ArcadeActor, xG: number): void {
    this.addFocus(shooter.side, 2);
    if (shooter.sig) for (const runtime of shooter.sig) {
      if (!runtime.awake) continue;
      const entry = this.signatureEntry(shooter, runtime);
      entry.shots++;
      entry.xG += xG;
    }
    if (!this.anySignatureEvents) return;
    const defending = oppositeSide(shooter.side);
    this.fireSignature('shotAgainst', null, defending);
    if (xG > 0.3) this.fireSignature('bigChanceAgainst', null, defending);
  }

  recordSignatureGoal(scorer: ArcadeActor): void {
    if (!scorer.sig) return;
    for (const runtime of scorer.sig) if (runtime.awake) this.signatureEntry(scorer, runtime).goals++;
  }

  get effectsEnabled(): boolean {
    return this.config.effects !== false;
  }

  /** An attribute as it plays in this very moment: traits, talents, form, morale and position included. */
  stat(actor: ArcadeActor, key: AttributeKey): number {
    // The tick refresh keeps `attrs` current, so reading a value is a plain lookup.
    return actor.attrs![key];
  }

  /** An attribute under extra situation flags (a penalty, a dead ball) on top of the actor's own. */
  statWith(actor: ArcadeActor, key: AttributeKey, extraFlags: number): number {
    return resolveAttribute(this.statsOf(actor), key, (actor.flags ?? 0) | this.ambientFlags | extraFlags);
  }

  /** Builds the stat view of an actor whose player just changed (kick-off, substitution, restore). */
  initAttrs(actor: ArcadeActor): void {
    actor.stats = undefined;
    actor.attrBuffer = undefined;
    const block = this.statsOf(actor);
    actor.attrs = block.hasMods ? refreshAttributes(block, actor.flags ?? 0, actor.attrBuffer = newAttributes(block.base)) : block.base;
    if (block.hasHookMods) {
      actor.hookAdd = new Float64Array(HOOK_COUNT);
      actor.hookMul = new Float64Array(HOOK_COUNT).fill(1);
      refreshHooks(block, actor.flags ?? 0, actor.hookAdd, actor.hookMul);
    } else {
      actor.hookAdd = undefined;
      actor.hookMul = undefined;
    }
    const runtimes = this.effectsEnabled ? createRuntimes(actor.player.dna) : [];
    actor.sig = runtimes.length ? runtimes : undefined;
    if (runtimes.some((runtime) => runtime.definition.trigger.kind === 'event')) this.anySignatureEvents = true;
    this.mythicSide.home = this.actors.some((candidate) => candidate.active && candidate.side === 'home' && candidate.player.dna?.rarity === 'mythic');
    this.mythicSide.away = this.actors.some((candidate) => candidate.active && candidate.side === 'away' && candidate.player.dna?.rarity === 'mythic');
  }

  /** Re-resolves the actor's view for the flags of the moment, plus `extra` for the duration of a dead-ball kick. */
  applyKickFlags(actor: ArcadeActor, extra: number): void {
    const block = this.statsOf(actor);
    if (!block.hasMods) return;
    const flags = (actor.flags ?? 0) | extra;
    actor.attrs = refreshAttributes(block, flags, actor.attrBuffer ??= newAttributes(block.base));
    if (actor.hookAdd) refreshHooks(block, flags, actor.hookAdd, actor.hookMul!);
  }

  /** A derived engine value (error rate, chance, rate) after modifiers; a no-op until something targets the hook. */
  /** Injury risk is an off-pitch hook without cached factors, so it is resolved directly for the rare contact injury. */
  injuryChance(victim: ArcadeActor, base: number): number {
    if ((victim.stats!.hookMask & HOOK_BIT.injuryRisk) === 0) return base;
    return resolveHook(this.statsOf(victim), 'injuryRisk', base, (victim.flags ?? 0) | this.ambientFlags);
  }

  hook(actor: ArcadeActor, hook: number, base: number, extraFlags = 0): number {
    if (((actor.stats!.hookMask >>> hook) & 1) === 0) return base;
    if (extraFlags !== 0) return resolveHook(this.statsOf(actor), hookName(hook), base, (actor.flags ?? 0) | this.ambientFlags | extraFlags);
    // The cache follows the actor's flags (and a dead-ball kick's), so this is a multiply-add.
    return (base + actor.hookAdd![hook]) * actor.hookMul![hook];
  }

  statsOf(actor: ArcadeActor): StatBlock {
    let block = actor.stats;
    if (!block || block.playerId !== actor.player.id) {
      block = actor.stats = this.effectsEnabled
        ? buildStatBlock(actor.player, { slotPosition: actor.slotPosition })
        : rawStatBlock(actor.player);
    }
    return block;
  }

  /** Flags that are the same for every player of a side this tick: score, clock, weather, possession. */
  sideFlagsThisTick(owner: ArcadeActor | undefined, result: [number, number]): [number, number] {
    // The clock and the weather change slowly: the shared part is rebuilt once a second.
    if (this.tick % 60 === 0 || this.sharedFlagsTick < 0) {
      this.sharedFlagsTick = this.tick;
      let shared = 0;
      if (this.footballMinute >= 75) shared |= Cond.late;
      if (this.inExtraTime) shared |= Cond.extraTime;
      if (this.config.weather === 'rain' || this.config.weather === 'snow') shared |= Cond.rain;
      else if (this.config.weather === 'storm') shared |= Cond.storm | Cond.rain;
      else shared |= Cond.clear;
      if (this.home.visuals?.stadium?.atmosphere === 'night') shared |= Cond.night;
      if (this.config.derby) shared |= Cond.derby;
      if (this.config.bigMatch) shared |= Cond.bigMatch;
      this.sharedFlags = shared;
    }
    result[0] = this.sharedFlags | Cond.home;
    result[1] = this.sharedFlags | Cond.away;
    for (let index = 0; index < 2; index++) {
      const side: Side = index === 0 ? 'home' : 'away';
      const own = index === 0 ? this.homeScore : this.awayScore;
      const other = index === 0 ? this.awayScore : this.homeScore;
      let flags = own < other ? Cond.losing : own > other ? Cond.winning : Cond.level;
      if (owner && owner.side !== side) flags |= Cond.outOfPossession;
      if (owner?.side === side && this.tick - this.possessionGainedTick[side] <= 240) flags |= Cond.counter;
      result[index] |= flags;
    }
    return result;
  }

  actorFlags(actor: ArcadeActor, shared: number, owner: ArcadeActor | undefined): number {
    let flags = shared;
    const fromOwnGoal = this.attackDirection(actor.side) > 0 ? actor.x : FIELD_LENGTH - actor.x;
    const centred = Math.abs(actor.y - FIELD_WIDTH / 2) <= PITCH.penaltyHalfWidth;
    if (centred && fromOwnGoal <= PITCH.penaltyDepth) flags |= Cond.inOwnBox;
    if (centred && FIELD_LENGTH - fromOwnGoal <= PITCH.penaltyDepth) flags |= Cond.inOppBox;
    if (fromOwnGoal > FIELD_LENGTH / 2) flags |= Cond.inOppHalf;
    if (actor.stamina < 35) flags |= Cond.lowStamina;
    if (owner === actor && this.closestOpponent(actor) < 3) flags |= Cond.underPressure;
    if (this.activeShot && this.activeShot.side !== actor.side && actor.player.positionGroup === 'GK') flags |= Cond.facingShot;
    return flags;
  }

  closestOpponent(actor: ArcadeActor): number {
    return closestOpponentDistance(actor, this.actors);
  }

  pushCommentary(messageKey: string, params: Record<string, string | number>): void {
    this.events.push({ minute: this.footballMinute, type: 'commentary', side: this.controlledSide, playerId: null, messageKey, params });
  }
}
