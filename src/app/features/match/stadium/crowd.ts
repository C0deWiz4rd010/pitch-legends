import * as THREE from 'three';
import { Seat, seatRoll } from './stadium-plan';

/** The five drawings in the supporter atlas, left to right. */
export const CROWD_POSES = ['sit', 'stand', 'cheer', 'scarf', 'card'] as const;
const CELL_W = 64, CELL_H = 96;
const SKIN = ['#ecc5a1', '#d9a57c', '#b07a55', '#7a4f3b', '#543a32'];

/**
 * One small texture with every supporter drawing. The channels are masks, not colours: red is the shirt (or the scarf, or the
 * card held up), green is skin, blue is hair and trousers. The shader paints each fan in his own colours from them.
 */
export function createCrowdAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * CROWD_POSES.length; canvas.height = CELL_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const SHIRT = '#ff0000', FLESH = '#00ff00', DARK = '#0000ff';
    const limb = (x1: number, y1: number, x2: number, y2: number, width: number, colour: string) => {
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const head = (x: number, y: number) => {
      ctx.fillStyle = FLESH; ctx.beginPath(); ctx.arc(x, y, 8.5, 0, Math.PI * 2); ctx.fill();
      // Hair as a cap over the top of the head.
      ctx.fillStyle = DARK; ctx.beginPath(); ctx.arc(x, y - 1.5, 8.6, Math.PI * 1.08, Math.PI * 1.92); ctx.fill();
    };
    const torso = (x: number, top: number, bottom: number) => {
      ctx.fillStyle = SHIRT; ctx.beginPath(); ctx.roundRect(x - 13, top, 26, bottom - top, 7); ctx.fill();
    };
    CROWD_POSES.forEach((pose, index) => {
      const cx = index * CELL_W + CELL_W / 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(index * CELL_W + 1, 0, CELL_W - 2, CELL_H); ctx.clip();
      if (pose === 'sit') {
        // Seated: only head, shoulders and the arms in the lap show above the row in front.
        torso(cx, 58, 96); head(cx, 48);
        limb(cx - 13, 64, cx - 9, 88, 7, SHIRT); limb(cx + 13, 64, cx + 9, 88, 7, SHIRT);
      } else {
        // Whoever holds a card stands a little lower in the cell, so the card fits above the head.
        const top = pose === 'card' ? 52 : 36;
        ctx.fillStyle = DARK; ctx.fillRect(cx - 11, top + 38, 22, CELL_H - top - 38);
        torso(cx, top, top + 42); head(cx, top - 10);
        if (pose === 'stand') { limb(cx - 14, top + 6, cx - 16, top + 32, 7, SHIRT); limb(cx + 14, top + 6, cx + 16, top + 32, 7, SHIRT); }
        if (pose === 'cheer') {
          limb(cx - 13, top + 5, cx - 22, top - 16, 7, SHIRT); limb(cx + 13, top + 5, cx + 22, top - 16, 7, SHIRT);
          limb(cx - 22, top - 16, cx - 24, top - 25, 6, FLESH); limb(cx + 22, top - 16, cx + 24, top - 25, 6, FLESH);
        }
        if (pose === 'scarf' || pose === 'card') {
          limb(cx - 13, top + 5, cx - 21, top - 20, 7, SHIRT); limb(cx + 13, top + 5, cx + 21, top - 20, 7, SHIRT);
          ctx.fillStyle = SHIRT;
          if (pose === 'scarf') ctx.fillRect(cx - 29, top - 30, 58, 9);
          else ctx.fillRect(cx - 31, 1, 62, top - 21);
        }
      }
      ctx.restore();
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

export interface CrowdColors {
  /** What the home supporters wear: shirts in the club colours and plain clothes. */
  home: string[];
  away: string[];
  /** The three colours of the mosaic before kick-off: shirt, secondary and trim. */
  mosaic: [string, string, string];
  /** Which mosaic colour the card at (u, v) of the far stand shows. */
  card: (u: number, v: number) => 0 | 1 | 2;
}

export interface CrowdMood {
  time: number;
  /** Excitement of the home and of the away supporters, 0 to 1 (a goal lifts it to 1). */
  home: number;
  away: number;
  /** 0 to 1: the home end hops in time with its chant. */
  chant: number;
  /** 0 to 1: the mosaic before kick-off is held up. */
  choreo: number;
  /** Where the crest of the La Ola is, 0 to 1 round the ground; negative when none runs. */
  wave: number;
  /** Phone lights in the dark, 0 to 1. */
  phones: number;
}

const VERTEX = /* glsl */ `
attribute vec3 seat; attribute vec3 tint; attribute vec3 card; attribute vec3 skin; attribute vec4 fan;
uniform float uTime; uniform vec4 uMood; uniform float uWave; uniform float uTerrace;
varying vec2 vUv; varying vec3 vTint; varying vec3 vSkin; varying float vShade;
#include <fog_pars_vertex>
void main() {
  float phase = fan.x, block = fan.y;
  float excite = block < 0.5 ? uMood.x : block < 1.5 ? uMood.y : 0.0;
  float chant = block < 0.5 ? uMood.z : 0.0;
  float wave = 0.0;
  if (uWave >= 0.0 && block < 1.5) wave = 1.0 - smoothstep(0.0, 0.045, abs(fract(fan.z - uWave + 0.5) - 0.5));
  bool holdsCard = block < 0.5 && card.r >= 0.0 && uMood.w > 0.02 + phase * 0.5;
  // Pose: card, arms up, scarf, standing or seated.
  float pose = block > 1.5 ? fan.w : ((phase < 0.42 || uTerrace > 0.5) ? 1.0 : 0.0);
  if (chant > 0.1 && phase < 0.75) pose = 1.0;
  if (chant > 0.1 && phase < 0.22) pose = 3.0;
  if (excite > 0.08) pose = 1.0;
  if (excite > 0.22 + phase * 0.6 || wave > 0.5) pose = 2.0;
  if (holdsCard) pose = 4.0;
  float hop = sin(uTime * 1.3 + phase * 40.0) * 0.006;
  hop += abs(sin(uTime * 5.236)) * 0.16 * chant * step(phase, 0.75);
  hop += abs(sin(uTime * 8.5 + phase * 6.283)) * 0.24 * excite;
  hop += wave * 0.22;
  vec3 centre = seat + vec3(0.0, hop, 0.0);
  vec3 toCam = cameraPosition - centre;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  vec3 world = centre + right * position.x * 0.64 + vec3(0.0, position.y * 0.96, 0.0);
  vUv = vec2((pose + uv.x) / ${CROWD_POSES.length}.0, uv.y);
  vTint = holdsCard ? card : tint;
  vSkin = skin;
  vShade = 0.86 + 0.28 * fract(phase * 7.13);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D atlas; uniform vec3 uLight;
varying vec2 vUv; varying vec3 vTint; varying vec3 vSkin; varying float vShade;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 mask = texture2D(atlas, vUv);
  if (mask.a < 0.5) discard;
  float sum = max(0.001, mask.r + mask.g + mask.b);
  vec3 colour = (vTint * mask.r + vSkin * mask.g + vec3(0.05, 0.06, 0.09) * mask.b) / sum;
  // A little light from above: heads and raised arms are brighter than laps.
  gl_FragColor = vec4(colour * uLight * vShade * (0.82 + 0.3 * vUv.y), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const PHONE_VERTEX = /* glsl */ `
attribute float phase; uniform float uTime; uniform float uPhones; uniform float uScale;
varying float vGlow;
void main() {
  vec3 p = position + vec3(sin(uTime * 1.1 + phase * 30.0) * 0.12, 0.0, 0.0);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Each light joins in at its own moment and flickers a little.
  vGlow = smoothstep(phase, phase + 0.15, uPhones * 1.15) * (0.7 + 0.3 * sin(uTime * 3.0 + phase * 50.0));
  gl_PointSize = uScale * 0.5 / max(1.0, -mvPosition.z);
}`;
const PHONE_FRAGMENT = /* glsl */ `
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * vGlow * smoothstep(0.5, 0.05, d), 1.0);
}`;

export interface Crowd {
  /** Everybody except the main stand. */
  mesh: THREE.Mesh | null;
  /** The supporters on the camera-side stand. */
  mainMesh: THREE.Mesh | null;
  phones: THREE.Points | null;
  /** Seats that can light up as a camera flash: positions for the renderer's flash points. */
  bulbs: number[];
  update(mood: CrowdMood): void;
  /** Height of the drawing buffer in pixels, so the phone lights keep their size. */
  setViewport(height: number): void;
}

/**
 * The supporters as camera-facing cards from one atlas: a single draw call for the ground and one for the main stand.
 * Poses, hopping, the wave and the mosaic are all decided in the vertex shader from a few numbers per frame.
 */
export function createCrowd(seats: readonly Seat[], seed: number, colors: CrowdColors, atlas: THREE.Texture, options: { night: boolean; light: THREE.ColorRepresentation; terrace: boolean }): Crowd {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    atlas: { value: atlas },
    uTime: { value: 0 },
    uMood: { value: new THREE.Vector4(0, 0, 0, 0) },
    uWave: { value: -1 },
    uTerrace: { value: options.terrace ? 1 : 0 },
    uLight: { value: new THREE.Color(options.light) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, fog: true });
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const home = colors.home.map((value) => new THREE.Color(value)), away = colors.away.map((value) => new THREE.Color(value));
  const mosaic = colors.mosaic.map((value) => new THREE.Color(value)), skins = SKIN.map((value) => new THREE.Color(value));
  const staff = new THREE.Color('#20262d');
  const build = (subset: Seat[], offset: number): THREE.Mesh | null => {
    if (!subset.length) return null;
    const count = subset.length;
    const seat = new Float32Array(count * 3), tint = new Float32Array(count * 3), card = new Float32Array(count * 3), skin = new Float32Array(count * 3), fan = new Float32Array(count * 4);
    subset.forEach((entry, i) => {
      const roll = seatRoll(seed, offset + i * 3), pick = seatRoll(seed, offset + i * 3 + 1), phase = seatRoll(seed, offset + i * 3 + 2);
      seat.set([entry.x, entry.y, entry.z], i * 3);
      const palette = entry.block === 1 ? away : home;
      (entry.block === 2 ? staff : palette[Math.floor(pick * palette.length)]).toArray(tint, i * 3);
      if (entry.u >= 0) mosaic[colors.card(entry.u, entry.v)].toArray(card, i * 3); else card.set([-1, -1, -1], i * 3);
      skins[Math.floor(roll * skins.length)].toArray(skin, i * 3);
      fan.set([phase, entry.block, entry.around, entry.y < 0.3 ? 1 : 0], i * 4);
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    geometry.setAttribute('seat', new THREE.InstancedBufferAttribute(seat, 3));
    geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 3));
    geometry.setAttribute('card', new THREE.InstancedBufferAttribute(card, 3));
    geometry.setAttribute('skin', new THREE.InstancedBufferAttribute(skin, 3));
    geometry.setAttribute('fan', new THREE.InstancedBufferAttribute(fan, 4));
    geometry.instanceCount = count;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = 'crowd';
    return mesh;
  };
  const ground = seats.filter((entry) => !entry.main), mainStand = seats.filter((entry) => entry.main);
  const mesh = build(ground, 0), mainMesh = build(mainStand, ground.length * 3);

  // Camera flashes and phone lights sit with the supporters of the visible stands.
  const bulbs: number[] = [], lights: number[] = [], lightPhase: number[] = [];
  ground.forEach((entry, i) => {
    if (entry.block === 2) return;
    const roll = seatRoll(seed ^ 0x5bd1e995, i);
    if (roll < 0.07) bulbs.push(entry.x, entry.y + 0.75, entry.z);
    else if (options.night && roll < 0.3) { lights.push(entry.x, entry.y + 0.95, entry.z); lightPhase.push(seatRoll(seed ^ 0x1234567, i)); }
  });
  let phones: THREE.Points | null = null;
  const phoneUniforms = { uTime: uniforms.uTime, uPhones: { value: 0 }, uScale: { value: 720 } };
  if (lights.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
    geometry.setAttribute('phase', new THREE.Float32BufferAttribute(lightPhase, 1));
    phones = new THREE.Points(geometry, new THREE.ShaderMaterial({ uniforms: phoneUniforms, vertexShader: PHONE_VERTEX, fragmentShader: PHONE_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    phones.frustumCulled = false;
    phones.name = 'crowd';
    phones.visible = false;
  }
  return {
    mesh, mainMesh, phones, bulbs,
    update(mood) {
      uniforms.uTime.value = mood.time;
      uniforms.uMood.value.set(mood.home, mood.away, mood.chant, mood.choreo);
      uniforms.uWave.value = mood.wave;
      phoneUniforms.uPhones.value = mood.phones;
      if (phones) phones.visible = mood.phones > 0.01;
    },
    setViewport(height) { phoneUniforms.uScale.value = height; },
  };
}
