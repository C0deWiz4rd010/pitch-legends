import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';

/** The focus meter that fills while a Mythic player's team plays well; full means the ultimate is ready. */
@Component({
  selector: 'app-focus-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', '[attr.aria-valuenow]': 'focus()', '[attr.aria-label]': 'label()', '[class.ready]': 'ready()' },
  template: `<i [style.width.%]="focus()"></i><span>{{ text() }}</span>`,
  styles: `
    :host { position: relative; display: block; height: 16px; margin: -4px 0 10px; border: 1px solid var(--border); background: var(--bg-900); overflow: hidden; }
    i { display: block; height: 100%; background: linear-gradient(90deg, #7c4dff, #ff5fd2); transition: width 200ms steps(5); }
    span { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font: 700 10px/1 var(--font-pixel); text-shadow: 0 1px 2px #000; }
    :host(.ready) { border-color: #ff5fd2; box-shadow: 0 0 10px #ff5fd2aa; animation: ready 1s ease-in-out infinite; }
    @keyframes ready { 50% { box-shadow: 0 0 18px #7cf7ffcc; } }
    @media (prefers-reduced-motion: reduce) { :host(.ready) { animation: none; } }
  `,
})
export class FocusMeterComponent {
  private readonly i18n = inject(I18nService);
  readonly focus = input.required<number>();
  protected readonly ready = computed(() => this.focus() >= 100);
  protected readonly label = computed(() => this.i18n.pick('Fokus-Meter für die Ultimate', 'Focus meter for the ultimate'));
  protected readonly text = computed(() => this.ready()
    ? this.i18n.pick('ULTIMATE BEREIT · F', 'ULTIMATE READY · F')
    : `${this.i18n.pick('FOKUS', 'FOCUS')} ${this.focus()}%`);
}
