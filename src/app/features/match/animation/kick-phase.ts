/**
 * Timing of the kicking leg, read from the simulation: the pose swings back during the wind-up, reaches the ball at exactly
 * the contact tick (`ACTION_CONTACT_TICKS`) and follows through afterwards. Pure functions of ticks, so the studio, the match,
 * replays and the tests all show the same thing.
 */

/** Position of the wind-up: foot a little back from the charge pose at the release tick. */
const START = -0.3;
/** Share of the wind-up spent travelling back; the rest accelerates through the ball. */
const BACK_SHARE = 0.55;
/** Value of the swing at the moment of contact (1 is the follow-through peak). */
export const SWING_AT_CONTACT = 0.5;
/** Ticks after contact until the follow-through peaks. */
const FOLLOW_TICKS = 6;

function easeOut(t: number): number { const u = Math.min(1, Math.max(0, t)); return 1 - (1 - u) * (1 - u); }
export function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Kicking-leg swing for a kick that touches the ball `contact` ticks after the release and is over after `duration` ticks.
 * Returns -1 (leg fully back), 0 (rest), `SWING_AT_CONTACT` at the ball, 1 at the follow-through peak. Ticks may be fractional.
 */
export function kickSwing(ticks: number, contact: number, duration: number): number {
  if (ticks >= duration) return 0;
  const t = Math.max(0, ticks);
  if (contact > 0 && t < contact) {
    const share = t / contact;
    if (share < BACK_SHARE) return START + (-1 - START) * easeOut(share / BACK_SHARE);
    const u = (share - BACK_SHARE) / (1 - BACK_SHARE);
    return -1 + (SWING_AT_CONTACT + 1) * u * u;
  }
  const after = t - contact;
  const peak = SWING_AT_CONTACT + (1 - SWING_AT_CONTACT) * Math.sin(Math.min(1, after / FOLLOW_TICKS) * Math.PI / 2);
  const settle = 1 - smooth(contact + FOLLOW_TICKS + 2, duration, t);
  return peak * settle;
}

/**
 * Knee bend of the kicking leg over the same timeline: bends while the foot goes back, whips open through the ball and
 * straightens in the follow-through. `atContact` is the bend left when the foot meets the ball (chips keep more).
 */
export function kickKnee(ticks: number, contact: number, duration: number, atContact = 0.35): number {
  if (ticks >= duration) return 0;
  const t = Math.max(0, ticks);
  if (contact > 0 && t < contact) {
    const share = t / contact;
    if (share < BACK_SHARE) return 0.3 + 1.2 * easeOut(share / BACK_SHARE);
    const u = (share - BACK_SHARE) / (1 - BACK_SHARE);
    return 1.5 + (atContact - 1.5) * Math.pow(u, 1.5);
  }
  const after = t - contact;
  return atContact * (1 - Math.min(1, after / FOLLOW_TICKS)) * (1 - smooth(contact + FOLLOW_TICKS + 2, duration, t));
}

/**
 * A feint: the leg winds up as if to shoot, then the movement is cut short and the foot is brought back without touching
 * the ball. Never moves forward past rest.
 */
export function fakeSwing(ticks: number, duration: number): number {
  if (ticks <= 0 || ticks >= duration) return 0;
  const rise = Math.min(1, ticks / 5);
  return -easeOut(rise) * (1 - smooth(8, duration, ticks));
}

/** Length of the cross-fade into an action: short for kicks with a wind-up, so the swing is not smeared out by the blend. */
export function blendSecondsFor(contactTicks: number | undefined, base = 0.14): number {
  return contactTicks && contactTicks > 0 ? Math.max(0.025, Math.min(base, contactTicks / 60 * 0.35)) : base;
}

/**
 * Load on the injured leg during a limping step: 1 at mid-stance of that leg, 0 while it swings. `cycle` is the gait cycle,
 * `hurtSide` is 0 for the left and 0.5 for the right leg (the offset the gait gives each foot).
 */
export function limpLoad(cycle: number, hurtOffset: number): number {
  const t = (((cycle + hurtOffset) % 1) + 1) % 1;
  return t < 0.25 ? Math.sin(Math.min(1, t / 0.25) * Math.PI) : 0;
}
