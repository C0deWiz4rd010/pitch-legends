import * as THREE from 'three';
import { ArcadeActor, ArcadeMatch, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH, GOAL_HEIGHT } from '../../core/services/arcade-match';
import { resolveMatchKits, MatchKitSelection } from '../../core/kit-visuals';
import { hash32 } from '../../core/visual-identity';
import { MatchRenderFrame, MatchRenderState, MatchSnapshot, PlayerRuntimeSnapshot } from '../../models/match.model';
import { createProceduralFootballer, poseFootballer, ProceduralFootballer } from './three-player.factory';
import { interpolateThreeFrame, playerInCameraSpace, RenderInterpolationScratch } from './three-render-state';
import { usesSoftwareGraphics } from './graphics-capabilities';
import { advanceBroadcastCamera } from './broadcast-camera';
import { RenderCadence } from './render-cadence';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MatchCameraPreset } from '../../models/match.model';

/** Camera angle (degrees above the pitch), lens and framing per broadcast preset. */
export const CAMERA_PRESETS: Record<MatchCameraPreset, { pitch: number; fov: number; width: number; follow: number }> = {
  arcade: { pitch: 30, fov: 40, width: 0.8, follow: 1 },
  tv: { pitch: 25, fov: 32, width: 1.1, follow: 0.3 },
  tactic: { pitch: 60, fov: 46, width: 1.55, follow: 1 },
};
const SKY: Record<'day' | 'sunset' | 'night', { zenith: string; horizon: string }> = {
  day: { zenith: '#5d8fc4', horizon: '#c9dde2' },
  sunset: { zenith: '#3f5480', horizon: '#eea977' },
  night: { zenith: '#040914', horizon: '#18283f' },
};

type VisualState = MatchRenderState | MatchSnapshot;
const SELECTION_OWNER = new THREE.Color('#ffe875');
const SELECTION_FREE = new THREE.Color('#81e6ed');

export type PitchQuality = 'high' | 'balanced' | 'low';
export interface PitchRenderDiagnostics {
  renderer: 'three-webgl2';
  quality: PitchQuality;
  resolutionScale: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  renderMilliseconds: number;
  contextLost: boolean;
  targetFps: number;
}

