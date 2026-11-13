import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { KitDesign, PlayerVisualIdentity } from '../../models/visual.model';
import { hash32, mixHex } from '../../core/visual-identity';

const TAU = Math.PI * 2;
/** Iris colours; browns come up most often. */
const EYES = ['#4a2f1c', '#3a2416', '#5b3a21', '#2b1d14', '#5d6f3a', '#3d6d94', '#6a5a3c', '#4a2f1c'];

export const HAIR_STYLE_COUNT = 18;
/** Names of the hair styles, in the order of `identity.hairStyle % 18` (also used by the tests). */
export const HAIR_STYLES = ['bald', 'buzz', 'crop', 'afro', 'quiff', 'bun', 'mohawk', 'curls', 'side-part', 'ponytail', 'flat-top', 'dreads', 'spikes', 'long', 'slick-back', 'cornrows', 'curtains', 'band'] as const;
export const BEARD_STYLES = ['none', 'stubble', 'moustache', 'goatee', 'short-beard', 'full-beard'] as const;

export interface HeadContext {
  /** Adds a part in head space: the origin is the head joint, +Y up, +Z the face. */
  add(geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, scale?: THREE.Vector3, rotation?: THREE.Euler): void;
  identity: PlayerVisualIdentity;
  kit: KitDesign;
  skin: string;
  hair: string;
  headWidth: number;
  headDepth: number;
  /** Fewer segments and no small details for figures seen from far away. */
  compact: boolean;
}

/**
 * The skull as one smooth surface: a sphere narrowed towards the chin (squarer with a strong jaw), flattened at the
 * face, fuller at the back and a little flat on the crown.
 */
