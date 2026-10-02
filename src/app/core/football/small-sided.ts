import { defaultInstruction, Formation } from '../../models/tactics.model';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { getRole } from '../../data/roles';
import { Position, PositionGroup } from '../../models/enums';

/** Keeper, two defenders, a playmaker and a striker. */
const SLOTS: Array<{ position: Position; x: number; y: number; roleId: string; group: PositionGroup }> = [
  { position: 'GK', x: 0.05, y: 0.5, roleId: 'gk', group: 'GK' },
  { position: 'LCB', x: 0.26, y: 0.3, roleId: 'bpd', group: 'DEF' },
  { position: 'RCB', x: 0.26, y: 0.7, roleId: 'cd', group: 'DEF' },
  { position: 'CM', x: 0.5, y: 0.5, roleId: 'b2b', group: 'MID' },
  { position: 'ST', x: 0.76, y: 0.5, roleId: 'cf', group: 'ATT' },
];

export function smallSidedFormation(): Formation {
  return {
    id: '5v5',
    name: '1-2-1-1',
    slots: SLOTS.map((slot, index) => ({
      id: `small-slot-${index}`, position: slot.position, x: slot.x, y: slot.y, roleId: slot.roleId, playerId: null,
      instruction: defaultInstruction(getRole(slot.roleId).defaultDuty),
    })),
  };
}

/** The best five of a squad for five-a-side, with three substitutes. */
export function smallSidedTeam(team: Team): Team {
  const copy = structuredClone(team);
  const formation = smallSidedFormation();
  const used = new Set<string>();
  const pick = (group: PositionGroup): Player | undefined => {
    const candidates = copy.players.filter((player) => !used.has(player.id));
    return candidates.filter((player) => player.positionGroup === group).sort((a, b) => b.overall - a.overall)[0]
      ?? candidates.filter((player) => player.positionGroup !== 'GK').sort((a, b) => b.overall - a.overall)[0];
  };
  for (const [index, slot] of SLOTS.entries()) {
    const player = pick(slot.group);
    if (!player) continue;
    used.add(player.id);
    formation.slots[index].playerId = player.id;
  }
  const starters = copy.players.filter((player) => used.has(player.id));
  const bench = copy.players.filter((player) => !used.has(player.id) && player.positionGroup !== 'GK').sort((a, b) => b.overall - a.overall).slice(0, 3);
  copy.players = [...starters, ...bench];
  copy.formation = formation;
  // Quick, short passing suits the cage.
  copy.tactics = { ...copy.tactics, passing: 'short', tempo: 'fast', width: 'balanced', offsideTrap: false };
  return copy;
}
