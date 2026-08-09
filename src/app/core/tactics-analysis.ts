import { buildProfile, PRESS_AGGRO, TEMPO_CHANCE } from './services/match-sim';
import { groupForPosition } from './ratings';
import { Player } from '../models/player.model';
import { Team } from '../models/team.model';
import { Tactics } from '../models/tactics.model';

export type TacticPresetId =
  | 'balanced'
  | 'possession'
  | 'gegenpress'
  | 'counter'
  | 'low-block'
  | 'custom';

export interface TacticWarning {
  id: string;
  severity: 'info' | 'warning' | 'danger';
  de: string;
  en: string;
}

export interface TacticAnalysis {
  attack: number;
  control: number;
  defence: number;
  transition: number;
  fitnessLoad: number;
  risk: number;
  warnings: TacticWarning[];
}

export type TacticPresetValues = Pick<
  Tactics,
  | 'mentality'
  | 'pressing'
  | 'tempo'
  | 'width'
  | 'defensiveLine'
  | 'buildUp'
  | 'passing'
  | 'offsideTrap'
  | 'counterAttack'
>;

export const TACTIC_PRESETS: Record<Exclude<TacticPresetId, 'custom'>, TacticPresetValues> = {
  balanced: {
    mentality: 'balanced',
    pressing: 'medium',
    tempo: 'balanced',
    width: 'balanced',
    defensiveLine: 'medium',
    buildUp: 'balanced',
    passing: 'mixed',
    offsideTrap: false,
    counterAttack: true,
  },
  possession: {
    mentality: 'balanced',
    pressing: 'medium',
    tempo: 'slow',
    width: 'wide',
    defensiveLine: 'medium',
    buildUp: 'play-out-of-defence',
    passing: 'short',
    offsideTrap: false,
    counterAttack: false,
  },
  gegenpress: {
    mentality: 'attacking',
    pressing: 'gegenpress',
    tempo: 'fast',
    width: 'balanced',
    defensiveLine: 'high',
    buildUp: 'play-out-of-defence',
    passing: 'short',
    offsideTrap: true,
    counterAttack: true,
  },
  counter: {
    mentality: 'defensive',
    pressing: 'low',
    tempo: 'fast',
    width: 'balanced',
    defensiveLine: 'deep',
    buildUp: 'long-ball',
    passing: 'direct',
    offsideTrap: false,
    counterAttack: true,
  },
  'low-block': {
    mentality: 'ultra-defensive',
    pressing: 'low',
    tempo: 'slow',
    width: 'narrow',
    defensiveLine: 'deep',
    buildUp: 'long-ball',
    passing: 'mixed',
    offsideTrap: false,
    counterAttack: true,
  },
};

const PRESET_KEYS = Object.keys(TACTIC_PRESETS.balanced) as (keyof TacticPresetValues)[];

export function detectTacticPreset(tactics: Tactics): TacticPresetId {
  for (const id of Object.keys(TACTIC_PRESETS) as Exclude<TacticPresetId, 'custom'>[]) {
    const preset = TACTIC_PRESETS[id];
    if (PRESET_KEYS.every((key) => tactics[key] === preset[key])) return id;
  }
  return 'custom';
}

export function applyTacticPreset(tactics: Tactics, id: Exclude<TacticPresetId, 'custom'>): Tactics {
  return { ...tactics, ...TACTIC_PRESETS[id] };
}

