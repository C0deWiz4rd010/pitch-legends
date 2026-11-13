import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PlayerVisualIdentity, KitDesign } from '../../models/visual.model';
import { PlayerRuntimeSnapshot } from '../../models/match.model';
import { hash32 } from '../../core/visual-identity';
import { blendJointSkin } from './joint-skinning';
import { createLimbSurface } from './limb-surface';
import { ACTION_CONTACT_TICKS, ACTION_DURATION_TICKS } from '../../core/football/action-timing';
import { advanceGait, GaitMemory, newGait, strideFor, turnStepAmount } from './animation/locomotion';
import { blendSecondsFor, limpLoad } from './animation/kick-phase';
import { poseBicycleKick, poseFakeShot, poseFlyingHeader, poseKeeperPunch, poseKeeperSmother, poseKick, poseWallJump } from './animation/action-poses';
import { boneSlot, clipSet, ClipSet, sampleLocomotion, sampleSingle } from './animation/clip-store';

const SKIN = ['#f5d0a9', '#e9b989', '#d99a68', '#bf7b50', '#9b5c3d', '#75422f', '#573126', '#35221f'];
const HAIR = ['#17141d', '#2c1b18', '#4b2e24', '#71462b', '#9b673d', '#c89b62', '#d9c6a2', '#702c32'];
const TAU = Math.PI * 2;

/** A separate visual seed never advances the match's random number generator. */
export interface PlayerAppearanceRecipe {
  version: 1;
  seed: number;
  height: number;
  shoulderWidth: number;
  headWidth: number;
  headDepth: number;
  skin: string;
  hair: string;
  identity: PlayerVisualIdentity;
}

export function createAppearanceRecipe(identity: PlayerVisualIdentity): PlayerAppearanceRecipe {
  const seed = hash32(`${identity.seed}|footballer-3d-v1`);
  const build = identity.bodyBuild === 'strong' ? 1.12 : identity.bodyBuild === 'slim' ? 0.90 : 1;
  return {
    version: 1, seed,
    height: 1.69 + (seed % 25) / 100,
    shoulderWidth: (0.405 + ((seed >>> 8) % 8) / 1000) * build,
    headWidth: 0.235 + identity.headShape % 4 * 0.009,
    headDepth: 0.238 + Math.floor(identity.headShape / 2) * 0.006,
    skin: SKIN[identity.skinTone % SKIN.length],
    hair: HAIR[identity.hairColor % HAIR.length],
    identity: { ...identity },
  };
}

type Joint = 'hips' | 'spine' | 'chest' | 'head' | 'leftThigh' | 'leftShin' | 'leftFoot' |
  'rightThigh' | 'rightShin' | 'rightFoot' | 'leftArm' | 'leftForearm' | 'leftHand' |
  'rightArm' | 'rightForearm' | 'rightHand';

/** All body parts share one draw call and one skeleton; no per-part materials. */
export interface ProceduralFootballer {
  mesh: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>;
  joints: Record<Joint, THREE.Bone>;
  recipe: PlayerAppearanceRecipe;
  hipHeight: number;
  thighLength: number;
  shinLength: number;
  footedness: 1 | -1;
  /** Goalkeepers use the keeper poses; outfield players use the same action names for throw-ins. */
  goalkeeper: boolean;
  /** A cheer chosen by the player (Legends Path): the celebration number this figure always uses. */
  cheer?: number;
  destroy(): void;
}

/** Merge rigid/smooth-skinned primitives into one geometry without material groups. */
class SkinGeometry {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private skinIndices: number[] = [];
  private skinWeights: number[] = [];

  add(geometry: THREE.BufferGeometry, color: string, bone: number, position: THREE.Vector3, scale = new THREE.Vector3(1, 1, 1), rotation = new THREE.Euler()): void {
    const matrix = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
    geometry.applyMatrix4(matrix);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = flat.getAttribute('position');
    const n = flat.getAttribute('normal');
    const indices = flat.getAttribute('skinIndex'), weights = flat.getAttribute('skinWeight');
    const shade = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.positions.push(p.getX(i), p.getY(i), p.getZ(i));
      this.normals.push(n.getX(i), n.getY(i), n.getZ(i));
      this.colors.push(shade.r, shade.g, shade.b);
      this.skinIndices.push(indices ? indices.getX(i) : bone, indices ? indices.getY(i) : 0, 0, 0);
      this.skinWeights.push(weights ? weights.getX(i) : 1, weights ? weights.getY(i) : 0, 0, 0);
    }
    flat.dispose();
    if (flat !== geometry) geometry.dispose();
  }

  finish(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeights, 4));
    // Smooth-shaded primitives (head, hair, eyes) repeat vertices once per triangle; indexing shares them and cuts skinning work.
    const indexed = mergeVertices(geometry, 1e-4);
    geometry.dispose();
    indexed.computeBoundingSphere();
    return indexed;
  }
}

/** Seeded low-poly human, in metres, looking along local +Z. */
/** One program for every player: all kit and skin colours live in vertex colours. */
const SHARED_MATERIALS: { standard?: THREE.MeshStandardMaterial; compact?: THREE.MeshLambertMaterial } = {};
function footballerMaterial(compact: boolean): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  if (compact) return SHARED_MATERIALS.compact ??= new THREE.MeshLambertMaterial({ vertexColors: true });
  return SHARED_MATERIALS.standard ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: false });
}

/** Name and number printed on the back of the shirt, rendered once into a small texture. */
function createBackPrint(kit: KitDesign, kitNumber: number, name: string): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = kit.number;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const label = name.toLocaleUpperCase().slice(0, 12);
  ctx.font = `700 ${label.length > 8 ? 17 : 21}px system-ui, sans-serif`;
  ctx.fillText(label, 64, 30);
  ctx.font = '800 104px system-ui, sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = kit.trim;
  const digits = String(Math.max(0, kitNumber) % 100);
  ctx.strokeText(digits, 64, 138);
  ctx.fillText(digits, 64, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.35, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.375), material);
  print.name = 'back-print';
  return print;
}

