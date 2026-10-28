import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ATTRIBUTE_KEYS, AttributeKey } from '../../../models/enums';
import { I18nService } from '../../../core/services/i18n.service';
import { acuteChronicRatio, loadZone } from '../../../core/rpg/training-rules';
import { getDrill } from '../../../data/training-drills';
import { Player } from '../../../models/player.model';

const SHORT: Record<AttributeKey, string> = { pace: 'PAC', shooting: 'SHO', passing: 'PAS', dribbling: 'DRI', defending: 'DEF', physical: 'PHY', stamina: 'STA', goalkeeping: 'GK' };
const RING = 2 * Math.PI * 20;

/** Training memory of a player: mastery rings, the four-week load curve and the buffs for the next match. */
@Component({
  selector: 'app-training-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="title">{{ i18n.pick('MEISTERSCHAFT', 'MASTERY') }}</p>
    <div class="rings">
      @for (ring of rings(); track ring.key) {
        <figure [attr.aria-label]="ring.key + ' ' + ring.value + '/100'">
          <svg viewBox="0 0 52 52" role="img">
            <circle class="track" cx="26" cy="26" r="20" />
            <circle class="value" cx="26" cy="26" r="20" [attr.stroke-dasharray]="ring.dash" transform="rotate(-90 26 26)" [class.full]="ring.value >= 100" />
            <text x="26" y="30" text-anchor="middle">{{ ring.value }}</text>
          </svg>
          <figcaption>{{ ring.label }}</figcaption>
        </figure>
      }
    </div>
    <small class="hint">{{ i18n.pick('25: +50 XP · 50: +1 Skillpunkt · 100: Trait des Attributs gratis', '25: +50 XP · 50: +1 skill point · 100: the attribute trait for free') }}</small>

    <p class="title">{{ i18n.pick('BELASTUNG (4 WOCHEN)', 'LOAD (4 WEEKS)') }}</p>
    <div class="load">
      <svg viewBox="0 0 240 70" role="img" [attr.aria-label]="i18n.pick('Belastungskurve', 'Load curve')">
        <line x1="0" y1="35" x2="240" y2="35" class="mid" />
        <polyline [attr.points]="curve()" />
        @for (point of dots(); track $index) { <circle [attr.cx]="point.x" [attr.cy]="point.y" r="3" /> }
      </svg>
      <span class="chip" [attr.data-zone]="zone()">{{ zoneLabel() }} · {{ ratio() }}×</span>
    </div>

    <p class="title">{{ i18n.pick('BUFFS FÜR DAS NÄCHSTE SPIEL', 'BUFFS FOR THE NEXT MATCH') }}</p>
    @for (buff of buffs(); track buff.id) {
      <div class="buff">★ <b>{{ buff.name }}</b> <small>{{ buff.text }}</small></div>
    } @empty { <small class="hint">{{ i18n.pick('Keine aktiven Buffs. Trainingseinheiten erzeugen sie.', 'No active buffs. Training sessions create them.') }}</small> }
  `,
  styles: `
    :host { display: block; }
    .title { margin: 10px 0 5px; color: var(--muted); font: 700 10px/1 var(--font-pixel, monospace); }
    .rings { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    figure { margin: 0; text-align: center; }
    figure svg { width: 100%; max-width: 64px; }
    .track { fill: none; stroke: var(--bg-900); stroke-width: 6; }
    .value { fill: none; stroke: var(--accent-2); stroke-width: 6; stroke-linecap: round; }
    .value.full { stroke: var(--accent); }
    text { fill: var(--text); font: 700 12px var(--font-pixel, monospace); }
    figcaption { color: var(--muted); font-size: 10px; }
    .hint { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
    .load { display: flex; align-items: center; gap: 12px; }
    .load svg { flex: 1; max-width: 300px; height: 70px; }
    .mid { stroke: var(--border); stroke-dasharray: 4 4; }
    polyline { fill: none; stroke: var(--accent-2); stroke-width: 2.5; }
    .load circle { fill: var(--accent); }
    .chip { padding: 3px 7px; border: 1px solid var(--border); font-size: 11px; }
    .chip[data-zone='green'] { color: var(--success); border-color: var(--success); }
    .chip[data-zone='yellow'] { color: var(--warning); border-color: var(--warning); }
    .chip[data-zone='red'] { color: #ff8f93; border-color: #e5484d; }
    .buff { margin-top: 4px; padding: 5px 8px; background: var(--surface-2); border: 1px solid var(--border); font-size: 12px; }
    .buff small { color: var(--muted); }
  `,
})
export class TrainingPanelComponent {
  protected readonly i18n = inject(I18nService);
  readonly player = input.required<Player>();

  protected readonly rings = computed(() => ATTRIBUTE_KEYS.map((key) => {
    const value = this.player().training?.mastery[key] ?? 0;
    return { key, label: SHORT[key], value, dash: `${(value / 100) * RING} ${RING}` };
  }));

  private readonly series = computed(() => {
    const training = this.player().training;
    return [...(training?.load ?? [2, 2, 2, 2]), training?.weekLoad ?? 0];
  });

  protected readonly dots = computed(() => {
    const values = this.series();
    const max = Math.max(6, ...values);
    return values.map((value, index) => ({ x: 12 + (index * 216) / Math.max(1, values.length - 1), y: 62 - (value / max) * 54 }));
  });

  protected readonly curve = computed(() => this.dots().map((point) => `${point.x},${point.y}`).join(' '));
  protected readonly ratioValue = computed(() => acuteChronicRatio(this.player()));
  protected readonly ratio = computed(() => Math.round(this.ratioValue() * 100) / 100);
  protected readonly zone = computed(() => loadZone(this.ratioValue()));
  protected readonly zoneLabel = computed(() => ({ green: this.i18n.pick('Belastung ok', 'Load fine'), yellow: this.i18n.pick('Belastung hoch', 'Load high'), red: this.i18n.pick('Überlastung', 'Overload') })[this.zone()]);

  protected readonly buffs = computed(() => (this.player().training?.buffs ?? []).map((buff) => {
    const drill = getDrill(buff.drillId);
    return { id: buff.drillId, name: drill?.name ?? buff.drillId, text: drill?.buff ? this.i18n.pick(drill.buff.label[0], drill.buff.label[1]) : '' };
  }));
}
