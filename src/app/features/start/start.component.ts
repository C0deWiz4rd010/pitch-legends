import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { SaveService } from '../../core/services/save.service';
import { Difficulty, ManagerProfile, TacticalPhilosophy } from '../../models/game.model';
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
  createManagerVisualIdentity,
} from '../../core/visual-identity';
import { CrestEmblem, CrestPattern, CrestShape } from '../../models/visual.model';
import { generatePersonName, generateWorld } from '../../data/world-generator';
import { ManagerPortraitComponent } from '../../shared/components/manager-portrait.component';

@Component({
  selector: 'app-start',
  imports: [FormsModule, RouterLink, I18nPipe, ClubCrestComponent, MiniKitComponent, ManagerPortraitComponent],
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
  readonly worldSeed = signal(Math.floor(Math.random() * 0x7fffffff));
  readonly managerPhilosophy = signal<TacticalPhilosophy>('balanced');
  readonly error = signal('');
  private readonly visualNonce = signal(0);
  readonly visuals = signal(createClubVisualIdentity('Harbour City', 'HBC', '#38e07b', '#04240f', hash32('pitch-legends-club-studio')));
  readonly crestShapes = CREST_SHAPES;
  readonly crestPatterns = CREST_PATTERNS;
  readonly crestEmblems = CREST_EMBLEMS;
  readonly philosophies: TacticalPhilosophy[] = ['balanced', 'possession', 'gegenpress', 'counter', 'low-block'];
  readonly managerPreview = computed<ManagerProfile>(() => {
    const generated = generatePersonName(this.worldSeed(), 'player-manager');
    const parts = this.managerName().trim().split(/\s+/).filter(Boolean);
    const id = `manager-preview-${this.worldSeed()}`;
    return {
      id, clubId: 'preview', firstName: parts[0] ?? generated.firstName, lastName: parts.slice(1).join(' ') || generated.lastName,
      age: 42, nationality: generated.nationality, visuals: createManagerVisualIdentity(id, this.primary()),
      attributes: { coaching: 55, tactics: 55, scouting: 55, leadership: 55, negotiation: 55, youthDevelopment: 55 },
      tacticalPhilosophy: this.managerPhilosophy(), recruitmentPhilosophy: 'value', preferredFormation: '4-3-3', traits: ['motivator', 'analyst'],
      level: 1, xp: 0, xpToNext: 250, skillPoints: 0, perks: {},
    };
  });

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

  rollWorld(): void {
    this.worldSeed.set(Math.floor(Math.random() * 0x7fffffff));
  }

  rollManager(): void {
    const person = generatePersonName(this.worldSeed(), `player-manager-${this.visualNonce()}`);
    this.managerName.set(`${person.firstName} ${person.lastName}`);
    this.visualNonce.update((value) => value + 1);
  }

  rollEverything(): void {
    this.rollWorld();
    const blueprint = generateWorld(this.worldSeed(), Array.from({ length: 12 }, (_, index) => `preview-${index}`), 'Legends FC');
    const city = blueprint.world.cities[0];
    this.clubName.set(`${city.name} Athletic`);
    this.clubShort.set(city.name.slice(0, 3).toUpperCase());
    this.rollManager();
    this.selectPalette(this.presets[this.worldSeed() % this.presets.length].primary, this.presets[this.worldSeed() % this.presets.length].secondary);
    this.managerPhilosophy.set(this.philosophies[this.worldSeed() % this.philosophies.length]);
  }

  copySeed(): void {
    void navigator.clipboard?.writeText(String(this.worldSeed()));
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
      seed: this.worldSeed(),
      managerPhilosophy: this.managerPhilosophy(),
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
