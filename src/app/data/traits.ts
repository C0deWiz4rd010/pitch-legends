import { Trait } from '../models/player.model';
import { Cond } from '../core/rpg/conditions';

/**
 * `modifiers` are the flat numbers shown in ratings and the tactics page. `effects` are what the
 * 60 Hz match really applies, under exactly the condition the description promises.
 */
export const TRAITS: Trait[] = [
  {
    id: 'clinical',
    name: 'Clinical Finisher',
    description: 'Rarely misses a clear chance. +6 shooting in the box.',
    category: 'shooting',
    modifiers: { shooting: 6 },
    effects: [{ hook: 'shooting', op: 'add', value: 6, when: Cond.inOppBox }],
    unlockLevel: 3,
  },
  {
    id: 'engine',
    name: 'Engine',
    description: 'Tireless running. +6 stamina, +3 pace late in games.',
    category: 'stamina',
    modifiers: { stamina: 6, pace: 3 },
    effects: [
      { hook: 'stamina', op: 'add', value: 6 },
      { hook: 'pace', op: 'add', value: 3, when: Cond.late },
    ],
    unlockLevel: 3,
  },
  {
    id: 'playmaker',
    name: 'Playmaker',
    description: 'Sees the killer pass. +7 passing when creating.',
    category: 'passing',
    modifiers: { passing: 7 },
    effects: [{ hook: 'passing', op: 'add', value: 7, when: Cond.inOppHalf }],
    unlockLevel: 4,
  },
  {
    id: 'wall',
    name: 'The Wall',
    description: 'Immovable at the back. +6 defending in duels.',
    category: 'defending',
    modifiers: { defending: 6 },
    effects: [{ hook: 'defending', op: 'add', value: 6, when: Cond.outOfPossession }],
    unlockLevel: 4,
  },
  {
    id: 'speedster',
    name: 'Speedster',
    description: 'Electric acceleration. +7 pace on the counter.',
    category: 'pace',
    modifiers: { pace: 7 },
    effects: [{ hook: 'pace', op: 'add', value: 7, when: Cond.counter }],
    unlockLevel: 3,
  },
  {
    id: 'maestro',
    name: 'Dribbling Maestro',
    description: 'Glides past defenders. +7 dribbling in tight spaces.',
    category: 'dribbling',
    modifiers: { dribbling: 7 },
    effects: [{ hook: 'dribbling', op: 'add', value: 7, when: Cond.underPressure }],
    unlockLevel: 5,
  },
  {
    id: 'rock',
    name: 'Powerhouse',
    description: 'Wins every physical battle. +6 physical.',
    category: 'physical',
    modifiers: { physical: 6 },
    effects: [{ hook: 'physical', op: 'add', value: 6 }],
    unlockLevel: 4,
  },
  {
    id: 'safehands',
    name: 'Safe Hands',
    description: 'Commanding in goal. +7 goalkeeping on shots.',
    category: 'goalkeeping',
    modifiers: { goalkeeping: 7 },
    effects: [{ hook: 'goalkeeping', op: 'add', value: 7, when: Cond.facingShot }],
    unlockLevel: 4,
  },
  {
    id: 'leader',
    name: 'Born Leader',
    description: 'A natural leader. +2 passing, defending and shooting.',
    category: 'mental',
    modifiers: { passing: 2, defending: 2, shooting: 2 },
    effects: [
      { hook: 'passing', op: 'add', value: 2 },
      { hook: 'defending', op: 'add', value: 2 },
      { hook: 'shooting', op: 'add', value: 2 },
    ],
    unlockLevel: 6,
  },
  {
    id: 'wonderkid',
    name: 'Wonderkid',
    description: 'Learns faster than anyone. Gains extra XP from matches.',
    category: 'mental',
    modifiers: {},
    effects: [{ hook: 'xpGain', op: 'mul', value: 1.25 }],
    unlockLevel: 2,
  },
  {
    id: 'iceveins',
    name: 'Ice in the Veins',
    description: 'Unshakeable from the spot. +8 shooting on penalties.',
    category: 'shooting',
    modifiers: { shooting: 8 },
    effects: [{ hook: 'shooting', op: 'add', value: 8, when: Cond.penalty }],
    unlockLevel: 5,
  },
  {
    id: 'setpiece',
    name: 'Set-Piece Specialist',
    description: 'Deadly from dead balls. +8 passing, +4 shooting on set-pieces.',
    category: 'passing',
    modifiers: { passing: 8, shooting: 4 },
    effects: [
      { hook: 'passing', op: 'add', value: 8, when: Cond.setPiece },
      { hook: 'shooting', op: 'add', value: 4, when: Cond.setPiece },
    ],
    unlockLevel: 5,
  },
];

const TRAIT_MAP = new Map(TRAITS.map((t) => [t.id, t]));

export function getTrait(id: string): Trait | undefined {
  return TRAIT_MAP.get(id);
}

/**
 * Traits for the hooks the match engine reads but no trait used before: shot power, curve, through-ball lead, first touch,
 * shielding, aerial duels, keeper reach, stamina recovery and composure; plus a fast learner for experience and training.
 */
