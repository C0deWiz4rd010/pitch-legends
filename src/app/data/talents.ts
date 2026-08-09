import { AttributeKey, PositionGroup } from '../models/enums';
import { PlayerArchetype } from '../models/player.model';

export interface TalentNode {
  id: string;
  name: string;
  description: string;
  archetype: PlayerArchetype;
  unlockLevel: number;
  maxRank: number;
  cost: number;
  modifiers: Partial<Record<AttributeKey, number>>;
}

export const ARCHETYPES_BY_GROUP: Record<PositionGroup, PlayerArchetype[]> = {
  GK: ['shot-stopper', 'sweeper', 'distributor'],
  DEF: ['stopper', 'ball-player', 'runner'],
  MID: ['ball-winner', 'playmaker', 'box-to-box'],
  ATT: ['finisher', 'creator', 'speedster'],
};

const definition: Array<{
  archetype: PlayerArchetype;
  label: string;
  primary: AttributeKey;
  secondary: AttributeKey;
}> = [
  { archetype: 'shot-stopper', label: 'Reflex Core', primary: 'goalkeeping', secondary: 'physical' },
  { archetype: 'sweeper', label: 'Sweeper Instinct', primary: 'pace', secondary: 'goalkeeping' },
  { archetype: 'distributor', label: 'Launch Attack', primary: 'passing', secondary: 'goalkeeping' },
  { archetype: 'stopper', label: 'No Way Through', primary: 'defending', secondary: 'physical' },
  { archetype: 'ball-player', label: 'First Pass', primary: 'passing', secondary: 'defending' },
  { archetype: 'runner', label: 'Relentless Runner', primary: 'stamina', secondary: 'pace' },
  { archetype: 'ball-winner', label: 'Hunt the Ball', primary: 'defending', secondary: 'stamina' },
  { archetype: 'playmaker', label: 'See the Gap', primary: 'passing', secondary: 'dribbling' },
  { archetype: 'box-to-box', label: 'Total Midfielder', primary: 'stamina', secondary: 'physical' },
  { archetype: 'finisher', label: 'Cold Finish', primary: 'shooting', secondary: 'physical' },
  { archetype: 'creator', label: 'Final Ball', primary: 'passing', secondary: 'dribbling' },
  { archetype: 'speedster', label: 'Afterburner', primary: 'pace', secondary: 'dribbling' },
];

export const TALENT_NODES: TalentNode[] = definition.flatMap((entry) => [
  {
    id: `${entry.archetype}-1`,
    name: entry.label,
    description: `Improves ${entry.primary} and unlocks the archetype path.`,
    archetype: entry.archetype,
    unlockLevel: 2,
    maxRank: 3,
    cost: 2,
    modifiers: { [entry.primary]: 2 },
  },
  {
    id: `${entry.archetype}-2`,
    name: `Elite ${entry.label}`,
    description: `Adds a secondary ${entry.secondary} bonus.`,
    archetype: entry.archetype,
    unlockLevel: 5,
    maxRank: 2,
    cost: 3,
    modifiers: { [entry.primary]: 2, [entry.secondary]: 2 },
  },
]);

export function talentsFor(archetype: PlayerArchetype): TalentNode[] {
  return TALENT_NODES.filter((node) => node.archetype === archetype);
}

export function getTalent(id: string): TalentNode | undefined {
  return TALENT_NODES.find((node) => node.id === id);
}