export function createProceduralFootballer(identity: PlayerVisualIdentity, kit: KitDesign, kitNumber = 10, goalkeeper = false, leftFooted = false, compact = false, backName = ''): ProceduralFootballer {
  const recipe = createAppearanceRecipe(identity);
  const scale = recipe.height / 1.82;
  const hip = 0.94 * scale;
  const thigh = 0.425 * scale;
  const shin = 0.405 * scale;
  const shoulder = recipe.shoulderWidth;
  const bones: THREE.Bone[] = [];
  const indices = {} as Record<Joint, number>;
  const joints = {} as Record<Joint, THREE.Bone>;
  const bind = {} as Record<Joint, THREE.Vector3>;
  const data = new SkinGeometry();
  const bone = (name: Joint, parent: Joint | null, x: number, y: number, z: number) => {
    const joint = new THREE.Bone();
    joint.name = name;
    joint.position.set(x, y, z);
    if (parent) joints[parent].add(joint);
    indices[name] = bones.length;
    bones.push(joint);
    joints[name] = joint;
    bind[name] = new THREE.Vector3(x, y, z).add(parent ? bind[parent] : new THREE.Vector3());
  };
  bone('hips', null, 0, hip, 0);
  bone('spine', 'hips', 0, 0.16 * scale, 0);
  bone('chest', 'spine', 0, 0.20 * scale, 0);
  bone('head', 'chest', 0, 0.295 * scale, 0);
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    bone(`${side}Thigh`, 'hips', sign * 0.108, 0, 0);
    bone(`${side}Shin`, `${side}Thigh`, 0, -thigh, 0);
    bone(`${side}Foot`, `${side}Shin`, 0, -shin, 0);
    bone(`${side}Arm`, 'chest', sign * shoulder * 0.59, 0.055, 0);
    bone(`${side}Forearm`, `${side}Arm`, sign * 0.055, -0.25 * scale, 0);
    bone(`${side}Hand`, `${side}Forearm`, sign * 0.03, -0.23 * scale, 0);
  }
  const sphere = (joint: Joint, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, detail = 8) => {
    data.add(new THREE.SphereGeometry(1, compact?6:detail, compact?4:6), color, indices[joint], bind[joint].clone().add(new THREE.Vector3(x, y, z)), new THREE.Vector3(sx, sy, sz));
  };
  const box = (joint: Joint, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, angle = 0) => {
    data.add(new THREE.BoxGeometry(sx, sy, sz), color, indices[joint], bind[joint].clone().add(new THREE.Vector3(x, y, z)), undefined, new THREE.Euler(0, 0, angle));
  };
  const cylinder = (joint: Joint, color: string, x: number, y: number, z: number, top: number, bottom: number, height: number, depth = 1) => {
    data.add(new THREE.CylinderGeometry(top, bottom, height, compact?6:8), color, indices[joint], bind[joint].clone().add(new THREE.Vector3(x, y, z)), new THREE.Vector3(1, 1, depth));
  };
  // Athletic shoulders, tapered jersey and shorts; visible joints are rounded.
  cylinder('spine', kit.shirt, 0, 0.095, 0, shoulder * 0.57, shoulder * 0.43, 0.385 * scale, 0.60);
  sphere('chest', kit.shirt, 0, 0.047, 0, shoulder * 0.57, 0.095, shoulder * 0.35);
  cylinder('hips', kit.shorts, 0, -0.02, 0, shoulder * 0.46, shoulder * 0.48, 0.165, 0.66);
  cylinder('head', recipe.skin, 0, -0.15, 0, 0.066, 0.077, 0.13);
  sphere('head', recipe.skin, 0, -0.006, 0, recipe.headWidth * 0.52, 0.151, recipe.headDepth * 0.50, 12);
  // Chin, nose, ears and eyes remain coherent in every hair/body variant.
  sphere('head', recipe.skin, 0, -0.102, 0.02, recipe.headWidth * 0.37, 0.063, 0.089);
  sphere('head', recipe.skin, 0, -0.032, recipe.headDepth * 0.50, 0.026, 0.041, 0.046);
  for (const sign of [-1, 1]) {
    sphere('head', recipe.skin, sign * recipe.headWidth * 0.51, -0.02, -0.005, 0.026, 0.045, 0.028);
    sphere('head', '#f8f6ed', sign * 0.046, 0.018, 0.106, 0.026, 0.016, 0.009);
    sphere('head', '#202b34', sign * 0.046, 0.018, 0.114, 0.012, 0.013, 0.006);
    box('head', recipe.hair, sign * 0.046, 0.044, 0.108, 0.050, 0.011, 0.013, sign * -0.07);
  }
  box('head', '#7f4639', 0, -0.083, 0.104, 0.048, 0.009, 0.009);
  const hairStyle = identity.hairStyle % 18;
  if (hairStyle !== 0) {
    const cap = new THREE.SphereGeometry(1, 10, 5, 0, TAU, 0, hairStyle === 1 ? 1.36 : 1.55);
    data.add(cap, recipe.hair, indices.head, bind.head.clone().add(new THREE.Vector3(0, 0.025, -0.007)), new THREE.Vector3(recipe.headWidth * 0.55, hairStyle === 1 ? 0.136 : 0.154, recipe.headDepth * 0.54));
    if ([3, 7, 11, 15].includes(hairStyle)) {
      // Rounded curls / afro are generated from a stable, separate seed.
      for (let i = 0; i < 10; i++) {
        const angle = i / 10 * TAU;
        sphere('head', recipe.hair, Math.cos(angle) * 0.09, 0.117 + i % 2 * 0.027, Math.sin(angle) * 0.09 - 0.012, 0.064, 0.068, 0.062);
      }
    } else if ([4, 8, 12, 16].includes(hairStyle)) {
      sphere('head', recipe.hair, 0, 0.129, 0.055, 0.112, 0.072, 0.081);
      box('head', recipe.hair, 0.013, 0.153, 0.042, 0.11, 0.065, 0.116, 0.22);
    } else if ([5, 9, 13, 17].includes(hairStyle)) {
      sphere('head', recipe.hair, 0, 0.024, -0.13, 0.091, 0.113, 0.06);
      sphere('head', recipe.hair, 0, 0.082, -0.169, 0.059, 0.062, 0.061);
    } else if ([2, 6, 10, 14].includes(hairStyle)) {
      box('head', recipe.hair, 0, 0.16, 0, 0.063, 0.065, 0.22);
    }
  }
  if (identity.facialHair > 0) {
    if (identity.facialHair > 1) sphere('head', recipe.hair, 0, -0.109, 0.033, recipe.headWidth * 0.39, 0.050 + identity.facialHair * 0.003, 0.085);
    box('head', recipe.hair, 0, -0.063, 0.118, 0.069, 0.018, 0.012);
  }
  if (identity.headAccessory !== 'none') {
    const protective = identity.headAccessory === 'protective-cap';
    cylinder('head', protective ? '#233344' : kit.trim, 0, protective ? 0.052 : 0.072, 0, recipe.headWidth * 0.56, recipe.headWidth * 0.56, protective ? 0.14 : 0.032, 1.03);
  }

  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? 1 : -1;
    const leg = `${side}Thigh` as Joint;
    const calf = `${side}Shin` as Joint;
    const foot = `${side}Foot` as Joint;
    const arm = `${side}Arm` as Joint;
    const forearm = `${side}Forearm` as Joint;
    const hand = `${side}Hand` as Joint;
    const width = identity.bodyBuild === 'strong' ? 1.10 : identity.bodyBuild === 'slim' ? 0.91 : 1;
    cylinder(leg, kit.shorts, 0, -0.086, 0, 0.118 * width, 0.108 * width, 0.20, 0.94);
    cylinder(leg, recipe.skin, 0, -thigh * 0.66, 0, 0.087 * width, 0.069 * width, thigh * 0.70);
    sphere(calf, recipe.skin, 0, 0, 0, 0.073, 0.073, 0.073);
    cylinder(calf, kit.socks, 0, -shin * 0.5, 0, 0.073 * width, 0.045, shin * 0.91);
    cylinder(calf, kit.trim, 0, -0.065, 0, 0.075 * width, 0.075 * width, 0.028);
    sphere(foot, identity.bootColor, 0, -0.031, 0.061, 0.072, 0.060, 0.157);
    box(foot, '#19202b', 0, -0.069, 0.07, 0.125, 0.022, 0.252);
    box(foot, '#f7f8ee', 0, 0.017, 0.09, 0.047, 0.009, 0.090);
    if (identity.bootStyle % 3 === 0) box(foot, kit.trim, sign * 0.063, -0.02, 0.069, 0.007, 0.024, 0.14);
    sphere(arm, kit.shirt, 0, -0.020, 0, 0.099 * width, 0.10, 0.091);
    cylinder(arm, kit.sleeve === 'raglan' ? kit.secondary : kit.shirt, sign * 0.02, -0.088, 0, 0.095 * width, 0.08 * width, 0.16);
    data.add(createLimbSurface(bind[arm].clone().lerp(bind[forearm], .42), bind[forearm], bind[hand], indices[arm], indices[forearm], width, compact),
      identity.longSleeves || goalkeeper ? kit.shirt : recipe.skin, indices[arm], new THREE.Vector3());
    if (kit.sleeve === 'cuff') cylinder(arm, kit.trim, sign * 0.025, -0.149, 0, 0.083, 0.083, 0.028);
    if (identity.wristTape === side || identity.wristTape === 'both') cylinder(hand, '#e9f0ed', 0, 0.035, 0, 0.052, 0.052, 0.043);
    sphere(hand, goalkeeper ? ['#f5f1d7', '#e1ff70', '#4ccbd4'][identity.goalkeeperGloves % 3] : recipe.skin, 0, -0.029, 0.009, goalkeeper ? 0.068 : 0.048, 0.074, goalkeeper ? 0.053 : 0.037);
  }
  // Raised colour panels keep all eight kit patterns visible without textures.
  const front = shoulder * 0.347;
  for (const zSign of [-1, 1]) {
    const z = front * zSign;
    const patch = (x: number, y: number, width: number, height: number, angle = 0) => box('spine', kit.secondary, x, y, z, width, height, 0.008, angle);
    if (kit.pattern === 'halves') patch(-shoulder * 0.20, 0.086, shoulder * 0.40, 0.29);
    if (kit.pattern === 'stripes' || kit.pattern === 'pinstripes') {
      for (const x of [-0.12, 0, 0.12]) patch(x, 0.082, kit.pattern === 'stripes' ? 0.052 : 0.014, 0.29);
    }
    if (kit.pattern === 'hoops') for (const y of [-0.035, 0.070, 0.175]) patch(0, y, shoulder * 0.87, 0.037);
    if (kit.pattern === 'chest-band') patch(0, 0.15, shoulder * 0.91, 0.085);
    if (kit.pattern === 'sash') patch(0, 0.081, 0.060, 0.375, -0.75);
    if (kit.pattern === 'chevron') {
      patch(-0.070, 0.15, 0.19, 0.036, -0.35);
      patch(0.070, 0.15, 0.19, 0.036, 0.35);
    }
  }
  cylinder('chest', kit.trim, 0, 0.139, 0, 0.083, 0.083, 0.025);
  if (kit.collar === 'v') {
    box('chest', kit.trim, -0.031, 0.11, 0.086, 0.075, 0.016, 0.020, -0.75);
    box('chest', kit.trim, 0.031, 0.11, 0.086, 0.075, 0.016, 0.020, 0.75);
  } else if (kit.collar === 'polo') {
    box('chest', kit.trim, -0.057, 0.12, 0.065, 0.063, 0.033, 0.076, 0.2);
    box('chest', kit.trim, 0.057, 0.12, 0.065, 0.063, 0.033, 0.076, -0.2);
  }
  box('spine', kit.trim, 0.105, 0.195, front + 0.013, 0.045, 0.051, 0.013);
  box('spine', kit.number, -0.104, 0.195, front + 0.013, 0.040, 0.015, 0.013);
  // Seven-segment numbers are actual skinned geometry, legible without font loads;
  // the full renderer prints name and number on the back instead.
  const backPrint = compact || !backName ? null : createBackPrint(kit, kitNumber, backName);
  const digits = backPrint ? '' : String(Math.max(0, kitNumber) % 100);
  const segments = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  for (let i = 0; i < digits.length; i++) {
    const x = (i - (digits.length - 1) / 2) * -0.10;
    const locations: Record<string, number[]> = { a: [0, 0.07, 0.057, 0.016], b: [0.035, 0.035, 0.015, 0.058], c: [0.035, -0.035, 0.015, 0.058], d: [0, -0.07, 0.057, 0.016], e: [-0.035, -0.035, 0.015, 0.058], f: [-0.035, 0.035, 0.015, 0.058], g: [0, 0, 0.057, 0.016] };
    for (const part of segments[Number(digits[i])]) {
      const [dx, dy, w, h] = locations[part];
      box('spine', kit.number, x + dx, 0.085 + dy, -front - 0.015, w, h, 0.012);
    }
  }
  const geometry = data.finish();
  const blend = (parent: Joint, child: Joint, length: number, radius: number) =>
    blendJointSkin(geometry, indices[parent], indices[child], bind[parent], bind[child], length * scale, radius);
  blend('hips', 'spine', .10, shoulder);
  blend('spine', 'chest', .08, shoulder);
  for (const side of ['left', 'right'] as const) {
    blend('chest', `${side}Arm`, .09, .12);
    blend(`${side}Thigh`, `${side}Shin`, .105, .11);
    // Groin and ankle: the legs no longer fold open or crack at the boot.
    blend('hips', `${side}Thigh`, .09, .13);
    blend(`${side}Shin`, `${side}Foot`, .05, .08);
  }
  blend('chest', 'head', .06, .1);
  const material = footballerMaterial(compact);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `footballer-${recipe.seed}`;
  mesh.add(joints.hips);
  mesh.bind(new THREE.Skeleton(bones));
  if (backPrint) {
    // A rigid print follows the spine bone; it sits just off the jersey surface.
    backPrint.position.set(0, 0.10 * scale, -front - 0.02);
    backPrint.rotation.y = Math.PI;
    joints.spine.add(backPrint);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Animated bounds can extend beyond the bind pose during diving and jumping.
  mesh.frustumCulled = false;
  return { mesh, joints, recipe, hipHeight: hip, thighLength: thigh, shinLength: shin, footedness: leftFooted ? -1 : 1, goalkeeper,
    destroy() {
      geometry.dispose(); mesh.skeleton.dispose(); mesh.removeFromParent();
      if (backPrint) { backPrint.geometry.dispose(); backPrint.material.map?.dispose(); backPrint.material.dispose(); }
    },
  };
}

