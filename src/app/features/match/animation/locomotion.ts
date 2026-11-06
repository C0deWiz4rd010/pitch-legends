/**
 * Locomotion timing for the procedural footballers.
 *
 * The gait phase is accumulated from the ground the player actually covers, divided by a stride that depends on
 * speed: short quick steps when walking, long ones at a sprint. A fixed stride made jogging look slow and legs
 * at a sprint spin too fast. Because the phase is accumulated (not recomputed from the total distance) a change
 * of speed never makes it jump.
 */
export interface GaitMemory {
  /** Distance reading of the previous call, in metres. */
  distance: number;
  /** Gait cycles so far (one cycle is a step with each foot). */
  cycle: number;
  started: boolean;
}

export function newGait(): GaitMemory {
  return { distance: 0, cycle: 0, started: false };
}

/** Metres covered by one full cycle at this speed for a player of this height. */
export function strideFor(speed: number, height: number): number {
  const scale = height / 1.82;
  return Math.min(4.4, Math.max(1.5, 1.2 + 0.4 * speed)) * scale;
}

/**
 * Advances the gait by the distance travelled since the last call. `turnMetres` adds stepping on the spot while
 * a slow player turns. A backwards jump (replay seek) or a large one (teleport) restarts the phase from the
 * reading instead of spinning the legs.
 */
export function advanceGait(gait: GaitMemory, distance: number, speed: number, height: number, turnMetres = 0): number {
  const stride = strideFor(speed, height);
  const delta = distance - gait.distance;
  if (!gait.started || delta < 0 || delta > 3) gait.cycle = distance / stride;
  else gait.cycle += (delta + turnMetres) / stride;
  gait.distance = distance;
  gait.started = true;
  return gait.cycle;
}

/** How far a slow, turning player lifts his feet (0 when he is running or standing still). */
export function turnStepAmount(yawRate: number, speed: number): number {
  return speed < 1 ? Math.min(1, Math.abs(yawRate) / 2.2) * 0.5 : 0;
}
