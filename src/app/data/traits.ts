import { Trait } from '../models/player.model';

export const TRAITS: Trait[] = [
  {
    id: 'clinical',
    name: 'Clinical Finisher',
    description: 'Rarely misses a clear chance. +6 shooting in the box.',
    category: 'shooting',
    modifiers: { shooting: 6 },
    unlockLevel: 3,
  },
  {
    id: 'engine',
    name: 'Engine',
    description: 'Tireless running. +6 stamina, +3 pace late in games.',
    category: 'stamina',
    modifiers: { stamina: 6, pace: 3 },
    unlockLevel: 3,
  },
  {
    id: 'playmaker',
    name: 'Playmaker',
    description: 'Sees the killer pass. +7 passing when creating.',
    category: 'passing',
    modifiers: { passing: 7 },
    unlockLevel: 4,
  },
  {
    id: 'wall',
    name: 'The Wall',
    description: 'Immovable at the back. +6 defending in duels.',
    category: 'defending',
    modifiers: { defending: 6 },
    unlockLevel: 4,
  },
  {
    id: 'speedster',
    name: 'Speedster',
    description: 'Electric acceleration. +7 pace on the counter.',
    category: 'pace',
    modifiers: { pace: 7 },
    unlockLevel: 3,
  },
  {
    id: 'maestro',
    name: 'Dribbling Maestro',
    description: 'Glides past defenders. +7 dribbling in tight spaces.',
    category: 'dribbling',
    modifiers: { dribbling: 7 },
    unlockLevel: 5,
  },
  {
    id: 'rock',
    name: 'Powerhouse',
    description: 'Wins every physical battle. +6 physical.',
    category: 'physical',
    modifiers: { physical: 6 },
    unlockLevel: 4,
  },
  {
    id: 'safehands',
    name: 'Safe Hands',
    description: 'Commanding in goal. +7 goalkeeping on shots.',
    category: 'goalkeeping',
    modifiers: { goalkeeping: 7 },
    unlockLevel: 4,
  },
  {
    id: 'leader',
    name: 'Born Leader',
    description: 'Lifts the whole team. Boosts morale and composure.',
    category: 'mental',
    modifiers: { passing: 2, defending: 2, shooting: 2 },
    unlockLevel: 6,
  },
  {
    id: 'wonderkid',
    name: 'Wonderkid',
    description: 'Learns faster than anyone. Gains extra XP from matches.',
    category: 'mental',
    modifiers: {},
    unlockLevel: 2,
  },
  {
    id: 'iceveins',
    name: 'Ice in the Veins',
    description: 'Unshakeable from the spot. +8 shooting on penalties.',
    category: 'shooting',
    modifiers: { shooting: 8 },
    unlockLevel: 5,
  },
  {
    id: 'setpiece',
    name: 'Set-Piece Specialist',
    description: 'Deadly from dead balls. +8 passing & shooting on set-pieces.',
    category: 'passing',
    modifiers: { passing: 8, shooting: 4 },
    unlockLevel: 5,
  },
];

const TRAIT_MAP = new Map(TRAITS.map((t) => [t.id, t]));

export function getTrait(id: string): Trait | undefined {
  return TRAIT_MAP.get(id);
}
