import { Player } from '../../models/player.model';
import { archetypeProfile, talentsFor } from '../../data/talents';
import { RpgService } from '../services/rpg.service';
import { MAX_LEVEL, skillPointsForLevel } from '../progression';
import { hash32 } from '../visual-identity';

// The service holds no state; the build uses its rules (costs, levels, potential) instead of copying them.
const rpg = new RpgService();

/** Skill points a player of this level has earned in total (every level from the second gives two, every fifth three). */
export function earnedSkillPoints(level: number): number {
  let total = 0;
  for (let l = 2; l <= Math.min(level, MAX_LEVEL); l++) total += skillPointsForLevel(l);
  return total;
}

/**
 * Spends the player's points on his archetype's talents: the root first, then one of the two branches (the same one for the
 * same player every time) and its elite node. A player who is not managed by a human is built this way when he
 * is generated and whenever he levels up.
 */
export function autoSpendTalents(player: Player): void {
  const nodes = talentsFor(player.archetype);
  if (!nodes.length) return;
  const branch = hash32(`${player.id}|talent-branch`) % 2 === 0 ? 'a' : 'b';
  const order = [
    ...nodes.filter((node) => node.tier === 1),
    ...nodes.filter((node) => node.tier === 2 && node.branch === branch),
    ...nodes.filter((node) => node.tier === 3 && node.branch === branch),
  ];
  let spent = true;
  while (spent && player.skillPoints > 0) {
    spent = false;
    for (const node of order) {
      if (rpg.unlockTalent(player, node.id)) {
        spent = true;
        break;
      }
    }
  }
}

/** The traits a computer-built player of each position group reaches for, in order. */
const TRAIT_PREFERENCE: Record<Player['positionGroup'], string[]> = {
  ATT: ['clinical', 'cannon', 'composed', 'speedster', 'bender'],
  MID: ['playmaker', 'velvet', 'maestro', 'engine', 'visionary', 'recovery'],
  DEF: ['wall', 'skyscraper', 'rock', 'bodyguard', 'recovery'],
  GK: ['safehands', 'longreach'],
};
const MAX_AUTO_TRAITS = 4;

/**
 * Talents first, then the archetype's primary and secondary attribute while he has room to grow (his potential caps it),
 * and finally a trait or two, so points never pile up unused for years.
 */
export function autoSpend(player: Player): void {
  autoSpendTalents(player);
  const profile = archetypeProfile(player.archetype);
  if (profile) {
    let guard = 60;
    while (player.skillPoints > 0 && guard-- > 0) {
      if (
        !rpg.upgradeAttribute(player, profile.primary) &&
        !rpg.upgradeAttribute(player, profile.secondary)
      )
        break;
    }
  }
  for (const traitId of TRAIT_PREFERENCE[player.positionGroup]) {
    if (player.skillPoints < 4 || player.traitIds.length >= MAX_AUTO_TRAITS) break;
    rpg.unlockTrait(player, traitId);
  }
}

/** A freshly generated player starts with the build his level would have: his points are spent on talents only. */
export function grantStartingBuild(player: Player): void {
  player.skillPoints += earnedSkillPoints(player.level);
  autoSpendTalents(player);
}