/** Solve a two-link leg towards a local-space foot target. Kept pure for contact tests. */
export function solveLeg(upper: number, lower: number, forward: number, drop: number): { hip: number; knee: number; ankle: number } {
  const distance = Math.max(0.01, Math.min(upper + lower - 0.001, Math.hypot(forward, drop)));
  const angle = Math.acos(THREE.MathUtils.clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1));
  const knee = Math.PI - Math.acos(THREE.MathUtils.clamp((upper * upper + lower * lower - distance * distance) / (2 * upper * lower), -1, 1));
  const hip = -Math.atan2(forward, drop) - angle;
  return { hip, knee, ankle: -(hip + knee) };
}

/** A lateral hip rotation and two-link sagittal solution place the ankle in 3D. */
export function placeFoot(model: ProceduralFootballer, side: 'left' | 'right', x: number, y: number, z: number): void {
  const j = model.joints;
  const hip = j[`${side}Thigh`];
  const lateral = x - hip.position.x;
  const drop = j.hips.position.y - y;
  const tilt = Math.atan2(lateral, drop);
  const leg = solveLeg(model.thighLength, model.shinLength, z, Math.hypot(drop, lateral));
  hip.rotation.order = 'ZXY';
  hip.rotation.set(leg.hip, 0, tilt);
  j[`${side}Shin`].rotation.x = leg.knee;
  j[`${side}Foot`].rotation.order = 'XZY';
  j[`${side}Foot`].rotation.set(leg.ankle, 0, -tilt);
}

/** Actions whose pose covers the whole body; the baked locomotion must not be laid under them. */
const NO_CLIP_ACTIONS: ReadonlySet<string> = new Set(['slide', 'injured', 'celebrate', 'bicycle-kick', 'flying-header']);
const CLIP_UPPER_BODY = ['spine', 'chest', 'head', 'leftArm', 'leftForearm', 'rightArm', 'rightForearm'] as const;
const CLIP_FRAME: { data: Float32Array | null } = { data: null };
const CLIP_QUATERNION = new THREE.Quaternion(), CLIP_LEAN = new THREE.Quaternion(), AXIS_Z = new THREE.Vector3(0, 0, 1);

