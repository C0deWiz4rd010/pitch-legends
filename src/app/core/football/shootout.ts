import { Rng } from '../util';
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
export function kickOutcome(shooting: number, goalkeeping: number, bonus: number, choice: KickChoice, dive: Aim, rng: Rng): KickOutcome {
  const base = shootoutConversionChance(shooting, goalkeeping, bonus);
  const missChance = choice.power ? 0.1 : choice.aim === 0 ? 0.01 : 0.04;
  if (rng.bool(missChance)) return { scored: false, saved: false, offTarget: true };
  const guessed = dive === choice.aim;
  const chance = guessed ? base * (choice.power ? 0.74 : 0.55) : Math.min(0.98, 0.62 + base * 0.5 + (choice.power ? 0.04 : 0));
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
export function shootoutDecided(goals: { home: number; away: number }, taken: { home: number; away: number }, round: number, secondOfRound: boolean): boolean {
  if (round < 5 && (goals.home + 5 - taken.home < goals.away || goals.away + 5 - taken.away < goals.home)) return true;
  return secondOfRound && round >= 4 && goals.home !== goals.away;
}