export function headGeometry(jaw: number, compact: boolean): THREE.BufferGeometry {
  const base = new THREE.SphereGeometry(1, compact ? 8 : 16, compact ? 6 : 12);
  base.deleteAttribute('uv');
  const geometry = mergeVertices(base, 1e-4);
  base.dispose();
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    let x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const low = Math.max(0, -y - 0.05);
    x *= 1 - low * low * (0.58 - jaw * 0.3);
    if (z > 0) z = z * (0.93 + 0.07 * Math.abs(y)) + low * 0.12;
    else z *= 1.05 + Math.max(0, y) * 0.05;
    if (y > 0.6) y = 0.6 + (y - 0.6) * 0.86;
    position.setXYZ(index, x, y, z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Everything above the collar: neck, skull, face, hair, beard and head wear. All of it rides rigidly on the head joint. */
export function buildHead(c: HeadContext): void {
  const { identity, skin, hair, compact } = c;
  const W = c.headWidth * 0.52, D = c.headDepth * 0.5;
  const seed = hash32(`${identity.seed}|face-v2`);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const ball = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, detail = 8) =>
    c.add(new THREE.SphereGeometry(1, compact ? 6 : detail, compact ? 4 : Math.max(5, detail - 2)), color, x, y, z, v(sx, sy, sz));
  const slab = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) =>
    c.add(new THREE.BoxGeometry(sx, sy, sz), color, x, y, z, undefined, new THREE.Euler(rx, ry, rz));
  const tube = (color: string, x: number, y: number, z: number, top: number, bottom: number, height: number, depth = 1, rx = 0, rz = 0) =>
    c.add(new THREE.CylinderGeometry(top, bottom, height, compact ? 6 : 10), color, x, y, z, v(1, 1, depth), new THREE.Euler(rx, 0, rz));
  /** The upper part of a sphere that sits on the skull like a cap: `down` is how far it reaches (radians from the crown). */
  const cap = (color: string, down: number, grow = 1, y = 0.018, lift = 0.158) =>
    c.add(new THREE.SphereGeometry(1, compact ? 8 : 14, compact ? 4 : 6, 0, TAU, 0, down), color, 0, y, -0.012, v(W * 1.07 * grow, lift * grow, D * 1.13 * grow));

  const shade = mixHex(skin, '#3a1f18', 0.16);
  const lip = mixHex(skin, '#8a3b3b', 0.42);
  const hairLight = mixHex(hair, '#ffffff', 0.16);
  const hairDark = mixHex(hair, '#000000', 0.28);
  const scalp = mixHex(skin, hair, 0.6);

  // Neck and skull. The neck is a touch darker: it sits in the shadow of the jaw.
  tube(shade, 0, -0.158, -0.004, 0.058, 0.07, 0.13);
  const jaw = (identity.headShape % 4) / 3;
  c.add(headGeometry(jaw, compact), skin, 0, -0.004, 0, v(W, 0.156, D));

  // Ears, with the shadow of the inner ear.
  for (const sign of [-1, 1]) {
    ball(skin, sign * W * 0.99, -0.012, -0.012, 0.022, 0.042, 0.026);
    if (!compact) ball(shade, sign * (W * 0.99 + 0.012), -0.014, -0.006, 0.008, 0.022, 0.013, 6);
  }

  // Eyes: set a little into the face under a lid, with a coloured iris, a pupil and a point of light.
  const eyeColor = EYES[seed % EYES.length];
  const eyeY = 0.016, eyeX = 0.047, eyeZ = D * 0.86;
  const browTilt = ((seed >>> 6) % 5 - 2) * 0.06;
  const browLift = ((seed >>> 9) % 3) * 0.004;
  for (const sign of [-1, 1]) {
    ball('#f6f3ea', sign * eyeX, eyeY, eyeZ, 0.029, 0.021, 0.012, 10);
    ball(eyeColor, sign * (eyeX - 0.002), eyeY + 0.001, eyeZ + 0.008, 0.0145, 0.0155, 0.006, 8);
    ball('#11161c', sign * (eyeX - 0.002), eyeY + 0.001, eyeZ + 0.0115, 0.0075, 0.0085, 0.004, 6);
    if (!compact) {
      ball('#ffffff', sign * (eyeX - 0.002) + 0.005, eyeY + 0.007, eyeZ + 0.0135, 0.0028, 0.0028, 0.002, 5);
      // Upper lid and the shadow under the brow.
      c.add(new THREE.SphereGeometry(1, 10, 4, 0, TAU, 0, Math.PI * 0.3), skin, sign * eyeX, eyeY + 0.003, eyeZ - 0.002, v(0.032, 0.026, 0.017), new THREE.Euler(-0.35, 0, 0));
    }
    // Brows taper towards the temple and carry the expression.
    slab(hairDark, sign * (eyeX + 0.002), 0.049 + browLift, eyeZ + 0.006, 0.05, 0.011, 0.012, 0, sign * -0.25, sign * (0.04 + browTilt));
    if (!compact) slab(hairDark, sign * (eyeX + 0.029), 0.049 + browLift, eyeZ - 0.004, 0.02, 0.008, 0.01, 0, sign * -0.55, sign * (-0.14 + browTilt));
  }

  // Nose: a bridge down from between the brows, a tip and two nostril wings.
  const noseWidth = 0.02 + ((seed >>> 12) % 4) * 0.0025;
  const noseLength = 0.036 + ((seed >>> 15) % 3) * 0.004;
  c.add(new THREE.CylinderGeometry(0.008, noseWidth * 0.7, noseLength + 0.03, compact ? 5 : 8), skin, 0, -0.012, D * 0.97, v(1, 1, 1.1), new THREE.Euler(-0.32, 0, 0));
  ball(skin, 0, -0.012 - noseLength, D * 0.99 + 0.02, noseWidth, 0.017, 0.022, 8);
  if (!compact) for (const sign of [-1, 1]) ball(shade, sign * noseWidth * 0.78, -0.016 - noseLength, D * 0.99 + 0.008, 0.008, 0.0075, 0.009, 5);

  // Mouth: two lips with a line between them; some players carry a hint of a smile.
  const mouthWidth = 0.05 + ((seed >>> 18) % 3) * 0.005;
  const smile = ((seed >>> 21) % 3) * 0.08;
  const mouthY = -0.088, mouthZ = D * 0.94 + 0.01;
  ball(lip, 0, mouthY - 0.005, mouthZ, mouthWidth * 0.5, 0.008, 0.012, 8);
  ball(lip, 0, mouthY + 0.004, mouthZ - 0.001, mouthWidth * 0.46, 0.0055, 0.011, 8);
  if (!compact) {
    slab('#4a2420', 0, mouthY, mouthZ + 0.009, mouthWidth * 0.86, 0.0035, 0.006);
    for (const sign of [-1, 1]) slab('#4a2420', sign * mouthWidth * 0.47, mouthY + 0.003 + smile * 0.05, mouthZ + 0.006, 0.012, 0.0035, 0.006, 0, sign * -0.5, sign * (0.25 + smile));
  }
  // Chin: rounder or squarer with the jaw.
  ball(skin, 0, -0.128, D * 0.6, W * (0.32 + jaw * 0.1), 0.034, 0.05, 8);

  buildBeard(c, { ball, slab }, W, D, mouthY, mouthZ, mouthWidth);
  buildHair(c, { ball, slab, tube, cap }, W, D, { hairLight, hairDark, scalp });

  if (identity.headAccessory !== 'none') {
    const protective = identity.headAccessory === 'protective-cap';
    tube(protective ? '#233344' : c.kit.trim, 0, protective ? 0.058 : 0.07, -0.01, W * 1.1, W * 1.12, protective ? 0.13 : 0.03, (D * 1.16) / (W * 1.1));
  }
}

