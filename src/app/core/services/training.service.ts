import { Injectable, inject } from '@angular/core';
import { AttributeKey } from '../../models/enums';
import {
  GameState,
  TrainingGrade,
  TrainingIntensity,
  TrainingPlayerResult,
  TrainingScope,
  TrainingSessionPlan,
  TrainingSessionResult,
} from '../../models/game.model';
import { Player } from '../../models/player.model';
import { CampEffect, CampEvent, CAMP_EVENTS } from '../../data/camp-events';
import { TRAINING_DRILLS, TrainingDrill, getDrill } from '../../data/training-drills';
import { computeOverall, marketValueFor } from '../ratings';
import {
  BASE_MASTERY,
  CORE_ATTRIBUTE,
  GRADE_MULTIPLIER,
  INTENSITY_MASTERY,
  LoadZone,
  MENTORING_XP,
  acuteChronicRatio,
  addMastery,
  closeTrainingWeek,
  ensureTraining,
  loadRiskFactor,
  loadZone,
  mentoringJuniors,
  sessionLoad,
} from '../rpg/training-rules';
import { Rng, clamp } from '../util';
import { hash32 } from '../visual-identity';
import { RpgService } from './rpg.service';
import { applyInjury, createInjury, isPlayerAvailable } from '../injury-engine';

export { TRAINING_DRILLS };
export type { TrainingDrill };

export interface TrainingPlayerPreview {
  playerId: string;
  xpMin: number;
  xpMax: number;
  fitnessDelta: number;
  growthChance: number;
  injuryRisk: number;
  /** Percent chance that a growth is a breakthrough (+2). */
  breakthroughChance: number;
  masteryGain: number;
  /** Acute:chronic load ratio after this session, and its traffic-light zone. */
  loadRatio: number;
  loadZone: LoadZone;
  mentored: boolean;
}

export interface TrainingSessionPreview {
  plan: TrainingSessionPlan;
  drill: TrainingDrill | null;
  players: TrainingPlayerPreview[];
  valid: boolean;
  errors: string[];
  seed: number;
}

export interface TrainingPlanPreview {
  valid: boolean;
  errors: string[];
  sessions: TrainingSessionPreview[];
}

export interface TrainingExecutionResult {
  ok: boolean;
  errors: string[];
  sessions: TrainingSessionResult[];
}

export interface CampEventView {
  event: CampEvent;
  city: string;
  /** Chosen option, or null while the choice is open. */
  choice: 0 | 1 | null;
}

const INTENSITY_XP: Record<TrainingIntensity, number> = { light: 0.8, normal: 1, intense: 1.25 };
const INTENSITY_FITNESS: Record<TrainingIntensity, number> = { light: 7, normal: 12, intense: 18 };
const INTENSITY_INJURY: Record<TrainingIntensity, number> = { light: 0.01, normal: 0.03, intense: 0.06 };

/** Share of the primary growth chance that the secondary attribute gets. */
const SECONDARY_GROWTH = 0.3;
/** Weekly chance (before facilities) that an AI player under 27 gains a point. */
const AI_GROWTH_BASE = 0.015;

@Injectable({ providedIn: 'root' })
export class TrainingService {
  private readonly rpg = inject(RpgService);

