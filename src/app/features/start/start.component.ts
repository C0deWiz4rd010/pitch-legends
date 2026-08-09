import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { SaveService } from '../../core/services/save.service';
import { Difficulty } from '../../models/game.model';
import { I18nPipe } from '../../shared/i18n.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { MiniKitComponent } from '../../shared/components/mini-kit.component';
import {
  createClubVisualIdentity,
  CREST_EMBLEMS,
  CREST_PATTERNS,
  CREST_SHAPES,
  hash32,
} from '../../core/visual-identity';
import { CrestEmblem, CrestPattern, CrestShape } from '../../models/visual.model';

@Component({
  selector: 'app-start',
  imports: [FormsModule, I18nPipe, ClubCrestComponent, MiniKitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './start.component.html',
  styleUrl: './start.component.scss',
})
export class StartComponent {
  private readonly gs = inject(GameStateService);
  private readonly saves = inject(SaveService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly managerName = signal('');
  readonly clubName = signal('');
  readonly clubShort = signal('');
  readonly primary = signal('#38e07b');
  readonly secondary = signal('#04240f');
  readonly difficulty = signal<Difficulty>('normal');
  readonly error = signal('');
  private readonly visualNonce = signal(0);
  readonly visuals = signal(createClubVisualIdentity('Harbour City', 'HBC', '#38e07b', '#04240f', hash32('pitch-legends-club-studio')));
  readonly crestShapes = CREST_SHAPES;
  readonly crestPatterns = CREST_PATTERNS;
  readonly crestEmblems = CREST_EMBLEMS;

  readonly hasSave = this.saves.hasSave();
  readonly hasLegacySave = this.saves.hasLegacySave();

  readonly presets = [
    { primary: '#38e07b', secondary: '#04240f' },
    { primary: '#22d3ee', secondary: '#082f49' },
    { primary: '#f5455c', secondary: '#2a0a12' },
    { primary: '#f5c542', secondary: '#3b1d0e' },
    { primary: '#a855f7', secondary: '#1f0a2e' },
    { primary: '#2563eb', secondary: '#0b1020' },
  ];

  constructor() {
    effect(() => {
      const name = this.clubName().trim() || 'Harbour City';
      const short = (this.clubShort().trim() || name.slice(0, 3)).toUpperCase();
      const seed = hash32(`${name}|${short}|${this.primary()}|${this.secondary()}|${this.visualNonce()}`);
      this.visuals.set(createClubVisualIdentity(name, short, this.primary(), this.secondary(), seed));
    });
  }

  rollAll(): void {
    this.visualNonce.update((value) => value + 1);
  }

  rollCrest(): void {
    const current = this.visuals();
    const generated = createClubVisualIdentity(
      this.clubName().trim() || 'Harbour City',
      this.clubShort().trim() || 'HBC',
      this.primary(),
      this.secondary(),
      hash32(`${current.seed}|crest`),
    );
    this.visuals.set({ ...current, seed: generated.seed, crest: generated.crest });
  }

  rollKits(): void {
    const current = this.visuals();
    const generated = createClubVisualIdentity(
      this.clubName().trim() || 'Harbour City',
      this.clubShort().trim() || 'HBC',
      this.primary(),
      this.secondary(),
      hash32(`${current.seed}|kits`),
    );
    this.visuals.set({ ...current, seed: generated.seed, kits: generated.kits });
  }

  swapColors(): void {
    const primary = this.primary();
    this.primary.set(this.secondary());
    this.secondary.set(primary);
  }

  selectPalette(primary: string, secondary: string): void {
    this.primary.set(primary);
    this.secondary.set(secondary);
  }

  setCrestShape(shape: CrestShape): void {
    this.visuals.update((visuals) => ({ ...visuals, crest: { ...visuals.crest, shape } }));
  }

  setCrestPattern(pattern: CrestPattern): void {
    this.visuals.update((visuals) => ({ ...visuals, crest: { ...visuals.crest, pattern } }));
  }

  setCrestEmblem(emblem: CrestEmblem): void {
    this.visuals.update((visuals) => ({ ...visuals, crest: { ...visuals.crest, emblem, initials: emblem === 'initials' } }));
  }

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
      locale: this.i18n.locale(),
      visuals: structuredClone(this.visuals()),
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