type Ball = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, detail?: number) => void;
type Slab = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx?: number, ry?: number, rz?: number) => void;
type Tube = (color: string, x: number, y: number, z: number, top: number, bottom: number, height: number, depth?: number, rx?: number, rz?: number) => void;
type Cap = (color: string, down: number, grow?: number, y?: number, lift?: number) => void;

function buildBeard(c: HeadContext, t: { ball: Ball; slab: Slab }, W: number, D: number, mouthY: number, mouthZ: number, mouthWidth: number): void {
  const style = BEARD_STYLES[c.identity.facialHair % BEARD_STYLES.length];
  if (style === 'none') return;
  const { ball } = t;
  const hair = c.hair;
  const stubble = mixHex(c.skin, hair, 0.38);
  const moustache = () => { for (const sign of [-1, 1]) ball(hair, sign * mouthWidth * 0.27, mouthY + 0.014, mouthZ + 0.004, mouthWidth * 0.3, 0.008, 0.011, 6); };
  if (style === 'stubble') {
    // A shadow over jaw and upper lip rather than hair with volume.
    ball(stubble, 0, -0.098, D * 0.36, W * 0.69, 0.056, D * 0.7, 10);
    return;
  }
  if (style === 'moustache') { moustache(); return; }
  if (style === 'goatee') {
    moustache();
    ball(hair, 0, -0.128, D * 0.6 + 0.012, W * 0.27, 0.032, 0.042, 8);
    for (const sign of [-1, 1]) ball(hair, sign * mouthWidth * 0.55, mouthY - 0.012, mouthZ - 0.004, 0.007, 0.022, 0.009, 5);
    return;
  }
  const full = style === 'full-beard';
  // The beard follows the jaw from ear to ear and leaves the lips free.
  ball(full ? hair : mixHex(c.skin, hair, 0.72), 0, -0.106 - (full ? 0.008 : 0), D * 0.34, W * (full ? 0.8 : 0.72), full ? 0.074 : 0.06, D * (full ? 0.84 : 0.74), 10);
  for (const sign of [-1, 1]) ball(hair, sign * W * 0.86, -0.045, D * 0.12, 0.014, 0.05, 0.03, 6);
  moustache();
}

