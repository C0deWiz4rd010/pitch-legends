import { CareerObjective } from '../models/game.model';
import { CUP_ROUND_LABELS } from '../core/career/cup';
import { formatCoins } from './rating-color';

const CUP_KEYS = ['r1', 'r2', 'qf', 'sf', 'final', 'winner'] as const;

/** Readable board objective in the current language. */
export function objectiveLabel(objective: CareerObjective, pick: (de: string, en: string) => string): string {
  const target = objective.target;
  switch (objective.type) {
    case 'league-position': return pick(`Liga-Platz ${target} oder besser`, `Finish in position ${target} or better`);
    case 'player-growth': return pick(`${target} Spieler-Level gewinnen`, `Gain ${target} player levels`);
    case 'cup-round': {
      const label = CUP_ROUND_LABELS[CUP_KEYS[Math.max(0, Math.min(CUP_KEYS.length - 1, target - 1))]];
      return pick(`Pokal: ${label.de} erreichen`, `Cup: reach the ${label.en.toLowerCase()}`);
    }
    case 'youth-appearances': return pick(`${target} Einsätze für U21-Spieler`, `${target} appearances for U21 players`);
    case 'budget': return pick(`Saison mit mindestens ${formatCoins(target)} beenden`, `End the season with at least ${formatCoins(target)}`);
    default: return pick(`${target} Siege holen`, `Win ${target} matches`);
  }
}

/** Progress 0-100 for the bar; the league position needs the current rank. */
export function objectiveProgress(objective: CareerObjective, rank: number): number {
  if (objective.completed) return 100;
  if (objective.type === 'league-position') return Math.min(100, Math.max(5, 100 - (rank - objective.target) * 14));
  return Math.min(100, Math.max(0, Math.round(objective.progress / Math.max(1, objective.target) * 100)));
}
