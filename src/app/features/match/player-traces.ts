import { MatchWeather } from '../../models/match.model';
import { PlayerTraces } from './player-material';

/** What the renderer remembers per player: the traces of the match and how he is drawn. Never read by the simulation. */
export interface PlayerMarks extends PlayerTraces {
  /** Drawn as the simplified figure for the distance. */
  far: boolean;
  /** Seconds until his next visible breath in the cold. */
  breath: number;
  /** Tick at which the last slide was counted, so one slide stains once. */
  slideTick: number;
  /** Sum of the traces when they were last handed to the material. */
  shown: number;
}

export function newMarks(store: Map<string, PlayerMarks>, id: string, seed: number): PlayerMarks {
  const marks: PlayerMarks = { mud: 0, wet: 0, sweat: 0, seed: (seed % 997) / 997, far: false, breath: 0.4 + (seed % 23) / 10, slideTick: -1, shown: 0 };
  store.set(id, marks);
  return marks;
}

/** Beyond this distance from the camera (metres) a player is drawn as the simplified figure; he returns a little closer in. */
export const FAR_FIGURE_DISTANCE = 52;
export function farFigure(far: boolean, distance: number): boolean {
  return far ? distance > FAR_FIGURE_DISTANCE - 5 : distance > FAR_FIGURE_DISTANCE;
}

/** How wet a shirt can get in this weather, 0 to 1. */
export function soakLimit(weather: MatchWeather): number {
  return weather === 'storm' ? 1 : weather === 'rain' ? 0.85 : weather === 'snow' ? 0.3 : 0;
}

/**
 * Advances the traces of one player by `dt` seconds of match time. Every slide tackle, dive to the ground and injury adds
 * dirt (more on a wet pitch); rain soaks the shirt within about two minutes; sweat follows the stamina that is left.
 * Returns whether anything changed enough to be drawn again.
 */
export function markPlayer(marks: PlayerMarks, action: string, actionTicks: number, fitness: number, weather: MatchWeather, dt: number): boolean {
  const down = action === 'slide' || action === 'injured' || action === 'keeper-dive' || action === 'keeper-smother' || action === 'bicycle-kick' || action === 'flying-header';
  if (down && actionTicks < 40 && marks.slideTick !== 1) {
    marks.mud = Math.min(1, marks.mud + (weather === 'clear' ? 0.16 : 0.26));
    marks.slideTick = 1;
  } else if (!down) marks.slideTick = -1;
  const limit = soakLimit(weather);
  marks.wet = Math.min(limit, marks.wet + dt * limit / 110);
  const sweat = Math.max(0, Math.min(1, (78 - fitness) / 48));
  marks.sweat += (sweat - marks.sweat) * Math.min(1, dt * 0.5);
  const sum = marks.mud + marks.wet + marks.sweat;
  if (Math.abs(sum - marks.shown) < 0.01) return false;
  marks.shown = sum;
  return true;
}

/** Whether a puff of breath leaves the player now: every two to three seconds at rest, more often when he runs. */
export function breathDue(marks: PlayerMarks, dt: number, speed: number): boolean {
  marks.breath -= dt * (1 + Math.min(1, speed / 6) * 1.4);
  if (marks.breath > 0) return false;
  marks.breath = 2 + marks.seed * 1.2;
  return true;
}
