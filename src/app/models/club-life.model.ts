/** Version 8 additions that live beside the dressing room: the kit supplier, duo chemistry and the press. All optional. */

/** A kit supplier the managed club signed; it runs until the end of `untilSeason` and falls back to the basic deal after. */
export interface SupplierContract {
  id: string;
  signedSeason: number;
  untilSeason: number;
}

/** Matches in which two players started together, by pair key (see core/rpg/partners.ts). */
export interface ChemistryState {
  links: Record<string, number>;
}

export type PressStyle = 'humble' | 'confident' | 'provocative';

/** Why the press wants a word before this match. */
export type PressReason = 'derby' | 'topclash' | 'cup' | 'decider';

/** A press conference the manager can still give (`answer` is null) or has given before a big match. */
export interface PressConferenceState {
  /** The match it is about: the week it is played in and the opponent. */
  season: number;
  week: number;
  opponentId: string;
  reason: PressReason;
  /** Which question the journalists ask (index into the question list of data/press-conference.ts). */
  question: number;
  answer: PressStyle | null;
  /** What the answer did, kept for the card: set when answered. */
  outcome?: { success: boolean; spirit: number; morale: number; board: number; opponent: number };
}

export interface PressState {
  current: PressConferenceState | null;
  /** Weeks in which a conference was held, newest first, so they never come in a row. */
  history: { season: number; week: number }[];
}

export function emptyPress(): PressState {
  return { current: null, history: [] };
}
