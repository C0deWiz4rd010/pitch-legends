import type { MatchEvent, PenaltyShootout, Side } from '../../models/match.model';
import { Rng } from '../util';
import type { ArcadeActor } from './match-types';
import { shootoutConversionChance } from './penalty';

/** Left, centre or right from the shooter's point of view (the keeper dives to the same side labels). */
export type Aim = -1 | 0 | 1;

export interface KickChoice {
  aim: Aim;
  /** A hard kick: harder to save, but it can miss the target. */
  power: boolean;
}

export interface KickOutcome {
  scored: boolean;
  saved: boolean;
  offTarget: boolean;
}

/**
 * One penalty of an interactive shoot-out. The base chance is the same formula the automatic shoot-out
 * uses; the choices bend it: a keeper who guesses the corner saves most placed kicks, one who guesses
 * wrong almost never stops them, power beats a correct guess more often but sometimes misses the goal.
 */
export function kickOutcome(
  shooting: number,
  goalkeeping: number,
  bonus: number,
  choice: KickChoice,
  dive: Aim,
  rng: Rng,
): KickOutcome {
  const base = shootoutConversionChance(shooting, goalkeeping, bonus);
  const missChance = choice.power ? 0.1 : choice.aim === 0 ? 0.01 : 0.04;
  if (rng.bool(missChance)) return { scored: false, saved: false, offTarget: true };
  const guessed = dive === choice.aim;
  const chance = guessed
    ? base * (choice.power ? 0.74 : 0.55)
    : Math.min(0.98, 0.62 + base * 0.5 + (choice.power ? 0.04 : 0));
  const scored = rng.bool(chance);
  return { scored, saved: !scored, offTarget: false };
}

/** What an AI shooter does: mostly a corner, sometimes down the middle, now and then a hard one. */
export function aiShooterChoice(rng: Rng): KickChoice {
  const roll = rng.next();
  return { aim: roll < 0.4 ? -1 : roll < 0.8 ? 1 : 0, power: rng.bool(0.25) };
}

/** What an AI keeper does: a guess between the corners and the middle. */
export function aiKeeperDive(rng: Rng): Aim {
  const roll = rng.next();
  return roll < 0.4 ? -1 : roll < 0.8 ? 1 : 0;
}

/**
 * Whether the shoot-out is over after a kick: within the first five each as soon as one side can no
 * longer catch up, afterwards when a full round (both sides kicked) leaves a leader.
 */
export function shootoutDecided(
  goals: { home: number; away: number },
  taken: { home: number; away: number },
  round: number,
  secondOfRound: boolean,
): boolean {
  if (
    round < 5 &&
    (goals.home + 5 - taken.home < goals.away || goals.away + 5 - taken.away < goals.home)
  )
    return true;
  return secondOfRound && round >= 4 && goals.home !== goals.away;
}

/** What the shoot-out needs from the match it belongs to. */
export interface ShootoutHost {
  readonly controlledSide: Side;
  readonly rng: Rng;
  readonly actors: readonly ArcadeActor[];
  readonly events: MatchEvent[];
  /** Penalty-taking rating of a player (shooting with penalty traits applied). */
  shooting(actor: ArcadeActor): number;
  goalkeeping(actor: ArcadeActor): number;
  shortName(side: Side): string;
  /** The shoot-out is over: the match stores it and finishes. */
  complete(shootout: PenaltyShootout): void;
}

/** What the match page asks the player during an interactive shoot-out. */
export interface ShootoutPrompt {
  role: 'shoot' | 'dive';
  shooterSide: Side;
  round: number;
  takerName: string;
  keeperName: string;
  takerShooting: number;
  keeperGoalkeeping: number;
  goals: Record<Side, number>;
  shootout: PenaltyShootout;
}

const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

/** One shoot-out, played kick by kick by a human or settled in one go by the automatic path. */
export class ShootoutSession {
  private readonly order: Record<Side, ArcadeActor[]>;
  private readonly shootout: PenaltyShootout = {
    home: [],
    away: [],
    takers: { home: [], away: [] },
    winner: 'home',
  };
  private readonly goals: Record<Side, number> = { home: 0, away: 0 };
  private round = 0;
  private turn: Side = 'home';
  decided = false;

  constructor(private readonly host: ShootoutHost) {
    this.order = { home: this.orderOf('home'), away: this.orderOf('away') };
  }

  /** Penalty takers of a side: best shooters first, the keeper last. */
  private orderOf(side: Side): ArcadeActor[] {
    return this.host.actors
      .filter((actor) => actor.active && actor.side === side)
      .sort(
        (a, b) =>
          (a.player.positionGroup === 'GK' ? 1 : 0) - (b.player.positionGroup === 'GK' ? 1 : 0) ||
          this.host.shooting(b) - this.host.shooting(a),
      );
  }

  private takerOf(side: Side): ArcadeActor | undefined {
    const list = this.order[side];
    return list[this.round % Math.max(1, list.length)];
  }

