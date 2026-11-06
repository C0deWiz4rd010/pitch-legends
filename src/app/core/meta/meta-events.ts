import { MetaState } from '../../models/meta.model';
import { AchievementDef, MAX_COUNTERS, unlockReached } from './achievements';
import { levelFor } from './legend-path';

/** Everything the rest of the game tells the meta layer. Each one is a plain fact, never a decision. */
export type MetaEvent =
  | { type: 'career-match'; goalsFor: number; goalsAgainst: number; derby: boolean; league: boolean; hattricks: number; motm: boolean }
  | { type: 'career-season'; points: number; goalsFor: number; champion: boolean; promoted: boolean }
  | { type: 'level-ups'; count: number; highest: number }
  | { type: 'evolution' }
  | { type: 'signing' }
  | { type: 'training' }
  | { type: 'staff-hired' }
  | { type: 'press' }
  | { type: 'academy-promoted' }
  | { type: 'legends-match'; mode: 'rivals' | 'draft'; goalsFor: number; goalsAgainst: number; won: boolean }
  | { type: 'legends-pack' }
  | { type: 'legends-sbc' }
  | { type: 'legends-draft'; winsInRun: number }
  | { type: 'legends-division'; division: number }
  | { type: 'legends-collection'; cards: number; gold: number; legends: number; albumSets: number }
  | { type: 'challenge'; id: string; medal: 'bronze' | 'silver' | 'gold' | null }
  | { type: 'exhibition-match'; goalsFor: number; goalsAgainst: number };

function add(meta: MetaState, counter: string, amount: number): void {
  if (amount <= 0) return;
  meta.counters[counter] = (meta.counters[counter] ?? 0) + amount;
}

function raise(meta: MetaState, counter: string, value: number): void {
  if (!MAX_COUNTERS.has(counter)) throw new Error(`${counter} is not a record counter`);
  meta.counters[counter] = Math.max(meta.counters[counter] ?? 0, value);
}

const MEDAL_POINTS = { bronze: 1, silver: 2, gold: 3 } as const;
const MEDAL_XP = { bronze: 15, silver: 25, gold: 40 } as const;

/** Experience of a played match: showing up, scoring, winning, keeping a clean sheet. */
function matchXp(goalsFor: number, goalsAgainst: number): number {
  return 10 + Math.min(goalsFor, 5) * 2 + (goalsFor > goalsAgainst ? 12 : goalsFor === goalsAgainst ? 5 : 0) + (goalsAgainst === 0 ? 6 : 0);
}

export interface MetaOutcome {
  unlocked: AchievementDef[];
  /** Levels of the Legends Path gained by this event (the new levels, in order). */
  levels: number[];
}

/**
 * Applies one fact: updates counters, records and experience, then unlocks what has been reached. The experience of
 * the achievements themselves is added by `unlockReached`, so an unlock can open the next level at once.
 */
