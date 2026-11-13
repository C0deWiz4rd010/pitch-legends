import { PlayerActionState } from '../../../models/match.model';
import type { ProceduralFootballer } from '../three-player.factory';
import { fakeSwing, kickKnee, kickSwing, smooth } from './kick-phase';

/**
 * Whole-action poses that follow the simulation's timeline: wind-up, contact tick, follow-through. Every function takes the
 * ticks since the release (fractional is fine) and writes joint rotations additively on top of the locomotion pose. Contact
 * accuracy of the foot itself stays with the contact IK in the factory; these poses bring the limb to the ball on time.
 */

interface KickStyle {
  /** Extra forward reach of the follow-through, in radians. */
  follow: number;
  /** 0 to 1 scale of the leg swing. */
  strength: number;
  /** Forward lean of the body at the strike (negative leans back). */
  torso: number;
  /** Twist of the shoulders against and through the kick. */
  twist: number;
  /** Knee bend left at the ball. */
  knee: number;
  /** Inside-of-the-foot kicks open the foot. */
  open?: boolean;
  /** Both feet leave the ground. */
  hop?: number;
  /** How far the body leans away from the kicking leg in the air (1 is the volley). */
  lean?: number;
}

const KICK_STYLES: Partial<Record<PlayerActionState, KickStyle>> = {
  pass: { follow: 0.66, strength: 0.75, torso: 0.18, twist: 0.32, knee: 0.35, open: true },
  'through-pass': { follow: 0.66, strength: 0.75, torso: 0.18, twist: 0.32, knee: 0.35, open: true },
  lob: { follow: 0.85, strength: 1, torso: 0.18, twist: 0.45, knee: 0.45 },
  shot: { follow: 1.05, strength: 1, torso: 0.24, twist: 0.32, knee: 0.3 },
  'low-shot': { follow: 1.05, strength: 1, torso: 0.24, twist: 0.32, knee: 0.3 },
  'finesse-shot': { follow: 0.66, strength: 1, torso: 0.18, twist: 0.32, knee: 0.4, open: true },
  'chip-shot': { follow: 0.35, strength: 1, torso: -0.12, twist: 0.2, knee: 0.7 },
  volley: { follow: 1.25, strength: 1, torso: -0.2, twist: 0.3, knee: 0.25, hop: 0.12 },
  'side-volley': { follow: 1.35, strength: 1, torso: -0.3, twist: 0.6, knee: 0.15, hop: 0.2, lean: 2.2 },
};

/** Kicks with a simulated wind-up: the foot goes back, reaches the ball at the contact tick, follows through. */
export function poseKick(model: ProceduralFootballer, action: PlayerActionState, side: 'left' | 'right', ticks: number, contact: number, duration: number): void {
  const j = model.joints;
  const style = KICK_STYLES[action] ?? KICK_STYLES['pass']!;
  const other = side === 'right' ? 'left' : 'right';
  const sign = side === 'right' ? 1 : -1;
  const swing = kickSwing(ticks, contact, duration);
  const back = Math.max(0, -swing), forward = Math.max(0, swing);
  // The standing leg plants early and stays planted until the follow-through is over.
  const plant = smooth(0, Math.max(1, contact * 0.5), ticks) * (1 - smooth(contact + 8, duration, ticks));
  j[`${side}Thigh`].rotation.x = back * 0.55 - Math.pow(forward, 0.8) * (0.62 + style.follow * style.strength);
  j[`${side}Shin`].rotation.x = kickKnee(ticks, contact, duration, style.knee);
  j[`${side}Foot`].rotation.x = 0.22 * forward - 0.12 * back;
  if (style.open) j[`${side}Foot`].rotation.y = -sign * 0.55 * forward;
  j[`${other}Shin`].rotation.x += (style.hop ? 0.5 : style.follow > 0.9 ? 0.28 : 0.16) * plant;
  j.spine.rotation.x += style.torso * forward - 0.10 * back;
  j.chest.rotation.y += sign * style.twist * 0.8 * back - sign * style.twist * forward;
  j.leftArm.rotation.z += 0.55 * plant;
  j.rightArm.rotation.z -= 0.55 * plant;
  j[`${other}Arm`].rotation.x += -0.5 * back - 0.4 * forward * style.strength;
  if (style.hop) {
    // A volley is hit in the air: a little hop, leaning away from the leg, with the arms thrown wide.
    const air = Math.sin(Math.min(1, ticks / (contact + 10)) * Math.PI);
    j.hips.position.y += style.hop * air;
    j.spine.rotation.z += -sign * 0.28 * (style.lean ?? 1) * forward;
    j.leftArm.rotation.z += 0.45 * forward;
    j.rightArm.rotation.z -= 0.45 * forward;
  }
}

