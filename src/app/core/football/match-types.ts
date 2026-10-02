import type { Player } from '../../models/player.model';
import type { PlayerActionState, PlayerRuntimeSnapshot, Side } from '../../models/match.model';

/** Pitch dimensions in metres. Everything on the pitch is derived from these values. */
export interface PitchGeometry {
  id: 'full' | 'small';
  length: number;
  width: number;
  goalWidth: number;
  goalHeight: number;
  penaltyDepth: number;
  penaltyHalfWidth: number;
  goalAreaDepth: number;
  penaltySpot: number;
  /** Distance opponents keep at restarts. */
  restartDistance: number;
}

export const FULL_PITCH: PitchGeometry = {
  id: 'full', length: 105, width: 68, goalWidth: 7.32, goalHeight: 2.44,
  penaltyDepth: 16.5, penaltyHalfWidth: 20.16, goalAreaDepth: 5.5, penaltySpot: 11, restartDistance: 9.15,
};

/** Five-a-side cage: small goals, boards instead of touchlines. */
export const SMALL_PITCH: PitchGeometry = {
  id: 'small', length: 46, width: 28, goalWidth: 4, goalHeight: 2,
  penaltyDepth: 6, penaltyHalfWidth: 7, goalAreaDepth: 2.5, penaltySpot: 6, restartDistance: 5,
};

// Live bindings: importers always read the dimensions of the match being stepped or drawn.
export let FIELD_LENGTH = FULL_PITCH.length;
export let FIELD_WIDTH = FULL_PITCH.width;
export let GOAL_WIDTH = FULL_PITCH.goalWidth;
export let GOAL_HEIGHT = FULL_PITCH.goalHeight;
export let PITCH: PitchGeometry = FULL_PITCH;

/**
 * Switches the active pitch. Each match applies its own pitch before it steps or renders, so a
 * small-sided match and a headless league simulation can never leak dimensions into each other.
 */
export function applyPitch(pitch: PitchGeometry): void {
  if (PITCH === pitch) return;
  PITCH = pitch;
  FIELD_LENGTH = pitch.length;
  FIELD_WIDTH = pitch.width;
  GOAL_WIDTH = pitch.goalWidth;
  GOAL_HEIGHT = pitch.goalHeight;
}
export const MATCH_TICK = 1 / 60;

export interface ArcadeActor {
  contact?: PlayerRuntimeSnapshot['contact'];
  actionTarget?: PlayerRuntimeSnapshot['actionTarget'];
  player: Player;
  side: Side;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  stamina: number;
  facingX: number;
  facingY: number;
  active: boolean;
  card: 'none' | 'yellow' | 'red';
  action: PlayerActionState;
  actionStartedTick: number;
  decisionCooldown: number;
  skillCooldown: number;
  tackleCooldown: number;
  intentX: number;
  intentY: number;
  animationDistance: number;
}

export interface ArcadeBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  topspin: number;
  ownerId: string | null;
  lastTouch: Side;
  lastTouchPlayerId: string | null;
  controlledTouch: number;
}

export interface ActiveShot {
  shooterId: string;
  side: Side;
  xG: number;
  targetY: number;
  checkedKeeper: boolean;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function oppositeSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}
