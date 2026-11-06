/**
 * Render-only net behaviour: where a ball that crossed the line is held by the netting, and how the net around it bulges and
 * settles. Pure functions of the hit and the time since it, so replays and the tests see the same net. Nothing here touches the
 * simulation: the engine resets the ball at the goal, the renderer shows it carried on into the net.
 */

/** Depth of the roof edge and the foot of the back net behind the goal line, in metres (matches the net geometry). */
export const NET_TOP_DEPTH = 0.58;
export const NET_BACK_DEPTH = 2.1;
export const BALL_RADIUS = 0.11;
/** How far the net stays pushed out around a ball that rests in it. */
export const NET_REST_POCKET = 0.09;

/** Deepest the centre of a ball can be at this height before it presses into the sloping back net. */
export function netDepthLimit(height: number, goalHeight: number): number {
  const t = Math.min(1, Math.max(0, (height - 0.06) / Math.max(0.1, goalHeight - 0.14)));
  return NET_TOP_DEPTH + (NET_BACK_DEPTH - NET_TOP_DEPTH) * (1 - t) - BALL_RADIUS * 1.2;
}

/** Depth beyond the goal line at which a ball of this speed and height has been stopped by the net. */
export function netStopDepth(speed: number, height: number, goalHeight: number): number {
  return Math.min(netDepthLimit(height, goalHeight), 0.30 + speed * 0.045);
}

/**
 * Where the ball is `age` seconds after it entered the net: it keeps travelling a little (more for a fast shot), is caught by
 * the netting and drops to the ground. Depth is beyond the goal line, height above the pitch.
 */
export function netBallMotion(entryDepth: number, entryHeight: number, speed: number, age: number, goalHeight: number): { depth: number; height: number } {
  const t = Math.max(0, age);
  const stop = Math.max(entryDepth, netStopDepth(speed, entryHeight, goalHeight));
  const depth = entryDepth + (stop - entryDepth) * (1 - Math.exp(-7 * t));
  // Drops from where it was caught, with a small settling bounce on the turf.
  const fall = Math.max(BALL_RADIUS, entryHeight - 0.5 * 9.81 * Math.max(0, t - 0.12) ** 2);
  const bounce = fall <= BALL_RADIUS + 1e-6 ? Math.abs(Math.sin(Math.max(0, t - 0.5) * 11)) * 0.06 * Math.exp(-3 * Math.max(0, t - 0.5)) : 0;
  const height = Math.min(entryHeight, fall + bounce);
  return { depth: Math.min(depth, netDepthLimit(height, goalHeight)), height: Math.max(BALL_RADIUS, height) };
}

/** Strength 0 to 1 of a net hit for a ball speed in m/s. */
export function netHitStrength(speed: number): number {
  return Math.min(1, Math.max(0.15, speed / 28));
}

/**
 * Outward push (metres) of one net vertex that lies `distance` metres from the stopped ball, `age` seconds after the hit.
 * The first swing is a decaying oscillation; afterwards a ball at rest keeps a pocket (`rest` is 1 while it still lies in the
 * net, 0 once it has gone). Reduced motion shows the pocket only, without the wobble.
 */
export function netBulge(distance: number, age: number, strength: number, rest: number, reducedMotion = false): number {
  const spread = 0.35 + 0.65 * strength;
  const falloff = Math.exp(-(distance * distance) / (2 * spread * spread));
  const swing = reducedMotion ? 0 : (0.10 + 0.55 * strength) * Math.exp(-3.4 * age) * Math.cos(15 * age);
  // The first impact pushes the net out quickly even without a wobble.
  const dent = reducedMotion ? (0.10 + 0.25 * strength) * Math.exp(-2.5 * age) : 0;
  return falloff * (swing + dent + NET_REST_POCKET * rest);
}

/** Static slack of a hung net: a surface that is fixed along its edges bellies out a little in the middle. */
export function netSlack(u: number, v: number, amount: number): number {
  return amount * Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
}