/** GPU rendering is a consumer of the 60 Hz simulation, never a physics owner. */
export class ThreePitchRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly stadium = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 300);
  private readonly sun = new THREE.DirectionalLight('#fff3d3', 3.0);
  private readonly fill = new THREE.HemisphereLight('#d1eeff', '#4a6841', 2.2);
  /** Back light from the far stand separates players from the grass. */
  private readonly rim = new THREE.DirectionalLight('#d4e6ff', 0.9);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly flags: THREE.Mesh[] = [];
  private turf!: THREE.Points;
  private readonly turfVelocity = new Float32Array(64 * 3);
  private readonly turfLife = new Float32Array(64);
  private turfCursor = 0;
  private readonly turfSpawned = new Map<string, number>();
  private lastEventCount = 0;
  private shake = 0;
  private replayVariant = 0;
  private celebration: { scorerId: string; elapsed: number } | null = null;
  private pitchMaterial: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null = null;
  private sunHeight = 75;
  private readonly cullFrustum = new THREE.Frustum();
  private readonly cullMatrix = new THREE.Matrix4();
  private readonly cullSphere = new THREE.Sphere(new THREE.Vector3(), 2.3);
  private readonly models = new Map<string, ProceduralFootballer>();
  private readonly matrixDummy = new THREE.Object3D();
  private readonly shadow: THREE.InstancedMesh;
  private readonly selection: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly arrow: THREE.Mesh;
  private readonly power: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly ball: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly ballShadow: THREE.Mesh;
  private readonly ballHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly trail: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly trailPoints: THREE.Vector3[] = [];
  private readonly ribbonAxis = new THREE.Vector3();
  private readonly ribbonSide = new THREE.Vector3();
  private readonly ballPosition = new THREE.Vector3();
  private readonly hud: HTMLCanvasElement;
  private readonly hudContext: CanvasRenderingContext2D | null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly crowdUniform = { value: 0 };
  private readonly crowdEnergy = { value: 0.01 };
  private readonly goalNets: THREE.Mesh[] = [];
  private readonly netRestPositions: Float32Array[] = [];
  private readonly confetti: THREE.Points;
  private readonly confettiOrigins = new Float32Array(160 * 3);
  private readonly confettiVelocity = new Float32Array(160 * 3);
  private readonly weather: THREE.LineSegments;
  private quality: PitchQuality;
  private readonly interpolation: RenderInterpolationScratch = { players: [], owned: [] };
  private readonly mirroredPlayer = {} as PlayerRuntimeSnapshot;
  /** Highest profile this device started with; recovery never exceeds it. */
  private ceilingQuality: PitchQuality = 'high';
  private stableSamples = 0;
  private downgrades = 0;
  private readonly software: boolean;
  private readonly cadence: RenderCadence;
  private pixelRatio: number;
  private width = 1280;
  private height = 720;
  private matchId = '';
  private kits: MatchKitSelection | null = null;
  private time = 0;
  private goalTime = -100;
  private netImpulse = 0;
  private cameraX = 0;
  private cameraZ = 0;
  private viewWidth = 91;
  private lastDirection = 1;
  private cameraInitialized=false;
  private contextLost = false;
  private disposed = false;
  private lastHud = -1;
  private sampleTime = 0;
  private sampleFrames = 0;
  private renderMilliseconds = 0;
  private qualityCooldown = 5;

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.canvas.dataset['graphicsState'] = 'context-lost';
    this.drawRecoveryMessage();
  };
  private readonly onContextRestored = () => {
    this.contextLost = false;
    this.canvas.dataset['graphicsState'] = 'ready';
    this.resize();
    this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.quality = mobile ? 'balanced' : 'high';
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 1.75);
    this.software=usesSoftwareGraphics();
    this.cadence=new RenderCadence(this.software ? 1 / 30 : 0);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: !this.software, powerPreference: 'high-performance' });
    if (this.software) { this.quality = 'low'; this.pixelRatio = .35; }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Statistics cover the whole frame, including every post-processing pass.
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.ceilingQuality = this.quality;
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#162c36');
    this.scene.fog = new THREE.Fog('#162c36', 115, 220);
    this.scene.add(this.stadium, this.fill, this.sun, this.sun.target, this.rim);
    this.sun.position.set(-35, 75, 25);
    this.rim.position.set(25, 22, -45);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // A tight shadow box follows the camera: about 28 texels per metre instead of 14.
    Object.assign(this.sun.shadow.camera, { left: -36, right: 36, top: 30, bottom: -30, near: 1, far: 170 });
    if (!this.software) {
      // Image-based lighting gives kits, skin and the ball real highlights instead of flat ambient light.
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.3;
      pmrem.dispose();
    }
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.065;
    this.sun.shadow.camera.updateProjectionMatrix();

    const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#071f1d', transparent: true, opacity: 0.30, depthWrite: false });
    this.shadow = new THREE.InstancedMesh(new THREE.CircleGeometry(0.46, 12), shadowMaterial, 32);
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadow.frustumCulled = false;
    this.scene.add(this.shadow);
    this.selection = new THREE.Mesh(new THREE.RingGeometry(0.69, 0.79, 40), new THREE.MeshBasicMaterial({ color: '#ffe875', transparent: true, opacity: 0.97, depthWrite: false, toneMapped: false }));
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.renderOrder = 4;
    this.scene.add(this.selection);
    const arrowGeometry = new THREE.ConeGeometry(0.20, 0.33, 3);
    this.arrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: '#ffe875', depthTest: false, toneMapped: false }));
    this.arrow.rotation.z = Math.PI;
    this.arrow.renderOrder = 5;
    this.scene.add(this.arrow);
    this.power = new THREE.Mesh(new THREE.RingGeometry(0.89, 1.01, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    this.power.rotation.x = -Math.PI / 2;
    this.scene.add(this.power);

    const ballGeometry = new THREE.IcosahedronGeometry(0.11, 2);
    const colors: number[] = [];
    const pos = ballGeometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) * 1.307;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) * 1.307;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) * 1.307;
      const panel = Math.sin(cx * 15) * Math.sin(cy * 15) * Math.sin(cz * 15) > 0.37;
      const color = new THREE.Color(panel ? '#1c3651' : '#fcfaf1');
      for (let n = 0; n < 3; n++) colors.push(color.r, color.g, color.b);
    }
    ballGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.ball = new THREE.Mesh(ballGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.51, emissive: '#77746b', emissiveIntensity: 0.18 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.30, 16), new THREE.MeshBasicMaterial({ color: '#0d251c', transparent: true, opacity: 0.50, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
    this.ballHalo = new THREE.Mesh(new THREE.RingGeometry(0.37, 0.43, 24), new THREE.MeshBasicMaterial({ color: '#fbf7ce', transparent: true, opacity: 0.60, depthWrite: false, toneMapped: false }));
    this.ballHalo.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballHalo);
    // A tapered ribbon (two vertices per sample) reads far better than a 1 px line.
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3), 3));
    const trailAlpha: number[] = [];
    for (let i = 0; i < 12; i++) { const a = 1 - i / 11; trailAlpha.push(1, 1, 1, a, 1, 1, 1, a); }
    trailGeometry.setAttribute('color', new THREE.Float32BufferAttribute(trailAlpha, 4));
    const trailIndex: number[] = [];
    for (let i = 0; i < 11; i++) trailIndex.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    trailGeometry.setIndex(trailIndex);
    this.trail = new THREE.Mesh(trailGeometry, new THREE.MeshBasicMaterial({ color: '#fff8c8', vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    // Turf and dust kicked up by slide tackles and hard strikes.
    const turfGeometry = new THREE.BufferGeometry();
    turfGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(64 * 3).fill(-100), 3));
    this.turf = new THREE.Points(turfGeometry, new THREE.PointsMaterial({ color: '#3f7a3c', size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
    this.turf.frustumCulled = false;
    this.scene.add(this.turf);
    this.configureComposer();

    const confettiGeometry = new THREE.BufferGeometry();
    confettiGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this.confettiOrigins.length), 3));
    const confettiColors: number[] = [];
    for (let i = 0; i < 160; i++) {
      const c = new THREE.Color(['#ffda65', '#50dec8', '#ffffff', '#ee7895'][i % 4]);
      confettiColors.push(c.r, c.g, c.b);
    }
    confettiGeometry.setAttribute('color', new THREE.Float32BufferAttribute(confettiColors, 3));
    this.confetti = new THREE.Points(confettiGeometry, new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, toneMapped: false }));
    this.confetti.frustumCulled = false;
    this.confetti.visible = false;
    this.scene.add(this.confetti);
    const rain = new Float32Array(220 * 6);
    for (let i = 0; i < 220; i++) {
      const x = (hash32(`rain-x-${i}`) % 1250) / 10 - 62.5;
      const z = (hash32(`rain-z-${i}`) % 800) / 10 - 40;
      const y = (i % 19) * 0.6;
      rain.set([x, y, z, x - 0.13, y + 0.65, z + 0.12], i * 6);
    }
    this.weather = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rain, 3)), new THREE.LineBasicMaterial({ color: '#d1efff', transparent: true, opacity: 0.20, depthWrite: false }));
    this.weather.frustumCulled = false;
    this.scene.add(this.weather);

    canvas.style.imageRendering = 'auto';
    canvas.dataset['renderer'] = 'three-webgl2';
    canvas.dataset['graphicsState'] = 'ready';
    this.hud = document.createElement('canvas');
    this.hud.className = 'three-match-hud';
    this.hud.setAttribute('aria-hidden', 'true');
    this.hud.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;image-rendering:auto;';
    this.hud.width = 1280;
    this.hud.height = 720;
    this.hudContext = this.hud.getContext('2d');
    canvas.parentElement?.appendChild(this.hud);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  /** Call before releasing the kickoff screen, including after a new fixture loads. */
  async prepare(match: ArcadeMatch): Promise<void> {
    if (this.disposed) return;
    this.ensureMatch(match);
    this.updateCamera(match, match.renderState(), 1, false);
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return;
    // Upload every rig and stadium mesh before play, including ones outside the opening view.
    const warmTarget=new THREE.WebGLRenderTarget(8,8);
    const warmCamera=new THREE.OrthographicCamera(-90,90,75,-75,.1,250);
    warmCamera.position.set(0,130,0);warmCamera.lookAt(0,0,0);
    const culling=new Map<THREE.Object3D,boolean>();
    this.scene.traverse(object=>{culling.set(object,object.frustumCulled);object.frustumCulled=false;});
    try {this.renderer.setRenderTarget(warmTarget);this.renderer.render(this.scene,warmCamera);}
    finally {this.renderer.setRenderTarget(null);warmTarget.dispose();culling.forEach((value,object)=>object.frustumCulled=value);}
    // Upload geometry, bone textures and shadow targets before the match clock starts.
    const state = match.renderState();
    this.render(match, { previous: state, current: state, alpha: 1, deltaSeconds: 1 / 60 });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (this.disposed) return;
    this.render(match, { previous: state, current: state, alpha: 1, deltaSeconds: 1 / 60 });
    // A software driver can still be compiling/rasterizing after render() returns.
    // Finish that one-time work behind the loading screen, never inside live play.
    if(this.software) this.renderer.getContext().finish();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  triggerGoal(): void {
    this.goalTime = this.time;
    this.netImpulse = 1;
    this.shake = Math.max(this.shake, 0.5);
    this.replayVariant = (this.replayVariant + 1) % 3;
    const side = this.ball.position.x >= 0 ? 1 : -1;
    for (let i = 0; i < 160; i++) {
      this.confettiOrigins.set([side * 53, 0.2 + i % 4, (i % 2 ? -1 : 1) * (5 + i % 7)], i * 3);
      this.confettiVelocity.set([((hash32(`gx${i}`) % 100) / 100 - 0.5) * 7, 4 + (hash32(`gy${i}`) % 80) / 10, ((hash32(`gz${i}`) % 100) / 100 - 0.5) * 8], i * 3);
    }
  }

  /** The scorer is shown celebrating in a close shot before the replay. */
  renderCelebration(match: ArcadeMatch, snapshot: MatchSnapshot, scorerId: string, elapsed: number, deltaSeconds: number): void {
    this.celebration = { scorerId, elapsed };
    try { this.render(match, { previous: snapshot as never, current: snapshot as never, alpha: 1, deltaSeconds }, snapshot); }
    finally { this.celebration = null; }
  }

  render(match: ArcadeMatch, frame?: MatchRenderFrame, replay?: MatchSnapshot): void {
    if (this.disposed || this.contextLost) return;
    const started = performance.now();
    const dt = this.cadence.consume(Math.min(0.05, Math.max(0.001, frame?.deltaSeconds ?? 1 / 60)));
    if (!dt) return;
    const state = replay ?? (frame ? interpolateThreeFrame(frame, this.interpolation) : match.renderState());
    this.time += dt;
    this.ensureMatch(match);
    this.updateCamera(match, state, dt, !!replay);
    this.camera.updateMatrixWorld();
    this.cullFrustum.setFromProjectionMatrix(this.cullMatrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse));
    const mirror = state.attackDirection;
    const lookAt = { x: mirror > 0 ? state.ball.x : -state.ball.x, y: state.ball.y };
    this.watchEvents(match);
    let index = 0;
    for (const model of this.models.values()) model.mesh.visible = false;
    for (const player of state.players) {
      const model = this.models.get(player.id);
      if (!model) continue;
      model.mesh.visible = player.active;
      if (!player.active) continue;
      model.mesh.position.set((player.x - FIELD_LENGTH / 2) * mirror, 0, player.y - FIELD_WIDTH / 2);
      this.cullSphere.center.copy(model.mesh.position).setY(1);
      if (!this.cullFrustum.intersectsSphere(this.cullSphere)) { model.mesh.visible = false; continue; }
      model.mesh.rotation.y = Math.atan2(player.facingX * mirror, player.facingY);
      poseFootballer(model, playerInCameraSpace(player,mirror,this.mirroredPlayer), state.tick, this.time, match.config.camera.reducedMotion,player.id===state.controlledPlayerId&&!replay?match.actionPower:0, lookAt);
      if (player.action === 'slide' && state.tick - player.actionStartedTick < 3 && this.turfSpawned.get(player.id) !== player.actionStartedTick) {
        this.turfSpawned.set(player.id, player.actionStartedTick);
        this.spawnTurf(model.mesh.position.x, model.mesh.position.z, 12, 3.2);
      }
      if (player.contact && state.tick - player.contact.tick < 2 && Math.hypot(state.ball.vx, state.ball.vy) > 24 && this.turfSpawned.get(`${player.id}:c`) !== player.contact.tick) {
        this.turfSpawned.set(`${player.id}:c`, player.contact.tick);
        this.spawnTurf((player.contact.x - FIELD_LENGTH / 2) * mirror, player.contact.y - FIELD_WIDTH / 2, 7, 2.4);
      }
      this.matrixDummy.position.copy(model.mesh.position).setY(0.014);
      this.matrixDummy.rotation.set(-Math.PI / 2, 0, 0);
      this.matrixDummy.scale.set(1.0, 0.66, 1);
      this.matrixDummy.updateMatrix();
      this.shadow.setMatrixAt(index++, this.matrixDummy.matrix);
      if (player.id === state.controlledPlayerId) {
        this.selection.position.copy(model.mesh.position).setY(0.028);
        this.selection.material.color.copy(match.ball.ownerId === player.id ? SELECTION_OWNER : SELECTION_FREE);
        this.arrow.position.copy(model.mesh.position).setY(model.recipe.height + 0.53);
        this.power.position.copy(model.mesh.position).setY(0.03);
        this.power.visible = match.actionPower > 0.025 && !replay;
        const power = Math.min(1, match.actionPower);
        this.power.scale.setScalar(0.85 + power * 0.30);
        this.power.material.color.setHSL((1 - power) * 0.29, 0.90, 0.65);
        this.power.material.opacity = 0.4 + power * 0.55;
      }
    }
    this.shadow.count = index;
    this.shadow.instanceMatrix.needsUpdate = true;
    this.selection.visible = !!this.models.get(state.controlledPlayerId)?.mesh.visible;
    this.arrow.visible = this.selection.visible;
    this.updateBall(state, dt, !!replay);
    this.updateAtmosphere(match, dt);
    this.updateTurf(dt);
    if (this.bloom) this.bloom.strength = 0.25 + Math.max(0, 1 - (this.time - this.goalTime) / 1.5) * 0.45;
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (this.time - this.lastHud > 0.09) {
      this.drawHud(match, state, !!replay);
      this.lastHud = this.time;
    }
    this.renderMilliseconds = performance.now() - started;
    this.adaptQuality(dt);
  }

  diagnostics(): PitchRenderDiagnostics {
    return { renderer: 'three-webgl2', quality: this.quality, resolutionScale: this.pixelRatio,
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      renderMilliseconds: this.renderMilliseconds, contextLost: this.contextLost, targetFps: this.software ? 30 : 60 };
  }

  setQuality(quality: PitchQuality): void {
    this.quality = quality;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.software ? .35 : quality === 'high' ? 1.75 : quality === 'balanced' ? 1.25 : 0.85);
    this.renderer.shadowMap.enabled = quality === 'high';
    this.configureComposer();
    this.resize();
    this.canvas.dataset['quality'] = quality;
    this.stadium.traverse(object => { if (object.name === 'crowd') object.visible = quality !== 'low'; });
  }

  /** Bloom, vignette and tone mapping as a light post-process on the high profile only. */
  private configureComposer(): void {
    const wanted = this.quality === 'high' && !this.software;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = this.quality === 'high' ? 0.14 : 0.30;
    if (!wanted) {
      this.composer?.dispose();
      this.composer = null;
      this.bloom = null;
      return;
    }
    if (this.composer) return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Only genuinely bright sources (lamps, goal flash) bloom; lit kits and markings stay crisp.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.25, 0.4, 2.2);
    composer.addPass(this.bloom);
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms['offset'].value = 1.02;
    vignette.uniforms['darkness'].value = 0.85;
    composer.addPass(vignette);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.composer?.dispose();
    this.composer = null;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.hud.remove();
    for (const model of this.models.values()) model.destroy();
    this.models.clear();
    disposeTree(this.scene);
    this.sun.shadow.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.trailPoints.length = 0;
  }

  private resize(): void {
    if (this.disposed) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, bounds.width || this.canvas.clientWidth || 1280);
    this.height = Math.max(1, bounds.height || this.width * 9 / 16);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(this.width, this.height);
      this.bloom?.resolution.set(this.width / 2, this.height / 2);
    }
    this.hud.width = Math.round(Math.min(1600, Math.max(640, this.width)));
    this.hud.height = Math.round(this.hud.width * this.height / this.width);
    this.lastHud = -1;
    this.updateFrustum();
  }

  private updateFrustum(): void {
    this.camera.aspect = this.width / Math.max(1,this.height);
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(match: ArcadeMatch, state: VisualState, dt: number, replay: boolean): void {
    const mirror = state.attackDirection;
    const selected = state.players.find(player => player.id === state.controlledPlayerId);
    const bx = (state.ball.x - FIELD_LENGTH / 2) * mirror;
    const bz = state.ball.y - FIELD_WIDTH / 2;
    const sx = selected ? (selected.x - FIELD_LENGTH / 2) * mirror : bx;
    const sz = selected ? selected.y - FIELD_WIDTH / 2 : bz;
    const lead = Math.min(0.12, match.config.camera.lookAhead ?? 0.12);
    const targetX = THREE.MathUtils.clamp(bx * 0.55 + sx * 0.45 + state.ball.vx * mirror * lead, -43, 43);
    const targetZ = THREE.MathUtils.clamp(bz * 0.55 + sz * 0.45 + state.ball.vy * lead * 0.5, -24, 24);
    const preset = CAMERA_PRESETS[this.presetFor(match)];
    const reduced = match.config.camera.reducedMotion;
    const baseWidth = replay && !reduced ? 34 : 48;
    const targetWidth = Math.max(baseWidth, Math.abs(bx - sx) * 1.25 + 25) * preset.width / THREE.MathUtils.clamp(match.config.camera.zoom || 1, 0.6, 1.4);
    if (!this.cameraInitialized || this.lastDirection !== mirror) {
      this.cameraX = targetX;
      this.cameraZ = targetZ;
      this.viewWidth=targetWidth;
      this.cameraInitialized=true;
      this.trailPoints.length = 0;
      this.lastDirection = mirror;
    }
    const next=advanceBroadcastCamera({x:this.cameraX,z:this.cameraZ,width:this.viewWidth},{x:targetX,z:targetZ,width:targetWidth},dt,replay);
    this.cameraX=next.x;this.cameraZ=next.z;this.viewWidth=next.width;
    const celebration = this.celebration ? state.players.find(player => player.id === this.celebration!.scorerId) : undefined;
    let fov = preset.fov, pitch = preset.pitch, width = this.viewWidth, focusX = this.cameraX, focusZ = this.cameraZ, stand = preset.follow;
    if (celebration && !reduced) {
      // Push in on the scorer: low, close and tight.
      const push = THREE.MathUtils.smoothstep(this.celebration!.elapsed, 0, 1.2);
      focusX = THREE.MathUtils.lerp(this.cameraX, (celebration.x - FIELD_LENGTH / 2) * mirror, push);
      focusZ = THREE.MathUtils.lerp(this.cameraZ, celebration.y - FIELD_WIDTH / 2, push);
      width = THREE.MathUtils.lerp(this.viewWidth, 13, push);
      pitch = THREE.MathUtils.lerp(pitch, 18, push);
      stand = 1;
    }
    const distance = width / Math.max(1.1,this.width/this.height) / (2*Math.tan(THREE.MathUtils.degToRad(fov/2)));
    const angle = THREE.MathUtils.degToRad(pitch);
    const standZ = focusZ * stand;
    let position = new THREE.Vector3(focusX, distance * Math.sin(angle), standZ + distance * Math.cos(angle));
    let look = new THREE.Vector3(focusX, 0, THREE.MathUtils.lerp(standZ, focusZ, 0.7));
    if (replay && !celebration && !reduced && this.replayVariant > 0) {
      const goalSide = Math.sign(bx) || 1;
      if (this.replayVariant === 1) {
        // Behind the goal, looking back up the pitch at the finish.
        position = new THREE.Vector3(goalSide * (FIELD_LENGTH / 2 + 10), 4.2, bz * 0.3);
        look = new THREE.Vector3(bx - goalSide * 6, 0.8, bz);
        fov = 42;
      } else {
        // Low touchline camera level with the ball.
        position = new THREE.Vector3(this.cameraX * 0.85, 2.6, FIELD_WIDTH / 2 + 7);
        look = new THREE.Vector3(this.cameraX, 0.7, this.cameraZ);
        fov = 34;
      }
    } else if (!replay && !reduced && this.time < 2.6) {
      // Opening sweep over the ground before kick-off.
      const intro = 1 - THREE.MathUtils.smoothstep(this.time, 0.2, 2.6);
      position.lerp(new THREE.Vector3(-58 + this.time * 12, 36, 62), intro);
    }
    if (this.shake > 0.001 && match.config.camera.shake && !reduced) {
      position.x += Math.sin(this.time * 71) * this.shake * 0.22;
      position.y += Math.sin(this.time * 53 + 1.3) * this.shake * 0.16;
    }
    this.shake *= Math.exp(-6 * dt);
    if (this.camera.fov !== fov) this.camera.fov = fov;
    this.camera.position.copy(position);
    this.camera.lookAt(look);
    this.updateFrustum();
    // The tight shadow box follows the view; snapping to texels avoids shimmering edges.
    const texel = 72 / 2048;
    const sx2 = Math.round(look.x / texel) * texel, sz2 = Math.round(look.z / texel) * texel;
    this.sun.target.position.set(sx2, 0, sz2);
    this.sun.position.set(sx2 - 35, this.sunHeight, sz2 + 25);
    this.weather.position.x = look.x;
    this.weather.position.z = look.z;
  }

  private presetFor(match: ArcadeMatch): MatchCameraPreset {
    const preset = match.config.camera.preset;
    if (preset && preset in CAMERA_PRESETS) return preset;
    const zoom = match.config.camera.zoom || 1;
    return zoom < 0.72 ? 'tactic' : zoom < 0.92 ? 'tv' : 'arcade';
  }

  /** Camera shake from the woodwork and blocks; goals trigger it separately. */
  private watchEvents(match: ArcadeMatch): void {
    if (match.events.length < this.lastEventCount) this.lastEventCount = 0;
    for (let i = this.lastEventCount; i < match.events.length; i++) {
      const key = match.events[i].messageKey;
      if (key === 'match.post') this.shake = Math.max(this.shake, 0.35);
      else if (key === 'match.blocked') this.shake = Math.max(this.shake, 0.15);
    }
    this.lastEventCount = match.events.length;
  }

  private spawnTurf(x: number, z: number, count: number, speed: number): void {
    if (this.quality === 'low') return;
    const pos = this.turf.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let n = 0; n < count; n++) {
      const i = this.turfCursor = (this.turfCursor + 1) % 64;
      const angle = (hash32(`turf-${this.time}-${n}`) % 628) / 100;
      pos.setXYZ(i, x, 0.06, z);
      this.turfVelocity.set([Math.cos(angle) * speed * 0.5, speed * (0.6 + (n % 3) * 0.2), Math.sin(angle) * speed * 0.5], i * 3);
      this.turfLife[i] = 0.7;
    }
    pos.needsUpdate = true;
  }

  private updateTurf(dt: number): void {
    const pos = this.turf.geometry.getAttribute('position') as THREE.BufferAttribute;
    let alive = false;
    for (let i = 0; i < 64; i++) {
      if (this.turfLife[i] <= 0) continue;
      alive = true;
      this.turfLife[i] -= dt;
      this.turfVelocity[i * 3 + 1] -= 9.81 * dt;
      const y = Math.max(0.03, pos.getY(i) + this.turfVelocity[i * 3 + 1] * dt);
      pos.setXYZ(i, pos.getX(i) + this.turfVelocity[i * 3] * dt, this.turfLife[i] > 0 ? y : -100, pos.getZ(i) + this.turfVelocity[i * 3 + 2] * dt);
    }
    this.turf.visible = alive;
    if (alive) pos.needsUpdate = true;
  }

  private ensureMatch(match: ArcadeMatch): void {
    if (this.matchId !== match.matchId) {
      this.matchId = match.matchId;
      this.cameraInitialized=false;
      this.kits = resolveMatchKits(match.home, match.away);
      for (const model of this.models.values()) model.destroy();
      this.models.clear();
      disposeTree(this.stadium);
      this.stadium.clear();
      this.goalNets.length = 0;
      this.netRestPositions.length = 0;
      this.buildStadium(match);
      this.trailPoints.length = 0;
      this.time = 0;
      this.goalTime = -100;
      this.canvas.dataset['quality'] = this.quality;
    }
    for (const actor of match.actors) {
      if (this.models.has(actor.player.id)) continue;
      const kit = actor.player.positionGroup === 'GK'
        ? actor.side === 'home' ? this.kits!.homeGoalkeeper : this.kits!.awayGoalkeeper
        : actor.side === 'home' ? this.kits!.home : this.kits!.away;
      const model = createProceduralFootballer(actor.player.visuals, kit, actor.player.kitNumber, actor.player.positionGroup === 'GK', actor.player.foot === 'Left',this.software, actor.player.lastName);
      this.models.set(actor.player.id, model);
      this.scene.add(model.mesh);
    }
  }

  private buildStadium(match: ArcadeMatch): void {
    const atmosphere = match.home.visuals.stadium.atmosphere;
    const night = atmosphere === 'night';
    const sunset = atmosphere === 'sunset';
    const sky = SKY[night ? 'night' : sunset ? 'sunset' : 'day'];
    const bg = sky.horizon;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 140, 300);
    this.sun.color.set(night ? '#e4efff' : sunset ? '#ffd9a0' : '#fff5df');
    // Night: floodlights from high above and a darker ambient; day: warm low sun.
    // Image-based light adds on top, so direct light is a little lower than before.
    this.sun.intensity = (night ? 2.5 : 2.2) * (this.software ? 1.2 : 1);
    this.sunHeight = night ? 95 : 75;
    this.fill.intensity = (night ? 0.7 : sunset ? 0.95 : 1.1) * (this.software ? 1.6 : 1);
    this.rim.intensity = night ? 1.0 : sunset ? 0.9 : 0.6;
    this.rim.color.set(sunset ? '#ffc38a' : '#d4e6ff');
    this.scene.environmentIntensity = night ? 0.18 : 0.3;
    this.stadium.add(createSkyDome(sky.zenith, sky.horizon), createSkyline(sky.horizon, match.home.visuals.seed));
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(160, 116), new THREE.MeshStandardMaterial({ color: '#204c38', roughness: 1 }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.04;
    surround.receiveShadow = true;
    this.stadium.add(surround);
    const pitchTexture = createPitchTexture(match.home.visuals.seed, match.config.weather !== 'clear');
    pitchTexture.anisotropy = this.software?1:Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const wet = match.config.weather !== 'clear';
    this.pitchMaterial = this.software ? new THREE.MeshBasicMaterial({ map: pitchTexture, color: '#74ab83' })
      : new THREE.MeshStandardMaterial({ map: pitchTexture, bumpMap: createGrassBump(), bumpScale: 0.35, roughness: wet ? 0.62 : 0.94, metalness: 0, color: '#ffffff', envMapIntensity: 0.3 });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_LENGTH, FIELD_WIDTH), this.pitchMaterial);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.stadium.add(pitch);
    // Markings as real geometry stay crisp at every camera distance.
    const markings = new THREE.Mesh(createPitchMarkings(), this.software ? new THREE.MeshBasicMaterial({ color: '#dfe8cf' })
      : new THREE.MeshStandardMaterial({ color: '#dfe7d0', roughness: 0.85, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
    markings.position.y = 0.012;
    markings.receiveShadow = true;
    this.stadium.add(markings);
    this.buildGoals();

    const structures: { position: number[]; scale: number[]; color: string }[] = [];
    const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => structures.push({ position: [x, y, z], scale: [w, h, d], color });
    const rows = 5 + Math.min(5, match.home.facilities.stadium);
    const seatColor = match.home.visuals.stadium.seatColor;
    // Four compact stands form a coherent, deliberately stylized ground.
    // The camera sits in the near main stand, so only the far long side is built (it would block the view).
    for (const side of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        const y = 0.7 + row * 0.62;
        if (side < 0) addBox(0, y / 2, side * (41 + row * 0.95), 116, y, 0.98, row % 2 ? '#354858' : '#2b3d4b');
        addBox(side * (59 + row * 0.95), y / 2, 0, 0.98, y, 79, row % 2 ? '#354858' : '#2b3d4b');
      }
      addBox(0, 0.46, side * 37.6, 111, 0.90, 0.26, '#f1ebd2');
      addBox(side * 56.4, 0.46, 0, 0.26, 0.90, 76, '#f1ebd2');
      if (side < 0) addBox(0, rows * 0.62 + 0.7, side * (42 + rows * 0.95), 120, 0.55, 0.6, seatColor);
      addBox(side * (60 + rows * 0.95), rows * 0.62 + 0.7, 0, 0.6, 0.55, 82, seatColor);
      // Back walls close the bowl; bigger grounds (stadium level 2+) get cantilever roofs.
      const top = rows * 0.62 + 0.7;
      if (side < 0) addBox(0, (top + 1.6) / 2, side * (42.6 + rows * 0.95), 122, top + 1.6, 0.4, '#1d2a35');
      addBox(side * (60.6 + rows * 0.95), (top + 1.6) / 2, 0, 0.4, top + 1.6, 84, '#1d2a35');
      if (match.home.facilities.stadium >= 2) {
        const depth = rows * 0.95 + 3;
        if (side < 0) addBox(0, top + 3.2, side * (40.5 + depth / 2), 124, 0.28, depth, '#2c3a45');
        addBox(side * (58.5 + depth / 2), top + 3.2, 0, depth, 0.28, 86, '#2c3a45');
        if (side < 0) for (let x = -54; x <= 54; x += 18) addBox(x, (top + 3.2) / 2 + 0.8, side * (42.4 + rows * 0.95), 0.3, top + 3.2 - 1.6, 0.3, '#56646d');
      }
      for (let x = -48; x <= 48; x += 16) {
        addBox(x, 0.5, side * 37.78, 12, 0.54, 0.12, x % 32 ? match.home.visuals.kits.home.shirt : '#163748');
      }
    }
    // Braced floodlight towers frame the ground without lighting each lamp separately.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * 62, z = sz * 44;
      addBox(x, 8, z, 0.45, 16, 0.45, '#8da2a6');
      addBox(x, 16, z, 5.2, 2, 0.55, '#c2c8c1');
    }
    // Lamp faces are emissive, so bloom makes them glow (especially at night).
    const lampMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6d8').multiplyScalar(night ? 4 : 2.6) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.5, 0.1), lampMaterial);
      lamp.position.set(sx * 62, 16, sz * 44 + (sz > 0 ? -0.3 : 0.3));
      lamp.lookAt(0, 0, 0);
      this.stadium.add(lamp);
      if (night) {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff3cf', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.position.copy(lamp.position);
        glow.scale.setScalar(14);
        this.stadium.add(glow);
      }
    }
    // Benches and technical areas on the far touchline.
    for (const x of [-13, 13]) {
      addBox(x, 1.25, -38.7, 9.5, 0.14, 2.5, '#b6cbd0');
      addBox(x, 0.62, -39.8, 9.5, 1.3, 0.12, '#426976');
      addBox(x, 0.4, -39, 8.8, 0.2, 0.55, seatColor);
      for (const offset of [-4.5, 4.5]) addBox(x + offset, 0.65, -39, 0.12, 1.3, 2.3, '#8ba9b0');
    }
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.88 }), structures.length);
    const dummy = new THREE.Object3D();
    structures.forEach((part, i) => {
      dummy.position.fromArray(part.position);
      dummy.scale.fromArray(part.scale);
      dummy.updateMatrix();
      boxes.setMatrixAt(i, dummy.matrix);
      boxes.setColorAt(i, new THREE.Color(part.color));
    });
    boxes.receiveShadow = false;
    this.stadium.add(boxes);
    this.buildCrowd(match, rows);
    for (const x of [-52.5, 52.5]) for (const z of [-34, 34]) {
      const flag = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 5), new THREE.MeshStandardMaterial({ color: '#eeeac9' }));
      pole.position.y = 0.8;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), new THREE.MeshStandardMaterial({ color: '#ffd967', side: THREE.DoubleSide }));
      // Pivot at the pole so the cloth waves around it.
      cloth.geometry.translate(0.3, 0, 0);
      cloth.position.set(0, 1.36, 0);
      this.flags.push(cloth);
      flag.add(pole, cloth);
      flag.position.set(x, 0, z);
      this.stadium.add(flag);
    }
    // One texture creates all perimeter wordmarks; no external advertising/brands.
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 1024;
    bannerCanvas.height = 64;
    const ctx = bannerCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#102c36'; ctx.fillRect(0, 0, 1024, 64);
      ctx.fillStyle = '#f4e5ac'; ctx.font = 'bold 27px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('PITCH LEGENDS     •     PLAY BEAUTIFUL     •     THE GAME IS YOURS', 512, 42);
    }
    const bannerTexture = new THREE.CanvasTexture(bannerCanvas);
    bannerTexture.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(98, 0.86), new THREE.MeshBasicMaterial({ map: bannerTexture }));
    banner.position.set(0, 0.6, -37.43);
    this.stadium.add(banner);
  }

  private buildGoals(): void {
    const white = new THREE.MeshStandardMaterial({ color: '#fffbef', roughness: 0.45 });
    for (const sign of [-1, 1]) {
      const x = sign * FIELD_LENGTH / 2;
      const backX = x + sign * 2.1;
      const half = GOAL_WIDTH / 2;
      const post = (a: THREE.Vector3, b: THREE.Vector3) => {
        const delta = b.clone().sub(a);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, delta.length(), 8), white);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
        mesh.castShadow = true;
        this.stadium.add(mesh);
      };
      for (const z of [-half, half]) {
        post(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, GOAL_HEIGHT, z));
        post(new THREE.Vector3(x, GOAL_HEIGHT, z), new THREE.Vector3(backX, 0.15, z));
        post(new THREE.Vector3(x, 0.05, z), new THREE.Vector3(backX, 0.05, z));
      }
      post(new THREE.Vector3(x, GOAL_HEIGHT, -half), new THREE.Vector3(x, GOAL_HEIGHT, half));
      const topX = x + sign * 0.58;
      const geometry = createNetGeometry(x, topX, backX, half);
      const mesh = new THREE.Mesh(geometry, netMaterial());
      mesh.renderOrder = 2;
      this.goalNets.push(mesh);
      this.netRestPositions.push(new Float32Array((geometry.getAttribute('position') as THREE.BufferAttribute).array));
      this.stadium.add(mesh);
    }
  }

  private buildCrowd(match: ArcadeMatch, rows: number): void {
    const positions: THREE.Vector3[] = [];
    for (const sign of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        const step = this.quality === 'high' ? 1.20 : 1.80;
        for (let along = -54; along <= 54; along += step) {
          if (Math.abs(along % 16) < 1.3 || hash32(`${along}-${row}-${sign}`) % 10 === 0) continue;
          if (sign < 0) positions.push(new THREE.Vector3(along, 0.84 + row * 0.62, sign * (41 + row * 0.95)));
        }
        for (let along = -37; along <= 37; along += step) {
          if (Math.abs(along % 12) < 1.2 || hash32(`${along}-${row}-${sign}-end`) % 9 === 0) continue;
          positions.push(new THREE.Vector3(sign * (59 + row * 0.95), 0.84 + row * 0.62, along));
        }
      }
    }
    const material = new THREE.MeshLambertMaterial();
    material.onBeforeCompile = (shader) => {
      shader.uniforms['crowdTime'] = this.crowdUniform;
      shader.uniforms['crowdEnergy'] = this.crowdEnergy;
      shader.vertexShader = 'uniform float crowdTime; uniform float crowdEnergy;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.y += sin(crowdTime * 5.0 + instanceMatrix[3].x * 2.3 + instanceMatrix[3].z) * crowdEnergy;\n#endif');
    };
    const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.19, 0.40, 5), material, positions.length);
    const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), material, positions.length);
    const dummy = new THREE.Object3D();
    const colors = [match.home.visuals.kits.home.shirt, match.home.visuals.kits.home.secondary, '#f2e5c8', '#384960', '#c88669', '#98adb7'];
    positions.forEach((position, i) => {
      dummy.position.copy(position);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, new THREE.Color(colors[hash32(`fan-${match.home.visuals.seed}-${i}`) % colors.length]));
      dummy.position.y += 0.31;
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, new THREE.Color(['#ecc5a1', '#ca956e', '#925e46', '#543a32'][i % 4]));
    });
    bodies.name = heads.name = 'crowd';
    bodies.visible = heads.visible = this.quality !== 'low';
    this.stadium.add(bodies, heads);
  }

  private updateBall(state: VisualState, dt: number, replay: boolean): void {
    const x = (state.ball.x - FIELD_LENGTH / 2) * state.attackDirection;
    const z = state.ball.y - FIELD_WIDTH / 2;
    const h = Math.max(0, state.ball.z);
    const next = this.ballPosition.set(x, Math.max(0.11, h), z);
    const travelled = next.distanceTo(this.ball.position);
    this.ball.position.copy(next);
    this.ball.rotation.x += state.ball.vy * dt / 0.11;
    this.ball.rotation.z -= state.ball.vx * state.attackDirection * dt / 0.11;
    this.ball.rotation.y += state.ball.spin * dt;
    this.ballShadow.position.set(x, 0.02, z);
    this.ballShadow.scale.setScalar(1 + h * 0.15);
    this.ballHalo.position.set(x, 0.025, z);
    this.ballHalo.scale.setScalar(1 + Math.min(1, h * 0.08));
    this.ballHalo.material.opacity = h > 0.4 ? 0.76 : 0.42;
    if (travelled > 8) this.trailPoints.length = 0;
    const speed = Math.hypot(state.ball.vx, state.ball.vy);
    this.trail.visible = speed > 15 && !state.ball.ownerId;
    if (this.trail.visible) {
      if (travelled > 0.04 || !this.trailPoints.length) this.trailPoints.unshift(this.trailPoints.length >= 12 ? this.trailPoints.pop()!.copy(next) : next.clone());
      if (this.trailPoints.length > 12) this.trailPoints.length = 12;
      const position = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      // Ribbon half-width shrinks along the trail and faces the camera.
      for (let i = 0; i < 12; i++) {
        const p = this.trailPoints[Math.min(i, this.trailPoints.length - 1)] ?? next;
        const q = this.trailPoints[Math.min(i + 1, this.trailPoints.length - 1)] ?? p;
        this.ribbonAxis.subVectors(p, q);
        if (this.ribbonAxis.lengthSq() < 1e-6) this.ribbonAxis.set(1, 0, 0);
        this.ribbonSide.subVectors(this.camera.position, p).cross(this.ribbonAxis).normalize().multiplyScalar(0.075 * (1 - i / 12));
        position.setXYZ(i * 2, p.x + this.ribbonSide.x, p.y + this.ribbonSide.y, p.z + this.ribbonSide.z);
        position.setXYZ(i * 2 + 1, p.x - this.ribbonSide.x, p.y - this.ribbonSide.y, p.z - this.ribbonSide.z);
      }
      position.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, Math.max(0, this.trailPoints.length - 1) * 6);
      this.trail.material.opacity = replay ? 0.3 : 0.45;
    } else this.trailPoints.length = 0;
  }

  private updateAtmosphere(match: ArcadeMatch, dt: number): void {
    const reduced = match.config.camera.reducedMotion;
    const goalAge = this.time - this.goalTime;
    this.crowdUniform.value = this.time;
    this.crowdEnergy.value = reduced ? 0 : goalAge < 4 ? 0.12 : 0.009;
    this.weather.visible = !reduced && match.config.weather !== 'clear' && this.quality !== 'low';
    if (this.weather.visible) {
      this.weather.position.y = -(this.time * (match.config.weather === 'storm' ? 14 : 10) % 11.4);
      (this.weather.material as THREE.LineBasicMaterial).opacity = match.config.weather === 'storm' ? 0.32 : 0.2;
    }
    if (!reduced) this.flags.forEach((cloth, i) => { cloth.rotation.y = Math.sin(this.time * (match.config.weather === 'storm' ? 6 : 3) + i * 1.7) * 0.45; });
    this.confetti.visible = !reduced && goalAge >= 0 && goalAge < 3;
    if (this.confetti.visible) {
      const pos = this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 160; i++) {
        const a = i * 3;
        pos.setXYZ(i, this.confettiOrigins[a] + this.confettiVelocity[a] * goalAge,
          Math.max(0.08, this.confettiOrigins[a + 1] + this.confettiVelocity[a + 1] * goalAge - 3.0 * goalAge * goalAge),
          this.confettiOrigins[a + 2] + this.confettiVelocity[a + 2] * goalAge);
      }
      pos.needsUpdate = true;
      (this.confetti.material as THREE.PointsMaterial).opacity = Math.min(1, (3 - goalAge) * 1.2);
    }
    if (this.netImpulse > 0) {
      this.netImpulse = Math.max(0, this.netImpulse - dt * 0.65);
      this.goalNets.forEach((mesh, index) => {
        const rest = this.netRestPositions[index];
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const amplitude = Math.sin(Math.PI * rest[i * 3 + 1] / GOAL_HEIGHT) * Math.cos(rest[i * 3 + 2] * 0.35);
          const wave = reduced ? 0 : Math.sin(goalAge * 19 - rest[i * 3 + 2] * 2) * amplitude * this.netImpulse * 0.22;
          pos.setX(i, rest[i * 3] + wave);
        }
        pos.needsUpdate = true;
      });
    }
  }

  private drawHud(match: ArcadeMatch, state: VisualState, replay: boolean): void {
    const ctx = this.hudContext;
    if (!ctx) return;
    const w = this.hud.width, h = this.hud.height;
    ctx.clearRect(0, 0, w, h);
    const s = Math.max(0.72, Math.min(1.1, w / 1000));
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const bottomInset = touch ? 0 : 55;
    const mapW = 150 * s, mapH = mapW * FIELD_WIDTH / FIELD_LENGTH;
    const mapX = (w - mapW) / 2, mapY = h - mapH - 15 * s - bottomInset;
    ctx.fillStyle = 'rgba(9,26,33,.67)';
    ctx.beginPath(); ctx.roundRect(mapX - 9 * s, mapY - 9 * s, mapW + 18 * s, mapH + 18 * s, 6 * s); ctx.fill();
    ctx.strokeStyle = 'rgba(223,240,225,.36)'; ctx.lineWidth = s;
    ctx.strokeRect(mapX, mapY, mapW, mapH);
    ctx.beginPath(); ctx.moveTo(mapX + mapW / 2, mapY); ctx.lineTo(mapX + mapW / 2, mapY + mapH); ctx.stroke();
    ctx.beginPath(); ctx.arc(mapX + mapW / 2, mapY + mapH / 2, 9.15 / FIELD_LENGTH * mapW, 0, Math.PI * 2); ctx.stroke();
    for (const p of state.players) {
      if (!p.active) continue;
      const x = mapX + (state.attackDirection > 0 ? p.x : FIELD_LENGTH - p.x) / FIELD_LENGTH * mapW;
      const y = mapY + p.y / FIELD_WIDTH * mapH;
      ctx.fillStyle = p.id === state.controlledPlayerId ? '#ffe36e' : p.side === match.controlledSide ? '#73e4cf' : '#fc9b9f';
      ctx.beginPath(); ctx.arc(x, y, (p.id === state.controlledPlayerId ? 3.4 : 2.35) * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(mapX + (state.attackDirection > 0 ? state.ball.x : FIELD_LENGTH - state.ball.x) / FIELD_LENGTH * mapW, mapY + state.ball.y / FIELD_WIDTH * mapH, 2.4 * s, 0, Math.PI * 2); ctx.fill();
    const selected = match.actors.find(actor => actor.player.id === state.controlledPlayerId);
    if (selected) {
      const left = 18 * s, bottom = touch ? 98 * s : h - 25 * s - bottomInset;
      const label = `${selected.player.kitNumber}  ${selected.player.lastName.toLocaleUpperCase()}`;
      ctx.font = `600 ${14 * s}px system-ui, sans-serif`;
      const labelWidth = Math.max(148 * s, ctx.measureText(label).width + 27 * s);
      ctx.fillStyle = 'rgba(9,26,33,.77)'; ctx.beginPath(); ctx.roundRect(left, bottom - 37 * s, labelWidth, 51 * s, 5 * s); ctx.fill();
      ctx.fillStyle = '#ffe477'; ctx.fillRect(left, bottom - 36 * s, 3 * s, 49 * s);
      ctx.fillStyle = '#f5f6e9'; ctx.fillText(label, left + 12 * s, bottom - 14 * s);
      ctx.fillStyle = '#354c50'; ctx.fillRect(left + 12 * s, bottom - 3 * s, labelWidth - 24 * s, 3 * s);
      const fitness = state.players.find(p => p.id === state.controlledPlayerId)?.fitness ?? 100;
      ctx.fillStyle = fitness > 45 ? '#66dbc0' : '#f0b767'; ctx.fillRect(left + 12 * s, bottom - 3 * s, (labelWidth - 24 * s) * fitness / 100, 3 * s);
    }
    if (replay && !this.celebration) {
      // Cinema bars mark the replay unmistakably.
      const bar = h * 0.075;
      ctx.fillStyle = 'rgba(0,0,0,.82)';
      ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
      ctx.font = `700 ${15 * s}px system-ui, sans-serif`; ctx.fillStyle = '#ffde7b';
      ctx.fillText('●  REPLAY', 22 * s, bar + 24 * s);
    }
    if (!replay && match.rule.phase !== 'playing' && match.rule.phase !== 'advantage') {
      const names: Record<string, string> = { kickoff: 'ANSTOSS', freeKick: 'FREISTOSS', corner: 'ECKBALL', throwIn: 'EINWURF', goalKick: 'ABSTOSS', penalty: 'ELFMETER' };
      const label = names[match.rule.phase];
      if (label) {
        ctx.font = `600 ${13 * s}px system-ui, sans-serif`; ctx.textAlign = 'center';
        const top = touch ? 48 : 122;
        ctx.fillStyle = 'rgba(9,26,33,.72)'; ctx.beginPath(); ctx.roundRect(w / 2 - 94 * s, top, 188 * s, 31 * s, 5 * s); ctx.fill();
        ctx.fillStyle = '#f5efcf'; ctx.fillText(label, w / 2, top + 21 * s); ctx.textAlign = 'left';
      }
    }
  }

  private drawRecoveryMessage(): void {
    const ctx = this.hudContext;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.hud.width, this.hud.height);
    ctx.fillStyle = 'rgba(8,22,33,.85)'; ctx.fillRect(0, 0, this.hud.width, this.hud.height);
    ctx.fillStyle = '#fff1c9'; ctx.textAlign = 'center'; ctx.font = '600 20px system-ui';
    ctx.fillText('Grafik wird wiederhergestellt …', this.hud.width / 2, this.hud.height / 2);
    ctx.textAlign = 'left';
  }

  /** One step down after a stalled frame burst instead of dropping straight to the lowest profile. */
  stepDownQuality(): void {
    if (this.quality === 'low' || this.qualityCooldown > 0) return;
    this.setQuality(this.quality === 'high' ? 'balanced' : 'low');
    this.qualityCooldown = 8;
    this.stableSamples = 0;
    this.downgrades++;
  }

  private adaptQuality(dt: number): void {
    this.qualityCooldown -= dt;
    this.sampleFrames++;
    this.sampleTime += dt;
    if (this.sampleFrames < 150) return;
    const average = this.sampleTime / this.sampleFrames;
    if (this.qualityCooldown <= 0 && average > 0.024 && this.quality !== 'low') {
      this.stepDownQuality();
    } else if (average < 0.0185 && !this.software) {
      // Stable samples (2.5 s each) earn one profile back; every stall raises the bar to avoid oscillation.
      this.stableSamples++;
      const rank = { low: 0, balanced: 1, high: 2 } as const;
      if (this.stableSamples >= Math.min(12, 2 * (1 + this.downgrades)) && this.qualityCooldown <= 0 && rank[this.quality] < rank[this.ceilingQuality]) {
        this.setQuality(this.quality === 'low' ? 'balanced' : 'high');
        this.qualityCooldown = 12;
        this.stableSamples = 0;
      }
    } else this.stableSamples = 0;
    this.sampleTime = 0;
    this.sampleFrames = 0;
  }
}

