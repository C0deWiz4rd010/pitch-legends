import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as THREE from 'three';
import { createPracticeTeams } from '../../core/football/practice';
import { createPlayerVisualIdentity } from '../../core/visual-identity';
import { PortraitService } from '../../core/services/portrait.service';
import { I18nService } from '../../core/services/i18n.service';
import { PlayerActionState, PlayerRuntimeSnapshot } from '../../models/match.model';
import { createAppearanceRecipe, createProceduralFootballer, measureFootSlide, poseFootballer, ProceduralFootballer } from './three-player.factory';
import { clipsEnabled, loadClipSet, setClipsEnabled } from './animation/clip-store';
import { ACTION_CONTACT_TICKS } from '../../core/football/action-timing';
import { checkPose, checkWeights } from './animation/rig-check';

/** Where the studio puts the ball for an action with a contact: height, distance in front of the figure, and the kind of contact. */
const STUDIO_CONTACTS: Partial<Record<PlayerActionState, { z: number; y: number; kind: 'foot' | 'head' }>> = {
  pass: { z: .11, y: .56, kind: 'foot' }, 'through-pass': { z: .11, y: .56, kind: 'foot' }, lob: { z: .11, y: .56, kind: 'foot' },
  shot: { z: .11, y: .56, kind: 'foot' }, 'low-shot': { z: .11, y: .56, kind: 'foot' }, 'finesse-shot': { z: .11, y: .56, kind: 'foot' },
  'chip-shot': { z: .11, y: .56, kind: 'foot' }, volley: { z: .85, y: .62, kind: 'foot' }, 'side-volley': { z: 1.15, y: .6, kind: 'foot' },
  'bicycle-kick': { z: 2.0, y: .12, kind: 'foot' }, 'flying-header': { z: 1.0, y: .78, kind: 'head' },
};

type MoveGroup = 'basics' | 'attack' | 'duel' | 'keeper';
interface Move { value: PlayerActionState; de: string; en: string; group: MoveGroup }

const MOVE_GROUPS: { id: MoveGroup; de: string; en: string }[] = [
  { id: 'basics', de: 'Laufen & Jubel', en: 'Running & joy' },
  { id: 'attack', de: 'Pass & Abschluss', en: 'Passing & finishing' },
  { id: 'duel', de: 'Ballkontrolle & Zweikampf', en: 'Control & duels' },
  { id: 'keeper', de: 'Torwart', en: 'Goalkeeper' },
];

const MOVES: Move[] = [
  { value: 'idle', de: 'Bereit', en: 'Ready', group: 'basics' }, { value: 'jog', de: 'Joggen', en: 'Jog', group: 'basics' },
  { value: 'sprint', de: 'Sprinten', en: 'Sprint', group: 'basics' }, { value: 'celebrate', de: 'Torjubel', en: 'Celebration', group: 'basics' },
  { value: 'pass', de: 'Kurzpass', en: 'Short pass', group: 'attack' }, { value: 'lob', de: 'Flanke', en: 'Cross', group: 'attack' },
  { value: 'shot', de: 'Kraftschuss', en: 'Power shot', group: 'attack' }, { value: 'finesse-shot', de: 'Schlenzer', en: 'Finesse shot', group: 'attack' },
  { value: 'fake-shot', de: 'Schussfinte', en: 'Fake shot', group: 'attack' }, { value: 'header', de: 'Kopfball', en: 'Header', group: 'attack' },
  { value: 'volley', de: 'Volley', en: 'Volley', group: 'attack' }, { value: 'side-volley', de: 'Seitvolley', en: 'Side volley', group: 'attack' },
  { value: 'bicycle-kick', de: 'Fallrückzieher', en: 'Bicycle kick', group: 'attack' }, { value: 'flying-header', de: 'Flugkopfball', en: 'Diving header', group: 'attack' },
  { value: 'ball-roll', de: 'Sohlenrolle', en: 'Ball roll', group: 'duel' }, { value: 'drag-back', de: 'Zurückziehen', en: 'Drag back', group: 'duel' },
  { value: 'heavy-touch', de: 'Schwere Annahme', en: 'Heavy touch', group: 'duel' }, { value: 'jockey', de: 'Abschirmen', en: 'Shield', group: 'duel' },
  { value: 'standing-tackle', de: 'Zweikampf', en: 'Tackle', group: 'duel' }, { value: 'slide', de: 'Grätsche', en: 'Slide tackle', group: 'duel' },
  { value: 'stumble', de: 'Stolpern', en: 'Stumble', group: 'duel' }, { value: 'wall-jump', de: 'Mauersprung', en: 'Wall jump', group: 'duel' },
  { value: 'keeper-ready', de: 'Grundstellung', en: 'Set position', group: 'keeper' }, { value: 'keeper-catch', de: 'Fangen', en: 'Catch', group: 'keeper' },
  { value: 'keeper-dive', de: 'Hechten', en: 'Dive', group: 'keeper' }, { value: 'keeper-parry', de: 'Abwehren', en: 'Parry', group: 'keeper' },
  { value: 'keeper-punch', de: 'Fausten', en: 'Punch', group: 'keeper' }, { value: 'keeper-smother', de: 'Abtauchen', en: 'Smother', group: 'keeper' },
  { value: 'keeper-throw', de: 'Abwerfen', en: 'Throw', group: 'keeper' },
];

