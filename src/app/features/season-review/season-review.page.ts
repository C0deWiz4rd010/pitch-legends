import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { SeasonService } from '../../core/services/season.service';
import { buildSeasonReview } from '../../core/career/season-review';
import { cupProgress, CUP_ROUND_LABELS } from '../../core/career/cup';
import { SeasonAward } from '../../models/career.model';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { objectiveLabel } from '../../shared/objective-labels';
import { playerName } from '../../core/ratings';

@Component({
  selector: 'app-season-review',
  imports: [RouterLink, ClubCrestComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './season-review.page.html',
  styleUrl: './season-review.page.scss',
})
export class SeasonReviewPage {
  protected readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);
  private readonly season = inject(SeasonService);
  private readonly router = inject(Router);
  protected readonly playerName = playerName;

  protected readonly review = computed(() => {
    const game = this.gs.game();
    return game && this.gs.seasonOver() ? buildSeasonReview(game) : null;
  });
  protected readonly offerId = computed(() => {
    const game = this.gs.game();
    return game && this.review()?.board.sacked ? this.season.jobOfferFor(game) : null;
  });
  protected readonly cupResult = computed(() => {
    const game = this.gs.game();
    const progress = game ? cupProgress(game.cup, game.clubId) : null;
    return progress ? this.text(CUP_ROUND_LABELS[progress].de, CUP_ROUND_LABELS[progress].en) : '—';
  });

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }
  protected team(id: string | null) { return id ? this.gs.teamById(id) ?? null : null; }
  protected objective = (objective: Parameters<typeof objectiveLabel>[0]) => objectiveLabel(objective, (de, en) => this.text(de, en));
  protected awardLabel(award: SeasonAward): string {
    const labels = {
      player: this.text('SPIELER DER SAISON', 'PLAYER OF THE SEASON'),
      scorer: this.text('TORSCHÜTZENKÖNIG', 'GOLDEN BOOT'),
      talent: this.text('TALENT DER SAISON', 'YOUNG PLAYER'),
      keeper: this.text('BESTER TORWART', 'BEST KEEPER'),
    };
    return labels[award.key];
  }
  protected awardValue(award: SeasonAward): string {
    if (award.key === 'scorer') return this.text(`${award.value} Tore`, `${award.value} goals`);
    if (award.key === 'keeper') return this.text(`${award.value} weiße Westen`, `${award.value} clean sheets`);
    return `Ø ${award.value.toFixed(2)}`;
  }

  protected async start(): Promise<void> {
    this.season.startNextSeason(this.offerId() ?? undefined);
    await this.router.navigateByUrl('/');
  }
}
