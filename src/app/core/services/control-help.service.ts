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
  private pendingCareer = '';
  private readonly pendingActions = signal<readonly InputAction[]>([]);
  private pendingDevice: HumanInputDevice | null = null;

  private synchronizeCareer(): void {
    const game = this.gs.game();
    const key = game ? `${game.createdAt}:${game.clubId}` : '';
    if (key === this.pendingCareer) return;
    this.pendingCareer = key;
    this.pendingActions.set([]);
    this.pendingDevice = null;
  }

  /** Called at a pause/menu boundary, never from a live simulation tick. */
  flushProgress(): void {
    this.synchronizeCareer();
    if (!this.gs.game() || (!this.pendingActions().length && !this.pendingDevice)) return;
    const actions = this.pendingActions();
    const device = this.pendingDevice;
    this.pendingActions.set([]);
    this.pendingDevice = null;
    this.gs.mutate((draft) => {
      const learning = draft.settings.controlLearning;
      for (const action of actions) if (!learning.completedActions.includes(action)) learning.completedActions.push(action);
      if (device) learning.preferredDevice = device;
    });
  }

  open(chapter: ControlChapter = 'pass'): void {
    this.flushProgress();
    const preferred = this.gs.game()?.settings.controlLearning.preferredDevice;
    if (preferred && preferred !== 'ai') this.device.set(preferred);
    this.chapter.set(chapter);
    this.visible.set(true);
  }

  close(markIntroSeen = false): void {
    this.visible.set(false);
    this.flushProgress();
    if (markIntroSeen && this.gs.game() && !this.gs.game()!.settings.controlLearning.introSeen) this.gs.mutate((draft) => { draft.settings.controlLearning.introSeen = true; });
  }

  setDevice(device: HumanInputDevice): void {
    this.synchronizeCareer();
    this.device.set(device);
    this.pendingDevice = this.gs.game()?.settings.controlLearning.preferredDevice === device ? null : device;
    if (this.visible()) this.flushProgress();
  }

  complete(action: InputAction): void {
    this.synchronizeCareer();
    const learned = this.gs.game()?.settings.controlLearning.completedActions ?? [];
    if (!this.gs.game() || learned.includes(action) || this.pendingActions().includes(action)) return;
    this.pendingActions.update((actions) => [...actions, action]);
  }

  isCompleted(action: InputAction): boolean {
    return this.pendingActions().includes(action) || (this.gs.game()?.settings.controlLearning.completedActions.includes(action) ?? false);
  }
}
