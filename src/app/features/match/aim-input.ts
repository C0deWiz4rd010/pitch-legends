/** Below this deflection the aim stick is at rest and the kick follows the movement stick, as on the keyboard. */
export const AIM_STICK_THRESHOLD = 0.35;
const CURL_DEADZONE = 0.15;

export interface AimInput { aimX: number; aimY: number; curl: number; /** The aim stick is in use: it does not pick a team-mate now. */ aiming: boolean }

/**
 * A second stick that is held while a kick is charged aims the kick on its own; the movement stick then bends the ball
 * towards the side it points to (the cross product of the two directions). Without it the kick is aimed by the movement.
 */
export function aimFromSticks(charging: boolean, aimStickX: number, aimStickY: number, moveX: number, moveY: number): AimInput {
  const length = Math.hypot(aimStickX, aimStickY);
  if (!charging || length < AIM_STICK_THRESHOLD) return { aimX: moveX, aimY: moveY, curl: 0, aiming: false };
  const aimX = aimStickX / length, aimY = aimStickY / length;
  const bend = aimX * moveY - aimY * moveX;
  return { aimX, aimY, curl: Math.abs(bend) > CURL_DEADZONE ? Math.max(-1, Math.min(1, bend)) : 0, aiming: true };
}
