import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import { MetaService } from '../../core/services/meta.service';

/** Small messages for unlocked achievements and levels of the Legends Path; each one goes away by itself. */
@Component({
  selector: 'app-meta-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (toast of meta.toasts(); track toast.id) {
        <button type="button" class="toast" [class.level]="toast.kind === 'level'" (click)="meta.dismiss(toast.id)">
          <strong>{{ toast.kind === 'achievement' ? '★ ' : '▲ ' }}{{ i18n.pick(toast.title[0], toast.title[1]) }}</strong>
          @if (i18n.pick(toast.text[0], toast.text[1])) { <span>{{ i18n.pick(toast.text[0], toast.text[1]) }}</span> }
        </button>
      }
    </div>
  `,
  styles: `
    .toasts { position: fixed; right: 14px; bottom: 14px; z-index: 40; display: flex; flex-direction: column; gap: 8px; max-width: min(340px, calc(100vw - 28px)); pointer-events: none; }
    .toast { pointer-events: auto; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 2px solid var(--accent-3); background: var(--ink-900); color: var(--text); box-shadow: 4px 4px 0 var(--ink-shadow); cursor: pointer; font: inherit; animation: pixel-in .3s both; }
    .toast.level { border-color: var(--accent); }
    .toast strong { font: 12px var(--font-display); color: var(--accent-3); }
    .toast.level strong { color: var(--accent); }
    .toast span { font-size: 12px; color: var(--text-dim); }
    :host-context(body.reduce-motion) .toast { animation: none; }
  `,
})
export class MetaToastsComponent {
  protected readonly meta = inject(MetaService);
  protected readonly i18n = inject(I18nService);
  private readonly timers = new Set<number>();

  constructor() {
    // Every toast stays six seconds, then leaves; a click closes it sooner.
    effect(() => {
      for (const toast of this.meta.toasts()) {
        if (this.timers.has(toast.id)) continue;
        this.timers.add(toast.id);
        setTimeout(() => this.meta.dismiss(toast.id), 6000);
      }
    });
  }
}