/** Real mowing and white paint in one inexpensive, locally generated texture. */
function createPitchTexture(seed: number, wet: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 1326;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const sx = canvas.width / FIELD_LENGTH, sy = canvas.height / FIELD_WIDTH;
    for (let stripe = 0; stripe < 10; stripe++) {
      ctx.fillStyle = stripe % 2 ? wet ? '#246743' : '#2b8048' : wet ? '#205b39' : '#226e3e';
      ctx.fillRect(stripe * canvas.width / 10, 0, canvas.width / 10 + 1, canvas.height);
    }
    // Reproducible, faint blades/wear avoid both a flat plane and noisy shimmer.
    for (let i = 0; i < 26000; i++) {
      const n = hash32(`${seed}|grass|${i}`);
      ctx.fillStyle = i % 2 ? 'rgba(233,239,153,.050)' : 'rgba(13,56,32,.050)';
      ctx.fillRect(n % canvas.width, (n >>> 12) % canvas.height, 1, 2 + i % 3);
    }
    for (const x of [4.5, 100.5]) {
      const grad = ctx.createRadialGradient(x * sx, 34 * sy, 0, x * sx, 34 * sy, 3.8 * sx);
      grad.addColorStop(0, 'rgba(152,127,70,.13)'); grad.addColorStop(1, 'rgba(152,127,70,0)');
      ctx.fillStyle = grad; ctx.fillRect((x - 4) * sx, 29 * sy, 8 * sx, 10 * sy);
    }
    // Large, soft patches break up the uniform colour; markings are separate geometry.
    for (let i = 0; i < 40; i++) {
      const n = hash32(`${seed}|patch|${i}`);
      const px = n % canvas.width, py = (n >>> 11) % canvas.height, radius = 60 + (n >>> 20) % 160;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, i % 2 ? 'rgba(210,230,120,.05)' : 'rgba(8,40,20,.06)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
    }
    // A gentle light fall-off towards the far touchline.
    const light = ctx.createLinearGradient(0, 0, 0, canvas.height);
    light.addColorStop(0, 'rgba(0,20,10,.08)'); light.addColorStop(1, 'rgba(255,255,220,.05)');
    ctx.fillStyle = light; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Gradient dome: zenith colour overhead fading to the horizon (and fog) colour. */
function createSkyDome(zenith: string, horizon: string): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(280, 24, 12);
  const top = new THREE.Color(zenith), bottom = new THREE.Color(horizon), colour = new THREE.Color();
  const pos = geometry.getAttribute('position');
  const colours: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 280, 0, 1);
    colour.copy(bottom).lerp(top, Math.pow(t, 0.6));
    colours.push(colour.r, colour.g, colour.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -1;
  return dome;
}

