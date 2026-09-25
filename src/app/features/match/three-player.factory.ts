import * as THREE from 'three';
import { PlayerVisualIdentity, KitDesign } from '../../models/visual.model';
import { PlayerRuntimeSnapshot } from '../../models/match.model';
import { hash32 } from '../../core/visual-identity';
import { blendJointSkin } from './joint-skinning';
import { createLimbSurface } from './limb-surface';
import { ACTION_DURATION_TICKS } from '../../core/football/action-timing';

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
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Seeded low-poly human, in metres, looking along local +Z. */
export function createProceduralFootballer(identity: PlayerVisualIdentity, kit: KitDesign, kitNumber = 10, goalkeeper = false, leftFooted = false, compact = false): ProceduralFootballer {
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
  // Seven-segment numbers are actual skinned geometry, legible without font loads.
  const digits = String(Math.max(0, kitNumber) % 100);
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
  }
  const material = compact?new THREE.MeshLambertMaterial({vertexColors:true}):new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.87, metalness: 0, flatShading: false });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = `footballer-${recipe.seed}`;
  mesh.add(joints.hips);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Animated bounds can extend beyond the bind pose during diving and jumping.
  mesh.frustumCulled = false;
  return { mesh, joints, recipe, hipHeight: hip, thighLength: thigh, shinLength: shin, footedness: leftFooted ? -1 : 1,
    destroy() { geometry.dispose(); material.dispose(); mesh.skeleton.dispose(); mesh.removeFromParent(); },
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

/** Continuous, distance-driven locomotion and simulation-timed action poses. */
const KICK_ACTIONS: ReadonlySet<string> = new Set(['pass', 'through-pass', 'lob', 'shot', 'low-shot', 'finesse-shot', 'chip-shot', 'keeper-kick']);
const JOINT_LISTS = new WeakMap<ProceduralFootballer, THREE.Bone[]>();
function jointList(model: ProceduralFootballer): THREE.Bone[] {
  let list = JOINT_LISTS.get(model);
  if (!list) JOINT_LISTS.set(model, list = Object.values(model.joints));
  return list;
}

export function poseFootballer(model: ProceduralFootballer, state: PlayerRuntimeSnapshot, tick: number, time: number, reducedMotion = false, chargePower = 0): void {
  const j = model.joints;
  const speed = Math.hypot(state.vx, state.vy);
  const run = THREE.MathUtils.clamp(speed / 7.8, 0, 1);
  const stride=3;
  const cycle = (state.animationDistance ?? 0) / stride;
  const phase = cycle * TAU;
  const age = Math.max(0, (tick - state.actionStartedTick) / 60);
  const actionDuration = (ACTION_DURATION_TICKS[state.action] ?? 12) / 60;
  const breath = reducedMotion ? 0 : Math.sin(time * 2.2 + model.recipe.seed % 11) * 0.005;
  for (const joint of jointList(model)) joint.rotation.set(0, 0, 0);
  const moving = Math.min(1, speed / 0.8);
  const maximumReach = model.thighLength + model.shinLength - 0.014;
  const stanceHalf = stride * 0.25 / 2;
  const hipDrop = model.hipHeight - (0.11 + Math.sqrt(maximumReach * maximumReach - stanceHalf * stanceHalf));
  j.hips.position.set(0,model.hipHeight - hipDrop * moving + breath,0);
  j.spine.rotation.x = 0.13 * run;
  j.spine.rotation.y = Math.sin(phase) * 0.08 * run;
  j.chest.rotation.y = -Math.sin(phase) * 0.12 * run;
  j.head.rotation.x = -0.08 * run;
  const forwardVelocity = speed > 0.01 ? (state.vx * state.facingX + state.vy * state.facingY) / speed : 1;
  const sideVelocity = speed > 0.01 ? (state.vx * state.facingY - state.vy * state.facingX) / speed : 0;
  j.spine.rotation.z=-sideVelocity*run*.18;
  for (const side of ['left', 'right'] as const) {
    const t = ((cycle + (side === 'left' ? 0 : 0.5)) % 1 + 1) % 1;
    const sign = side === 'left' ? 1 : -1;
    // During stance, d(forward)/d(distance) = -1: the foot stays on the turf.
    const swing = Math.max(0, (t - 0.25) / 0.75);
    const travel = t < 0.25 ? stanceHalf - t * stride : -stanceHalf * Math.cos(swing * Math.PI);
    const lift = t < 0.25 ? 0 : Math.sin(swing * Math.PI) * (0.07 + run * 0.19);
    placeFoot(model, side, sign * 0.108 + travel * sideVelocity * moving,
      0.11 + lift * moving, travel * forwardVelocity * moving);
    j[`${side}Arm`].rotation.x = Math.sin(phase + (side === 'left' ? 0 : Math.PI)) * 0.58 * run;
    j[`${side}Arm`].rotation.z = sign * (0.10 + run * 0.04);
    j[`${side}Forearm`].rotation.x = -0.22 - run * 0.78;
  }
  const kick = KICK_ACTIONS.has(state.action);
  const kickEnd = Math.min(.50, actionDuration);
  if (kick && age < kickEnd) {
    const strength = state.action === 'pass' || state.action === 'through-pass' ? 0.75 : 1;
    const weight=1-THREE.MathUtils.smoothstep(age,Math.min(.17,kickEnd*.4),kickEnd);
    const extension=Math.sin(Math.min(1,age/.36)*Math.PI)*strength;
    const side=model.footedness>0?'right':'left';
    const thigh=j[`${side}Thigh`],shin=j[`${side}Shin`],foot=j[`${side}Foot`];
    thigh.rotation.x=THREE.MathUtils.lerp(thigh.rotation.x,-.62-extension*.66,weight);
    shin.rotation.x=THREE.MathUtils.lerp(shin.rotation.x,.24*(1-extension),weight);
    foot.rotation.x=THREE.MathUtils.lerp(foot.rotation.x,.22,weight);
    j.spine.rotation.x+=.18*extension*weight;
    j.chest.rotation.y-=model.footedness*extension*.32*weight;
    j.leftArm.rotation.z+=.55*weight;j.rightArm.rotation.z-=.55*weight;
  } else if(chargePower>.01) {
    const power=Math.min(1,chargePower),side=model.footedness>0?'right':'left';
    j[`${side}Thigh`].rotation.x+=power*.50;
    j[`${side}Shin`].rotation.x+=power*.65;
    j.chest.rotation.y+=model.footedness*power*.28;
    j.spine.rotation.x-=power*.09;
    j.leftArm.rotation.z+=power*.35;j.rightArm.rotation.z-=power*.35;
  }
  if (state.action === 'receive' || state.action === 'close-control' || state.action === 'ball-roll' || state.action === 'drag-back') {
    const envelope=Math.sin(Math.min(age/actionDuration,1)*Math.PI) ** 2;
    j.rightThigh.rotation.x -= envelope * 0.38;
    j.rightFoot.rotation.y = -0.42 * envelope;
    j.spine.rotation.x += 0.12 * envelope;
  }
  if (state.action === 'standing-tackle' && age < actionDuration) {
    const extend = Math.sin(Math.min(age / actionDuration, 1) * Math.PI) ** 2;
    j.rightThigh.rotation.x = THREE.MathUtils.lerp(j.rightThigh.rotation.x,-0.85,extend);
    j.rightShin.rotation.x = THREE.MathUtils.lerp(j.rightShin.rotation.x,0.15,extend);
    j.spine.rotation.x += 0.2 * extend;
  }
  if (state.action === 'slide' || state.action === 'stumble' || state.action === 'injured') {
    // Injured players go down, stay down and get up again before limping on.
    const envelope = state.action === 'injured' ? Math.min(1, age / .35, Math.max(0, actionDuration - age) / .6) : Math.sin(Math.min(age / actionDuration, 1) * Math.PI) ** 2;
    j.hips.position.y -= envelope * 0.62;
    j.hips.rotation.x = -envelope * 0.8;
    j.rightThigh.rotation.x = THREE.MathUtils.lerp(j.rightThigh.rotation.x,-1.0,envelope);
    j.leftThigh.rotation.x = THREE.MathUtils.lerp(j.leftThigh.rotation.x,-0.6,envelope);
    j.leftShin.rotation.x = THREE.MathUtils.lerp(j.leftShin.rotation.x,1.4,envelope);
  }
  if (state.action === 'header') {
    const jump = Math.sin(Math.min(age / actionDuration, 1) * Math.PI) ** 2;
    j.hips.position.y += jump * 0.45;
    j.spine.rotation.x += jump * 0.24;
    j.head.rotation.x += jump * 0.30;
    j.leftArm.rotation.z = THREE.MathUtils.lerp(j.leftArm.rotation.z,0.68,jump);
    j.rightArm.rotation.z = THREE.MathUtils.lerp(j.rightArm.rotation.z,-0.68,jump);
  }
  if (state.action.startsWith('keeper-') && state.action !== 'keeper-kick' && state.action !== 'keeper-rush') {
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
    const target=new THREE.Vector3(dx*state.facingY-dy*state.facingX,source?.z ?? 1.1,dx*state.facingX+dy*state.facingY);
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
      pointHand(model,'left',target.clone().add(new THREE.Vector3(.07,0,0)),extent);
      pointHand(model,'right',target.clone().add(new THREE.Vector3(-.07,0,0)),extent);
    } else if(state.action==='keeper-catch') {
      const gather=THREE.MathUtils.smoothstep(age,0,.22);
      target.lerp(new THREE.Vector3(0,1.10,.35),gather);
      pointHand(model,'left',target.clone().add(new THREE.Vector3(.08,0,-.025)),1);
      pointHand(model,'right',target.clone().add(new THREE.Vector3(-.08,0,-.025)),1);
    } else if(state.action==='keeper-parry') {
      const weight=1-THREE.MathUtils.smoothstep(age,.12,.65);
      pointHand(model,'left',target.clone().add(new THREE.Vector3(.08,0,0)),weight);
      pointHand(model,'right',target.clone().add(new THREE.Vector3(-.08,0,0)),weight);
    } else if(state.action==='keeper-throw') {
      const weight=1-THREE.MathUtils.smoothstep(age,.15,.45);
      j.rightArm.rotation.x=-1.3*weight;j.rightForearm.rotation.x=-.25*weight;
      j.chest.rotation.y=-.32*weight;
    }
  }
  const contact = state.contact;
  if (contact?.kind === 'foot' && tick >= contact.tick && tick - contact.tick < 9) {
    const dx = contact.x - state.x, dy = contact.y - state.y;
    const forward = dx * state.facingX + dy * state.facingY - 0.31;
    const lateral = dx * state.facingY - dy * state.facingX;
    const distance = Math.hypot(forward, lateral);
    if (distance < maximumReach * 0.85) {
      const weight = Math.max(0, 1 - (tick - contact.tick) / 9);
      const targetDrop = Math.sqrt(Math.max(0.2, maximumReach * maximumReach - distance * distance));
      j.hips.position.y = Math.min(j.hips.position.y, 0.11 + targetDrop);
      const thigh = j[`${contact.foot}Thigh`], shin = j[`${contact.foot}Shin`], foot = j[`${contact.foot}Foot`];
      const old = [thigh.quaternion.clone(), shin.quaternion.clone(), foot.quaternion.clone()];
      placeFoot(model, contact.foot, lateral, 0.11, forward);
      [thigh, shin, foot].forEach((bone, i) => bone.quaternion.copy(old[i].slerp(bone.quaternion, weight)));
    }
  }
  if (state.action === 'celebrate') {
    j.leftArm.rotation.z = 2.50;
    j.rightArm.rotation.z = -2.50;
    j.leftForearm.rotation.x = -0.2;
    j.rightForearm.rotation.x = -0.2;
    if (!reducedMotion) j.hips.position.y += Math.abs(Math.sin(age * 6)) * 0.10;
  }
}

