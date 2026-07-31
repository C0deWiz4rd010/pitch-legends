import { Injectable } from '@angular/core';
import { Player } from '../../models/player.model';
import { AttributeKey } from '../../models/enums';
import { computeOverall, marketValueFor } from '../ratings';
import {
  MAX_LEVEL,
  attributeUpgradeCost,
  skillPointsForLevel,
  xpToNextForLevel,
} from '../progression';
import { TRAITS, getTrait } from '../../data/traits';
import { clamp } from '../util';

export interface LevelUpResult {
  levelsGained: number;
  skillPointsGained: number;
}

/**
 * Pure progression logic. All methods mutate the passed player object, so they
 * must be called on a draft inside GameStateService.mutate().
 */
@Injectable({ providedIn: 'root' })
export class RpgService {
  /** Grant XP and process any resulting level-ups. */
  awardXp(player: Player, amount: number): LevelUpResult {
    if (player.traitIds.includes('wonderkid')) amount = Math.round(amount * 1.25);
    player.xp += Math.max(0, Math.round(amount));

    let levelsGained = 0;
    let skillPointsGained = 0;
    while (player.level < MAX_LEVEL && player.xp >= player.xpToNext) {
      player.xp -= player.xpToNext;
      player.level++;
      const sp = skillPointsForLevel(player.level);
      player.skillPoints += sp;
      skillPointsGained += sp;
      levelsGained++;
      player.xpToNext = xpToNextForLevel(player.level);
    }
    if (player.level >= MAX_LEVEL) {
      player.xp = 0;
      player.xpToNext = xpToNextForLevel(MAX_LEVEL);
    }
    return { levelsGained, skillPointsGained };
  }

  /** Spend skill points to raise one attribute by 1 (respecting potential). */
  upgradeAttribute(player: Player, attr: AttributeKey): boolean {
    const current = player.attributes[attr];
    if (current >= 99) return false;
    if (player.overall >= player.potential && this.isCoreAttribute(player, attr)) return false;
    const cost = attributeUpgradeCost(current);
    if (player.skillPoints < cost) return false;

    player.skillPoints -= cost;
    player.attributes[attr] = clamp(current + 1, 1, 99);
    this.recompute(player);
    return true;
  }

  /** Unlock a trait for skill points once the level requirement is met. */
  unlockTrait(player: Player, traitId: string, cost = 4): boolean {
    const trait = getTrait(traitId);
    if (!trait) return false;
    if (player.traitIds.includes(traitId)) return false;
    if (player.level < trait.unlockLevel) return false;
    if (player.skillPoints < cost) return false;
    player.skillPoints -= cost;
    player.traitIds.push(traitId);
    this.recompute(player);
    return true;
  }

  /** Traits the player is eligible to unlock right now. */
  availableTraits(player: Player) {
    return TRAITS.filter((t) => !player.traitIds.includes(t.id));
  }

  private isCoreAttribute(player: Player, attr: AttributeKey): boolean {
    // Only cap growth of attributes that actually drive this player's overall.
    if (player.positionGroup === 'GK') return attr === 'goalkeeping';
    if (player.positionGroup === 'ATT') return ['shooting', 'pace', 'dribbling'].includes(attr);
    if (player.positionGroup === 'DEF') return ['defending', 'physical', 'pace'].includes(attr);
    return ['passing', 'dribbling', 'stamina'].includes(attr);
  }

  private recompute(player: Player): void {
    player.overall = computeOverall(player.attributes, player.positionGroup);
    player.potential = Math.max(player.potential, player.overall);
    player.marketValue = marketValueFor(player.overall, player.age, player.potential);
  }
}
