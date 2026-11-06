import { ManagerAttributes, ManagerPerkPath, ManagerProfile } from '../../models/game.model';
import { clamp } from '../util';

/** Every perk rank is worth two points of its attribute, so a coach grows with his career (55 to 65 at rank 5). */
export const PERK_ATTRIBUTE_STEP = 2;

/** An attribute with the perk ranks of its path added: this is what all effects of the manager read. */
export function managerAttribute(manager: ManagerProfile, key: keyof ManagerAttributes): number {
  const rank = manager.perks[key as ManagerPerkPath] ?? 0;
  return clamp(manager.attributes[key] + rank * PERK_ATTRIBUTE_STEP, 1, 99);
}

export function hasManagerTrait(manager: ManagerProfile, trait: string): boolean {
  return manager.traits.includes(trait);
}

/**
 * What each trait is good for. The values are small on purpose: a trait tilts decisions, it does not win matches.
 * - motivator: wins lift the squad more, spirit settles higher.
 * - calm: defeats cost less morale and less spirit.
 * - developer: the squad learns a little faster in training, the academy intake is a little better.
 * - negotiator: a better hand in contract talks.
 * - analyst: scouting reports arrive a week sooner.
 * - risk-taker: bolder choices in dressing-room events pay more when they work and cost more when they do not.
 */
export const TRAIT_EFFECTS = {
  motivatorWinMorale: 1,
  motivatorSpirit: 3,
  calmLossRelief: 1,
  calmSpiritShare: 0.5,
  developerTrainingXp: 0.05,
  developerYouth: 1,
  negotiatorEdge: 0.02,
  analystScoutWeeks: 1,
  riskTakerSwing: 1.5,
} as const;

/** The edge a coach's youth work gives an academy intake (about 0 to +4 overall points). */
export function youthWorkBonus(manager: ManagerProfile, staffFactor = 0): number {
  // The perk counts twice: once inside the attribute and once for the coach's own youth programme.
  const attribute = (managerAttribute(manager, 'youthDevelopment') - 55) / 10;
  const programme = (manager.perks.youthDevelopment ?? 0) * 0.4;
  const trait = hasManagerTrait(manager, 'developer') ? TRAIT_EFFECTS.developerYouth : 0;
  return clamp(Math.round(attribute + programme + trait + staffFactor * 4), 0, 6);
}
