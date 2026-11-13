import * as THREE from 'three';
import { hash32 } from '../../core/visual-identity';
import { Puddle } from '../../core/football/weather';

/** How the ground staff mow this pitch. */
export type MowPattern = 'stripes' | 'checker' | 'rings' | 'diagonal';
const PATTERNS: readonly MowPattern[] = ['stripes', 'checker', 'rings', 'diagonal'];
/** Most grounds mow plain stripes; the others are spread over the rest. */
const PATTERN_ROLL: readonly MowPattern[] = ['stripes', 'stripes', 'stripes', 'checker', 'checker', 'rings', 'diagonal', 'diagonal'];
export const MAX_PUDDLES = 12;

/** The mowing pattern of a ground, fixed by the club's seed. */
export function mowPattern(seed: number): MowPattern {
  return PATTERN_ROLL[hash32(`${seed}|mow`) % PATTERN_ROLL.length];
}

/** Width of one mown band in metres: as close to 5.5 m as divides the pitch length evenly. */
export function bandWidth(length: number): number {
  return length / Math.max(2, Math.round(length / 5.5));
}

/**
 * Which way the mower drove over a point (scene metres from the centre): +1 or -1 per band, and the unit direction the blades
 * lean. The shader does the same with smooth band edges; this is the reference the tests check.
 */
export function mowLean(pattern: MowPattern, x: number, z: number, length: number, width: number): { band: number; x: number; z: number } {
  const band = bandWidth(length), sign = (t: number) => (Math.floor(t) % 2 === 0 ? 1 : -1);
  const mx = x + length / 2, mz = z + width / 2;
  if (pattern === 'checker') { const a = sign(mx / band), b = sign(mz / band); return { band: a * b, x: -b * Math.SQRT1_2, z: -a * Math.SQRT1_2 }; }
  if (pattern === 'rings') { const r = Math.hypot(x, z) || 1, s = sign(r / band); return { band: s, x: -z / r * s, z: x / r * s }; }
  if (pattern === 'diagonal') { const s = sign((mx + mz) / (band * Math.SQRT2)); return { band: s, x: Math.SQRT1_2 * s, z: -Math.SQRT1_2 * s }; }
  const s = sign(mx / band);
  return { band: s, x: 0, z: -s };
}

/**
 * Brightness of mown grass, 0 (dark band) to 1 (light band): blades that lean away from the eye show their shiny side.
 * A share of the contrast is fixed, so the pattern never vanishes from a camera that looks along the bands.
 */
export function mowTone(band: number, leanX: number, leanZ: number, toEyeX: number, toEyeZ: number): number {
  const length = Math.hypot(toEyeX, toEyeZ) || 1;
  const sheen = -(leanX * toEyeX + leanZ * toEyeZ) / length;
  return 0.5 + 0.5 * Math.max(-1, Math.min(1, 0.3 * band + 0.7 * sheen));
}

/** How much of the pitch the snow covers, 0 to 1: a thin cover at kick-off that closes over the ninety minutes. */
export function snowCover(minute: number): number {
  return 0.38 + 0.5 * Math.max(0, Math.min(1, minute / 90));
}

export interface PitchSurfaceOptions {
  length: number;
  width: number;
  seed: number;
  weather: 'clear' | 'rain' | 'storm' | 'snow';
  /** Colour the puddles mirror: the horizon of this ground's sky. */
  sky: THREE.ColorRepresentation;
  puddles: readonly Puddle[];
  wear: THREE.Texture;
  /** The finer map of scrapes (slides), laid out like the wear map. */
  scuff: THREE.Texture;
  /** +1 or -1: whether the scene shows the pitch mirrored along its length (shared with the renderer). */
  mirror: { value: number };
  /** An unlit material for software rendering. */
  unlit: boolean;
  bump?: THREE.Texture;
  /** Small-sided cage: artificial turf with a faint pattern. */
  cage?: boolean;
}

