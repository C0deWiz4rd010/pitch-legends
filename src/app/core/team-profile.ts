import { Team } from '../models/team.model';
import { Player } from '../models/player.model';
import { Tactics } from '../models/tactics.model';
import { AttributeKey } from '../models/enums';
import { effectiveRating, groupForPosition, playerName } from './ratings';
import { getRole } from '../data/roles';
import { clamp } from './util';
import { isPlayerAvailable } from './injury-engine';

/** Team strength profile from lineup, roles and tactics; used by the tactics page analysis. */
export const MENTALITY_ATT: Record<Tactics['mentality'], number> = {
  'ultra-defensive': -8,
  defensive: -4,
  balanced: 0,
  attacking: 4,
  'ultra-attacking': 8,
};
export const MENTALITY_DEF: Record<Tactics['mentality'], number> = {
  'ultra-defensive': 7,
  defensive: 4,
  balanced: 0,
  attacking: -4,
  'ultra-attacking': -8,
};
export const PRESS_AGGRO: Record<Tactics['pressing'], number> = {
  low: -2,
  medium: 0,
  high: 3,
  gegenpress: 6,
};
export const TEMPO_CHANCE: Record<Tactics['tempo'], number> = {
  slow: 0.85,
  balanced: 1,
  fast: 1.15,
};

export interface TeamProfile {
  team: Team;
  isHome: boolean;
  starters: Player[];
  attack: number;
  midfield: number;
  defence: number;
  keeper: number;
  aggression: number;
}

function roleOf(team: Team, playerId: string): string {
  const slot = team.formation.slots.find((s) => s.playerId === playerId);
  if (slot) return slot.roleId;
  const p = team.players.find((pl) => pl.id === playerId);
  const group = p ? p.positionGroup : 'MID';
  return group === 'GK' ? 'gk' : group === 'DEF' ? 'cd' : group === 'MID' ? 'cm' : 'cf';
}

function slotOf(team: Team, playerId: string) {
  return team.formation.slots.find((slot) => slot.playerId === playerId);
}

function avgRating(team: Team, players: Player[]): number {
  if (!players.length) return 45;
  const sum = players.reduce((acc, p) => {
    const slot = slotOf(team, p.id);
    return acc + effectiveRating(p, getRole(roleOf(team, p.id)), slot?.position ?? p.position);
  }, 0);
  return sum / players.length;
}

export function buildProfile(team: Team, isHome: boolean): TeamProfile {
  const starters = team.formation.slots
    .map((s) => team.players.find((p) => p.id === s.playerId))
    .filter((p): p is Player => !!p && isPlayerAvailable(p));

  const homeBonus = isHome ? 3 : 0;
  const t = team.tactics;

  let attack = 40;
  let midfield = 40;
  let defence = 40;
  let keeper = 40;

  if (starters.length) {
    const attackers = starters.filter(
      (p) => groupForPosition(slotOf(team, p.id)?.position ?? p.position) === 'ATT',
    );
    const mids = starters.filter(
      (p) => groupForPosition(slotOf(team, p.id)?.position ?? p.position) === 'MID',
    );
    const defs = starters.filter(
      (p) => groupForPosition(slotOf(team, p.id)?.position ?? p.position) === 'DEF',
    );
    const gk = starters.find(
      (p) => groupForPosition(slotOf(team, p.id)?.position ?? p.position) === 'GK',
    );

    attack =
      avgRating(team, attackers.length ? attackers : mids) + MENTALITY_ATT[t.mentality] + homeBonus;
    midfield = avgRating(team, mids.length ? mids : starters) + homeBonus;
    defence = avgRating(team, defs.length ? defs : mids) + MENTALITY_DEF[t.mentality] + homeBonus;
    keeper = gk
      ? effectiveRating(gk, getRole(roleOf(team, gk.id)), slotOf(team, gk.id)?.position ?? 'GK') +
        homeBonus
      : 45;
  }

  const press = PRESS_AGGRO[t.pressing];
  defence += press * 0.5;
  const instructions = team.formation.slots.map((slot) => slot.instruction);
  const attackDuties = instructions.filter((instruction) => instruction.duty === 'attack').length;
  const defendDuties = instructions.filter((instruction) => instruction.duty === 'defend').length;
  const forwardRuns = instructions.reduce(
    (sum, instruction) =>
      sum +
      (instruction.forwardRuns === 'often' ? 1 : instruction.forwardRuns === 'rarely' ? -1 : 0),
    0,
  );
  const pressBias = instructions.reduce((sum, instruction) => sum + instruction.pressingBias, 0);
  const aggressiveMarking = instructions.filter(
    (instruction) => instruction.marking === 'aggressive',
  ).length;

  attack += attackDuties * 0.45 + forwardRuns * 0.3;
  defence += defendDuties * 0.4 + pressBias * 0.2;
  midfield += instructions.filter((instruction) => instruction.stayInPosition).length * 0.18;

  if (t.counterAttack)
    attack += t.mentality === 'defensive' || t.mentality === 'ultra-defensive' ? 3 : 1;
  if (t.width === 'wide') attack += 1.5;
  if (t.width === 'narrow') midfield += 2;
  if (t.buildUp === 'play-out-of-defence') {
    midfield += 2;
    defence += 1;
  } else if (t.buildUp === 'long-ball') {
    attack += 2;
    midfield -= 1.5;
  }
  if (t.passing === 'short') midfield += 2;
  if (t.passing === 'direct') {
    attack += 1.5;
    midfield -= 1;
  }
  if (t.defensiveLine === 'high') {
    attack += 2;
    defence += t.offsideTrap ? 1.5 : -2;
  } else if (t.defensiveLine === 'deep') {
    defence += 2;
    attack -= 1;
  }

  return {
    team,
    isHome,
    starters,
    attack: clamp(attack, 30, 99),
    midfield: clamp(midfield, 30, 99),
    defence: clamp(defence, 30, 99),
    keeper: clamp(keeper, 30, 99),
    aggression: 20 + press * 3 + aggressiveMarking * 0.8 + Math.max(0, pressBias),
  };
}
