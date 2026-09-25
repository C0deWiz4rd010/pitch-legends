import type { Player } from '../../models/player.model';
import type { PlayerActionState, PlayerRuntimeSnapshot, Side } from '../../models/match.model';

export const FIELD_LENGTH = 105;
export const FIELD_WIDTH = 68;
export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;
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
