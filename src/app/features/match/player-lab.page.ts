import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as THREE from 'three';
import { createPracticeTeams } from '../../core/football/practice';
import { createPlayerVisualIdentity } from '../../core/visual-identity';
import { PortraitService } from '../../core/services/portrait.service';
import { PlayerActionState, PlayerRuntimeSnapshot } from '../../models/match.model';
import { createAppearanceRecipe, createProceduralFootballer, poseFootballer, ProceduralFootballer } from './three-player.factory';

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
        <details><summary>Animationswerkzeuge</summary><label><input type="checkbox" [ngModel]="skeletonVisible()" (ngModelChange)="skeletonVisible.set($event)" /> Skelett zeigen</label><label><input type="checkbox" [ngModel]="contactsVisible()" (ngModelChange)="contactsVisible.set($event)" /> Kontaktpunkt zeigen</label><p>Rezept v{{ recipe().version }} · Seed {{ recipe().seed }}</p></details>
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
  readonly action = signal<PlayerActionState>('jog');
  readonly skeletonVisible = signal(false);
  readonly contactsVisible = signal(false);
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
      let active = true; cleanup(() => { active = false; });
      if (this.renderer) this.replaceModel();
      void this.portraits.figure(player, kit).catch(() => '');
      void this.portraits.portrait(player, { ...this.teams.home, visuals: { ...this.teams.home.visuals, kits: { ...this.teams.home.visuals.kits, home: kit } } }).then(src => { if (active) this.portrait.set(src); });
    });
    effect((cleanup) => {
      const offset = this.galleryPage() * 16;
      let active = true; cleanup(() => { active = false; });
      this.gallery.set(Array.from({length:16},(_,i) => ({seed:offset+i,src:''})));
      for (let i=0;i<16;i++) {
        const seed=offset+i;
        void this.portraits.portrait(this.playerFor(seed),this.teams.home).then(src => {
          if (active) this.gallery.update(rows => rows.map(row => row.seed === seed ? {...row,src} : row));
        });
      }
    });
  }
  selectSeed(value: number): void { this.seed.set(Math.max(0,Math.min(127,Math.trunc(Number(value)||0)))); }
  private playerFor(seed: number) { return {...this.teams.home.players.find(player => player.positionGroup !== 'GK')!,id:`studio-${seed}`,kitNumber:seed%99+1,visuals:createPlayerVisualIdentity(`studio-${seed}`)}; }
  ngAfterViewInit(): void {
    document.body.classList.add('player-studio');
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
  private replaceModel(): void {
    this.model?.destroy();
    if (this.skeleton) {this.scene.remove(this.skeleton);this.skeleton.dispose();}
    this.model=createProceduralFootballer(this.player().visuals,this.kit(),this.player().kitNumber,this.action().startsWith('keeper-'),this.player().foot === 'Left');
    this.scene.add(this.model.mesh);this.skeleton=new THREE.SkeletonHelper(this.model.mesh);this.scene.add(this.skeleton);
  }
  private frame(time: number): void {
    if (this.disposed || !this.model || !this.renderer) return;
    const dt=Math.min(.05,this.last?(time-this.last)/1000:0);this.last=time;
    if (!this.paused()) this.elapsed+=dt*this.timeScale();
    const action=this.action();const speed=action==='sprint'?7.8:action==='jog'?4:0;
    if (!this.paused()) this.distance+=speed*dt*this.timeScale();
    const tick=this.elapsed*60,started=Math.floor(this.elapsed/2.2)*132;
    const state:PlayerRuntimeSnapshot={id:'preview',side:'home',x:0,y:0,homeX:0,homeY:0,vx:0,vy:speed,facingX:0,facingY:1,fitness:100,active:true,card:'none',action,actionStartedTick:started,decisionCooldown:0,skillCooldown:0,tackleCooldown:0,intentX:0,intentY:0,animationDistance:this.distance};
    const kick = ['pass','lob','shot','finesse-shot'].includes(action);
    if (kick) state.contact = { tick: started, x: 0, y: .56, z: .11, kind: 'foot', foot: this.player().foot === 'Left' ? 'left' : 'right' };
    poseFootballer(this.model,state,tick,this.elapsed);
    this.model.mesh.rotation.y=this.rotation()*Math.PI/180;
    this.skeleton!.visible=this.skeletonVisible();this.marker.visible=this.contactsVisible();this.marker.position.set(0,.11,.56).applyAxisAngle(new THREE.Vector3(0,1,0),this.model.mesh.rotation.y);
    const age=(tick-started)/60;
    this.ball.visible = !kick || age < .5;
    this.ball.position.set(0,.11,.56+(kick?Math.min(.5,age)*3:0)).applyAxisAngle(new THREE.Vector3(0,1,0),this.model.mesh.rotation.y);
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
