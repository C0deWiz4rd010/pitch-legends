import { PersonalGoal, Player } from '../../models/player.model';
import { Rng } from '../util';

/** A fresh goal for the season, from what suits the player's position; the reward is the same 220 XP as ever. */
export function createPersonalGoal(
  player: Pick<Player, 'positionGroup' | 'overall'>,
  rng: Rng,
): PersonalGoal {
  const group = player.positionGroup;
  const options: PersonalGoal[] = [
    { type: 'appearances', target: rng.int(18, 28), progress: 0, rewardXp: 220, completed: false },
    // The rating goal counts tenths: 68 means an average of 6.8, a little above the typical 6.6.
    {
      type: 'rating',
      target: 66 + Math.min(4, Math.max(0, Math.round((player.overall - 60) / 10))) + rng.int(0, 3),
      progress: 0,
      rewardXp: 220,
      completed: false,
    },
  ];
  if (group === 'ATT')
    options.push({
      type: 'goals',
      target: rng.int(5, 13),
      progress: 0,
      rewardXp: 220,
      completed: false,
    });
  else if (group === 'MID')
    options.push({
      type: 'assists',
      target: rng.int(4, 11),
      progress: 0,
      rewardXp: 220,
      completed: false,
    });
  else
    options.push({
      type: 'clean-sheets',
      target: rng.int(4, 10),
      progress: 0,
      rewardXp: 220,
      completed: false,
    });
  return rng.pick(options);
}
