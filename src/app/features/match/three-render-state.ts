import { MatchRenderFrame, MatchRenderState, MatchSnapshot, PlayerRuntimeSnapshot } from '../../models/match.model';

/** Shortest-angle interpolation also defines the otherwise ambiguous 180° case. */
export function interpolateFacing(ax: number, ay: number, bx: number, by: number, alpha: number): { x: number; y: number } {
  const start = Math.atan2(ay, ax);
  const end = Math.atan2(by, bx);
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  const angle = start + delta * alpha;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function interpolatePlayer(old: PlayerRuntimeSnapshot | undefined, player: PlayerRuntimeSnapshot, alpha: number, out?: PlayerRuntimeSnapshot): PlayerRuntimeSnapshot {
  if (!old || !old.active || !player.active || Math.hypot(player.x - old.x, player.y - old.y) > 8) return player;
  const facing = interpolateFacing(old.facingX, old.facingY, player.facingX, player.facingY, alpha);
  const target = out ? Object.assign(out, player) : { ...player };
  target.x = mix(old.x, player.x, alpha); target.y = mix(old.y, player.y, alpha);
  target.vx = mix(old.vx, player.vx, alpha); target.vy = mix(old.vy, player.vy, alpha);
  target.facingX = facing.x; target.facingY = facing.y;
  target.animationDistance = mix(old.animationDistance ?? 0, player.animationDistance ?? 0, alpha);
  return target;
}

function interpolatePlayers(previous: PlayerRuntimeSnapshot[], current: PlayerRuntimeSnapshot[], alpha: number, scratch?: RenderInterpolationScratch): PlayerRuntimeSnapshot[] {
  // Frames from the same match keep actor order; fall back to an id lookup otherwise.
  const aligned = previous.length === current.length && current.every((player, index) => previous[index].id === player.id);
  const previousById = aligned ? null : new Map(previous.map(player => [player.id, player]));
  const result = scratch?.players ?? [];
  for (let index = 0; index < current.length; index++) {
    const player = current[index];
    const old = aligned ? previous[index] : previousById!.get(player.id);
    // Only objects owned by the scratch are ever overwritten, never live simulation frames.
    const owned = scratch ? (scratch.owned[index] ??= {} as PlayerRuntimeSnapshot) : undefined;
    result[index] = interpolatePlayer(old, player, alpha, owned);
  }
  result.length = current.length;
  return result;
}

/** Scratch storage owned by one renderer; the returned frame is only valid until the next call. */
export interface RenderInterpolationScratch { frame?: MatchRenderState; players: PlayerRuntimeSnapshot[]; owned: PlayerRuntimeSnapshot[]; }

export function interpolateThreeFrame(frame: MatchRenderFrame, scratch?: RenderInterpolationScratch): MatchRenderState {
  const { previous, current } = frame;
  if (previous.discontinuityKey !== current.discontinuityKey) return current;
  const alpha = Math.max(0, Math.min(1, frame.alpha));
  const out = scratch ? (scratch.frame ??= { ...current, ball: { ...current.ball }, players: [] }) : { ...current, ball: { ...current.ball }, players: [] };
  out.controlledPlayerId = current.controlledPlayerId;
  out.attackDirection = current.attackDirection;
  out.discontinuityKey = current.discontinuityKey;
  out.tick = mix(previous.tick, current.tick, alpha);
  out.players = interpolatePlayers(previous.players, current.players, alpha, scratch);
  Object.assign(out.ball, current.ball);
  out.ball.x = mix(previous.ball.x, current.ball.x, alpha);
  out.ball.y = mix(previous.ball.y, current.ball.y, alpha);
  out.ball.z = mix(previous.ball.z, current.ball.z, alpha);
  out.ball.vx = mix(previous.ball.vx, current.ball.vx, alpha);
  out.ball.vy = mix(previous.ball.vy, current.ball.vy, alpha);
  out.ball.vz = mix(previous.ball.vz, current.ball.vz, alpha);
  return out;
}

/** Replay samples use their own ticks, never the live match's advancing action state. */
export function interpolateThreeReplay(previous: MatchSnapshot, current: MatchSnapshot, alpha: number): MatchSnapshot {
  const t = Math.max(0, Math.min(1, alpha));
  if (previous.attackDirection !== current.attackDirection || Math.hypot(previous.ball.x - current.ball.x, previous.ball.y - current.ball.y) > 12) return current;
  return { ...current, tick: mix(previous.tick, current.tick, t), players: interpolatePlayers(previous.players, current.players, t),
    ball: { ...current.ball, x: mix(previous.ball.x, current.ball.x, t), y: mix(previous.ball.y, current.ball.y, t), z: mix(previous.ball.z, current.ball.z, t) } };
}

function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Reflect world X before posing, so foot contacts also agree after side changes. */
export function playerInCameraSpace(player:PlayerRuntimeSnapshot, direction:1|-1, out?:PlayerRuntimeSnapshot):PlayerRuntimeSnapshot {
  if(direction===1) return player;
  const target=out ? Object.assign(out,player) : {...player};
  target.x=-player.x; target.vx=-player.vx; target.facingX=-player.facingX;
  target.actionTarget=player.actionTarget?{...player.actionTarget,x:-player.actionTarget.x}:undefined;
  target.contact=player.contact?{...player.contact,x:-player.contact.x}:undefined;
  return target;
}