function clipFrame(set: ClipSet): Float32Array {
  return CLIP_FRAME.data && CLIP_FRAME.data.length === set.frameSize ? CLIP_FRAME.data : (CLIP_FRAME.data = new Float32Array(set.frameSize));
}

/** Hips offset of a clip frame scaled from the baked character to this one's proportions. */
function clipHipsScale(model: ProceduralFootballer, set: ClipSet): number {
  return model.hipHeight / (set.hipHeight + 0.1);
}

/**
 * Baked locomotion for arms, torso and head, and the bob of the hips, in place of the procedural swing. The legs stay as the
 * foot-locked procedural gait. The weight follows how the player moves: forward and standing use the clip, sidesteps and
 * backpedalling (which the clips do not have) fade back to the procedural pose.
 */
function applyClipLocomotion(model: ProceduralFootballer, memory: PoseMemory, set: ClipSet, speed: number, forwardVelocity: number, cycle: number, time: number, elapsed: number, leanZ: number): void {
  const j = model.joints;
  const frame = clipFrame(set);
  const idleSeconds = set.clips['idle']?.duration ?? 2.5;
  // Every player idles on his own clock.
  sampleLocomotion(set, speed, cycle - Math.floor(cycle), (time + (model.recipe.seed % 97) * 0.37) / idleSeconds, frame);
  const target = speed < 0.3 || forwardVelocity > 0.45 ? 1 : 0;
  if (memory.clipWeight < 0) memory.clipWeight = target;
  else memory.clipWeight += (target - memory.clipWeight) * Math.min(1, Math.max(0, elapsed) * 6);
  const weight = memory.clipWeight;
  if (weight < 0.001) return;
  for (const bone of CLIP_UPPER_BODY) {
    const slot = boneSlot(set, bone) * 4;
    j[bone].quaternion.slerp(CLIP_QUATERNION.set(frame[slot], frame[slot + 1], frame[slot + 2], frame[slot + 3]), weight);
  }
  // Leaning into a sidestep or a turn is not in the clips; it stays on top.
  if (Math.abs(leanZ) > 1e-4) j.spine.quaternion.multiply(CLIP_LEAN.setFromAxisAngle(AXIS_Z, leanZ * weight));
  const hips = set.bones.length * 4, scale = clipHipsScale(model, set) * weight;
  j.hips.position.x += frame[hips] * scale;
  j.hips.position.y += frame[hips + 1] * scale;
}

/** A complete clip frame on all 16 bones, for celebrations that are danced rather than posed. */
function poseFromClip(model: ProceduralFootballer, set: ClipSet, name: string, age: number): void {
  const clip = set.clips[name];
  if (!clip) return;
  const frame = clipFrame(set);
  sampleSingle(set, name, age / clip.duration, frame);
  for (let bone = 0; bone < set.bones.length; bone++) {
    const joint = model.joints[set.bones[bone] as Joint];
    if (joint) joint.quaternion.set(frame[bone * 4], frame[bone * 4 + 1], frame[bone * 4 + 2], frame[bone * 4 + 3]);
  }
  const hips = set.bones.length * 4;
  model.joints.hips.position.y = model.hipHeight + frame[hips + 1] * clipHipsScale(model, set);
  model.joints.hips.position.x = frame[hips] * clipHipsScale(model, set);
}

/** Continuous, distance-driven locomotion and simulation-timed action poses. */
const KICK_ACTIONS: ReadonlySet<string> = new Set(['pass', 'through-pass', 'lob', 'shot', 'low-shot', 'finesse-shot', 'chip-shot', 'keeper-kick', 'knock-on', 'volley', 'side-volley']);
const BLEND_SECONDS = 0.14;
const BLEND_TARGET = new THREE.Quaternion();
// Scratch for keeper and contact IK, which run every frame for several players.
const KEEPER_TARGET = new THREE.Vector3();
const CATCH_POINT = new THREE.Vector3(0, 1.10, .35);
const SMOTHER_POINT = new THREE.Vector3(0, 0.30, .42);
const IK_ORIGIN = new THREE.Vector3(), IK_DESTINATION = new THREE.Vector3(), IK_DELTA = new THREE.Vector3();
const IK_POLE = new THREE.Vector3(), IK_ELBOW = new THREE.Vector3(), IK_LOCAL = new THREE.Vector3(), IK_CHILD = new THREE.Vector3();
const IK_OLD_ARM = new THREE.Quaternion(), IK_OLD_ELBOW = new THREE.Quaternion();
const CONTACT_OLD = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];

/** Presentation-only memory per figure: last pose for cross-fades and facing for turn lean. */
interface PoseMemory {
  action: string;
  previous: THREE.Quaternion[];
  previousHips: THREE.Vector3;
  from: THREE.Quaternion[];
  fromHips: THREE.Vector3;
  blendStart: number;
  facing: number;
  time: number;
  yawRate: number;
  initialised: boolean;
  gait: GaitMemory;
  /** How much of the upper body follows the baked clip (0 for sidesteps and backpedalling); eased, never switched. */
  clipWeight: number;
}
const POSE_MEMORY = new WeakMap<ProceduralFootballer, PoseMemory>();
function poseMemory(model: ProceduralFootballer): PoseMemory {
  let memory = POSE_MEMORY.get(model);
  if (!memory) {
    const count = jointList(model).length;
    memory = { action: '', previous: Array.from({ length: count }, () => new THREE.Quaternion()), previousHips: new THREE.Vector3(),
      from: Array.from({ length: count }, () => new THREE.Quaternion()), fromHips: new THREE.Vector3(), blendStart: -1, facing: 0, time: 0, yawRate: 0, initialised: false, gait: newGait(), clipWeight: -1 };
    POSE_MEMORY.set(model, memory);
  }
  return memory;
}
const CELEBRATIONS = 6;
export function celebrationVariant(model: ProceduralFootballer): number { return model.cheer ?? model.recipe.seed % CELEBRATIONS; }
const JOINT_LISTS = new WeakMap<ProceduralFootballer, THREE.Bone[]>();
function jointList(model: ProceduralFootballer): THREE.Bone[] {
  let list = JOINT_LISTS.get(model);
  if (!list) JOINT_LISTS.set(model, list = Object.values(model.joints));
  return list;
}

/**
 * Which foot kicks: the one that touches the ball when the simulation says so, otherwise the foot on the side the ball is on
 * when it clearly lies to one side, otherwise the strong foot.
 */
export function kickingFoot(model: ProceduralFootballer, state: PlayerRuntimeSnapshot, lookAt?: { x: number; y: number }): 'left' | 'right' {
  const contact = state.contact;
  if (contact && contact.kind === 'foot' && contact.tick >= state.actionStartedTick) return contact.foot;
  if (lookAt) {
    const lateral = (lookAt.x - state.x) * state.facingY - (lookAt.y - state.y) * state.facingX;
    if (Math.abs(lateral) > 0.35 && Math.hypot(lookAt.x - state.x, lookAt.y - state.y) < 1.6) return lateral > 0 ? 'left' : 'right';
  }
  return model.footedness > 0 ? 'right' : 'left';
}

/** Which leg of this figure is hurt when he limps (stable per figure). */
export function hurtLeg(model: ProceduralFootballer): 'left' | 'right' { return model.recipe.seed % 2 ? 'left' : 'right'; }

/**
 * `limp` is a render-only 0 to 1 flag (the renderer reads it from the match, the simulation and its hashes never see it):
 * the hurt leg drags, the body drops and leans onto the other leg.
 */