  preview(state: GameState, plans: readonly TrainingSessionPlan[]): TrainingPlanPreview {
    const club = state.teams.find((team) => team.id === state.clubId);
    if (!club) return { valid: false, errors: ['club-missing'], sessions: [] };
    const errors: string[] = [];
    const remaining = state.trainingWeek.maxSlots - state.trainingWeek.slotsUsed;
    if (!plans.length) errors.push('plan-empty');
    if (plans.length > remaining) errors.push('slots-exceeded');
    if (new Set(plans.map((plan) => plan.slot)).size !== plans.length) errors.push('slot-duplicate');
    const completedSlots = new Set(state.trainingWeek.completedSessions.map((session) => session.plan.slot));
    if (plans.some((plan) => completedSlots.has(plan.slot))) errors.push('slot-occupied');

    const completedDevelopmentIds = new Set(
      state.trainingWeek.completedSessions
        .filter((session) => this.drill(session.plan.drillId)?.focus !== 'recovery')
        .flatMap((session) => session.plan.targetIds),
    );
    const developmentIds = new Set(completedDevelopmentIds);
    const recoveryIds = new Set<string>();
    const sessions = plans
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((plan) => {
        const sessionErrors: string[] = [];
        const drill = this.drill(plan.drillId) ?? null;
        const targets = plan.targetIds.map((id) => club.players.find((player) => player.id === id)).filter((player): player is Player => !!player);
        if (!drill) sessionErrors.push('drill-invalid');
        if (targets.length !== plan.targetIds.length) sessionErrors.push('target-invalid');
        if (new Set(plan.targetIds).size !== plan.targetIds.length) sessionErrors.push('target-duplicate');
        this.validateScope(plan.scope, targets, sessionErrors);

        if (drill) {
          const recovery = drill.focus === 'recovery';
          for (const player of targets) {
            if (!isPlayerAvailable(player) && !recovery) sessionErrors.push(`injured:${player.id}`);
            if (!recovery && developmentIds.has(player.id)) sessionErrors.push(`already-trained:${player.id}`);
            if (recovery && recoveryIds.has(player.id)) sessionErrors.push(`already-recovered:${player.id}`);
            if (!recovery && plan.intensity === 'intense' && player.fitness < 55) sessionErrors.push(`fitness:${player.id}`);
          }
          for (const player of targets) (recovery ? recoveryIds : developmentIds).add(player.id);
        }

        const seed = this.sessionSeed(state, club.id, plan.slot);
        const juniors = plan.scope === 'unit' ? mentoringJuniors(targets) : new Set<string>();
        return {
          plan,
          drill,
          players: drill ? targets.map((player) => this.playerPreview(state, player, drill, plan, juniors.has(player.id))) : [],
          valid: sessionErrors.length === 0,
          errors: unique(sessionErrors),
          seed,
        };
      });

    errors.push(...sessions.flatMap((session) => session.errors));
    return { valid: errors.length === 0, errors: unique(errors), sessions };
  }

  executePlan(state: GameState, plans: readonly TrainingSessionPlan[]): TrainingExecutionResult {
    const preview = this.preview(state, plans);
    if (!preview.valid) return { ok: false, errors: preview.errors, sessions: [] };
    const club = state.teams.find((team) => team.id === state.clubId);
    if (!club) return { ok: false, errors: ['club-missing'], sessions: [] };

    const playerCopies = structuredClone(club.players) as Player[];
    const sessions: TrainingSessionResult[] = [];
    for (const session of preview.sessions) {
      const drill = session.drill!;
      const results: TrainingPlayerResult[] = [];
      const targets = session.plan.targetIds.map((id) => playerCopies.find((candidate) => candidate.id === id));
      if (targets.some((target) => !target)) return { ok: false, errors: ['target-invalid'], sessions: [] };
      const juniors = session.plan.scope === 'unit' ? mentoringJuniors(targets as Player[]) : new Set<string>();
      for (const player of targets as Player[]) {
        results.push(this.executePlayer(state, player, drill, session.plan, session.seed, juniors.has(player.id)));
      }
      sessions.push({ plan: structuredClone(session.plan), players: results, seed: session.seed });
    }

    club.players = playerCopies;
    state.trainingWeek.slotsUsed += sessions.length;
    state.trainingWeek.completedSessions.push(...sessions);
    return { ok: true, errors: [], sessions };
  }

  drill(id: string): TrainingDrill | undefined {
    return getDrill(id);
  }

  /**
   * Closes the training week once the matchday is over: load history moves on, match buffs expire and the
   * other clubs train in a simplified, deterministic form so the league does not drift away from the player.
   */
  rollWeek(state: GameState): void {
    const season = state.league.season;
    const week = state.league.currentWeek;
    for (const team of state.teams) {
      if (team.id === state.clubId) {
        for (const player of team.players) closeTrainingWeek(player);
        continue;
      }
      for (const player of team.players) if (player.training) closeTrainingWeek(player);
      this.simulateAiTrainingWeek(team.players, team.facilities.trainingGround, `${team.id}|${season}|${week}`);
    }
  }

  /** Young players of AI clubs occasionally gain a point in an attribute their position lives from. */
  simulateAiTrainingWeek(players: Player[], trainingGround: number, key: string): void {
    const rng = new Rng(hash32(`${key}|ai-training`));
    for (const player of players) {
      if (player.age >= 27 || player.overall >= player.potential) continue;
      if (!rng.bool(AI_GROWTH_BASE + trainingGround * 0.005)) continue;
      const focus = this.positionFocus(player);
      const attribute = rng.pick(focus);
      if (player.attributes[attribute] >= 99) continue;
      player.attributes[attribute] = clamp(player.attributes[attribute] + 1, 1, 99);
      this.recompute(player);
    }
  }

