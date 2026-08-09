import { Player } from '../../models/player.model';
import {
  InputFrame,
  MatchContribution,
  MatchEvent,
  MatchKeyframe,
  MatchResult,
  Side,
  TeamMatchStats,
  emptyContribution,
  emptyTeamMatchStats,
} from '../../models/match.model';
import { Team } from '../../models/team.model';
import { Tactics } from '../../models/tactics.model';
import { Difficulty } from '../../models/game.model';
import { getRole } from '../../data/roles';
import { effectiveRating, playerName } from '../ratings';
import { clamp, Rng, uid } from '../util';

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
}

export interface ArcadeBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerId: string | null;
  lastTouch: Side;
  lastTouchPlayerId: string | null;
}

const EMPTY_INPUT: InputFrame = {
  moveX: 0,
  moveY: 0,
  sprint: false,
  pass: false,
  through: false,
  shoot: false,
  switchPlayer: false,
};

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class ArcadeMatch {
  readonly home: Team;
  readonly away: Team;
  readonly controlledTeamId: string;
  readonly controlledSide: Side;
  readonly actors: ArcadeActor[] = [];
  readonly ball: ArcadeBall = {
    x: 0.5,
    y: 0.5,
    vx: 0,
    vy: 0,
    ownerId: null,
    lastTouch: 'home',
    lastTouchPlayerId: null,
  };
  readonly events: MatchEvent[] = [];
  readonly keyframes: MatchKeyframe[] = [];
  readonly homeStats = emptyTeamMatchStats();
  readonly awayStats = emptyTeamMatchStats();
  readonly ratings: Record<string, number> = {};
  readonly contributions: Record<string, MatchContribution> = {};

  homeScore = 0;
  awayScore = 0;
  elapsed = 0;
  paused = false;
  finished = false;
  selectedPlayerId = '';

  private readonly rng: Rng;
  private readonly totalSeconds: number;
  private previousInput: InputFrame = { ...EMPTY_INPUT };
  private aiDecisionCooldown = 0;
  private possessionHomeSeconds = 0;
  private possessionAwaySeconds = 0;
  private lastKeyframeMinute = -1;
  private finalResult: MatchResult | null = null;
  private halftimeSent = false;

  constructor(
    home: Team,
    away: Team,
    controlledTeamId: string,
    halfMinutes: 3 | 5 | 8,
    seed = Date.now() >>> 0,
    private readonly difficulty: Difficulty = 'normal',
  ) {
    this.home = structuredClone(home);
    this.away = structuredClone(away);
    this.controlledTeamId = controlledTeamId;
    this.controlledSide = away.id === controlledTeamId ? 'away' : 'home';
    this.rng = new Rng(seed);
    this.totalSeconds = halfMinutes * 120;
    this.buildActors(this.home, 'home');
    this.buildActors(this.away, 'away');
    this.selectedPlayerId = this.bestControlledActor().player.id;
    this.events.push({ minute: 0, type: 'kickoff', side: null, playerId: null, messageKey: 'match.kickoff' });
    this.resetKickoff('home');
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

  step(dt: number, input: InputFrame = EMPTY_INPUT): void {
    if (this.paused || this.finished) return;
    const safeDt = Math.min(dt, 1 / 20);
    this.elapsed += safeDt;
    this.aiDecisionCooldown -= safeDt;

    this.handleSelection(input);
    for (const actor of this.actors) {
      if (actor.player.id === this.selectedPlayerId) this.moveControlled(actor, input, safeDt);
      else this.moveAi(actor, safeDt);
    }

    this.handleActionEdges(input);
    this.resolveTackles(safeDt);
    this.updateBall(safeDt);
    this.updatePossessionStats(safeDt);
    this.recordKeyframe();

    if (!this.halftimeSent && this.progress >= 0.5) {
      this.halftimeSent = true;
      this.events.push({
        minute: 45,
        type: 'halftime',
        side: null,
        playerId: null,
        messageKey: 'match.halftime',
        params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore },
      });
      this.resetKickoff('away');
    }

    if (this.elapsed >= this.totalSeconds) this.finish();
    this.previousInput = { ...input };
  }

  simulateToEnd(): void {
    let guard = 0;
    while (!this.finished && guard < 60000) {
      this.step(1 / 30, EMPTY_INPUT);
      guard++;
    }
  }

  setMentality(value: Tactics['mentality']): void {
    this.controlledTeam.tactics.mentality = value;
    this.events.push({
      minute: this.footballMinute,
      type: 'commentary',
      side: this.controlledSide,
      playerId: null,
      messageKey: 'match.mentality',
      params: { value },
    });
  }

  setPressing(value: Tactics['pressing']): void {
    this.controlledTeam.tactics.pressing = value;
    this.events.push({
      minute: this.footballMinute,
      type: 'commentary',
      side: this.controlledSide,
      playerId: null,
      messageKey: 'match.pressing',
      params: { value },
    });
  }

  bench(): Player[] {
    const onPitch = new Set(this.actors.filter((actor) => actor.side === this.controlledSide).map((actor) => actor.player.id));
    return this.controlledTeam.players.filter((player) => !onPitch.has(player.id) && player.injuryWeeks === 0);
  }

  makeSub(outId: string, inId: string): boolean {
    const actor = this.actors.find((candidate) => candidate.player.id === outId && candidate.side === this.controlledSide);
    const incoming = this.controlledTeam.players.find((player) => player.id === inId);
    if (!actor || !incoming || this.bench().every((player) => player.id !== inId)) return false;
    const outgoing = actor.player;
    actor.player = incoming;
    actor.stamina = incoming.fitness;
    this.ratings[incoming.id] = 6.5;
    this.contributions[incoming.id] = emptyContribution();
    if (this.selectedPlayerId === outId) this.selectedPlayerId = incoming.id;
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

  private buildActors(team: Team, side: Side): void {
    for (const slot of team.formation.slots) {
      const player = team.players.find((candidate) => candidate.id === slot.playerId && candidate.injuryWeeks === 0);
      if (!player) continue;
      const x = side === 'home' ? slot.x : 1 - slot.x;
      const actor: ArcadeActor = {
        player,
        side,
        x,
        y: slot.y,
        homeX: x,
        homeY: slot.y,
        vx: 0,
        vy: 0,
        stamina: player.fitness,
        facingX: side === 'home' ? 1 : -1,
        facingY: 0,
      };
      this.actors.push(actor);
      this.ratings[player.id] = 6.5;
      this.contributions[player.id] = emptyContribution();
    }
  }

  private bestControlledActor(): ArcadeActor {
    const candidates = this.actors.filter((actor) => actor.side === this.controlledSide && actor.player.positionGroup !== 'GK');
    return candidates.sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0] ?? this.actors[0];
  }

  private handleSelection(input: InputFrame): void {
    const owner = this.owner();
    if (owner?.side === this.controlledSide) this.selectedPlayerId = owner.player.id;
    if (input.switchPlayer && !this.previousInput.switchPlayer) {
      const candidates = this.actors
        .filter((actor) => actor.side === this.controlledSide && actor.player.positionGroup !== 'GK')
        .sort((a, b) => distance(a, this.ball) - distance(b, this.ball));
      const index = candidates.findIndex((actor) => actor.player.id === this.selectedPlayerId);
      this.selectedPlayerId = candidates[(index + 1) % Math.min(candidates.length, 3)]?.player.id ?? this.selectedPlayerId;
    }
  }

  private moveControlled(actor: ArcadeActor, input: InputFrame, dt: number): void {
    const magnitude = Math.hypot(input.moveX, input.moveY) || 1;
    const mx = input.moveX / magnitude;
    const my = input.moveY / magnitude;
    const sprintMultiplier = input.sprint && actor.stamina > 8 ? 1.35 : 1;
    const speed = this.actorSpeed(actor) * sprintMultiplier;
    actor.vx = mx * speed;
    actor.vy = my * speed;
    if (Math.abs(input.moveX) + Math.abs(input.moveY) > 0.1) {
      actor.facingX = mx;
      actor.facingY = my;
    }
    actor.x = clamp(actor.x + actor.vx * dt, 0.02, 0.98);
    actor.y = clamp(actor.y + actor.vy * dt, 0.035, 0.965);
    actor.stamina = clamp(actor.stamina - (input.sprint ? 1.6 : 0.28) * dt, 0, 100);
  }

  private moveAi(actor: ArcadeActor, dt: number): void {
    const owner = this.owner();
    const sideTeam = actor.side === 'home' ? this.home : this.away;
    const direction = actor.side === 'home' ? 1 : -1;
    let tx = actor.homeX;
    let ty = actor.homeY;

    if (owner?.player.id === actor.player.id) {
      tx = actor.x + direction * 0.16;
      ty = clamp(actor.y + Math.sin(this.elapsed + actor.homeY * 8) * 0.05, 0.08, 0.92);
      if (this.aiDecisionCooldown <= 0) {
        this.aiDecisionCooldown = this.rng.float(0.35, 0.85);
        const goalDistance = actor.side === 'home' ? 1 - actor.x : actor.x;
        if (goalDistance < 0.26 && this.rng.bool(0.65)) this.shoot(actor, 0.8);
        else if (this.rng.bool(0.55)) this.pass(actor, this.rng.bool(0.25));
      }
    } else if (!owner || owner.side !== actor.side) {
      const sideActors = this.actors
        .filter((candidate) => candidate.side === actor.side && candidate.player.positionGroup !== 'GK')
        .sort((a, b) => distance(a, this.ball) - distance(b, this.ball));
      const pressCount = sideTeam.tactics.pressing === 'gegenpress' ? 3 : sideTeam.tactics.pressing === 'high' ? 2 : 1;
      if (sideActors.slice(0, pressCount).includes(actor)) {
        tx = this.ball.x;
        ty = this.ball.y;
      }
    } else {
      const mentalityShift =
        sideTeam.tactics.mentality === 'ultra-attacking' ? 0.09 :
        sideTeam.tactics.mentality === 'attacking' ? 0.05 :
        sideTeam.tactics.mentality === 'defensive' ? -0.04 :
        sideTeam.tactics.mentality === 'ultra-defensive' ? -0.08 : 0;
      tx = clamp(actor.homeX + direction * mentalityShift + (this.ball.x - 0.5) * 0.12, 0.04, 0.96);
      const widthScale = sideTeam.tactics.width === 'wide' ? 1.14 : sideTeam.tactics.width === 'narrow' ? 0.78 : 1;
      ty = clamp(0.5 + (actor.homeY - 0.5) * widthScale, 0.06, 0.94);
    }

    const dx = tx - actor.x;
    const dy = ty - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const opponentFactor = actor.side === this.controlledSide
      ? 1
      : this.difficulty === 'easy' ? 0.88 : this.difficulty === 'hard' ? 1.12 : 1;
    const speed = this.actorSpeed(actor) * 0.82 * opponentFactor;
    actor.vx = (dx / length) * speed;
    actor.vy = (dy / length) * speed;
    if (length > 0.006) {
      actor.facingX = dx / length;
      actor.facingY = dy / length;
    }
    actor.x = clamp(actor.x + actor.vx * dt, 0.02, 0.98);
    actor.y = clamp(actor.y + actor.vy * dt, 0.035, 0.965);
    actor.stamina = clamp(actor.stamina - 0.18 * dt, 0, 100);
  }

  private actorSpeed(actor: ArcadeActor): number {
    const role = getRole((actor.side === 'home' ? this.home : this.away).formation.slots.find((slot) => slot.playerId === actor.player.id)?.roleId ?? 'cm');
    const rating = effectiveRating(actor.player, role, actor.player.position);
    return (0.055 + actor.player.attributes.pace / 1600) * (0.72 + rating / 360) * (0.75 + actor.stamina / 400);
  }

  private handleActionEdges(input: InputFrame): void {
    const actor = this.actors.find((candidate) => candidate.player.id === this.selectedPlayerId);
    if (!actor) return;
    if (input.pass && !this.previousInput.pass) {
      if (this.ball.ownerId === actor.player.id) this.pass(actor, false);
      else this.attemptTackle(actor);
    }
    if (input.through && !this.previousInput.through && this.ball.ownerId === actor.player.id) this.pass(actor, true);
    if (input.shoot && !this.previousInput.shoot) {
      if (this.ball.ownerId === actor.player.id) this.shoot(actor, 1);
      else this.attemptTackle(actor, true);
    }
  }

  private pass(actor: ArcadeActor, through: boolean): void {
    const teammates = this.actors.filter((candidate) => candidate.side === actor.side && candidate.player.id !== actor.player.id);
    const direction = actor.side === 'home' ? 1 : -1;
    const target = teammates
      .map((candidate) => ({
        candidate,
        score:
          (candidate.x - actor.x) * direction * (through ? 2 : 1) -
          Math.abs(candidate.y - (actor.y + actor.facingY * 0.12)) * 0.8 -
          distance(candidate, actor) * 0.25,
      }))
      .sort((a, b) => b.score - a.score)[0]?.candidate;
    if (!target) return;

    if (this.isOffside(target, actor)) {
      this.events.push({
        minute: this.footballMinute,
        type: 'foul',
        side: actor.side,
        playerId: target.player.id,
        messageKey: 'match.offside',
        params: { player: playerName(target.player) },
      });
      this.givePossession(actor.side === 'home' ? 'away' : 'home');
      return;
    }

    const dx = target.x + (through ? direction * 0.09 : 0) - actor.x;
    const dy = target.y - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const accuracy = actor.player.attributes.passing / 100;
    this.releaseBall(actor, (dx / length) * (0.58 + accuracy * 0.2), (dy / length) * (0.58 + accuracy * 0.2));
  }

  private shoot(actor: ArcadeActor, power: number): void {
    const direction = actor.side === 'home' ? 1 : -1;
    const targetX = actor.side === 'home' ? 1.02 : -0.02;
    const accuracy = actor.player.attributes.shooting / 100;
    const targetY = clamp(0.5 + (this.rng.next() - 0.5) * (0.34 - accuracy * 0.22), 0.34, 0.66);
    const dx = targetX - actor.x;
    const dy = targetY - actor.y;
    const length = Math.hypot(dx, dy) || 1;
    const stats = actor.side === 'home' ? this.homeStats : this.awayStats;
    stats.shots++;
    if (Math.abs(targetY - 0.5) < 0.14) stats.shotsOnTarget++;
    this.releaseBall(actor, (dx / length) * (0.85 + accuracy * 0.35) * power, (dy / length) * (0.85 + accuracy * 0.35) * power);
    this.ball.vx += direction * 0.12;
  }

  private releaseBall(actor: ArcadeActor, vx: number, vy: number): void {
    this.ball.ownerId = null;
    this.ball.x = actor.x + actor.facingX * 0.025;
    this.ball.y = actor.y + actor.facingY * 0.025;
    this.ball.vx = vx;
    this.ball.vy = vy;
    this.ball.lastTouch = actor.side;
    this.ball.lastTouchPlayerId = actor.player.id;
  }

  private resolveTackles(dt: number): void {
    const owner = this.owner();
    if (!owner) return;
    for (const defender of this.actors) {
      if (defender.side === owner.side || defender.player.positionGroup === 'GK') continue;
      if (distance(defender, owner) > 0.024) continue;
      const team = defender.side === 'home' ? this.home : this.away;
      const press = team.tactics.pressing === 'gegenpress' ? 1.55 : team.tactics.pressing === 'high' ? 1.25 : 1;
      if (this.rng.bool(dt * (0.3 + defender.player.attributes.defending / 120) * press)) this.attemptTackle(defender);
    }
  }

  private attemptTackle(actor: ArcadeActor, aggressive = false): void {
    const owner = this.owner();
    if (!owner || owner.side === actor.side || distance(actor, owner) > 0.045) return;
    const winChance = clamp(
      0.34 + (actor.player.attributes.defending - owner.player.attributes.dribbling) / 180 + (aggressive ? 0.09 : 0),
      0.12,
      0.78,
    );
    const ownStats = actor.side === 'home' ? this.homeStats : this.awayStats;
    if (this.rng.bool(winChance)) {
      this.ball.ownerId = actor.player.id;
      this.ball.lastTouch = actor.side;
      this.ball.lastTouchPlayerId = actor.player.id;
      this.ratings[actor.player.id] = clamp((this.ratings[actor.player.id] ?? 6.5) + 0.08, 1, 10);
    } else if (this.rng.bool(aggressive ? 0.42 : 0.16)) {
      ownStats.fouls++;
      const yellow = this.rng.bool(aggressive ? 0.35 : 0.12);
      if (yellow) {
        ownStats.yellows++;
        this.contributions[actor.player.id].yellows++;
      }
      this.events.push({
        minute: this.footballMinute,
        type: yellow ? 'yellow' : 'foul',
        side: actor.side,
        playerId: actor.player.id,
        messageKey: yellow ? 'match.yellow' : 'match.foul',
        params: { player: playerName(actor.player) },
      });
      this.ball.ownerId = owner.player.id;
    }
  }

  private updateBall(dt: number): void {
    const owner = this.owner();
    if (owner) {
      this.ball.x = owner.x + owner.facingX * 0.018;
      this.ball.y = owner.y + owner.facingY * 0.018;
      this.ball.vx = owner.vx;
      this.ball.vy = owner.vy;
      this.ball.lastTouch = owner.side;
      return;
    }

    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.vx *= Math.pow(0.18, dt);
    this.ball.vy *= Math.pow(0.18, dt);

    if (this.ball.x > 1 || this.ball.x < 0) {
      if (this.ball.y > 0.37 && this.ball.y < 0.63) {
        this.scoreGoal(this.ball.x > 1 ? 'home' : 'away');
        return;
      }
      const attackingSide: Side = this.ball.x > 1 ? 'home' : 'away';
      const corner = this.ball.lastTouch !== attackingSide;
      const stats = attackingSide === 'home' ? this.homeStats : this.awayStats;
      if (corner) stats.corners++;
      this.events.push({
        minute: this.footballMinute,
        type: corner ? 'corner' : 'commentary',
        side: corner ? attackingSide : null,
        playerId: null,
        messageKey: corner ? 'match.corner' : 'match.goalKick',
        params: { team: (attackingSide === 'home' ? this.home : this.away).shortName },
      });
      this.givePossession(corner ? attackingSide : attackingSide === 'home' ? 'away' : 'home');
      return;
    }

    if (this.ball.y < 0 || this.ball.y > 1) {
      const side = this.ball.lastTouch === 'home' ? 'away' : 'home';
      this.events.push({
        minute: this.footballMinute,
        type: 'commentary',
        side,
        playerId: null,
        messageKey: 'match.throwIn',
        params: { team: (side === 'home' ? this.home : this.away).shortName },
      });
      this.givePossession(side);
      return;
    }

    const candidate = this.actors
      .filter((actor) => distance(actor, this.ball) < (actor.player.positionGroup === 'GK' ? 0.034 : 0.022))
      .sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0];
    if (candidate) {
      this.ball.ownerId = candidate.player.id;
      this.ball.lastTouch = candidate.side;
      if (candidate.side === this.controlledSide) this.selectedPlayerId = candidate.player.id;
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
    this.events.push({
      minute: this.footballMinute,
      type: 'goal',
      side,
      playerId: scorer?.player.id ?? null,
      playerName: scorer ? playerName(scorer.player) : undefined,
      messageKey: 'match.goal.solo',
      params: { player: scorer ? playerName(scorer.player) : (side === 'home' ? this.home.shortName : this.away.shortName) },
    });
    this.resetKickoff(side === 'home' ? 'away' : 'home');
  }

  private resetKickoff(side: Side): void {
    for (const actor of this.actors) {
      actor.x = actor.homeX;
      actor.y = actor.homeY;
      actor.vx = 0;
      actor.vy = 0;
    }
    this.ball.x = 0.5;
    this.ball.y = 0.5;
    this.ball.vx = 0;
    this.ball.vy = 0;
    const kickoff = this.actors
      .filter((actor) => actor.side === side && actor.player.positionGroup !== 'GK')
      .sort((a, b) => Math.abs(a.x - 0.5) - Math.abs(b.x - 0.5))[0];
    this.ball.ownerId = kickoff?.player.id ?? null;
    this.ball.lastTouch = side;
    this.ball.lastTouchPlayerId = kickoff?.player.id ?? null;
  }

  private givePossession(side: Side): void {
    const actor = this.actors
      .filter((candidate) => candidate.side === side)
      .sort((a, b) => distance(a, this.ball) - distance(b, this.ball))[0];
    if (!actor) return;
    this.ball.x = clamp(this.ball.x, 0.06, 0.94);
    this.ball.y = clamp(this.ball.y, 0.06, 0.94);
    actor.x = this.ball.x;
    actor.y = this.ball.y;
    this.ball.ownerId = actor.player.id;
    this.ball.lastTouch = side;
    this.ball.lastTouchPlayerId = actor.player.id;
  }

  private owner(): ArcadeActor | undefined {
    return this.actors.find((actor) => actor.player.id === this.ball.ownerId);
  }

  private isOffside(target: ArcadeActor, passer: ArcadeActor): boolean {
    if ((passer.side === 'home' && target.x < 0.5) || (passer.side === 'away' && target.x > 0.5)) return false;
    const defenders = this.actors
      .filter((actor) => actor.side !== passer.side)
      .map((actor) => actor.x)
      .sort((a, b) => a - b);
    if (defenders.length < 2) return false;
    return passer.side === 'home'
      ? target.x > defenders[defenders.length - 2] && target.x > passer.x
      : target.x < defenders[1] && target.x < passer.x;
  }

  private updatePossessionStats(dt: number): void {
    const owner = this.owner();
    if (owner?.side === 'home') this.possessionHomeSeconds += dt;
    else if (owner?.side === 'away') this.possessionAwaySeconds += dt;
    const total = this.possessionHomeSeconds + this.possessionAwaySeconds || 1;
    this.homeStats.possession = Math.round((this.possessionHomeSeconds / total) * 100);
    this.awayStats.possession = 100 - this.homeStats.possession;
  }

  private recordKeyframe(): void {
    const minute = this.footballMinute;
    if (minute % 3 !== 0 || minute === this.lastKeyframeMinute) return;
    this.lastKeyframeMinute = minute;
    this.keyframes.push({
      minute,
      ball: { x: clamp(this.ball.x, 0, 1), y: clamp(this.ball.y, 0, 1) },
      homeInPossession: this.owner()?.side === 'home',
    });
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.elapsed = this.totalSeconds;
    this.events.push({
      minute: 90,
      type: 'fulltime',
      side: null,
      playerId: null,
      messageKey: 'match.fulltime',
      params: { home: this.home.shortName, away: this.away.shortName, homeScore: this.homeScore, awayScore: this.awayScore },
    });
    const all = this.actors.map((actor) => actor.player);
    const motm = [...all].sort((a, b) => (this.ratings[b.id] ?? 0) - (this.ratings[a.id] ?? 0))[0]?.id ?? null;
    this.finalResult = {
      id: uid('match'),
      week: 0,
      homeTeamId: this.home.id,
      awayTeamId: this.away.id,
      homeTeamName: this.home.name,
      awayTeamName: this.away.name,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      events: [...this.events],
      homeStats: this.finishStats(this.homeStats, this.home),
      awayStats: this.finishStats(this.awayStats, this.away),
      keyframes: [...this.keyframes],
      manOfTheMatchId: motm,
      ratings: { ...this.ratings },
      contributions: structuredClone(this.contributions),
      played: true,
    };
  }

  private finishStats(stats: TeamMatchStats, team: Team): TeamMatchStats {
    const midfield = team.formation.slots
      .map((slot) => team.players.find((player) => player.id === slot.playerId)?.attributes.passing ?? 55)
      .reduce((sum, value, _, values) => sum + value / values.length, 0);
    stats.passAccuracy = clamp(Math.round(58 + midfield * 0.35), 58, 94);
    return { ...stats };
  }
}
