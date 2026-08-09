import { Injectable, inject } from '@angular/core';
import { GameStateService } from './game-state.service';
import { prepareTravelEvent, resolveTravelEvent } from '../travel-engine';

@Injectable({ providedIn: 'root' })
export class TravelService {
  private readonly gs = inject(GameStateService);

  ensureCurrent(): void {
    this.gs.mutate((draft) => { prepareTravelEvent(draft); });
  }

  resolve(eventId: string, choiceId: string): void {
    this.gs.mutate((draft) => { resolveTravelEvent(draft, eventId, choiceId); });
  }

  resolveSafeForFixture(fixtureId: string): void {
    this.gs.mutate((draft) => {
      const event = prepareTravelEvent(draft);
      if (event?.fixtureId === fixtureId && !event.resolved) resolveTravelEvent(draft, event.id);
    });
  }
}
