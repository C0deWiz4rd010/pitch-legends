import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GameStateService } from './core/services/game-state.service';
import { StartComponent } from './features/start/start.component';
import { formatCoins } from './shared/rating-color';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, StartComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly gs = inject(GameStateService);
  protected readonly menuOpen = signal(false);

  protected readonly nav: NavItem[] = [
    { path: '', label: 'Dashboard', icon: '🏠' },
    { path: 'squad', label: 'Squad', icon: '👥' },
    { path: 'tactics', label: 'Tactics', icon: '📋' },
    { path: 'training', label: 'Training', icon: '🏋️' },
    { path: 'match', label: 'Match Day', icon: '⚽' },
    { path: 'transfer', label: 'Transfers', icon: '💱' },
    { path: 'league', label: 'League', icon: '🏆' },
    { path: 'facilities', label: 'Facilities', icon: '🏟️' },
    { path: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  constructor() {
    // Resume an existing career automatically so a page reload persists state.
    if (this.gs.hasStoredSave()) this.gs.loadFromStorage();
  }

  protected coins(): string {
    return formatCoins(this.gs.coins());
  }
}

