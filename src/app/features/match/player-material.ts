import * as THREE from 'three';
import { KitDesign, KitPattern } from '../../models/visual.model';

/** Surface kinds a vertex of a footballer can have; the shader treats cloth and skin differently. */
export const enum Surface { Other = 0, Fabric = 1, Skin = 2 }

/** Shader ids of the shirt patterns (0: plain). */
export const KIT_PATTERN_ID: Record<KitPattern, number> = { solid: 0, halves: 1, stripes: 2, pinstripes: 3, hoops: 4, 'chest-band': 5, sash: 6, chevron: 7 };

/**
 * Whether a point of the shirt shows the secondary colour. `u` runs from -1 (the wearer's right shoulder) to 1, `v` from 0
 * (hem) to 1 (collar). The shader does the same with soft edges; this is the reference for the tests.
 */
export function kitPatternMask(pattern: KitPattern, u: number, v: number): boolean {
  switch (pattern) {
    case 'halves': return u < 0;
    case 'stripes': return Math.abs(Math.abs(u) - 0.6) < 0.14 || Math.abs(u) < 0.14;
    case 'pinstripes': return Math.abs(Math.abs(u) - 0.6) < 0.04 || Math.abs(u) < 0.04;
    case 'hoops': return Math.abs(((v + 0.1) % 0.27) - 0.135) < 0.05;
    case 'chest-band': return Math.abs(v - 0.66) < 0.11;
    case 'sash': return Math.abs(u * 0.5 + (v - 0.5) * 1.15) < 0.15;
    case 'chevron': return Math.abs(v - 0.58 - Math.abs(u) * 0.2) < 0.05;
    default: return false;
  }
}

const PRINT_CELL_W = 128, PRINT_CELL_H = 160, PRINT_COLUMNS = 8, PRINT_ROWS = 6;
let printCanvas: HTMLCanvasElement | null = null;
let printTexture: THREE.CanvasTexture | THREE.Texture | null = null;
const printSlots: boolean[] = new Array(PRINT_COLUMNS * PRINT_ROWS).fill(false);

/** The texture every shirt print of the match lives in: one upload, one sampler, no extra draw call per player. */
export function printAtlas(): THREE.Texture {
  if (printTexture) return printTexture;
  if (typeof document !== 'undefined') {
    printCanvas = document.createElement('canvas');
    printCanvas.width = PRINT_CELL_W * PRINT_COLUMNS; printCanvas.height = PRINT_CELL_H * PRINT_ROWS;
    const texture = new THREE.CanvasTexture(printCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return printTexture = texture;
  }
  return printTexture = new THREE.Texture();
}

export interface PrintCell {
  /** Atlas coordinates of the cell: left, bottom, right, top. */
  uv: [number, number, number, number];
  release(): void;
}

/** Draws name and number into a free cell of the atlas. Returns null without a canvas (tests) or when every cell is taken. */
export function acquirePrint(kit: KitDesign, kitNumber: number, name: string): PrintCell | null {
  printAtlas();
  const ctx = printCanvas?.getContext('2d');
  const slot = printSlots.indexOf(false);
  if (!ctx || !printCanvas || slot < 0) return null;
  printSlots[slot] = true;
  const column = slot % PRINT_COLUMNS, row = Math.floor(slot / PRINT_COLUMNS);
  const x = column * PRINT_CELL_W, y = row * PRINT_CELL_H;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, PRINT_CELL_W, PRINT_CELL_H); ctx.clip();
  ctx.clearRect(x, y, PRINT_CELL_W, PRINT_CELL_H);
  ctx.fillStyle = kit.number;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const label = name.toLocaleUpperCase().slice(0, 12);
  ctx.font = `700 ${label.length > 8 ? 17 : 21}px system-ui, sans-serif`;
  ctx.fillText(label, x + 64, y + 30, PRINT_CELL_W - 8);
  ctx.font = '800 104px system-ui, sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = kit.trim;
  const digits = String(Math.max(0, kitNumber) % 100);
  ctx.strokeText(digits, x + 64, y + 138, PRINT_CELL_W - 10);
  ctx.fillText(digits, x + 64, y + 138, PRINT_CELL_W - 10);
  ctx.restore();
  if (printTexture) printTexture.needsUpdate = true;
  const width = printCanvas.width, height = printCanvas.height;
  // A hair inside the cell, so neighbours never bleed in.
  return {
    uv: [(x + 1) / width, 1 - (y + PRINT_CELL_H - 1) / height, (x + PRINT_CELL_W - 1) / width, 1 - (y + 1) / height],
    release: () => { printSlots[slot] = false; },
  };
}

/** Rim light of the scene, shared by every footballer: its colour and strength follow the atmosphere of the ground. */
const RIM = { value: new THREE.Vector4(0.83, 0.9, 1, 0.22) };
export function setFootballerRim(color: THREE.ColorRepresentation, strength: number): void {
  const c = new THREE.Color(color);
  RIM.value.set(c.r, c.g, c.b, strength);
}

