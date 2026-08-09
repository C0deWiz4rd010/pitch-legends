import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../core/services/i18n.service';
import { MessageParams } from '../models/game.model';

@Pipe({ name: 't', standalone: true, pure: false })
export class I18nPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string, params?: MessageParams): string {
    return this.i18n.t(key, params);
  }
}
