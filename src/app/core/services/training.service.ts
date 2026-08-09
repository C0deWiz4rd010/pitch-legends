import { Injectable, inject } from '@angular/core';
import { Player } from '../../models/player.model';
import { AttributeKey } from '../../models/enums';
import { computeOverall, marketValueFor } from '../ratings';
import { Rng, clamp } from '../util';
import { RpgService } from './rpg.service';

export interface TrainingDrill {
  id: string;
  name: string;
  icon: string;
  /** Attribute this drill develops, or 'recovery' for a rest session. */
  focus: AttributeKey | 'recovery';
  description: string;
}

export const TRAINING_DRILLS: TrainingDrill[] = [
  { id: 'finishing', name: 'Finishing', icon: '🎯', focus: 'shooting', description: 'Sharpen shooting and composure in front of goal.' },
  { id: 'vision', name: 'Vision', icon: '🧠', focus: 'passing', description: 'Improve range and weight of passing.' },
  { id: 'control', name: 'Close Control', icon: '🕹️', focus: 'dribbling', description: 'Tighten dribbling and ball manipulation.' },
  { id: 'tackling', name: 'Tackling', icon: '🛡️', focus: 'defending', description: 'Drill positioning, marking and tackling.' },
  { id: 'sprints', name: 'Sprints', icon: '⚡', focus: 'pace', description: 'Boost acceleration and top speed.' },
  { id: 'strength', name: 'Strength', icon: '💪', focus: 'physical', description: 'Build strength and aerial dominance.' },
  { id: 'endurance', name: 'Endurance', icon: '🏃', focus: 'stamina', description: 'Raise stamina for a full 90 minutes.' },
  { id: 'handling', name: 'Shot Stopping', icon: '🧤', focus: 'goalkeeping', description: 'Goalkeeper reflexes and handling.' },
  { id: 'recovery', name: 'Recovery', icon: '🧊', focus: 'recovery', description: 'Rest and regain fitness — no XP gained.' },
];

export interface TrainingOutcome {
  ok: boolean;
  message: string;
  xpGained: number;
  attributeGained: AttributeKey | null;
  levelsGained: number;
}

const FITNESS_COST = 12;
const MIN_FITNESS_TO_TRAIN = 25;

@Injectable({ providedIn: 'root' })
export class TrainingService {
  private readonly rpg = inject(RpgService);
  private readonly rng = new Rng();

  /** Run one training session for a player. Mutates the player (call in mutate). */
  train(
    player: Player,
    drill: TrainingDrill,
    trainingGroundLevel: number,
    coachingMultiplier = 1,
  ): TrainingOutcome {
    if (player.injuryWeeks > 0) {
      return this.fail('Injured players cannot train.');
    }

    if (drill.focus === 'recovery') {
      player.fitness = clamp(player.fitness + 30, 0, 100);
      return { ok: true, message: `${player.firstName} rested and recovered fitness.`, xpGained: 0, attributeGained: null, levelsGained: 0 };
    }

    if (player.fitness < MIN_FITNESS_TO_TRAIN) {
      return this.fail(`${player.firstName} is too fatigued — run a Recovery session first.`);
    }

    player.fitness = clamp(player.fitness - Math.max(7, Math.round(FITNESS_COST / coachingMultiplier)), 0, 100);

    const xp = Math.round(
      30 * (1 + trainingGroundLevel * 0.18) * coachingMultiplier * this.rng.float(0.85, 1.2),
    );
    const { levelsGained } = this.rpg.awardXp(player, xp);

    // Chance of a direct attribute bump, better facilities help.
    let attributeGained: AttributeKey | null = null;
    const attr = drill.focus;
    const canGrow = player.attributes[attr] < 99 && player.overall < player.potential + 2;
    const growChance = 0.18 + trainingGroundLevel * 0.06;
    if (canGrow && this.rng.bool(growChance)) {
      player.attributes[attr] = clamp(player.attributes[attr] + 1, 1, 99);
      player.overall = computeOverall(player.attributes, player.positionGroup);
      player.potential = Math.max(player.potential, player.overall);
      player.marketValue = marketValueFor(player.overall, player.age, player.potential);
      attributeGained = attr;
    }

    const parts = [`+${xp} XP`];
    if (attributeGained) parts.push(`+1 ${attributeGained}`);
    if (levelsGained) parts.push(`⬆ Level up!`);
    return {
      ok: true,
      message: `${player.firstName} trained ${drill.name}: ${parts.join(', ')}.`,
      xpGained: xp,
      attributeGained,
      levelsGained,
    };
  }

  private fail(message: string): TrainingOutcome {
    return { ok: false, message, xpGained: 0, attributeGained: null, levelsGained: 0 };
  }
}
