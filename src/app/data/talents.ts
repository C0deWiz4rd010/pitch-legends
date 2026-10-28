import { Cond } from '../core/rpg/conditions';
import { EffectSpec } from '../core/rpg/effects';
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
  /** Flat attribute bonus per rank (also shown in ratings). */
  modifiers: Partial<Record<AttributeKey, number>>;
  /** Hook effects per rank: the match applies these, scaled by the rank. */
  effects?: EffectSpec[];
  /** 1 = root, 2 = specialisation, 3 = elite. */
  tier: 1 | 2 | 3;
  /** The two branches below the root exclude each other. */
  branch?: 'a' | 'b';
  /** Needs at least one rank of this node first. */
  requires?: string;
  /** Cannot be taken once this node has a rank. */
  excludes?: string;
}

export const ARCHETYPES_BY_GROUP: Record<PositionGroup, PlayerArchetype[]> = {
  GK: ['shot-stopper', 'sweeper', 'distributor'],
  DEF: ['stopper', 'ball-player', 'runner'],
  MID: ['ball-winner', 'playmaker', 'box-to-box'],
  ATT: ['finisher', 'creator', 'speedster'],
};

interface Definition {
  archetype: PlayerArchetype;
  label: string;
  primary: AttributeKey;
  secondary: AttributeKey;
  /** Names and hook effects (per rank) of the two branches. */
  a: { name: string; elite: string; effect: EffectSpec; text: string };
  b: { name: string; elite: string; effect: EffectSpec; text: string };
}

const mul = (hook: EffectSpec['hook'], value: number, when?: number): EffectSpec => ({ hook, op: 'mul', value, when });
const add = (hook: EffectSpec['hook'], value: number, when?: number): EffectSpec => ({ hook, op: 'add', value, when });

const definition: Definition[] = [
  { archetype: 'shot-stopper', label: 'Reflex Core', primary: 'goalkeeping', secondary: 'physical',
    a: { name: 'Cat Reactions', elite: 'Lightning Hands', effect: mul('keeperReaction', 1.03), text: 'Keeper reaction +3 % per rank' },
    b: { name: 'Big Presence', elite: 'Goal Wall', effect: add('goalkeeping', 1, Cond.facingShot), text: '+1 goalkeeping per rank when shot at' } },
  { archetype: 'sweeper', label: 'Sweeper Instinct', primary: 'pace', secondary: 'goalkeeping',
    a: { name: 'Quick Off the Line', elite: 'Rocket Keeper', effect: mul('acceleration', 1.03), text: 'Acceleration +3 % per rank' },
    b: { name: 'Box Commander', elite: 'Last Line', effect: add('goalkeeping', 1, Cond.inOwnBox), text: '+1 goalkeeping per rank in the own box' } },
  { archetype: 'distributor', label: 'Launch Attack', primary: 'passing', secondary: 'goalkeeping',
    a: { name: 'Clean Delivery', elite: 'Pinpoint Throw', effect: mul('passError', 0.97), text: 'Pass error −3 % per rank' },
    b: { name: 'Counter Starter', elite: 'Lightning Counter', effect: add('passing', 1, Cond.counter), text: '+1 passing per rank on the counter' } },
  { archetype: 'stopper', label: 'No Way Through', primary: 'defending', secondary: 'physical',
    a: { name: 'Clean Tackler', elite: 'Perfect Timing', effect: add('tackleWin', 0.015), text: 'Tackle chance +1.5 % per rank' },
    b: { name: 'Box Guardian', elite: 'Fortress', effect: add('defending', 1, Cond.inOwnBox), text: '+1 defending per rank in the own box' } },
  { archetype: 'ball-player', label: 'First Pass', primary: 'passing', secondary: 'defending',
    a: { name: 'Quiet Build-Up', elite: 'Metronome', effect: mul('passError', 0.97), text: 'Pass error −3 % per rank' },
    b: { name: 'Fast Break', elite: 'Vertical Game', effect: add('passing', 1, Cond.counter), text: '+1 passing per rank on the counter' } },
  { archetype: 'runner', label: 'Relentless Runner', primary: 'stamina', secondary: 'pace',
    a: { name: 'Efficient Stride', elite: 'Engine Room', effect: mul('staminaDrain', 0.97), text: 'Stamina drain −3 % per rank' },
    b: { name: 'Late Surge', elite: 'Final Kick', effect: add('pace', 1, Cond.late), text: '+1 pace per rank late in games' } },
  { archetype: 'ball-winner', label: 'Hunt the Ball', primary: 'defending', secondary: 'stamina',
    a: { name: 'Press Trigger', elite: 'Swarm', effect: mul('pressTackle', 1.03), text: 'Pressing tackles +3 % per rank' },
    b: { name: 'Sliding Master', elite: 'Surgical Tackle', effect: add('tackleWin', 0.015), text: 'Tackle chance +1.5 % per rank' } },
  { archetype: 'playmaker', label: 'See the Gap', primary: 'passing', secondary: 'dribbling',
    a: { name: 'Soft Touch', elite: 'Silk Passer', effect: mul('passError', 0.97), text: 'Pass error −3 % per rank' },
    b: { name: 'Between the Lines', elite: 'Final Third Maestro', effect: add('passing', 1, Cond.inOppHalf), text: '+1 passing per rank in the opposing half' } },
  { archetype: 'box-to-box', label: 'Total Midfielder', primary: 'stamina', secondary: 'physical',
    a: { name: 'Tireless', elite: 'Second Lung', effect: mul('staminaDrain', 0.97), text: 'Stamina drain −3 % per rank' },
    b: { name: 'Late Runner', elite: 'Box Crasher', effect: add('shooting', 1, Cond.inOppBox), text: '+1 shooting per rank in the opposing box' } },
  { archetype: 'finisher', label: 'Cold Finish', primary: 'shooting', secondary: 'physical',
    a: { name: 'Clean Strike', elite: 'Dead-Eye', effect: mul('shotError', 0.97), text: 'Shot error −3 % per rank' },
    b: { name: 'Box Predator', elite: 'Poacher Supreme', effect: add('shooting', 1, Cond.inOppBox), text: '+1 shooting per rank in the opposing box' } },
  { archetype: 'creator', label: 'Final Ball', primary: 'passing', secondary: 'dribbling',
    a: { name: 'Vision', elite: 'Master Plan', effect: mul('passError', 0.98), text: 'Pass error −2 % per rank' },
    b: { name: 'Tight Spaces', elite: 'Escape Artist', effect: add('dribbling', 1, Cond.underPressure), text: '+1 dribbling per rank under pressure' } },
  { archetype: 'speedster', label: 'Afterburner', primary: 'pace', secondary: 'dribbling',
    a: { name: 'Burst Trainer', elite: 'Launch Control', effect: mul('acceleration', 1.03), text: 'Acceleration +3 % per rank' },
    b: { name: 'Top-End Speed', elite: 'Terminal Velocity', effect: mul('sprintBurst', 1.02), text: 'Sprint speed +2 % per rank' } },
];

