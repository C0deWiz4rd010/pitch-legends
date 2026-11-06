import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as THREE from 'three';
import { createPracticeTeams } from '../../core/football/practice';
import { createPlayerVisualIdentity } from '../../core/visual-identity';
import { PortraitService } from '../../core/services/portrait.service';
import { PlayerActionState, PlayerRuntimeSnapshot } from '../../models/match.model';
import { createAppearanceRecipe, createProceduralFootballer, measureFootSlide, poseFootballer, ProceduralFootballer } from './three-player.factory';
import { clipsEnabled, loadClipSet, setClipsEnabled } from './animation/clip-store';
import { ACTION_CONTACT_TICKS, ACTION_DURATION_TICKS } from '../../core/football/action-timing';
import { checkPose, checkWeights } from './animation/rig-check';

/** Where the studio puts the ball for an action with a contact: height, distance in front of the figure, and the kind of contact. */
const STUDIO_CONTACTS: Partial<Record<PlayerActionState, { z: number; y: number; kind: 'foot' | 'head' }>> = {
  pass: { z: .11, y: .56, kind: 'foot' }, 'through-pass': { z: .11, y: .56, kind: 'foot' }, lob: { z: .11, y: .56, kind: 'foot' },
  shot: { z: .11, y: .56, kind: 'foot' }, 'low-shot': { z: .11, y: .56, kind: 'foot' }, 'finesse-shot': { z: .11, y: .56, kind: 'foot' },
  'chip-shot': { z: .11, y: .56, kind: 'foot' }, volley: { z: .85, y: .62, kind: 'foot' }, 'bicycle-kick': { z: 2.0, y: .12, kind: 'foot' },
  'flying-header': { z: 1.0, y: .78, kind: 'head' },
};

