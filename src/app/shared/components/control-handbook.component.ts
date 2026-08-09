import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { CONTROL_BINDINGS, CONTROL_CHAPTERS, ControlBinding, ControlGlyph, HumanInputDevice } from '../../data/control-bindings';
import { I18nService } from '../../core/services/i18n.service';
import { ControlHelpService } from '../../core/services/control-help.service';

@Component({
  selector: 'app-control-handbook',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #handbookDialog class="handbook" aria-labelledby="handbook-title" (close)="help.close(true)" (click)="backdropClick($event)">
      <div class="book-shell">
        <header>
          <div><p>PIXEL COACH</p><h2 id="handbook-title">{{ text('SPIELHANDBUCH', 'GAME HANDBOOK') }}</h2></div>
          <button class="close" (click)="close()" [attr.aria-label]="text('Handbuch schließen', 'Close handbook')">×</button>
        </header>

        <div class="device-tabs" [attr.aria-label]="text('Eingabegerät', 'Input device')">
          @for (device of devices; track device) {
            <button [class.active]="help.device() === device" (click)="help.setDevice(device)">{{ device === 'keyboard' ? text('TASTATUR', 'KEYBOARD') : device === 'gamepad' ? 'GAMEPAD' : 'TOUCH' }}</button>
          }
        </div>

        <nav [attr.aria-label]="text('Kapitel', 'Chapters')">
          @for (chapter of chapters; track chapter.id) {
            <button [class.active]="help.chapter() === chapter.id" (click)="help.chapter.set(chapter.id)">{{ i18n.locale() === 'de' ? chapter.de : chapter.en }}</button>
          }
        </nav>

        @if (help.chapter() === 'pass') {
          <section class="pass-lesson">
            <div class="demo" aria-hidden="true">
              <i class="player one"></i><i class="player two"></i><i class="player three"></i><b class="ball"></b><span class="target-line"></span>
            </div>
            <div>
              <p>{{ text('DAS WICHTIGSTE ZUERST', 'START HERE') }}</p>
              <strong>{{ passHeadline() }}</strong>
              <span>{{ text('Mit dem Stick oder WASD zielst du vor dem Abspiel. Halten lädt die Kraft.', 'Aim with the stick or WASD before passing. Hold to charge power.') }}</span>
            </div>
          </section>
        }

        <main>
          @for (binding of visibleBindings(); track binding.action) {
            <article [class.learned]="help.isCompleted(binding.action)">
              <div class="glyphs">
                @for (glyph of glyphs(binding); track glyph.label) {
                  @if (glyph.asset) { <img [src]="glyph.asset" [alt]="glyph.label" /> }
                  @else { <kbd [attr.data-tone]="glyph.tone ?? null">{{ glyph.label }}</kbd> }
                }
              </div>
              <div><h3>{{ i18n.locale() === 'de' ? binding.title.de : binding.title.en }}</h3><p>{{ i18n.locale() === 'de' ? binding.description.de : binding.description.en }}</p></div>
              <span class="learned-mark">{{ help.isCompleted(binding.action) ? '✓' : '○' }}</span>
            </article>
          }
        </main>

        @if (help.chapter() === 'touch') {
          <section class="touch-layout">
            <div class="stick">+</div>
            <div class="touch-buttons"><i class="y">Y</i><i class="x">X</i><i class="b">B</i><i class="a">A</i><i class="sk">SK</i></div>
            <p>{{ text('Links bewegen und zielen. Rechts passen, schießen, flanken und Skills ausführen. Das grüne A ist dein Kurzpass.', 'Move and aim on the left. Pass, shoot, cross, and use skills on the right. Green A is your short pass.') }}</p>
          </section>
        }

        <footer><span>ESC · {{ text('SCHLIESSEN', 'CLOSE') }}</span><button (click)="close()">{{ text('VERSTANDEN', 'GOT IT') }}</button></footer>
      </div>
    </dialog>
  `,
  styles: [`
    :host { display: contents; }
    .handbook { width: min(920px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); padding: 0; border: 3px solid #ffd34e; color: #f4f4df; background: #080b18; box-shadow: 9px 9px 0 #02030a; overflow: auto; }
    .handbook::backdrop { background: rgba(2,3,10,.88); }
    .book-shell { padding: 18px; background: linear-gradient(135deg, rgba(23,33,68,.5), transparent 45%), #080b18; }
    header { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
    header p { margin: 0 0 5px; color: #39c8ff; font: 7px var(--font-display); } h2 { margin: 0; font-size: 21px; }
    button { cursor: pointer; }.close { width: 36px; height: 36px; border: 2px solid #33415f; color: #f4f4df; background: #11182c; font-size: 21px; }
    .device-tabs { display: flex; justify-content: end; gap: 5px; margin-top: -24px; padding-right: 50px; }.device-tabs button, nav button { padding: 7px 9px; border: 1px solid #33415f; background: #0b1020; color: #95a0bb; font: 6px var(--font-display); }.device-tabs button.active, nav button.active { border-color: #39c8ff; color: #39c8ff; background: #101d35; }
    nav { display: flex; gap: 5px; margin: 17px 0 12px; padding: 8px; border: 1px solid #273451; background: #050713; overflow-x: auto; } nav button { flex: 1 0 auto; }
    .pass-lesson { display: grid; grid-template-columns: 250px 1fr; gap: 18px; align-items: center; min-height: 112px; margin-bottom: 12px; padding: 12px; border: 2px solid #1d7749; background: linear-gradient(90deg, #0e4428, #0a1c19); }
    .pass-lesson p { margin: 0 0 7px; color: #54f28b; font: 7px var(--font-display); }.pass-lesson strong { display: block; color: #fff; font: 11px var(--font-display); line-height: 1.6; }.pass-lesson span { display: block; margin-top: 6px; color: #b7c9c4; font-size: 10px; }
    .demo { position: relative; height: 86px; border: 2px solid #79c28c; background: repeating-linear-gradient(90deg,#176b39 0 35px,#1c7942 35px 70px); overflow: hidden; }.demo::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; border-left: 1px solid rgba(255,255,255,.5); }
    .player { position: absolute; z-index: 2; width: 10px; height: 16px; background: #39c8ff; border: 2px solid #050713; box-shadow: 0 4px #f4f4df; }.player::before { content: ''; position: absolute; left: 1px; top: -7px; width: 6px; height: 6px; background: #c98555; border: 1px solid #050713; }.player.one { left: 28px; top: 38px; }.player.two { right: 35px; top: 16px; }.player.three { right: 29px; bottom: 15px; }
    .ball { position: absolute; z-index: 3; left: 47px; top: 47px; width: 6px; height: 6px; background: #fff; box-shadow: inset 2px 2px #172144; animation: pass-ball 1.7s steps(10) infinite; }.target-line { position: absolute; left: 50px; top: 49px; width: 143px; border-top: 2px dashed rgba(255,255,255,.6); transform: rotate(-12deg); transform-origin: left; }
    @keyframes pass-ball { 65%,100% { transform: translate(142px,-31px); } }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } article { position: relative; display: grid; grid-template-columns: 104px 1fr 20px; gap: 10px; align-items: center; min-height: 86px; padding: 10px; border: 1px solid #273451; background: #0d1222; } article.learned { border-color: rgba(84,242,139,.45); } article h3 { margin: 0 0 5px; font-size: 11px; } article p { margin: 0; color: #9aa7c1; font-size: 10px; line-height: 1.45; }.learned-mark { color: #54f28b; font-size: 15px; }
    .glyphs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }.glyphs img { width: 30px; height: 30px; image-rendering: pixelated; }.glyphs kbd { min-width: 34px; min-height: 29px; display: grid; place-items: center; padding: 2px 5px; border: 2px solid #677797; background: #1b2339; color: #fff; box-shadow: 2px 2px #02030a; font: 7px var(--font-display); }.glyphs kbd[data-tone=green] { background: #14744a; }.glyphs kbd[data-tone=blue] { background: #2459a3; }.glyphs kbd[data-tone=red] { background: #982b4d; }.glyphs kbd[data-tone=yellow] { background: #a5801f; }.glyphs kbd[data-tone=purple] { background: #693389; }
    .touch-layout { display: grid; grid-template-columns: 100px 170px 1fr; gap: 20px; align-items: center; min-height: 150px; padding: 15px; border: 2px solid #33415f; background: #0d1222; }.touch-layout p { color: #b1bdd4; font-size: 11px; line-height: 1.6; }.stick { width: 86px; height: 86px; display: grid; place-items: center; border: 2px solid #677797; border-radius: 50%; color: #39c8ff; font-size: 25px; }.touch-buttons { position: relative; height: 120px; }.touch-buttons i { position: absolute; width: 38px; height: 38px; display: grid; place-items: center; border: 2px solid #fff8; border-radius: 50%; color: #fff; font: normal 8px var(--font-display); }.touch-buttons .y { left: 65px; top: 0; background:#a5801f; }.touch-buttons .x { left:20px; top:38px; background:#2459a3; }.touch-buttons .b { left:110px; top:38px; background:#982b4d; }.touch-buttons .a { left:65px; top:76px; background:#14744a; }.touch-buttons .sk { left:0; top:0; border-radius:0; background:#693389; }
    footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #273451; } footer span { color: #7f8ba5; font: 6px var(--font-display); } footer button { min-height: 38px; padding: 8px 20px; border: 2px solid #baffc8 #197a46 #197a46 #baffc8; background: #38e07b; color:#07190e; font: 8px var(--font-display); }
    @media(max-width:720px){ .device-tabs { margin-top:10px; padding:0; justify-content:start; }.pass-lesson { grid-template-columns:1fr; }.demo { display:none; } main { grid-template-columns:1fr; }.touch-layout { grid-template-columns: 90px 1fr; }.touch-layout p { grid-column:1/-1; } article { grid-template-columns:82px 1fr 18px; }.glyphs img { width:24px;height:24px; } }
    @media(prefers-reduced-motion:reduce){ .ball { animation:none; transform:translate(142px,-31px); } }
  `],
})
export class ControlHandbookComponent {
  protected readonly help = inject(ControlHelpService);
  protected readonly i18n = inject(I18nService);
  protected readonly chapters = CONTROL_CHAPTERS;
  protected readonly devices: readonly HumanInputDevice[] = ['keyboard', 'gamepad', 'touch'];
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('handbookDialog');
  protected readonly visibleBindings = computed(() => {
    const chapter = this.help.chapter();
    return chapter === 'touch' ? CONTROL_BINDINGS : CONTROL_BINDINGS.filter((binding) => binding.chapter === chapter);
  });

  constructor() {
    effect(() => {
      const dialog = this.dialog()?.nativeElement;
      const visible = this.help.visible();
      if (!dialog) return;
      if (visible && !dialog.open) dialog.showModal();
      if (!visible && dialog.open) dialog.close();
    });
  }

  protected glyphs(binding: ControlBinding): readonly ControlGlyph[] {
    return binding[this.help.device()];
  }

  protected passHeadline(): string {
    const device = this.help.device();
    if (device === 'keyboard') return this.text('J DRÜCKEN = KURZPASS · J HALTEN = PASSKRAFT', 'TAP J = SHORT PASS · HOLD J = PASS POWER');
    if (device === 'gamepad') return this.text('A DRÜCKEN/HALTEN = PASSEN', 'TAP/HOLD A = PASS');
    return this.text('GRÜNE A-FLÄCHE = PASSEN', 'GREEN A BUTTON = PASS');
  }

  protected close(): void {
    this.help.close(true);
  }

  protected backdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  protected text(de: string, en: string): string {
    return this.i18n.locale() === 'de' ? de : en;
  }
}
