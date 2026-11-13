import { dnaOf } from '../../core/rpg/player-dna';
import { AURA_FROM, RARITY_DEFS, Rarity, atLeast } from '../../data/rarity';
import * as THREE from 'three';
import { ArcadeActor, ArcadeMatch, FIELD_LENGTH, FIELD_WIDTH, GOAL_WIDTH, GOAL_HEIGHT, PITCH, applyPitch } from '../../core/services/arcade-match';
import { resolveMatchKits, MatchKitSelection } from '../../core/kit-visuals';
import { contrastRatio, contrastText, hash32 } from '../../core/visual-identity';
import { ReplayShot, flashLit } from './replay-director';
import { MatchRenderFrame, MatchRenderState, MatchSnapshot, PlayerRuntimeSnapshot } from '../../models/match.model';
import { MATCH_TICK } from '../../core/football/match-types';
import { RefereeRig } from './animation/referee';
import { GpuTimer } from './gpu-timer';
import { decideQuality } from './quality-policy';
import { DEFAULT_GRAPHICS_PREFS, GraphicsPrefs } from '../../core/graphics-prefs';
import { loadClipSet } from './animation/clip-store';
import { createPlayerVisualIdentity } from '../../core/visual-identity';
import { createProceduralFootballer, poseFootballer, ProceduralFootballer } from './three-player.factory';
import { interpolateThreeFrame, playerInCameraSpace, RenderInterpolationScratch } from './three-render-state';
import { usesSoftwareGraphics } from './graphics-capabilities';
import { advanceBroadcastCamera } from './broadcast-camera';
import { RenderCadence } from './render-cadence';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MatchCameraPreset } from '../../models/match.model';
import { WEAR_HEIGHT, WEAR_WIDTH, stampWear } from './pitch-wear';
import { CosmeticDef } from '../../core/meta/legend-path';
import { CosmeticSlot } from '../../models/meta.model';
import { KitPattern } from '../../models/visual.model';
import { BallMesh, createBallMesh, paintBall } from './ball-mesh';
import { BALL_RADIUS, netBallMotion, netBulge, netHitStrength, netSlack, netStopDepth, NET_REST_POCKET } from './net-physics';

/** Camera angle (degrees above the pitch), lens and framing per broadcast preset. */
export const CAMERA_PRESETS: Record<MatchCameraPreset, { pitch: number; fov: number; width: number; follow: number }> = {
  arcade: { pitch: 30, fov: 40, width: 0.8, follow: 1 },
  tv: { pitch: 25, fov: 32, width: 1.1, follow: 0.3 },
  tactic: { pitch: 60, fov: 46, width: 1.55, follow: 1 },
  /** Close behind the player you control: low, tight, and the ball only a little in the picture. */
  player: { pitch: 36, fov: 44, width: 0.52, follow: 1 },
};
const AURA_FLASH = new THREE.Color('#ffffff');
const BALL_PANEL = '#1c3651';
const BALL_BODY = '#fcfaf1';

/**
 * Vignette and colour grading before tone mapping, in one full-screen pass: a tint, a saturation and a contrast, chosen per
 * atmosphere and weather. One pass instead of two keeps it affordable on the balanced profile.
 */
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tint: { value: new THREE.Vector3(1, 1, 1) }, saturation: { value: 1 }, contrast: { value: 1 }, vignetteOffset: { value: 1.02 }, vignetteDarkness: { value: 0.85 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform vec3 tint; uniform float saturation; uniform float contrast; uniform float vignetteOffset; uniform float vignetteDarkness; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); vec2 v = (vUv - 0.5) * vignetteOffset; c.rgb = mix(c.rgb, vec3(1.0 - vignetteDarkness), dot(v, v)); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); vec3 g = mix(vec3(l), c.rgb, saturation) * tint; g = (g - 0.18) * contrast + 0.18; gl_FragColor = vec4(max(g, 0.0), c.a); }',
};

