import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/services/i18n.service';
import { LegendsService } from '../../core/services/legends.service';

/** Game modes outside the career. */
@Component({
  selector: 'app-modes',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="modes fade-up">
      <header><span class="eyebrow">{{ text('ALLES OHNE EINFLUSS AUF DEINE KARRIERE', 'NONE OF THIS AFFECTS YOUR CAREER') }}</span><h1>{{ text('SPIELMODI', 'GAME MODES') }}</h1></header>
      <div class="grid">
        <a routerLink="/legends" class="tile legends"><b>LEGENDS TEAM</b><span>{{ text('Karten sammeln, Packs öffnen, Chemie bauen, Division Rivals und Draft.', 'Collect cards, open packs, build chemistry, Division Rivals and Draft.') }}</span><small>{{ legends.hasClub() ? text('Weiterspielen', 'Continue') : text('Verein gründen', 'Found a club') }} ›</small></a>
        <a routerLink="/quick" class="tile"><b>{{ text('SCHNELLSPIEL', 'QUICK MATCH') }}</b><span>{{ text('Zwei Vereine, Stadion, Wetter, Tageszeit, Spieldauer: ein Klick bis zum Anstoß.', 'Two clubs, stadium, weather, time of day, length: one click to kick-off.') }}</span><small>11 v 11 · 5 v 5 ›</small></a>
        <a routerLink="/challenges" class="tile"><b>{{ text('HERAUSFORDERUNGEN', 'CHALLENGES') }}</b><span>{{ text('Parcours, Passen, Abschluss, Freistöße und Elfmeter mit Medaillen und Bestleistungen.', 'Course, passing, finishing, free kicks and penalties with medals and personal bests.') }}</span><small>🥉 🥈 🥇 ›</small></a>
        <a routerLink="/controls" class="tile"><b>{{ text('STEUERUNG', 'CONTROLS') }}</b><span>{{ text('Tasten und Gamepad neu belegen, Touch-Steuerung in Größe und Position anpassen.', 'Rebind keys and gamepad, adjust touch controls in size and position.') }}</span><small>⌨ 🎮 ✋ ›</small></a>
        <a routerLink="/play" class="tile"><b>{{ text('TRAININGSSPIEL', 'PRACTICE MATCH') }}</b><span>{{ text('Sofort losspielen: Harbour Athletic gegen Sunset Rovers.', 'Play right away: Harbour Athletic against Sunset Rovers.') }}</span><small>▶ ›</small></a>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .modes { display: flex; flex-direction: column; gap: 14px; max-width: 1100px; margin: 0 auto; }
    .eyebrow { color: var(--accent-2); font: 11px var(--font-display); }
    h1 { margin: 6px 0 0; font: 24px var(--font-display); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .tile { display: flex; flex-direction: column; gap: 10px; min-height: 170px; padding: 16px; border: 2px solid var(--border); background: var(--ink-900); box-shadow: 4px 4px 0 var(--ink-shadow); color: var(--text); text-decoration: none; }
    .tile:hover, .tile:focus-visible { border-color: var(--accent); }
    .tile.legends { border-color: #c9a6ff; background: linear-gradient(160deg, #24164a, var(--ink-900)); }
    b { font: 14px var(--font-display); color: var(--accent-3); }
    span { color: var(--text-mute); font-size: 13px; }
    small { margin-top: auto; color: var(--accent); font: 11px var(--font-display); }
  `],
})
export class ModesPage {
  private readonly i18n = inject(I18nService);
  protected readonly legends = inject(LegendsService);
  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }
}
