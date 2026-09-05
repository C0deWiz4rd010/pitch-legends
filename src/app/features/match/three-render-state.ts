import { MatchRenderFrame, MatchRenderState, MatchSnapshot, PlayerRuntimeSnapshot } from '../../models/match.model';

/** Shortest-angle interpolation also defines the otherwise ambiguous 180° case. */
export function interpolateFacing(ax: number, ay: number, bx: number, by: number, alpha: number): { x: number; y: number } {
  const start = Math.atan2(ay, ax);
  const end = Math.atan2(by, bx);
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  const angle = start + delta * alpha;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function interpolatePlayers(previous: PlayerRuntimeSnapshot[], current: PlayerRuntimeSnapshot[], alpha: number): PlayerRuntimeSnapshot[] {
  const previousById = new Map(previous.map(player => [player.id, player]));
  return current.map(player => {
    const old = previousById.get(player.id);
    if (!old || !old.active || !player.active || Math.hypot(player.x - old.x, player.y - old.y) > 8) return player;
    const facing = interpolateFacing(old.facingX, old.facingY, player.facingX, player.facingY, alpha);
    return { ...player, x: mix(old.x, player.x, alpha), y: mix(old.y, player.y, alpha),
      vx: mix(old.vx, player.vx, alpha), vy: mix(old.vy, player.vy, alpha),
      facingX: facing.x, facingY: facing.y,
      animationDistance: mix(old.animationDistance ?? 0, player.animationDistance ?? 0, alpha) };
  });
}

export function interpolateThreeFrame(frame: MatchRenderFrame): MatchRenderState {
  const { previous, current } = frame;
  if (previous.discontinuityKey !== current.discontinuityKey) return current;
  const alpha = Math.max(0, Math.min(1, frame.alpha));
  return { ...current, tick: mix(previous.tick, current.tick, alpha),
    players: interpolatePlayers(previous.players, current.players, alpha),
    ball: { ...current.ball, x: mix(previous.ball.x, current.ball.x, alpha),
      y: mix(previous.ball.y, current.ball.y, alpha), z: mix(previous.ball.z, current.ball.z, alpha),
      vx: mix(previous.ball.vx, current.ball.vx, alpha), vy: mix(previous.ball.vy, current.ball.vy, alpha),
      vz: mix(previous.ball.vz, current.ball.vz, alpha) } };
}

/** Replay samples use their own ticks, never the live match's advancing action state. */
export function interpolateThreeReplay(previous: MatchSnapshot, current: MatchSnapshot, alpha: number): MatchSnapshot {
  const t = Math.max(0, Math.min(1, alpha));
  if (previous.attackDirection !== current.attackDirection || Math.hypot(previous.ball.x - current.ball.x, previous.ball.y - current.ball.y) > 12) return current;
  return { ...current, tick: mix(previous.tick, current.tick, t), players: interpolatePlayers(previous.players, current.players, t),
    ball: { ...current.ball, x: mix(previous.ball.x, current.ball.x, t), y: mix(previous.ball.y, current.ball.y, t), z: mix(previous.ball.z, current.ball.z, t) } };
}

function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