export function poseFootballer(model: ProceduralFootballer, state: PlayerRuntimeSnapshot, tick: number, time: number, reducedMotion = false, chargePower = 0, lookAt?: { x: number; y: number }, limp = 0): void {
  const j = model.joints;
  const memory = poseMemory(model);
  const speed = Math.hypot(state.vx, state.vy);
  const run = THREE.MathUtils.clamp(speed / 7.8, 0, 1);
  // Taller players take longer strides, and every player a longer one the faster he runs.
  const stride = strideFor(speed, model.recipe.height);
  // Facing change per second drives a lean into turns.
  const facing = Math.atan2(state.facingX, state.facingY);
  const elapsed = time - memory.time;
  let turnAngle = 0;
  if (memory.initialised && elapsed > 0 && elapsed < 0.25) {
    turnAngle = Math.atan2(Math.sin(facing - memory.facing), Math.cos(facing - memory.facing));
    memory.yawRate += (turnAngle / elapsed - memory.yawRate) * Math.min(1, elapsed * 10);
  } else if (!memory.initialised || elapsed < 0) memory.yawRate = 0;
  // Start a cross-fade from the last shown pose whenever the action changes.
  if (memory.initialised && memory.action !== state.action && time >= memory.time) {
    memory.from.forEach((q, i) => q.copy(memory.previous[i]));
    memory.fromHips.copy(memory.previousHips);
    memory.blendStart = time;
  }
  memory.action = state.action;
  // A slow player who turns steps on the spot instead of rotating with his feet nailed to the turf.
  const cycle = advanceGait(memory.gait, state.animationDistance ?? 0, speed, model.recipe.height, speed < 1 ? Math.abs(turnAngle) * 0.28 : 0);
  const phase = cycle * TAU;
  const ticks = Math.max(0, tick - state.actionStartedTick);
  const age = ticks / 60;
  const actionDuration = (ACTION_DURATION_TICKS[state.action] ?? 12) / 60;
  const contactTicks = ACTION_CONTACT_TICKS[state.action] ?? 0;
  const limping = limp > 0 && (state.action === 'idle' || state.action === 'formation' || state.action === 'jog' || state.action === 'sprint' || state.action === 'carry' || state.action === 'press' || state.action === 'support-press' || state.action === 'jockey');
  const hurt = hurtLeg(model);
  const breath = reducedMotion ? 0 : Math.sin(time * 2.2 + model.recipe.seed % 11) * 0.005;
  for (const joint of jointList(model)) joint.rotation.set(0, 0, 0);
  const moving = Math.max(Math.min(1, speed / 0.8), turnStepAmount(memory.yawRate, speed));
  const maximumReach = model.thighLength + model.shinLength - 0.014;
  const stanceHalf = stride * 0.25 / 2;
  const hipDrop = model.hipHeight - (0.11 + Math.sqrt(maximumReach * maximumReach - stanceHalf * stanceHalf));
  const crouch = state.action === 'jockey' ? 0.09 : 0;
  j.hips.position.set(0,model.hipHeight - hipDrop * moving - crouch + breath,0);
  j.spine.rotation.x = 0.13 * run;
  j.spine.rotation.y = Math.sin(phase) * 0.08 * run;
  j.chest.rotation.y = -Math.sin(phase) * 0.12 * run;
  j.head.rotation.x = -0.08 * run;
  const forwardVelocity = speed > 0.01 ? (state.vx * state.facingX + state.vy * state.facingY) / speed : 1;
  const sideVelocity = speed > 0.01 ? (state.vx * state.facingY - state.vy * state.facingX) / speed : 0;
  j.spine.rotation.z=-sideVelocity*run*.18;
  const lean = reducedMotion ? 0 : THREE.MathUtils.clamp(-memory.yawRate * run * 0.06, -0.22, 0.22);
  j.spine.rotation.z += lean;
  j.hips.rotation.z = lean * 0.5;
  const clips = model.goalkeeper ? null : clipSet();
  if (!clips && speed < 0.3 && !reducedMotion && (state.action === 'idle' || state.action === 'formation')) {
    // Idle life: weight shifts and a look around, different for every player.
    const seed = model.recipe.seed % 97;
    j.hips.position.x = Math.sin(time * 0.8 + seed) * 0.025;
    j.head.rotation.y = Math.sin(time * 0.55 + seed * 0.7) * 0.32;
  }
  for (const side of ['left', 'right'] as const) {
    const t = ((cycle + (side === 'left' ? 0 : 0.5)) % 1 + 1) % 1;
    const sign = side === 'left' ? 1 : -1;
    // During stance, d(forward)/d(distance) = -1: the foot stays on the turf.
    const swing = Math.max(0, (t - 0.25) / 0.75);
    const travel = t < 0.25 ? stanceHalf - t * stride : -stanceHalf * Math.cos(swing * Math.PI);
    // A hurt leg barely leaves the ground: the stance is kept (no sliding), the swing is cut short.
    const lift = (t < 0.25 ? 0 : Math.sin(swing * Math.PI) * (0.07 + run * 0.19)) * (limping && side === hurt ? 1 - 0.8 * limp : 1);
    placeFoot(model, side, sign * 0.108 + travel * sideVelocity * moving,
      0.11 + lift * moving, travel * forwardVelocity * moving);
    j[`${side}Arm`].rotation.x = Math.sin(phase + (side === 'left' ? 0 : Math.PI)) * 0.58 * run;
    j[`${side}Arm`].rotation.z = sign * (0.10 + run * 0.04);
    j[`${side}Forearm`].rotation.x = -0.22 - run * 0.78;
  }
  if (clips && !NO_CLIP_ACTIONS.has(state.action)) applyClipLocomotion(model, memory, clips, speed, forwardVelocity, cycle, time, elapsed, j.spine.rotation.z);
  if (limping) {
    // The body drops onto the hurt leg while it carries the weight and leans away from it; the head hangs a little.
    const load = limpLoad(cycle, hurt === 'left' ? 0 : 0.5) * Math.max(moving, 0.35);
    const hurtSign = hurt === 'left' ? 1 : -1;
    j.hips.position.y -= 0.05 * limp * load;
    j.hips.rotation.z += hurtSign * 0.07 * limp * load;
    j.spine.rotation.z += -hurtSign * 0.12 * limp * (0.4 + 0.6 * load);
    j.spine.rotation.x += 0.07 * limp;
    j.head.rotation.x += 0.12 * limp;
  }
  const kick = KICK_ACTIONS.has(state.action);
  const kickEnd = Math.min(.50, actionDuration);
  const kickLeg = kickingFoot(model, state, lookAt);
  if (kick && contactTicks > 0 && ticks < (ACTION_DURATION_TICKS[state.action] ?? 12)) {
    // Wind-up, strike at the simulated contact tick, follow-through.
    poseKick(model, state.action, kickLeg, ticks, contactTicks, ACTION_DURATION_TICKS[state.action] ?? 12);
  } else if (state.action === 'fake-shot') {
    poseFakeShot(model, kickLeg, ticks, ACTION_DURATION_TICKS['fake-shot'] ?? 22);
  } else if (state.action === 'bicycle-kick') {
    poseBicycleKick(model, kickLeg, ticks, contactTicks || 10, ACTION_DURATION_TICKS['bicycle-kick'] ?? 44);
  } else if (state.action === 'flying-header') {
    poseFlyingHeader(model, ticks, contactTicks || 12, ACTION_DURATION_TICKS['flying-header'] ?? 36, state.contact?.kind === 'head' ? state.contact.z : state.actionTarget?.z ?? 1.0);
  } else if (state.action === 'wall-jump') {
    poseWallJump(model, ticks, ACTION_DURATION_TICKS['wall-jump'] ?? 24);
  } else if (kick && age < kickEnd) {
    const action = state.action;
    const passLike = action === 'pass' || action === 'through-pass' || action === 'knock-on';
    const strike = action === 'shot' || action === 'low-shot' || action === 'keeper-kick';
    const strength = action === 'knock-on' ? 0.45 : passLike ? 0.75 : 1;
    const weight=1-THREE.MathUtils.smoothstep(age,Math.min(.17,kickEnd*.4),kickEnd);
    const extension=Math.sin(Math.min(1,age/.36)*Math.PI)*strength;
    const side=kickLeg, other=side==='right'?'left':'right';
    const thigh=j[`${side}Thigh`],shin=j[`${side}Shin`],foot=j[`${side}Foot`];
    // Follow-through height: strikes swing high, chips stab short, crosses wrap round.
    const follow = strike ? 1.05 : action === 'chip-shot' ? 0.35 : action === 'lob' ? 0.85 : 0.66;
    thigh.rotation.x=THREE.MathUtils.lerp(thigh.rotation.x,-.62-extension*follow,weight);
    shin.rotation.x=THREE.MathUtils.lerp(shin.rotation.x,(action === 'chip-shot' ? .55 : .24)*(1-extension),weight);
    foot.rotation.x=THREE.MathUtils.lerp(foot.rotation.x,.22,weight);
    // Inside-foot passes and finesse shots open the foot; driven strikes keep the laces down.
    const footSign = side === 'right' ? 1 : -1;
    if (passLike || action === 'finesse-shot') foot.rotation.y = -footSign * 0.55 * extension * weight;
    // Standing leg bends and plants; the opposite arm swings through for balance.
    j[`${other}Shin`].rotation.x += (strike ? .28 : .16) * weight;
    j.spine.rotation.x+=(action === 'chip-shot' ? -.12 : strike ? .24 : .18)*extension*weight;
    j.chest.rotation.y-=footSign*extension*(action === 'lob' ? .45 : .32)*weight;
    j.leftArm.rotation.z+=.55*weight;j.rightArm.rotation.z-=.55*weight;
    j[`${other}Arm`].rotation.x += (strike ? -.7 : -.35) * extension * weight;
  } else if(chargePower>.01) {
    const power=Math.min(1,chargePower),side=model.footedness>0?'right':'left';
    j[`${side}Thigh`].rotation.x+=power*.50;
    j[`${side}Shin`].rotation.x+=power*.65;
    j.chest.rotation.y+=model.footedness*power*.28;
    j.spine.rotation.x-=power*.09;
    j.leftArm.rotation.z+=power*.35;j.rightArm.rotation.z-=power*.35;
  }
  // The foot on the side the ball is on does the work; without a ball position it is the strong foot.
  let ballSide: 'left' | 'right' = model.footedness > 0 ? 'right' : 'left';
  if (lookAt) {
    const lateral = (lookAt.x - state.x) * state.facingY - (lookAt.y - state.y) * state.facingX;
    if (Math.abs(lateral) > 0.12 && Math.hypot(lookAt.x - state.x, lookAt.y - state.y) < 3) ballSide = lateral > 0 ? 'left' : 'right';
  }
  const ballOther = ballSide === 'right' ? 'left' : 'right';
  const ballSign = ballSide === 'right' ? 1 : -1;
  if (state.action === 'receive' || state.action === 'close-control' || state.action === 'ball-roll' || state.action === 'drag-back') {
    const envelope=Math.sin(Math.min(age/actionDuration,1)*Math.PI) ** 2;
    j[`${ballSide}Thigh`].rotation.x -= envelope * 0.38;
    j[`${ballSide}Foot`].rotation.y = -0.42 * envelope * ballSign;
    j.spine.rotation.x += 0.12 * envelope;
  }
  if (state.action === 'stumble' || state.action === 'heavy-touch') {
    // A stumble throws the arms out and buckles a knee; a heavy touch is the same, only slighter.
    const strong = state.action === 'stumble' ? 1 : 0.45;
    const envelope = Math.sin(Math.min(age / actionDuration, 1) * Math.PI) ** 1.5;
    const trailing = model.recipe.seed % 2 ? 'left' : 'right';
    j.hips.rotation.x += envelope * 0.30 * strong;
    j.hips.position.y -= envelope * 0.10 * strong;
    j.spine.rotation.x += envelope * 0.32 * strong;
    j.leftArm.rotation.z += envelope * 0.8 * strong; j.rightArm.rotation.z -= envelope * 0.8 * strong;
    j.leftArm.rotation.x -= envelope * 0.4 * strong; j.rightArm.rotation.x -= envelope * 0.4 * strong;
    j[`${trailing}Thigh`].rotation.x -= envelope * 0.55 * strong;
    j[`${trailing}Shin`].rotation.x += envelope * 0.7 * strong;
  }
  if (state.action === 'body-feint' || state.action === 'skill-failed') {
    const envelope = Math.sin(Math.min(age / actionDuration, 1) * Math.PI);
    const sway = (model.recipe.seed % 2 ? 1 : -1) * envelope;
    j.hips.rotation.y += sway * 0.45;
    j.spine.rotation.z += sway * 0.22;
    j.chest.rotation.y -= sway * 0.3;
    j[`${sway > 0 ? 'left' : 'right'}Thigh`].rotation.z += Math.abs(sway) * 0.35;
  }
  if (state.action === 'jockey') {
    j.spine.rotation.x += 0.26;
    j.leftArm.rotation.z += 0.32; j.rightArm.rotation.z -= 0.32;
    j.head.rotation.x -= 0.12;
  }
  if (state.action === 'standing-tackle' && age < actionDuration) {
    const extend = Math.sin(Math.min(age / actionDuration, 1) * Math.PI) ** 2;
    j[`${ballSide}Thigh`].rotation.x = THREE.MathUtils.lerp(j[`${ballSide}Thigh`].rotation.x,-0.85,extend);
    j[`${ballSide}Shin`].rotation.x = THREE.MathUtils.lerp(j[`${ballSide}Shin`].rotation.x,0.15,extend);
    j.spine.rotation.x += 0.2 * extend;
  }
  if (state.action === 'slide' || state.action === 'injured') {
    // Injured players go down, stay down and get up again before limping on.
    const envelope = state.action === 'injured' ? Math.min(1, age / .35, Math.max(0, actionDuration - age) / .6) : Math.sin(Math.min(age / actionDuration, 1) * Math.PI) ** 2;
    j.hips.position.y -= envelope * 0.62;
    j.hips.rotation.x = -envelope * 0.8;
    // The leg on the ball's side leads the slide, the other folds underneath.
    j[`${ballSide}Thigh`].rotation.x = THREE.MathUtils.lerp(j[`${ballSide}Thigh`].rotation.x,-1.0,envelope);
    j[`${ballOther}Thigh`].rotation.x = THREE.MathUtils.lerp(j[`${ballOther}Thigh`].rotation.x,-0.6,envelope);
    j[`${ballOther}Shin`].rotation.x = THREE.MathUtils.lerp(j[`${ballOther}Shin`].rotation.x,1.4,envelope);
  }
  if (state.action === 'header') {
    const jump = Math.sin(Math.min(age / actionDuration, 1) * Math.PI) ** 2;
    // Leap as high as the header is struck (a ball at 2.8 m takes a real jump), arch back and thrust through the ball.
    const lift = state.contact?.kind === 'head' ? THREE.MathUtils.clamp(state.contact.z - (model.hipHeight + 0.78), 0.1, 1.15) : 0.45;
    const thrust = THREE.MathUtils.smoothstep(age, 0.05, 0.16);
    j.hips.position.y += jump * lift;
    j.spine.rotation.x += (thrust * 0.42 - 0.22 * (1 - thrust)) * jump;
    j.head.rotation.x += jump * 0.30;
    j.leftArm.rotation.z = THREE.MathUtils.lerp(j.leftArm.rotation.z,0.68,jump);
    j.rightArm.rotation.z = THREE.MathUtils.lerp(j.rightArm.rotation.z,-0.68,jump);
  }
  // An outfield player taking a throw-in: the ball goes back over the head with both hands, then forward.
  const throwIn = state.action === 'keeper-throw' && !model.goalkeeper;
  if (throwIn) {
    const t = Math.min(age / actionDuration, 1);
    const arms = Math.sin(t * Math.PI);
    const release = THREE.MathUtils.smoothstep(t, 0.35, 0.6);
    j.leftArm.rotation.x = j.rightArm.rotation.x = -2.8 * arms;
    j.leftArm.rotation.z = 0.12; j.rightArm.rotation.z = -0.12;
    j.leftForearm.rotation.x = j.rightForearm.rotation.x = -0.35 * arms - 0.45 * release * arms;
    j.spine.rotation.x += (-0.3 * (1 - release) + 0.26 * release) * arms;
    j.head.rotation.x -= 0.2 * arms;
  }
  // Look at the ball: head first, chest partially; a carrier looks down at the ball.
  if (lookAt && state.action !== 'celebrate' && !state.action.startsWith('keeper-')) {
    const dx = lookAt.x - state.x, dy = lookAt.y - state.y;
    const forward = dx * state.facingX + dy * state.facingY, lateral = dx * state.facingY - dy * state.facingX;
    const distance = Math.hypot(forward, lateral);
    if (distance > 0.6) {
      const yaw = THREE.MathUtils.clamp(Math.atan2(lateral, forward), -1.1, 1.1);
      j.head.rotation.y = yaw * 0.7;
      j.chest.rotation.y += yaw * 0.25;
      j.head.rotation.x += THREE.MathUtils.clamp(0.5 / distance, 0, 0.25);
    } else j.head.rotation.x += 0.25;
  }
  // Cross-fade into the new action; contact and keeper IK below stay exact.
  // Kicks with a wind-up cross-fade quickly; a long blend would smear the swing out before the foot reaches the ball.
  const blend = memory.blendStart >= 0 ? THREE.MathUtils.smoothstep(time - memory.blendStart, 0, blendSecondsFor(contactTicks, BLEND_SECONDS)) : 1;
  if (blend < 1) {
    const joints = jointList(model);
    // slerpQuaternions would alias its target with the second argument; blend through a temporary.
    for (let i = 0; i < joints.length; i++) {
      BLEND_TARGET.copy(joints[i].quaternion);
      joints[i].quaternion.copy(memory.from[i]).slerp(BLEND_TARGET, blend);
    }
    j.hips.position.lerpVectors(memory.fromHips, j.hips.position, blend);
  } else memory.blendStart = -1;
  // The blend layer is remembered before keeper and contact IK, which are re-solved every frame.
  {
    const joints = jointList(model);
    for (let i = 0; i < joints.length; i++) memory.previous[i].copy(joints[i].quaternion);
    memory.previousHips.copy(j.hips.position);
  }
  if (state.action.startsWith('keeper-') && !throwIn && state.action !== 'keeper-kick' && state.action !== 'keeper-rush') {
    j.hips.position.y-=.12;
    j.spine.rotation.x=.16;
    j.leftArm.rotation.z=.27;j.rightArm.rotation.z=-.27;
    j.leftArm.rotation.x=j.rightArm.rotation.x=-.55;
    j.leftForearm.rotation.x=j.rightForearm.rotation.x=-.95;
    if(speed<.5) {
      placeFoot(model,'left',.19,.11,.03);
      placeFoot(model,'right',-.19,.11,.03);
    }
    const source=state.actionTarget ?? (state.contact?.kind==='hand'?state.contact:undefined);
    const dx=(source?.x ?? state.x)-state.x,dy=(source?.y ?? state.y+.35)-state.y;
    const target=KEEPER_TARGET.set(dx*state.facingY-dy*state.facingX,source?.z ?? 1.1,dx*state.facingX+dy*state.facingY);
    if(state.action==='keeper-dive') {
      const extent=THREE.MathUtils.smoothstep(age,0,.20)*(1-THREE.MathUtils.smoothstep(age,.52,1.10));
      const sign=Math.sign(target.x)||1;
      j.hips.position.x=target.x*.35*extent;
      j.hips.position.y=THREE.MathUtils.lerp(j.hips.position.y,Math.max(.36,target.y*.55),extent);
      j.hips.rotation.z=-sign*1.22*extent;
      j.spine.rotation.x=THREE.MathUtils.lerp(j.spine.rotation.x,.10,extent);
      j.leftThigh.rotation.x=THREE.MathUtils.lerp(j.leftThigh.rotation.x,-.20,extent);
      j.rightThigh.rotation.x=THREE.MathUtils.lerp(j.rightThigh.rotation.x,-.35,extent);
      j.leftShin.rotation.x=THREE.MathUtils.lerp(j.leftShin.rotation.x,.45,extent);
      j.rightShin.rotation.x=THREE.MathUtils.lerp(j.rightShin.rotation.x,.60,extent);
      pointHand(model,'left',target,extent,.07);
      pointHand(model,'right',target,extent,-.07);
    } else if(state.action==='keeper-catch') {
      const gather=THREE.MathUtils.smoothstep(age,0,.22);
      target.lerp(CATCH_POINT,gather);
      pointHand(model,'left',target,1,.08,-.025);
      pointHand(model,'right',target,1,-.08,-.025);
    } else if(state.action==='keeper-parry') {
      const weight=1-THREE.MathUtils.smoothstep(age,.12,.65);
      pointHand(model,'left',target,weight,.08);
      pointHand(model,'right',target,weight,-.08);
    } else if(state.action==='keeper-throw') {
      const weight=1-THREE.MathUtils.smoothstep(age,.15,.45);
      j.rightArm.rotation.x=-1.3*weight;j.rightForearm.rotation.x=-.25*weight;
      j.chest.rotation.y=-.32*weight;
    } else if(state.action==='keeper-punch') {
      // Two fists: the simulation's hand contact says when the ball is hit, without one the punch lands after a spring.
      const hit=state.contact?.kind==='hand'?Math.max(0,state.contact.tick-state.actionStartedTick):7;
      const reach=poseKeeperPunch(model,ticks,ACTION_DURATION_TICKS['keeper-punch'] ?? 34,hit);
      pointHand(model,'left',target,reach,.08);
      pointHand(model,'right',target,reach,-.08);
    } else if(state.action==='keeper-smother') {
      const gather=poseKeeperSmother(model,ticks,ACTION_DURATION_TICKS['keeper-smother'] ?? 40);
      // Reach down to the ball first, then fold the arms round it in front of the chest.
      target.lerp(SMOTHER_POINT,gather);
      pointHand(model,'left',target,1,.10);
      pointHand(model,'right',target,1,-.10);
    }
  }
  const contact = state.contact;
  if (contact?.kind === 'foot' && tick >= contact.tick && tick - contact.tick < 9) {
    const dx = contact.x - state.x, dy = contact.y - state.y;
    const forward = dx * state.facingX + dy * state.facingY - 0.31;
    const lateral = dx * state.facingY - dy * state.facingX;
    const distance = Math.hypot(forward, lateral);
    // A ball in the air (volley) is met with a raised ankle; on the ground it is the old ankle height of 11 cm.
    const ankle = Math.min(maximumReach * 0.7, Math.max(0.11, contact.z - 0.08));
    const raised = ankle > 0.2;
    const reachable = raised ? Math.hypot(forward, lateral, Math.max(0, j.hips.position.y - ankle)) < maximumReach * 0.97 : distance < maximumReach * 0.85;
    if (state.action !== 'bicycle-kick' && reachable) {
      const weight = Math.max(0, 1 - (tick - contact.tick) / 9);
      const targetDrop = Math.sqrt(Math.max(0.2, maximumReach * maximumReach - distance * distance));
      if (!raised) j.hips.position.y = Math.min(j.hips.position.y, 0.11 + targetDrop);
      const thigh = j[`${contact.foot}Thigh`], shin = j[`${contact.foot}Shin`], foot = j[`${contact.foot}Foot`];
      CONTACT_OLD[0].copy(thigh.quaternion); CONTACT_OLD[1].copy(shin.quaternion); CONTACT_OLD[2].copy(foot.quaternion);
      placeFoot(model, contact.foot, lateral, ankle, forward);
      thigh.quaternion.copy(CONTACT_OLD[0].slerp(thigh.quaternion, weight));
      shin.quaternion.copy(CONTACT_OLD[1].slerp(shin.quaternion, weight));
      foot.quaternion.copy(CONTACT_OLD[2].slerp(foot.quaternion, weight));
    }
  }
  if (state.action === 'celebrate') poseCelebration(model, age, reducedMotion, clips);
  memory.facing = facing;
  memory.time = time;
  memory.initialised = true;
}

