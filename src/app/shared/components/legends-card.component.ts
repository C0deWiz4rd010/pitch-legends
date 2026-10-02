import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LegendsCard } from '../../models/legends.model';
import { I18nService } from '../../core/services/i18n.service';
import { TIER_LABELS, legendsWorld } from '../../core/legends/cards';
import { clubTeam } from '../../core/legends/squad';
import { PlayerPortraitComponent } from './player-portrait.component';

/** A Legends Team player card: tier, rating, position, portrait, club and nation. */
@Component({
  selector: 'app-legends-card',
  imports: [PlayerPortraitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'tier-' + card().tier", '[class.compact]': 'compact()', '[attr.aria-label]': 'label()' },
  template: `
    <div class="top"><b>{{ card().player.overall }}</b><span>{{ card().player.position }}</span></div>
    @if (!compact()) { <app-player-portrait [player]="card().player" [team]="team()" [size]="64" /> }
    <strong>{{ card().player.lastName }}</strong>
    <small>{{ club()?.short }} · {{ nation() }}</small>
    @if (chemistry() !== null) { <i class="chem" [title]="i18n.pick('Chemie', 'Chemistry')">{{ chemistry() }}</i> }
    @if (duplicate()) { <em class="dup">{{ i18n.pick('DOPPELT', 'DUPLICATE') }}</em> }
  `,
  styles: [`
    :host { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; width: 112px; padding: 8px 6px 9px; border: 2px solid var(--tier-edge); background: linear-gradient(160deg, var(--tier-a), var(--tier-b)); color: var(--tier-ink); box-shadow: 3px 3px 0 var(--ink-shadow); text-align: center; }
    :host.compact { width: 92px; padding: 6px 4px; }
    :host.tier-bronze { --tier-a: #b9805a; --tier-b: #6f4328; --tier-edge: #e0a77e; --tier-ink: #fff6ec; }
    :host.tier-silver { --tier-a: #cfd8e3; --tier-b: #7c8796; --tier-edge: #f3f7fb; --tier-ink: #10151f; }
    :host.tier-gold { --tier-a: #ffe07a; --tier-b: #b88a1d; --tier-edge: #fff2b8; --tier-ink: #201703; }
    :host.tier-legend { --tier-a: #c9a6ff; --tier-b: #3b1d78; --tier-edge: #f2e3ff; --tier-ink: #fff; box-shadow: 0 0 0 2px #7d4bd8, 3px 3px 0 var(--ink-shadow); }
    .top { width: 100%; display: flex; justify-content: space-between; align-items: baseline; padding: 0 2px; }
    .top b { font: 18px var(--font-display); }
    .top span { font: 11px var(--font-display); }
    strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    small { font-size: 10px; opacity: .85; }
    .chem { position: absolute; top: -8px; right: -8px; min-width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: var(--on-accent); font: 11px var(--font-display); font-style: normal; }
    .dup { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); padding: 2px 6px; background: var(--danger); color: #fff; font: 10px var(--font-display); font-style: normal; }
  `],
})
export class LegendsCardComponent {
  protected readonly i18n = inject(I18nService);
  readonly card = input.required<LegendsCard>();
  readonly seed = input.required<number>();
  readonly compact = input(false);
  readonly chemistry = input<number | null>(null);
  readonly duplicate = input(false);
  protected readonly club = computed(() => legendsWorld(this.seed()).clubs.find((club) => club.id === this.card().clubId) ?? null);
  protected readonly team = computed(() => { const club = this.club(); return club ? clubTeam(club) : undefined; });
  protected readonly nation = computed(() => this.card().nation.slice(0, 3).toUpperCase());
  protected readonly label = computed(() => {
    const card = this.card();
    const tier = TIER_LABELS[card.tier];
    return `${card.player.firstName} ${card.player.lastName}, ${this.i18n.pick(tier.de, tier.en)} ${card.player.overall}, ${card.player.position}`;
  });
}
