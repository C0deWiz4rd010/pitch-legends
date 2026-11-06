import { Formation, Tactics } from './tactics.model';
import { Player } from './player.model';
import { ClubVisualIdentity } from './visual.model';
import { TeamFinance } from './career.model';

export type FacilityKey = 'trainingGround' | 'medicalCenter' | 'stadium' | 'youthAcademy';

export interface Facilities {
  trainingGround: number; // 1-5
  medicalCenter: number;
  stadium: number;
  youthAcademy: number;
}

export function defaultFacilities(): Facilities {
  return { trainingGround: 1, medicalCenter: 1, stadium: 1, youthAcademy: 1 };
}

export interface KitColors {
  primary: string;
  secondary: string;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  kit: KitColors;
  visuals: ClubVisualIdentity;
  players: Player[];
  formation: Formation;
  tactics: Tactics;
  facilities: Facilities;
  coins: number;
  reputation: number; // 0-100
  wageBudget: number;
  isPlayerControlled: boolean;
  /** AI strength baseline, used to generate squads of varying quality. */
  strength: number;
  managerId: string;
  cityId: string;
  rivalTeamIds: string[];
  /** Season ledger: income, wages, transfers and upkeep. */
  finance: TeamFinance;
  /** Duo partners of the managed club (see core/rpg/partners.ts): player id to the partner and the strength of the bond. */
  partners?: Record<string, { partnerId: string; strength: number }>;
}