/** Five seeded celebrations: arms up, knee slide, aeroplane, fist pump, point to the sky. */
function poseCelebration(model: ProceduralFootballer, age: number, reducedMotion: boolean, clips: ClipSet | null): void {
  const j = model.joints;
  const motion = reducedMotion ? 0 : 1;
  switch (celebrationVariant(model)) {
    case 5:
      // The baked dance, whole body; without clips (or with reduced motion) this player simply raises his arms.
      if (clips && !reducedMotion) { poseFromClip(model, clips, 'dance', age); break; }
      j.leftArm.rotation.z = 2.50; j.rightArm.rotation.z = -2.50;
      j.leftForearm.rotation.x = j.rightForearm.rotation.x = -0.2;
      break;
    case 0:
      j.leftArm.rotation.z = 2.50; j.rightArm.rotation.z = -2.50;
      j.leftForearm.rotation.x = j.rightForearm.rotation.x = -0.2;
      j.hips.position.y += Math.abs(Math.sin(age * 6)) * 0.10 * motion;
      break;
    case 1: {
      const slide = THREE.MathUtils.smoothstep(age, 0.2, 0.6);
      j.hips.position.y -= 0.42 * slide;
      j.leftThigh.rotation.x = j.rightThigh.rotation.x = -0.1 * slide;
      j.leftShin.rotation.x = j.rightShin.rotation.x = 2.2 * slide;
      j.spine.rotation.x = -0.35 * slide;
      j.head.rotation.x = -0.4 * slide;
      j.leftArm.rotation.z = 1.4 * slide; j.rightArm.rotation.z = -1.4 * slide;
      break;
    }
    case 2:
      j.leftArm.rotation.z = 1.55; j.rightArm.rotation.z = -1.55;
      j.spine.rotation.z = Math.sin(age * 3) * 0.28 * motion;
      j.spine.rotation.x = 0.2;
      break;
    case 3: {
      const pump = Math.max(0, Math.sin(age * 7)) * motion;
      j.rightArm.rotation.z = -1.2 - pump * 0.9;
      j.rightForearm.rotation.x = -1.5 + pump * 0.8;
      j.leftArm.rotation.z = 0.5;
      j.spine.rotation.x = 0.18;
      j.head.rotation.x = -0.25;
      break;
    }
    default:
      j.leftArm.rotation.z = 2.9; j.rightArm.rotation.z = -2.9;
      j.head.rotation.x = -0.55;
      j.spine.rotation.x = -0.12;
  }
}