function buildHair(c: HeadContext, t: { ball: Ball; slab: Slab; tube: Tube; cap: Cap }, W: number, D: number, tone: { hairLight: string; hairDark: string; scalp: string }): void {
  const { ball, slab, tube, cap } = t;
  const { hair, compact } = c;
  const { hairLight, hairDark, scalp } = tone;
  const style = HAIR_STYLES[c.identity.hairStyle % HAIR_STYLE_COUNT];
  const top = 0.15;
  /** Short sides: the scalp shows through. */
  const fade = () => cap(scalp, 1.3, 1.005);
  /** Sideburns tie the hair to the face. */
  const sideburns = (color = hair) => { for (const sign of [-1, 1]) ball(color, sign * W * 0.93, 0.0, D * 0.3, 0.012, 0.04, 0.026, 5); };
  switch (style) {
    case 'bald':
      return;
    case 'buzz':
      cap(scalp, 1.36, 1.012);
      return;
    case 'crop':
      cap(hair, 1.46, 1.03);
      // A straight fringe across the forehead.
      slab(hair, 0, 0.082, D * 0.9, W * 1.5, 0.034, 0.05, -0.25);
      sideburns();
      return;
    case 'afro': {
      ball(hair, 0, 0.075, -0.012, W * 1.42, 0.172, D * 1.5, 12);
      const bumps = compact ? 6 : 12;
      for (let i = 0; i < bumps; i++) {
        const angle = i / bumps * TAU, ring = i % 2 ? 0.105 : 0.135;
        ball(i % 3 ? hair : hairLight, Math.cos(angle) * ring, 0.12 + (i % 2) * 0.07, Math.sin(angle) * ring - 0.012, 0.062, 0.062, 0.062, 6);
      }
      return;
    }
    case 'quiff':
      cap(hair, 1.5, 1.03);
      ball(hair, 0, top - 0.012, 0.03, W * 0.92, 0.062, 0.1, 10);
      ball(hairLight, 0, top + 0.012, 0.075, W * 0.74, 0.05, 0.06, 8);
      sideburns();
      return;
    case 'bun':
      cap(hair, 1.52, 1.025);
      ball(hair, 0, 0.07, -D * 0.98, W * 0.7, 0.08, 0.05, 8);
      ball(hairLight, 0, 0.118, -D * 1.3, 0.052, 0.052, 0.052, 8);
      return;
    case 'mohawk': {
      fade();
      const ridge = compact ? 4 : 7;
      for (let i = 0; i < ridge; i++) {
        const along = i / (ridge - 1), z = 0.085 - along * 0.2;
        ball(i % 2 ? hair : hairLight, 0, top + 0.022 + Math.sin(along * Math.PI) * 0.018, z, 0.03, 0.058, 0.04, 6);
      }
      return;
    }
    case 'curls': {
      cap(hair, 1.46, 1.03);
      const curls = compact ? 8 : 18;
      for (let i = 0; i < curls; i++) {
        const angle = i * 2.399963, ring = Math.sqrt((i + 0.5) / curls);
        const x = Math.cos(angle) * ring * W * 0.95, z = Math.sin(angle) * ring * D * 1.0 - 0.012;
        ball(i % 4 === 0 ? hairLight : hair, x, top + 0.012 - ring * ring * 0.075, z, 0.04, 0.036, 0.04, 6);
      }
      sideburns();
      return;
    }
    case 'side-part':
      cap(hair, 1.5, 1.03);
      ball(hair, W * 0.26, top - 0.004, 0.012, W * 0.86, 0.048, D * 1.02, 10);
      ball(hairLight, W * 0.36, top + 0.008, 0.05, W * 0.56, 0.036, 0.06, 8);
      // The parting.
      slab(scalp, -W * 0.42, top + 0.004, 0.0, 0.006, 0.012, D * 1.5, 0, 0, 0.5);
      sideburns();
      return;
    case 'ponytail': {
      cap(hair, 1.52, 1.025);
      ball(c.kit.trim, 0, 0.075, -D * 1.18, 0.022, 0.022, 0.022, 6);
      const links = compact ? 3 : 5;
      for (let i = 0; i < links; i++) ball(i === links - 1 ? hairLight : hair, 0, 0.055 - i * 0.045, -D * 1.24 - Math.sin(i / links * Math.PI) * 0.03, 0.036 - i * 0.004, 0.04, 0.034 - i * 0.003, 6);
      return;
    }
    case 'flat-top':
      fade();
      // A low, level block on top of faded sides.
      cap(hair, 0.95, 1.035);
      tube(hair, 0, top + 0.01, -0.01, W * 0.8, W * 0.9, 0.046, (D * 1.02) / (W * 0.85));
      tube(hairLight, 0, top + 0.035, -0.01, W * 0.78, W * 0.8, 0.006, (D * 1.02) / (W * 0.85));
      return;
    case 'dreads': {
      cap(hairDark, 1.5, 1.035);
      const locks = compact ? 9 : 16;
      for (let i = 0; i < locks; i++) {
        // Round the back and the sides, leaving the face free.
        const angle = Math.PI * 0.36 + i / (locks - 1) * Math.PI * 1.28;
        const length = 0.17 + (i % 3) * 0.035;
        tube(i % 4 === 0 ? hairLight : hair, Math.sin(angle) * W * 1.06, 0.07 - length / 2, Math.cos(angle) * D * 1.12 - 0.012, 0.017, 0.013, length, 1, Math.cos(angle) * 0.12, -Math.sin(angle) * 0.12);
      }
      // Tied up on top.
      for (let i = 0; i < 5; i++) ball(hair, Math.cos(i * 1.26) * 0.05, top + 0.012, Math.sin(i * 1.26) * 0.05 - 0.012, 0.036, 0.03, 0.036, 6);
      return;
    }
    case 'spikes': {
      cap(hair, 1.42, 1.025);
      const spikes = compact ? 6 : 13;
      for (let i = 0; i < spikes; i++) {
        const angle = i * 2.399963, ring = Math.sqrt((i + 0.5) / spikes) * 0.82;
        const x = Math.cos(angle) * ring * W, z = Math.sin(angle) * ring * D - 0.012;
        c.add(new THREE.ConeGeometry(0.026, 0.085, compact ? 4 : 6), i % 3 === 0 ? hairLight : hair, x, top + 0.035 - ring * ring * 0.06, z, undefined, new THREE.Euler(z * 3.2, 0, -x * 3.2));
      }
      sideburns();
      return;
    }
    case 'long':
      cap(hair, 1.56, 1.035);
      ball(hair, 0, -0.045, -D * 0.74, W * 1.06, 0.17, 0.072, 10);
      for (const sign of [-1, 1]) ball(hair, sign * W * 0.99, -0.055, -0.025, 0.034, 0.13, 0.062, 8);
      ball(hairLight, 0, top + 0.004, 0.01, W * 0.7, 0.03, D * 0.8, 8);
      return;
    case 'slick-back':
      fade();
      ball(hair, 0, top - 0.02, -0.022, W * 0.8, 0.056, D * 1.16, 10);
      ball(hairLight, 0, top - 0.004, 0.03, W * 0.6, 0.034, 0.07, 8);
      ball(hair, 0, 0.085, -D * 1.1, W * 0.6, 0.05, 0.045, 8);
      return;
    case 'cornrows': {
      cap(hairDark, 1.46, 1.02);
      const rows = compact ? 5 : 9;
      for (let i = 0; i < rows; i++) {
        const across = (i / (rows - 1) - 0.5) * 2;
        // Each braid is an arc from the nape over the crown to the hairline.
        const radius = Math.sqrt(Math.max(0.05, 1 - across * across * 0.85));
        c.add(new THREE.TorusGeometry(1, 0.085, compact ? 4 : 5, compact ? 8 : 14, Math.PI * 0.86), hair, across * W * 0.9, 0.022, -0.012,
          new THREE.Vector3(D * 1.14 * radius, 0.158 * radius, 0.011 / 0.085), new THREE.Euler(0, Math.PI / 2, -Math.PI * 0.14));
      }
      return;
    }
    case 'curtains':
      cap(hair, 1.5, 1.03);
      for (const sign of [-1, 1]) {
        ball(hair, sign * W * 0.5, top - 0.012, 0.03, W * 0.6, 0.05, D * 0.92, 8);
        ball(hairLight, sign * W * 0.66, 0.07, D * 0.78, 0.03, 0.05, 0.03, 6);
      }
      sideburns();
      return;
    case 'band':
      cap(hair, 1.54, 1.035);
      ball(hair, 0, -0.01, -D * 0.82, W * 0.98, 0.115, 0.07, 10);
      ball(hairLight, 0, top + 0.006, -0.02, W * 0.78, 0.034, D * 0.9, 8);
      // A thin band holds it off the forehead.
      c.add(new THREE.TorusGeometry(1, 0.07, compact ? 4 : 6, compact ? 10 : 20), c.kit.trim, 0, 0.082, -0.012, new THREE.Vector3(W * 1.1, D * 1.16, 0.014 / 0.07), new THREE.Euler(Math.PI / 2 - 0.22, 0, 0));
      return;
  }
}