/** Lays the wear map over the grass: worn turf turns browner. Works for the lit and the unlit pitch material alike. */
function addWear(material: THREE.Material, texture: THREE.Texture, mirror: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['wearMap'] = { value: texture };
    shader.uniforms['wearMirror'] = mirror;
    shader.fragmentShader = 'uniform sampler2D wearMap;\nuniform float wearMirror;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 wearUv = vec2(wearMirror > 0.0 ? vMapUv.x : 1.0 - vMapUv.x, vMapUv.y);
      float worn = texture2D(wearMap, wearUv).r;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.7, 0.52), min(1.0, worn * 2.4) * 0.85);`);
  };
  material.customProgramCacheKey = () => 'pitch-wear';
}

export interface Grade { tint: [number, number, number]; saturation: number; contrast: number }
/** The look of each atmosphere; bad weather drains the colour. Pure, so the tests can check the table. */
export function gradeFor(atmosphere: 'day' | 'sunset' | 'night', weather: 'clear' | 'rain' | 'storm' | 'snow'): Grade {
  const base: Grade = atmosphere === 'night' ? { tint: [0.95, 1.0, 1.07], saturation: 1.05, contrast: 1.05 }
    : atmosphere === 'sunset' ? { tint: [1.07, 0.98, 0.9], saturation: 1.1, contrast: 1.04 }
    : { tint: [1.02, 1.0, 0.97], saturation: 1.06, contrast: 1.03 };
  if (weather === 'rain') return { tint: [base.tint[0] * 0.97, base.tint[1] * 0.99, base.tint[2] * 1.03], saturation: base.saturation * 0.82, contrast: base.contrast * 0.98 };
  if (weather === 'storm') return { tint: [base.tint[0] * 0.94, base.tint[1] * 0.97, base.tint[2] * 1.05], saturation: base.saturation * 0.7, contrast: base.contrast * 1.06 };
  if (weather === 'snow') return { tint: [base.tint[0] * 0.98, base.tint[1] * 1.01, base.tint[2] * 1.05], saturation: base.saturation * 0.86, contrast: base.contrast * 0.97 };
  return base;
}
/** The four floodlight masts of the ground, in scene coordinates (x along the pitch, z across). */
const MAST_POSITIONS: readonly [number, number][] = [[-62, -44], [62, -44], [-62, 44], [62, 44]];

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
  /** Smoothed GPU time per frame, or null when the browser has no GPU timer. */
  gpuMilliseconds: number | null;
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
  /** The composer outlives quality changes (rebuilding it mid-match stalls); it only draws on the high profile. */
  private composerActive = false;
  private bloom: UnrealBloomPass | null = null;
  private readonly flags: THREE.Mesh[] = [];
  /** The scrolling LED board textures. */
  private readonly ledTextures: THREE.Texture[] = [];
  private turf!: THREE.Points;
  private readonly turfVelocity = new Float32Array(64 * 3);
  private readonly turfLife = new Float32Array(64);
  private turfCursor = 0;
  private readonly turfSpawned = new Map<string, number>();
  private lastEventCount = 0;
  private shake = 0;
  /** Camera of the goal replay, chosen by the page from what happened (see replay-director). */
  private replayShot: ReplayShot = 'broadcast';
  /** Camera flashes in the stands after a goal; rebuilt with the stadium. */
  private flashes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private celebration: { scorerId: string; elapsed: number } | null = null;
  private pitchMaterial: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null = null;
  private sunHeight = 75;
  private minimap = true;
  private readonly cullFrustum = new THREE.Frustum();
  private readonly cullMatrix = new THREE.Matrix4();
  private readonly cullSphere = new THREE.Sphere(new THREE.Vector3(), 2.3);
  private readonly models = new Map<string, ProceduralFootballer>();
  private readonly matrixDummy = new THREE.Object3D();
  private readonly shadow: THREE.InstancedMesh;
  /** The ball's panels (pentagons, hexagons, stitching), so a ball design can repaint it. */
  private readonly ballMesh: BallMesh = createBallMesh(0.11);
  /** What the Legends Path wears in matches: only drawn, never read by the simulation. */
  private cosmetics: { ball?: string; cheer?: number; decor?: string; kit?: KitPattern } = {};
  /** Under floodlights every player throws four faint shadows, one away from each mast: soft ellipses instead of more shadow maps. */
  private readonly mastShadows: THREE.InstancedMesh;
  private floodlit = false;
  /** Where players have worn the pitch: real pitch coordinates, one byte per texel. */
  private readonly wear = new Uint8Array(WEAR_WIDTH * WEAR_HEIGHT);
  private readonly wearTexture = new THREE.DataTexture(this.wear, WEAR_WIDTH, WEAR_HEIGHT, THREE.RedFormat, THREE.UnsignedByteType);
  private readonly wearMirror = { value: 1 };
  private wearClock = 0;
  private wearStamp = false;
  private wearUploaded = 0;
  private readonly selection: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Rarity rings under Epic and better players, one instance per ring. */
  private readonly aura: THREE.InstancedMesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly auraColor = new THREE.Color();
  private readonly auraRarity = new Map<string, Rarity>();
  /** Players whose signature is awake this frame; their ring flares. */
  private awakeIds = new Set<string>();
  private previousAwake = new Set<string>();
  /** Expanding rings where a Legendary or Mythic signature just woke up. */
  private readonly flares: { id: string; age: number; color: string }[] = [];
  private readonly arrow: THREE.Mesh;
  /** A broken ring under the team-mate the switch button would take next. */
  private readonly switchRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Shirt number and position group per player, for the markers the HUD draws. */
  private readonly hudInfo = new Map<string, { number: number; keeper: boolean }>();
  /** Where the four corners of the picture meet the grass (scene x and z), for the view outline on the minimap. */
  private readonly viewCorners = new Float32Array(8);
  private readonly power: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly ball: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly ballShadow: THREE.Mesh;
  private readonly ballHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly trail: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly trailPoints: THREE.Vector3[] = [];
  private readonly ribbonAxis = new THREE.Vector3();
  private readonly ribbonSide = new THREE.Vector3();
  private readonly ballPosition = new THREE.Vector3();
  private readonly spinAxis = new THREE.Vector3();
  private readonly spinQuat = new THREE.Quaternion();
  private readonly camPosition = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly camIntro = new THREE.Vector3();
  /** Simulation time shown so far: pose blends and the ball roll follow it, so slow motion slows them too. */
  private poseClock = 0;
  /** The referee is only drawn: no part of the simulation. */
  private referee: RefereeRig | null = null;
  private lastStateTick = -1;
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
  /** Snowflakes: soft white dots that drift down and sway; only in snow, never with reduced motion. */
  private readonly snow: THREE.Points;
  /** Splashes where the rain hits the pitch: dots that flash up for a moment, each one at a new place. */
  private readonly splashes: THREE.Points;
  private quality: PitchQuality;
  private readonly mobile: boolean;
  /** Started on the high profile: only then do shadow map and post-processing exist, and they stay for the whole match. */
  private readonly startedHigh: boolean;
  /** The match started on a profile with post-processing (high or balanced): the composer then draws the whole match. */
  private readonly startedPost: boolean;
  /** Quality follows the frame time; a fixed profile chosen in the settings never changes. */
  private readonly adaptive: boolean;
  private gpuTimer: GpuTimer | null = null;
  private gradePass: ShaderPass | null = null;
  private grade: Grade = { tint: [1, 1, 1], saturation: 1, contrast: 1 };
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
  /** Minimap dots wear the shirts: fill is the shirt colour, the rim keeps dark kits readable on the dark panel. */
  private mapDots = { home: { fill: '#73e4cf', rim: '#06120b', weight: 0.6 }, away: { fill: '#fc9b9f', rim: '#06120b', weight: 0.6 } };
  private time = 0;
  private goalTime = -100;
  /** Scene side of the net that was hit: -1 or 1, indexing goalNets 0 and 1. */
  private netSide = 1;
  /** The ball that crossed the line and is held by the net: where and how fast it came in. */
  private netEntry: { side: 1 | -1; time: number; depth: number; height: number; z: number; speed: number } | null = null;
  /** The bulge in the net the ball hit: the net index, the point it stopped at and how hard it came. */
  private netHit: { index: number; strength: number; time: number; px: number; py: number; pz: number } | null = null;
  /** Eased 0 to 1: whether a ball still lies in the net (the pocket it pushes out). */
  private netRest = 0;
  private recentBallSpeed = 0;
  private cameraX = 0;
  private cameraZ = 0;
  private viewWidth = 91;
  private lastDirection = 1;
  private cameraInitialized=false;
  private contextLost = false;
  private disposed = false;
  private lastHud = -1;
  /** Base light levels of this stadium; a storm's lightning lifts them for a moment. */
  private fillBase = 1;
  private rimBase = 1;
  private softDot: THREE.CanvasTexture | null = null;
  /** Aim preview: the dotted flight of a charged lob or cross, the spot a ball in the air comes down and its height line. */
  private readonly aimDots: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly landingRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly heightLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly tagPoint = new THREE.Vector3();
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

  constructor(private readonly canvas: HTMLCanvasElement, private readonly prefs: GraphicsPrefs = DEFAULT_GRAPHICS_PREFS) {
    this.mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.quality = prefs.quality !== 'auto' ? prefs.quality : this.mobile ? 'balanced' : 'high';
    this.software=usesSoftwareGraphics();
    this.adaptive = prefs.quality === 'auto';
    this.pixelRatio = this.pixelRatioFor(this.quality);
    this.cadence=new RenderCadence(prefs.frameCap > 0 ? 1 / prefs.frameCap : this.software ? 1 / 30 : 0);
    if (this.software) { this.quality = 'low'; this.pixelRatio = .35; }
    this.startedHigh = this.quality === 'high' && !this.software;
    this.startedPost = this.quality !== 'low' && !this.software;
    // With post-processing the picture is anti-aliased in the composer's own target; smoothing the canvas as well would do it twice.
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: !this.software && !this.startedPost, powerPreference: 'high-performance' });
    const timer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.gpuTimer = timer.available ? timer : null;
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
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.065;
    this.sun.shadow.camera.updateProjectionMatrix();

    const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#071f1d', transparent: true, opacity: 0.30, depthWrite: false });
    this.shadow = new THREE.InstancedMesh(new THREE.CircleGeometry(0.46, 12), shadowMaterial, 32);
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadow.frustumCulled = false;
    this.scene.add(this.shadow);
    this.mastShadows = new THREE.InstancedMesh(new THREE.CircleGeometry(0.46, 12), new THREE.MeshBasicMaterial({ color: '#071f1d', transparent: true, opacity: 0.075, depthWrite: false }), 32 * MAST_POSITIONS.length);
    this.mastShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mastShadows.frustumCulled = false;
    this.mastShadows.visible = false;
    this.scene.add(this.mastShadows);
    this.selection = new THREE.Mesh(new THREE.RingGeometry(0.69, 0.79, 40), new THREE.MeshBasicMaterial({ color: '#ffe875', transparent: true, opacity: 0.97, depthWrite: false, toneMapped: false }));
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.renderOrder = 4;
    this.scene.add(this.selection);
    this.aura = new THREE.InstancedMesh(new THREE.RingGeometry(0.93, 1.1, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }), 32);
    this.aura.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.aura.frustumCulled = false;
    this.aura.renderOrder = 3;
    this.aura.count = 0;
    this.scene.add(this.aura);
    const arcs = [0, 1, 2, 3].map(i => new THREE.RingGeometry(0.7, 0.78, 10, 1, i * Math.PI / 2 + 0.3, Math.PI / 2 - 0.6));
    this.switchRing = new THREE.Mesh(mergeGeometries(arcs)!, new THREE.MeshBasicMaterial({ color: SELECTION_FREE, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
    arcs.forEach(arc => arc.dispose());
    this.switchRing.rotation.x = -Math.PI / 2;
    this.switchRing.renderOrder = 4;
    this.switchRing.visible = false;
    this.scene.add(this.switchRing);
    const arrowGeometry = new THREE.ConeGeometry(0.20, 0.33, 3);
    this.arrow = new THREE.Mesh(arrowGeometry, new THREE.MeshBasicMaterial({ color: '#ffe875', depthTest: false, toneMapped: false }));
    this.arrow.rotation.z = Math.PI;
    this.arrow.renderOrder = 5;
    this.scene.add(this.arrow);
    this.power = new THREE.Mesh(new THREE.RingGeometry(0.89, 1.01, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    this.power.rotation.x = -Math.PI / 2;
    this.scene.add(this.power);

    const ballGeometry = this.ballMesh.geometry;
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
    this.softDot = createSoftDot();
    this.aimDots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(72 * 3), 3)),
      new THREE.PointsMaterial({ color: '#fff3b0', size: 0.5, map: this.softDot, alphaTest: 0.02, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, toneMapped: false }));
    this.aimDots.frustumCulled = false; this.aimDots.visible = false; this.aimDots.renderOrder = 6;
    this.scene.add(this.aimDots);
    this.landingRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32), new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    this.landingRing.rotation.x = -Math.PI / 2; this.landingRing.visible = false; this.landingRing.renderOrder = 4;
    this.scene.add(this.landingRing);
    this.heightLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)),
      new THREE.LineBasicMaterial({ color: '#fbf7ce', transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
    this.heightLine.frustumCulled = false; this.heightLine.visible = false;
    this.scene.add(this.heightLine);
    this.turf = new THREE.Points(turfGeometry, new THREE.PointsMaterial({ color: '#3f7a3c', size: 0.17, map: this.softDot, alphaTest: 0.02, transparent: true, opacity: 0.9, depthWrite: false }));
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
    this.confetti = new THREE.Points(confettiGeometry, new THREE.PointsMaterial({ size: 0.24, map: this.softDot, alphaTest: 0.02, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, toneMapped: false }));
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
    const flakes = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) flakes.set([(hash32(`snow-x-${i}`) % 1250) / 10 - 62.5, (hash32(`snow-y-${i}`) % 140) / 10, (hash32(`snow-z-${i}`) % 800) / 10 - 40], i * 3);
    this.snow = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(flakes, 3)), new THREE.PointsMaterial({ size: 0.2, map: this.softDot, color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, alphaTest: 0.02, toneMapped: false }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.scene.add(this.snow);
    this.splashes = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(120 * 3).fill(-9), 3)), new THREE.PointsMaterial({ size: 0.26, map: this.softDot, color: '#e8f6ff', transparent: true, opacity: 0.5, depthWrite: false, alphaTest: 0.02, toneMapped: false }));
    this.splashes.frustumCulled = false;
    this.splashes.visible = false;
    this.scene.add(this.splashes);

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
    // The baked animation clips are optional: without them the procedural poses carry on.
    await loadClipSet();
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
    this.shake = Math.max(this.shake, 0.5);
    const side = this.ball.position.x >= 0 ? 1 : -1;
    this.netSide = side;
    for (let i = 0; i < 160; i++) {
      this.confettiOrigins.set([side * (FIELD_LENGTH / 2 + .5), 0.2 + i % 4, (i % 2 ? -1 : 1) * (5 + i % 7)], i * 3);
      this.confettiVelocity.set([((hash32(`gx${i}`) % 100) / 100 - 0.5) * 7, 4 + (hash32(`gy${i}`) % 80) / 10, ((hash32(`gz${i}`) % 100) / 100 - 0.5) * 8], i * 3);
    }
  }

  setReplayShot(shot: ReplayShot): void { this.replayShot = shot; }

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
    const tickDelta = this.lastStateTick < 0 ? 0 : state.tick - this.lastStateTick;
    this.lastStateTick = state.tick;
    // Pauses and jumps (replay start, restores) advance nothing; live play and slow motion advance by the ticks shown.
    const simDt = tickDelta > 0 && tickDelta <= 12 ? tickDelta * MATCH_TICK : 0;
    this.poseClock += simDt;
    this.ensureMatch(match);
    this.updateCamera(match, state, dt, !!replay);
    this.camera.updateMatrixWorld();
    this.cullFrustum.setFromProjectionMatrix(this.cullMatrix.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse));
    const mirror = state.attackDirection;
    const lookAt = { x: mirror > 0 ? state.ball.x : -state.ball.x, y: state.ball.y };
    this.watchEvents(match);
    let index = 0;
    let mastIndex = 0;
    // The wear map is stamped every sixth frame of the live match (not in replays) and uploaded twice a second.
    this.wearMirror.value = mirror;
    this.wearStamp = !replay && ++this.wearClock % 6 === 0;
    let auraIndex = 0;
    const auraMode = this.quality === 'low' || this.software ? 'off' : match.config.auras ?? 'on';
    // Last frame's set becomes the previous one; swapping avoids a new Set per frame.
    const lastAwake = this.awakeIds;
    this.awakeIds = this.previousAwake;
    this.previousAwake = lastAwake;
    this.awakeIds.clear();
    if (auraMode !== 'off') for (const actor of match.actors) if (actor.sig) for (const runtime of actor.sig) if (runtime.awake) { this.awakeIds.add(actor.player.id); break; }
    for (const id of this.awakeIds) {
      const rarity = this.auraRarity.get(id);
      if (!this.previousAwake.has(id) && (rarity === 'legendary' || rarity === 'mythic') && this.flares.length < 8) this.flares.push({ id, age: 0, color: RARITY_DEFS[rarity].aura });
    }
    this.aura.material.opacity = auraMode === 'subtle' ? 0.38 : 0.75;
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
      // Injuries are known to the match, not to the render state; the limp is a render-only flag that never feeds back.
      poseFootballer(model, playerInCameraSpace(player,mirror,this.mirroredPlayer), state.tick, this.poseClock, match.config.camera.reducedMotion,player.id===state.controlledPlayerId&&!replay?match.actionPower:0, lookAt, match.isInjured(player.id) ? 1 : 0);
      if (player.action === 'slide' && state.tick - player.actionStartedTick < 3 && this.turfSpawned.get(player.id) !== player.actionStartedTick) {
        this.turfSpawned.set(player.id, player.actionStartedTick);
        this.spawnTurf(model.mesh.position.x, model.mesh.position.z, 12, 3.2);
      }
      if (player.contact && state.tick - player.contact.tick < 2 && Math.hypot(state.ball.vx, state.ball.vy) > 24 && this.turfSpawned.get(`${player.id}:c`) !== player.contact.tick) {
        this.turfSpawned.set(`${player.id}:c`, player.contact.tick);
        this.spawnTurf((player.contact.x - FIELD_LENGTH / 2) * mirror, player.contact.y - FIELD_WIDTH / 2, 7, 2.4);
      }
      // Footsteps wear the turf: ten stamps a second are plenty; the camera mirror is undone so wear stays where it happened.
      if (this.wearStamp) stampWear(this.wear, player.x, player.y, FIELD_LENGTH, FIELD_WIDTH, Math.hypot(player.vx, player.vy) > 3 ? 3 : 1);
      this.matrixDummy.position.copy(model.mesh.position).setY(0.014);
      this.matrixDummy.rotation.set(-Math.PI / 2, 0, 0);
      this.matrixDummy.scale.set(1.0, 0.66, 1);
      this.matrixDummy.updateMatrix();
      this.shadow.setMatrixAt(index++, this.matrixDummy.matrix);
      if (this.floodlit && this.quality !== 'low') {
        // One long faint shadow per mast, pointing away from it.
        const px = model.mesh.position.x, pz = model.mesh.position.z;
        this.matrixDummy.rotation.order = 'YXZ';
        for (const [mx, mz] of MAST_POSITIONS) {
          const dx = px - mx, dz = pz - mz, length = Math.hypot(dx, dz) || 1;
          this.matrixDummy.position.set(px + dx / length * 0.55, 0.013, pz + dz / length * 0.55);
          this.matrixDummy.rotation.set(-Math.PI / 2, -Math.atan2(dz, dx), 0);
          this.matrixDummy.scale.set(1.45, 0.46, 1);
          this.matrixDummy.updateMatrix();
          this.mastShadows.setMatrixAt(mastIndex++, this.matrixDummy.matrix);
        }
        this.matrixDummy.rotation.order = 'XYZ';
      }
      const rarity = auraMode === 'off' ? undefined : this.auraRarity.get(player.id);
      const awake = auraMode !== 'off' && this.awakeIds.has(player.id);
      if ((rarity || awake) && auraIndex < 32) {
        const still = match.config.camera.reducedMotion;
        const pulse = still ? 1 : 1 + (awake ? 0.14 : 0.07) * Math.sin(this.time * (awake ? 7 : 3) + auraIndex);
        const size = (rarity === 'mythic' ? 1.28 : rarity === 'legendary' ? 1.14 : 1) * pulse * (awake ? 1.35 : 1);
        this.matrixDummy.position.copy(model.mesh.position).setY(0.02);
        this.matrixDummy.rotation.set(-Math.PI / 2, 0, 0);
        this.matrixDummy.scale.set(size, size, 1);
        this.matrixDummy.updateMatrix();
        this.aura.setMatrixAt(auraIndex, this.matrixDummy.matrix);
        if (rarity === 'mythic') this.auraColor.setHSL(still ? 0.52 : (this.time * 0.2) % 1, 0.9, 0.62);
        else this.auraColor.set(rarity ? RARITY_DEFS[rarity].aura : '#ffffff');
        if (awake) this.auraColor.lerp(AURA_FLASH, 0.5);
        this.aura.setColorAt(auraIndex++, this.auraColor);
      }
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
    for (let flare = this.flares.length - 1; flare >= 0; flare--) {
      const entry = this.flares[flare];
      entry.age += dt;
      const model = this.models.get(entry.id);
      if (entry.age > 0.8 || !model || auraIndex >= 32) { if (entry.age > 0.8 || !model) this.flares.splice(flare, 1); continue; }
      const size = 1.4 + entry.age * 5.5;
      this.matrixDummy.position.copy(model.mesh.position).setY(0.024);
      this.matrixDummy.rotation.set(-Math.PI / 2, 0, 0);
      this.matrixDummy.scale.set(size, size, 1);
      this.matrixDummy.updateMatrix();
      this.aura.setMatrixAt(auraIndex, this.matrixDummy.matrix);
      this.auraColor.set(entry.color).multiplyScalar(Math.max(0, 1 - entry.age / 0.8));
      this.aura.setColorAt(auraIndex++, this.auraColor);
    }
    this.shadow.count = index;
    if (this.wearStamp && this.time - this.wearUploaded > 0.5) { this.wearTexture.needsUpdate = true; this.wearUploaded = this.time; }
    this.mastShadows.count = mastIndex;
    this.mastShadows.visible = this.floodlit && this.quality !== 'low' && mastIndex > 0;
    this.mastShadows.instanceMatrix.needsUpdate = true;
    this.aura.count = auraIndex;
    this.aura.instanceMatrix.needsUpdate = true;
    if (this.aura.instanceColor) this.aura.instanceColor.needsUpdate = true;
    this.shadow.instanceMatrix.needsUpdate = true;
    this.selection.visible = !!this.models.get(state.controlledPlayerId)?.mesh.visible;
    this.arrow.visible = this.selection.visible;
    // The next switch candidate is only of interest while the other side or nobody has the ball.
    const hunting = !replay && !this.celebration && match.config.controllerMode === 'human' && match.rule.phase === 'playing' && match.owner()?.side !== match.controlledSide;
    const nextModel = hunting ? this.models.get(match.switchTarget() ?? '') : undefined;
    this.switchRing.visible = !!nextModel?.mesh.visible;
    if (nextModel && this.switchRing.visible) {
      this.switchRing.position.copy(nextModel.mesh.position).setY(0.026);
      if (!match.config.camera.reducedMotion) this.switchRing.rotation.z = this.time * 0.9;
    }
    this.updateBall(state, dt, simDt, !!replay);
    this.updateAim(match, state, !!replay || !!this.celebration);
    if (this.referee) {
      this.referee.model.mesh.visible = this.quality !== 'low';
      if (this.quality !== 'low') this.referee.update((state.ball.x - FIELD_LENGTH / 2) * mirror, state.ball.y - FIELD_WIDTH / 2, simDt, this.poseClock, state.tick, match.config.camera.reducedMotion);
    }
    this.updateAtmosphere(match, dt);
    this.updateTurf(dt);
    if (this.bloom) this.bloom.strength = 0.25 + Math.max(0, 1 - (this.time - this.goalTime) / 1.5) * 0.45;
    this.updateFlashes();
    this.renderer.info.reset();
    this.gpuTimer?.begin();
    if (this.composer && this.composerActive) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.gpuTimer?.end();
    this.gpuTimer?.poll();
    // The minimap follows every frame; only software rendering keeps the old 11 Hz.
    if (this.time - this.lastHud > (this.software ? 0.09 : 0)) {
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
      renderMilliseconds: this.renderMilliseconds, gpuMilliseconds: this.gpuTimer?.ms ?? null, contextLost: this.contextLost, targetFps: this.prefs.frameCap || (this.software ? 30 : 60) };
  }

  setQuality(quality: PitchQuality): void {
    this.quality = quality;
    this.pixelRatio = this.pixelRatioFor(quality);
    if (this.startedHigh) {
      // Switching the shadow map off recompiles every material (a stall of about a third of a second). It stays compiled in;
      // below the high profile it simply stops updating and fades to nothing.
      this.renderer.shadowMap.autoUpdate = quality === 'high';
      if (quality === 'high') this.renderer.shadowMap.needsUpdate = true;
      this.sun.shadow.intensity = quality === 'high' ? 1 : 0;
    }
    this.configureComposer();
    this.resize();
    this.canvas.dataset['quality'] = quality;
    this.stadium.traverse(object => { if (object.name === 'crowd') object.visible = quality !== 'low'; });
  }

  /** Render resolution for a profile: the device's pixel ratio capped per profile, times the render scale chosen in the settings. */
  private pixelRatioFor(quality: PitchQuality): number {
    if (this.software) return 0.35;
    const cap = quality === 'high' ? 1.75 : quality === 'balanced' ? (this.mobile ? 1.35 : 1.25) : 0.85;
    return Math.min(window.devicePixelRatio || 1, cap) * this.prefs.renderScale;
  }

  /**
   * Tone mapping, bloom, vignette and grade as a post-process. A match that starts on the high or the balanced profile uses the
   * composer throughout: changing the profile only switches passes on and off, so the materials keep their programs. Balanced
   * gets the look (grade and vignette in one pass) without the bloom.
   */
  private configureComposer(): void {
    const wanted = this.startedPost;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = this.quality === 'high' ? 0.14 : 0.30;
    // On the shadow-map profile the ball already casts a real shadow; its blob only keeps it readable.
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = this.quality === 'high' ? 0.18 : 0.50;
    this.composerActive = wanted;
    if (!wanted) return;
    if (this.composer) { this.setPostPasses(); return; }
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.startedHigh ? 4 : 2 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Only genuinely bright sources (lamps, goal flash) bloom; lit kits and markings stay crisp.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(640, 360), 0.25, 0.4, 2.2);
    composer.addPass(this.bloom);
    // Vignette and grade come last before tone mapping, so they work on the full range of the picture.
    this.gradePass = new ShaderPass(GradeShader);
    composer.addPass(this.gradePass);
    this.pushGrade();
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.setPostPasses();
  }

  private setPostPasses(): void {
    if (this.bloom) this.bloom.enabled = this.quality === 'high';
    if (this.gradePass) this.gradePass.enabled = this.quality !== 'low';
  }

  /** Sets the colour grade of the ground: its atmosphere and the weather of the match. */
  private applyGrade(atmosphere: 'day' | 'sunset' | 'night', weather: 'clear' | 'rain' | 'storm' | 'snow'): void {
    this.grade = gradeFor(atmosphere, weather);
    this.pushGrade();
  }

  private pushGrade(): void {
    if (!this.gradePass) return;
    (this.gradePass.uniforms['tint'].value as THREE.Vector3).set(...this.grade.tint);
    this.gradePass.uniforms['saturation'].value = this.grade.saturation;
    this.gradePass.uniforms['contrast'].value = this.grade.contrast;
  }

  /** The colour of the worn ground decor: the club's shirt for 'club', a fixed colour otherwise, nothing without one. */
  private decorColor(match: ArcadeMatch): string | null {
    const decor = this.cosmetics.decor;
    return !decor ? null : decor === 'club' ? match.home.visuals.kits.home.shirt : decor;
  }

  /** The worn rewards of the Legends Path. Call before `prepare`; the ball is repainted at once. */
  setCosmetics(worn: Partial<Record<CosmeticSlot, CosmeticDef>>): void {
    this.cosmetics = {
      ball: worn.ball?.value,
      cheer: worn.cheer ? Number(worn.cheer.value) : undefined,
      decor: worn.decor?.value,
      kit: worn.kit?.value as KitPattern | undefined,
    };
    const [panel, body] = (this.cosmetics.ball ?? `${BALL_PANEL}|${BALL_BODY}`).split('|');
    paintBall(this.ballMesh, panel, body);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gpuTimer?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.hud.remove();
    for (const model of this.models.values()) model.destroy();
    this.models.clear();
    this.referee?.destroy();
    this.referee = null;
    this.softDot?.dispose();
    this.scene.environment?.dispose();
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
      // An idle composer keeps its shaders but shrinks its MSAA target to a single pixel.
      const w = this.composerActive ? this.width : 1, h = this.composerActive ? this.height : 1;
      this.composer.setPixelRatio(this.composerActive ? this.pixelRatio : 1);
      this.composer.setSize(w, h);
      this.bloom?.resolution.set(w / 2, h / 2);
    }
    // The HUD canvas follows the device pixel ratio (capped at 2), so text and minimap stay sharp on HiDPI screens.
    const hudRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.hud.width = Math.round(Math.min(2400, Math.max(640, this.width * hudRatio)));
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
    const limitX = Math.max(4, FIELD_LENGTH / 2 - 9.5), limitZ = Math.max(3, FIELD_WIDTH / 2 - 10);
    // The player camera hangs on the controlled player; every other angle follows the ball and the player together.
    const own = this.presetFor(match) === 'player' && !!selected;
    const ballShare = own ? 0.18 : 0.55;
    let targetX = THREE.MathUtils.clamp(bx * ballShare + sx * (1 - ballShare) + state.ball.vx * mirror * lead, -limitX, limitX);
    let targetZ = THREE.MathUtils.clamp(bz * ballShare + sz * (1 - ballShare) + state.ball.vy * lead * 0.5, -limitZ, limitZ);
    // The cage is small: frame it tighter.
    const frame = match.pitch.id === 'small' ? 0.62 : 1;
    const preset = CAMERA_PRESETS[this.presetFor(match)];
    const reduced = match.config.camera.reducedMotion;
    const baseWidth = (replay && !reduced ? 34 : 48) * frame;
    let targetWidth = (own ? Math.max(baseWidth, Math.abs(bx - sx) * 1.1 + 12 * frame) : Math.max(baseWidth, Math.abs(bx - sx) * 1.25 + 25 * frame)) * preset.width / THREE.MathUtils.clamp(match.config.camera.zoom || 1, 0.6, 1.4);
    // Set pieces in the attacking third are framed on the goal: the camera moves towards it and closes in.
    const restart = match.rule.phase;
    if (!replay && (restart === 'corner' || restart === 'penalty' || restart === 'freeKick') && Math.abs(bx) > FIELD_LENGTH / 2 - 38 * frame) {
      const goalX = Math.sign(bx) * (FIELD_LENGTH / 2);
      targetX = THREE.MathUtils.clamp(THREE.MathUtils.lerp(bx, goalX, restart === 'penalty' ? 0.55 : 0.32), -limitX, limitX);
      targetWidth = Math.min(targetWidth, (restart === 'penalty' ? 24 : 32) * frame * preset.width);
    }
    // Kick-off: the centre circle and both teams lined up; half time and full time: the whole pitch from high up, drifting slowly.
    const stage = match.phase;
    if (!replay && match.rule.phase === 'kickoff' && stage !== 'halftime' && stage !== 'fulltime') {
      targetX = THREE.MathUtils.lerp(targetX, 0, 0.7);
      targetZ = THREE.MathUtils.lerp(targetZ, 0, 0.7);
      targetWidth = Math.min(targetWidth, 40 * frame * preset.width);
    } else if (!replay && (stage === 'halftime' || stage === 'fulltime' || stage === 'report')) {
      targetX = reduced ? 0 : Math.sin(this.time * 0.25) * 10;
      targetZ = 0;
      targetWidth = 78 * frame * Math.max(0.9, preset.width);
    }
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
    const position = this.camPosition.set(focusX, distance * Math.sin(angle), standZ + distance * Math.cos(angle));
    const look = this.camLook.set(focusX, 0, THREE.MathUtils.lerp(standZ, focusZ, 0.7));
    // The goal lands like a punch: the picture pushes in and towards the goal for a moment.
    const punch = reduced ? 0 : Math.max(0, 1 - (this.time - this.goalTime) / 0.45);
    if (punch > 0 && !replay) {
      fov -= 3.5 * punch * punch;
      position.x += this.netSide * 1.4 * punch * punch;
    }
    if (replay && !celebration && !reduced && this.replayShot !== 'broadcast') {
      const goalSide = Math.sign(bx) || 1;
      if (this.replayShot === 'chase') {
        // Behind the dribbler, running at the goal with him.
        position.set(bx - goalSide * 11, 3.4, bz + 2.5);
        look.set(bx + goalSide * 8, 1, bz * 0.6);
        fov = 46;
      } else if (this.replayShot === 'behind-goal') {
        // Behind the goal, looking back up the pitch at the finish.
        position.set(goalSide * (FIELD_LENGTH / 2 + 10), 4.2, bz * 0.3);
        look.set(bx - goalSide * 6, 0.8, bz);
        fov = 42;
      } else {
        // Low touchline camera level with the ball.
        position.set(this.cameraX * 0.85, 2.6, FIELD_WIDTH / 2 + 7);
        look.set(this.cameraX, 0.7, this.cameraZ);
        fov = 34;
      }
    } else if (!replay && !reduced && this.time < 2.6) {
      // Opening sweep over the ground before kick-off.
      const intro = 1 - THREE.MathUtils.smoothstep(this.time, 0.2, 2.6);
      position.lerp(this.camIntro.set(-58 + this.time * 12, 36, 62), intro);
    }
    if (this.shake > 0.001 && match.config.camera.shake && !reduced) {
      position.x += Math.sin(this.time * 71) * this.shake * 0.22;
      position.y += Math.sin(this.time * 53 + 1.3) * this.shake * 0.16;
    }
    this.shake *= Math.exp(-6 * dt);
    // Inside a replay the lens eases to its new angle instead of jumping.
    if (replay && !celebration && Math.abs(this.camera.fov - fov) > 0.05 && Math.abs(this.camera.fov - fov) < 9) this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-9 * dt));
    else if (this.camera.fov !== fov) this.camera.fov = fov;
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

  /** For three seconds after a goal the stands sparkle with camera flashes, thinning out towards the end. */
  private updateFlashes(): void {
    const flashes = this.flashes;
    if (!flashes) return;
    const age = this.time - this.goalTime;
    const active = age >= 0 && age < 3 && this.quality !== 'low';
    if (flashes.visible !== active) flashes.visible = active;
    if (!active) return;
    const color = flashes.geometry.getAttribute('color') as THREE.BufferAttribute;
    const out = color.array as Float32Array;
    const fade = 1 - age / 3;
    for (let index = 0, count = color.count; index < count; index++) {
      const lit = flashLit(index, this.time) ? fade : 0;
      out[index * 3] = lit; out[index * 3 + 1] = lit; out[index * 3 + 2] = lit * 0.92;
    }
    color.needsUpdate = true;
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
    // Draw with the dimensions of this match (full pitch or five-a-side cage).
    applyPitch(match.pitch);
    if (this.matchId !== match.matchId) {
      this.matchId = match.matchId;
      this.cameraInitialized=false;
      this.kits = resolveMatchKits(match.home, match.away);
      // A shirt close to the panel colour gets a strong rim, every other one a hairline.
      const dot = (shirt: string) => ({ fill: shirt, rim: contrastText(shirt), weight: contrastRatio(shirt, '#0a1a21') < 3 ? 1.2 : 0.6 });
      this.mapDots = { home: dot(this.kits.home.shirt), away: dot(this.kits.away.shirt) };
      for (const model of this.models.values()) model.destroy();
      this.models.clear();
      this.referee?.destroy();
      this.referee = null;
      this.auraRarity.clear();
      this.hudInfo.clear();
      disposeTree(this.stadium);
      this.stadium.clear();
      this.goalNets.length = 0;
      this.ledTextures.length = 0;
      this.netRestPositions.length = 0;
      this.netEntry = null;
      this.netHit = null;
      this.netRest = 0;
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
      // The managed club's outfield players may wear a kit pattern and a cheer from the Legends Path.
      const mine = actor.side === match.controlledSide && actor.player.positionGroup !== 'GK';
      const shown = mine && this.cosmetics.kit ? { ...kit, pattern: this.cosmetics.kit } : kit;
      const model = createProceduralFootballer(actor.player.visuals, shown, actor.player.kitNumber, actor.player.positionGroup === 'GK', actor.player.foot === 'Left',this.software, actor.player.lastName);
      if (actor.side === match.controlledSide && this.cosmetics.cheer !== undefined) model.cheer = this.cosmetics.cheer;
      this.models.set(actor.player.id, model);
      this.hudInfo.set(actor.player.id, { number: actor.player.kitNumber, keeper: actor.player.positionGroup === 'GK' });
      this.scene.add(model.mesh);
      const rarity = dnaOf(actor.player).rarity;
      if (atLeast(rarity, AURA_FROM)) this.auraRarity.set(actor.player.id, rarity);
    }
    if (!this.referee && !this.software && this.quality !== 'low') {
      const black = { ...this.kits!.home, shirt: '#151515', secondary: '#151515', trim: '#e9c46a', shorts: '#151515', socks: '#151515', number: '#151515' };
      const model = createProceduralFootballer(createPlayerVisualIdentity(`referee-${match.matchId}`), black, 0, false, false, this.software, '');
      this.scene.add(model.mesh);
      this.referee = new RefereeRig(model);
    }
  }

  /**
   * Image-based light from the sky of this stadium instead of an indoor room: a blue dome with a warm sun and grass bounce below
   * by day, a dark dome with bright floodlights by night. Kits, skin and the ball catch highlights that fit the scene.
   */
  private applySkyEnvironment(sky: { zenith: string; horizon: string }, night: boolean, sunset: boolean): void {
    if (this.software) return;
    const world = new THREE.Scene();
    world.add(createSkyDome(sky.zenith, sky.horizon, 60));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(58, 24), new THREE.MeshBasicMaterial({ color: night ? '#0f2412' : '#4d8a45' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    world.add(ground);
    const bright = (colour: string, strength: number, radius: number, x: number, y: number, z: number) => {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(strength) }));
      lamp.position.set(x, y, z);
      world.add(lamp);
    };
    if (night) for (const [x, z] of [[-34, -26], [34, -26], [-34, 26], [34, 26]]) bright('#e8f2ff', 7, 3.2, x, 36, z);
    else bright(sunset ? '#ffc58a' : '#fff1d2', sunset ? 9 : 12, 5, -28, 42, 18);
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment?.dispose();
    this.scene.environment = generator.fromScene(world, 0.04).texture;
    generator.dispose();
    disposeTree(world);
    // Brighter than the old indoor map needed: a sky is dimmer on average than a lit room.
    this.scene.environmentIntensity = night ? 0.5 : sunset ? 0.7 : 0.8;
  }

  private buildStadium(match: ArcadeMatch): void {
    const atmosphere = match.home.visuals.stadium.atmosphere;
    const night = atmosphere === 'night';
    this.floodlit = night;
    const sunset = atmosphere === 'sunset';
    this.applyGrade(night ? 'night' : sunset ? 'sunset' : 'day', match.config.weather);
    const sky = SKY[night ? 'night' : sunset ? 'sunset' : 'day'];
    const bg = sky.horizon;
    // Rain and storms close the view in; snow turns the sky and the distance white.
    const weather = match.config.weather;
    const snowy = weather === 'snow';
    const backdrop = snowy ? new THREE.Color(bg).lerp(new THREE.Color('#eef4f8'), 0.55) : new THREE.Color(bg);
    this.scene.background = backdrop;
    this.scene.fog = new THREE.Fog(backdrop, weather === 'storm' ? 60 : weather === 'rain' ? 85 : snowy ? 70 : 140, weather === 'storm' ? 190 : weather === 'rain' ? 230 : snowy ? 210 : 300);
    this.applySkyEnvironment(sky, night, sunset);
    this.sun.color.set(night ? '#e4efff' : sunset ? '#ffd9a0' : '#fff5df');
    // Night: floodlights from high above and a darker ambient; day: warm low sun.
    // Image-based light adds on top, so direct light is a little lower than before.
    this.sun.intensity = (night ? 2.5 : 2.2) * (this.software ? 1.2 : 1);
    this.sunHeight = night ? 95 : 75;
    this.fill.intensity = (night ? 0.7 : sunset ? 0.95 : 1.1) * (this.software ? 1.6 : 1);
    this.rim.intensity = night ? 1.0 : sunset ? 0.9 : 0.6;
    this.fillBase = this.fill.intensity;
    this.rimBase = this.rim.intensity;
    this.rim.color.set(sunset ? '#ffc38a' : '#d4e6ff');
    this.stadium.add(createSkyDome(sky.zenith, sky.horizon), createSkyline(sky.horizon, match.home.visuals.seed));
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(160, 116), new THREE.MeshStandardMaterial({ color: '#204c38', roughness: 1 }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.04;
    surround.receiveShadow = true;
    this.stadium.add(surround);
    const pitchTexture = createPitchTexture(match.home.visuals.seed, match.config.weather !== 'clear', match.config.weather === 'snow');
    pitchTexture.anisotropy = this.software?1:Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const wet = match.config.weather !== 'clear';
    this.pitchMaterial = this.software ? new THREE.MeshBasicMaterial({ map: pitchTexture, color: snowy ? '#c4d6cc' : '#74ab83' })
      : new THREE.MeshStandardMaterial({ map: pitchTexture, bumpMap: createGrassBump(), bumpScale: 0.35, roughness: wet ? (snowy ? 0.8 : 0.5) : 0.94, metalness: 0, color: snowy ? '#e9f3f1' : '#ffffff', envMapIntensity: snowy ? 0.55 : wet ? 0.75 : 0.3 });
    this.wear.fill(0);
    this.wearTexture.minFilter = this.wearTexture.magFilter = THREE.LinearFilter;
    this.wearTexture.needsUpdate = true;
    addWear(this.pitchMaterial, this.wearTexture, this.wearMirror);
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
    if (match.pitch.id === 'small') {
      this.buildCage(match, night);
      return;
    }

    const structures: { position: number[]; scale: number[]; color: string }[] = [];
    const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => structures.push({ position: [x, y, z], scale: [w, h, d], color });
    const theme = match.home.visuals.stadium;
    // The style of the ground: compact ones have fewer rows, bowls rise higher and close their corners, industrial ones show their steel.
    const rows = Math.max(4, 5 + Math.min(5, match.home.facilities.stadium) + (theme.standStyle === 'compact' ? -1 : theme.standStyle === 'bowl' ? 1 : 0));
    const stand = theme.standStyle === 'industrial' ? ['#46535a', '#374349'] : theme.standStyle === 'classic' ? ['#4a4338', '#3b352c'] : ['#354858', '#2b3d4b'];
    const seatColor = theme.seatColor;
    // Four compact stands form a coherent, deliberately stylized ground.
    // The camera sits in the near main stand, so only the far long side is built (it would block the view).
    for (const side of [-1, 1]) {
      for (let row = 0; row < rows; row++) {
        const y = 0.7 + row * 0.62;
        if (side < 0) addBox(0, y / 2, side * (41 + row * 0.95), 116, y, 0.98, row % 2 ? stand[0] : stand[1]);
        addBox(side * (59 + row * 0.95), y / 2, 0, 0.98, y, 79, row % 2 ? stand[0] : stand[1]);
        // A bowl fills the corners with a curved-looking block between the stands.
        if (theme.standStyle === 'bowl') for (const end of [-1, 1]) addBox(end * (57.5 + row * 0.7), y / 2, side * (39.5 + row * 0.7), 3.2 + row * 0.7, y, 3.2 + row * 0.7, row % 2 ? stand[0] : stand[1]);
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
        // Industrial grounds show their trusses twice as often.
        if (side < 0) for (let x = -54; x <= 54; x += theme.standStyle === 'industrial' ? 9 : 18) addBox(x, (top + 3.2) / 2 + 0.8, side * (42.4 + rows * 0.95), theme.standStyle === 'industrial' ? 0.45 : 0.3, top + 3.2 - 1.6, 0.3, '#56646d');
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
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), new THREE.MeshStandardMaterial({ color: this.decorColor(match) ?? '#ffd967', side: THREE.DoubleSide }));
      // Pivot at the pole so the cloth waves around it.
      cloth.geometry.translate(0.3, 0, 0);
      cloth.position.set(0, 1.36, 0);
      this.flags.push(cloth);
      flag.add(pole, cloth);
      flag.position.set(x, 0, z);
      this.stadium.add(flag);
    }
    // LED boards: the wordmarks of the game itself (no external advertising or brands), in the colours and the pattern of the
    // club's ground, scrolling slowly; the slogans come from the ground's seed so every ground reads differently.
    const slogans = ['PITCH LEGENDS', 'PLAY BEAUTIFUL', 'THE GAME IS YOURS', 'ONE MORE MATCH', 'LEGENDS ARE MADE HERE', 'FOR THE LOVE OF THE GAME', 'EVERY WEEK COUNTS', 'FIGHT FOR EVERY BALL'];
    const start = theme.sponsorSeed % slogans.length;
    const text = [0, 1, 2, 3].map((i) => slogans[(start + i * 3) % slogans.length]).join('     •     ');
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 1024;
    bannerCanvas.height = 64;
    const ctx = bannerCanvas.getContext('2d');
    if (ctx) {
      const kit = match.home.visuals.kits.home;
      ctx.fillStyle = '#102c36'; ctx.fillRect(0, 0, 1024, 64);
      // The pattern of the ground runs along the bottom and top edge of the board.
      ctx.fillStyle = kit.shirt;
      const pattern = theme.bannerPattern;
      for (let x = 0; x < 1024; x += 32) {
        if (pattern === 'stripe' || pattern === 'hoops' || pattern === 'sash') ctx.fillRect(x, 0, 16, 5), ctx.fillRect(x + 16, 59, 16, 5);
        else if (pattern === 'chevron') ctx.fillRect(x, 0, 16, 3 + (x / 32) % 3 * 2), ctx.fillRect(x, 61 - (x / 32) % 3 * 2, 16, 3 + (x / 32) % 3 * 2);
        else if (pattern === 'halves' || pattern === 'quarters') ctx.fillRect(x < 512 ? 0 : 512, 0, 512, 4), ctx.fillRect(x < 512 ? 512 : 0, 60, 512, 4);
        else ctx.fillRect(0, 0, 1024, 4), ctx.fillRect(0, 60, 1024, 4);
      }
      ctx.fillStyle = this.decorColor(match) ?? '#f4e5ac'; ctx.font = 'bold 25px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(text, 512, 41, 1000);
    }
    const bannerTexture = new THREE.CanvasTexture(bannerCanvas);
    bannerTexture.colorSpace = THREE.SRGBColorSpace;
    bannerTexture.wrapS = THREE.RepeatWrapping;
    this.ledTextures.push(bannerTexture);
    const bannerMaterial = new THREE.MeshBasicMaterial({ map: bannerTexture });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(98, 0.86), bannerMaterial);
    banner.position.set(0, 0.6, -37.43);
    this.stadium.add(banner);
    // The same board runs round the ends, a little out of step.
    for (const end of [-1, 1]) {
      const endTexture = bannerTexture.clone();
      endTexture.needsUpdate = true;
      endTexture.offset.x = end * 0.25;
      this.ledTextures.push(endTexture);
      const endBoard = new THREE.Mesh(new THREE.PlaneGeometry(60, 0.86), new THREE.MeshBasicMaterial({ map: endTexture }));
      endBoard.position.set(end * 56.65, 0.6, 0);
      endBoard.rotation.y = -end * Math.PI / 2;
      this.stadium.add(endBoard);
    }
  }

  /** Five-a-side: boards around the pitch, a fence behind the goals and four light masts. */
  private buildCage(match: ArcadeMatch, night: boolean): void {
    const halfL = FIELD_LENGTH / 2, halfW = FIELD_WIDTH / 2, goalHalf = GOAL_WIDTH / 2;
    const parts: { position: number[]; scale: number[]; color: string }[] = [];
    const add = (x: number, y: number, z: number, w: number, h: number, d: number, color: string) => parts.push({ position: [x, y, z], scale: [w, h, d], color });
    const board = match.home.visuals.kits.home.shirt;
    for (const side of [-1, 1]) {
      add(0, 0.5, side * (halfW + 0.15), FIELD_LENGTH + 0.6, 1, 0.3, '#e8eef0');
      add(0, 0.82, side * (halfW + 0.31), FIELD_LENGTH + 0.6, 0.22, 0.02, board);
      for (const end of [-1, 1]) {
        const length = halfW - goalHalf - 0.1;
        add(side * (halfL + 0.15), 0.5, end * (goalHalf + 0.1 + length / 2), 0.3, 1, length, '#e8eef0');
      }
      // Netting fence behind each end.
      add(side * (halfL + 2.6), 2.2, 0, 0.05, 4.4, FIELD_WIDTH + 0.6, '#3d4c52');
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      add(sx * (halfL + 3), 5, sz * (halfW + 3), 0.3, 10, 0.3, '#8da2a6');
      add(sx * (halfL + 3), 10, sz * (halfW + 3), 2.6, 1, 0.4, '#c2c8c1');
    }
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8 }), parts.length);
    const dummy = new THREE.Object3D();
    parts.forEach((part, index) => {
      dummy.position.fromArray(part.position);
      dummy.scale.fromArray(part.scale);
      dummy.updateMatrix();
      boxes.setMatrixAt(index, dummy.matrix);
      boxes.setColorAt(index, new THREE.Color(part.color));
    });
    this.stadium.add(boxes);
    const fence = new THREE.MeshBasicMaterial({ color: '#9fb4ba', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    for (const side of [-1, 1]) {
      const net = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_LENGTH + 6, 4.4), fence);
      net.position.set(0, 2.2, side * (halfW + 2.6));
      this.stadium.add(net);
    }
    const lampMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6d8').multiplyScalar(night ? 4 : 2.6) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.1), lampMaterial);
      lamp.position.set(sx * (halfL + 3), 10, sz * (halfW + 3) + (sz > 0 ? -0.25 : 0.25));
      lamp.lookAt(0, 0, 0);
      this.stadium.add(lamp);
    }
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
    // Camera flashes: a share of the seats can light up for a moment after a goal.
    const bulbs: number[] = [];
    for (let index = 0; index < positions.length; index++) {
      if (hash32(`flash-${index}`) % 14 === 0) bulbs.push(positions[index].x, positions[index].y + 0.35, positions[index].z);
    }
    const flashGeometry = new THREE.BufferGeometry();
    flashGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
    flashGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(bulbs.length), 3));
    this.flashes = new THREE.Points(flashGeometry, new THREE.PointsMaterial({ size: 1.1, map: this.softDot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.flashes.name = 'flashes';
    this.flashes.frustumCulled = false;
    this.flashes.visible = false;
    this.stadium.add(this.flashes);
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

  /**
   * Reading aids for balls in the air: while a lob or cross is charged its flight is dotted in (as much of it as the assist
   * level shows); once a ball is up, a ring marks where it comes down and a thin line drops from the ball to the grass.
   */
  private updateAim(match: ArcadeMatch, state: VisualState, hidden: boolean): void {
    const direction = state.attackDirection;
    const preview = hidden ? null : match.aimPreview();
    this.aimDots.visible = !!preview;
    let ringX = 0, ringZ = 0, ring = false, pulse = 1;
    if (preview) {
      const position = this.aimDots.geometry.getAttribute('position') as THREE.BufferAttribute;
      const out = position.array as Float32Array, source = preview.points;
      for (let index = 0; index < preview.count; index++) {
        out[index * 3] = (source[index * 3] - FIELD_LENGTH / 2) * direction;
        out[index * 3 + 1] = source[index * 3 + 2];
        out[index * 3 + 2] = source[index * 3 + 1] - FIELD_WIDTH / 2;
      }
      position.needsUpdate = true;
      this.aimDots.geometry.setDrawRange(0, preview.count);
      if (preview.landing) {
        const last = (preview.count - 1) * 3;
        ringX = out[last]; ringZ = out[last + 2]; ring = true;
      }
    }
    const landing = hidden || preview ? null : match.flightLanding();
    const airborne = !!landing && state.ball.z > 1;
    this.heightLine.visible = airborne;
    if (airborne) {
      const line = this.heightLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const ball = this.ball.position;
      line.setXYZ(0, ball.x, ball.y, ball.z); line.setXYZ(1, ball.x, 0.03, ball.z);
      line.needsUpdate = true;
      ringX = (landing!.x - FIELD_LENGTH / 2) * direction; ringZ = landing!.y - FIELD_WIDTH / 2; ring = true;
      // The ring closes in as the ball comes down.
      pulse = 1 + Math.min(1, landing!.seconds) * 0.8;
    }
    this.landingRing.visible = ring;
    if (ring) {
      this.landingRing.position.set(ringX, 0.03, ringZ);
      this.landingRing.scale.setScalar(pulse);
      this.landingRing.material.opacity = preview ? 0.85 : 0.6;
    }
  }

  private updateBall(state: VisualState, dt: number, simDt: number, replay: boolean): void {
    let x = (state.ball.x - FIELD_LENGTH / 2) * state.attackDirection;
    const z = state.ball.y - FIELD_WIDTH / 2;
    let h = Math.max(0, state.ball.z);
    // A ball that crossed the line stays in the net: the engine resets it at the goal, the picture carries it on into the netting.
    const flight = Math.hypot(state.ball.vx, state.ball.vy, state.ball.vz);
    this.recentBallSpeed = Math.max(flight, this.recentBallSpeed * Math.exp(-dt * 0.8));
    const depth = Math.abs(x) - FIELD_LENGTH / 2;
    if (depth > 0 && Math.abs(z) < GOAL_WIDTH / 2 + 0.02 && h < GOAL_HEIGHT) {
      const side: 1 | -1 = x > 0 ? 1 : -1;
      if (!this.netEntry || this.netEntry.side !== side) {
        const speed = Math.max(flight, this.recentBallSpeed);
        this.netEntry = { side, time: this.time, depth, height: h, z, speed };
        const stop = netStopDepth(speed, h, GOAL_HEIGHT);
        this.netHit = { index: side > 0 ? 1 : 0, strength: netHitStrength(speed), time: this.time, px: side * (FIELD_LENGTH / 2 + stop), py: Math.min(GOAL_HEIGHT - 0.12, Math.max(0.15, h)), pz: z };
      }
      const entry = this.netEntry, motion = netBallMotion(entry.depth, entry.height, entry.speed, this.time - entry.time, GOAL_HEIGHT);
      x = side * (FIELD_LENGTH / 2 + Math.max(depth, motion.depth));
      h = Math.min(h, motion.height);
    } else this.netEntry = null;
    const next = this.ballPosition.set(x, Math.max(0.11, h), z);
    const travelled = next.distanceTo(this.ball.position);
    this.ball.position.copy(next);
    if (simDt > 0) {
      // Roll about the axis perpendicular to the travel direction, in simulation time; Euler x/z drifted on diagonals.
      const rollX = state.ball.vx * state.attackDirection, rollZ = state.ball.vy;
      const rollSpeed = Math.hypot(rollX, rollZ);
      if (rollSpeed > 1e-3) {
        this.spinAxis.set(rollZ / rollSpeed, 0, -rollX / rollSpeed);
        this.ball.quaternion.premultiply(this.spinQuat.setFromAxisAngle(this.spinAxis, rollSpeed * simDt / 0.11));
      }
      if (state.ball.spin) this.ball.quaternion.premultiply(this.spinQuat.setFromAxisAngle(this.spinAxis.set(0, 1, 0), state.ball.spin * simDt));
      this.ball.quaternion.normalize();
    }
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
    this.weather.visible = !reduced && match.config.weather !== 'clear' && match.config.weather !== 'snow' && this.quality !== 'low';
    if (this.weather.visible) {
      this.weather.position.y = -(this.time * (match.config.weather === 'storm' ? 14 : 10) % 11.4);
      (this.weather.material as THREE.LineBasicMaterial).opacity = match.config.weather === 'storm' ? 0.32 : 0.2;
    }
    this.splashes.visible = this.weather.visible;
    if (this.splashes.visible) {
      const positions = this.splashes.geometry.getAttribute('position') as THREE.BufferAttribute;
      const storm = match.config.weather === 'storm';
      for (let i = 0; i < positions.count; i++) {
        // Each dot lives a fifth of a short cycle, then it is somewhere else.
        const cycle = this.time * (storm ? 2.6 : 1.8) + i * 0.173;
        const phase = cycle % 1, round = Math.floor(cycle);
        if (phase > 0.22) { positions.setXYZ(i, 0, -9, 0); continue; }
        positions.setXYZ(i, ((hash32(`splash-x-${i}-${round}`) % 560) / 10 - 28) + this.weather.position.x, 0.05 + phase * 0.5, ((hash32(`splash-z-${i}-${round}`) % 400) / 10 - 20) + this.weather.position.z);
      }
      positions.needsUpdate = true;
    }
    this.snow.visible = !reduced && match.config.weather === 'snow' && this.quality !== 'low';
    if (this.snow.visible) {
      const positions = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        const fall = (hash32(`snow-y-${i}`) % 140) / 10 - this.time * (0.9 + (i % 5) * 0.18);
        positions.setY(i, ((fall % 14) + 14) % 14);
        positions.setX(i, (hash32(`snow-x-${i}`) % 1250) / 10 - 62.5 + Math.sin(this.time * 0.7 + i) * 0.5);
      }
      positions.needsUpdate = true;
      this.snow.position.x = this.weather.position.x;
      this.snow.position.z = this.weather.position.z;
    }
    if (!reduced) this.ledTextures.forEach((texture, i) => { texture.offset.x = ((i === 0 ? 0 : i === 1 ? -0.25 : 0.25) + this.time * 0.012) % 1; });
    if (!reduced) this.flags.forEach((cloth, i) => { cloth.rotation.y = Math.sin(this.time * (match.config.weather === 'storm' ? 6 : 3) + i * 1.7) * 0.45; });
    if (match.config.weather === 'storm' && !reduced) {
      const flash = lightningFlash(this.time);
      this.fill.intensity = this.fillBase * (1 + 2.2 * flash);
      this.rim.intensity = this.rimBase * (1 + 2 * flash);
    }
    this.confetti.visible = !reduced && goalAge >= 0 && goalAge < 3;
    // Confetti flutters: the size swells and shrinks as the pieces turn over in the air.
    (this.confetti.material as THREE.PointsMaterial).size = 0.2 + Math.abs(Math.sin(this.time * 9)) * 0.12;
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
    this.updateNet(dt, reduced);
  }

  /** Only the net the ball hit moves: a bulge around the stopped ball swings out and settles into a pocket while the ball lies in it. */
  private updateNet(dt: number, reduced: boolean): void {
    const hit = this.netHit;
    if (!hit) return;
    const mesh = this.goalNets[hit.index], rest = this.netRestPositions[hit.index];
    if (!mesh || !rest) { this.netHit = null; return; }
    const age = this.time - hit.time;
    this.netRest += ((this.netEntry ? 1 : 0) - this.netRest) * Math.min(1, dt * 4);
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sign = hit.index === 1 ? 1 : -1;
    const done = age > 5 && this.netRest < 0.01;
    for (let i = 0; i < pos.count; i++) {
      const rx = rest[i * 3], ry = rest[i * 3 + 1], rz = rest[i * 3 + 2];
      const distance = Math.hypot(rx - hit.px, ry - hit.py, rz - hit.pz);
      pos.setX(i, done ? rx : rx + sign * netBulge(distance, age, hit.strength, this.netRest, reduced));
    }
    pos.needsUpdate = true;
    if (done) this.netHit = null;
  }

  /** Name and stamina above the player you control. */
  private drawPlayerTag(ctx: CanvasRenderingContext2D, match: ArcadeMatch, state: VisualState, w: number, h: number, s: number): void {
    const model = this.models.get(state.controlledPlayerId);
    const actor = match.actors.find(candidate => candidate.player.id === state.controlledPlayerId);
    if (!model || !actor || !model.mesh.visible) return;
    this.tagPoint.set(model.mesh.position.x, model.recipe.height + 0.42, model.mesh.position.z).project(this.camera);
    if (this.tagPoint.z > 1 || Math.abs(this.tagPoint.x) > 1.1 || Math.abs(this.tagPoint.y) > 1.1) return;
    const x = (this.tagPoint.x * 0.5 + 0.5) * w, y = (-this.tagPoint.y * 0.5 + 0.5) * h;
    const stamina = Math.max(0, Math.min(1, actor.stamina / 100));
    ctx.textAlign = 'center';
    ctx.font = `700 ${11 * s}px system-ui, sans-serif`;
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = 'rgba(5,15,22,.85)';
    ctx.strokeText(actor.player.lastName.toUpperCase(), x, y - 7 * s);
    ctx.fillStyle = '#f5f6e9';
    ctx.fillText(actor.player.lastName.toUpperCase(), x, y - 7 * s);
    const width = 44 * s, height = 4 * s;
    ctx.fillStyle = 'rgba(5,15,22,.78)';
    ctx.fillRect(x - width / 2 - s, y - s, width + 2 * s, height + 2 * s);
    ctx.fillStyle = stamina > 0.5 ? '#7be08a' : stamina > 0.25 ? '#ffd166' : '#ff6b6b';
    ctx.fillRect(x - width / 2, y, width * stamina, height);
    ctx.textAlign = 'left';
  }

  /** Team-mates near the ball but outside the picture get a badge with their number at the edge, pointing towards them. */
  private drawMateArrows(ctx: CanvasRenderingContext2D, match: ArcadeMatch, state: VisualState, w: number, h: number, s: number, bottomInset: number): void {
    const dot = this.mapDots[match.controlledSide];
    const ballX = state.ball.x, ballY = state.ball.y, margin = 22 * s;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${10 * s}px system-ui, sans-serif`;
    for (const player of state.players) {
      if (!player.active || player.side !== match.controlledSide || player.id === state.controlledPlayerId) continue;
      const info = this.hudInfo.get(player.id);
      const gap = Math.hypot(player.x - ballX, player.y - ballY);
      if (!info || info.keeper || gap > MATE_ARROW_RANGE) continue;
      this.tagPoint.set((player.x - FIELD_LENGTH / 2) * state.attackDirection, 1, player.y - FIELD_WIDTH / 2).project(this.camera);
      const edge = edgeMarker(this.tagPoint.x, this.tagPoint.y, this.tagPoint.z > 1);
      if (!edge) continue;
      const x = Math.min(w - margin, Math.max(margin, (edge.x * 0.5 + 0.5) * w));
      const y = Math.min(h - margin - bottomInset, Math.max(margin, (-edge.y * 0.5 + 0.5) * h));
      ctx.globalAlpha = 0.95 - 0.5 * gap / MATE_ARROW_RANGE;
      // The pointer: a small triangle outside the badge, towards the player.
      const cos = Math.cos(edge.angle), sin = -Math.sin(edge.angle), r = 9 * s;
      ctx.fillStyle = dot.rim;
      ctx.beginPath();
      ctx.moveTo(x + cos * (r + 6 * s), y + sin * (r + 6 * s));
      ctx.lineTo(x + cos * r * 0.6 - sin * r * 0.8, y + sin * r * 0.6 + cos * r * 0.8);
      ctx.lineTo(x + cos * r * 0.6 + sin * r * 0.8, y + sin * r * 0.6 - cos * r * 0.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = dot.fill;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dot.rim; ctx.lineWidth = 1.4 * s; ctx.stroke();
      ctx.fillStyle = dot.rim;
      ctx.fillText(String(info.number), x, y + 0.5 * s);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  private drawHud(match: ArcadeMatch, state: VisualState, replay: boolean): void {
    const ctx = this.hudContext;
    if (!ctx) return;
    const w = this.hud.width, h = this.hud.height;
    ctx.clearRect(0, 0, w, h);
    // Layout scale from the CSS width, times the canvas-to-CSS pixel ratio.
    const s = Math.max(0.72, Math.min(1.1, this.width / 1000)) * (w / this.width);
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const bottomInset = touch ? 0 : 55;
    const mapW = 150 * s, mapH = mapW * FIELD_WIDTH / FIELD_LENGTH;
    // The minimap sits in a corner, clear of the action: bottom right with a mouse, top right where thumbs cover the bottom.
    const css = w / this.width;
    const mapX = w - mapW - 22 * s, mapY = touch ? 46 * css + 9 * s : h - mapH - 20 * s - (bottomInset + 40) * css;
    if (this.minimap && !(replay && !this.celebration)) {
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
      const dot = this.mapDots[p.side], selected = p.id === state.controlledPlayerId;
      ctx.fillStyle = dot.fill;
      ctx.beginPath(); ctx.arc(x, y, (selected ? 3.4 : 2.5) * s, 0, Math.PI * 2); ctx.fill();
      // The controlled player keeps his gold marker as a ring around the shirt colour.
      ctx.strokeStyle = selected ? '#ffe36e' : dot.rim; ctx.lineWidth = (selected ? 1.6 : dot.weight) * s; ctx.globalAlpha = selected || dot.weight > 1 ? 1 : 0.6;
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(mapX + (state.attackDirection > 0 ? state.ball.x : FIELD_LENGTH - state.ball.x) / FIELD_LENGTH * mapW, mapY + state.ball.y / FIELD_WIDTH * mapH, 2.4 * s, 0, Math.PI * 2); ctx.fill();
    // What the camera sees, as an outline on the map.
    const view = groundView(this.camera, this.viewCorners);
    ctx.save();
    ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();
    ctx.beginPath();
    for (let corner = 0; corner < 4; corner++) {
      const x = mapX + (view[corner * 2] + FIELD_LENGTH / 2) / FIELD_LENGTH * mapW, y = mapY + (view[corner * 2 + 1] + FIELD_WIDTH / 2) / FIELD_WIDTH * mapH;
      if (corner) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = s; ctx.stroke();
    ctx.restore();
    }
    if (!replay && !this.celebration && match.config.controllerMode === 'human') this.drawMateArrows(ctx, match, state, w, h, s, bottomInset);
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
    if (this.minimap && !replay && !this.celebration) this.drawPlayerTag(ctx, match, state, w, h, s);
    if (replay && !this.celebration) {
      // Cinema bars mark the replay unmistakably.
      const bar = h * 0.075;
      ctx.fillStyle = 'rgba(0,0,0,.82)';
      ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
      ctx.font = `700 ${15 * s}px system-ui, sans-serif`; ctx.fillStyle = '#ffde7b';
      ctx.fillText('●  REPLAY', 22 * s, bar + 24 * s);
    }
    if (!replay && match.rule.phase !== 'playing' && match.rule.phase !== 'advantage') {
      const english = typeof document !== 'undefined' && document.documentElement.lang === 'en';
      const names: Record<string, string> = english
        ? { kickoff: 'KICK-OFF', freeKick: 'FREE KICK', corner: 'CORNER', throwIn: 'THROW-IN', goalKick: 'GOAL KICK', penalty: 'PENALTY' }
        : { kickoff: 'ANSTOSS', freeKick: 'FREISTOSS', corner: 'ECKBALL', throwIn: 'EINWURF', goalKick: 'ABSTOSS', penalty: 'ELFMETER' };
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
    ctx.fillText(document.documentElement.lang === 'en' ? 'Restoring graphics …' : 'Grafik wird wiederhergestellt …', this.hud.width / 2, this.hud.height / 2);
    ctx.textAlign = 'left';
  }

  private markerMeshes: THREE.Mesh[] = [];

  /** Training cones of a challenge; passed cones turn green. */
  setMarkers(markers: ReadonlyArray<{ x: number; y: number; done: boolean }>): void {
    while (this.markerMeshes.length < markers.length) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 12), new THREE.MeshStandardMaterial({ color: '#ff8a1f', roughness: 0.6 }));
      cone.position.y = 0.375;
      cone.castShadow = true;
      this.scene.add(cone);
      this.markerMeshes.push(cone);
    }
    this.markerMeshes.forEach((mesh, index) => {
      const marker = markers[index];
      mesh.visible = !!marker;
      if (!marker) return;
      mesh.position.x = (marker.x - FIELD_LENGTH / 2) * this.lastDirection;
      mesh.position.z = marker.y - FIELD_WIDTH / 2;
      (mesh.material as THREE.MeshStandardMaterial).color.set(marker.done ? '#3ad27a' : '#ff8a1f');
    });
  }

  setMinimap(visible: boolean): void {
    this.minimap = visible;
    this.lastHud = -1;
  }

  /** One step down after a stalled frame burst instead of dropping straight to the lowest profile. */
  stepDownQuality(): void {
    if (!this.adaptive || this.quality === 'low' || this.qualityCooldown > 0) return;
    this.setQuality(this.quality === 'high' ? 'balanced' : 'low');
    this.qualityCooldown = 8;
    this.stableSamples = 0;
    this.downgrades++;
  }

  private adaptQuality(dt: number): void {
    if (!this.adaptive) return;
    this.qualityCooldown -= dt;
    this.sampleFrames++;
    this.sampleTime += dt;
    if (this.sampleFrames < 150) return;
    const outcome = decideQuality({
      average: this.sampleTime / this.sampleFrames, gpuMs: this.gpuTimer?.ms ?? null, quality: this.quality, ceiling: this.ceilingQuality,
      cooldown: this.qualityCooldown, stable: this.stableSamples, downgrades: this.downgrades, software: this.software,
    });
    this.stableSamples = outcome.stable;
    if (outcome.action === 'down') this.stepDownQuality();
    else if (outcome.action === 'up') {
      this.setQuality(this.quality === 'low' ? 'balanced' : 'high');
      this.qualityCooldown = 12;
      this.stableSamples = 0;
    }
    this.sampleTime = 0;
    this.sampleFrames = 0;
  }
}

