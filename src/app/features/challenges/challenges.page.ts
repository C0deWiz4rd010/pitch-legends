import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PersistentStore } from '../../core/storage/persistent-store';
import { CHALLENGES, ChallengeDefinition, loadChallengeRecords } from '../../core/football/challenges';
import { createPracticeTeams } from '../../core/football/practice';
import { ExhibitionService } from '../../core/services/exhibition.service';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';

/** Training challenges with fixed seeds, local personal bests and medals. Never touch the career. */
@Component({
  selector: 'app-challenges',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="challenges fade-up">
      @if (!gs.hasGame()) { <a routerLink="/" class="back">← {{ text('Hauptmenü', 'Main menu') }}</a> }
      <header><span class="eyebrow">{{ text('TRAININGSPLATZ · FESTE SEEDS', 'TRAINING GROUND · FIXED SEEDS') }}</span><h1>{{ text('HERAUSFORDERUNGEN', 'CHALLENGES') }}</h1></header>
      <div class="grid">
        @for (challenge of challenges; track challenge.id) {
          @let record = records()[challenge.id];
          <article class="card" [attr.data-medal]="record?.medal ?? 'none'">
            <h2>{{ text(challenge.de, challenge.en) }}</h2>
            <p>{{ text(challenge.descriptionDe, challenge.descriptionEn) }}</p>
            <ul class="medals" [attr.aria-label]="text('Medaillen', 'Medals')">
              <li>🥉 {{ challenge.lowerIsBetter ? '≤' : '≥' }} {{ challenge.medals[0] }}</li>
              <li>🥈 {{ challenge.lowerIsBetter ? '≤' : '≥' }} {{ challenge.medals[1] }}</li>
              <li>🥇 {{ challenge.lowerIsBetter ? '≤' : '≥' }} {{ challenge.medals[2] }}</li>
            </ul>
            <p class="best">{{ text('Bestleistung', 'Personal best') }}: <b>{{ record ? record.best + ' ' + text(challenge.unit.de, challenge.unit.en) : '—' }}</b> {{ record?.medal === 'gold' ? '🥇' : record?.medal === 'silver' ? '🥈' : record?.medal === 'bronze' ? '🥉' : '' }}</p>
            <button type="button" class="btn btn--primary" (click)="play(challenge)">▶ {{ text('STARTEN', 'START') }}</button>
          </article>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .challenges { display: flex; flex-direction: column; gap: 14px; max-width: 1100px; margin: 0 auto; padding-bottom: 24px; }
    .back { color: var(--accent-2); font: 11px var(--font-display); }
    .eyebrow { color: var(--accent-2); font: 11px var(--font-display); }
    h1 { margin: 6px 0 0; font: 24px var(--font-display); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
    .card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 2px solid var(--border); background: var(--ink-900); box-shadow: 3px 3px 0 var(--ink-shadow); }
    .card[data-medal="gold"] { border-color: #ffd34e; }
    .card[data-medal="silver"] { border-color: #cfd8e3; }
    .card[data-medal="bronze"] { border-color: #c98a5e; }
    h2 { margin: 0; font: 13px var(--font-display); color: var(--accent-3); }
    p { margin: 0; font-size: 13px; color: var(--text-mute); }
    .medals { list-style: none; margin: 0; padding: 0; display: flex; gap: 10px; font-size: 12px; }
    .best b { color: var(--text); }
    .btn { margin-top: auto; }
  `],
})
export class ChallengesPage {
  private readonly exhibitions = inject(ExhibitionService);
  private readonly router = inject(Router);
  protected readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);
  protected readonly challenges = CHALLENGES;
  protected readonly records = signal(loadChallengeRecords(inject(PersistentStore)));

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }

  protected play(challenge: ChallengeDefinition): void {
    const { home, away } = createPracticeTeams(challenge.seed);
    this.exhibitions.start({
      id: `challenge-${challenge.id}`,
      home, away, controlledTeamId: home.id, seed: challenge.seed,
      title: { de: `Herausforderung · ${challenge.de}`, en: `Challenge · ${challenge.en}` },
      returnUrl: '/challenges', returnLabel: { de: 'Herausforderungen', en: 'Challenges' },
      halfMinutes: 8, autoStart: true, rematch: true, challengeId: challenge.id,
    });
    void this.router.navigateByUrl('/play');
  }
}
