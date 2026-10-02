import { Injectable, inject } from '@angular/core';
import { autoFillLineup } from '../../data/generators';
import { ScoutAssignment } from '../../models/career.model';
import { MAX_SQUAD_SIZE } from '../transfer-engine';
import { startScoutAssignment } from '../career/scouting';
import { GameStateService } from './game-state.service';

/** Academy decisions and scout assignments of the player's club. */
@Injectable({ providedIn: 'root' })
export class CareerService {
  private readonly gs = inject(GameStateService);

  promoteProspect(playerId: string): { ok: boolean; reason?: 'full' | 'missing' } {
    let result: { ok: boolean; reason?: 'full' | 'missing' } = { ok: false, reason: 'missing' };
    this.gs.mutate((draft) => {
      const club = draft.teams.find((team) => team.id === draft.clubId);
      const prospect = draft.academy?.prospects.find((candidate) => candidate.id === playerId);
      if (!club || !prospect) return;
      if (club.players.length >= MAX_SQUAD_SIZE) { result = { ok: false, reason: 'full' }; return; }
      const used = new Set(club.players.map((player) => player.kitNumber));
      while (used.has(prospect.kitNumber)) prospect.kitNumber = prospect.kitNumber >= 99 ? 24 : prospect.kitNumber + 1;
      club.players.push(prospect);
      draft.academy.prospects = draft.academy.prospects.filter((candidate) => candidate.id !== playerId);
      autoFillLineup(club);
      result = { ok: true };
    });
    return result;
  }

  releaseProspect(playerId: string): void {
    this.gs.mutate((draft) => {
      if (draft.academy) draft.academy.prospects = draft.academy.prospects.filter((candidate) => candidate.id !== playerId);
    });
  }

  startScout(regionId: string, group: ScoutAssignment['positionGroup']): { ok: boolean; reason?: string } {
    let result: { ok: boolean; reason?: string } = { ok: false, reason: 'club' };
    this.gs.mutate((draft) => { result = startScoutAssignment(draft, regionId, group); });
    return result;
  }
}
