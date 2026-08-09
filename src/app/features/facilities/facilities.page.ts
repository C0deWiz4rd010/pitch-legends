import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { FacilitiesService, FACILITIES, MAX_FACILITY_LEVEL } from '../../core/services/facilities.service';
import { formatCoins } from '../../shared/rating-color';
import { FacilityKey } from '../../models/team.model';

@Component({
  selector: 'app-facilities',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './facilities.page.html',
  styleUrl: './facilities.page.scss',
})
export class FacilitiesPage {
  protected readonly gs = inject(GameStateService);
  protected readonly facilitiesService = inject(FacilitiesService);
  protected readonly facilities = FACILITIES;
  protected readonly maxLevel = MAX_FACILITY_LEVEL;
  protected readonly formatCoins = formatCoins;
  protected readonly levels = [1, 2, 3, 4, 5];
  protected readonly message = signal('');

  protected level(key: FacilityKey): number {
    return this.gs.playerTeam()?.facilities[key] ?? 1;
  }

  protected cost(key: FacilityKey): number {
    return this.facilitiesService.upgradeCost(this.level(key));
  }

  protected canUpgrade(key: FacilityKey): boolean {
    return this.facilitiesService.canUpgrade(key).ok;
  }

  protected upgrade(key: FacilityKey, name: string): void {
    if (this.facilitiesService.upgrade(key)) {
      this.message.set(`UPGRADE: ${name} reached level ${this.level(key)}.`);
    } else {
      const reason = this.facilitiesService.canUpgrade(key).reason;
      this.message.set(reason ?? 'Cannot upgrade.');
    }
  }
}