/** What a match leaves on a player: all 0 to 1, only drawn. `seed` moves the stains to different places on every player. */
export interface PlayerTraces { mud: number; wet: number; sweat: number; seed: number }

const VERTEX_HEAD = /* glsl */ `
attribute vec4 kitA; attribute vec3 kitB; attribute vec2 printUv;
varying vec4 vKitA; varying vec3 vKitB; varying vec2 vPrintUv; varying vec3 vBind;
`;
const FRAGMENT_HEAD = /* glsl */ `
varying vec4 vKitA; varying vec3 vKitB; varying vec2 vPrintUv; varying vec3 vBind;
uniform sampler2D printAtlas; uniform vec4 playerTrace; uniform vec4 playerRim;
float kitBand(float d, float reach) { float w = fwidth(d) + 0.0005; return 1.0 - smoothstep(reach - w, reach + w, abs(d)); }
float kitMask(float id, vec2 p) {
  if (id < 1.5) return 1.0 - smoothstep(-fwidth(p.x), fwidth(p.x), p.x);
  if (id < 2.5) return max(kitBand(abs(p.x) - 0.6, 0.14), kitBand(p.x, 0.14));
  if (id < 3.5) return max(kitBand(abs(p.x) - 0.6, 0.04), kitBand(p.x, 0.04));
  if (id < 4.5) return kitBand(mod(p.y + 0.1, 0.27) - 0.135, 0.05);
  if (id < 5.5) return kitBand(p.y - 0.66, 0.11);
  if (id < 6.5) return kitBand(p.x * 0.5 + (p.y - 0.5) * 1.15, 0.15);
  return kitBand(p.y - 0.58 - abs(p.x) * 0.2, 0.05);
}
float traceHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float traceNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(traceHash(i), traceHash(i + vec2(1.0, 0.0)), f.x), mix(traceHash(i + vec2(0.0, 1.0)), traceHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
const FRAGMENT_COLOR = /* glsl */ `
  float isFabric = step(0.5, vKitA.w) * step(vKitA.w, 1.5), isSkin = step(1.5, vKitA.w);
  // The shirt pattern is a mask in the shader, so it follows the cloth instead of floating on it.
  if (vKitA.z > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vKitB, kitMask(vKitA.z, vKitA.xy));
  if (vPrintUv.x >= 0.0) { vec4 print = texture2D(printAtlas, vPrintUv); diffuseColor.rgb = mix(diffuseColor.rgb, print.rgb, print.a); }
  // A fine weave that only shows from close up.
  float weaveFade = 1.0 - smoothstep(0.0015, 0.006, fwidth(vBind.x) + fwidth(vBind.y));
  diffuseColor.rgb *= 1.0 + isFabric * weaveFade * 0.09 * sin(vBind.x * 900.0) * sin(vBind.y * 900.0);
  // Grass and mud from slides: blotches that sit low on the body first; rain turns them from green to brown.
  float low = 1.0 - smoothstep(0.35, 1.3, vBind.y);
  float blotch = traceNoise(vBind.xy * 11.0 + vBind.z * 7.0 + playerTrace.w * 31.0);
  float stain = smoothstep(1.02 - playerTrace.x * (0.3 + 0.6 * low), 1.12 - playerTrace.x * (0.3 + 0.6 * low), blotch + 0.25 * low) * (isFabric + isSkin * 0.6) * smoothstep(0.0, 0.06, playerTrace.x);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.13, 0.21, 0.07), vec3(0.17, 0.12, 0.07), playerTrace.y), stain * 0.78);
  // Soaked cloth is darker.
  diffuseColor.rgb *= 1.0 - 0.2 * playerTrace.y * isFabric;
`;
const FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, 0.48, playerTrace.y * isFabric);
  // Sweat makes tired skin shine.
  roughnessFactor = mix(roughnessFactor, 0.3, max(playerTrace.z, playerTrace.y * 0.6) * isSkin);
`;
const FRAGMENT_RIM = /* glsl */ `
  float rimEdge = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);
  outgoingLight += playerRim.rgb * rimEdge * playerRim.a * (0.4 + 0.6 * saturate(normal.y + 0.6));
`;

/**
 * The material of one footballer. Every player has his own instance (his traces are uniforms of it), but they all compile to
 * the same program: colours, pattern, print and surface kind are vertex data.
 */
export function createFootballerMaterial(): { material: THREE.MeshStandardMaterial; traces: THREE.Vector4 } {
  const traces = new THREE.Vector4(0, 0, 0, 0);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['printAtlas'] = { value: printAtlas() };
    shader.uniforms['playerTrace'] = { value: traces };
    shader.uniforms['playerRim'] = RIM;
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vKitA = kitA; vKitB = kitB; vPrintUv = printUv; vBind = position;');
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAGMENT_ROUGHNESS)
      .replace('#include <opaque_fragment>', FRAGMENT_RIM + '\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'footballer-cloth-v1';
  return { material, traces };
}