/** A feint: the leg winds up for a shot, the movement is cut short and the body sways the other way. */
export function poseFakeShot(model: ProceduralFootballer, side: 'left' | 'right', ticks: number, duration: number): void {
  const j = model.joints;
  const other = side === 'right' ? 'left' : 'right';
  const sign = side === 'right' ? 1 : -1;
  const back = -fakeSwing(ticks, duration);
  const sway = Math.sin(Math.min(1, Math.max(0, ticks - 4) / Math.max(1, duration - 4)) * Math.PI);
  j[`${side}Thigh`].rotation.x = back * 0.55;
  j[`${side}Shin`].rotation.x = back * 1.4;
  j.spine.rotation.x -= 0.08 * back;
  j.chest.rotation.y += sign * 0.25 * back;
  j.leftArm.rotation.z += 0.4 * back;
  j.rightArm.rotation.z -= 0.4 * back;
  j[`${other}Arm`].rotation.x -= 0.45 * back;
  // After the feint the weight goes the other way: a step-over of the hips.
  j.hips.rotation.y += -sign * 0.3 * sway;
  j.hips.position.x += -sign * 0.05 * sway;
}

/** Overhead kick: the body flips back, the kicking leg reaches the ball above the hips at the contact tick, then lands on the back. */
export function poseBicycleKick(model: ProceduralFootballer, side: 'left' | 'right', ticks: number, contact: number, duration: number): void {
  const j = model.joints;
  const other = side === 'right' ? 'left' : 'right';
  const sign = side === 'right' ? 1 : -1;
  const rise = smooth(0, Math.max(1, contact), ticks);
  const land = smooth(contact + 6, Math.max(contact + 7, duration - 4), ticks);
  const lift = 0.62 * Math.sin(Math.min(1, ticks / (contact + 4)) * Math.PI / 2);
  const hipsY = j.hips.position.y + lift;
  j.hips.position.y = hipsY + (0.3 - hipsY) * land;
  j.hips.rotation.x = -1.7 * rise + 0.2 * land;
  j.spine.rotation.x = -0.25 * rise;
  j.head.rotation.x = 0.7 * rise;
  const strike = rise * (1 - land * 0.8);
  j[`${side}Thigh`].rotation.x = -1.1 * strike;
  j[`${side}Shin`].rotation.x = 0.9 * (1 - rise) + 0.05;
  // Once he lies on his back the trailing leg is stretched out along the turf, not hanging into it.
  j[`${other}Thigh`].rotation.x = 0.3 * rise - 0.55 * land;
  j[`${other}Shin`].rotation.x = 1.1 * rise * (1 - land);
  j.leftArm.rotation.z = 1.1 * rise; j.rightArm.rotation.z = -1.1 * rise;
  j.leftArm.rotation.x = j.rightArm.rotation.x = 0.4 * rise;
  j.leftForearm.rotation.x = j.rightForearm.rotation.x = -0.3 * rise;
  j.chest.rotation.y += -sign * 0.2 * rise;
}

