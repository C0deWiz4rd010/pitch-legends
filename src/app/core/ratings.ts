import { AttributeKey, PositionGroup } from '../models/enums';
import { Player, PlayerAttributes } from '../models/player.model';
import { Role } from '../models/tactics.model';
import { getTrait } from '../data/traits';
import { clamp } from './util';

/** Weightings that turn raw attributes into an overall rating per position group. */
const OVERALL_WEIGHTS: Record<PositionGroup, Partial<Record<AttributeKey, number>>> = {
  GK: { goalkeeping: 0.68, physical: 0.12, passing: 0.1, pace: 0.1 },
  DEF: { defending: 0.4, physical: 0.22, pace: 0.16, passing: 0.12, stamina: 0.1 },
  MID: { passing: 0.26, dribbling: 0.18, stamina: 0.16, defending: 0.16, physical: 0.12, shooting: 0.12 },
  ATT: { shooting: 0.34, pace: 0.22, dribbling: 0.22, physical: 0.12, passing: 0.1 },
};

/** Compute overall (0-99) from attributes for a position group. */
export function computeOverall(attributes: PlayerAttributes, group: PositionGroup): number {
  const weights = OVERALL_WEIGHTS[group];
  let total = 0;
  let weightSum = 0;
  for (const key of Object.keys(weights) as AttributeKey[]) {
    const w = weights[key]!;
    total += attributes[key] * w;
    weightSum += w;
  }
  return Math.round(clamp(total / weightSum, 1, 99));
}

/**
 * Role fit (0-100): how well a player's attributes match a tactical role's
 * demands. Used to rate lineups and warn about square-peg selections.
 */
export function roleFit(attributes: PlayerAttributes, role: Role): number {
  let total = 0;
  let weightSum = 0;
  for (const key of Object.keys(role.attributeWeights) as AttributeKey[]) {
    const w = role.attributeWeights[key]!;
    total += attributes[key] * w;
    weightSum += w;
  }
  return Math.round(clamp(total / weightSum, 1, 99));
}

/** Position familiarity multiplier when a player is out of position. */
export function positionFamiliarity(player: Player, slotPosition: string): number {
  if (player.position === slotPosition) return 1;
  if (player.altPositions.includes(slotPosition as never)) return 0.92;
  // Same broad group is passable, otherwise poor.
  const group = groupForPosition(slotPosition);
  return group === player.positionGroup ? 0.82 : 0.6;
}

export function groupForPosition(position: string): PositionGroup {
  if (position === 'GK') return 'GK';
  if (['RB', 'LB', 'CB', 'RCB', 'LCB', 'RWB', 'LWB'].includes(position)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'RM', 'LM'].includes(position)) return 'MID';
  return 'ATT';
}

/**
 * Effective match rating for a player in a given role & slot, folding in
 * fitness, morale, form and trait bonuses. Returns ~1-99.
 */
export function effectiveRating(player: Player, role: Role, slotPosition: string): number {
  const base = roleFit(withTraitBonuses(player), role);
  const fam = positionFamiliarity(player, slotPosition);
  const fitnessMod = 0.75 + (player.fitness / 100) * 0.25; // 0.75 .. 1.0
  const moraleMod = 0.94 + (player.morale / 100) * 0.12; // 0.94 .. 1.06
  const formMod = 1 + player.form * 0.012; // ±6%
  return clamp(base * fam * fitnessMod * moraleMod * formMod, 1, 99);
}

/** Returns a copy of attributes with unlocked trait modifiers applied. */
export function withTraitBonuses(player: Player): PlayerAttributes {
  const attrs = { ...player.attributes };
  for (const id of player.traitIds) {
    const trait = getTrait(id);
    if (!trait) continue;
    for (const key of Object.keys(trait.modifiers) as AttributeKey[]) {
      attrs[key] = clamp(attrs[key] + trait.modifiers[key]!, 1, 99);
    }
  }
  return attrs;
}

export function playerName(player: Player): string {
  return `${player.firstName} ${player.lastName}`;
}

export function marketValueFor(overall: number, age: number, potential: number): number {
  const base = Math.pow(Math.max(overall - 40, 1), 2.6) * 900;
  const ageFactor = age <= 23 ? 1.35 : age <= 27 ? 1.1 : age <= 30 ? 0.85 : 0.5;
  const potFactor = 1 + Math.max(potential - overall, 0) * 0.03;
  return Math.round((base * ageFactor * potFactor) / 1000) * 1000;
}
