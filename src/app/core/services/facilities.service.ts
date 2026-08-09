import { Injectable, inject } from '@angular/core';
import { FacilityKey } from '../../models/team.model';
import { GameStateService } from './game-state.service';

export interface FacilityInfo {
  key: FacilityKey;
  name: string;
  icon: string;
  description: string;
  effect: (level: number) => string;
}

export const FACILITIES: FacilityInfo[] = [
  {
    key: 'trainingGround',
    name: 'Training Ground',
    icon: 'ST',
    description: 'Boosts XP and attribute growth from training sessions.',
    effect: (l) => `+${Math.round(l * 18)}% training XP`,
  },
  {
    key: 'medicalCenter',
    name: 'Medical Centre',
    icon: 'MD',
    description: 'Speeds up fitness recovery and reduces injury risk.',
    effect: (l) => `+${l * 4} fitness / week`,
  },
  {
    key: 'stadium',
    name: 'Stadium',
    icon: 'TR',
    description: 'Increases matchday income from home games.',
    effect: (l) => `+${(l * 22).toLocaleString()}k gate`,
  },
  {
    key: 'youthAcademy',
    name: 'Youth Academy',
    icon: 'YA',
    description: 'Improves the quality of scouted young players.',
    effect: (l) => `Level ${l} prospects`,
  },
];

export const MAX_FACILITY_LEVEL = 5;

@Injectable({ providedIn: 'root' })
export class FacilitiesService {
  private readonly gs = inject(GameStateService);

  /** Cost to upgrade a facility from its current level. */
  upgradeCost(currentLevel: number): number {
    return currentLevel * 120000;
  }

  canUpgrade(key: FacilityKey): { ok: boolean; reason?: string } {
    const club = this.gs.playerTeam();
    if (!club) return { ok: false, reason: 'No club.' };
    const level = club.facilities[key];
    if (level >= MAX_FACILITY_LEVEL) return { ok: false, reason: 'Max level reached.' };
    if (club.coins < this.upgradeCost(level)) return { ok: false, reason: 'Not enough coins.' };
    return { ok: true };
  }

  upgrade(key: FacilityKey): boolean {
    const check = this.canUpgrade(key);
    if (!check.ok) return false;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const level = club.facilities[key];
      club.coins -= this.upgradeCost(level);
      club.facilities[key] = level + 1;
    });
    return true;
  }
}
