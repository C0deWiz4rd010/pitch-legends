import { PressReason, PressStyle } from '../models/club-life.model';

/** What an answer can do to the club, in points: spirit, squad morale, board confidence and the opponent's morale. */
export interface PressEffect {
  spirit: number;
  morale: number;
  board: number;
  /** Change of the opponent's squad morale: negative rattles them, positive fires them up. */
  opponent: number;
}

export interface PressStyleDef {
  id: PressStyle;
  label: [string, string];
  /** What the manager says, in a sentence. */
  quote: [string, string];
  /** Chance of success: `base` plus the media attribute's pull (see core/career/press-conference.ts). */
  base: number;
  /** How much the media attribute moves the chance per point above 55. */
  mediaSlope: number;
  success: PressEffect;
  failure: PressEffect;
}

/**
 * Three ways to answer. The humble answer always lands a little; the confident one usually lifts the club and
 * sometimes hands the opponent a headline; the provocative one can rattle the opponent or fire them up, and can
 * cost the board's trust.
 */
export const PRESS_STYLES: PressStyleDef[] = [
  {
    id: 'humble',
    label: ['Bescheiden', 'Humble'],
    quote: [
      'Wir haben Respekt vor dem Gegner und arbeiten Woche für Woche.',
      'We respect the opponent and work week by week.',
    ],
    base: 1,
    mediaSlope: 0,
    success: { spirit: 1, morale: 1, board: 1, opponent: 0 },
    failure: { spirit: 1, morale: 1, board: 1, opponent: 0 },
  },
  {
    id: 'confident',
    label: ['Selbstbewusst', 'Confident'],
    quote: [
      'Wir gehen als Favorit in dieses Spiel und wollen es zeigen.',
      'We go into this game as favourites and want to show it.',
    ],
    base: 0.62,
    mediaSlope: 1 / 150,
    success: { spirit: 3, morale: 2, board: 2, opponent: 0 },
    failure: { spirit: -2, morale: -1, board: -1, opponent: 2 },
  },
  {
    id: 'provocative',
    label: ['Provokant', 'Provocative'],
    quote: [
      'Die sollen sich warm anziehen: Bei uns holt keiner etwas.',
      'They had better wrap up warm: nobody takes anything from us.',
    ],
    base: 0.38,
    mediaSlope: 1 / 110,
    success: { spirit: 5, morale: 3, board: 1, opponent: -3 },
    failure: { spirit: -4, morale: -3, board: -4, opponent: 5 },
  },
];

export function pressStyle(id: PressStyle): PressStyleDef {
  return PRESS_STYLES.find((style) => style.id === id) ?? PRESS_STYLES[0];
}

/** What is at stake counts: derbies and deciders weigh more than a normal big match. */
export const REASON_WEIGHT: Record<PressReason, number> = {
  derby: 1.3,
  decider: 1.2,
  topclash: 1.1,
  cup: 1,
};

export const REASON_LABEL: Record<PressReason, [string, string]> = {
  derby: ['Derby', 'Derby'],
  decider: ['Entscheidungsspiel', 'Decider'],
  topclash: ['Spitzenspiel', 'Top clash'],
  cup: ['Pokalspiel', 'Cup tie'],
};

export interface PressQuestionDef {
  text: [string, string];
  /** Only asked for these reasons; omitted means any. */
  reasons?: PressReason[];
}

/** `{opponent}` is replaced with the club's name. */
export const PRESS_QUESTIONS: PressQuestionDef[] = [
  {
    reasons: ['derby'],
    text: [
      'Die Fans wollen im Derby gegen {opponent} nur einen Sieg. Was sagen Sie ihnen?',
      'The fans want nothing but a win in the derby against {opponent}. What do you tell them?',
    ],
  },
  {
    reasons: ['derby'],
    text: [
      'Wie wichtig ist das Derby gegen {opponent} für die Stadt?',
      'How important is the derby against {opponent} for the city?',
    ],
  },
  {
    reasons: ['topclash'],
    text: [
      'Gegen {opponent} geht es um die Tabellenspitze. Sind Sie bereit?',
      'Against {opponent} it is about the top of the table. Are you ready?',
    ],
  },
  {
    reasons: ['cup'],
    text: [
      'Im Pokal gegen {opponent} gibt es keine zweite Chance. Wie gehen Sie das an?',
      'There is no second chance in the cup against {opponent}. How do you approach it?',
    ],
  },
  {
    reasons: ['decider'],
    text: [
      'Die Saison geht in die Schlussphase, und {opponent} kommt. Was steht auf dem Spiel?',
      'The season is in its final phase and {opponent} are coming. What is at stake?',
    ],
  },
  {
    text: [
      'Wie ist die Stimmung in der Mannschaft vor dem Spiel gegen {opponent}?',
      'What is the mood in the squad before the game against {opponent}?',
    ],
  },
  {
    text: ['Was erwarten Sie von {opponent}?', 'What do you expect from {opponent}?'],
  },
];