@Component({
  selector: 'app-player-lab', imports: [FormsModule, RouterLink], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header><a routerLink="/">← Start</a><span>THE PLAYER STUDIO</span><a routerLink="/play">Auf den Platz →</a></header>
    <main>
      <section class="viewer">
        <div class="title"><span class="eyebrow">128 GESICHTER. DEIN FUSSBALL.</span><h1>Jeder Spieler<br>ein Original.</h1></div>
        <canvas #stage aria-label="Animierte 3D-Spieleransicht"></canvas>
        @if (error()) { <p role="alert">{{ error() }}</p> }
        <div class="identity"><strong>SPIELER {{ seed() + 1 }}</strong><span>{{ recipe().height.toFixed(2) }} m · {{ recipe().identity.bodyBuild }} · #{{ player().kitNumber }}</span></div>
        <div class="view-controls"><label>Ansicht <input aria-label="Ansicht drehen" type="range" min="-180" max="180" [ngModel]="rotation()" (ngModelChange)="rotation.set(+$event)" /></label><button (click)="paused.set(!paused())">{{ paused() ? '▶ Abspielen' : 'Ⅱ Pause' }}</button></div>
      </section>
      <aside>
        <h2>Spielerwerkstatt</h2>
        <p>Entdecke verschiedene Körper, Frisuren und Gesichter. Die Figur auf dem Platz und ihr Portrait entstehen aus derselben Vorlage.</p>
        <div class="identity-preview">@if (portrait()) { <img [src]="portrait()" alt="Portrait der ausgewählten Spielfigur" /> }<div><label>Spieler-Seed <input type="number" min="0" max="127" [ngModel]="seed()" (ngModelChange)="selectSeed($event)" /></label><button (click)="selectSeed((seed() + 37) % 128)">Nächste Persönlichkeit ↗</button></div></div>
        <label>Trikot <select aria-label="Trikot" [ngModel]="awayKit()" (ngModelChange)="awayKit.set($event)"><option [ngValue]="false">Harbour · Heim</option><option [ngValue]="true">Sunset · Auswärts</option></select></label>
        <label>Bewegung <select aria-label="Bewegung" [ngModel]="action()" (ngModelChange)="action.set($event)">@for (clip of clips; track clip.value) { <option [value]="clip.value">{{ clip.label }}</option> }</select></label>
        <label>Tempo <select aria-label="Tempo" [ngModel]="timeScale()" (ngModelChange)="timeScale.set(+$event)"><option [ngValue]="1">Normal</option><option [ngValue]="0.25">Zeitlupe · ¼</option><option [ngValue]="0.1">Kontaktstudie · ¹⁄₁₀</option></select></label>
        <label>Bewegungsablauf · {{ cursor().toFixed(2) }} s <input aria-label="Bewegungsablauf" type="range" min="0" max="2.19" step=".01" [ngModel]="cursor()" (ngModelChange)="seek(+$event)" /></label>
        @if (slideCm() !== null) { <p class="slide" [class.bad]="slideCm()! > 3" data-testid="foot-slide">Fußrutschen: {{ slideCm()!.toFixed(1) }} cm je 5 cm Laufweg @if (slideCm()! > 3) { <strong>· zu viel</strong> } @else { <span>· Fuß haftet</span> }</p> }
        <details><summary>Animationswerkzeuge</summary><label><input type="checkbox" [ngModel]="skeletonVisible()" (ngModelChange)="skeletonVisible.set($event)" /> Skelett zeigen</label><label><input type="checkbox" [ngModel]="contactsVisible()" (ngModelChange)="contactsVisible.set($event)" /> Kontaktpunkt zeigen</label><label><input type="checkbox" [ngModel]="clipsOn()" (ngModelChange)="setClips($event)" /> Aufgenommene Clips</label><label><input type="checkbox" [ngModel]="limp()" (ngModelChange)="limp.set($event)" /> Humpeln (verletzt)</label><p>Rezept v{{ recipe().version }} · Seed {{ recipe().seed }}</p><button (click)="checkAllRigs()">Alle 128 Gelenke prüfen</button>@if (rigStatus()) { <p data-testid="rig-status">{{ rigStatus() }}</p> }</details>
        <div class="gallery-head"><h2>Identitäten</h2><button [disabled]="galleryPage() === 0" (click)="galleryPage.set(galleryPage() - 1)" aria-label="Vorherige Identitäten">←</button><span>{{ galleryPage() + 1 }} / 8</span><button [disabled]="galleryPage() === 7" (click)="galleryPage.set(galleryPage() + 1)" aria-label="Nächste Identitäten">→</button></div>
        <div class="gallery">@for (entry of gallery(); track entry.seed) { <button [class.active]="entry.seed === seed()" (click)="selectSeed(entry.seed)" [attr.aria-label]="'Spieler ' + (entry.seed + 1)">@if (entry.src) { <img [src]="entry.src" alt="" /> }<span>{{ entry.seed + 1 }}</span></button> }</div>
      </aside>
    </main>`,
  styles: [`
    :host { display:block; min-height:100dvh; background:#081923; color:#eef3e9; font-family:'IBM Plex Mono',monospace; }
    header { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 2rem; border-bottom:1px solid #31505d; font-size:.8rem; letter-spacing:.08em; }
    a { color:#83e9cc; text-decoration:none; } main { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(310px, .8fr); min-height:calc(100dvh - 55px); }
    .viewer { position:relative; min-height:650px; background:radial-gradient(ellipse at 50% 50%,#204354,#0b202c 72%); overflow:hidden; }
    .title { position:absolute; top:2rem; left:2rem; pointer-events:none; z-index:1; } .eyebrow { font-size:.65rem; color:#8ee5c4; letter-spacing:.14em; } h1 { font-family:system-ui,sans-serif; font-size:clamp(2rem,3.2vw,3rem); letter-spacing:-.06em; line-height:1.03; margin:.6rem 0; }
    canvas { display:block; width:100%; height:100%; position:absolute; inset:0; touch-action:pan-y; } .identity { position:absolute; bottom:6rem; left:2rem; display:grid; gap:.5rem; pointer-events:none; } .identity strong { letter-spacing:.12em; } .identity span { font-size:.75rem; color:#bdd3d7; }
    .view-controls { position:absolute; bottom:1.5rem; left:2rem; right:2rem; display:flex; gap:2rem; align-items:center; justify-content:space-between; } .view-controls label { flex:1; } input[type=range] { width:100%; accent-color:#7cebc4; }
    aside { padding:1.5rem 1.75rem; background:#112833; border-left:1px solid #31505d; } h2 { font-size:1rem; margin:.5rem 0 1rem; } p { color:#b9ccd0; font-size:.75rem; line-height:1.6; }
    label { display:block; font-size:.72rem; margin:.9rem 0; } select,input[type=number] { display:block; width:100%; background:#0b1e2a; color:#fff; border:1px solid #486471; padding:.65rem; margin-top:.4rem; font:inherit; } button { background:#244553; color:#dcf6ed; border:1px solid #527a83; padding:.5rem .7rem; font:inherit; font-size:.72rem; cursor:pointer; } button:hover { border-color:#8cf1c8; } button:disabled { opacity:.3; } :focus-visible { outline:2px solid #f1c878; outline-offset:3px; }
    .identity-preview { display:flex; align-items:center; gap:1rem; } .identity-preview img { width:96px; height:96px; border-radius:50%; border:2px solid #79d9bd; } .identity-preview div { flex:1; } details { border-top:1px solid #31505d; padding:.7rem 0; font-size:.75rem; }
    .gallery-head { display:flex; align-items:center; gap:.4rem; margin-top:1rem; font-size:.65rem; } .gallery-head h2 { margin:0 auto 0 0; } .gallery { display:grid; grid-template-columns:repeat(8,minmax(0,1fr)); gap:.35rem; margin-top:.75rem; } .gallery button { padding:0; position:relative; aspect-ratio:1; min-width:0; } .gallery img { width:100%; height:100%; object-fit:cover; } .gallery span { position:absolute; bottom:0; right:0; background:#081923cc; font-size:.55rem; padding:.1rem .2rem; } .gallery .active { outline:2px solid #8cf1c8; }
    @media(max-width:760px) { main { display:block; } .viewer { min-height:65dvh; } header { padding:1rem; font-size:.65rem; } .title { left:1rem; top:1rem; } h1 { font-size:2rem; } aside { border-left:0; padding:1.2rem; } .identity { left:1rem; bottom:5rem; } .view-controls { left:1rem; right:1rem; bottom:1rem; } }
  `],
})
export class PlayerLabPage implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly portraits = inject(PortraitService);
  private readonly stage = viewChild.required<ElementRef<HTMLCanvasElement>>('stage');
  private readonly teams = createPracticeTeams();
  readonly seed = signal(0);
  readonly awayKit = signal(false);
  readonly rotation = signal(-20);
  readonly paused = signal(false);
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
  readonly clips: { value: PlayerActionState; label: string }[] = [
    { value:'idle',label:'Bereit' }, { value:'jog',label:'Joggen' }, { value:'sprint',label:'Sprinten' },
    { value:'pass',label:'Kurzpass' }, { value:'lob',label:'Flanke' }, { value:'shot',label:'Kraftschuss' },
    { value:'finesse-shot',label:'Angeschnittener Schuss' }, { value:'header',label:'Kopfball' },
    { value:'ball-roll',label:'Sohlenrolle' }, { value:'drag-back',label:'Zurückziehen' },
    { value:'standing-tackle',label:'Zweikampf' }, { value:'slide',label:'Grätsche' }, { value:'stumble',label:'Stolpern / Aufstehen' },
    { value:'keeper-ready',label:'Torwart · bereit' }, { value:'keeper-catch',label:'Torwart · fangen' },
    { value:'keeper-dive',label:'Torwart · hechten' }, { value:'celebrate',label:'Torjubel' },
    { value:'keeper-parry',label:'Torwart · abwehren' }, { value:'keeper-throw',label:'Torwart · abwerfen' },
    { value:'heavy-touch',label:'Schwere Annahme' }, { value:'jockey',label:'Abschirmen / Stellen' },
    { value:'volley',label:'Volley' }, { value:'bicycle-kick',label:'Fallrückzieher' }, { value:'flying-header',label:'Flugkopfball' },
    { value:'fake-shot',label:'Schussfinte' }, { value:'wall-jump',label:'Mauer · Sprung' },
    { value:'keeper-punch',label:'Torwart · fausten' }, { value:'keeper-smother',label:'Torwart · abfangen' },
  ];
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
  private readonly marker = new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),new THREE.MeshBasicMaterial({color:'#ffcb69',wireframe:true,depthTest:false}));
  private readonly ball = new THREE.Mesh(new THREE.IcosahedronGeometry(.11,1),new THREE.MeshStandardMaterial({color:'#f7edd8',roughness:.8}));
  private disposed = false;
  constructor() {
    effect((cleanup) => {
      const player = this.player(), kit = this.kit();
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
  selectSeed(value: number): void { this.seed.set(Math.max(0,Math.min(127,Math.trunc(Number(value)||0)))); }
  private playerFor(seed: number) { return {...this.teams.home.players.find(player => player.positionGroup !== 'GK')!,id:`studio-${seed}`,kitNumber:seed%99+1,visuals:createPlayerVisualIdentity(`studio-${seed}`)}; }
  ngAfterViewInit(): void {
    document.body.classList.add('player-studio');
    void loadClipSet();
    try {
      const canvas=this.stage().nativeElement;
      this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;
      this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
      this.scene.add(new THREE.HemisphereLight('#e5f5ff','#594a36',2.6));
      const light=new THREE.DirectionalLight('#ffe9cd',3);light.position.set(-3,4,5);this.scene.add(light);
      const rim=new THREE.DirectionalLight('#75e9d4',2.4);rim.position.set(2,2,-3);this.scene.add(rim);
      const plinth=new THREE.Mesh(new THREE.CylinderGeometry(1.0,1.07,.10,64),new THREE.MeshStandardMaterial({color:'#2b6069',roughness:.55}));plinth.position.y=-.06;this.scene.add(plinth);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1.01,.012,6,64),new THREE.MeshBasicMaterial({color:'#8bdac4'}));ring.rotation.x=Math.PI/2;ring.position.y=-.01;this.scene.add(ring);
      this.ball.position.set(0,.11,.64);this.scene.add(this.ball,this.marker);
      this.camera.position.set(0,1.65,4.7);this.camera.lookAt(0,1,0);
      this.replaceModel();
      this.observer=new ResizeObserver(() => {const rect=canvas.getBoundingClientRect();this.renderer?.setSize(rect.width,rect.height,false);this.camera.aspect=rect.width/Math.max(1,rect.height);this.camera.updateProjectionMatrix();});this.observer.observe(canvas);
      canvas.dataset['ready']='true';
      this.zone.runOutsideAngular(() => { this.raf=requestAnimationFrame(t=>this.frame(t)); });
    } catch { this.error.set('Die 3D-Ansicht konnte nicht gestartet werden. Bitte prüfe die Grafikbeschleunigung deines Browsers.'); }
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
    this.rigStatus.set(problems.length ? `${problems.length} von 128 auffällig: ${problems.slice(0, 8).join(', ')}` : `Alle 128 Figuren in Ordnung (größte Dehnung ${worst.toFixed(2)}×).`);
  }
  private replaceModel(): void {
    this.model?.destroy();
    if (this.skeleton) {this.scene.remove(this.skeleton);this.skeleton.dispose();}
    this.model=createProceduralFootballer(this.player().visuals,this.kit(),this.player().kitNumber,this.action().startsWith('keeper-'),this.player().foot === 'Left',false,this.player().lastName);
    const diving=this.action()==='keeper-dive';
    this.camera.position.set(0,1.65,diving?5.4:4.7);
    this.camera.lookAt(diving?.18:0,diving?.75:1,0);
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