export function analyzeTactics(team: Team): TacticAnalysis {
  const profile = buildProfile(team, false);
  const starters = profile.starters;
  const tactics = team.tactics;
  const stamina = average(starters.map((player) => player.attributes.stamina), 55);
  const defenders = starters.filter((player) => {
    const slot = team.formation.slots.find((candidate) => candidate.playerId === player.id);
    return groupForPosition(slot?.position ?? player.position) === 'DEF';
  });
  const defenderPace = average(defenders.map((player) => player.attributes.pace), 55);
  const transition = clamp(
    42 + (TEMPO_CHANCE[tactics.tempo] - 1) * 42 + (tactics.counterAttack ? 13 : -3) +
      (tactics.passing === 'direct' ? 8 : tactics.passing === 'short' ? -4 : 0),
  );
  const fitnessLoad = clamp(
    29 + (PRESS_AGGRO[tactics.pressing] + 2) * 6 +
      (tactics.tempo === 'fast' ? 13 : tactics.tempo === 'slow' ? -7 : 0) +
      (tactics.defensiveLine === 'high' ? 7 : 0) - (stamina - 60) * 0.24,
  );
  const risk = clamp(
    28 + mentalityRisk(tactics.mentality) +
      (tactics.defensiveLine === 'high' ? 17 : tactics.defensiveLine === 'deep' ? -5 : 0) +
      (tactics.offsideTrap ? 10 : 0) +
      (tactics.passing === 'direct' ? 8 : tactics.passing === 'short' ? -4 : 0) +
      Math.max(0, profile.aggression - 25) * 0.45,
  );
  const warnings: TacticWarning[] = [];

  if (starters.length !== 11) {
    warnings.push({ id: 'lineup', severity: 'danger', de: `Aufstellung unvollständig: ${starters.length}/11 Spieler.`, en: `Incomplete lineup: ${starters.length}/11 players.` });
  }
  if (!starters.some((player) => player.positionGroup === 'GK')) {
    warnings.push({ id: 'keeper', severity: 'danger', de: 'Kein Torwart in der Startelf.', en: 'No goalkeeper in the starting eleven.' });
  }
  if (tactics.defensiveLine === 'high' && defenderPace < 65) {
    warnings.push({ id: 'slow-line', severity: 'warning', de: 'Die hohe Linie lässt langsame Verteidiger in große Laufduelle.', en: 'The high line exposes slower defenders to long recovery runs.' });
  }
  if ((tactics.pressing === 'gegenpress' || tactics.pressing === 'high') && stamina < 65) {
    warnings.push({ id: 'press-stamina', severity: 'warning', de: 'Das intensive Pressing überlastet diesen Kader früh.', en: 'Intense pressing will overload this squad early.' });
  }
  if (tactics.offsideTrap && tactics.defensiveLine !== 'high') {
    warnings.push({ id: 'offside-line', severity: 'warning', de: 'Die Abseitsfalle ist ohne hohe Linie schlecht abgestimmt.', en: 'The offside trap is poorly coordinated without a high line.' });
  }
  if (tactics.buildUp === 'play-out-of-defence' && tactics.passing === 'direct') {
    warnings.push({ id: 'build-up', severity: 'info', de: 'Kurzer Aufbau und direkte Pässe erzeugen wechselnde Abstände.', en: 'Short build-up and direct passing create uneven spacing.' });
  }

  return {
    attack: Math.round(profile.attack),
    control: Math.round(profile.midfield),
    defence: Math.round((profile.defence * 0.75 + profile.keeper * 0.25)),
    transition: Math.round(transition),
    fitnessLoad: Math.round(fitnessLoad),
    risk: Math.round(risk),
    warnings,
  };
}

export type SetPieceType = 'captain' | 'penalty' | 'freeKick' | 'corner';

export function rankSetPieceTakers(players: Player[], type: SetPieceType): Player[] {
  return [...players].sort((a, b) => setPieceScore(b, type) - setPieceScore(a, type) || b.overall - a.overall);
}

export function setPieceScore(player: Player, type: SetPieceType): number {
  switch (type) {
    case 'captain':
      return player.overall * 0.55 + player.morale * 0.3 + personalityLeadership(player) * 0.15;
    case 'penalty':
      return player.attributes.shooting;
    case 'freeKick':
      return (player.attributes.shooting + player.attributes.passing) / 2;
    case 'corner':
      return player.attributes.passing;
  }
}

function personalityLeadership(player: Player): number {
  return ({ professional: 92, driven: 88, 'team-player': 84, flair: 68, volatile: 42 })[player.personality];
}

function mentalityRisk(mentality: Tactics['mentality']): number {
  return ({ 'ultra-defensive': -9, defensive: -4, balanced: 0, attacking: 10, 'ultra-attacking': 20 })[mentality];
}

function average(values: number[], fallback: number): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : fallback;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
