import { Injectable, inject } from '@angular/core';
import { AttributeKey, PositionGroup } from '../../models/enums';
import {
  GameState,
  TrainingIntensity,
  TrainingPlayerResult,
  TrainingScope,
  TrainingSessionPlan,
  TrainingSessionResult,
} from '../../models/game.model';
import { Player } from '../../models/player.model';
import { computeOverall, marketValueFor } from '../ratings';
import { Rng, clamp } from '../util';
import { hash32 } from '../visual-identity';
import { RpgService } from './rpg.service';

export interface TrainingDrill {
  id: string;
  name: string;
  icon: string;
  focus: AttributeKey | 'recovery';
  description: string;
  group: PositionGroup | 'ALL';
}

export const TRAINING_DRILLS: TrainingDrill[] = [
  { id: 'finishing', name: 'Finishing', icon: 'SH', focus: 'shooting', description: 'Sharpen shooting and composure in front of goal.', group: 'ATT' },
  { id: 'vision', name: 'Vision', icon: 'PS', focus: 'passing', description: 'Improve range and weight of passing.', group: 'MID' },
  { id: 'control', name: 'Close Control', icon: 'DR', focus: 'dribbling', description: 'Tighten dribbling and ball manipulation.', group: 'ALL' },
  { id: 'tackling', name: 'Tackling', icon: 'DF', focus: 'defending', description: 'Drill positioning, marking and tackling.', group: 'DEF' },
  { id: 'sprints', name: 'Sprints', icon: 'PC', focus: 'pace', description: 'Boost acceleration and top speed.', group: 'ALL' },
  { id: 'strength', name: 'Strength', icon: 'PH', focus: 'physical', description: 'Build strength and aerial dominance.', group: 'ALL' },
  { id: 'endurance', name: 'Endurance', icon: 'ST', focus: 'stamina', description: 'Raise stamina for a full 90 minutes.', group: 'ALL' },
  { id: 'handling', name: 'Shot Stopping', icon: 'GK', focus: 'goalkeeping', description: 'Goalkeeper reflexes and handling.', group: 'GK' },
  { id: 'recovery', name: 'Recovery', icon: 'RC', focus: 'recovery', description: 'Rest and regain fitness — no XP gained.', group: 'ALL' },
];