export interface PitchSurface {
  material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  pattern: MowPattern;
  /** Snow cover 0 to 1 (only drawn in snow). */
  setSnow(cover: number): void;
  /** 1 draws every detail, 0 only the bands (low profile). */
  setDetail(level: number): void;
}

const NOISE = /* glsl */ `
float pitchHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float pitchNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pitchHash(i), pitchHash(i + vec2(1.0, 0.0)), f.x), mix(pitchHash(i + vec2(0.0, 1.0)), pitchHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// A square wave of period 2 with edges one pixel soft: +1 on even bands, -1 on odd ones.
float pitchBand(float t) { return clamp(sin(t * 3.14159265) / (fwidth(t) * 3.14159265 + 0.015), -1.0, 1.0); }
`;

const SURFACE = /* glsl */ `
  vec2 pc = vPitchWorld.xz;
  vec2 pm = pc + pitchSize.xy * 0.5;
  vec2 psim = vec2(wearMirror > 0.0 ? pm.x : pitchSize.x - pm.x, pm.y);
  float bw = pitchSize.z;
  float band; vec2 lean;
  if (pitchSize.w < 0.5) { band = pitchBand(pm.x / bw); lean = vec2(0.0, -band); }
  else if (pitchSize.w < 1.5) { float a = pitchBand(pm.x / bw), b = pitchBand(pm.y / bw); band = a * b; lean = vec2(-b, -a) * 0.7071; }
  else if (pitchSize.w < 2.5) { float r = max(0.001, length(pc)); band = pitchBand(r / bw); lean = vec2(-pc.y, pc.x) / r * band; }
  else { band = pitchBand((pm.x + pm.y) / (bw * 1.41421)); lean = vec2(0.7071, -0.7071) * band; }
  vec2 toEye = cameraPosition.xz - pc;
  float sheen = -dot(lean, toEye) / max(0.001, length(toEye));
  float tone = 0.5 + 0.5 * clamp(0.3 * band + 0.7 * sheen, -1.0, 1.0);
  tone = mix(0.5, tone, pitchLook.x);
  vec3 grass = mix(grassDark, grassLight, tone);
  float detail = pitchLook.y;
  // Two scales of detail: patches of a few metres, and blades that only show from close up.
  float coarse = pitchNoise(pm * 0.11) * 0.6 + pitchNoise(pm * 0.37 + 17.0) * 0.4;
  grass *= 0.9 + 0.2 * coarse;
  float px = max(fwidth(pm.x), fwidth(pm.y));
  if (detail > 0.5) {
    float mid = pitchNoise(pm * 4.3) - 0.5, fine = pitchNoise(pm * vec2(41.0, 17.0)) - 0.5;
    grass *= 1.0 + mid * 0.12 * (1.0 - smoothstep(0.15, 0.7, px)) + fine * 0.26 * (1.0 - smoothstep(0.012, 0.09, px));
  }
  // Worn goal mouths, then the wear of this match: footsteps brown the turf, slides scrape it down to the soil.
  vec2 mouth = vec2(min(pm.x, pitchSize.x - pm.x) - 4.5, (pm.y - pitchSize.y * 0.5) * 0.8) / 3.4;
  vec2 wearUv = vec2(psim.x / pitchSize.x, 1.0 - psim.y / pitchSize.y);
  float worn = max(texture2D(wearMap, wearUv).r, exp(-dot(mouth, mouth)) * 0.07);
  grass = mix(grass, grass * vec3(0.78, 0.7, 0.52), min(1.0, worn * 2.4) * 0.85);
  float scuff = texture2D(scuffMap, wearUv).r;
  grass = mix(grass, vec3(0.11, 0.08, 0.05), smoothstep(0.1, 0.55, scuff) * 0.8);
  float puddle = 0.0;
  float snow = 0.0;
  if (pitchLook.z > 0.5) {
    for (int i = 0; i < ${MAX_PUDDLES}; i++) {
      vec3 spot = puddles[i];
      if (spot.z <= 0.0) continue;
      float rim = spot.z * (0.7 + 0.45 * pitchNoise(psim * 0.9 + float(i) * 7.3));
      puddle = max(puddle, 1.0 - smoothstep(rim * 0.7, rim, length(psim - spot.xy)));
    }
    grass = mix(grass, mix(grass * 0.8, puddleSky, 0.42), puddle);
  }
  if (pitchLook.w > 0.0) {
    // Snow settles in patches that grow together; trodden paths stay open.
    float lie = coarse * 0.45 + pitchNoise(pm * 1.7 + 5.0) * 0.4 + (detail > 0.5 ? pitchNoise(pm * 9.0) * 0.15 : 0.075);
    float edge = 0.86 - pitchLook.w * 0.9;
    snow = smoothstep(edge, edge + 0.22, lie) * (1.0 - min(1.0, worn * 3.2 + scuff * 4.0) * 0.85);
    grass = mix(grass, vec3(0.80, 0.85, 0.89) * (0.93 + 0.07 * tone), snow);
  }
  diffuseColor.rgb *= grass;
`;