/** Two-link arm aiming preserves elbow length and solves in the current chest frame. */
function pointHand(model:ProceduralFootballer,side:'left'|'right',target:THREE.Vector3,weight:number,offsetX=0,offsetZ=0):void {
  const arm=model.joints[`${side}Arm`],elbow=model.joints[`${side}Forearm`],hand=model.joints[`${side}Hand`];
  IK_OLD_ARM.copy(arm.quaternion);IK_OLD_ELBOW.copy(elbow.quaternion);
  model.mesh.updateMatrixWorld(true);
  const origin=arm.getWorldPosition(IK_ORIGIN);
  const destination=model.mesh.localToWorld(IK_DESTINATION.copy(target).add(IK_LOCAL.set(offsetX,0,offsetZ)));
  const delta=IK_DELTA.copy(destination).sub(origin),upper=elbow.position.length(),lower=hand.position.length();
  const distance=THREE.MathUtils.clamp(delta.length(),.001,upper+lower-.001),direction=delta.normalize();
  const pole=IK_POLE.set(side==='left'?1:-1,-1,-.4).transformDirection(model.mesh.matrixWorld);
  const bend=pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const cosine=THREE.MathUtils.clamp((upper*upper+distance*distance-lower*lower)/(2*upper*distance),-1,1);
  const elbowTarget=IK_ELBOW.copy(origin).addScaledVector(direction,upper*cosine).addScaledVector(bend,upper*Math.sqrt(1-cosine*cosine));
  const aim=(bone:THREE.Bone,child:THREE.Bone,world:THREE.Vector3)=>{
    const local=bone.parent!.worldToLocal(IK_LOCAL.copy(world)).sub(bone.position).normalize();
    bone.quaternion.setFromUnitVectors(IK_CHILD.copy(child.position).normalize(),local);
    model.mesh.updateMatrixWorld(true);
  };
  aim(arm,elbow,elbowTarget);aim(elbow,hand,destination);
  arm.quaternion.copy(IK_OLD_ARM.slerp(arm.quaternion,weight));elbow.quaternion.copy(IK_OLD_ELBOW.slerp(elbow.quaternion,weight));
}

