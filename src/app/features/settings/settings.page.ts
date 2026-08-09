import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { SaveService } from '../../core/services/save.service';
import { SeasonService } from '../../core/services/season.service';
import { GameSettings } from '../../models/game.model';
import { I18nPipe } from '../../shared/i18n.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { RpgService } from '../../core/services/rpg.service';
import { AudioService } from '../../core/services/audio.service';

@Component({
  selector: 'app-settings',
  imports: [I18nPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  protected readonly gs = inject(GameStateService);
  private readonly saves = inject(SaveService);
  private readonly season = inject(SeasonService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly rpg = inject(RpgService);
  private readonly audio = inject(AudioService);

  protected readonly message = signal('');
  protected readonly confirmNew = signal(false);

  protected readonly difficulties: GameSettings['difficulty'][] = ['easy', 'normal', 'hard'];
  protected readonly durations: GameSettings['matchDuration'][] = [3, 5, 8];
  protected readonly assistPresets: GameSettings['assistPreset'][] = ['assisted', 'balanced', 'manual'];
  protected readonly perkPaths = ['coaching', 'tactics', 'scouting', 'leadership'] as const;

  protected setDifficulty(d: GameSettings['difficulty']): void {
    this.gs.mutate((draft) => (draft.settings.difficulty = d));
  }
  protected toggleSound(): void {
    this.gs.mutate((draft) => (draft.settings.soundEnabled = !draft.settings.soundEnabled));
    this.audio.click();
  }

  protected setLocale(locale: GameSettings['locale']): void {
    this.i18n.setLocale(locale);
  }

  protected setDuration(duration: GameSettings['matchDuration']): void {
    this.gs.mutate((draft) => (draft.settings.matchDuration = duration));
  }

  protected setAssistPreset(preset: GameSettings['assistPreset']): void {
    this.gs.mutate((draft) => (draft.settings.assistPreset = preset));
  }

  protected toggleCameraShake(): void {
    this.gs.mutate((draft) => (draft.settings.cameraShake = !draft.settings.cameraShake));
  }

  protected toggleReducedMotion(): void {
    this.gs.mutate((draft) => (draft.settings.reducedMotion = !draft.settings.reducedMotion));
  }

  protected setVolume(kind: 'musicVolume' | 'sfxVolume', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.gs.mutate((draft) => (draft.settings[kind] = Math.max(0, Math.min(1, value))));
    if (kind === 'sfxVolume') this.audio.click();
  }

  protected unlockPerk(path: (typeof this.perkPaths)[number]): void {
    let unlocked = false;
    this.gs.mutate((draft) => (unlocked = this.rpg.unlockManagerPerk(draft.manager, path)));
    this.message.set(this.i18n.t(unlocked ? 'settings.perkUnlocked' : 'settings.noSkillPoint'));
  }
  protected toggleAutosave(): void {
    this.gs.mutate((draft) => (draft.settings.autoSave = !draft.settings.autoSave));
  }

  protected saveNow(): void {
    const g = this.gs.game();
    if (g) {
      this.saves.save(g);
      this.message.set(this.i18n.t('settings.saved'));
    }
  }

  protected exportSave(): void {
    this.gs.exportSave();
    this.message.set(this.i18n.t('settings.exported'));
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
        this.message.set(this.i18n.t('settings.imported'));
      } catch {
        this.message.set(this.i18n.t('settings.importError'));
      }
    };
    reader.readAsText(file);
  }

  protected startNextSeason(): void {
    this.season.startNextSeason();
    this.message.set(this.i18n.t('settings.newSeasonStarted'));
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