export function applyMetaEvent(meta: MetaState, event: MetaEvent): MetaOutcome {
  const before = levelFor(meta.xp);
  const records = meta.records;
  switch (event.type) {
    case 'career-match': {
      add(meta, 'matches', 1);
      add(meta, 'goals', event.goalsFor);
      const won = event.goalsFor > event.goalsAgainst;
      if (won) add(meta, 'wins', 1);
      if (event.goalsAgainst === 0) add(meta, 'cleanSheets', 1);
      if (won && event.derby) add(meta, 'derbyWins', 1);
      if (won && event.goalsFor - event.goalsAgainst >= 4) add(meta, 'bigWins', 1);
      add(meta, 'hattricks', event.hattricks);
      if (event.league) {
        meta.counters['runningStreak'] = won ? (meta.counters['runningStreak'] ?? 0) + 1 : 0;
        raise(meta, 'winStreak', meta.counters['runningStreak']);
        records.winStreak = Math.max(records.winStreak, meta.counters['runningStreak']);
      }
      if (won) records.biggestWin = Math.max(records.biggestWin, event.goalsFor - event.goalsAgainst);
      meta.xp += matchXp(event.goalsFor, event.goalsAgainst) + (event.motm ? 8 : 0) + event.hattricks * 15;
      break;
    }
    case 'career-season':
      add(meta, 'seasons', 1);
      if (event.champion) { add(meta, 'titles', 1); records.titles++; }
      if (event.promoted) add(meta, 'promotions', 1);
      records.goalsSeason = Math.max(records.goalsSeason, event.goalsFor);
      records.pointsSeason = Math.max(records.pointsSeason, event.points);
      meta.xp += 60 + (event.champion ? 100 : 0) + (event.promoted ? 40 : 0);
      break;
    case 'level-ups':
      add(meta, 'levelUps', event.count);
      records.topLevel = Math.max(records.topLevel, event.highest);
      meta.xp += event.count * 3;
      break;
    case 'evolution': add(meta, 'evolutions', 1); meta.xp += 30; break;
    case 'signing': add(meta, 'signings', 1); meta.xp += 6; break;
    case 'training': add(meta, 'trainings', 1); meta.xp += 2; break;
    case 'staff-hired': add(meta, 'staffHired', 1); meta.xp += 8; break;
    case 'press': add(meta, 'pressConferences', 1); meta.xp += 10; break;
    case 'academy-promoted': add(meta, 'academyPromoted', 1); meta.xp += 10; break;
    case 'legends-match':
      add(meta, 'matches', 1);
      add(meta, 'goals', event.goalsFor);
      if (event.won) { add(meta, 'wins', 1); add(meta, 'legendsWins', 1); }
      if (event.goalsAgainst === 0) add(meta, 'cleanSheets', 1);
      if (event.mode === 'draft' && event.won) add(meta, 'draftWins', 1);
      if (event.won && event.goalsFor - event.goalsAgainst >= 4) add(meta, 'bigWins', 1);
      meta.xp += matchXp(event.goalsFor, event.goalsAgainst);
      break;
    case 'legends-pack': add(meta, 'packsOpened', 1); meta.xp += 5; break;
    case 'legends-sbc': add(meta, 'sbcs', 1); meta.xp += 25; break;
    case 'legends-draft':
      records.draftWins = Math.max(records.draftWins, event.winsInRun);
      break;
    case 'legends-division':
      records.legendsDivision = Math.min(records.legendsDivision, event.division);
      raise(meta, 'divisionDepth', 11 - event.division);
      break;
    case 'legends-collection':
      raise(meta, 'cardsMax', event.cards);
      raise(meta, 'goldMax', event.gold);
      raise(meta, 'legendMax', event.legends);
      // Album sets are counted by the album itself, so the counter only follows it upwards.
      meta.counters['albumSets'] = Math.max(meta.counters['albumSets'] ?? 0, event.albumSets);
      break;
    case 'challenge':
      if (event.medal) {
        add(meta, 'medals', 1);
        if (event.medal === 'gold') add(meta, 'goldMedals', 1);
        if ((records.medals[event.id] ?? 0) < MEDAL_POINTS[event.medal]) {
          // Only a better medal than the best so far is worth experience, so a medal cannot be farmed.
          meta.xp += MEDAL_XP[event.medal];
          records.medals[event.id] = MEDAL_POINTS[event.medal];
        }
      }
      break;
    case 'exhibition-match':
      add(meta, 'matches', 1);
      add(meta, 'goals', event.goalsFor);
      if (event.goalsFor > event.goalsAgainst) add(meta, 'wins', 1);
      if (event.goalsAgainst === 0) add(meta, 'cleanSheets', 1);
      meta.xp += Math.round(matchXp(event.goalsFor, event.goalsAgainst) / 2);
      break;
  }
  const unlocked = unlockReached(meta);
  const after = levelFor(meta.xp);
  return { unlocked, levels: Array.from({ length: Math.max(0, after - before) }, (_, index) => before + 1 + index) };
}