/**
 * Largest drift of a planted foot against the ground, in metres per `step` of travel (0 = perfectly planted).
 * The figure runs straight along +Z at `speed`; a foot counts as planted while it is in the stance part of its
 * cycle in both of two consecutive poses. The Player Studio and the tests use it to catch foot sliding.
 */
export function measureFootSlide(model: ProceduralFootballer, base: PlayerRuntimeSnapshot, speed: number, step = 0.05, samples = 120, limp = 0): number {
  const memory = poseMemory(model);
  memory.gait = newGait();
  const world = new THREE.Vector3();
  const feet = [model.joints.leftFoot, model.joints.rightFoot];
  let previous: { z: number; stance: boolean }[] | null = null;
  let worst = 0;
  for (let i = 0; i < samples; i++) {
    const distance = i * step;
    model.mesh.position.set(0, 0, distance);
    model.mesh.updateMatrixWorld(true);
    poseFootballer(model, { ...base, vx: 0, vy: speed, facingX: 0, facingY: 1, animationDistance: distance, action: 'jog' }, 60, 1 + distance / Math.max(speed, 0.1), true, 0, undefined, limp);
    model.mesh.updateMatrixWorld(true);
    const cycle = memory.gait.cycle;
    const current = feet.map((foot, index) => {
      const t = (((cycle + (index === 0 ? 0 : 0.5)) % 1) + 1) % 1;
      foot.getWorldPosition(world);
      return { z: world.z, stance: t < 0.22 };
    });
    if (previous) current.forEach((now, index) => { if (now.stance && previous![index].stance) worst = Math.max(worst, Math.abs(now.z - previous![index].z)); });
    previous = current;
  }
  model.mesh.position.set(0, 0, 0);
  return worst;
}