/**
 * Five nodes per archetype: a root, two exclusive specialisations and one elite node below each.
 * The ids `<archetype>-1` and `<archetype>-2` keep their meaning from earlier saves (root and first
 * specialisation), so ranks already spent stay valid.
 */
export const TALENT_NODES: TalentNode[] = definition.flatMap((entry): TalentNode[] => [
  {
    id: `${entry.archetype}-1`, name: entry.label, archetype: entry.archetype, tier: 1,
    description: `Improves ${entry.primary} and unlocks the archetype path.`,
    unlockLevel: 2, maxRank: 3, cost: 2, modifiers: { [entry.primary]: 2 },
  },
  {
    id: `${entry.archetype}-2`, name: entry.a.name, archetype: entry.archetype, tier: 2, branch: 'a',
    description: `${entry.a.text}; adds ${entry.secondary}.`,
    unlockLevel: 5, maxRank: 2, cost: 3, modifiers: { [entry.primary]: 2, [entry.secondary]: 2 }, effects: [entry.a.effect],
    requires: `${entry.archetype}-1`, excludes: `${entry.archetype}-3`,
  },
  {
    id: `${entry.archetype}-3`, name: entry.b.name, archetype: entry.archetype, tier: 2, branch: 'b',
    description: `${entry.b.text}; adds ${entry.secondary}.`,
    unlockLevel: 5, maxRank: 2, cost: 3, modifiers: { [entry.secondary]: 3, [entry.primary]: 1 }, effects: [entry.b.effect],
    requires: `${entry.archetype}-1`, excludes: `${entry.archetype}-2`,
  },
  {
    id: `${entry.archetype}-4`, name: entry.a.elite, archetype: entry.archetype, tier: 3, branch: 'a',
    description: `${entry.a.text}; sharpens ${entry.primary}.`,
    unlockLevel: 10, maxRank: 2, cost: 4, modifiers: { [entry.primary]: 3 }, effects: [entry.a.effect],
    requires: `${entry.archetype}-2`,
  },
  {
    id: `${entry.archetype}-5`, name: entry.b.elite, archetype: entry.archetype, tier: 3, branch: 'b',
    description: `${entry.b.text}; sharpens ${entry.primary}.`,
    unlockLevel: 10, maxRank: 2, cost: 4, modifiers: { [entry.primary]: 3 }, effects: [entry.b.effect],
    requires: `${entry.archetype}-3`,
  },
]);

export function talentsFor(archetype: PlayerArchetype): TalentNode[] {
  return TALENT_NODES.filter((node) => node.archetype === archetype);
}

export function getTalent(id: string): TalentNode | undefined {
  return TALENT_NODES.find((node) => node.id === id);
}
