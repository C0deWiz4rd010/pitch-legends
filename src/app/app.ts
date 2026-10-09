import { Component, effect, inject, signal, isDevMode, DOCUMENT } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GameStateService } from './core/services/game-state.service';
import { StartComponent } from './features/start/start.component';
import { formatCoins } from './shared/rating-color';
import { I18nPipe } from './shared/i18n.pipe';
import { ClubCrestComponent } from './shared/components/club-crest.component';
import { MiniKitComponent } from './shared/components/mini-kit.component';
import { ControlHandbookComponent } from './shared/components/control-handbook.component';
import { SystemNoticesComponent } from './shared/components/system-notices.component';
import { ControlHelpService } from './core/services/control-help.service';
import { APP_VERSION } from './core/version';
import { I18nService } from './core/services/i18n.service';
import { GamepadMenuService } from './core/services/gamepad-menu.service';

interface NavItem {
  path: string;
  labelKey: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, StartComponent, I18nPipe, ClubCrestComponent, MiniKitComponent, ControlHandbookComponent, SystemNoticesComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly gs = inject(GameStateService);
  protected readonly controlHelp = inject(ControlHelpService);
  protected readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  protected readonly menuOpen = signal(false);
  protected readonly version = APP_VERSION;
  protected readonly revision = signal('');
  private readonly router = inject(Router);
  protected readonly standalonePage = signal(/\/(?:play|players)(?:[/?#]|$)/.test(location.pathname));

  protected readonly nav: NavItem[] = [
    { path: '', labelKey: 'nav.dashboard', icon: '⌂' },
    { path: 'squad', labelKey: 'nav.squad', icon: '♟' },
    { path: 'tactics', labelKey: 'nav.tactics', icon: '◇' },
    { path: 'training', labelKey: 'nav.training', icon: '↑' },
    { path: 'match', labelKey: 'nav.match', icon: '●' },
    { path: 'transfer', labelKey: 'nav.transfers', icon: '↔' },
    { path: 'league', labelKey: 'nav.league', icon: '▤' },
    { path: 'academy', labelKey: 'nav.academy', icon: '✦' },
    { path: 'finances', labelKey: 'nav.finances', icon: '¤' },
    { path: 'facilities', labelKey: 'nav.facilities', icon: '▦' },
    { path: 'legends', labelKey: 'nav.legends', icon: '★' },
    { path: 'modes', labelKey: 'nav.modes', icon: '◎' },
    { path: 'settings', labelKey: 'nav.settings', icon: '⚙' },
  ];

  constructor() {
    // The in-game "reduced motion" setting also calms menu animations, not only the 3D camera.
    effect(() => this.document.body.classList.toggle('reduce-motion', !!this.gs.game()?.settings.reducedMotion));
    inject(GamepadMenuService).start();
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationEnd) this.standalonePage.set(/^\/(?:play|players|legends|quick|challenges|modes|controls)(?:[/?#]|$)/.test(event.urlAfterRedirects));
    });
    // Resume an existing career automatically so a page reload persists state.
    if (this.gs.hasStoredSave()) this.gs.loadFromStorage();
    if (!isDevMode()) void fetch(new URL('build-info.json', document.baseURI))
      .then((response) => response.ok ? response.json() : null)
      .then((build: { revision?: string } | null) => {
        if (build?.revision && /^[a-f0-9]{40}$/.test(build.revision)) this.revision.set(build.revision.slice(0, 8));
      }).catch(() => { /* Development and offline-first startup need no build metadata. */ });
  }

  protected coins(): string {
    return formatCoins(this.gs.coins());
  }
}
