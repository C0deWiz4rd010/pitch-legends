import { Cond } from '../core/rpg/conditions';
import { EffectSpec } from '../core/rpg/effects';
import { AttributeKey, PositionGroup } from '../models/enums';
import { PlayerArchetype } from '../models/player.model';
import { ACTIONS, ActionId } from './actions';

export interface TalentNode {
  id: string;
  name: string;
  description: string;
  /** German name and description; the English ones above are the fallback. */
  nameDe?: string;
  descriptionDe?: string;
  archetype: PlayerArchetype;
  unlockLevel: number;
  maxRank: number;
  cost: number;
  /** Flat attribute bonus per rank (also shown in ratings). */
  modifiers: Partial<Record<AttributeKey, number>>;
  /** Hook effects per rank: the match applies these, scaled by the rank. */
  effects?: EffectSpec[];
  /** Match actions this node unlocks for good (see data/actions.ts and `canUse` in the stat block). */
  unlocks?: ActionId[];
  /** 1 = root, 2 = specialisation, 3 = elite. */
  tier: 1 | 2 | 3;
  /**
   * What the node is for. `core` nodes are the root and the two exclusive branches with their elites (the
   * computer-built players only take these), `side` and `mind` are open to both branches, `action` nodes
   * unlock match actions.
   */
  kind: 'core' | 'side' | 'action' | 'mind';
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

interface Branch {
  name: string;
  nameDe: string;
  elite: string;
  eliteDe: string;
  effect: EffectSpec;
  text: string;
  textDe: string;
}

interface Definition {
  archetype: PlayerArchetype;
  label: string;
  labelDe: string;
  primary: AttributeKey;
  secondary: AttributeKey;
  /** Names and hook effects (per rank) of the two branches. */
  a: Branch;
  b: Branch;
  /** The two actions of the action nodes: the first at tier II, the second below it at tier III. */
  actions: [ActionId, ActionId];
}

const ATTRIBUTE_DE: Record<AttributeKey, string> = {
  pace: 'Tempo',
  shooting: 'Schuss',
  passing: 'Passen',
  dribbling: 'Dribbling',
  defending: 'Verteidigen',
  physical: 'Physis',
  stamina: 'Ausdauer',
  goalkeeping: 'Torwart',
};

const mul = (hook: EffectSpec['hook'], value: number, when?: number): EffectSpec => ({
  hook,
  op: 'mul',
  value,
  when,
});
const add = (hook: EffectSpec['hook'], value: number, when?: number): EffectSpec => ({
  hook,
  op: 'add',
  value,
  when,
});

const definition: Definition[] = [
  {
    archetype: 'shot-stopper',
    label: 'Reflex Core',
    labelDe: 'Reflexkern',
    primary: 'goalkeeping',
    secondary: 'physical',
    actions: ['punch-clear', 'spin-throw'],
    a: {
      name: 'Cat Reactions',
      nameDe: 'Katzenreflexe',
      elite: 'Lightning Hands',
      eliteDe: 'Blitzhände',
      effect: mul('keeperReaction', 1.03),
      text: 'Keeper reaction +3 % per rank',
      textDe: 'Torwartreaktion +3 % pro Rang',
    },
    b: {
      name: 'Big Presence',
      nameDe: 'Große Präsenz',
      elite: 'Goal Wall',
      eliteDe: 'Torwand',
      effect: add('goalkeeping', 1, Cond.facingShot),
      text: '+1 goalkeeping per rank when shot at',
      textDe: '+1 Torwart pro Rang bei Schüssen',
    },
  },
  {
    archetype: 'sweeper',
    label: 'Sweeper Instinct',
    labelDe: 'Libero-Instinkt',
    primary: 'pace',
    secondary: 'goalkeeping',
    actions: ['keeper-sweep', 'spin-throw'],
    a: {
      name: 'Quick Off the Line',
      nameDe: 'Schnell vom Tor',
      elite: 'Rocket Keeper',
      eliteDe: 'Raketenkeeper',
      effect: mul('acceleration', 1.03),
      text: 'Acceleration +3 % per rank',
      textDe: 'Antritt +3 % pro Rang',
    },
    b: {
      name: 'Box Commander',
      nameDe: 'Strafraumchef',
      elite: 'Last Line',
      eliteDe: 'Letzte Linie',
      effect: add('goalkeeping', 1, Cond.inOwnBox),
      text: '+1 goalkeeping per rank in the own box',
      textDe: '+1 Torwart pro Rang im eigenen Strafraum',
    },
  },
  {
    archetype: 'distributor',
    label: 'Launch Attack',
    labelDe: 'Angriff einleiten',
    primary: 'passing',
    secondary: 'goalkeeping',
    actions: ['spin-throw', 'launch-kick'],
    a: {
      name: 'Clean Delivery',
      nameDe: 'Saubere Abgabe',
      elite: 'Pinpoint Throw',
      eliteDe: 'Punktgenauer Wurf',
      effect: mul('passError', 0.97),
      text: 'Pass error −3 % per rank',
      textDe: 'Passfehler −3 % pro Rang',
    },
    b: {
      name: 'Counter Starter',
      nameDe: 'Konterstarter',
      elite: 'Lightning Counter',
      eliteDe: 'Blitzkonter',
      effect: add('passing', 1, Cond.counter),
      text: '+1 passing per rank on the counter',
      textDe: '+1 Passen pro Rang im Konter',
    },
  },
  {
    archetype: 'stopper',
    label: 'No Way Through',
    labelDe: 'Hier geht keiner durch',
    primary: 'defending',
    secondary: 'physical',
    actions: ['power-header', 'kaiser-slide'],
    a: {
      name: 'Clean Tackler',
      nameDe: 'Sauberer Zweikämpfer',
      elite: 'Perfect Timing',
      eliteDe: 'Perfektes Timing',
      effect: add('tackleWin', 0.015),
      text: 'Tackle chance +1.5 % per rank',
      textDe: 'Zweikampfchance +1,5 % pro Rang',
    },
    b: {
      name: 'Box Guardian',
      nameDe: 'Strafraumwächter',
      elite: 'Fortress',
      eliteDe: 'Festung',
      effect: add('defending', 1, Cond.inOwnBox),
      text: '+1 defending per rank in the own box',
      textDe: '+1 Verteidigen pro Rang im eigenen Strafraum',
    },
  },
  {
    archetype: 'ball-player',
    label: 'First Pass',
    labelDe: 'Erster Pass',
    primary: 'passing',
    secondary: 'defending',
    actions: ['trivela-pass', 'heel-flick'],
    a: {
      name: 'Quiet Build-Up',
      nameDe: 'Ruhiger Aufbau',
      elite: 'Metronome',
      eliteDe: 'Metronom',
      effect: mul('passError', 0.97),
      text: 'Pass error −3 % per rank',
      textDe: 'Passfehler −3 % pro Rang',
    },
    b: {
      name: 'Fast Break',
      nameDe: 'Schneller Umschwung',
      elite: 'Vertical Game',
      eliteDe: 'Vertikalspiel',
      effect: add('passing', 1, Cond.counter),
      text: '+1 passing per rank on the counter',
      textDe: '+1 Passen pro Rang im Konter',
    },
  },
  {
    archetype: 'runner',
    label: 'Relentless Runner',
    labelDe: 'Unermüdlicher Läufer',
    primary: 'stamina',
    secondary: 'pace',
    actions: ['kaiser-slide', 'trivela-pass'],
    a: {
      name: 'Efficient Stride',
      nameDe: 'Effizienter Schritt',
      elite: 'Engine Room',
      eliteDe: 'Maschinenraum',
      effect: mul('staminaDrain', 0.97),
      text: 'Stamina drain −3 % per rank',
      textDe: 'Ausdauerverbrauch −3 % pro Rang',
    },
    b: {
      name: 'Late Surge',
      nameDe: 'Später Schub',
      elite: 'Final Kick',
      eliteDe: 'Schlusstritt',
      effect: add('pace', 1, Cond.late),
      text: '+1 pace per rank late in games',
      textDe: '+1 Tempo pro Rang spät im Spiel',
    },
  },
  {
    archetype: 'ball-winner',
    label: 'Hunt the Ball',
    labelDe: 'Jagd auf den Ball',
    primary: 'defending',
    secondary: 'stamina',
    actions: ['kaiser-slide', 'power-header'],
    a: {
      name: 'Press Trigger',
      nameDe: 'Pressing-Auslöser',
      elite: 'Swarm',
      eliteDe: 'Schwarm',
      effect: mul('pressTackle', 1.03),
      text: 'Pressing tackles +3 % per rank',
      textDe: 'Pressing-Zweikämpfe +3 % pro Rang',
    },
    b: {
      name: 'Sliding Master',
      nameDe: 'Grätschenmeister',
      elite: 'Surgical Tackle',
      eliteDe: 'Chirurgischer Tackle',
      effect: add('tackleWin', 0.015),
      text: 'Tackle chance +1.5 % per rank',
      textDe: 'Zweikampfchance +1,5 % pro Rang',
    },
  },
  {
    archetype: 'playmaker',
    label: 'See the Gap',
    labelDe: 'Lücken sehen',
    primary: 'passing',
    secondary: 'dribbling',
    actions: ['trivela-pass', 'rabona'],
    a: {
      name: 'Soft Touch',
      nameDe: 'Weicher Touch',
      elite: 'Silk Passer',
      eliteDe: 'Seidenpasser',
      effect: mul('passError', 0.97),
      text: 'Pass error −3 % per rank',
      textDe: 'Passfehler −3 % pro Rang',
    },
    b: {
      name: 'Between the Lines',
      nameDe: 'Zwischen den Linien',
      elite: 'Final Third Maestro',
      eliteDe: 'Maestro im Angriffsdrittel',
      effect: add('passing', 1, Cond.inOppHalf),
      text: '+1 passing per rank in the opposing half',
      textDe: '+1 Passen pro Rang in der gegnerischen Hälfte',
    },
  },
  {
    archetype: 'box-to-box',
    label: 'Total Midfielder',
    labelDe: 'Kompletter Mittelfeldspieler',
    primary: 'stamina',
    secondary: 'physical',
    actions: ['power-header', 'trivela-shot'],
    a: {
      name: 'Tireless',
      nameDe: 'Unermüdlich',
      elite: 'Second Lung',
      eliteDe: 'Zweite Lunge',
      effect: mul('staminaDrain', 0.97),
      text: 'Stamina drain −3 % per rank',
      textDe: 'Ausdauerverbrauch −3 % pro Rang',
    },
    b: {
      name: 'Late Runner',
      nameDe: 'Später Läufer',
      elite: 'Box Crasher',
      eliteDe: 'Strafraumstürmer',
      effect: add('shooting', 1, Cond.inOppBox),
      text: '+1 shooting per rank in the opposing box',
      textDe: '+1 Schuss pro Rang im gegnerischen Strafraum',
    },
  },
  {
    archetype: 'finisher',
    label: 'Cold Finish',
    labelDe: 'Kalter Abschluss',
    primary: 'shooting',
    secondary: 'physical',
    actions: ['trivela-shot', 'knuckle-shot'],
    a: {
      name: 'Clean Strike',
      nameDe: 'Sauberer Schuss',
      elite: 'Dead-Eye',
      eliteDe: 'Zielsicher',
      effect: mul('shotError', 0.97),
      text: 'Shot error −3 % per rank',
      textDe: 'Schussfehler −3 % pro Rang',
    },
    b: {
      name: 'Box Predator',
      nameDe: 'Strafraumjäger',
      elite: 'Poacher Supreme',
      eliteDe: 'Königsjäger',
      effect: add('shooting', 1, Cond.inOppBox),
      text: '+1 shooting per rank in the opposing box',
      textDe: '+1 Schuss pro Rang im gegnerischen Strafraum',
    },
  },
  {
    archetype: 'creator',
    label: 'Final Ball',
    labelDe: 'Letzter Ball',
    primary: 'passing',
    secondary: 'dribbling',
    actions: ['rabona', 'heel-flick'],
    a: {
      name: 'Vision',
      nameDe: 'Übersicht',
      elite: 'Master Plan',
      eliteDe: 'Masterplan',
      effect: mul('passError', 0.98),
      text: 'Pass error −2 % per rank',
      textDe: 'Passfehler −2 % pro Rang',
    },
    b: {
      name: 'Tight Spaces',
      nameDe: 'Enge Räume',
      elite: 'Escape Artist',
      eliteDe: 'Fluchtkünstler',
      effect: add('dribbling', 1, Cond.underPressure),
      text: '+1 dribbling per rank under pressure',
      textDe: '+1 Dribbling pro Rang unter Druck',
    },
  },
  {
    archetype: 'speedster',
    label: 'Afterburner',
    labelDe: 'Nachbrenner',
    primary: 'pace',
    secondary: 'dribbling',
    actions: ['step-over', 'heel-flick'],
    a: {
      name: 'Burst Trainer',
      nameDe: 'Antritts-Training',
      elite: 'Launch Control',
      eliteDe: 'Startkontrolle',
      effect: mul('acceleration', 1.03),
      text: 'Acceleration +3 % per rank',
      textDe: 'Antritt +3 % pro Rang',
    },
    b: {
      name: 'Top-End Speed',
      nameDe: 'Höchstgeschwindigkeit',
      elite: 'Terminal Velocity',
      eliteDe: 'Endgeschwindigkeit',
      effect: mul('sprintBurst', 1.02),
      text: 'Sprint speed +2 % per rank',
      textDe: 'Sprinttempo +2 % pro Rang',
    },
  },
];

const ACTION_NAME = new Map(ACTIONS.map((action) => [action.id as string, action.name]));
const actionName = (id: ActionId, index: 0 | 1): string => ACTION_NAME.get(id)![index];

/**
 * Nine nodes per archetype in three tiers (root, four at tier II, four at tier III):
 *
 *  - `-1` root, `-2` and `-3` the two exclusive branches with their elites `-4` and `-5`; ids and meaning are
 *    unchanged from the five-node tree, so ranks already spent stay valid.
 *  - `-6` a sturdy body (open to both branches) with `-9` a winner's mind below it.
 *  - `-7` and `-8` unlock one match action each (a signature move and a master move), whichever branch was taken.
 *
 * A full tree costs 41 skill points, about level 17; the computer-built players still take root, one branch and
 * its elite only (see core/rpg/auto-build.ts).
 */
export const TALENT_NODES: TalentNode[] = definition.flatMap((entry): TalentNode[] => {
  const id = (index: number) => `${entry.archetype}-${index}`;
  const secondaryDe = ATTRIBUTE_DE[entry.secondary];
  const primaryDe = ATTRIBUTE_DE[entry.primary];
  const [firstAction, secondAction] = entry.actions;
  return [
    {
      id: id(1),
      name: entry.label,
      nameDe: entry.labelDe,
      archetype: entry.archetype,
      tier: 1,
      kind: 'core',
      description: `Improves ${entry.primary} and unlocks the archetype path.`,
      descriptionDe: `Verbessert ${primaryDe} und öffnet den Pfad des Archetyps.`,
      unlockLevel: 2,
      maxRank: 3,
      cost: 2,
      modifiers: { [entry.primary]: 2 },
    },
    {
      id: id(2),
      name: entry.a.name,
      nameDe: entry.a.nameDe,
      archetype: entry.archetype,
      tier: 2,
      kind: 'core',
      branch: 'a',
      description: `${entry.a.text}; adds ${entry.secondary}.`,
      descriptionDe: `${entry.a.textDe}; gibt ${secondaryDe}.`,
      unlockLevel: 5,
      maxRank: 2,
      cost: 3,
      modifiers: { [entry.primary]: 2, [entry.secondary]: 2 },
      effects: [entry.a.effect],
      requires: id(1),
      excludes: id(3),
    },
    {
      id: id(3),
      name: entry.b.name,
      nameDe: entry.b.nameDe,
      archetype: entry.archetype,
      tier: 2,
      kind: 'core',
      branch: 'b',
      description: `${entry.b.text}; adds ${entry.secondary}.`,
      descriptionDe: `${entry.b.textDe}; gibt ${secondaryDe}.`,
      unlockLevel: 5,
      maxRank: 2,
      cost: 3,
      modifiers: { [entry.secondary]: 3, [entry.primary]: 1 },
      effects: [entry.b.effect],
      requires: id(1),
      excludes: id(2),
    },
    {
      id: id(4),
      name: entry.a.elite,
      nameDe: entry.a.eliteDe,
      archetype: entry.archetype,
      tier: 3,
      kind: 'core',
      branch: 'a',
      description: `${entry.a.text}; sharpens ${entry.primary}.`,
      descriptionDe: `${entry.a.textDe}; schärft ${primaryDe}.`,
      unlockLevel: 10,
      maxRank: 2,
      cost: 4,
      modifiers: { [entry.primary]: 3 },
      effects: [entry.a.effect],
      requires: id(2),
    },
    {
      id: id(5),
      name: entry.b.elite,
      nameDe: entry.b.eliteDe,
      archetype: entry.archetype,
      tier: 3,
      kind: 'core',
      branch: 'b',
      description: `${entry.b.text}; sharpens ${entry.primary}.`,
      descriptionDe: `${entry.b.textDe}; schärft ${primaryDe}.`,
      unlockLevel: 10,
      maxRank: 2,
      cost: 4,
      modifiers: { [entry.primary]: 3 },
      effects: [entry.b.effect],
      requires: id(3),
    },
    {
      id: id(6),
      name: 'Sturdy Frame',
      nameDe: 'Robuster Körper',
      archetype: entry.archetype,
      tier: 2,
      kind: 'side',
      description: `Injury risk −3 % per rank; adds ${entry.secondary}.`,
      descriptionDe: `Verletzungsrisiko −3 % pro Rang; gibt ${secondaryDe}.`,
      unlockLevel: 4,
      maxRank: 3,
      cost: 2,
      modifiers: { [entry.secondary]: 2 },
      effects: [mul('injuryRisk', 0.97)],
      requires: id(1),
    },
    {
      id: id(7),
      name: actionName(firstAction, 1),
      nameDe: actionName(firstAction, 0),
      archetype: entry.archetype,
      tier: 2,
      kind: 'action',
      description: `Unlocks the ${actionName(firstAction, 1)} in matches; sharpens ${entry.primary}.`,
      descriptionDe: `Schaltet ${actionName(firstAction, 0)} im Spiel frei; schärft ${primaryDe}.`,
      unlockLevel: 7,
      maxRank: 1,
      cost: 4,
      modifiers: { [entry.primary]: 2 },
      unlocks: [firstAction],
      requires: id(1),
    },
    {
      id: id(8),
      name: actionName(secondAction, 1),
      nameDe: actionName(secondAction, 0),
      archetype: entry.archetype,
      tier: 3,
      kind: 'action',
      description: `Unlocks the ${actionName(secondAction, 1)} in matches; sharpens ${entry.primary}.`,
      descriptionDe: `Schaltet ${actionName(secondAction, 0)} im Spiel frei; schärft ${primaryDe}.`,
      unlockLevel: 12,
      maxRank: 1,
      cost: 5,
      modifiers: { [entry.primary]: 3 },
      unlocks: [secondAction],
      requires: id(7),
    },
    {
      id: id(9),
      name: "Winner's Mind",
      nameDe: 'Siegermentalität',
      archetype: entry.archetype,
      tier: 3,
      kind: 'mind',
      description: 'Shot spread −2 % and experience +3 % per rank.',
      descriptionDe: 'Streuung der Schüsse −2 % und Erfahrung +3 % pro Rang.',
      unlockLevel: 10,
      maxRank: 2,
      cost: 3,
      modifiers: {},
      effects: [mul('composure', 0.98), mul('xpGain', 1.03)],
      requires: id(6),
    },
  ];
});

const NODE_BY_ID = new Map(TALENT_NODES.map((node) => [node.id, node]));

export function talentsFor(archetype: PlayerArchetype): TalentNode[] {
  return TALENT_NODES.filter((node) => node.archetype === archetype);
}

export function getTalent(id: string): TalentNode | undefined {
  return NODE_BY_ID.get(id);
}

/** Match actions a set of talent ranks unlocks. A node counts from its first rank. */
export function unlockedActions(talentRanks: Record<string, number> | undefined): ActionId[] {
  const found = new Set<ActionId>();
  for (const [id, rank] of Object.entries(talentRanks ?? {})) {
    if (rank <= 0) continue;
    for (const action of NODE_BY_ID.get(id)?.unlocks ?? []) found.add(action);
  }
  return [...found];
}

/** The two attributes an archetype grows around; the root talent and the auto-build both follow them. */
export function archetypeProfile(
  archetype: PlayerArchetype,
): { primary: AttributeKey; secondary: AttributeKey } | undefined {
  const entry = definition.find((candidate) => candidate.archetype === archetype);
  return entry ? { primary: entry.primary, secondary: entry.secondary } : undefined;
}
