/**
 * The meta layer: what a player has done across every mode of the game. It lives in its own save, apart from any
 * career or Legends club, and holds achievements, the Legends Path (profile experience and cosmetics) and the
 * account-wide records of the Hall of Fame. Nothing in it changes a value on the pitch.
 */
export type CosmeticSlot = 'boots' | 'cheer' | 'ball' | 'decor' | 'kit';

export interface HallRecords {
  /** Most goals scored by the managed club in one season. */
  goalsSeason: number;
  /** Most points of the managed club in one season. */
  pointsSeason: number;
  /** Longest winning run in the managed club's league matches. */
  winStreak: number;
  /** Biggest win of the managed club, as the margin of goals. */
  biggestWin: number;
  /** Highest level any player reached in a career. */
  topLevel: number;
  /** Titles won as a manager. */
  titles: number;
  /** Best division reached in Legends Rivals (1 is the elite). */
  legendsDivision: number;
  /** Most rounds won in one Draft tournament. */
  draftWins: number;
  /** The best medal results of the challenges, by challenge id: 3 gold, 2 silver, 1 bronze. */
  medals: Record<string, number>;
}

export interface MetaState {
  version: 1;
  /** Profile experience of the Legends Path, from every mode. */
  xp: number;
  /** Running tallies the achievements read: sums, or maxima where the name says so. */
  counters: Record<string, number>;
  /** Achievement id to the order in which it was unlocked. */
  unlocked: Record<string, number>;
  /** Cosmetic id per slot that is shown in matches. */
  equipped: Partial<Record<CosmeticSlot, string>>;
  records: HallRecords;
}

export function emptyRecords(): HallRecords {
  return { goalsSeason: 0, pointsSeason: 0, winStreak: 0, biggestWin: 0, topLevel: 0, titles: 0, legendsDivision: 10, draftWins: 0, medals: {} };
}

export function emptyMeta(): MetaState {
  return { version: 1, xp: 0, counters: {}, unlocked: {}, equipped: {}, records: emptyRecords() };
}