  /** This week's camp event of the managed club; the choice is stored in the training week. */
  campEvent(state: GameState): CampEventView {
    const event = CAMP_EVENTS[hash32(`${state.clubId}|${state.league.season}|${state.league.currentWeek}|camp`) % CAMP_EVENTS.length];
    const city = state.world?.cities.find((candidate) => candidate.teamId === state.clubId)?.name ?? state.teams.find((team) => team.id === state.clubId)?.name ?? '—';
    return { event, city, choice: state.trainingWeek.eventChoice ?? null };
  }

  canAffordOption(state: GameState, option: 0 | 1): boolean {
    const club = state.teams.find((team) => team.id === state.clubId);
    const cost = Math.min(0, this.campEvent(state).event.options[option].effect.coins ?? 0);
    return !!club && club.coins + cost >= 0;
  }

  resolveCampEvent(state: GameState, option: 0 | 1): { ok: boolean; error?: string } {
    const club = state.teams.find((team) => team.id === state.clubId);
    if (!club) return { ok: false, error: 'club-missing' };
    if (state.trainingWeek.eventChoice === 0 || state.trainingWeek.eventChoice === 1) return { ok: false, error: 'event-done' };
    if (!this.canAffordOption(state, option)) return { ok: false, error: 'cannot-afford' };
    const effect = this.campEvent(state).event.options[option].effect;
    this.applyCampEffect(club.players, effect);
    club.coins += effect.coins ?? 0;
    state.trainingWeek.eventChoice = option;
    return { ok: true };
  }

  private applyCampEffect(players: Player[], effect: CampEffect): void {
    for (const player of players) {
      if (effect.morale) player.morale = clamp(player.morale + effect.morale, 0, 100);
      if (effect.fitness) player.fitness = clamp(player.fitness + effect.fitness, 0, 100);
      if (effect.xp) this.rpg.awardXp(player, effect.xp);
      if (effect.mastery) this.grantMastery(player, CORE_ATTRIBUTE[player.positionGroup], effect.mastery);
    }
  }

  private validateScope(scope: TrainingScope, players: Player[], errors: string[]): void {
    if (scope === 'individual' && players.length !== 1) errors.push('individual-count');
    if (scope === 'unit') {
      if (players.length < 3 || players.length > 5) errors.push('unit-count');
      if (new Set(players.map((player) => player.positionGroup)).size > 1) errors.push('unit-group');
    }
  }

  private playerPreview(
    state: GameState,
    player: Player,
    drill: TrainingDrill,
    plan: TrainingSessionPlan,
    mentored: boolean,
  ): TrainingPlayerPreview {
    if (drill.focus === 'recovery') {
      return {
        playerId: player.id, xpMin: 0, xpMax: 0, fitnessDelta: Math.min(30, 100 - player.fitness), growthChance: 0, injuryRisk: 0,
        breakthroughChance: 0, masteryGain: 0, loadRatio: acuteChronicRatio(player), loadZone: loadZone(acuteChronicRatio(player)), mentored: false,
      };
    }
    const team = state.teams.find((candidate) => candidate.id === state.clubId)!;
    const baseXp = this.baseXp(state, player, drill, plan, mentored);
    const cost = this.fitnessCost(drill, plan.scope, plan.intensity);
    const ratio = acuteChronicRatio(player, sessionLoad(plan.intensity, plan.scope, drill.fitnessCost ?? 1));
    const growth = this.growthChance(player, drill.focus, team.facilities.trainingGround, plan, state.manager.attributes.youthDevelopment);
    return {
      playerId: player.id,
      xpMin: Math.round(baseXp * 0.85),
      xpMax: Math.round(baseXp * 1.2),
      fitnessDelta: -Math.min(player.fitness, cost),
      growthChance: Math.round(growth * 100),
      injuryRisk: Math.round(this.injuryChance(drill, plan.intensity, team.facilities.medicalCenter, ratio) * 1000) / 10,
      breakthroughChance: Math.round(this.breakthroughChance(player, team.facilities.trainingGround) * 100),
      masteryGain: this.masteryGain(plan, false),
      loadRatio: Math.round(ratio * 100) / 100,
      loadZone: loadZone(ratio),
      mentored,
    };
  }

