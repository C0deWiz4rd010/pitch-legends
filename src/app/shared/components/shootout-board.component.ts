import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { PenaltyShootout } from '../../models/match.model';
import { I18nService } from '../../core/services/i18n.service';

interface Kick { side: 'home' | 'away'; round: number; scored: boolean; taker: string }

/** Kick-by-kick penalty shoot-out: home and away alternate, one kick revealed after the other. */
@Component({
  selector: 'app-shootout-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="board" [attr.aria-label]="i18n.pick('Elfmeterschießen', 'Penalty shoot-out')">
      <header>
        <span class="eyebrow">{{ i18n.pick('ELFMETERSCHIESSEN', 'PENALTY SHOOT-OUT') }}</span>
        <strong aria-live="polite">{{ score().home }} : {{ score().away }}</strong>
      </header>
      @for (row of rows(); track row.side) {
        <div class="row">
          <span class="team">{{ row.name }}</span>
          <ol>
            @for (kick of row.kicks; track kick.round) {
              <li [class.scored]="kick.shown && kick.scored" [class.missed]="kick.shown && !kick.scored" [attr.title]="kick.shown ? kick.taker : null"
                [attr.aria-label]="kick.shown ? kick.taker + ': ' + (kick.scored ? i18n.pick('Tor', 'scored') : i18n.pick('verschossen', 'missed')) : i18n.pick('noch offen', 'still to come')">
                {{ kick.shown ? (kick.scored ? '●' : '✕') : '' }}
              </li>
            }
          </ol>
        </div>
      }
      @if (finished()) {
        <p class="winner">{{ (shootout().winner === 'home' ? homeName() : awayName()) }} {{ i18n.pick('gewinnt im Elfmeterschießen', 'win on penalties') }}</p>
      } @else {
        <button type="button" class="skip" (click)="revealAll()">{{ i18n.pick('ALLE ZEIGEN', 'SHOW ALL') }}</button>
      }
    </section>
  `,
  styles: [`
    .board { display: grid; gap: 8px; margin-top: 10px; padding: 12px; border: 2px solid var(--accent-3); background: var(--surface-2); }
    header { display: flex; justify-content: space-between; align-items: baseline; }
    .eyebrow { color: var(--accent-3); font: 11px var(--font-display); }
    strong { font: 20px var(--font-display); }
    .row { display: grid; grid-template-columns: 72px 1fr; align-items: center; gap: 8px; }
    .team { font: 12px var(--font-display); color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ol { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
    li { width: 24px; height: 24px; display: grid; place-items: center; border: 2px solid var(--border); color: var(--text-mute); font-size: 12px; }
    li.scored { border-color: var(--good); color: var(--good); }
    li.missed { border-color: var(--danger); color: var(--danger); }
    .winner { margin: 2px 0 0; color: var(--accent-3); font: 12px var(--font-display); }
    .skip { justify-self: end; padding: 4px 10px; border: 2px solid var(--border); background: transparent; color: var(--text-dim); font: 11px var(--font-display); cursor: pointer; }
  `],
})
export class ShootoutBoardComponent {
  protected readonly i18n = inject(I18nService);
  readonly shootout = input.required<PenaltyShootout>();
  readonly homeName = input('');
  readonly awayName = input('');
  readonly names = input<Record<string, string>>({});
  /** Show the whole shoot-out at once (reduced motion). */
  readonly instant = input(false);
  private readonly revealed = signal(0);

  /** Kicks in the order they were taken: home, away, home, away … */
  private readonly kicks = computed<Kick[]>(() => {
    const shootout = this.shootout();
    const names = this.names();
    const kicks: Kick[] = [];
    for (let round = 0; round < Math.max(shootout.home.length, shootout.away.length); round++) {
      for (const side of ['home', 'away'] as const) {
        if (round < shootout[side].length) kicks.push({ side, round, scored: shootout[side][round], taker: names[shootout.takers[side][round]] ?? '' });
      }
    }
    return kicks;
  });
  protected readonly finished = computed(() => this.revealed() >= this.kicks().length);
  protected readonly score = computed(() => {
    const shown = this.kicks().slice(0, this.revealed());
    return { home: shown.filter((kick) => kick.side === 'home' && kick.scored).length, away: shown.filter((kick) => kick.side === 'away' && kick.scored).length };
  });
  protected readonly rows = computed(() => {
    const order = this.kicks();
    const shown = this.revealed();
    return (['home', 'away'] as const).map((side) => ({
      side,
      name: side === 'home' ? this.homeName() : this.awayName(),
      kicks: order.map((kick, index) => ({ ...kick, shown: index < shown })).filter((kick) => kick.side === side),
    }));
  });

  constructor() {
    let timer: ReturnType<typeof setInterval> | null = null;
    effect(() => {
      const total = this.kicks().length;
      if (timer) clearInterval(timer);
      if (this.instant()) { this.revealed.set(total); return; }
      this.revealed.set(0);
      timer = setInterval(() => {
        this.revealed.update((count) => Math.min(total, count + 1));
        if (this.revealed() >= total && timer) { clearInterval(timer); timer = null; }
      }, 650);
    });
    inject(DestroyRef).onDestroy(() => { if (timer) clearInterval(timer); });
  }

  protected revealAll(): void {
    this.revealed.set(this.kicks().length);
  }
}
