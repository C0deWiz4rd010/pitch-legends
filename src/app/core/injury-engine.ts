import { InjuryArea, InjuryCause, InjuryRecord, Player, RehabPlan } from '../models/player.model';
import { Rng, clamp } from './util';
import { hash32 } from './visual-identity';

interface InjuryContext {
  seed: number;
  player: Player;
  cause: InjuryCause;
  season: number;
  week: number;
  fixtureId?: string | null;
  matchMinute?: number | null;
  severityBias?: number;
}

const CONTACT: Array<[string, InjuryArea, number, number]> = [
  ['ankle-sprain', 'ankle', 1, 5], ['knee-sprain', 'knee', 2, 8], ['foot-contusion', 'foot', 1, 3],
  ['shoulder-impact', 'shoulder', 1, 4], ['head-knock', 'head', 1, 2], ['back-impact', 'back', 1, 4],
];
const MUSCLE: Array<[string, InjuryArea, number, number]> = [
  ['hamstring-strain', 'hamstring', 2, 7], ['calf-strain', 'calf', 1, 5], ['groin-strain', 'groin', 2, 6], ['back-spasm', 'back', 1, 4],
];

export function createInjury(context: InjuryContext): InjuryRecord {
  const rng = new Rng(hash32(`${context.seed}|${context.player.id}|${context.cause}|injury-v1`));
  const source = context.cause === 'contact' || context.cause === 'travel' || context.cause === 'legacy' ? CONTACT : MUSCLE;
  const [diagnosisId, area, minWeeks, maxWeeks] = rng.pick(source);
  const previous = context.player.medical?.history.filter((entry) => entry.area === area).length ?? 0;
  const bias = clamp((context.severityBias ?? 0) + previous * .08 + Math.max(0, 45 - context.player.fitness) / 100, 0, .7);
  const roll = rng.next() + bias;
  const severity = roll > 1.1 ? 'serious' : roll > .65 ? 'moderate' : 'minor';
  const bandMin = severity === 'minor' ? minWeeks : severity === 'moderate' ? Math.max(2, Math.ceil((minWeeks + maxWeeks) / 2) - 1) : Math.max(5, maxWeeks - 1);
  const bandMax = severity === 'minor' ? Math.max(minWeeks, Math.min(2, maxWeeks)) : severity === 'moderate' ? Math.max(bandMin, maxWeeks) : Math.max(8, maxWeeks + 5);
  const weeks = rng.int(bandMin, bandMax);
  return {
    id: `injury-${hash32(`${context.seed}|${context.player.id}|${diagnosisId}`).toString(36)}`,
    diagnosisId,
    area,
    severity,
    cause: context.cause,
    fixtureId: context.fixtureId ?? null,
    matchMinute: context.matchMinute ?? null,
    initialWeeks: weeks,
    remainingWeeks: weeks,
    rehabPlan: 'standard',
    recurrenceRisk: clamp(.04 + previous * .035 + (severity === 'serious' ? .09 : severity === 'moderate' ? .04 : 0), .03, .32),
    returnFitness: 75,
    occurredSeason: context.season,
    occurredWeek: context.week,
  };
}

export function applyInjury(player: Player, injury: InjuryRecord): void {
  player.medical ??= { activeInjury: null, history: [], recurrenceUntilWeek: null };
  const active = player.medical.activeInjury;
  if (!active || injury.remainingWeeks > active.remainingWeeks) player.medical.activeInjury = structuredClone(injury);
  player.injuryWeeks = player.medical.activeInjury?.remainingWeeks ?? 0;
}

export function setRehabPlan(player: Player, plan: RehabPlan, medicalLevel: number): { ok: boolean; cost: number } {
  const injury = player.medical?.activeInjury;
  if (!injury || (plan === 'accelerated' && medicalLevel < 2)) return { ok: false, cost: 0 };
  const previous = injury.rehabPlan;
  if (previous === plan) return { ok: true, cost: 0 };
  if (previous === 'conservative') injury.remainingWeeks = Math.max(1, injury.remainingWeeks - 1);
  if (previous === 'accelerated') injury.remainingWeeks += 1;
  if (plan === 'conservative') { injury.remainingWeeks += 1; injury.recurrenceRisk *= .5; injury.returnFitness = 85; }
  if (plan === 'standard') { injury.returnFitness = 75; injury.recurrenceRisk = clamp(injury.recurrenceRisk, .03, .32); }
  if (plan === 'accelerated') { injury.remainingWeeks = Math.max(1, injury.remainingWeeks - 1); injury.recurrenceRisk = clamp(injury.recurrenceRisk * 1.6, .05, .5); injury.returnFitness = 65; }
  injury.rehabPlan = plan;
  player.injuryWeeks = injury.remainingWeeks;
  const severityCost = injury.severity === 'serious' ? 45_000 : injury.severity === 'moderate' ? 25_000 : 12_000;
  return { ok: true, cost: plan === 'accelerated' ? severityCost : 0 };
}

export function advanceInjury(player: Player, season: number, week: number, medicalLevel: number): boolean {
  const injury = player.medical?.activeInjury;
  if (!injury) { player.injuryWeeks = 0; return false; }
  injury.remainingWeeks = Math.max(0, injury.remainingWeeks - 1);
  player.injuryWeeks = injury.remainingWeeks;
  if (injury.remainingWeeks > 0) return false;
  player.fitness = Math.min(player.fitness, injury.returnFitness + Math.max(0, medicalLevel - 1) * 3);
  player.medical.history.unshift({ ...structuredClone(injury), recoveredSeason: season, recoveredWeek: week });
  player.medical.history = player.medical.history.slice(0, 12);
  player.medical.recurrenceUntilWeek = week + 4;
  player.medical.activeInjury = null;
  player.injuryWeeks = 0;
  return true;
}

export function isPlayerAvailable(player: Player): boolean {
  return !player.medical?.activeInjury && player.injuryWeeks <= 0;
}