  private executePlayer(
    state: GameState,
    player: Player,
    drill: TrainingDrill,
    plan: TrainingSessionPlan,
    sessionSeed: number,
    mentored: boolean,
  ): TrainingPlayerResult {
    if (drill.focus === 'recovery') {
      const before = player.fitness;
      player.fitness = clamp(player.fitness + 30, 0, 100);
      return { playerId: player.id, xpGained: 0, fitnessDelta: player.fitness - before, attributeGained: null, injuredWeeks: 0 };
    }

    const team = state.teams.find((candidate) => candidate.id === state.clubId)!;
    const rng = new Rng(hash32(`${sessionSeed}|${player.id}`));
    const training = ensureTraining(player);
    const cost = this.fitnessCost(drill, plan.scope, plan.intensity);
    const beforeFitness = player.fitness;
    player.fitness = clamp(player.fitness - cost, 0, 100);
    const ratio = acuteChronicRatio(player, sessionLoad(plan.intensity, plan.scope, drill.fitnessCost ?? 1));
    training.weekLoad += sessionLoad(plan.intensity, plan.scope, drill.fitnessCost ?? 1);
    const xp = Math.round(this.baseXp(state, player, drill, plan, mentored) * rng.float(0.85, 1.2));
    this.rpg.awardXp(player, xp);

    let attributeGained: AttributeKey | null = null;
    let breakthrough = false;
    const attribute = drill.focus;
    const growth = this.growthChance(player, attribute, team.facilities.trainingGround, plan, state.manager.attributes.youthDevelopment);
    const canGrow = player.attributes[attribute] < 99 && player.overall < player.potential + 2;
    if (canGrow && rng.bool(growth)) {
      breakthrough = rng.bool(this.breakthroughChance(player, team.facilities.trainingGround));
      player.attributes[attribute] = clamp(player.attributes[attribute] + (breakthrough ? 2 : 1), 1, 99);
      this.recompute(player);
      attributeGained = attribute;
    }
    if (drill.secondary && player.attributes[drill.secondary] < 99 && player.overall < player.potential + 2 && rng.bool(growth * SECONDARY_GROWTH)) {
      player.attributes[drill.secondary] = clamp(player.attributes[drill.secondary] + 1, 1, 99);
      this.recompute(player);
    }

    const mastery = this.grantMastery(player, attribute, this.masteryGain(plan, breakthrough));
    if (drill.secondary) this.grantMastery(player, drill.secondary, Math.max(1, Math.round(this.masteryGain(plan, false) * 0.4)));

    if (drill.buff) {
      training.buffs = training.buffs.filter((buff) => buff.drillId !== drill.id);
      training.buffs.push({ drillId: drill.id, effects: structuredClone(drill.buff.effects), season: state.league.season, week: state.league.currentWeek });
    }

    let injuredWeeks = 0;
    if (rng.bool(this.injuryChance(drill, plan.intensity, team.facilities.medicalCenter, ratio))) {
      const injury = createInjury({ seed: sessionSeed, player, cause: 'training', season: state.league.season, week: state.league.currentWeek, severityBias: plan.intensity === 'intense' ? .18 : 0 });
      applyInjury(player, injury);
      injuredWeeks = injury.remainingWeeks;
    }
    return {
      playerId: player.id,
      xpGained: xp,
      fitnessDelta: player.fitness - beforeFitness,
      attributeGained,
      injuredWeeks,
      ...(breakthrough ? { breakthrough } : {}),
      masteryAttribute: attribute,
      masteryGained: mastery.gained,
      ...(mastery.traitUnlocked ? { masteryTrait: mastery.traitUnlocked } : {}),
      ...(mastery.milestone ? { masteryMilestone: mastery.milestone } : {}),
      ...(drill.buff ? { buffLabel: drill.buff.label } : {}),
      ...(mentored ? { mentored } : {}),
    };
  }

  /** Adds mastery and pays out milestones: 25 gives XP, 50 a skill point, 100 the attribute's trait. */
  private grantMastery(player: Player, attribute: AttributeKey, amount: number) {
    const outcome = addMastery(player, attribute, amount);
    if (outcome.milestone === 25) this.rpg.awardXp(player, 50);
    if (outcome.milestone === 50) player.skillPoints += 1;
    if (outcome.traitUnlocked) player.traitIds.push(outcome.traitUnlocked);
    return outcome;
  }