export interface TrainingPlayerPreview {
  playerId: string;
  xpMin: number;
  xpMax: number;
  fitnessDelta: number;
  growthChance: number;
  injuryRisk: number;
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

const INTENSITY_XP: Record<TrainingIntensity, number> = { light: 0.8, normal: 1, intense: 1.25 };
const INTENSITY_FITNESS: Record<TrainingIntensity, number> = { light: 7, normal: 12, intense: 18 };
const INTENSITY_INJURY: Record<TrainingIntensity, number> = { light: 0.01, normal: 0.03, intense: 0.06 };

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
            if (player.injuryWeeks > 0 && !recovery) sessionErrors.push(`injured:${player.id}`);
            if (!recovery && developmentIds.has(player.id)) sessionErrors.push(`already-trained:${player.id}`);
            if (recovery && recoveryIds.has(player.id)) sessionErrors.push(`already-recovered:${player.id}`);
            if (!recovery && plan.intensity === 'intense' && player.fitness < 55) sessionErrors.push(`fitness:${player.id}`);
          }
          for (const player of targets) (recovery ? recoveryIds : developmentIds).add(player.id);
        }

        const seed = this.sessionSeed(state, club.id, plan.slot);
        return {
          plan,
          drill,
          players: drill ? targets.map((player) => this.playerPreview(state, player, drill, plan.scope, plan.intensity)) : [],
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
      for (const targetId of session.plan.targetIds) {
        const player = playerCopies.find((candidate) => candidate.id === targetId);
        if (!player) return { ok: false, errors: [`target-invalid:${targetId}`], sessions: [] };
        results.push(this.executePlayer(state, player, drill, session.plan.scope, session.plan.intensity, session.seed));
      }
      sessions.push({ plan: structuredClone(session.plan), players: results, seed: session.seed });
    }

    club.players = playerCopies;
    state.trainingWeek.slotsUsed += sessions.length;
    state.trainingWeek.completedSessions.push(...sessions);
    return { ok: true, errors: [], sessions };
  }

  drill(id: string): TrainingDrill | undefined {
    return TRAINING_DRILLS.find((drill) => drill.id === id);
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
    scope: TrainingScope,
    intensity: TrainingIntensity,
  ): TrainingPlayerPreview {
    if (drill.focus === 'recovery') {
      return { playerId: player.id, xpMin: 0, xpMax: 0, fitnessDelta: Math.min(30, 100 - player.fitness), growthChance: 0, injuryRisk: 0 };
    }
    const team = state.teams.find((candidate) => candidate.id === state.clubId)!;
    const baseXp = this.baseXp(state, player, drill, scope, intensity);
    const cost = this.fitnessCost(scope, intensity);
    return {
      playerId: player.id,
      xpMin: Math.round(baseXp * 0.85),
      xpMax: Math.round(baseXp * 1.2),
      fitnessDelta: -Math.min(player.fitness, cost),
      growthChance: Math.round(this.growthChance(player, drill.focus, team.facilities.trainingGround, scope) * 100),
      injuryRisk: Math.round(this.injuryChance(intensity, team.facilities.medicalCenter) * 1000) / 10,
    };
  }

  private executePlayer(
    state: GameState,
    player: Player,
    drill: TrainingDrill,
    scope: TrainingScope,
    intensity: TrainingIntensity,
    sessionSeed: number,
  ): TrainingPlayerResult {
    if (drill.focus === 'recovery') {
      const before = player.fitness;
      player.fitness = clamp(player.fitness + 30, 0, 100);
      return { playerId: player.id, xpGained: 0, fitnessDelta: player.fitness - before, attributeGained: null, injuredWeeks: 0 };
    }

    const team = state.teams.find((candidate) => candidate.id === state.clubId)!;
    const rng = new Rng(hash32(`${sessionSeed}|${player.id}`));
    const cost = this.fitnessCost(scope, intensity);
    const beforeFitness = player.fitness;
    player.fitness = clamp(player.fitness - cost, 0, 100);
    const xp = Math.round(this.baseXp(state, player, drill, scope, intensity) * rng.float(0.85, 1.2));
    this.rpg.awardXp(player, xp);

    let attributeGained: AttributeKey | null = null;
    const attribute = drill.focus;
    const canGrow = player.attributes[attribute] < 99 && player.overall < player.potential + 2;
    if (canGrow && rng.bool(this.growthChance(player, attribute, team.facilities.trainingGround, scope))) {
      player.attributes[attribute] = clamp(player.attributes[attribute] + 1, 1, 99);
      player.overall = computeOverall(player.attributes, player.positionGroup);
      player.potential = Math.max(player.potential, player.overall);
      player.marketValue = marketValueFor(player.overall, player.age, player.potential);
      attributeGained = attribute;
    }

    let injuredWeeks = 0;
    if (rng.bool(this.injuryChance(intensity, team.facilities.medicalCenter))) {
      injuredWeeks = rng.int(1, intensity === 'intense' ? 3 : 2);
      player.injuryWeeks = Math.max(player.injuryWeeks, injuredWeeks);
    }
    return { playerId: player.id, xpGained: xp, fitnessDelta: player.fitness - beforeFitness, attributeGained, injuredWeeks };
  }

  private baseXp(state: GameState, player: Player, drill: TrainingDrill, scope: TrainingScope, intensity: TrainingIntensity): number {
    const team = state.teams.find((candidate) => candidate.id === state.clubId)!;
    const coachingRank = state.manager.perks.coaching ?? 0;
    if (drill.focus === 'recovery') return 0;
    const planMultiplier = this.planMultiplier(player, drill.focus);
    const personalityMultiplier = player.personality === 'professional' ? 1.08 : player.personality === 'volatile' ? 0.94 : 1;
    return 30 * (1 + team.facilities.trainingGround * 0.18) * (1 + coachingRank * 0.04) * planMultiplier *
      personalityMultiplier * INTENSITY_XP[intensity] * (scope === 'unit' ? 0.55 : 1);
  }

  private growthChance(player: Player, focus: AttributeKey, facility: number, scope: TrainingScope): number {
    const chance = 0.18 + facility * 0.06 + (this.planMultiplier(player, focus) > 1 ? 0.08 : 0);
    return Math.min(0.72, chance * (scope === 'unit' ? 0.65 : 1));
  }

  private injuryChance(intensity: TrainingIntensity, medicalLevel: number): number {
    return INTENSITY_INJURY[intensity] * Math.max(0.55, 1 - (medicalLevel - 1) * 0.08);
  }

  private fitnessCost(scope: TrainingScope, intensity: TrainingIntensity): number {
    return Math.round(INTENSITY_FITNESS[intensity] * (scope === 'unit' ? 0.75 : 1));
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
    if (player.positionGroup === 'GK') return focus === 'goalkeeping';
    if (player.positionGroup === 'DEF') return ['defending', 'physical', 'pace'].includes(focus);
    if (player.positionGroup === 'MID') return ['passing', 'dribbling', 'stamina'].includes(focus);
    return ['shooting', 'pace', 'dribbling'].includes(focus);
  }

  private sessionSeed(state: GameState, clubId: string, slot: number): number {
    return hash32(`${clubId}|${state.league.season}|${state.league.currentWeek}|training|${slot}`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