/** Diving header: horizontal, head first, legs trailing; the head meets the ball at the contact tick, then he lands on his chest. */
export function poseFlyingHeader(model: ProceduralFootballer, ticks: number, contact: number, duration: number, ballHeight = 1.0): void {
  const j = model.joints;
  const rise = smooth(0, Math.max(1, contact), ticks);
  const land = smooth(contact + 4, Math.max(contact + 5, duration - 3), ticks);
  // At the ball the hips sit just under it, so the head arrives at the right height.
  const atBall = Math.min(1.4, Math.max(0.5, ballHeight - 0.3));
  const arc = Math.sin(Math.min(1, ticks / Math.max(1, contact)) * Math.PI) * 0.22;
  const hipsY = model.hipHeight + (atBall - model.hipHeight) * rise + arc * (1 - land);
  j.hips.position.y = hipsY + (0.28 - hipsY) * land;
  j.hips.rotation.x = 1.25 * rise + 0.25 * land;
  // Neck thrust through the ball.
  const thrust = smooth(Math.max(0, contact - 3), contact + 1, ticks);
  j.spine.rotation.x = -0.15 * rise + 0.3 * thrust;
  j.head.rotation.x = -0.45 * rise;
  j.leftThigh.rotation.x = 0.5 * rise; j.rightThigh.rotation.x = 0.35 * rise;
  j.leftShin.rotation.x = 0.9 * rise; j.rightShin.rotation.x = 0.7 * rise;
  j.leftArm.rotation.z = 0.9 * rise; j.rightArm.rotation.z = -0.9 * rise;
  j.leftArm.rotation.x = j.rightArm.rotation.x = 0.3 * rise;
  j.leftForearm.rotation.x = j.rightForearm.rotation.x = -0.7 * rise;
}

/** A wall player jumps with the knees tucked and the hands held in front of the groin. */
export function poseWallJump(model: ProceduralFootballer, ticks: number, duration: number): void {
  const j = model.joints;
  const t = Math.min(1, Math.max(0, ticks / duration));
  const air = Math.sin(t * Math.PI);
  const hold = smooth(0, 0.12, t);
  j.hips.position.y += 0.34 * air;
  j.leftThigh.rotation.x -= 0.55 * air; j.rightThigh.rotation.x -= 0.55 * air;
  j.leftShin.rotation.x += 0.95 * air; j.rightShin.rotation.x += 0.95 * air;
  // Hands covering the groin, elbows slightly out.
  j.leftArm.rotation.x = 0.15 * hold; j.rightArm.rotation.x = 0.15 * hold;
  j.leftArm.rotation.z = 0.18 * hold; j.rightArm.rotation.z = -0.18 * hold;
  j.leftForearm.rotation.x = -1.35 * hold; j.rightForearm.rotation.x = -1.35 * hold;
  j.spine.rotation.x += 0.1 * hold;
}

/**
 * Keeper punch: crouch, spring up with both fists cocked at the head, and drive them through the ball. Returns how far the
 * fists reach for the ball (0 to 1) so the caller can aim the hands with its IK.
 */
export function poseKeeperPunch(model: ProceduralFootballer, ticks: number, duration: number, hitTick: number): number {
  const j = model.joints;
  const jump = Math.sin(Math.min(1, ticks / Math.max(duration * 0.8, hitTick * 2 + 8)) * Math.PI);
  j.hips.position.y += 0.40 * jump;
  j.leftThigh.rotation.x = j.rightThigh.rotation.x = -0.45 * jump;
  j.leftShin.rotation.x = j.rightShin.rotation.x = 0.9 * jump;
  j.spine.rotation.x = -0.10 * jump;
  j.leftArm.rotation.x = j.rightArm.rotation.x = -2.2 * jump;
  j.leftForearm.rotation.x = j.rightForearm.rotation.x = -1.5 * jump;
  return Math.max(0, 1 - Math.abs(ticks - hitTick) / 7);
}

/**
 * Keeper smother: drops low over the ball with one knee down, then folds the arms round it. Returns how far the arms have
 * gathered the ball in towards the chest (0 to 1).
 */
export function poseKeeperSmother(model: ProceduralFootballer, ticks: number, duration: number): number {
  const j = model.joints;
  const env = smooth(0, 8, ticks) * (1 - smooth(duration - 14, duration - 3, ticks));
  const rear = model.recipe.seed % 2 ? 'left' : 'right', front = rear === 'left' ? 'right' : 'left';
  j.hips.position.y -= 0.34 * env;
  j.spine.rotation.x = j.spine.rotation.x + (1.0 - j.spine.rotation.x) * env;
  j.head.rotation.x -= 0.35 * env;
  j[`${rear}Thigh`].rotation.x = 0.35 * env; j[`${rear}Shin`].rotation.x = 1.3 * env;
  j[`${front}Thigh`].rotation.x = -0.9 * env; j[`${front}Shin`].rotation.x = 0.8 * env;
  return smooth(6, 16, ticks);
}
