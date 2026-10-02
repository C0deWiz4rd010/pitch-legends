import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { CareerService } from '../../core/services/career.service';
import { SCOUT_ASSIGNMENT_COST } from '../../core/career/scouting';
import { locateTransferPlayer } from '../../core/transfer-engine';
import { playerName } from '../../core/ratings';
import { ScoutAssignment } from '../../models/career.model';
import { PlayerPortraitComponent } from '../../shared/components/player-portrait.component';
import { formatCoins, ratingColor } from '../../shared/rating-color';

type AcademyTab = 'intake' | 'scouting';

@Component({
  selector: 'app-academy',
  imports: [RouterLink, PlayerPortraitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './academy.page.html',
  styleUrl: './academy.page.scss',
})
export class AcademyPage {
  protected readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);
  private readonly career = inject(CareerService);
  protected readonly playerName = playerName;
  protected readonly ratingColor = ratingColor;
  protected readonly formatCoins = formatCoins;
  protected readonly scoutCost = SCOUT_ASSIGNMENT_COST;

  protected readonly tab = signal<AcademyTab>('intake');
  protected readonly message = signal('');
  protected readonly regionId = signal('');
  protected readonly group = signal<ScoutAssignment['positionGroup']>('ATT');
  protected readonly groups: ScoutAssignment['positionGroup'][] = ['GK', 'DEF', 'MID', 'ATT'];

  protected readonly prospects = computed(() => this.gs.game()?.academy?.prospects ?? []);
  protected readonly youngsters = computed(() => this.gs.squad().filter((player) => player.age <= 21).sort((a, b) => b.potential - a.potential));
  protected readonly academyLevel = computed(() => this.gs.playerTeam()?.facilities.youthAcademy ?? 1);
  protected readonly regions = computed(() => this.gs.game()?.world.regions ?? []);
  protected readonly assignments = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    return (game.scouting ?? []).map((assignment) => ({
      assignment,
      region: game.world.regions.find((region) => region.id === assignment.regionId)?.name ?? '—',
      players: assignment.playerIds.map((id) => {
        const located = locateTransferPlayer(game, id);
        const report = game.transfers.reports.find((candidate) => candidate.playerId === id);
        return located ? { player: located.player, team: located.team, report } : null;
      }).filter((entry): entry is NonNullable<typeof entry> => !!entry),
    }));
  });

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }

  protected promote(id: string): void {
    const result = this.career.promoteProspect(id);
    this.message.set(result.ok ? this.text('In den Profikader übernommen.', 'Promoted to the first team.') : this.text('Der Kader ist voll (26 Spieler).', 'The squad is full (26 players).'));
  }

  protected release(id: string): void {
    this.career.releaseProspect(id);
    this.message.set(this.text('Talent entlassen.', 'Prospect released.'));
  }

  protected sendScout(): void {
    const region = this.regionId() || this.regions()[0]?.id;
    if (!region) return;
    const result = this.career.startScout(region, this.group());
    const reasons: Record<string, string> = {
      busy: this.text('Es sind schon zwei Scouts unterwegs.', 'Two scouts are already out.'),
      budget: this.text('Nicht genug Budget.', 'Not enough budget.'),
    };
    this.message.set(result.ok ? this.text('Scout ist unterwegs. Der Bericht kommt in wenigen Wochen.', 'Scout dispatched. The report arrives in a few weeks.') : reasons[result.reason ?? ''] ?? this.text('Nicht möglich.', 'Not possible.'));
  }

  protected groupLabel(group: ScoutAssignment['positionGroup']): string {
    const labels = { GK: this.text('Torwart', 'Keeper'), DEF: this.text('Abwehr', 'Defence'), MID: this.text('Mittelfeld', 'Midfield'), ATT: this.text('Angriff', 'Attack') };
    return labels[group];
  }
}