  private keeperAgainst(side: Side): ArcadeActor | undefined {
    return this.host.actors.find(
      (actor) => actor.active && actor.side === other(side) && actor.player.positionGroup === 'GK',
    );
  }

  private name(actor: ArcadeActor | undefined): string {
    return actor ? `${actor.player.firstName} ${actor.player.lastName}` : '—';
  }

  get prompt(): ShootoutPrompt | null {
    if (this.decided) return null;
    const side = this.turn;
    const taker = this.takerOf(side);
    const keeper = this.keeperAgainst(side);
    return {
      role: side === this.host.controlledSide ? 'shoot' : 'dive',
      shooterSide: side,
      round: this.round + 1,
      takerName: this.name(taker),
      keeperName: this.name(keeper),
      takerShooting: taker ? Math.round(this.host.shooting(taker)) : 50,
      keeperGoalkeeping: keeper ? Math.round(this.host.goalkeeping(keeper)) : 50,
      goals: { ...this.goals },
      shootout: structuredClone(this.shootout),
    };
  }

  private note(side: Side, taker: ArcadeActor | undefined, scored: boolean): void {
    if (!taker) return;
    this.host.events.push({
      minute: 120,
      type: 'commentary',
      side,
      playerId: taker.player.id,
      messageKey: scored ? 'match.shootoutScored' : 'match.shootoutMissed',
      params: { player: this.name(taker), home: this.goals.home, away: this.goals.away },
    });
  }

  /** Plays the next kick of an interactive shoot-out: the human decides his side, the AI the other. */
  play(choice: {
    aim?: Aim;
    power?: boolean;
    dive?: Aim;
  }): (KickOutcome & { side: Side; takerId: string }) | null {
    if (this.decided) return null;
    const side = this.turn;
    const taker = this.takerOf(side);
    const keeper = this.keeperAgainst(side);
    const humanShoots = side === this.host.controlledSide;
    const rng = this.host.rng;
    const kick: KickChoice = humanShoots
      ? { aim: choice.aim ?? 0, power: !!choice.power }
      : aiShooterChoice(rng);
    const dive: Aim = humanShoots ? aiKeeperDive(rng) : (choice.dive ?? 0);
    const outcome: KickOutcome = taker
      ? kickOutcome(
          this.host.shooting(taker),
          keeper ? this.host.goalkeeping(keeper) : 60,
          0,
          kick,
          dive,
          rng,
        )
      : { scored: false, saved: false, offTarget: true };
    this.record(side, taker, outcome.scored);
    const secondOfRound = side === 'away';
    if (
      shootoutDecided(
        this.goals,
        { home: this.shootout.home.length, away: this.shootout.away.length },
        this.round,
        secondOfRound,
      ) ||
      (this.round >= 29 && secondOfRound)
    ) {
      this.finish();
    } else if (secondOfRound) {
      this.round++;
      this.turn = 'home';
    } else this.turn = 'away';
    return { ...outcome, side, takerId: taker?.player.id ?? '' };
  }

  private record(side: Side, taker: ArcadeActor | undefined, scored: boolean): void {
    this.shootout[side].push(scored);
    this.shootout.takers[side].push(taker?.player.id ?? '');
    if (scored) this.goals[side]++;
    this.note(side, taker, scored);
  }

  private conclude(): PenaltyShootout {
    this.shootout.winner =
      this.goals.home >= this.goals.away && this.goals.home !== this.goals.away
        ? 'home'
        : this.goals.home < this.goals.away
          ? 'away'
          : 'home';
    this.host.events.push({
      minute: 120,
      type: 'commentary',
      side: this.shootout.winner,
      playerId: null,
      messageKey: 'match.shootoutWinner',
      params: {
        team: this.host.shortName(this.shootout.winner),
        home: this.goals.home,
        away: this.goals.away,
      },
    });
    this.decided = true;
    return this.shootout;
  }

  private finish(): void {
    this.host.complete(this.conclude());
  }

  /** The automatic shoot-out: every kick is one roll against the closed-form conversion chance. */
  resolveAutomatically(): PenaltyShootout {
    for (let round = 0; round < 30 && !this.decided; round++) {
      this.round = round;
      for (const side of ['home', 'away'] as const) {
        const taker = this.takerOf(side);
        if (!taker) continue;
        const keeper = this.keeperAgainst(side);
        const chance = shootoutConversionChance(
          this.host.shooting(taker),
          keeper ? this.host.goalkeeping(keeper) : 60,
        );
        this.record(side, taker, this.host.rng.bool(chance));
        // Within the first five each, stop as soon as one side can no longer catch up.
        if (
          round < 5 &&
          (this.goals.home + 5 - this.shootout.home.length < this.goals.away ||
            this.goals.away + 5 - this.shootout.away.length < this.goals.home)
        ) {
          this.decided = true;
          break;
        }
      }
      if (!this.decided && round >= 4 && this.goals.home !== this.goals.away) this.decided = true;
    }
    return this.conclude();
  }
}
