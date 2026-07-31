import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { TrainingService, TRAINING_DRILLS, TrainingDrill, TrainingOutcome } from '../../core/services/training.service';
import { ratingColor } from '../../shared/rating-color';
import { Player } from '../../models/player.model';

@Component({
  selector: 'app-training',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './training.page.html',
  styleUrl: './training.page.scss',
})
export class TrainingPage {
  protected readonly gs = inject(GameStateService);
  private readonly training = inject(TrainingService);
  protected readonly ratingColor = ratingColor;
  protected readonly drills = TRAINING_DRILLS;

  protected readonly activeDrill = signal<TrainingDrill>(TRAINING_DRILLS[0]);
  protected readonly message = signal<string>('');
  protected readonly lastTrainedId = signal<string | null>(null);

  protected readonly trainingGround = computed(() => this.gs.playerTeam()?.facilities.trainingGround ?? 1);

  protected readonly squad = computed<Player[]>(() =>
    [...this.gs.squad()].sort((a, b) => b.overall - a.overall),
  );

  protected xpPercent(p: Player): number {
    return Math.min(100, Math.round((p.xp / p.xpToNext) * 100));
  }

  protected selectDrill(d: TrainingDrill): void {
    this.activeDrill.set(d);
  }

  protected train(playerId: string): void {
    let outcome: TrainingOutcome | undefined;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const target = club.players.find((p) => p.id === playerId);
      if (target) outcome = this.training.train(target, this.activeDrill(), club.facilities.trainingGround);
    });
    if (outcome) {
      this.message.set(outcome.message);
      this.lastTrainedId.set(playerId);
    }
  }

  protected recover(playerId: string): void {
    const recovery = this.drills.find((d) => d.focus === 'recovery')!;
    let outcome: TrainingOutcome | undefined;
    this.gs.mutate((draft) => {
      const club = draft.teams.find((t) => t.id === draft.clubId)!;
      const target = club.players.find((p) => p.id === playerId);
      if (target) outcome = this.training.train(target, recovery, club.facilities.trainingGround);
    });
    if (outcome) this.message.set(outcome.message);
  }
}
