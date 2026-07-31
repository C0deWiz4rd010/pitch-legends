import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { SaveService } from '../../core/services/save.service';
import { Difficulty } from '../../models/game.model';

@Component({
  selector: 'app-start',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start.component.html',
  styleUrl: './start.component.scss',
})
export class StartComponent {
  private readonly gs = inject(GameStateService);
  private readonly saves = inject(SaveService);
  private readonly router = inject(Router);

  readonly managerName = signal('');
  readonly clubName = signal('');
  readonly clubShort = signal('');
  readonly primary = signal('#38e07b');
  readonly secondary = signal('#04240f');
  readonly difficulty = signal<Difficulty>('normal');
  readonly error = signal('');

  readonly hasSave = this.saves.hasSave();

  readonly presets = [
    { primary: '#38e07b', secondary: '#04240f' },
    { primary: '#22d3ee', secondary: '#082f49' },
    { primary: '#f5455c', secondary: '#2a0a12' },
    { primary: '#f5c542', secondary: '#3b1d0e' },
    { primary: '#a855f7', secondary: '#1f0a2e' },
    { primary: '#2563eb', secondary: '#0b1020' },
  ];

  start(): void {
    if (!this.managerName().trim() || !this.clubName().trim()) {
      this.error.set('Please enter a manager and club name.');
      return;
    }
    this.gs.newGame({
      managerName: this.managerName().trim(),
      clubName: this.clubName().trim(),
      clubShort: this.clubShort().trim() || undefined,
      primary: this.primary(),
      secondary: this.secondary(),
      difficulty: this.difficulty(),
    });
    this.router.navigateByUrl('/');
  }

  continueGame(): void {
    if (this.gs.loadFromStorage()) this.router.navigateByUrl('/');
  }

  onImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const state = this.saves.parseImport(String(reader.result));
        this.gs.importState(state);
        this.router.navigateByUrl('/');
      } catch {
        this.error.set('That file could not be read as a Pitch Legends save.');
      }
    };
    reader.readAsText(file);
  }
}
