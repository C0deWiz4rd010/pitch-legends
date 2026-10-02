import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Player } from '../../models/player.model';
import { I18nService } from '../../core/services/i18n.service';
import { ratingColor } from '../rating-color';

export interface PitchEntry { player: Player; fitness: number; injured: boolean; card: 'none' | 'yellow' | 'red'; }

/** Bench cards: pick who comes off (fitness, card, injury) and who comes on (rating, position fit). */
@Component({
  selector: 'app-substitution-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="subs" [attr.aria-label]="i18n.pick('Wechsel', 'Substitutions')">
      <header>
        <strong>{{ i18n.pick('Wechsel', 'Substitutions') }}</strong>
        <span class="muted">{{ remaining() }} {{ i18n.pick('verfügbar', 'left') }}</span>
      </header>
      <div class="columns">
        <div>
          <p class="eyebrow">{{ i18n.pick('Raus', 'Off') }}</p>
          <div class="list" role="listbox" [attr.aria-label]="i18n.pick('Spieler auf dem Platz', 'Players on the pitch')">
            @for (entry of onPitch(); track entry.player.id) {
              <button type="button" role="option" class="card-row" [class.selected]="outId() === entry.player.id" [attr.aria-selected]="outId() === entry.player.id" (click)="outId.set(entry.player.id)">
                <span class="pos">{{ entry.player.position }}</span>
                <span class="name">{{ entry.player.lastName }}</span>
                @if (entry.injured) { <span class="flag inj">{{ i18n.pick('VERLETZT', 'INJURED') }}</span> }
                @if (entry.card === 'yellow') { <span class="flag yellow" [attr.aria-label]="i18n.pick('Gelbe Karte', 'Yellow card')"></span> }
                <span class="fit" [attr.aria-label]="i18n.pick('Fitness ', 'Fitness ') + round(entry.fitness)"><i [style.width.%]="entry.fitness" [style.background]="ratingColor(entry.fitness)"></i></span>
              </button>
            }
          </div>
        </div>
        <div>
          <p class="eyebrow">{{ i18n.pick('Rein', 'On') }}</p>
          <div class="list" role="listbox" [attr.aria-label]="i18n.pick('Ersatzbank', 'Bench')">
            @for (player of bench(); track player.id) {
              <button type="button" role="option" class="card-row" [class.selected]="inId() === player.id" [attr.aria-selected]="inId() === player.id" (click)="inId.set(player.id)">
                <span class="pos">{{ player.position }}</span>
                <span class="name">{{ player.lastName }}</span>
                @if (fits(player)) { <span class="flag fit-ok">{{ i18n.pick('PASST', 'FIT') }}</span> }
                <b class="ovr" [style.background]="ratingColor(player.overall)">{{ player.overall }}</b>
              </button>
            } @empty { <p class="muted">{{ i18n.pick('Keine Spieler auf der Bank.', 'No players on the bench.') }}</p> }
          </div>
        </div>
      </div>
      <button type="button" class="btn btn--primary btn--sm confirm" [disabled]="!outId() || !inId() || remaining() <= 0" (click)="confirm()">
        {{ i18n.pick('WECHSELN', 'SUBSTITUTE') }}
      </button>
    </section>
  `,
  styles: [`
    .subs { display: grid; gap: 10px; }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .list { display: grid; gap: 4px; max-height: 240px; overflow: auto; }
    .card-row { display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 5px 8px; border: 1px solid var(--border-soft); background: var(--surface-2); color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
    .card-row.selected { border-color: var(--accent-3); box-shadow: 0 0 0 1px var(--accent-3); }
    .pos { font-family: var(--font-display); font-size: 10px; color: var(--accent-2); min-width: 28px; }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fit { width: 42px; height: 5px; background: var(--bg-900); }
    .fit i { display: block; height: 100%; }
    .flag { font-family: var(--font-display); font-size: 10px; padding: 1px 4px; }
    .flag.inj { background: rgba(255, 79, 120, 0.2); color: var(--danger); }
    .flag.fit-ok { background: rgba(84, 242, 139, 0.16); color: var(--accent); }
    .flag.yellow { width: 8px; height: 11px; background: var(--accent-3); padding: 0; }
    .ovr { min-width: 26px; text-align: center; color: var(--on-accent); font-size: 11px; }
    .confirm { justify-self: end; }
    @media (max-width: 560px) { .columns { grid-template-columns: 1fr; } }
  `],
})
export class SubstitutionPanelComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly ratingColor = ratingColor;
  readonly onPitch = input<PitchEntry[]>([]);
  readonly bench = input<Player[]>([]);
  readonly remaining = input(0);
  readonly substitute = output<{ outId: string; inId: string }>();
  protected readonly outId = signal('');
  protected readonly inId = signal('');
  private readonly outgoing = computed(() => this.onPitch().find(entry => entry.player.id === this.outId())?.player);

  protected fits(player: Player): boolean {
    const out = this.outgoing();
    return !!out && (player.position === out.position || player.positionGroup === out.positionGroup);
  }

  protected round(value: number): number { return Math.round(value); }

  protected confirm(): void {
    if (!this.outId() || !this.inId()) return;
    this.substitute.emit({ outId: this.outId(), inId: this.inId() });
    this.outId.set('');
    this.inId.set('');
  }
}
