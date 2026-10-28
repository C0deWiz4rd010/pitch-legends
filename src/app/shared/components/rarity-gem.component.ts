import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { dnaOf, rarityKnown } from '../../core/rpg/player-dna';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { RARITY_DEFS } from '../../data/rarity';
import { Player } from '../../models/player.model';

/**
 * A small gem showing the rarity of a player. Foreign players stay a grey "?" until a scouting
 * report exists; the own squad and the academy are always known.
 */
@Component({
  selector: 'app-rarity-gem',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="gem" [attr.data-rarity]="known() ? rarity() : 'unknown'" [attr.title]="label()" [attr.aria-label]="label()" role="img">{{ known() ? '' : '?' }}</span>`,
  styles: `
    :host { display: inline-flex; vertical-align: middle; }
    .gem { display: inline-grid; place-items: center; width: 14px; height: 14px; color: #10131a; font: 700 10px/1 var(--font-pixel, monospace); background: var(--rc); transform: rotate(45deg) scale(.72); border: 1px solid color-mix(in srgb, var(--rc) 60%, #fff); box-shadow: 0 0 6px color-mix(in srgb, var(--rc) 70%, transparent); }
    .gem[data-rarity='common'] { --rc: #8fa3b8; box-shadow: none; }
    .gem[data-rarity='rare'] { --rc: #38b6ff; }
    .gem[data-rarity='epic'] { --rc: #a66bff; }
    .gem[data-rarity='legendary'] { --rc: #ffc83d; }
    .gem[data-rarity='mythic'] { --rc: #ff5fd2; background: conic-gradient(from 0deg, #ff5fd2, #7cf7ff, #ffe86b, #ff5fd2); animation: gem-turn 4s linear infinite; }
    .gem[data-rarity='unknown'] { --rc: #5b6676; box-shadow: none; color: #cdd6e3; }
    .gem[data-rarity='unknown'] { transform: none; border-radius: 50%; }
    @keyframes gem-turn { to { filter: hue-rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .gem { animation: none !important; } }
  `,
})
export class RarityGemComponent {
  private readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);

  readonly player = input.required<Player>();
  /** Show the rarity even without a scouting report (e.g. in a match report). */
  readonly revealed = input(false);

  protected readonly rarity = computed(() => dnaOf(this.player()).rarity);
  protected readonly known = computed(() => {
    if (this.revealed()) return true;
    const game = this.gs.game();
    return !game || rarityKnown(game, this.player());
  });
  protected readonly label = computed(() => {
    if (!this.known()) return this.i18n.pick('Seltenheit unbekannt – Scouting nötig', 'Rarity unknown – scouting needed');
    const [de, en] = RARITY_DEFS[this.rarity()].label;
    return this.i18n.pick(de, en);
  });
}
