import { Player } from '../../models/player.model';
import {
  AssistPreset,
  BallSnapshot,
  EMPTY_MATCH_COMMAND,
  InputFrame,
  MatchCheckpoint,
  MatchCommand,
  MatchConfig,
  MatchContribution,
  MatchEvent,
  MatchKeyframe,
  MatchPhase,
  MatchResult,
  MatchSnapshot,
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
import { playerName } from '../ratings';
import { clamp, Rng, round } from '../util';

export const FIELD_LENGTH = 105;
export const FIELD_WIDTH = 68;
export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;
export const MATCH_TICK = 1 / 60;

export interface ArcadeActor {
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
  action: string;
  decisionCooldown: number;
  skillCooldown: number;
  tackleCooldown: number;
  intentX: number;
  intentY: number;
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
  private lastPasser: { id: string; side: Side; at: number } | null = null;
  private pendingOffsideTargetId: string | null = null;
  private activeShot: ActiveShot | null = null;
  private safeSnapshot!: MatchSnapshot;
  private readonly replayBuffer: MatchSnapshot[] = [];
  private frozenReplay: MatchSnapshot[] = [];
  private lastSubAt = -100;

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
    if (this.paused || this.finished || this.phase === 'halftime' || this.phase === 'goalReplay') return;
    const input = normaliseCommand(rawInput);
    const safeDt = Math.min(dt, MATCH_TICK);
    this.tick++;

    if (this.rule.phase !== 'playing' && this.rule.phase !== 'advantage') {
      this.updateRestart(safeDt, input);
      this.previousInput = { ...input };
      return;
    }

    this.elapsed += safeDt;
    this.handleSelection(input);
    for (const actor of this.actors) {
      if (!actor.active) continue;
      actor.skillCooldown = Math.max(0, actor.skillCooldown - safeDt);
      actor.tackleCooldown = Math.max(0, actor.tackleCooldown - safeDt);
      if (this.isHumanControlled(actor)) this.moveControlled(actor, input, safeDt);
      else this.moveAi(actor, safeDt);
    }
    this.resolvePlayerCollisions();
    this.handleActions(input, safeDt);
    this.resolvePressureTackles(safeDt);
    this.updateBall(safeDt);
    this.updatePossessionStats(safeDt);
    this.recordTelemetry();
    this.validateState();

    if (!this.halftimeReached && this.elapsed >= this.totalSeconds / 2) this.enterHalftime();
    if (this.elapsed >= this.totalSeconds && !this.finished) this.finish();
    this.previousInput = { ...input };
  }

  simulateToEnd(): void {
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
    return this.controlledTeam.players.filter((player) => !onPitch.has(player.id) && player.injuryWeeks === 0);
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
    this.lastSubAt = this.elapsed;
    this.subsUsed++;
    const outgoing = actor.player;
    actor.player = incoming;
    actor.stamina = incoming.fitness;
    actor.card = 'none';
    actor.action = 'subbed-on';
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

  checkpoint(): MatchCheckpoint {
    return {
      version: 1,
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
      savedAt: Date.now(),
    };
  }

  restore(checkpoint: MatchCheckpoint): boolean {
    if (checkpoint.version !== 1 || checkpoint.matchId !== this.matchId) return false;
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
    this.rng.restore(checkpoint.rngState);
    return this.isFiniteState();
  }

  stateHash(): string {
    const json = JSON.stringify({ snapshot: this.snapshot(), rng: this.rng.snapshot(), events: this.events });
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
      let player = team.players.find((candidate) => candidate.id === slot.playerId && candidate.injuryWeeks === 0 && !used.has(candidate.id));
      if (!player) {
        player = team.players
          .filter((candidate) => candidate.injuryWeeks === 0 && !used.has(candidate.id))
          .sort((a, b) => {
            const aFit = a.position === slot.position ? 20 : a.positionGroup === (slot.position === 'GK' ? 'GK' : a.positionGroup) ? 5 : 0;
            const bFit = b.position === slot.position ? 20 : b.positionGroup === (slot.position === 'GK' ? 'GK' : b.positionGroup) ? 5 : 0;
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
        decisionCooldown: this.rng.float(0.05, 0.35),
        skillCooldown: 0,
        tackleCooldown: 0,
        intentX: x,
        intentY: y,
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
    return this.config.mode === 'play' && actor.player.id === this.selectedPlayerId;
  }

  private handleSelection(input: MatchCommand): void {
    if (this.config.playerLockId) {
      const locked = this.actors.find((actor) => actor.player.id === this.config.playerLockId && actor.active);
      this.selectedPlayerId = locked?.player.id ?? this.bestControlledActor().player.id;
      return;
    }
    const owner = this.owner();
    if (owner?.side === this.controlledSide) this.selectedPlayerId = owner.player.id;
    const looseAutoSwitch = !owner && this.config.assist === 'assisted';
    const obviousBalanced = !owner && this.config.assist === 'balanced' && distance(this.bestControlledActor(), this.ball) < 5;
    if (looseAutoSwitch || obviousBalanced) this.selectedPlayerId = this.bestControlledActor().player.id;
    if (input.switchPlayer && !this.previousInput.switchPlayer) {
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
    actor.action = input.sprint ? 'sprint' : Math.hypot(worldX, input.moveY) > 0.1 ? 'carry' : 'idle';
    if (input.skill && !this.previousInput.skill) this.performSkill(actor, worldX, input.moveY);
  }

  private moveActor(actor: ArcadeActor, dx: number, dy: number, sprint: boolean, dt: number): void {
    const magnitude = Math.hypot(dx, dy);
    const nx = magnitude > 0.001 ? dx / magnitude : 0;
    const ny = magnitude > 0.001 ? dy / magnitude : 0;
    const ownsBall = this.ball.ownerId === actor.player.id;
    const targetSpeed = magnitude > 0.05 ? this.maxSpeed(actor, sprint) * Math.min(1, magnitude) : 0;
    const targetVx = nx * targetSpeed;
    const targetVy = ny * targetSpeed;
    const fitnessPenalty = actor.stamina < 40 ? 0.78 + actor.stamina * 0.0055 : 1;
    const acceleration = (3.4 + actor.player.attributes.pace * 0.055 + actor.player.attributes.dribbling * 0.018) * fitnessPenalty;
    const braking = 12 + actor.player.attributes.dribbling * 0.06;
    const rate = targetSpeed === 0 ? braking : acceleration;
    actor.vx = this.approach(actor.vx, targetVx, rate * dt);
    actor.vy = this.approach(actor.vy, targetVy, rate * dt);
    if (magnitude > 0.08) {
      const turnRate = (2.7 + actor.player.attributes.dribbling / 28) * dt / (sprint ? 1.45 : 1);
      actor.facingX = this.approach(actor.facingX, nx, turnRate);
      actor.facingY = this.approach(actor.facingY, ny, turnRate);
      const facingLength = Math.hypot(actor.facingX, actor.facingY) || 1;
      actor.facingX /= facingLength;
      actor.facingY /= facingLength;
    }
    actor.x = clamp(actor.x + actor.vx * dt, 0.8, FIELD_LENGTH - 0.8);
    actor.y = clamp(actor.y + actor.vy * dt, 0.8, FIELD_WIDTH - 0.8);
    const footballMinutes = dt * 90 / this.totalSeconds;
    const pressureCost = this.teamOf(actor.side).tactics.pressing === 'gegenpress' ? 0.16 : 0;
    const drain = (magnitude > 0.1 ? 0.2 : 0.06) + (sprint ? 0.56 : 0) + (ownsBall ? 0.05 : 0) + pressureCost;
    actor.stamina = clamp(actor.stamina - footballMinutes * drain, 0, 100);
  }

  private moveAi(actor: ArcadeActor, dt: number): void {
    actor.decisionCooldown -= dt;
    if (actor.decisionCooldown <= 0) {
      this.chooseAiIntent(actor);
      const base = this.config.difficulty === 'easy' ? 0.42 : this.config.difficulty === 'hard' ? 0.16 : 0.26;
      const spread = this.config.difficulty === 'easy' ? 0.28 : this.config.difficulty === 'hard' ? 0.08 : 0.16;
      actor.decisionCooldown = base + this.rng.float(0, spread);
    }
    const dx = actor.intentX - actor.x;
    const dy = actor.intentY - actor.y;
    const sprint = distance(actor, { x: actor.intentX, y: actor.intentY }) > 14 && actor.stamina > 25;
    this.moveActor(actor, dx, dy, sprint, dt);
  }

  private chooseAiIntent(actor: ArcadeActor): void {
    const owner = this.owner();
    const team = this.teamOf(actor.side);
    const direction = this.attackDirection(actor.side);
    actor.action = 'formation';
    if (owner?.player.id === actor.player.id) {
      actor.action = 'carry';
      actor.intentX = clamp(actor.x + direction * 9, 1, FIELD_LENGTH - 1);
      actor.intentY = clamp(actor.y + this.rng.float(-4, 4), 2, FIELD_WIDTH - 2);
      const goalDistance = direction > 0 ? FIELD_LENGTH - actor.x : actor.x;
      const pressured = this.closestOpponent(actor) < 4;
      if (goalDistance < 23 && this.rng.bool(0.48 + actor.player.attributes.shooting / 250)) {
        this.shoot(actor, this.rng.float(0.55, 1), 0, this.rng.float(-0.45, 0.45), false, false);
      } else if ((pressured || this.rng.bool(0.38)) && actor.player.positionGroup !== 'GK') {
        this.pass(actor, this.rng.bool(0.28), false, this.rng.float(0.35, 0.8), direction, this.rng.float(-0.5, 0.5));
      } else if (actor.player.positionGroup === 'GK') {
        this.pass(actor, false, this.rng.bool(0.4), 0.8, direction, this.rng.float(-0.4, 0.4));
      }
      return;
    }

    if (!owner || owner.side !== actor.side) {
      const pressers = this.actors
        .filter((candidate) => candidate.active && candidate.side === actor.side && candidate.player.positionGroup !== 'GK')
        .sort((a, b) => distance(a, this.ball) - distance(b, this.ball));
      const maxPressers = team.tactics.pressing === 'low' ? 1 : 2;
      if (pressers.slice(0, maxPressers).includes(actor)) {
        actor.action = 'press';
        actor.intentX = this.ball.x + this.ball.vx * 0.25;
        actor.intentY = this.ball.y + this.ball.vy * 0.25;
        return;
      }
    }

    const mentalityShift = team.tactics.mentality === 'ultra-attacking' ? 8 : team.tactics.mentality === 'attacking' ? 4 : team.tactics.mentality === 'defensive' ? -3 : team.tactics.mentality === 'ultra-defensive' ? -6 : 0;
    const width = team.tactics.width === 'wide' ? 1.12 : team.tactics.width === 'narrow' ? 0.78 : 1;
    const transition = owner ? clamp((owner.x - FIELD_LENGTH / 2) * 0.16, -7, 7) : 0;
    actor.intentX = clamp(actor.homeX + direction * mentalityShift + transition, 1, FIELD_LENGTH - 1);
    actor.intentY = clamp(FIELD_WIDTH / 2 + (actor.homeY - FIELD_WIDTH / 2) * width + (this.ball.y - FIELD_WIDTH / 2) * 0.08, 1.5, FIELD_WIDTH - 1.5);
    if (owner?.side === actor.side && team.tactics.counterAttack && actor.player.positionGroup === 'ATT') actor.intentX += direction * 5;
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
    if (!input.pass && this.previousInput.pass) {
      if (this.ball.ownerId === actor.player.id) this.pass(actor, false, false, this.charge(this.actionHeld.pass, 0.8), aimX, aimY);
      else this.attemptTackle(actor, false);
      this.actionHeld.pass = 0;
    }
    if (!input.through && this.previousInput.through) {
      if (this.ball.ownerId === actor.player.id) this.pass(actor, true, false, this.charge(this.actionHeld.through, 0.8), aimX, aimY);
      else if (actor.player.positionGroup === 'GK') actor.intentX += this.currentAttackDirection * 6;
      this.actionHeld.through = 0;
    }
    if (!input.lob && this.previousInput.lob) {
      if (this.ball.ownerId === actor.player.id) this.pass(actor, false, true, this.charge(this.actionHeld.lob, 0.8), aimX, aimY);
      else this.attemptTackle(actor, true);
      this.actionHeld.lob = 0;
    }
    if (!input.shoot && this.previousInput.shoot) {
      if (this.ball.ownerId === actor.player.id) {
        const finesse = input.skill || this.previousInput.skill;
        const low = this.actionHeld.shoot < 0.14;
        this.shoot(actor, this.charge(this.actionHeld.shoot, 0.9), aimX, aimY, finesse, low);
      } else this.attemptTackle(actor, true);
      this.actionHeld.shoot = 0;
    }
  }

  private charge(value: number, maximum: number): number {
    return clamp(0.3 + value / maximum * 0.7, 0.3, 1);
  }

  private pass(actor: ArcadeActor, through: boolean, lob: boolean, power: number, aimX: number, aimY: number): void {
    if (this.ball.ownerId !== actor.player.id) return;
    const aimLength = Math.hypot(aimX, aimY) || 1;
    const nx = aimX / aimLength;
    const ny = aimY / aimLength;
    const assistCone: Record<AssistPreset, number> = { assisted: 0.2, balanced: 0.42, manual: 0.72 };
    const teammates = this.actors.filter((candidate) => candidate.active && candidate.side === actor.side && candidate.player.id !== actor.player.id);
    const target = teammates
      .map((candidate) => {
        const dx = candidate.x - actor.x;
        const dy = candidate.y - actor.y;
        const length = Math.hypot(dx, dy) || 1;
        const angle = Math.acos(clamp((dx / length) * nx + (dy / length) * ny, -1, 1));
        const lanePressure = this.passLanePressure(actor, candidate);
        const runBonus = through ? Math.max(0, (candidate.vx * this.attackDirection(actor.side) + 1) * 0.12) : 0;
        return { candidate, score: angle * 2.2 + length * 0.012 + lanePressure * 0.45 - runBonus };
      })
      .filter(({ score }) => score < assistCone[this.config.assist] * 2.2 + 0.7)
      .sort((a, b) => a.score - b.score)[0]?.candidate;
    const manualTarget = { x: actor.x + nx * (8 + power * 24), y: actor.y + ny * (8 + power * 24) };
    const targetX = target ? target.x + (through ? target.vx * 1.2 + this.attackDirection(actor.side) * 2.5 : 0) : manualTarget.x;
    const targetY = target ? target.y + (through ? target.vy * 1.2 : 0) : manualTarget.y;
    const dx = targetX - actor.x;
    const dy = targetY - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const pressure = clamp((5 - this.closestOpponent(actor)) / 5, 0, 1);
    const weakFoot = actor.player.foot !== 'Both' && ((actor.player.foot === 'Right' && dy < -1) || (actor.player.foot === 'Left' && dy > 1)) ? 1 : 0;
    const fatigue = actor.stamina < 30 ? (30 - actor.stamina) / 30 : 0;
    const manualFactor = this.config.assist === 'manual' ? 1.2 : this.config.assist === 'assisted' ? 0.55 : 0.82;
    const error = (100 - actor.player.attributes.passing) / 100 * 0.22 + pressure * 0.08 + weakFoot * 0.05 + fatigue * 0.08;
    const angleError = this.rng.gaussian(0, error * manualFactor);
    const cos = Math.cos(angleError);
    const sin = Math.sin(angleError);
    const px = dx / length * cos - dy / length * sin;
    const py = dx / length * sin + dy / length * cos;
    const speed = (lob ? 14 : through ? 13 : 10.5) + power * (lob ? 12 : 13) + actor.player.attributes.passing * 0.025;
    this.passAttempts[actor.side]++;
    this.stats(actor.side).passesAttempted++;
    this.lastPasser = { id: actor.player.id, side: actor.side, at: this.elapsed };
    this.pendingOffsideTargetId = target && this.isOffside(target, actor) ? target.player.id : null;
    this.releaseBall(actor, px * speed, py * speed, lob ? 5 + power * 4 : 0.2, lob ? this.rng.float(-2, 2) : 0);
    actor.action = lob ? 'lob' : through ? 'through-pass' : 'pass';
  }

  private shoot(actor: ArcadeActor, power: number, aimX: number, aimY: number, finesse: boolean, low: boolean): void {
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
    const baseError = (100 - actor.player.attributes.shooting) / 100 * 1.9 + pressure * 1.2 + (1 - balance) * 0.8 + weakFoot + fatigue;
    const assistFactor = this.config.assist === 'assisted' ? 0.72 : this.config.assist === 'manual' ? 1.18 : 0.92;
    const targetY = goalCentre + inputZone + this.rng.gaussian(0, baseError * assistFactor);
    const dx = goalX - actor.x;
    const dy = targetY - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const speed = 19 + power * 14 + actor.player.attributes.shooting * 0.035;
    const xG = clamp((1 - distanceToGoal / 42) * 0.62 + angleQuality * 0.18 + actor.player.attributes.shooting / 500 - pressure * 0.12, 0.015, 0.86);
    const stats = this.stats(actor.side);
    stats.shots++;
    stats.xG = round(stats.xG + xG, 2);
    if (Math.abs(targetY - goalCentre) <= GOAL_WIDTH / 2 + 0.4) stats.shotsOnTarget++;
    const vz = low ? 0.7 : finesse ? 3.2 : 1.6 + power * 3.8;
    this.activeShot = { shooterId: actor.player.id, side: actor.side, xG, targetY, checkedKeeper: false };
    this.releaseBall(actor, dx / length * speed, dy / length * speed, vz, finesse ? -direction * 5 : 0);
    actor.action = finesse ? 'finesse-shot' : low ? 'low-shot' : 'shot';
    this.events.push({ minute: this.footballMinute, type: 'shot', side: actor.side, playerId: actor.player.id, params: { player: playerName(actor.player), xG } });
  }

  private performSkill(actor: ArcadeActor, dx: number, dy: number): void {
    if (actor.skillCooldown > 0 || this.ball.ownerId !== actor.player.id) return;
    const opponent = this.closestOpponent(actor);
    const success = clamp(0.35 + actor.player.attributes.dribbling / 150 + actor.stamina / 500 - Math.max(0, 3 - opponent) * 0.08, 0.2, 0.9);
    actor.skillCooldown = 0.75;
    if (this.rng.bool(success)) {
      const lateral = Math.abs(dy) > Math.abs(dx);
      actor.x = clamp(actor.x + (lateral ? actor.facingX : -actor.facingX) * 1.4, 1, FIELD_LENGTH - 1);
      actor.y = clamp(actor.y + (lateral ? Math.sign(dy || 1) : -actor.facingY) * 1.7, 1, FIELD_WIDTH - 1);
      actor.action = lateral ? 'ball-roll' : 'drag-back';
    } else {
      this.releaseBall(actor, actor.facingX * 4 + this.rng.float(-2, 2), actor.facingY * 4 + this.rng.float(-2, 2), 0.5, 0);
      actor.action = 'skill-failed';
    }
  }

  private releaseBall(actor: ArcadeActor, vx: number, vy: number, vz: number, spin: number): void {
    this.ball.ownerId = null;
    this.ball.x = actor.x + actor.facingX * 0.8;
    this.ball.y = actor.y + actor.facingY * 0.8;
    this.ball.z = 0.18;
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
      const press = this.teamOf(defender.side).tactics.pressing === 'gegenpress' ? 1.45 : this.teamOf(defender.side).tactics.pressing === 'high' ? 1.2 : 1;
      if (this.rng.bool(dt * (0.22 + defender.player.attributes.defending / 115) * press)) this.attemptTackle(defender, false);
    }
  }

  private attemptTackle(actor: ArcadeActor, sliding: boolean): void {
    const owner = this.owner();
    if (!owner || owner.side === actor.side || actor.tackleCooldown > 0) return;
    const reach = sliding ? 2.25 : 1.45;
    if (distance(actor, owner) > reach) return;
    actor.tackleCooldown = sliding ? 1.15 : 0.45;
    actor.action = sliding ? 'slide' : 'standing-tackle';
    const relativeX = owner.x - actor.x;
    const relativeY = owner.y - actor.y;
    const approach = (relativeX * actor.facingX + relativeY * actor.facingY) / Math.max(0.1, Math.hypot(relativeX, relativeY));
    const speed = Math.hypot(actor.vx - owner.vx, actor.vy - owner.vy);
    const winChance = clamp(0.28 + actor.player.attributes.defending / 170 - owner.player.attributes.dribbling / 260 + approach * 0.12 + (sliding ? 0.08 : 0), 0.12, 0.82);
    if (this.rng.bool(winChance)) {
      this.ball.ownerId = actor.player.id;
      this.ball.lastTouch = actor.side;
      this.ball.lastTouchPlayerId = actor.player.id;
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
    const straightRed = severity > 16 && this.rng.bool(0.18);
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
    const inBox = victimDirection > 0 ? victim.x > FIELD_LENGTH - 16.5 : victim.x < 16.5;
    this.events.push({ minute: this.footballMinute, type: eventType, side: defender.side, playerId: defender.player.id, messageKey: inBox ? 'match.penalty' : eventType === 'red' ? 'match.red' : eventType === 'yellow' ? 'match.yellow' : 'match.freeKick', params: { player: playerName(defender.player) } });
    if (this.rng.bool(clamp((severity - 8) / 220, 0.005, 0.06))) {
      victim.action = 'injured';
      this.events.push({ minute: this.footballMinute, type: 'injury', side: victim.side, playerId: victim.player.id, messageKey: 'match.injury', params: { player: playerName(victim.player) } });
    }
    this.setRestart(inBox ? 'penalty' : 'freeKick', victim.side, victim.x, victim.y);
    if (!defender.active && defender.player.id === this.selectedPlayerId) this.selectedPlayerId = this.bestControlledActor().player.id;
  }

  private updateBall(dt: number): void {
    const owner = this.owner();
    if (owner) {
      const sprinting = owner.action === 'sprint';
      const close = owner.action === 'ball-roll' || owner.action === 'drag-back';
      const touchDistance = close ? 0.45 : sprinting ? 1.35 : 0.78;
      this.ball.x = owner.x + owner.facingX * touchDistance;
      this.ball.y = owner.y + owner.facingY * touchDistance;
      this.ball.z = 0.16;
      this.ball.vx = owner.vx;
      this.ball.vy = owner.vy;
      this.ball.vz = 0;
      this.ball.lastTouch = owner.side;
      this.ball.lastTouchPlayerId = owner.player.id;
      this.ball.controlledTouch += dt;
      return;
    }
    const rainFactor = this.config.weather === 'rain' ? 1.08 : this.config.weather === 'storm' ? 1.05 : 1;
    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.z += this.ball.vz * dt;
    this.ball.vz -= 9.81 * dt;
    this.ball.vy += this.ball.spin * Math.abs(this.ball.vx) * 0.0008;
    const ground = this.ball.z <= 0;
    if (ground) {
      if (this.ball.vz < -1) this.ball.vz = -this.ball.vz * 0.48;
      else this.ball.vz = 0;
      this.ball.z = 0;
      const friction = Math.pow((this.config.weather === 'rain' ? 0.91 : 0.87) * rainFactor, dt);
      this.ball.vx *= friction;
      this.ball.vy *= friction;
      this.ball.spin *= Math.pow(0.35, dt);
    } else {
      this.ball.vx *= Math.pow(0.992, dt * 60);
      this.ball.vy *= Math.pow(0.992, dt * 60);
    }
    this.handlePostsAndKeeper();
    if (this.handleBoundary()) return;
    this.tryBallControl();
  }

  private handlePostsAndKeeper(): void {
    if (!this.activeShot) return;
    const shot = this.activeShot;
    const goalX = this.attackDirection(shot.side) > 0 ? FIELD_LENGTH : 0;
    const nearGoal = Math.abs(this.ball.x - goalX) < 5.5;
    if (!nearGoal || shot.checkedKeeper) return;
    shot.checkedKeeper = true;
    const defending: Side = shot.side === 'home' ? 'away' : 'home';
    const keeper = this.actors.find((actor) => actor.active && actor.side === defending && actor.player.positionGroup === 'GK');
    if (!keeper) return;
    const keeperDistance = Math.abs(keeper.y - this.ball.y) + Math.max(0, this.ball.z - 1.2) * 1.2;
    const reaction = keeper.player.attributes.goalkeeping / 100;
    const saveChance = clamp(0.12 + reaction * 0.52 - shot.xG * 0.34 - keeperDistance * 0.055, 0.03, 0.78);
    if (this.rng.bool(saveChance)) {
      const catchBall = this.rng.bool(clamp(reaction - Math.hypot(this.ball.vx, this.ball.vy) / 70, 0.15, 0.72));
      this.stats(defending).saves++;
      this.ratings[keeper.player.id] = clamp((this.ratings[keeper.player.id] ?? 6.5) + 0.18 + shot.xG * 0.25, 1, 10);
      this.events.push({ minute: this.footballMinute, type: 'save', side: defending, playerId: keeper.player.id, params: { keeper: playerName(keeper.player) } });
      if (catchBall) {
        this.ball.ownerId = keeper.player.id;
        this.ball.x = keeper.x;
        this.ball.y = keeper.y;
        this.ball.z = 0.5;
        this.ball.vx = this.ball.vy = this.ball.vz = 0;
        keeper.action = 'keeper-catch';
      } else {
        this.ball.vx *= -0.38;
        this.ball.vy += this.rng.float(-5, 5);
        this.ball.vz = Math.max(1.8, this.ball.vz * 0.5);
        keeper.action = 'keeper-parry';
      }
      this.activeShot = null;
    }
  }

  private handleBoundary(): boolean {
    if (this.ball.x < 0 || this.ball.x > FIELD_LENGTH) {
      const inGoal = Math.abs(this.ball.y - FIELD_WIDTH / 2) <= GOAL_WIDTH / 2 && this.ball.z <= GOAL_HEIGHT;
      if (inGoal) {
        this.scoreGoal(this.ball.x > FIELD_LENGTH ? this.sideAttackingDirection(1) : this.sideAttackingDirection(-1));
        return true;
      }
      const attacking = this.ball.x > FIELD_LENGTH ? this.sideAttackingDirection(1) : this.sideAttackingDirection(-1);
      const corner = this.ball.lastTouch !== attacking;
      if (corner) this.stats(attacking).corners++;
      this.events.push({ minute: this.footballMinute, type: corner ? 'corner' : 'commentary', side: corner ? attacking : null, playerId: null, messageKey: corner ? 'match.corner' : 'match.goalKick', params: { team: this.teamOf(attacking).shortName } });
      this.setRestart(corner ? 'corner' : 'goalKick', corner ? attacking : this.opposite(attacking), clamp(this.ball.x, 0, FIELD_LENGTH), clamp(this.ball.y, 0, FIELD_WIDTH));
      return true;
    }
    if (this.ball.y < 0 || this.ball.y > FIELD_WIDTH) {
      const side = this.opposite(this.ball.lastTouch);
      this.events.push({ minute: this.footballMinute, type: 'commentary', side, playerId: null, messageKey: 'match.throwIn', params: { team: this.teamOf(side).shortName } });
      this.setRestart('throwIn', side, clamp(this.ball.x, 1, FIELD_LENGTH - 1), clamp(this.ball.y, 0, FIELD_WIDTH));
      return true;
    }
    return false;
  }

  private tryBallControl(): void {
    if (this.ball.z > 2.4) return;
    const speed = Math.hypot(this.ball.vx, this.ball.vy);
    const candidate = this.actors
      .filter((actor) => actor.active && distance(actor, this.ball) < (actor.player.positionGroup === 'GK' ? 1.65 : 1.05))
      .sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0];
    if (!candidate) return;
    if (this.pendingOffsideTargetId === candidate.player.id) {
      this.stats(candidate.side).offsides++;
      this.events.push({ minute: this.footballMinute, type: 'foul', side: candidate.side, playerId: candidate.player.id, messageKey: 'match.offside', params: { player: playerName(candidate.player) } });
      this.pendingOffsideTargetId = null;
      this.setRestart('freeKick', this.opposite(candidate.side), candidate.x, candidate.y, true);
      return;
    }
    const firstTouch = candidate.player.attributes.dribbling + candidate.stamina * 0.25 - speed * 1.4;
    const weatherPenalty = this.config.weather === 'rain' ? 8 : this.config.weather === 'storm' ? 11 : 0;
    const assistBonus = candidate.side === this.controlledSide ? this.config.assist === 'assisted' ? 12 : this.config.assist === 'balanced' ? 5 : 0 : 4;
    if (this.rng.bool(clamp((firstTouch + assistBonus - weatherPenalty) / 100, 0.18, 0.96))) {
      this.ball.ownerId = candidate.player.id;
      this.ball.lastTouch = candidate.side;
      this.ball.lastTouchPlayerId = candidate.player.id;
      if (this.lastPasser && this.elapsed - this.lastPasser.at <= 5) {
        if (candidate.side === this.lastPasser.side && candidate.player.id !== this.lastPasser.id) {
          this.passCompletions[candidate.side]++;
          this.stats(candidate.side).passesCompleted++;
          this.ratings[this.lastPasser.id] = clamp((this.ratings[this.lastPasser.id] ?? 6.5) + 0.025, 1, 10);
        } else if (candidate.side !== this.lastPasser.side) {
          this.stats(candidate.side).interceptions++;
        }
      }
      this.pendingOffsideTargetId = null;
      this.activeShot = null;
      if (candidate.side === this.controlledSide && !this.config.playerLockId) this.selectedPlayerId = candidate.player.id;
    } else {
      this.ball.vx *= 0.48;
      this.ball.vy += this.rng.float(-2.5, 2.5);
      candidate.action = 'heavy-touch';
    }
  }

  private scoreGoal(side: Side): void {
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
    this.rule = this.newRule(phase, side, x, y, indirect);
    this.phase = 'stoppage';
    this.ball.ownerId = null;
    this.ball.x = clamp(x, 0, FIELD_LENGTH);
    this.ball.y = clamp(y, 0, FIELD_WIDTH);
    this.ball.z = 0;
    this.ball.vx = this.ball.vy = this.ball.vz = 0;
  }

  private updateRestart(dt: number, input: MatchCommand): void {
    this.rule.elapsed += dt;
    if (this.rule.phase === 'halftime' || this.rule.phase === 'fulltime') return;
    const minimum = this.config.mode === 'instant' ? 0.05 : 0.42;
    const forced = this.rule.elapsed >= (this.rule.phase === 'throwIn' ? 5 : 1.35);
    const humanRestart = this.rule.restartSide === this.controlledSide && this.config.mode === 'play';
    const pressed = input.pass || input.through || input.lob || input.shoot;
    if (this.rule.elapsed < minimum || (humanRestart && !pressed && !forced)) return;
    const side = this.rule.restartSide ?? 'home';
    const restartSpot = { x: this.rule.spotX, y: this.rule.spotY };
    const taker = this.actors
      .filter((actor) => actor.active && actor.side === side)
      .sort((a, b) => distance(a, restartSpot) - distance(b, restartSpot))[0];
    if (!taker) return;
    taker.x = clamp(this.rule.spotX, 1, FIELD_LENGTH - 1);
    taker.y = clamp(this.rule.spotY, 1, FIELD_WIDTH - 1);
    taker.facingX = this.attackDirection(side);
    taker.facingY = 0;
    this.ball.ownerId = taker.player.id;
    this.ball.lastTouch = side;
    this.ball.lastTouchPlayerId = taker.player.id;
    const wasPenalty = this.rule.phase === 'penalty';
    this.rule = this.newRule('playing', null, taker.x, taker.y);
    this.phase = this.halftimeReached ? 'secondHalf' : 'firstHalf';
    if (wasPenalty) this.shoot(taker, 0.72, this.attackDirection(side), input.aimY || this.rng.float(-0.75, 0.75), false, false);
  }

  private resetKickoff(side: Side): void {
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
    if (this.tick % 6 === 0) {
      this.replayBuffer.push(this.snapshot());
      if (this.replayBuffer.length > 60) this.replayBuffer.shift();
    }
    if (this.tick % 60 === 0) {
      for (const actor of this.actors) {
        if (!actor.active) continue;
        const list = this.heatmaps[actor.player.id] ?? (this.heatmaps[actor.player.id] = []);
        const cell = list.find((point) => Math.abs(point.x - actor.x) < 5 && Math.abs(point.y - actor.y) < 5);
        if (cell) cell.weight++;
        else if (list.length < 48) list.push({ x: round(actor.x, 1), y: round(actor.y, 1), weight: 1 });
      }
    }
    if (this.tick % 30 === 0) this.safeSnapshot = this.snapshot();
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
    const grid = new Map<string, ArcadeActor[]>();
    for (const actor of this.actors.filter((candidate) => candidate.active)) {
      const key = `${Math.floor(actor.x / cellSize)}:${Math.floor(actor.y / cellSize)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(actor);
      grid.set(key, bucket);
    }
    for (const actor of this.actors.filter((candidate) => candidate.active)) {
      const gx = Math.floor(actor.x / cellSize);
      const gy = Math.floor(actor.y / cellSize);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const other of grid.get(`${gx + ox}:${gy + oy}`) ?? []) {
          if (other === actor || other.player.id < actor.player.id) continue;
          const dx = other.x - actor.x;
          const dy = other.y - actor.y;
          const length = Math.hypot(dx, dy) || 0.001;
          const minimum = 1.05;
          if (length >= minimum) continue;
          const push = (minimum - length) / 2;
          const massA = 0.75 + actor.player.attributes.physical / 100;
          const massB = 0.75 + other.player.attributes.physical / 100;
          actor.x -= dx / length * push * (massB / (massA + massB));
          actor.y -= dy / length * push * (massB / (massA + massB));
          other.x += dx / length * push * (massA / (massA + massB));
          other.y += dy / length * push * (massA / (massA + massB));
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
    if (this.isFiniteState()) return;
    this.applySnapshot(this.safeSnapshot);
    this.events.push({ minute: this.footballMinute, type: 'commentary', side: null, playerId: null, text: 'Simulation recovered from an invalid state.' });
    this.paused = true;
    this.phase = 'paused';
  }

  private isFiniteState(): boolean {
    const values = [this.ball.x, this.ball.y, this.ball.z, this.ball.vx, this.ball.vy, this.ball.vz, ...this.actors.flatMap((actor) => [actor.x, actor.y, actor.vx, actor.vy, actor.stamina])];
    return values.every(Number.isFinite);
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
    return { id: actor.player.id, side: actor.side, x: actor.x, y: actor.y, vx: actor.vx, vy: actor.vy, facingX: actor.facingX, facingY: actor.facingY, fitness: actor.stamina, active: actor.active, card: actor.card, action: actor.action };
  }

  private applyActorSnapshot(actor: ArcadeActor, saved: PlayerRuntimeSnapshot): void {
    actor.x = saved.x;
    actor.y = saved.y;
    actor.vx = saved.vx;
    actor.vy = saved.vy;
    actor.facingX = saved.facingX;
    actor.facingY = saved.facingY;
    actor.stamina = saved.fitness;
    actor.active = saved.active;
    actor.card = saved.card;
    actor.action = saved.action;
  }

  private ballSnapshot(): BallSnapshot {
    const { x, y, z, vx, vy, vz, spin, ownerId } = this.ball;
    return { x, y, z, vx, vy, vz, spin, ownerId };
  }

  private newRule(phase: RuleState['phase'], restartSide: Side | null, spotX: number, spotY: number, indirect = false): RuleState {
    return { phase, restartSide, spotX, spotY, elapsed: 0, indirect, advantageSide: null, pendingCardPlayerId: null };
  }

  private maxSpeed(actor: ArcadeActor, sprint: boolean): number {
    const base = 5.4 + (actor.player.attributes.pace - 40) / 59 * 3.1;
    const fitness = actor.stamina < 40 ? 0.82 + actor.stamina * 0.0045 : 1;
    const ball = this.ball.ownerId === actor.player.id ? sprint ? 0.94 : 0.89 + actor.player.attributes.dribbling / 900 : 1;
    return base * fitness * ball * (sprint ? 1 : 0.72);
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
