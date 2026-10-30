/**
 * Match situations a modifier can depend on. Bit flags keep the per-tick evaluation free of
 * allocations: the engine refreshes one integer per player and modifiers test it with a mask.
 */
export const Cond = {
  home: 1 << 0,
  away: 1 << 1,
  inOwnBox: 1 << 2,
  inOppBox: 1 << 3,
  inOppHalf: 1 << 4,
  /** Minute 75 or later (including extra time). */
  late: 1 << 5,
  losing: 1 << 6,
  winning: 1 << 7,
  level: 1 << 8,
  /** The side won the ball within the last four seconds and still has it. */
  counter: 1 << 9,
  setPiece: 1 << 10,
  penalty: 1 << 11,
  lowStamina: 1 << 12,
  extraTime: 1 << 13,
  /** The opponent has the ball. */
  outOfPossession: 1 << 14,
  /** The ball carrier has an opponent within three metres. */
  underPressure: 1 << 15,
  /** A goalkeeper whose goal is being shot at. */
  facingShot: 1 << 16,
  rain: 1 << 17,
  storm: 1 << 18,
  derby: 1 << 19,
  bigMatch: 1 << 20,
  /** Signature slot 1 is awake; the pipeline maps the data files' marker to the slot of the player. */
  signature: 1 << 21,
  signature2: 1 << 22,
  /** The home stadium plays under floodlights. */
  night: 1 << 23,
  /** Clear weather (neither rain nor storm). */
  clear: 1 << 24,
  /** The Mythic ultimate of the player is running. */
  ultimate: 1 << 25,
} as const;

export type CondFlag = (typeof Cond)[keyof typeof Cond];

/** True when every flag of `mask` is set (an empty mask always matches) and none of `unless` is. */
export function condMatches(flags: number, mask: number | undefined, unless?: number): boolean {
  return (!mask || (flags & mask) === mask) && (!unless || (flags & unless) === 0);
}