/**
 * The grass as a shader instead of a baked texture: mown bands whose brightness depends on where the camera stands, noise
 * in two scales that stays sharp in close shots, the wear of the match, puddles in the rain and a snow cover that grows.
 * Works on the lit and on the unlit material.
 */
export function createPitchSurface(options: PitchSurfaceOptions): PitchSurface {
  const { weather } = options;
  const wet = weather !== 'clear', snowy = weather === 'snow';
  const pattern = mowPattern(options.seed);
  const light = new THREE.Color(wet ? '#246743' : '#2b8048'), dark = new THREE.Color(wet ? '#205b39' : '#226e3e');
  const spots = Array.from({ length: MAX_PUDDLES }, (_, index) => {
    const puddle = options.puddles[index];
    return puddle ? new THREE.Vector3(puddle.x, puddle.y, puddle.radius) : new THREE.Vector3(0, 0, 0);
  });
  const uniforms = {
    wearMap: { value: options.wear },
    scuffMap: { value: options.scuff },
    wearMirror: options.mirror,
    // Length, width, band width, pattern index.
    pitchSize: { value: new THREE.Vector4(options.length, options.width, bandWidth(options.length), PATTERNS.indexOf(pattern)) },
    // Pattern strength, detail level, puddles on or off, snow cover.
    pitchLook: { value: new THREE.Vector4(options.cage ? 0.3 : 1, 1, options.puddles.length ? 1 : 0, snowy ? snowCover(0) : 0) },
    grassLight: { value: light },
    grassDark: { value: dark },
    // Water mirrors the sky; under a dark one it still catches the floodlights.
    puddleSky: { value: new THREE.Color(options.sky).lerp(new THREE.Color('#a9bccb'), 0.35) },
    puddles: { value: spots },
  };
  const material = options.unlit
    ? new THREE.MeshBasicMaterial({ color: snowy ? '#c4d6cc' : '#9cc9a8' })
    : new THREE.MeshStandardMaterial({ bumpMap: options.bump ?? null, bumpScale: 0.35, roughness: wet ? (snowy ? 0.8 : 0.5) : 0.94, metalness: 0, color: '#ffffff', envMapIntensity: snowy ? 0.55 : wet ? 0.75 : 0.3 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vPitchWorld;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPitchWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let fragment = `varying vec3 vPitchWorld;
uniform sampler2D wearMap; uniform sampler2D scuffMap; uniform float wearMirror; uniform vec4 pitchSize; uniform vec4 pitchLook;
uniform vec3 grassLight; uniform vec3 grassDark; uniform vec3 puddleSky; uniform vec3 puddles[${MAX_PUDDLES}];
${NOISE}
` + shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + SURFACE);
    // Standing water is a mirror, snow is matt.
    fragment = fragment.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(mix(roughnessFactor, 0.05, puddle), 0.86, snow);');
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => 'pitch-surface';
  return {
    material, pattern,
    setSnow: (cover) => { if (snowy) uniforms.pitchLook.value.w = Math.max(0, Math.min(1, cover)); },
    setDetail: (level) => { uniforms.pitchLook.value.y = level; },
  };
}
