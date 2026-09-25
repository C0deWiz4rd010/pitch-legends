import type { BallSnapshot, PlayerRuntimeSnapshot } from '../../models/match.model';
import { ArcadeActor, ArcadeBall } from './match-types';

export function actorSnapshot(actor: ArcadeActor): PlayerRuntimeSnapshot {
  return {
    contact: actor.contact ? { ...actor.contact } : undefined,
    actionTarget: actor.actionTarget ? { ...actor.actionTarget } : undefined,
    id: actor.player.id,
    side: actor.side,
    x: actor.x,
    y: actor.y,
    homeX: actor.homeX,
    homeY: actor.homeY,
    vx: actor.vx,
    vy: actor.vy,
    facingX: actor.facingX,
    facingY: actor.facingY,
    fitness: actor.stamina,
    active: actor.active,
    card: actor.card,
    action: actor.action,
    actionStartedTick: actor.actionStartedTick,
    decisionCooldown: actor.decisionCooldown,
    skillCooldown: actor.skillCooldown,
    tackleCooldown: actor.tackleCooldown,
    intentX: actor.intentX,
    intentY: actor.intentY,
    animationDistance: actor.animationDistance,
  };
}

/** Allocation-free variant for pooled replay and render frames. */
export function writeActorSnapshot(actor: ArcadeActor, target: PlayerRuntimeSnapshot): PlayerRuntimeSnapshot {
  target.contact = actor.contact ? Object.assign(target.contact ?? { ...actor.contact }, actor.contact) : undefined;
  target.actionTarget = actor.actionTarget ? Object.assign(target.actionTarget ?? { ...actor.actionTarget }, actor.actionTarget) : undefined;
  target.id = actor.player.id;
  target.side = actor.side;
  target.x = actor.x;
  target.y = actor.y;
  target.homeX = actor.homeX;
  target.homeY = actor.homeY;
  target.vx = actor.vx;
  target.vy = actor.vy;
  target.facingX = actor.facingX;
  target.facingY = actor.facingY;
  target.fitness = actor.stamina;
  target.active = actor.active;
  target.card = actor.card;
  target.action = actor.action;
  target.actionStartedTick = actor.actionStartedTick;
  target.decisionCooldown = actor.decisionCooldown;
  target.skillCooldown = actor.skillCooldown;
  target.tackleCooldown = actor.tackleCooldown;
  target.intentX = actor.intentX;
  target.intentY = actor.intentY;
  target.animationDistance = actor.animationDistance;
  return target;
}

export function writePlayers(actors: readonly ArcadeActor[], target: PlayerRuntimeSnapshot[]): PlayerRuntimeSnapshot[] {
  for (let index = 0; index < actors.length; index++) {
    target[index] = target[index] ? writeActorSnapshot(actors[index], target[index]) : actorSnapshot(actors[index]);
  }
  target.length = actors.length;
  return target;
}

export function writeBallSnapshot(ball: ArcadeBall, target: BallSnapshot): BallSnapshot {
  target.x = ball.x; target.y = ball.y; target.z = ball.z;
  target.vx = ball.vx; target.vy = ball.vy; target.vz = ball.vz;
  target.spin = ball.spin; target.ownerId = ball.ownerId; target.controlledTouch = ball.controlledTouch;
  return target;
}

export function applyActorSnapshot(actor: ArcadeActor, saved: PlayerRuntimeSnapshot, fallbackTick: number): void {
  actor.contact = saved.contact ? { ...saved.contact } : undefined;
  actor.actionTarget = saved.actionTarget ? { ...saved.actionTarget } : undefined;
  actor.x = saved.x;
  actor.y = saved.y;
  actor.homeX = saved.homeX;
  actor.homeY = saved.homeY;
  actor.vx = saved.vx;
  actor.vy = saved.vy;
  actor.facingX = saved.facingX;
  actor.facingY = saved.facingY;
  actor.stamina = saved.fitness;
  actor.active = saved.active;
  actor.card = saved.card;
  actor.action = saved.action;
  actor.actionStartedTick = saved.actionStartedTick ?? fallbackTick;
  actor.decisionCooldown = saved.decisionCooldown;
  actor.skillCooldown = saved.skillCooldown;
  actor.tackleCooldown = saved.tackleCooldown;
  actor.intentX = saved.intentX;
  actor.intentY = saved.intentY;
  actor.animationDistance = saved.animationDistance ?? 0;
}

export function ballSnapshot(ball: ArcadeBall): BallSnapshot {
  const { x, y, z, vx, vy, vz, spin, ownerId, controlledTouch } = ball;
  return { x, y, z, vx, vy, vz, spin, ownerId, controlledTouch };
}

/** 32-bit FNV-1a, hex encoded. */
export function fnv1aHex(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
