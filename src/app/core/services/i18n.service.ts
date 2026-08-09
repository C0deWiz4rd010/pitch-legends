import { Injectable, computed, inject } from '@angular/core';
import { TRANSLATIONS } from '../../data/translations';
import { MessageParams } from '../../models/game.model';
import { MatchEvent } from '../../models/match.model';
import { GameStateService } from './game-state.service';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly gs = inject(GameStateService);
  readonly locale = computed(() => this.gs.game()?.settings.locale ?? 'de');

  t(key: string, params?: MessageParams): string {
    const template = TRANSLATIONS[this.locale()][key] ?? TRANSLATIONS.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
  }

  event(event: MatchEvent): string {
    return event.messageKey ? this.t(event.messageKey, event.params) : (event.text ?? '');
  }
}