/** A distant city silhouette beyond the stands. */
function createSkyline(horizon: string, seed: number): THREE.InstancedMesh {
  const count = 46;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(horizon).multiplyScalar(0.55), fog: true }), count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const n = hash32(`${seed}|skyline|${i}`);
    const angle = i / count * Math.PI * 2;
    const radius = 125 + n % 30;
    const height = 8 + (n >>> 5) % 28;
    dummy.position.set(Math.cos(angle) * radius, height / 2 - 1, Math.sin(angle) * radius * 0.8);
    dummy.scale.set(6 + (n >>> 10) % 10, height, 6 + (n >>> 14) % 8);
    dummy.lookAt(0, height / 2, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  return mesh;
}

/** Fine tiled height noise gives the turf light-dependent texture. */
let grassBump: THREE.CanvasTexture | null = null;
function createGrassBump(): THREE.CanvasTexture {
  if (grassBump) return grassBump;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const n = hash32(`bump|${i}`);
    ctx.fillStyle = `rgba(${n % 2 ? 255 : 0},${n % 2 ? 255 : 0},${n % 2 ? 255 : 0},.18)`;
    ctx.fillRect(n % 256, (n >>> 8) % 256, 1, 2 + (n >>> 16) % 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(42, 27);
  return grassBump = texture;
}

/** All pitch markings merged into one flat mesh (sim coordinates: x 0..105, y 0..68). */
function createPitchMarkings(): THREE.BufferGeometry {
  const width = 0.12, parts: THREE.BufferGeometry[] = [];
  const place = (geometry: THREE.BufferGeometry, x: number, y: number) => {
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(x - FIELD_LENGTH / 2, 0, y - FIELD_WIDTH / 2);
    parts.push(geometry.index ? geometry : geometry);
  };
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const length = Math.hypot(bx - ax, by - ay);
    const geometry = new THREE.PlaneGeometry(length + width, width);
    geometry.rotateZ(-Math.atan2(by - ay, bx - ax));
    place(geometry, (ax + bx) / 2, (ay + by) / 2);
  };
  const rect = (x: number, y: number, w: number, h: number) => { line(x, y, x + w, y); line(x + w, y, x + w, y + h); line(x + w, y + h, x, y + h); line(x, y + h, x, y); };
  const arc = (x: number, y: number, r: number, start: number, length: number) => place(new THREE.RingGeometry(r - width / 2, r + width / 2, 72, 1, start, length), x, y);
  const spot = (x: number, y: number) => place(new THREE.CircleGeometry(0.17, 16), x, y);
  rect(0.06, 0.06, 104.88, 67.88);
  line(52.5, 0.06, 52.5, 67.94);
  arc(52.5, 34, 9.15, 0, Math.PI * 2); spot(52.5, 34);
  rect(0.06, 13.84, 16.44, 40.32); rect(88.5, 13.84, 16.44, 40.32);
  rect(0.06, 24.84, 5.44, 18.32); rect(99.5, 24.84, 5.44, 18.32);
  spot(11, 34); spot(94, 34);
  const a = Math.acos(5.5 / 9.15);
  arc(11, 34, 9.15, -a, 2 * a); arc(94, 34, 9.15, Math.PI - a, 2 * a);
  arc(0, 0, 1, -Math.PI / 2, Math.PI / 2); arc(105, 0, 1, -Math.PI, Math.PI / 2);
  arc(0, 68, 1, 0, Math.PI / 2); arc(105, 68, 1, Math.PI / 2, Math.PI / 2);
  const merged = mergeGeometries(parts.map(part => part.index ? part.toNonIndexed() : part), false)!;
  parts.forEach(part => part.dispose());
  return merged;
}