/** Team-mates farther from the ball than this (metres) get no marker at the edge of the picture. */
export const MATE_ARROW_RANGE = 40;
const VIEW_POINT = new THREE.Vector3();
const VIEW_SIGNS = [-1, -1, 1, -1, 1, 1, -1, 1];

/**
 * Where a point outside the picture is marked on its edge. Takes normalized device coordinates (-1 to 1, y up) and whether the
 * point lies behind the camera; returns the spot on the border in the same coordinates and the direction towards the point,
 * or null when the point is in the picture.
 */
export function edgeMarker(x: number, y: number, behind: boolean): { x: number; y: number; angle: number } | null {
  // A point behind the camera projects mirrored through the centre.
  if (behind) { x = -x; y = -y; }
  const reach = Math.max(Math.abs(x), Math.abs(y));
  if (!behind && reach <= 1) return null;
  if (reach < 1e-6) return { x: 0, y: -1, angle: -Math.PI / 2 };
  return { x: x / reach, y: y / reach, angle: Math.atan2(y, x) };
}

/**
 * The patch of grass the camera sees: scene x and z where the four corners of the picture meet the ground, in the order bottom
 * left, bottom right, top right, top left. A corner that looks above the horizon is pushed far out along its direction.
 */
export function groundView(camera: THREE.Camera, out = new Float32Array(8)): Float32Array {
  const eye = camera.position;
  for (let corner = 0; corner < 4; corner++) {
    VIEW_POINT.set(VIEW_SIGNS[corner * 2], VIEW_SIGNS[corner * 2 + 1], 0.5).unproject(camera).sub(eye).normalize();
    const reach = VIEW_POINT.y < -1e-4 ? Math.min(400, -eye.y / VIEW_POINT.y) : 400;
    out[corner * 2] = eye.x + VIEW_POINT.x * reach;
    out[corner * 2 + 1] = eye.z + VIEW_POINT.z * reach;
  }
  return out;
}

