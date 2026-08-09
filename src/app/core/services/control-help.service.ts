import { Injectable, inject, signal } from '@angular/core';
import { InputAction } from '../../models/game.model';
import { ControlChapter, HumanInputDevice } from '../../data/control-bindings';
import { GameStateService } from './game-state.service';

@Injectable({ providedIn: 'root' })
export class ControlHelpService {
  private readonly gs = inject(GameStateService);
  readonly visible = signal(false);
  readonly chapter = signal<ControlChapter>('pass');
  readonly device = signal<HumanInputDevice>('keyboard');

  open(chapter: ControlChapter = 'pass'): void {
    const preferred = this.gs.game()?.settings.controlLearning.preferredDevice;
    if (preferred && preferred !== 'ai') this.device.set(preferred);
    this.chapter.set(chapter);
    this.visible.set(true);
  }

  close(markIntroSeen = false): void {
    this.visible.set(false);
    if (markIntroSeen) this.gs.mutate((draft) => { draft.settings.controlLearning.introSeen = true; });
  }

  setDevice(device: HumanInputDevice): void {
    this.device.set(device);
    this.gs.mutate((draft) => { draft.settings.controlLearning.preferredDevice = device; });
  }

  complete(action: InputAction): void {
    const learned = this.gs.game()?.settings.controlLearning.completedActions ?? [];
    if (learned.includes(action)) return;
    this.gs.mutate((draft) => {
      if (!draft.settings.controlLearning.completedActions.includes(action)) draft.settings.controlLearning.completedActions.push(action);
    });
  }

  isCompleted(action: InputAction): boolean {
    return this.gs.game()?.settings.controlLearning.completedActions.includes(action) ?? false;
  }
}