const MATCH_FEEL_TRAITS: Trait[] = [
  { id: 'cannon', name: 'Cannon', description: 'A hammer of a shot. +2.5 m/s shot speed.', category: 'shooting', modifiers: {}, effects: [{ hook: 'shotPower', op: 'add', value: 2.5 }], unlockLevel: 5 },
  { id: 'bender', name: 'Bender', description: 'Bends every ball. 40 % more curl on finesse shots and crosses.', category: 'passing', modifiers: {}, effects: [{ hook: 'curve', op: 'mul', value: 1.4 }], unlockLevel: 5 },
  { id: 'visionary', name: 'Visionary', description: 'Plays the ball into the run. Through balls land 2 m further ahead.', category: 'passing', modifiers: {}, effects: [{ hook: 'throughLead', op: 'add', value: 2 }], unlockLevel: 6 },
  { id: 'velvet', name: 'Velvet Touch', description: 'Kills any pass dead. +8 first touch.', category: 'dribbling', modifiers: {}, effects: [{ hook: 'firstTouch', op: 'add', value: 8 }], unlockLevel: 4 },
  { id: 'bodyguard', name: 'Bodyguard', description: 'Shields the ball with his body: much harder to tackle with it.', category: 'physical', modifiers: {}, effects: [{ hook: 'shielding', op: 'add', value: 0.1 }], unlockLevel: 5 },
  { id: 'skyscraper', name: 'Skyscraper', description: 'Wins the aerial duel. +10 aerial ability.', category: 'physical', modifiers: {}, effects: [{ hook: 'aerial', op: 'add', value: 10 }], unlockLevel: 4 },
  { id: 'longreach', name: 'Long Reach', description: 'Covers more of the goal. +0.2 m reach.', category: 'goalkeeping', modifiers: {}, effects: [{ hook: 'keeperReach', op: 'add', value: 0.2 }], unlockLevel: 5 },
  { id: 'recovery', name: 'Quick Recovery', description: 'Catches his breath fast: recovers stamina twice as fast when standing.', category: 'stamina', modifiers: {}, effects: [{ hook: 'staminaRecovery', op: 'mul', value: 2 }], unlockLevel: 4 },
  { id: 'composed', name: 'Composed', description: 'Stays calm in front of goal. 15 % tighter shot spread.', category: 'mental', modifiers: {}, effects: [{ hook: 'composure', op: 'mul', value: 0.85 }], unlockLevel: 6 },
  { id: 'quicklearner', name: 'Quick Learner', description: 'Picks things up fast. +10 % match XP and a better chance of training breakthroughs.', category: 'mental', modifiers: {},
    effects: [{ hook: 'growthChance', op: 'add', value: 0.03 }, { hook: 'xpGain', op: 'mul', value: 1.1 }], unlockLevel: 2 },
];
TRAITS.push(...MATCH_FEEL_TRAITS);
for (const trait of MATCH_FEEL_TRAITS) TRAIT_MAP.set(trait.id, trait);

const TRAIT_DE: Record<string, [string, string]> = {
  clinical: ['Eiskalter Vollstrecker', 'Verwertet klare Chancen. +6 Schuss im Strafraum.'],
  engine: ['Motor', 'Unermüdlich. +6 Ausdauer, +3 Tempo in der Schlussphase.'],
  playmaker: ['Spielmacher', 'Sieht den tödlichen Pass. +7 Passen im Angriff.'],
  wall: ['Die Mauer', 'Unüberwindlich hinten. +6 Verteidigen im Zweikampf.'],
  speedster: ['Sprinter', 'Explosive Beschleunigung. +7 Tempo beim Konter.'],
  maestro: ['Dribbelkünstler', 'Gleitet an Gegnern vorbei. +7 Dribbling auf engem Raum.'],
  rock: ['Kraftpaket', 'Gewinnt jedes Duell. +6 Physis.'],
  safehands: ['Sichere Hände', 'Souverän im Tor. +7 Torwart bei Schüssen.'],
  leader: ['Geborener Anführer', 'Führungsspieler. +2 Passen, Verteidigen und Schuss.'],
  wonderkid: ['Wunderkind', 'Lernt schneller als jeder andere. Mehr Erfahrung aus Spielen.'],
  iceveins: ['Nerven aus Stahl', 'Unerschütterlich vom Punkt. +8 Schuss bei Elfmetern.'],
  setpiece: ['Standardspezialist', 'Tödlich bei Standards. +8 Passen, +4 Schuss bei Standards.'],
  cannon: ['Kanone', 'Ein Hammer von Schuss. +2,5 m/s Schussgeschwindigkeit.'],
  bender: ['Effet-Künstler', 'Zirkelt jeden Ball. 40 % mehr Effet bei Schlenzern und Flanken.'],
  visionary: ['Visionär', 'Spielt den Ball in den Lauf. Steilpässe landen 2 m weiter vorn.'],
  velvet: ['Samtpfote', 'Nimmt jeden Pass sicher an. +8 Ballannahme.'],
  bodyguard: ['Ballschirm', 'Schirmt den Ball mit dem Körper ab: mit Ball kaum zu tackeln.'],
  skyscraper: ['Kopfballungeheuer', 'Gewinnt das Luftduell. +10 Kopfballstärke.'],
  longreach: ['Lange Arme', 'Deckt mehr vom Tor ab. +0,2 m Reichweite.'],
  recovery: ['Schnelle Erholung', 'Kommt schnell wieder zu Atem: erholt sich im Stehen doppelt so schnell.'],
  composed: ['Gelassen', 'Bleibt vor dem Tor ruhig. 15 % weniger Streuung bei Schüssen.'],
  quicklearner: ['Schnelle Auffassung', 'Lernt zügig. +10 % Erfahrung aus Spielen und bessere Durchbruchchance im Training.'],
};
for (const trait of TRAITS) {
  const german = TRAIT_DE[trait.id];
  if (german) [trait.nameDe, trait.descriptionDe] = german;
}