/** Real mowing and white paint in one inexpensive, locally generated texture. */
function createPitchTexture(seed: number, wet: boolean, snow = false): THREE.CanvasTexture {
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
    // Worn goal mouths.
    for (const x of [4.5 * FIELD_LENGTH / 105, FIELD_LENGTH - 4.5 * FIELD_LENGTH / 105]) {
      const y = FIELD_WIDTH / 2;
      const grad = ctx.createRadialGradient(x * sx, y * sy, 0, x * sx, y * sy, 3.8 * sx);
      grad.addColorStop(0, 'rgba(152,127,70,.13)'); grad.addColorStop(1, 'rgba(152,127,70,0)');
      ctx.fillStyle = grad; ctx.fillRect((x - 4) * sx, (y - 5) * sy, 8 * sx, 10 * sy);
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
    if (snow) {
      // A cover of snow: the grass shows through in the mowing stripes and in patches where the cover is thin.
      ctx.fillStyle = 'rgba(232,241,246,.66)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let stripe = 0; stripe < 10; stripe += 2) { ctx.fillStyle = 'rgba(70,120,90,.10)'; ctx.fillRect(stripe * canvas.width / 10, 0, canvas.width / 10, canvas.height); }
      for (let i = 0; i < 90; i++) {
        const n = hash32(`${seed}|thin|${i}`);
        const px = n % canvas.width, py = (n >>> 11) % canvas.height, radius = 30 + (n >>> 20) % 90;
        const thin = ctx.createRadialGradient(px, py, 0, px, py, radius);
        thin.addColorStop(0, 'rgba(60,110,80,.22)'); thin.addColorStop(1, 'rgba(60,110,80,0)');
        ctx.fillStyle = thin; ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Gradient dome: zenith colour overhead fading to the horizon (and fog) colour. */
function createSkyDome(zenith: string, horizon: string, radius = 280): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 24, 12);
  const top = new THREE.Color(zenith), bottom = new THREE.Color(horizon), colour = new THREE.Color();
  const pos = geometry.getAttribute('position');
  const colours: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / radius, 0, 1);
    colour.copy(bottom).lerp(top, Math.pow(t, 0.6));
    colours.push(colour.r, colour.g, colour.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -1;
  return dome;
}

/**
 * Brightness of a lightning flash (0 to 1) at renderer time `seconds`: one bolt in every nine-second window, at a fixed
 * offset per window, flickering for half a second. Pure, so the same time always gives the same light.
 */
export function lightningFlash(seconds: number): number {
  const window = Math.floor(seconds / 9);
  const age = seconds - (window * 9 + 1 + (hash32(`bolt-${window}`) % 100) * 0.06);
  if (age < 0 || age >= 0.5) return 0;
  return Math.max(0, 1 - age / 0.5) * (age < 0.12 ? 1 : 0.55 + 0.45 * Math.sin(age * 60));
}

/** A soft round dot for turf and confetti, so they are not hard squares. */
function createSoftDot(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
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
  const L = FIELD_LENGTH, W = FIELD_WIDTH, mid = W / 2, p = PITCH;
  const boxW = p.penaltyHalfWidth * 2, areaHalf = GOAL_WIDTH / 2 + p.goalAreaDepth;
  rect(0.06, 0.06, L - 0.12, W - 0.12);
  line(L / 2, 0.06, L / 2, W - 0.06);
  arc(L / 2, mid, p.restartDistance, 0, Math.PI * 2); spot(L / 2, mid);
  rect(0.06, mid - p.penaltyHalfWidth, p.penaltyDepth - 0.06, boxW); rect(L - p.penaltyDepth, mid - p.penaltyHalfWidth, p.penaltyDepth - 0.06, boxW);
  rect(0.06, mid - areaHalf, p.goalAreaDepth - 0.06, areaHalf * 2); rect(L - p.goalAreaDepth, mid - areaHalf, p.goalAreaDepth - 0.06, areaHalf * 2);
  spot(p.penaltySpot, mid); spot(L - p.penaltySpot, mid);
  // The penalty arc only exists where the circle reaches beyond the box.
  if (p.restartDistance > p.penaltyDepth - p.penaltySpot) {
    const a = Math.acos((p.penaltyDepth - p.penaltySpot) / p.restartDistance);
    arc(p.penaltySpot, mid, p.restartDistance, -a, 2 * a); arc(L - p.penaltySpot, mid, p.restartDistance, Math.PI - a, 2 * a);
  }
  arc(0, 0, 1, -Math.PI / 2, Math.PI / 2); arc(L, 0, 1, -Math.PI, Math.PI / 2);
  arc(0, W, 1, 0, Math.PI / 2); arc(L, W, 1, Math.PI / 2, Math.PI / 2);
  const merged = mergeGeometries(parts.map(part => part.index ? part.toNonIndexed() : part), false)!;
  parts.forEach(part => part.dispose());
  return merged;
}

/** Net surfaces (roof, sloping back, two sides) with UVs in 18 cm mesh cells. */
function createNetGeometry(x: number, topX: number, backX: number, half: number): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  const cell = 0.18;
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, su: number, sv: number, slack?: (u: number, v: number) => THREE.Vector3) => {
    const base = positions.length / 3, lu = a.distanceTo(b) / cell, lv = a.distanceTo(d) / cell;
    for (let v = 0; v <= sv; v++) for (let u = 0; u <= su; u++) {
      const top = new THREE.Vector3().lerpVectors(a, b, u / su), bottom = new THREE.Vector3().lerpVectors(d, c, u / su);
      const p = top.lerp(bottom, v / sv);
      if (slack) p.add(slack(u / su, v / sv));
      positions.push(p.x, p.y, p.z); uvs.push(u / su * lu, v / sv * lv);
    }
    for (let v = 0; v < sv; v++) for (let u = 0; u < su; u++) {
      const i = base + v * (su + 1) + u;
      index.push(i, i + 1, i + su + 1, i + 1, i + su + 2, i + su + 1);
    }
  };
  const H = GOAL_HEIGHT;
  const V = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);
  // A hung net is not taut: the roof sags, the back net bellies out and the sides give a little, fixed along their edges.
  const out = Math.sign(backX - x) || 1;
  quad(V(x, H, -half), V(x, H, half), V(topX, H - .08, half), V(topX, H - .08, -half), 14, 2, (u, v) => V(0, -netSlack(u, v, 0.07), 0));
  quad(V(topX, H - .08, -half), V(topX, H - .08, half), V(backX, .06, half), V(backX, .06, -half), 14, 8, (u, v) => V(out * netSlack(u, v, 0.14), 0, 0));
  for (const z of [-half, half]) {
    quad(V(x, H, z), V(topX, H - .08, z), V(backX, .06, z), V(x, .06, z), 4, 8, (u, v) => V(0, 0, Math.sign(z) * netSlack(u, v, 0.06)));
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