  private masteryGain(plan: TrainingSessionPlan, breakthrough: boolean): number {
    const grade = GRADE_MULTIPLIER[plan.grade ?? 'B'];
    return Math.round(BASE_MASTERY * INTENSITY_MASTERY[plan.intensity] * grade * (breakthrough ? 2 : 1) * (plan.scope === 'unit' ? 0.7 : 1));
  }

  private baseXp(state: GameState, player: Player, drill: TrainingDrill, plan: TrainingSessionPlan, mentored: boolean): number {
    const team = state.teams.find((candidate) => candidate.id === state.clubId)!;
    const coachingRank = state.manager.perks.coaching ?? 0;
    const coachingAbility = 1 + (state.manager.attributes.coaching - 55) / 500;
    if (drill.focus === 'recovery') return 0;
    const planMultiplier = this.planMultiplier(player, drill.focus);
    const personalityMultiplier = player.personality === 'professional' ? 1.08 : player.personality === 'volatile' ? 0.94 : 1;
    return 30 * (1 + team.facilities.trainingGround * 0.18) * coachingAbility * (1 + coachingRank * 0.04) * planMultiplier *
      personalityMultiplier * INTENSITY_XP[plan.intensity] * (plan.scope === 'unit' ? 0.55 : 1) * GRADE_MULTIPLIER[plan.grade ?? 'B'] * (mentored ? MENTORING_XP : 1);
  }

  private growthChance(player: Player, focus: AttributeKey, facility: number, plan: TrainingSessionPlan, youthDevelopment: number): number {
    const chance = 0.18 + facility * 0.06 + Math.max(-.03, Math.min(.08, (youthDevelopment - 55) / 400)) + (this.planMultiplier(player, focus) > 1 ? 0.08 : 0);
    const grade: TrainingGrade = plan.grade ?? 'B';
    return Math.min(0.72, chance * (plan.scope === 'unit' ? 0.65 : 1) * (grade === 'B' ? 1 : GRADE_MULTIPLIER[grade]));
  }

  /** Base 5 %, better grounds and a driven character make it likelier. */
  private breakthroughChance(player: Player, facility: number): number {
    return Math.min(0.25, 0.05 + facility * 0.01 + (player.personality === 'driven' ? 0.04 : 0));
  }

  private injuryChance(drill: TrainingDrill, intensity: TrainingIntensity, medicalLevel: number, loadRatio: number): number {
    const base = INTENSITY_INJURY[intensity] * (drill.injuryRisk ?? 1) * Math.max(0.55, 1 - (medicalLevel - 1) * 0.08);
    return Math.min(0.5, base * loadRiskFactor(loadRatio));
  }

  private fitnessCost(drill: TrainingDrill, scope: TrainingScope, intensity: TrainingIntensity): number {
    return Math.round(INTENSITY_FITNESS[intensity] * (drill.fitnessCost ?? 1) * (scope === 'unit' ? 0.75 : 1));
  }

  private planMultiplier(player: Player, focus: AttributeKey): number {
    const technical = ['shooting', 'passing', 'dribbling'].includes(focus);
    const physical = ['pace', 'physical', 'stamina'].includes(focus);
    if (player.developmentPlan === 'technical' && technical) return 1.18;
    if (player.developmentPlan === 'physical' && physical) return 1.18;
    if (player.developmentPlan === 'position' && this.isPositionFocus(player, focus)) return 1.2;
    return 1;
  }

  private isPositionFocus(player: Player, focus: AttributeKey): boolean {
    return this.positionFocus(player).includes(focus);
  }

  private positionFocus(player: Player): AttributeKey[] {
    if (player.positionGroup === 'GK') return ['goalkeeping'];
    if (player.positionGroup === 'DEF') return ['defending', 'physical', 'pace'];
    if (player.positionGroup === 'MID') return ['passing', 'dribbling', 'stamina'];
    return ['shooting', 'pace', 'dribbling'];
  }

  private recompute(player: Player): void {
    player.overall = computeOverall(player.attributes, player.positionGroup);
    player.potential = Math.max(player.potential, player.overall);
    player.marketValue = marketValueFor(player.overall, player.age, player.potential);
  }

  private sessionSeed(state: GameState, clubId: string, slot: number): number {
    return hash32(`${clubId}|${state.league.season}|${state.league.currentWeek}|training|${slot}`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
