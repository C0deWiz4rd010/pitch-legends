import { smooth } from './animation/kick-phase';

/** Length of the walk-on in seconds; with reduced motion the teams simply stand lined up for a moment. */
export const INTRO_SECONDS = 7.6;
export const INTRO_SECONDS_REDUCED = 2.6;

/** Jog speed of the walk-on (m/s), the gap between two players of a column (s) and the spacing of the line-up (m). */
const JOG = 7.5, GAP = 0.16, SPACING = 1.3, FIRST = 1.6;
/** Where the columns come into view (scene z, in front of the tunnel) and where the teams line up. */
const START_Z = -30, LINE_Z = -6;

export interface IntroPlacement {
  /** Scene coordinates: x along the pitch from its centre, z across (negative is the far side). */
  x: number; z: number;
  /** Velocity and facing in the scene. */
  vx: number; vz: number; facingX: number; facingZ: number;
  /** Metres run so far (drives the stride) and whether the player stands in the line. */
  distance: number; arrived: boolean;
}

/**
 * Where a player is during the walk-on. Both teams jog out of the tunnel in two columns, turn at the halfway line and
 * fan out into a row facing the main stand: the home side to the left of the centre, the away side to the right.
 * `index` is the player's place in his team (0 stands next to the centre); the first one out takes the far end of the row.
 */
export function introPlacement(index: number, home: boolean, elapsed: number, count = 11): IntroPlacement {
  const outward = home ? -1 : 1;
  const column = outward * 1.0, slot = outward * (FIRST + index * SPACING);
  const straight = LINE_Z - START_Z, lateral = Math.abs(slot - column), total = straight + lateral;
  const run = (elapsed - (count - 1 - index) * GAP) * JOG;
  if (run >= total) return { x: slot, z: LINE_Z, vx: 0, vz: 0, facingX: 0, facingZ: 1, distance: total, arrived: true };
  if (run <= straight) return { x: column, z: START_Z + run, vx: 0, vz: JOG, facingX: 0, facingZ: 1, distance: Math.max(0, run), arrived: false };
  return { x: column + outward * (run - straight), z: LINE_Z, vx: outward * JOG, vz: 0, facingX: outward, facingZ: 0, distance: run, arrived: false };
}

/** Seconds after which every player of a team of `count` stands in the line. */
export function introLineUpTime(count = 11): number {
  let latest = 0;
  for (let index = 0; index < count; index++) latest = Math.max(latest, (count - 1 - index) * GAP + (LINE_Z - START_Z + FIRST + index * SPACING - 1) / JOG);
  return latest;
}

export interface IntroShot { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number; fov: number }

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** How far either side of the centre the ride along the line-up goes (m). */
const RIDE_END = 11;
const ease = (t: number) => smooth(0, 1, t);

/**
 * The camera of the walk-on, in three joined moves that never jump: a crane shot down from high above the tunnel to the
 * home end of the line, a slow ride along the row at chest height while the last players arrive, and a gentle lift before
 * the cut to the match camera. With reduced motion it is one still picture.
 */
export function introShot(elapsed: number, reduced: boolean): IntroShot {
  if (reduced) return { x: 0, y: 6.5, z: 9, lookX: 0, lookY: 1.2, lookZ: LINE_Z, fov: 46 };
  const ride = 4.7, out = INTRO_SECONDS - 0.8, end = RIDE_END;
  if (elapsed < ride) {
    const t = ease(elapsed / ride);
    return { x: mix(14, -end, t), y: mix(24, 2.4, t), z: mix(24, 3.4, t), lookX: mix(0, -end * 0.9, t), lookY: 1.3, lookZ: mix(-34, LINE_Z, t), fov: mix(46, 40, t) };
  }
  if (elapsed < out) {
    const t = ease((elapsed - ride) / (out - ride));
    const x = mix(-end, end, t);
    return { x, y: mix(2.4, 1.7, t), z: mix(3.4, 2.2, t), lookX: x * 0.9, lookY: 1.3, lookZ: LINE_Z, fov: 40 };
  }
  const t = ease(Math.min(1, (elapsed - out) / (INTRO_SECONDS - out)));
  return { x: mix(end, 5, t), y: mix(1.7, 7, t), z: mix(2.2, 10, t), lookX: mix(end * 0.9, 0, t), lookY: mix(1.3, 0.4, t), lookZ: mix(LINE_Z, -2, t), fov: mix(40, 44, t) };
}
