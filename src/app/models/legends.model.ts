import { Player } from './player.model';

/** Card quality, derived from overall rating; legends are rare boosted specials. */
export type CardTier = 'bronze' | 'silver' | 'gold' | 'legend';
export type PackId = 'bronze' | 'silver' | 'gold' | 'premium';

export interface CardClub {
  id: string;
  name: string;
  short: string;
  primary: string;
  secondary: string;
  leagueId: string;
}

export interface CardLeague {
  id: string;
  name: string;
}

export interface LegendsCard {
  id: string;
  /** Identity of the underlying player: two cards with the same baseId are duplicates. */
  baseId: string;
  tier: CardTier;
  player: Player;
  clubId: string;
  leagueId: string;
  nation: string;
  acquiredAt: number;
}

export interface LegendsSquad {
  formationId: string;
  /** Card id per formation slot (11). */
  slots: (string | null)[];
  bench: string[];
}

export interface RivalsState {
  /** 10 = entry division, 1 = elite. */
  division: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  season: number;
  bestDivision: number;
  /** Opponent seeds already used, so each fixture is a fresh side. */
  matchSerial: number;
}

export interface DraftPick {
  slotIndex: number;
  options: LegendsCard[];
  chosenId: string | null;
}

export interface DraftState {
  id: string;
  week: string;
  formationId: string;
  picks: DraftPick[];
  /** 0 = picking, 1..4 = round to play next, 5 = done. */
  round: number;
  wins: number;
  eliminated: boolean;
  rewardClaimed: boolean;
}

export type LegendsTaskKind = 'win-rivals' | 'play' | 'goals' | 'open-pack' | 'draft-win' | 'sbc' | 'clean-sheet';

export interface LegendsTask {
  id: string;
  period: 'daily' | 'weekly';
  periodKey: string;
  kind: LegendsTaskKind;
  target: number;
  progress: number;
  reward: { coins: number; pack: PackId | null };
  claimed: boolean;
}

export interface LegendsHistoryEntry {
  id: string;
  mode: 'rivals' | 'draft';
  at: number;
  opponent: string;
  goalsFor: number;
  goalsAgainst: number;
  coins: number;
}

export interface LegendsState {
  version: 1;
  seed: number;
  createdAt: number;
  updatedAt: number;
  clubName: string;
  coins: number;
  cards: LegendsCard[];
  squad: LegendsSquad;
  /** Unopened packs, e.g. rewards. */
  packs: PackId[];
  packsOpened: number;
  cardSerial: number;
  rivals: RivalsState;
  draft: DraftState | null;
  tasks: LegendsTask[];
  completedSbcs: string[];
  history: LegendsHistoryEntry[];
}
