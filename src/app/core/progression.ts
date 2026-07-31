/** RPG progression maths shared by generators and the RPG service. */

/** XP required to advance FROM the given level to the next. */
export function xpToNextForLevel(level: number): number {
  return Math.round(120 + level * level * 22 + level * 40);
}

/** Skill points granted on reaching a level. */
export function skillPointsForLevel(level: number): number {
  return level % 5 === 0 ? 3 : 2;
}

export const MAX_LEVEL = 30;

/** How much each attribute point costs in skill points at a given attribute value. */
export function attributeUpgradeCost(currentValue: number): number {
  if (currentValue >= 90) return 4;
  if (currentValue >= 82) return 3;
  if (currentValue >= 72) return 2;
  return 1;
}