const SPEEDS: { value: number; de: string; en: string }[] = [
  { value: 1, de: 'Normal', en: 'Normal' }, { value: 0.25, de: 'Zeitlupe ¼', en: 'Slow ¼' }, { value: 0.1, de: 'Kontaktstudie ⅒', en: 'Contact study ⅒' },
];

@Component({
  selector: 'app-player-lab', imports: [FormsModule, RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="bar">
      <a routerLink="/">← {{ i18n.pick('Start', 'Home') }}</a>
      <span class="brand">{{ i18n.pick('Spielerwerkstatt', 'Player studio') }}</span>
      <a routerLink="/play" class="cta">{{ i18n.pick('Auf den Platz', 'To the pitch') }} →</a>
    </header>
    <main>
      <section class="stage">
        <div class="title"><span class="kicker">{{ i18n.pick('128 Gesichter · ein Baukasten', '128 faces · one construction kit') }}</span><h1>{{ i18n.pick('Jeder Spieler ein Original.', 'Every player an original.') }}</h1></div>
        <canvas #stage role="img" [attr.aria-label]="i18n.pick('Animierte 3D-Spieleransicht', 'Animated 3D player view')" (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)" (pointerup)="dragEnd($event)" (pointercancel)="dragEnd($event)"></canvas>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <div class="card">
          @if (portrait()) { <img [src]="portrait()" [alt]="i18n.pick('Portrait der ausgewählten Spielfigur', 'Portrait of the selected figure')" /> }
          <div>
            <strong>{{ i18n.pick('Spieler', 'Player') }} {{ seed() + 1 }}</strong>
            <ul>
              <li>{{ recipe().height.toFixed(2) }} m</li>
              <li>{{ buildLabel() }}</li>
              <li>{{ footLabel() }}</li>
              <li>#{{ player().kitNumber }}</li>
            </ul>
          </div>
        </div>
        <p class="hint">{{ i18n.pick('Ziehen dreht die Figur', 'Drag to turn the figure') }}</p>
        <button class="zoom" [attr.aria-pressed]="closeUp()" (click)="closeUp.set(!closeUp())">{{ closeUp() ? i18n.pick('Ganze Figur', 'Whole figure') : i18n.pick('Nahaufnahme', 'Close-up') }}</button>
        <div class="transport">
          <button class="play" (click)="paused.set(!paused())">{{ paused() ? '▶ ' + i18n.pick('Abspielen', 'Play') : 'Ⅱ ' + i18n.pick('Pause', 'Pause') }}</button>
          <label class="scrub"><span>{{ moveLabel() }} · {{ cursor().toFixed(2) }} s</span><input [attr.aria-label]="i18n.pick('Bewegungsablauf', 'Timeline')" type="range" min="0" max="2.19" step=".01" [ngModel]="cursor()" (ngModelChange)="seek(+$event)" /></label>
          <div class="speed" role="group" [attr.aria-label]="i18n.pick('Tempo', 'Speed')">
            @for (speed of speeds; track speed.value) { <button [attr.aria-pressed]="timeScale() === speed.value" (click)="timeScale.set(speed.value)">{{ i18n.pick(speed.de, speed.en) }}</button> }
          </div>
          <label class="turn"><span>{{ i18n.pick('Ansicht', 'View') }}</span><input [attr.aria-label]="i18n.pick('Ansicht drehen', 'Turn the view')" type="range" min="-180" max="180" [ngModel]="rotation()" (ngModelChange)="rotation.set(+$event)" /></label>
        </div>
      </section>
      <aside>
        <section>
          <div class="head">
            <h2>{{ i18n.pick('Wer steht im Studio?', 'Who is in the studio?') }}</h2>
            <button [disabled]="galleryPage() === 0" (click)="galleryPage.set(galleryPage() - 1)" [attr.aria-label]="i18n.pick('Vorherige Identitäten', 'Previous identities')">←</button>
            <span class="page">{{ galleryPage() + 1 }} / 8</span>
            <button [disabled]="galleryPage() === 7" (click)="galleryPage.set(galleryPage() + 1)" [attr.aria-label]="i18n.pick('Nächste Identitäten', 'Next identities')">→</button>
          </div>
          <div class="gallery">@for (entry of gallery(); track entry.seed) { <button [class.active]="entry.seed === seed()" (click)="selectSeed(entry.seed)" [attr.aria-label]="i18n.pick('Spieler', 'Player') + ' ' + (entry.seed + 1)">@if (entry.src) { <img [src]="entry.src" alt="" /> }<span>{{ entry.seed + 1 }}</span></button> }</div>
          <button class="wide" (click)="randomSeed()">{{ i18n.pick('Überrasch mich', 'Surprise me') }} ↗</button>
        </section>
        <section>
          <h2>{{ i18n.pick('Trikot', 'Kit') }}</h2>
          <div class="kits" role="group" [attr.aria-label]="i18n.pick('Trikot', 'Kit')">
            <button [attr.aria-pressed]="!awayKit()" (click)="awayKit.set(false)"><i [style.background]="teams.home.visuals.kits.home.shirt"></i>Harbour · {{ i18n.pick('Heim', 'Home') }}</button>
            <button [attr.aria-pressed]="awayKit()" (click)="awayKit.set(true)"><i [style.background]="teams.away.visuals.kits.home.shirt"></i>Sunset · {{ i18n.pick('Auswärts', 'Away') }}</button>
          </div>
        </section>
        <section>
          <h2>{{ i18n.pick('Bewegung', 'Motion') }}</h2>
          @for (group of groups; track group.id) {
            <h3>{{ i18n.pick(group.de, group.en) }}</h3>
            <div class="chips" role="group" [attr.aria-label]="i18n.pick(group.de, group.en)">
              @for (move of movesIn(group.id); track move.value) { <button [attr.aria-pressed]="action() === move.value" (click)="action.set(move.value)">{{ i18n.pick(move.de, move.en) }}</button> }
            </div>
          }
        </section>
        <details>
          <summary>{{ i18n.pick('Animationswerkzeuge', 'Animation tools') }}</summary>
          <label class="field">{{ i18n.pick('Spieler-Seed', 'Player seed') }} <input type="number" min="0" max="127" [ngModel]="seed()" (ngModelChange)="selectSeed($event)" /></label>
          <label class="check"><input type="checkbox" [ngModel]="skeletonVisible()" (ngModelChange)="skeletonVisible.set($event)" /> {{ i18n.pick('Skelett zeigen', 'Show skeleton') }}</label>
          <label class="check"><input type="checkbox" [ngModel]="contactsVisible()" (ngModelChange)="contactsVisible.set($event)" /> {{ i18n.pick('Kontaktpunkt zeigen', 'Show contact point') }}</label>
          <label class="check"><input type="checkbox" [ngModel]="clipsOn()" (ngModelChange)="setClips($event)" /> {{ i18n.pick('Aufgenommene Clips', 'Recorded clips') }}</label>
          <label class="check"><input type="checkbox" [ngModel]="limp()" (ngModelChange)="limp.set($event)" /> {{ i18n.pick('Humpeln (verletzt)', 'Limp (injured)') }}</label>
          @if (slideCm() !== null) { <p class="slide" [class.bad]="slideCm()! > 3" data-testid="foot-slide">{{ i18n.pick('Fußrutschen', 'Foot slide') }}: {{ slideCm()!.toFixed(1) }} cm / 5 cm @if (slideCm()! > 3) { <strong>· {{ i18n.pick('zu viel', 'too much') }}</strong> } @else { <span>· {{ i18n.pick('Fuß haftet', 'foot holds') }}</span> }</p> }
          <p>{{ i18n.pick('Rezept', 'Recipe') }} v{{ recipe().version }} · Seed {{ recipe().seed }}</p>
          <button (click)="checkAllRigs()">{{ i18n.pick('Alle 128 Gelenke prüfen', 'Check all 128 rigs') }}</button>
          @if (rigStatus()) { <p data-testid="rig-status">{{ rigStatus() }}</p> }
        </details>
      </aside>
    </main>`,
  styles: [`
    :host { --ink:#eef3e9; --muted:#9db6bd; --line:#24414d; --panel:#0c1f29; --raise:#143340; --accent:#7cebc4; --gold:#f1c878;
      display:grid; grid-template-rows:auto minmax(0,1fr); height:100dvh; background:#06131a; color:var(--ink); font-family:system-ui,'Segoe UI',sans-serif; }
    h1, h2, h3 { font-family:inherit; text-transform:none; text-shadow:none; }
    .bar { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.7rem 1.5rem; border-bottom:1px solid var(--line); font-size:.85rem; }
    .bar a { color:var(--accent); text-decoration:none; } .brand { font-weight:700; letter-spacing:.14em; text-transform:uppercase; font-size:.75rem; color:var(--muted); }
    .bar .cta { background:var(--accent); color:#06231c; font-weight:700; padding:.45rem .9rem; border-radius:999px; }
    main { display:grid; grid-template-columns:minmax(0,1fr) minmax(340px,420px); min-height:0; }
    .stage { position:relative; min-height:0; overflow:hidden;
      background:radial-gradient(ellipse 60% 55% at 50% 42%,#2a5a6c 0%,#123040 45%,#06131a 100%); }
    .stage::after { content:''; position:absolute; inset:auto 0 0 0; height:38%; background:linear-gradient(#06131a00,#06131acc); pointer-events:none; }
    canvas { position:absolute; inset:0; width:100%; height:100%; display:block; cursor:grab; touch-action:pan-y; } canvas:active { cursor:grabbing; }
    .title { position:absolute; top:1.4rem; left:1.6rem; max-width:17rem; pointer-events:none; z-index:1; }
    .kicker { display:block; font-size:.7rem; color:var(--accent); letter-spacing:.14em; text-transform:uppercase; font-weight:600; }
    h1 { font-size:clamp(1.5rem,2.3vw,2.2rem); font-weight:800; letter-spacing:-.03em; line-height:1.08; margin:.5rem 0 0; }
    .card { position:absolute; z-index:2; top:1.4rem; right:1.4rem; max-width:17rem; display:flex; align-items:center; gap:.8rem; padding:.6rem .9rem .6rem .6rem; background:#0c1f29d9; border:1px solid var(--line); border-radius:14px; backdrop-filter:blur(6px); }
    .card img { width:64px; height:64px; border-radius:50%; border:2px solid var(--accent); background:#143340; }
    .card strong { font-size:1rem; letter-spacing:.02em; } .card ul { display:flex; flex-wrap:wrap; gap:.3rem; margin:.35rem 0 0; padding:0; list-style:none; max-width:13rem; }
    .card li { font-size:.7rem; color:var(--muted); background:var(--raise); border-radius:999px; padding:.15rem .5rem; }
    .hint { position:absolute; z-index:2; left:50%; bottom:7.4rem; transform:translateX(-50%); margin:0; font-size:.7rem; color:var(--muted); pointer-events:none; }
    .zoom { position:absolute; z-index:2; left:1.6rem; top:7.2rem; border-radius:999px; }
    .error { position:absolute; inset:40% 2rem auto; text-align:center; color:#ffd0c4; }
    .transport { position:absolute; z-index:2; left:1.2rem; right:1.2rem; bottom:1.1rem; display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:.6rem 1rem; padding:.7rem .9rem; background:#0c1f29e6; border:1px solid var(--line); border-radius:14px; }
    .transport label { display:grid; gap:.25rem; font-size:.7rem; color:var(--muted); min-width:0; } .turn { grid-template-columns:auto minmax(0,1fr); align-items:center; gap:.6rem; }
    input[type=range] { width:100%; accent-color:var(--accent); margin:0; }
    button { font:inherit; font-size:.8rem; color:var(--ink); background:var(--raise); border:1px solid var(--line); border-radius:9px; padding:.45rem .7rem; cursor:pointer; transition:border-color .15s, background .15s; }
    button:hover { border-color:var(--accent); } button:disabled { opacity:.35; cursor:default; }
    button[aria-pressed=true] { background:var(--accent); border-color:var(--accent); color:#06231c; font-weight:700; }
    :focus-visible { outline:2px solid var(--gold); outline-offset:2px; }
    .play { min-width:6.4rem; font-weight:700; } .speed { display:flex; } .speed button { border-radius:0; margin-left:-1px; white-space:nowrap; font-family:inherit; letter-spacing:0; text-transform:none; }
    .speed button:first-child { border-radius:9px 0 0 9px; margin-left:0; } .speed button:last-child { border-radius:0 9px 9px 0; }
    aside { overflow-y:auto; padding:1.1rem 1.3rem 2rem; background:var(--panel); border-left:1px solid var(--line); }
    aside section { padding-bottom:1.1rem; margin-bottom:1.1rem; border-bottom:1px solid var(--line); }
    h2 { font-size:.95rem; font-weight:700; margin:0 0 .7rem; letter-spacing:0; } h3 { font-size:.68rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.1em; margin:.9rem 0 .4rem; }
    .head { display:flex; align-items:center; gap:.4rem; margin-bottom:.7rem; } .head h2 { margin:0 auto 0 0; } .page { font-size:.72rem; color:var(--muted); min-width:2.6rem; text-align:center; }
    .gallery { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.45rem; }
    .gallery button { position:relative; padding:0; aspect-ratio:1; overflow:hidden; border-radius:12px; background:#143340; }
    .gallery img { width:100%; height:100%; object-fit:cover; display:block; } .gallery span { position:absolute; left:.3rem; bottom:.25rem; font-size:.62rem; color:var(--ink); background:#06131ab3; border-radius:999px; padding:.05rem .35rem; }
    .gallery .active { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent); }
    .wide { width:100%; margin-top:.7rem; } .kits { display:grid; grid-template-columns:1fr 1fr; gap:.5rem; } .kits button { display:flex; align-items:center; gap:.5rem; text-align:left; }
    .kits i { width:1rem; height:1rem; border-radius:50%; border:2px solid #ffffff55; flex:none; }
    .chips { display:flex; flex-wrap:wrap; gap:.35rem; } .chips button { border-radius:999px; padding:.35rem .7rem; }
    details { font-size:.8rem; color:var(--muted); } summary { cursor:pointer; color:var(--ink); font-weight:600; padding:.3rem 0; }
    .field { display:grid; gap:.3rem; margin:.7rem 0; font-size:.75rem; } .field input { background:#06131a; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:.45rem .6rem; font:inherit; width:7rem; }
    .check { display:flex; align-items:center; gap:.5rem; margin:.45rem 0; } p { font-size:.78rem; line-height:1.5; color:var(--muted); } .slide.bad strong { color:#ffb199; }
    @media (max-width:900px) {
      :host { height:auto; min-height:100dvh; display:block; } main { display:block; } .stage { height:62dvh; min-height:420px; }
      .title { max-width:11rem; left:1rem; top:1rem; } h1 { font-size:1.3rem; } .card { right:.8rem; top:.8rem; padding:.4rem .6rem .4rem .4rem; } .card img { width:44px; height:44px; } .card ul { display:none; }
      .transport { left:.6rem; right:.6rem; bottom:.6rem; } .transport .turn { display:none; } .zoom { left:1rem; top:5.6rem; } .speed { grid-column:1 / -1; } .speed button { flex:1; } .hint { display:none; }
      aside { border-left:0; overflow:visible; }
    }
  `],
})
export class PlayerLabPage implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly portraits = inject(PortraitService);
  protected readonly i18n = inject(I18nService);
  private readonly stage = viewChild.required<ElementRef<HTMLCanvasElement>>('stage');
  protected readonly teams = createPracticeTeams();
  protected readonly groups = MOVE_GROUPS;
  protected readonly speeds = SPEEDS;
  readonly seed = signal(0);
  readonly awayKit = signal(false);
  readonly rotation = signal(-20);
  readonly paused = signal(false);
  /** The camera moves in on the head and shoulders. */
  readonly closeUp = signal(false);
  readonly timeScale = signal(1);
  readonly cursor = signal(0);
  readonly action = signal<PlayerActionState>('jog');
  readonly skeletonVisible = signal(false);
  readonly clipsOn = signal(clipsEnabled());
  protected setClips(value: boolean): void { setClipsEnabled(value); this.clipsOn.set(value); }
  readonly contactsVisible = signal(false);
  readonly limp = signal(false);
  /** Drift of a planted foot for the current gait, in cm per 5 cm of travel; null when the motion is not a gait. */
  readonly slideCm = signal<number | null>(null);
  readonly rigStatus = signal('');
  readonly galleryPage = signal(0);
  readonly error = signal('');
  readonly portrait = signal('');
  readonly gallery = signal<{ seed: number; src: string }[]>([]);
  readonly player = computed(() => this.playerFor(this.seed()));
  readonly recipe = computed(() => createAppearanceRecipe(this.player().visuals));
  readonly kit = computed(() => this.awayKit() ? this.teams.away.visuals.kits.home : this.teams.home.visuals.kits.home);
  /** Goalkeepers wear gloves and their own kit: the figure is rebuilt when the motion changes sides. */
  private readonly keeper = computed(() => this.action().startsWith('keeper-'));
  protected readonly moveLabel = computed(() => { const move = MOVES.find((entry) => entry.value === this.action()); return move ? this.i18n.pick(move.de, move.en) : ''; });
  protected readonly buildLabel = computed(() => {
    const build = this.recipe().identity.bodyBuild;
    return build === 'strong' ? this.i18n.pick('kräftig', 'strong') : build === 'slim' ? this.i18n.pick('schlank', 'slim') : this.i18n.pick('athletisch', 'athletic');
  });
  protected readonly footLabel = computed(() => {
    const foot = this.player().foot;
    return foot === 'Left' ? this.i18n.pick('Linksfuß', 'Left-footed') : foot === 'Both' ? this.i18n.pick('Beidfüßig', 'Two-footed') : this.i18n.pick('Rechtsfuß', 'Right-footed');
  });
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(29, 1, .1, 40);
  private model?: ProceduralFootballer;
  private skeleton?: THREE.SkeletonHelper;
  private observer?: ResizeObserver;
  private raf = 0;
  private elapsed = 0;
  private last = 0;
  private distance = 0;
  private aspect = 1;
  private drag: { pointer: number; x: number; rotation: number } | null = null;
  private readonly headPosition = new THREE.Vector3();
  private readonly marker = new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),new THREE.MeshBasicMaterial({color:'#ffcb69',wireframe:true,depthTest:false}));
  private readonly ball = new THREE.Mesh(new THREE.IcosahedronGeometry(.11,1),new THREE.MeshStandardMaterial({color:'#f7edd8',roughness:.8}));
  private disposed = false;
  constructor() {
    effect((cleanup) => {
      const player = this.player(), kit = this.kit();
      this.keeper();
      const request=new AbortController();
      let active = true; cleanup(() => { active = false; request.abort(); });
      if (this.renderer) this.replaceModel();
      void this.portraits.portrait(player, { ...this.teams.home, visuals: { ...this.teams.home.visuals, kits: { ...this.teams.home.visuals.kits, home: kit } } }, request.signal).then(src => { if (active) this.portrait.set(src); });
    });
    effect(() => {
      // The foot-slide readout follows the shown gait and figure.
      const action = this.action();
      this.player();
      if (action !== 'jog' && action !== 'sprint') { this.slideCm.set(null); return; }
      queueMicrotask(() => this.measureSlide());
    });
    effect((cleanup) => {
      const offset = this.galleryPage() * 16;
      const request=new AbortController();
      let active = true; cleanup(() => { active = false; request.abort(); });
      this.gallery.set(Array.from({length:16},(_,i) => ({seed:offset+i,src:''})));
      for (let i=0;i<16;i++) {
        const seed=offset+i;
        void this.portraits.portrait(this.playerFor(seed),this.teams.home,request.signal).then(src => {
          if (active) this.gallery.update(rows => rows.map(row => row.seed === seed ? {...row,src} : row));
        });
      }
    });
  }
  protected movesIn(group: MoveGroup): Move[] { return MOVES.filter((move) => move.group === group); }
  selectSeed(value: number): void {
    const seed = Math.max(0,Math.min(127,Math.trunc(Number(value)||0)));
    this.seed.set(seed);
    this.galleryPage.set(Math.floor(seed / 16));
  }
  /** A fixed stride through the 128 identities visits every one of them before it repeats. */
  protected randomSeed(): void { this.selectSeed((this.seed() + 37) % 128); }
  private playerFor(seed: number) { return {...this.teams.home.players.find(player => player.positionGroup !== 'GK')!,id:`studio-${seed}`,kitNumber:seed%99+1,visuals:createPlayerVisualIdentity(`studio-${seed}`)}; }

  protected dragStart(event: PointerEvent): void {
    this.drag = { pointer: event.pointerId, x: event.clientX, rotation: this.rotation() };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  protected dragMove(event: PointerEvent): void {
    if (!this.drag || this.drag.pointer !== event.pointerId) return;
    const turned = this.drag.rotation + (event.clientX - this.drag.x) * 0.6;
    this.rotation.set(((turned + 180) % 360 + 360) % 360 - 180);
  }
  protected dragEnd(event: PointerEvent): void { if (this.drag?.pointer === event.pointerId) this.drag = null; }

  ngAfterViewInit(): void {
    document.body.classList.add('player-studio');
    void loadClipSet();
    try {
      const canvas=this.stage().nativeElement;
      this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;
      this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
      this.scene.add(new THREE.HemisphereLight('#e5f5ff','#3d4a52',2.3));
      const key=new THREE.DirectionalLight('#ffe9cd',3.2);key.position.set(-3,4,5);this.scene.add(key);
      const rim=new THREE.DirectionalLight('#75e9d4',2.8);rim.position.set(2.5,2.2,-3);this.scene.add(rim);
      const back=new THREE.DirectionalLight('#f1c878',1.2);back.position.set(-2.5,1.5,-3);this.scene.add(back);
      // A turf-coloured stage with a lit rim; a soft blob keeps the figure on the ground.
      const plinth=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.42,.12,72),new THREE.MeshStandardMaterial({color:'#1f5a4b',roughness:.85}));plinth.position.y=-.07;this.scene.add(plinth);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1.37,.014,6,72),new THREE.MeshBasicMaterial({color:'#8bdac4'}));ring.rotation.x=Math.PI/2;ring.position.y=-.008;this.scene.add(ring);
      const circle=new THREE.Mesh(new THREE.RingGeometry(.86,.9,64),new THREE.MeshBasicMaterial({color:'#e9f4ea',transparent:true,opacity:.5}));circle.rotation.x=-Math.PI/2;circle.position.y=-.004;this.scene.add(circle);
      const shadow=new THREE.Mesh(new THREE.CircleGeometry(.5,32),new THREE.MeshBasicMaterial({color:'#03120e',transparent:true,opacity:.38,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.002;shadow.scale.set(1,.8,1);this.scene.add(shadow);
      this.ball.position.set(0,.11,.64);this.scene.add(this.ball,this.marker);
      this.replaceModel();
      this.observer=new ResizeObserver(() => {
        const rect=canvas.getBoundingClientRect();
        this.renderer?.setSize(rect.width,rect.height,false);
        this.aspect=rect.width/Math.max(1,rect.height);
        this.camera.aspect=this.aspect;this.camera.updateProjectionMatrix();
        this.frameCamera();
      });
      this.observer.observe(canvas);
      canvas.dataset['ready']='true';
      this.zone.runOutsideAngular(() => { this.raf=requestAnimationFrame(t=>this.frame(t)); });
    } catch { this.error.set(this.i18n.pick('Die 3D-Ansicht konnte nicht gestartet werden. Bitte prüfe die Grafikbeschleunigung deines Browsers.', 'The 3D view could not be started. Please check the graphics acceleration of your browser.')); }
  }
  /**
   * Keeps the whole figure in the picture: the camera backs off on narrow stages, makes room for a dive and looks a
   * little below the figure's middle so the transport bar never covers the feet.
   */
  private frameCamera(): void {
    if (this.closeUp() && this.model) {
      // Head and shoulders, following the head through the motion.
      const head = this.model.joints.head.getWorldPosition(this.headPosition);
      this.camera.position.set(head.x * .6, head.y - .04, 2.3 * Math.max(1, .8 / this.aspect));
      this.camera.lookAt(head.x * .6, head.y - .12, 0);
      return;
    }
    const diving=this.action()==='keeper-dive';
    const distance=(diving?6.1:5.4)*Math.max(1,.95/this.aspect);
    this.camera.position.set(0,1.5,distance);
    this.camera.lookAt(diving?.18:0,diving?.6:.78,0);
  }
  private measureSlide(): void {
    const model = this.model, action = this.action();
    if (!model || (action !== 'jog' && action !== 'sprint')) return;
    const base: PlayerRuntimeSnapshot = { id: 'slide', side: 'home', x: 0, y: 0, homeX: 0, homeY: 0, vx: 0, vy: 0, facingX: 0, facingY: 1, fitness: 100, active: true, card: 'none', action, actionStartedTick: 0, decisionCooldown: 0, skillCooldown: 0, tackleCooldown: 0, intentX: 0, intentY: 0, animationDistance: 0 };
    this.slideCm.set(measureFootSlide(model, base, action === 'sprint' ? 7.8 : 4) * 100);
  }
  /** Builds all 128 identities, checks their skin weights and poses an extreme action on each; reports the first problems. */
  protected checkAllRigs(): void {
    const problems: string[] = [];
    let worst = 0;
    for (let seed = 0; seed < 128; seed++) {
      const model = createProceduralFootballer(createPlayerVisualIdentity(`studio-${seed}`), this.kit(), seed % 99 + 1, false, false, true);
      const weights = checkWeights(model);
      const base: PlayerRuntimeSnapshot = { id: 'rig', side: 'home', x: 0, y: 0, homeX: 0, homeY: 0, vx: 0, vy: 0, facingX: 0, facingY: 1, fitness: 100, active: true, card: 'none', action: 'idle', actionStartedTick: 0, decisionCooldown: 0, skillCooldown: 0, tackleCooldown: 0, intentX: 0, intentY: 0, animationDistance: 0 };
      const posed = checkPose(model, () => { const state = { ...base, action: 'bicycle-kick' as const, actionStartedTick: 80 }; poseFootballer(model, state, 90, 1, true); poseFootballer(model, state, 90, 3, true); });
      worst = Math.max(worst, posed.maxStretch);
      if (weights.badWeights || weights.invalid || posed.maxStretch > 4.6) problems.push(`#${seed + 1}`);
      model.destroy();
    }
    this.rigStatus.set(problems.length
      ? this.i18n.pick(`${problems.length} von 128 auffällig: ${problems.slice(0, 8).join(', ')}`, `${problems.length} of 128 need a look: ${problems.slice(0, 8).join(', ')}`)
      : this.i18n.pick(`Alle 128 Figuren in Ordnung (größte Dehnung ${worst.toFixed(2)}×).`, `All 128 figures are fine (largest stretch ${worst.toFixed(2)}×).`));
  }
  private replaceModel(): void {
    this.model?.destroy();
    if (this.skeleton) {this.scene.remove(this.skeleton);this.skeleton.dispose();}
    this.model=createProceduralFootballer(this.player().visuals,this.kit(),this.player().kitNumber,this.keeper(),this.player().foot === 'Left',false,this.player().lastName);
    this.scene.add(this.model.mesh);this.skeleton=new THREE.SkeletonHelper(this.model.mesh);this.scene.add(this.skeleton);
  }
  seek(seconds:number):void {
    this.paused.set(true);this.elapsed=Math.max(0,Math.min(2.19,seconds));this.cursor.set(this.elapsed);
    this.distance=this.elapsed*(this.action()==='sprint'?7.8:this.action()==='jog'?4:0);
  }
  private frame(time: number): void {
    if (this.disposed || !this.model || !this.renderer) return;
    const dt=Math.min(.05,this.last?(time-this.last)/1000:0);this.last=time;
    if (!this.paused()) this.elapsed+=dt*this.timeScale();
    const action=this.action();const speed=action==='sprint'?7.8:action==='jog'?4:0;
    if (!this.paused()) this.distance+=speed*dt*this.timeScale();
    const tick=this.elapsed*60,started=Math.floor(this.elapsed/2.2)*132;
    if(Math.floor((this.elapsed%2.2)*10)!==Math.floor(this.cursor()*10)) this.cursor.set(this.elapsed%2.2);
    const contactSpec=STUDIO_CONTACTS[action];
    // The simulation's contact appears at the contact tick (release plus the wind-up), not at the release.
    const contactTick=started+(ACTION_CONTACT_TICKS[action] ?? 0);
    const state:PlayerRuntimeSnapshot={id:'preview',side:'home',x:0,y:0,homeX:0,homeY:0,vx:0,vy:speed,facingX:0,facingY:1,fitness:100,active:true,card:'none',action,actionStartedTick:started,decisionCooldown:0,skillCooldown:0,tackleCooldown:0,intentX:0,intentY:0,animationDistance:this.distance};
    const kick = !!contactSpec;
    if (contactSpec && tick >= contactTick) state.contact = { tick: contactTick, x: 0, y: contactSpec.y, z: contactSpec.z, kind: contactSpec.kind, foot: this.player().foot === 'Left' ? 'left' : 'right' };
    const keeper=action.startsWith('keeper-');
    if(keeper) state.actionTarget={x:action==='keeper-dive'?1.05:0,y:.35,z:action==='keeper-dive'?.60:action==='keeper-punch'?2.3:action==='keeper-smother'?.15:1.10};
    poseFootballer(this.model,state,tick,this.elapsed,false,0,undefined,this.limp()?1:0);
    this.model.mesh.rotation.y=this.rotation()*Math.PI/180;
    this.model.mesh.updateMatrixWorld(true);
    this.frameCamera();
    this.skeleton!.visible=this.skeletonVisible();this.marker.visible=this.contactsVisible();this.marker.position.set(state.actionTarget?.x??0,state.actionTarget?.z??contactSpec?.z??.11,state.actionTarget?.y??contactSpec?.y??.56).applyAxisAngle(new THREE.Vector3(0,1,0),this.model.mesh.rotation.y);
    // The ball waits at the contact point and flies off after the contact tick.
    const sinceContact=(tick-contactTick)/60;
    this.ball.visible = !kick || sinceContact < .5;
    this.ball.position.set(0,contactSpec?.z ?? .11,(contactSpec?.y ?? .56)+(kick&&sinceContact>0?Math.min(.5,sinceContact)*3:0)).applyAxisAngle(new THREE.Vector3(0,1,0),this.model.mesh.rotation.y);
    if(keeper) this.ball.position.set(state.actionTarget!.x,state.actionTarget!.z,state.actionTarget!.y).applyAxisAngle(new THREE.Vector3(0,1,0),this.model.mesh.rotation.y);
    this.renderer.render(this.scene,this.camera);
    this.raf=requestAnimationFrame(t=>this.frame(t));
  }
  ngOnDestroy(): void {
    document.body.classList.remove('player-studio');
    this.disposed=true;cancelAnimationFrame(this.raf);this.observer?.disconnect();this.model?.destroy();this.skeleton?.dispose();
    this.scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(material=>material.dispose());}});
    this.renderer?.dispose();this.renderer?.forceContextLoss();
  }
}