/** Two-link arm aiming preserves elbow length and solves in the current chest frame. */
function pointHand(model:ProceduralFootballer,side:'left'|'right',target:THREE.Vector3,weight:number):void {
  const arm=model.joints[`${side}Arm`],elbow=model.joints[`${side}Forearm`],hand=model.joints[`${side}Hand`];
  const oldArm=arm.quaternion.clone(),oldElbow=elbow.quaternion.clone();
  model.mesh.updateMatrixWorld(true);
  const origin=arm.getWorldPosition(new THREE.Vector3()),destination=model.mesh.localToWorld(target.clone());
  const delta=destination.clone().sub(origin),upper=elbow.position.length(),lower=hand.position.length();
  const distance=THREE.MathUtils.clamp(delta.length(),.001,upper+lower-.001),direction=delta.normalize();
  const pole=new THREE.Vector3(side==='left'?1:-1,-1,-.4).transformDirection(model.mesh.matrixWorld);
  const bend=pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const cosine=THREE.MathUtils.clamp((upper*upper+distance*distance-lower*lower)/(2*upper*distance),-1,1);
  const elbowTarget=origin.clone().addScaledVector(direction,upper*cosine).addScaledVector(bend,upper*Math.sqrt(1-cosine*cosine));
  const aim=(bone:THREE.Bone,child:THREE.Bone,world:THREE.Vector3)=>{
    const local=bone.parent!.worldToLocal(world.clone()).sub(bone.position).normalize();
    bone.quaternion.setFromUnitVectors(child.position.clone().normalize(),local);
    model.mesh.updateMatrixWorld(true);
  };
  aim(arm,elbow,elbowTarget);aim(elbow,hand,destination);
  arm.quaternion.copy(oldArm.slerp(arm.quaternion,weight));elbow.quaternion.copy(oldElbow.slerp(elbow.quaternion,weight));
}
