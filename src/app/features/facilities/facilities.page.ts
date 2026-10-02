import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { FacilitiesService, FACILITIES, MAX_FACILITY_LEVEL } from '../../core/services/facilities.service';
import { formatCoins } from '../../shared/rating-color';
import { FacilityKey } from '../../models/team.model';
import { I18nService } from '../../core/services/i18n.service';
import { FacilityInfo } from '../../core/services/facilities.service';

@Component({
  selector: 'app-facilities',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './facilities.page.html',
  styleUrl: './facilities.page.scss',
})
export class FacilitiesPage {
  protected readonly gs = inject(GameStateService);
  protected readonly i18n = inject(I18nService);
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

  protected text(value: { de: string; en: string }): string {
    return this.i18n.pick(value.de, value.en);
  }

  protected upgrade(facility: FacilityInfo): void {
    const name = this.text(facility.name);
    if (this.facilitiesService.upgrade(facility.key)) {
      this.message.set(this.i18n.pick(`AUSBAU: ${name} erreicht Stufe ${this.level(facility.key)}.`, `UPGRADE: ${name} reached level ${this.level(facility.key)}.`));
      return;
    }
    const reason = this.facilitiesService.canUpgrade(facility.key).reason;
    this.message.set(reason === 'max-level' ? this.i18n.pick('Höchste Stufe erreicht.', 'Max level reached.')
      : reason === 'no-funds' ? this.i18n.pick('Nicht genug Budget.', 'Not enough coins.')
      : this.i18n.pick('Ausbau nicht möglich.', 'Cannot upgrade.'));
  }
}
