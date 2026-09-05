import * as THREE from 'three';
import { ArcadeActor, ArcadeMatch, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH, GOAL_HEIGHT } from '../../core/services/arcade-match';
import { resolveMatchKits, MatchKitSelection } from '../../core/kit-visuals';
import { hash32 } from '../../core/visual-identity';
import { MatchRenderFrame, MatchRenderState, MatchSnapshot } from '../../models/match.model';
import { createProceduralFootballer, poseFootballer, ProceduralFootballer } from './three-player.factory';
import { interpolateThreeFrame } from './three-render-state';

type VisualState = MatchRenderState | MatchSnapshot;
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
}

/** GPU rendering is a consumer of the 60 Hz simulation, never a physics owner. */
export class ThreePitchRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly stadium = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(-40, 40, 22.5, -22.5, 0.1, 300);
  private readonly sun = new THREE.DirectionalLight('#fff3d3', 3.0);
  private readonly fill = new THREE.HemisphereLight('#d1eeff', '#4a6841', 2.2);
  private readonly models = new Map<string, ProceduralFootballer>();
  private readonly matrixDummy = new THREE.Object3D();
  private readonly shadow: THREE.InstancedMesh;
  private readonly selection: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly arrow: THREE.Mesh;
  private readonly power: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly ball: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly ballShadow: THREE.Mesh;
  private readonly ballHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly trailPoints: THREE.Vector3[] = [];
  private readonly hud: HTMLCanvasElement;
  private readonly hudContext: CanvasRenderingContext2D | null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly crowdUniform = { value: 0 };
  private readonly crowdEnergy = { value: 0.01 };
  private readonly goalNets: THREE.LineSegments[] = [];
  private readonly netRestPositions: Float32Array[] = [];
  private readonly confetti: THREE.Points;
  private readonly confettiOrigins = new Float32Array(160 * 3);
  private readonly confettiVelocity = new Float32Array(160 * 3);
  private readonly weather: THREE.LineSegments;
  private quality: PitchQuality;
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
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    const adapter = debugRenderer ? String(gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(adapter)) { this.quality = 'low'; this.pixelRatio = .75; }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#162c36');
    this.scene.fog = new THREE.Fog('#162c36', 115, 220);
    this.scene.add(this.stadium, this.fill, this.sun);
    this.sun.position.set(-35, 75, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -73, right: 73, top: 58, bottom: -58, near: 1, far: 150 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.065;
    this.sun.shadow.camera.updateProjectionMatrix();

    const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#0d241e', transparent: true, opacity: 0.22, depthWrite: false });
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

    const ballGeometry = new THREE.IcosahedronGeometry(0.255, 2);
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
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12 * 3), 3));
    this.trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: '#fff8c8', transparent: true, opacity: 0.35, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

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
    // Upload geometry, bone textures and shadow targets before the match clock starts.
    const state = match.renderState();
    this.render(match, { previous: state, current: state, alpha: 1, deltaSeconds: 1 / 60 });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (this.disposed) return;
    this.render(match, { previous: state, current: state, alpha: 1, deltaSeconds: 1 / 60 });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  triggerGoal(): void {
    this.goalTime = this.time;
    this.netImpulse = 1;
    const side = this.ball.position.x >= 0 ? 1 : -1;
    for (let i = 0; i < 160; i++) {
      this.confettiOrigins.set([side * 53, 0.2 + i % 4, (i % 2 ? -1 : 1) * (5 + i % 7)], i * 3);
      this.confettiVelocity.set([((hash32(`gx${i}`) % 100) / 100 - 0.5) * 7, 4 + (hash32(`gy${i}`) % 80) / 10, ((hash32(`gz${i}`) % 100) / 100 - 0.5) * 8], i * 3);
    }
  }

  render(match: ArcadeMatch, frame?: MatchRenderFrame, replay?: MatchSnapshot): void {
    if (this.disposed || this.contextLost) return;
    const started = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, frame?.deltaSeconds ?? 1 / 60));
    const state = replay ?? (frame ? interpolateThreeFrame(frame) : match.renderState());
    this.time += dt;
    this.ensureMatch(match);
    this.updateCamera(match, state, dt, !!replay);
    const mirror = state.attackDirection;
    let index = 0;
    for (const model of this.models.values()) model.mesh.visible = false;
    for (const player of state.players) {
      const model = this.models.get(player.id);
      if (!model) continue;
      model.mesh.visible = player.active;
      if (!player.active) continue;
      model.mesh.position.set((player.x - FIELD_LENGTH / 2) * mirror, 0, player.y - FIELD_WIDTH / 2);
      model.mesh.rotation.y = Math.atan2(player.facingX * mirror, player.facingY);
      poseFootballer(model, player, state.tick, this.time, match.config.camera.reducedMotion);
      this.matrixDummy.position.copy(model.mesh.position).setY(0.014);
      this.matrixDummy.rotation.set(-Math.PI / 2, 0, 0);
      this.matrixDummy.scale.set(1.0, 0.66, 1);
      this.matrixDummy.updateMatrix();
      this.shadow.setMatrixAt(index++, this.matrixDummy.matrix);
      if (player.id === state.controlledPlayerId) {
        this.selection.position.copy(model.mesh.position).setY(0.028);
        this.selection.material.color.set(match.ball.ownerId === player.id ? '#ffe875' : '#81e6ed');
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
    this.renderer.render(this.scene, this.camera);
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
      renderMilliseconds: this.renderMilliseconds, contextLost: this.contextLost };
  }

  setQuality(quality: PitchQuality): void {
    this.quality = quality;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.75 : quality === 'balanced' ? 1.25 : 0.85);
    this.renderer.shadowMap.enabled = quality === 'high';
    this.resize();
    this.canvas.dataset['quality'] = quality;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
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
    this.hud.width = Math.round(Math.min(1600, Math.max(640, this.width)));
    this.hud.height = Math.round(this.hud.width * this.height / this.width);
    this.lastHud = -1;
    this.updateFrustum();
  }

  private updateFrustum(): void {
    const aspect = this.width / this.height;
    const viewHeight = this.viewWidth / Math.max(1.1, aspect);
    this.camera.left = -this.viewWidth / 2;
    this.camera.right = this.viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(match: ArcadeMatch, state: VisualState, dt: number, replay: boolean): void {
    const mirror = state.attackDirection;
    const selected = state.players.find(player => player.id === state.controlledPlayerId);
    const bx = (state.ball.x - FIELD_LENGTH / 2) * mirror;
    const bz = state.ball.y - FIELD_WIDTH / 2;
    const sx = selected ? (selected.x - FIELD_LENGTH / 2) * mirror : bx;
    const sz = selected ? selected.y - FIELD_WIDTH / 2 : bz;
    const lead = Math.min(0.30, match.config.camera.lookAhead ?? 0.18);
    const targetX = THREE.MathUtils.clamp(bx * 0.78 + sx * 0.22 + state.ball.vx * mirror * lead, -43, 43);
    const targetZ = THREE.MathUtils.clamp(bz * 0.78 + sz * 0.22 + state.ball.vy * lead * 0.65, -24, 24);
    const fastBall = Math.hypot(state.ball.vx, state.ball.vy) > 15;
    const penalty = Math.abs(bx) > 32;
    const kickoff = match.rule.phase === 'kickoff';
    const baseWidth = replay ? 59 : kickoff ? 94 : penalty ? 66 : fastBall ? 85 : 76;
    const targetWidth = Math.max(baseWidth, Math.abs(bx - sx) * 1.25 + 25) / THREE.MathUtils.clamp(match.config.camera.zoom || 1, 0.8, 1.3);
    const smooth = 1 - Math.exp(-(match.config.camera.reducedMotion ? 12 : replay ? 5.0 : 6.3) * dt);
    if (this.lastDirection !== mirror) {
      this.cameraX = targetX;
      this.cameraZ = targetZ;
      this.trailPoints.length = 0;
      this.lastDirection = mirror;
    }
    this.cameraX += (targetX - this.cameraX) * smooth;
    this.cameraZ += (targetZ - this.cameraZ) * smooth;
    this.viewWidth += (targetWidth - this.viewWidth) * (1 - Math.exp(-2.4 * dt));
    this.camera.position.set(this.cameraX, 68, this.cameraZ + 51);
    this.camera.lookAt(this.cameraX, 0, this.cameraZ);
    this.updateFrustum();
  }

  private ensureMatch(match: ArcadeMatch): void {
    if (this.matchId !== match.matchId) {
      this.matchId = match.matchId;
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
      const model = createProceduralFootballer(actor.player.visuals, kit, actor.player.kitNumber, actor.player.positionGroup === 'GK', actor.player.foot === 'Left');
      this.models.set(actor.player.id, model);
      this.scene.add(model.mesh);
    }
  }

  private buildStadium(match: ArcadeMatch): void {
    const atmosphere = match.home.visuals.stadium.atmosphere;
    const night = atmosphere === 'night';
    const sunset = atmosphere === 'sunset';
    const bg = night ? '#102239' : sunset ? '#5b6667' : '#73949a';
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 125, 240);
    this.sun.color.set(night ? '#d3eaff' : sunset ? '#ffe0a7' : '#fff5df');
    this.sun.intensity = night ? 2.6 : 3;
    this.fill.intensity = night ? 1.6 : 2.2;
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(160, 116), new THREE.MeshStandardMaterial({ color: '#204c38', roughness: 1 }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.04;
    surround.receiveShadow = true;
    this.stadium.add(surround);
    const pitchTexture = createPitchTexture(match.home.visuals.seed, match.config.weather !== 'clear');
    pitchTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_LENGTH, FIELD_WIDTH), new THREE.MeshStandardMaterial({ map: pitchTexture, roughness: 0.94, metalness: 0, color: '#ffffff' }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.stadium.add(pitch);
    this.buildGoals();

    const structures: { position: number[]; scale: number[]; color: string }[] = [];
    const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => structures.push({ position: [x, y, z], scale: [w, h, d], color });
    const rows = 5 + Math.min(5, match.home.facilities.stadium);
    const seatColor = match.home.visuals.stadium.seatColor;
    // Four compact stands form a coherent, deliberately stylized ground.
    for (const side of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        const y = 0.7 + row * 0.62;
        addBox(0, y / 2, side * (41 + row * 0.95), 116, y, 0.98, row % 2 ? '#354858' : '#2b3d4b');
        addBox(side * (59 + row * 0.95), y / 2, 0, 0.98, y, 79, row % 2 ? '#354858' : '#2b3d4b');
      }
      addBox(0, 0.46, side * 37.6, 111, 0.90, 0.26, '#f1ebd2');
      addBox(side * 56.4, 0.46, 0, 0.26, 0.90, 76, '#f1ebd2');
      addBox(0, rows * 0.62 + 0.7, side * (42 + rows * 0.95), 120, 0.55, 0.6, seatColor);
      addBox(side * (60 + rows * 0.95), rows * 0.62 + 0.7, 0, 0.6, 0.55, 82, seatColor);
      for (let x = -48; x <= 48; x += 16) {
        addBox(x, 0.5, side * 37.78, 12, 0.54, 0.12, x % 32 ? match.home.visuals.kits.home.shirt : '#163748');
      }
    }
    // Braced floodlight towers frame the ground without lighting each lamp separately.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * 62, z = sz * 44;
      addBox(x, 8, z, 0.45, 16, 0.45, '#8da2a6');
      addBox(x, 16, z, 5.2, 2, 0.55, '#c2c8c1');
      addBox(x, 16, z + (sz > 0 ? -0.3 : 0.3), 4.8, 1.5, 0.1, '#fff9d9');
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
      cloth.position.set(0.3, 1.36, 0);
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
      const net: number[] = [];
      const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => net.push(ax, ay, az, bx, by, bz);
      const topX = x + sign * 0.58;
      for (let z = -half; z <= half + 0.01; z += 0.19) {
        line(x, GOAL_HEIGHT, z, topX, GOAL_HEIGHT - 0.08, z);
        line(topX, GOAL_HEIGHT - 0.08, z, backX, 0.06, z);
      }
      for (let y = 0.06; y < GOAL_HEIGHT; y += 0.18) {
        const depth = THREE.MathUtils.lerp(backX, topX, y / GOAL_HEIGHT);
        line(depth, y, -half, depth, y, half);
        for (const z of [-half, half]) line(x, y, z, depth, y, z);
      }
      for (let depth = 0.20; depth <= 2.1; depth += 0.20) {
        const height = depth < 0.58 ? GOAL_HEIGHT : GOAL_HEIGHT * (1 - (depth - 0.58) / 1.52);
        for (const z of [-half, half]) line(x + sign * depth, 0.05, z, x + sign * depth, height, z);
      }
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(net, 3));
      const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#dae7e4', transparent: true, opacity: 0.42, depthWrite: false }));
      this.goalNets.push(mesh);
      this.netRestPositions.push(new Float32Array(net));
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
          positions.push(new THREE.Vector3(along, 0.84 + row * 0.62, sign * (41 + row * 0.95)));
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
    this.stadium.add(bodies, heads);
  }

  private updateBall(state: VisualState, dt: number, replay: boolean): void {
    const x = (state.ball.x - FIELD_LENGTH / 2) * state.attackDirection;
    const z = state.ball.y - FIELD_WIDTH / 2;
    const h = Math.max(0, state.ball.z);
    const next = new THREE.Vector3(x, h + 0.265, z);
    const travelled = next.distanceTo(this.ball.position);
    this.ball.position.copy(next);
    this.ball.rotation.x += state.ball.vy * dt / 0.255;
    this.ball.rotation.z -= state.ball.vx * state.attackDirection * dt / 0.255;
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
      if (travelled > 0.04 || !this.trailPoints.length) this.trailPoints.unshift(next.clone());
      if (this.trailPoints.length > 12) this.trailPoints.length = 12;
      const position = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 12; i++) {
        const p = this.trailPoints[Math.min(i, this.trailPoints.length - 1)] ?? next;
        position.setXYZ(i, p.x, p.y, p.z);
      }
      position.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trailPoints.length);
      this.trail.material.opacity = replay ? 0.23 : 0.35;
    } else this.trailPoints.length = 0;
  }

  private updateAtmosphere(match: ArcadeMatch, dt: number): void {
    const reduced = match.config.camera.reducedMotion;
    const goalAge = this.time - this.goalTime;
    this.crowdUniform.value = this.time;
    this.crowdEnergy.value = reduced ? 0 : goalAge < 4 ? 0.12 : 0.009;
    this.weather.visible = !reduced && match.config.weather !== 'clear' && this.quality !== 'low';
    if (this.weather.visible) this.weather.position.y = -(this.time * 10 % 11.4);
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
    const mapW = 150 * s, mapH = mapW * FIELD_WIDTH / FIELD_LENGTH;
    const mapX = (w - mapW) / 2, mapY = h - mapH - 15 * s;
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
      const left = 18 * s, bottom = h - 25 * s;
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
    if (replay) {
      ctx.font = `700 ${15 * s}px system-ui, sans-serif`; ctx.fillStyle = '#ffde7b';
      ctx.fillText('●  REPLAY', 22 * s, 37 * s);
    }
    if (!replay && match.rule.phase !== 'playing' && match.rule.phase !== 'advantage') {
      const names: Record<string, string> = { kickoff: 'ANSTOSS', freeKick: 'FREISTOSS', corner: 'ECKBALL', throwIn: 'EINWURF', goalKick: 'ABSTOSS', penalty: 'ELFMETER' };
      const label = names[match.rule.phase];
      if (label) {
        ctx.font = `600 ${13 * s}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(9,26,33,.72)'; ctx.beginPath(); ctx.roundRect(w / 2 - 94 * s, 16 * s, 188 * s, 31 * s, 5 * s); ctx.fill();
        ctx.fillStyle = '#f5efcf'; ctx.fillText(label, w / 2, 37 * s); ctx.textAlign = 'left';
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

  private adaptQuality(dt: number): void {
    this.qualityCooldown -= dt;
    this.sampleFrames++;
    this.sampleTime += dt;
    if (this.sampleFrames < 150) return;
    const average = this.sampleTime / this.sampleFrames;
    if (this.qualityCooldown <= 0 && average > 0.024 && this.quality !== 'low') {
      this.setQuality(this.quality === 'high' ? 'balanced' : 'low');
      this.qualityCooldown = 8;
    }
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
      ctx.fillStyle = stripe % 2 ? wet ? '#398451' : '#409655' : wet ? '#347a4a' : '#37884d';
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
    ctx.strokeStyle = '#e5edce'; ctx.fillStyle = '#e5edce'; ctx.lineWidth = 0.13 * sx;
    const rect = (x: number, y: number, w: number, h: number) => ctx.strokeRect(x * sx, y * sy, w * sx, h * sy);
    const line = (x: number, y: number, bx: number, by: number) => { ctx.beginPath(); ctx.moveTo(x * sx, y * sy); ctx.lineTo(bx * sx, by * sy); ctx.stroke(); };
    const arc = (x: number, y: number, r: number, a: number, b: number) => { ctx.beginPath(); ctx.arc(x * sx, y * sy, r * sx, a, b); ctx.stroke(); };
    const dot = (x: number, y: number) => { ctx.beginPath(); ctx.arc(x * sx, y * sy, 0.17 * sx, 0, Math.PI * 2); ctx.fill(); };
    rect(0.1, 0.1, 104.8, 67.8); line(52.5, 0, 52.5, 68); arc(52.5, 34, 9.15, 0, Math.PI * 2); dot(52.5, 34);
    rect(0, 13.84, 16.5, 40.32); rect(88.5, 13.84, 16.5, 40.32);
    rect(0, 24.84, 5.5, 18.32); rect(99.5, 24.84, 5.5, 18.32); dot(11, 34); dot(94, 34);
    const a = Math.acos(5.5 / 9.15); arc(11, 34, 9.15, -a, a); arc(94, 34, 9.15, Math.PI - a, Math.PI + a);
    arc(0, 0, 1, 0, Math.PI / 2); arc(105, 0, 1, Math.PI / 2, Math.PI);
    arc(0, 68, 1, -Math.PI / 2, 0); arc(105, 68, 1, Math.PI, Math.PI * 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
