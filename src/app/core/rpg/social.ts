import { Player } from '../../models/player.model';
import { clamp } from '../util';
import { hash32 } from '../visual-identity';

/**
 * How a player acts among the others. The role follows from his personality and, where the personality leaves
 * room, from his id, so it never changes and needs no save field. It feeds the team spirit and decides who can
 * become a duo partner (a loner keeps to himself).
 */
export type SocialRole = 'team-player' | 'egoist' | 'loner';

export function socialRole(player: Pick<Player, 'id' | 'personality'>): SocialRole | null {
  const roll = hash32(`${player.id}|social-v1`);
  switch (player.personality) {
    case 'team-player':
      return 'team-player';
    case 'volatile':
      return roll % 2 === 0 ? 'egoist' : 'loner';
    case 'flair':
      return roll % 3 === 0 ? 'egoist' : null;
    case 'driven':
      return roll % 4 === 0 ? 'loner' : null;
    default:
      return null;
  }
}

export const SOCIAL_LABEL: Record<SocialRole, { name: [string, string]; text: [string, string] }> =
  {
    'team-player': {
      name: ['Teamplayer', 'Team player'],
      text: [
        'Hebt die Stimmung und macht Egoisten erträglicher.',
        'Lifts the mood and makes egoists easier to live with.',
      ],
    },
    egoist: {
      name: ['Egoist', 'Egoist'],
      text: [
        'Denkt zuerst an sich; kostet Teamgeist, solange die Teamplayer fehlen.',
        'Thinks of himself first; costs team spirit unless team players hold the room together.',
      ],
    },
    loner: {
      name: ['Einzelgänger', 'Loner'],
      text: [
        'Bleibt für sich: kostet etwas Teamgeist und wird kein Duo-Partner.',
        'Keeps to himself: costs a little spirit and never becomes a duo partner.',
      ],
    },
  };

/** Team players needed to hold egoists in check. */
export const GLUE_PLAYERS = 3;

export interface SocialMix {
  teamPlayers: number;
  egoists: number;
  loners: number;
  /** Points added to (or taken from) the pull of the team spirit. */
  spirit: number;
}

/** The squad's social balance as a number for the spirit: team players lift it, egoists and loners drag it down. */
export function socialMix(players: readonly Pick<Player, 'id' | 'personality'>[]): SocialMix {
  let teamPlayers = 0;
  let egoists = 0;
  let loners = 0;
  for (const player of players) {
    const role = socialRole(player);
    if (role === 'team-player') teamPlayers++;
    else if (role === 'egoist') egoists++;
    else if (role === 'loner') loners++;
  }
  const lift = clamp(teamPlayers * 0.8, 0, 6);
  // With enough team players around, an egoist does less harm.
  const egoistCost = egoists * 0.8 * (teamPlayers >= GLUE_PLAYERS ? 0.6 : 1);
  const lonerCost = clamp(loners * 0.3, 0, 2);
  return { teamPlayers, egoists, loners, spirit: lift - Math.min(5, egoistCost + lonerCost) };
}
