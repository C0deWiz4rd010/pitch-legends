import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TRANSLATIONS } from '../../data/translations';
import { MessageParams } from '../../models/game.model';
import { MatchEvent } from '../../models/match.model';
import { GameStateService } from './game-state.service';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly gs = inject(GameStateService);
  private readonly startLocale = signal<'de' | 'en'>('de');
  readonly locale = computed(() => this.gs.game()?.settings.locale ?? this.startLocale());

  constructor() {
    // Screen readers and hyphenation follow the chosen language.
    effect(() => { if (typeof document !== 'undefined') document.documentElement.lang = this.locale(); });
  }

  /** Inline bilingual text; prefer translation keys for anything reused. */
  pick(de: string, en: string): string {
    return this.locale() === 'de' ? de : en;
  }

  setLocale(locale: 'de' | 'en'): void {
    if (this.gs.game()) this.gs.mutate((draft) => (draft.settings.locale = locale));
    else this.startLocale.set(locale);
  }

  t(key: string, params?: MessageParams): string {
    const template = TRANSLATIONS[this.locale()][key] ?? TRANSLATIONS.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  }

  event(event: MatchEvent): string {
    return event.messageKey ? this.t(event.messageKey, event.params) : (event.text ?? '');
  }
}
