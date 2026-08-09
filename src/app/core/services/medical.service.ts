import { Injectable, inject } from '@angular/core';
import { RehabPlan } from '../../models/player.model';
import { setRehabPlan } from '../injury-engine';
import { GameStateService } from './game-state.service';

@Injectable({ providedIn: 'root' })
export class MedicalService {
  private readonly gs = inject(GameStateService);

  setPlan(playerId: string, plan: RehabPlan): boolean {
    let changed = false;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((team) => team.id === draft.clubId);
      const player = club?.players.find((candidate) => candidate.id === playerId);
      if (!club || !player) return;
      const candidate = structuredClone(player);
      const result = setRehabPlan(candidate, plan, club.facilities.medicalCenter);
      if (!result.ok || club.coins < result.cost) return;
      club.coins -= result.cost;
      Object.assign(player, candidate);
      changed = true;
    });
    return changed;
  }
}