/** Net surfaces (roof, sloping back, two sides) with UVs in 18 cm mesh cells. */
function createNetGeometry(x: number, topX: number, backX: number, half: number): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  const cell = 0.18;
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, su: number, sv: number) => {
    const base = positions.length / 3, lu = a.distanceTo(b) / cell, lv = a.distanceTo(d) / cell;
    for (let v = 0; v <= sv; v++) for (let u = 0; u <= su; u++) {
      const top = new THREE.Vector3().lerpVectors(a, b, u / su), bottom = new THREE.Vector3().lerpVectors(d, c, u / su);
      const p = top.lerp(bottom, v / sv);
      positions.push(p.x, p.y, p.z); uvs.push(u / su * lu, v / sv * lv);
    }
    for (let v = 0; v < sv; v++) for (let u = 0; u < su; u++) {
      const i = base + v * (su + 1) + u;
      index.push(i, i + 1, i + su + 1, i + 1, i + su + 2, i + su + 1);
    }
  };
  const H = GOAL_HEIGHT;
  const V = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);
  quad(V(x, H, -half), V(x, H, half), V(topX, H - .08, half), V(topX, H - .08, -half), 14, 2);
  quad(V(topX, H - .08, -half), V(topX, H - .08, half), V(backX, .06, half), V(backX, .06, -half), 14, 8);
  for (const z of [-half, half]) {
    quad(V(x, H, z), V(topX, H - .08, z), V(backX, .06, z), V(x, .06, z), 4, 8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

let sharedNetMaterial: THREE.MeshStandardMaterial | null = null;
function netMaterial(): THREE.MeshStandardMaterial {
  if (sharedNetMaterial) return sharedNetMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(240,246,242,1)'; ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return sharedNetMaterial = new THREE.MeshStandardMaterial({ map: texture, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, roughness: 0.9 });
}

let sharedGlow: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (sharedGlow) return sharedGlow;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,248,220,1)'); gradient.addColorStop(0.35, 'rgba(255,240,200,.35)'); gradient.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  return sharedGlow = new THREE.CanvasTexture(canvas);
}

function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
}
