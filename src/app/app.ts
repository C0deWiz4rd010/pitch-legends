import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GameStateService } from './core/services/game-state.service';
import { StartComponent } from './features/start/start.component';
import { formatCoins } from './shared/rating-color';
import { I18nPipe } from './shared/i18n.pipe';

interface NavItem {
  path: string;
  labelKey: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, StartComponent, I18nPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly gs = inject(GameStateService);
  protected readonly menuOpen = signal(false);

  protected readonly nav: NavItem[] = [
    { path: '', labelKey: 'nav.dashboard', icon: 'HQ' },
    { path: 'squad', labelKey: 'nav.squad', icon: 'XI' },
    { path: 'tactics', labelKey: 'nav.tactics', icon: 'TX' },
    { path: 'training', labelKey: 'nav.training', icon: 'XP' },
    { path: 'match', labelKey: 'nav.match', icon: 'GO' },
    { path: 'transfer', labelKey: 'nav.transfers', icon: '$$' },
    { path: 'league', labelKey: 'nav.league', icon: 'LG' },
    { path: 'facilities', labelKey: 'nav.facilities', icon: 'FC' },
    { path: 'settings', labelKey: 'nav.settings', icon: 'OP' },
  ];

  constructor() {
    // Resume an existing career automatically so a page reload persists state.
    if (this.gs.hasStoredSave()) this.gs.loadFromStorage();
  }

  protected coins(): string {
    return formatCoins(this.gs.coins());
  }
}
