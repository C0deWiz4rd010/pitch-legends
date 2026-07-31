import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { SaveService } from '../../core/services/save.service';
import { SeasonService } from '../../core/services/season.service';
import { GameSettings } from '../../models/game.model';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  protected readonly gs = inject(GameStateService);
  private readonly saves = inject(SaveService);
  private readonly season = inject(SeasonService);
  private readonly router = inject(Router);

  protected readonly message = signal('');
  protected readonly confirmNew = signal(false);

  protected readonly difficulties: GameSettings['difficulty'][] = ['easy', 'normal', 'hard'];

  protected setDifficulty(d: GameSettings['difficulty']): void {
    this.gs.mutate((draft) => (draft.settings.difficulty = d));
  }
  protected toggleSound(): void {
    this.gs.mutate((draft) => (draft.settings.soundEnabled = !draft.settings.soundEnabled));
  }
  protected toggleAutosave(): void {
    this.gs.mutate((draft) => (draft.settings.autoSave = !draft.settings.autoSave));
  }

  protected saveNow(): void {
    const g = this.gs.game();
    if (g) {
      this.saves.save(g);
      this.message.set('💾 Game saved.');
    }
  }

  protected exportSave(): void {
    this.gs.exportSave();
    this.message.set('📤 Save exported.');
  }

  protected onImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const state = this.saves.parseImport(String(reader.result));
        this.gs.importState(state);
        this.message.set('📥 Save imported successfully.');
      } catch {
        this.message.set('⚠️ That file could not be read as a save.');
      }
    };
    reader.readAsText(file);
  }

  protected startNextSeason(): void {
    this.season.startNextSeason();
    this.message.set('🎬 A new season has begun!');
    this.router.navigateByUrl('/');
  }

  protected newGame(): void {
    if (!this.confirmNew()) {
      this.confirmNew.set(true);
      return;
    }
    this.gs.deleteGame();
    this.router.navigateByUrl('/');
  }
}
