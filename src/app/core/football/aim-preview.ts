import { BALL_RADIUS, integrateBall } from './ball-physics';
import { CURL_DEADZONE, crossLaunch, passLaunch, passPlan } from './actions/pass';
import { MATCH_TICK } from './match-types';
import { MATCH_TUNING as T } from './tuning';
import { HK } from '../rpg/effects';
import type { ArcadeMatch } from '../services/arcade-match';

/** Pitch coordinates (x, y, height) of a predicted flight, three numbers per point. */
export interface FlightPath { points: Float32Array; count: number; /** The last point is where the ball comes down. */ landing: boolean }
export interface FlightLanding { x: number; y: number; seconds: number }

const MAX_POINTS = 72;
const TICKS_PER_POINT = 2;
/** How much of the flight each assist level shows: all of it with the landing spot, half, or only the launch. */
const SHARE = { assisted: 1, balanced: 0.5, manual: 0.2 } as const;

const path: FlightPath = { points: new Float32Array(MAX_POINTS * 3), count: 0, landing: false };
const scratch = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, topspin: 0 };
const landing: FlightLanding = { x: 0, y: 0, seconds: 0 };
let landingTick = -1, landingMatch: ArcadeMatch | null = null, landingValid = false;

/**
 * The flight a lob or cross would take if the button were released now, without the execution error. It reads the state
 * and never writes it or draws a random number, so showing it cannot change the match.
 */
export function aimPreview(m: ArcadeMatch): FlightPath | null {
  if (m.config.controllerMode !== 'human' || m.actionHeld.lob <= 0 || m.football.pendingKick) return null;
  if (m.rule.phase !== 'playing' && m.rule.phase !== 'advantage') return null;
  const actor = m.actors.find((candidate) => candidate.player.id === m.selectedPlayerId && candidate.active);
  if (!actor || m.ball.ownerId !== actor.player.id) return null;
  const input = m.previousInput;
  const direction = m.currentAttackDirection;
  const aimX = (Math.abs(input.aimX) + Math.abs(input.aimY) > 0.1 ? input.aimX : 1) * direction;
  const aimY = input.aimY;
  const power = m.charge(m.actionHeld.lob, 0.8);
  const curl = Math.abs(input.curl) > CURL_DEADZONE ? Math.max(-1, Math.min(1, input.curl)) * direction : 0;
  let dx: number, dy: number, length: number, speed: number, vz: number, spin: number, topspin: number;
  const runner = m.inCrossingZone(actor) ? m.crossRunner(actor, aimX, aimY) : undefined;
  if (runner) {
    ({ dx, dy, length, speed, vz } = crossLaunch(actor, runner, false, power));
    const inward = Math.sign(m.attackDirection(actor.side) * (m.pitch.width / 2 - actor.y)) || 1;
    spin = m.hook(actor, HK.curve, 3 * (curl || inward));
    topspin = 0;
  } else {
    const plan = passPlan(m, actor, false, true, power, aimX, aimY);
    ({ dx, dy, length } = plan);
    ({ speed, vz } = passLaunch(m, actor, plan, false, true, power, false));
    spin = curl * T.pass.curlLob;
    topspin = -2;
  }
  scratch.x = m.ball.x; scratch.y = m.ball.y; scratch.z = Math.max(BALL_RADIUS, m.ball.z);
  scratch.vx = dx / length * speed; scratch.vy = dy / length * speed; scratch.vz = vz;
  scratch.spin = spin; scratch.topspin = topspin;
  const wet = m.config.weather !== 'clear';
  let count = 0, landed = false;
  const points = path.points;
  points[0] = scratch.x; points[1] = scratch.y; points[2] = scratch.z; count = 1;
  for (let tick = 1; count < MAX_POINTS && !landed; tick++) {
    integrateBall(scratch, MATCH_TICK / 2, wet);
    integrateBall(scratch, MATCH_TICK / 2, wet);
    landed = tick > 6 && scratch.z <= BALL_RADIUS + 0.02;
    if (tick % TICKS_PER_POINT === 0 || landed) {
      points[count * 3] = scratch.x; points[count * 3 + 1] = scratch.y; points[count * 3 + 2] = scratch.z;
      count++;
    }
  }
  const share = SHARE[m.config.assist];
  path.count = Math.max(2, Math.ceil(count * share));
  path.landing = landed && share === 1;
  return path;
}

/** Where a ball in the air comes down, worked out once per tick. */
export function flightLanding(m: ArcadeMatch): FlightLanding | null {
  if (landingMatch === m && landingTick === m.tick) return landingValid ? landing : null;
  landingMatch = m; landingTick = m.tick; landingValid = false;
  const ball = m.ball;
  if (ball.ownerId || (ball.z < 1 && ball.vz < 3)) return null;
  scratch.x = ball.x; scratch.y = ball.y; scratch.z = ball.z;
  scratch.vx = ball.vx; scratch.vy = ball.vy; scratch.vz = ball.vz;
  scratch.spin = ball.spin; scratch.topspin = ball.topspin;
  const wet = m.config.weather !== 'clear';
  for (let tick = 1; tick <= 240; tick++) {
    integrateBall(scratch, MATCH_TICK / 2, wet);
    integrateBall(scratch, MATCH_TICK / 2, wet);
    if (scratch.z <= BALL_RADIUS + 0.02) {
      landing.x = scratch.x; landing.y = scratch.y; landing.seconds = tick * MATCH_TICK;
      landingValid = true;
      return landing;
    }
  }
  return null;
}
