import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PersistentStore } from '../../core/storage/persistent-store';
import { ExhibitionService } from '../../core/services/exhibition.service';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { DEFAULT_QUICK_SETTINGS, QuickMatchSettings, quickClubs, quickTeam } from '../../core/football/quick-match';
import { smallSidedTeam } from '../../core/football/small-sided';

const STORAGE_KEY = 'pitch-legends:quick:v1';

/** Quick match: pick two clubs, stadium, weather, time and length; one click to kick off. */
@Component({
  selector: 'app-quick',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quick.page.html',
  styleUrl: './quick.page.scss',
})
export class QuickPage {
  private readonly exhibitions = inject(ExhibitionService);
  private readonly router = inject(Router);
  private readonly store = inject(PersistentStore);
  protected readonly gs = inject(GameStateService);
  protected readonly i18n = inject(I18nService);
  protected readonly clubs = quickClubs();
  protected readonly settings = signal<QuickMatchSettings>(this.load());
  protected readonly home = computed(() => this.clubs[this.settings().homeIndex]);
  protected readonly away = computed(() => this.clubs[this.settings().awayIndex]);
  protected readonly stadiums = [1, 2, 3, 4, 5] as const;
  protected readonly lengths = [3, 5, 8] as const;

  private load(): QuickMatchSettings {
    try {
      const saved = JSON.parse(this.store.get(STORAGE_KEY) ?? 'null') as Partial<QuickMatchSettings> | null;
      return { ...DEFAULT_QUICK_SETTINGS, ...(saved ?? {}) };
    } catch {
      return { ...DEFAULT_QUICK_SETTINGS };
    }
  }

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }
  protected stars(strength: number): string { return '★'.repeat(Math.max(1, Math.round((strength - 55) / 6))); }

  protected update<K extends keyof QuickMatchSettings>(key: K, value: QuickMatchSettings[K]): void {
    this.settings.update((current) => ({ ...current, [key]: value }));
    void this.store.set(STORAGE_KEY, JSON.stringify(this.settings()));
  }

  protected swap(): void {
    const { homeIndex, awayIndex } = this.settings();
    this.update('homeIndex', awayIndex);
    this.update('awayIndex', homeIndex);
  }

  protected random(): void {
    const home = Math.floor(Math.random() * this.clubs.length);
    let away = Math.floor(Math.random() * this.clubs.length);
    if (away === home) away = (away + 1) % this.clubs.length;
    this.update('homeIndex', home);
    this.update('awayIndex', away);
  }

  protected kickOff(): void {
    const settings = this.settings();
    let home = quickTeam(settings.homeIndex, settings, true);
    let away = quickTeam(settings.awayIndex, settings, false);
    if (settings.smallSided) { home = smallSidedTeam(home); away = smallSidedTeam(away); }
    const controlled = settings.controlAway ? away : home;
    this.exhibitions.start({
      id: `quick-${Date.now().toString(36)}`,
      home, away, controlledTeamId: controlled.id,
      seed: (Math.random() * 0xffffffff) >>> 0,
      title: settings.smallSided ? { de: 'Schnellspiel · 5 gegen 5', en: 'Quick match · 5-a-side' } : { de: 'Schnellspiel', en: 'Quick match' },
      returnUrl: '/quick', returnLabel: { de: 'Schnellspiel', en: 'Quick match' },
      weather: settings.weather, halfMinutes: settings.halfMinutes, autoStart: true, rematch: true, smallSided: settings.smallSided,
    });
    void this.router.navigateByUrl('/play');
  }
}
