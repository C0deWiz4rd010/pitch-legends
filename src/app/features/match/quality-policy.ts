type Quality = 'high' | 'balanced' | 'low';
const RANK: Record<Quality, number> = { low: 0, balanced: 1, high: 2 };

/** A GPU that needs more than this per frame cannot hold 60 frames per second (16.7 ms), with a little margin. */
export const GPU_OVER_MS = 15;
/** Below this the GPU has room for the next quality level. */
export const GPU_HEADROOM_MS = 9;

export interface QualityInput {
  /** Mean time between frames over the sample, in seconds. */
  average: number;
  /** Smoothed GPU time per frame in ms, or null when the browser does not offer a timer. */
  gpuMs: number | null;
  quality: Quality;
  ceiling: Quality;
  /** Seconds that must still pass before the profile may change again. */
  cooldown: number;
  /** Consecutive fast samples so far. */
  stable: number;
  downgrades: number;
  software: boolean;
}

export interface QualityOutcome {
  action: 'down' | 'up' | 'none';
  stable: number;
}

/**
 * One decision per sample of 150 frames. With a GPU timer, quality only changes when the GPU really is the limit: a display
 * that is capped at 30 Hz, or a CPU-bound frame, shows long frame intervals and a light GPU, and lowering the resolution
 * would not help. Without a timer the frame interval has to do (it cannot tell a vsync cap from an overloaded GPU).
 */
export function decideQuality(input: QualityInput): QualityOutcome {
  const slow = input.gpuMs !== null ? input.gpuMs > GPU_OVER_MS : input.average > 0.024;
  if (input.cooldown <= 0 && slow && input.quality !== 'low') return { action: 'down', stable: 0 };
  const fast = input.average < 0.0185 && (input.gpuMs === null || input.gpuMs < GPU_HEADROOM_MS);
  if (!fast || input.software) return { action: 'none', stable: 0 };
  // Stable samples (2.5 s each) earn one profile back; every stall raises the bar to avoid oscillation.
  const stable = input.stable + 1;
  if (stable >= Math.min(12, 2 * (1 + input.downgrades)) && input.cooldown <= 0 && RANK[input.quality] < RANK[input.ceiling]) return { action: 'up', stable: 0 };
  return { action: 'none', stable };
}
