import { ClubRivalry } from '../../models/world.model';
import { GameState } from '../../models/game.model';
import { clamp } from '../util';

/**
 * Rivalry heat. Every rivalry has a heat from 0 to 100 that grows with close and decided derbies and with transfers
 * between the two clubs, and cools a little every week and more at the turn of the season. The old three-step
 * `intensity` follows the heat, so everything that reads it sees the same story. Heat starts from the reason the
 * rivalry exists. It never touches the match engine: it feeds the gate, the mood of the managed club and the news.
 */
export const HEAT_START: Record<ClubRivalry['reason'], number> = { derby: 45, historic: 35, title: 25 };
export const HEAT_COOL_WEEKLY = 0.4;
export const HEAT_COOL_SEASON = 8;

/** The three steps the heat falls into. */
export function intensityFor(heat: number): 1 | 2 | 3 {
  return heat >= 70 ? 3 : heat >= 35 ? 2 : 1;
}

export function rivalryBetween(
  game: Pick<GameState, 'world'>,
  teamA: string,
  teamB: string,
): ClubRivalry | undefined {
  return game.world?.rivalries.find(
    (rivalry) =>
      (rivalry.teamAId === teamA && rivalry.teamBId === teamB) ||
      (rivalry.teamAId === teamB && rivalry.teamBId === teamA),
  );
}

/** The heat of a rivalry, starting from its reason while nothing has happened yet. */
export function heatOf(rivalry: ClubRivalry): number {
  return rivalry.heat ?? HEAT_START[rivalry.reason];
}

function setHeat(rivalry: ClubRivalry, heat: number): void {
  rivalry.heat = Math.round(clamp(heat, 0, 100) * 10) / 10;
  rivalry.intensity = intensityFor(rivalry.heat);
}

/** Heats (or cools) the rivalry of two clubs; nothing happens when they are no rivals. Returns the new heat. */
export function warmRivalry(
  game: Pick<GameState, 'world'>,
  teamA: string,
  teamB: string,
  delta: number,
): number | null {
  const rivalry = rivalryBetween(game, teamA, teamB);
  if (!rivalry) return null;
  setHeat(rivalry, heatOf(rivalry) + delta);
  return rivalry.heat ?? null;
}

/** What a played derby does to the heat: any derby warms it, a close one or a late goal fest more, a rout cools it. */
export function derbyHeat(homeScore: number, awayScore: number): number {
  const margin = Math.abs(homeScore - awayScore);
  const goals = homeScore + awayScore;
  return margin === 0 ? 6 : margin === 1 ? 7 : margin >= 4 ? 1 : 3 + (goals >= 5 ? 2 : 0);
}

/** The heat moved by a transfer between rivals: a player who walks across is a provocation. */
export const TRANSFER_HEAT = 10;

/** Cooling at the end of a week or a season. */
export function coolRivalries(game: Pick<GameState, 'world'>, season: boolean): void {
  for (const rivalry of game.world?.rivalries ?? [])
    setHeat(rivalry, heatOf(rivalry) - (season ? HEAT_COOL_SEASON : HEAT_COOL_WEEKLY));
}

/** Extra gate for a derby: up to a fifth more at full heat. */
export function gateFactor(rivalry: ClubRivalry | undefined): number {
  return rivalry ? 1 + (heatOf(rivalry) / 100) * 0.2 : 1;
}

/** What a hot derby does to the managed club's spirit: a win lifts it more, a defeat stings more. */
export function derbySpirit(heat: number, outcome: 'win' | 'draw' | 'loss'): number {
  return outcome === 'win' ? heat / 25 : outcome === 'loss' ? -heat / 40 : 0;
}
