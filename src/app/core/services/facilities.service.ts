import { Injectable, inject } from '@angular/core';
import { FacilityKey } from '../../models/team.model';
import { GameStateService } from './game-state.service';
import { facilityUpgradeCost, record } from '../career/finance';

type Text = { de: string; en: string };

export interface FacilityInfo {
  key: FacilityKey;
  name: Text;
  icon: string;
  description: Text;
  /** The effect at a level, matching the formulas used by training, medical, season and youth services. */
  effect: (level: number) => Text;
}

export const FACILITIES: FacilityInfo[] = [
  {
    key: 'trainingGround',
    name: { de: 'Trainingsgelände', en: 'Training Ground' },
    icon: 'ST',
    description: { de: 'Mehr XP und Wachstum der Attribute aus dem Training.', en: 'Boosts XP and attribute growth from training sessions.' },
    effect: (l) => ({ de: `+${Math.round(l * 18)} % Trainings-XP`, en: `+${Math.round(l * 18)}% training XP` }),
  },
  {
    key: 'medicalCenter',
    name: { de: 'Medizinisches Zentrum', en: 'Medical Centre' },
    icon: 'MD',
    description: { de: 'Schnellere Erholung, kürzere Reha und geringeres Verletzungsrisiko.', en: 'Speeds up fitness recovery and reduces injury risk.' },
    effect: (l) => ({ de: `+${l * 4} Fitness pro Woche`, en: `+${l * 4} fitness / week` }),
  },
  {
    key: 'stadium',
    name: { de: 'Stadion', en: 'Stadium' },
    icon: 'TR',
    description: { de: 'Mehr Zuschauereinnahmen bei Heimspielen und ein größeres Stadion.', en: 'Increases matchday income from home games and grows the ground.' },
    effect: (l) => ({ de: `+${l * 22}k Zuschauereinnahmen`, en: `+${l * 22}k gate` }),
  },
  {
    key: 'youthAcademy',
    name: { de: 'Nachwuchsakademie', en: 'Youth Academy' },
    icon: 'YA',
    description: { de: 'Bessere Talente im jährlichen Nachwuchsjahrgang.', en: 'Improves the quality of the yearly youth intake.' },
    effect: (l) => ({ de: `Talente der Stufe ${l}`, en: `Level ${l} prospects` }),
  },
];

export type FacilityBlock = 'no-club' | 'max-level' | 'no-funds';

export const MAX_FACILITY_LEVEL = 5;

@Injectable({ providedIn: 'root' })
export class FacilitiesService {
  private readonly gs = inject(GameStateService);

  /** Cost to upgrade a facility from its current level. */
  upgradeCost(currentLevel: number): number {
    return facilityUpgradeCost(currentLevel);
  }

  canUpgrade(key: FacilityKey): { ok: boolean; reason?: FacilityBlock } {
    const club = this.gs.playerTeam();
    if (!club) return { ok: false, reason: 'no-club' };
    const level = club.facilities[key];
    if (level >= MAX_FACILITY_LEVEL) return { ok: false, reason: 'max-level' };
    if (club.coins < this.upgradeCost(level)) return { ok: false, reason: 'no-funds' };
    return { ok: true };
  }

  upgrade(key: FacilityKey): boolean {
    const check = this.canUpgrade(key);
    if (!check.ok) return false;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const level = club.facilities[key];
      club.coins -= this.upgradeCost(level);
      record(draft, club, 'facilities', this.upgradeCost(level));
      club.facilities[key] = level + 1;
    });
    return true;
  }
}
