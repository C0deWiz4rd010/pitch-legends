// Bakes locomotion clips from the Quaternius Universal Animation Library (CC0, see docs/THIRD_PARTY_ASSETS.md)
// into a compact file for the 16-bone footballer rig.
//
//   node tools/bake-animations.mjs <AnimationLibrary_Godot_Standard.glb> public/assets/anim
//
// The library's rig has 53 bones and a different bind pose. Instead of copying local rotations, the clips are
// retargeted by what the pose looks like:
//  - hips, spine, chest and head (upright in both rigs) take the change of their world rotation against bind;
//  - limbs take the world direction of every bone (hip to knee, knee to ankle, shoulder to elbow, ...),
//    swung from the footballer's straight-down rest, so proportions and bind poses do not matter;
//  - the hips height follows the clip, scaled by leg length.
// Output: clips.json (index) and clips.bin (float32 quaternions and hips offsets, 30 frames per second).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';

const [, , glbPath, outDir] = process.argv;
if (!glbPath || !outDir) { console.error('usage: node tools/bake-animations.mjs <glb> <outDir>'); process.exit(1); }

// What the game uses: the gaits drive arms, torso, head and the hips' bob (the legs stay procedural, foot-locked to the
// ground); the dance is a complete celebration.
const CLIPS = {
  Idle_Loop: { name: 'idle', loop: true },
  Walk_Loop: { name: 'walk', loop: true, gait: true },
  Jog_Fwd_Loop: { name: 'jog', loop: true, gait: true },
  Sprint_Loop: { name: 'sprint', loop: true, gait: true },
  Dance_Loop: { name: 'dance', loop: true },
};
const FPS = 30;
// Our rig: bone name -> [source bone, kind, child source bone for the direction, rest direction]
const DOWN = [0, -1, 0], FORWARD = [0, 0, 1];
const RIG = [
  ['hips', 'DEF-hips', 'rotation'], ['spine', 'DEF-spine.002', 'rotation'], ['chest', 'DEF-spine.003', 'rotation'], ['head', 'DEF-head', 'rotation'],
  ['leftThigh', 'DEF-thigh.L', 'direction', 'DEF-shin.L', DOWN], ['leftShin', 'DEF-shin.L', 'direction', 'DEF-foot.L', DOWN], ['leftFoot', 'DEF-foot.L', 'direction', 'DEF-toe.L', FORWARD],
  ['rightThigh', 'DEF-thigh.R', 'direction', 'DEF-shin.R', DOWN], ['rightShin', 'DEF-shin.R', 'direction', 'DEF-foot.R', DOWN], ['rightFoot', 'DEF-foot.R', 'direction', 'DEF-toe.R', FORWARD],
  ['leftArm', 'DEF-upper_arm.L', 'direction', 'DEF-forearm.L', DOWN], ['leftForearm', 'DEF-forearm.L', 'direction', 'DEF-hand.L', DOWN], ['leftHand', 'DEF-hand.L', 'rotation'],
  ['rightArm', 'DEF-upper_arm.R', 'direction', 'DEF-forearm.R', DOWN], ['rightForearm', 'DEF-forearm.R', 'direction', 'DEF-hand.R', DOWN], ['rightHand', 'DEF-hand.R', 'rotation'],
];
const BONES = RIG.map(entry => entry[0]);

// --- glTF reading -----------------------------------------------------------------------------------------
const file = readFileSync(glbPath);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;
const bin = file.subarray(binStart);
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const count = accessor.count, size = COMPONENTS[accessor.type];
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float32Array(count * size);
  const stride = view.byteStride ?? size * 4;
  if (accessor.componentType !== 5126) throw new Error('only float animation accessors are supported');
  for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) out[i * size + k] = bin.readFloatLE(offset + i * stride + k * 4);
  return out;
}

const nodes = gltf.nodes;
const parent = new Array(nodes.length).fill(-1);
nodes.forEach((node, i) => (node.children ?? []).forEach(child => { parent[child] = i; }));
const byName = new Map(nodes.map((node, i) => [node.name, i]));
const restT = nodes.map(n => new THREE.Vector3(...(n.translation ?? [0, 0, 0])));
const restR = nodes.map(n => new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])));
const restS = nodes.map(n => new THREE.Vector3(...(n.scale ?? [1, 1, 1])));

function worldTransforms(localT, localR, localS) {
  const world = new Array(nodes.length);
  const compute = i => {
    if (world[i]) return world[i];
    const local = new THREE.Matrix4().compose(localT[i], localR[i], localS[i]);
    world[i] = parent[i] >= 0 ? new THREE.Matrix4().multiplyMatrices(compute(parent[i]), local) : local;
    return world[i];
  };
  nodes.forEach((_, i) => compute(i));
  return world.map(m => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); return { p, q }; });
}

const bind = worldTransforms(restT, restR, restS);
const sourceIndex = name => { const i = byName.get(name); if (i === undefined) throw new Error(`missing bone ${name}`); return i; };
// Does the library face +Z (like the footballer)? Compare toe and ankle.
const faceFlip = bind[sourceIndex('DEF-toe.L')].p.z - bind[sourceIndex('DEF-foot.L')].p.z < 0 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) : new THREE.Quaternion();
const leftSign = Math.sign(bind[sourceIndex('DEF-upper_arm.L')].p.x - bind[sourceIndex('DEF-hips')].p.x);
console.log(`library faces ${faceFlip.w === 1 ? '+Z' : '-Z (flipped)'}, left side at ${leftSign > 0 ? '+X' : '-X'} (the footballer has it at +X)`);
const hipsHeight = bind[sourceIndex('DEF-hips')].p.y - Math.min(bind[sourceIndex('DEF-foot.L')].p.y, bind[sourceIndex('DEF-foot.R')].p.y);
console.log(`library hip height above the ankle: ${hipsHeight.toFixed(3)} m`);

// --- sampling -------------------------------------------------------------------------------------------------
function sampleTrack(times, values, size, time, interpolation) {
  const last = times.length - 1;
  if (time <= times[0]) return values.subarray(0, size);
  if (time >= times[last]) return values.subarray(last * size, last * size + size);
  let i = 0;
  while (times[i + 1] < time) i++;
  const t = (time - times[i]) / (times[i + 1] - times[i]);
  const a = values.subarray(i * size, i * size + size), b = values.subarray((i + 1) * size, (i + 1) * size + size);
  if (interpolation === 'STEP') return a;
  if (size === 4) { const q = new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), t); return [q.x, q.y, q.z, q.w]; }
  return a.map((v, k) => v + (b[k] - v) * t);
}

const toVec = array => new THREE.Vector3(array[0], array[1], array[2]);
const DOWN_V = new THREE.Vector3(...DOWN), FORWARD_V = new THREE.Vector3(...FORWARD);

function bakeClip(animation, spec) {
  const channels = animation.channels.map(channel => {
    const sampler = animation.samplers[channel.sampler];
    if (sampler.interpolation === 'CUBICSPLINE') throw new Error('cubic spline clips are not supported');
    return { node: channel.target.node, path: channel.target.path, times: readAccessor(sampler.input), values: readAccessor(sampler.output), interpolation: sampler.interpolation ?? 'LINEAR' };
  });
  const duration = Math.max(...channels.map(c => c.times[c.times.length - 1]));
  const frames = Math.max(2, Math.round(duration * FPS));
  const result = { quats: [], hips: [], footZ: [[], []], footY: [[], []] };
  for (let f = 0; f < frames; f++) {
    const time = spec.loop ? (f / frames) * duration : Math.min(duration, f / FPS);
    const localT = restT.map(v => v.clone()), localR = restR.map(q => q.clone());
    for (const channel of channels) {
      const value = sampleTrack(channel.times, channel.values, channel.path === 'rotation' ? 4 : 3, time, channel.interpolation);
      if (channel.path === 'rotation') localR[channel.node] = new THREE.Quaternion(value[0], value[1], value[2], value[3]);
      else if (channel.path === 'translation') localT[channel.node] = toVec(value);
    }
    const world = worldTransforms(localT, localR, restS);
    const frameQuats = [];
    for (const [name, source, kind, child, rest] of RIG) {
      const s = sourceIndex(source);
      let q;
      if (kind === 'rotation') {
        // World rotation change against bind, turned to the footballer's facing.
        q = world[s].q.clone().multiply(bind[s].q.clone().invert());
        q = faceFlip.clone().multiply(q).multiply(faceFlip.clone().invert());
      } else {
        const direction = world[sourceIndex(child)].p.clone().sub(world[s].p).normalize().applyQuaternion(faceFlip);
        q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...rest), direction);
      }
      frameQuats.push({ name, q });
    }
    // Convert to the rig's local space: its bones are all identity at rest, so local = parentWorld^-1 * world.
    const parents = { spine: 'hips', chest: 'spine', head: 'chest', leftThigh: 'hips', leftShin: 'leftThigh', leftFoot: 'leftShin', rightThigh: 'hips', rightShin: 'rightThigh', rightFoot: 'rightShin',
      leftArm: 'chest', leftForearm: 'leftArm', leftHand: 'leftForearm', rightArm: 'chest', rightForearm: 'rightArm', rightHand: 'rightForearm' };
    const worldOf = Object.fromEntries(frameQuats.map(entry => [entry.name, entry.q]));
    for (const name of BONES) {
      const local = parents[name] ? worldOf[parents[name]].clone().invert().multiply(worldOf[name]) : worldOf[name].clone();
      result.quats.push(local.x, local.y, local.z, local.w);
    }
    const hipsWorld = world[sourceIndex('DEF-hips')].p;
    const rootWorld = world[sourceIndex('root')].p;
    result.hips.push(hipsWorld.x - rootWorld.x, hipsWorld.y - Math.min(world[sourceIndex('DEF-foot.L')].p.y, world[sourceIndex('DEF-foot.R')].p.y), hipsWorld.z - rootWorld.z);
    for (const [k, name] of ['DEF-foot.L', 'DEF-foot.R'].entries()) {
      const p = world[sourceIndex(name)].p;
      result.footZ[k].push(p.z * (faceFlip.w === 1 ? 1 : -1) - hipsWorld.z * (faceFlip.w === 1 ? 1 : -1));
      result.footY[k].push(p.y);
    }
  }
  return { duration, frames, ...result };
}

// Natural stride of a gait clip: relative to the hips a foot only travels backwards while it pushes the player along,
// so the backwards travel of both feet over one cycle is the ground one cycle covers.
function groundStride(clip) {
  let stride = 0;
  for (const k of [0, 1]) {
    for (let f = 0; f < clip.frames; f++) stride += Math.max(0, clip.footZ[k][f] - clip.footZ[k][(f + 1) % clip.frames]);
  }
  return stride;
}

// Rotate a looping gait so frame 0 is the left foot's heel strike (its furthest forward reach while low).
function alignToLeftStrike(clip) {
  let best = 0, bestZ = -Infinity;
  const lowest = Math.min(...clip.footY[0]);
  for (let f = 0; f < clip.frames; f++) if (clip.footY[0][f] - lowest < 0.05 && clip.footZ[0][f] > bestZ) { bestZ = clip.footZ[0][f]; best = f; }
  const rotate = (array, size) => { const out = []; for (let f = 0; f < clip.frames; f++) for (let k = 0; k < size; k++) out.push(array[((f + best) % clip.frames) * size + k]); return out; };
  clip.quats = rotate(clip.quats, BONES.length * 4);
  clip.hips = rotate(clip.hips, 3);
  return best;
}

mkdirSync(outDir, { recursive: true });
const index = { fps: FPS, bones: BONES, hipHeight: hipsHeight, clips: {} };
const floats = [];
for (const animation of gltf.animations) {
  const spec = CLIPS[animation.name];
  if (!spec) continue;
  const clip = bakeClip(animation, spec);
  const entry = { frames: clip.frames, duration: +clip.duration.toFixed(4), loop: spec.loop, offset: floats.length };
  if (spec.gait) {
    const stride = groundStride(clip);
    entry.speed = +(stride / clip.duration).toFixed(3);
    entry.stride = +stride.toFixed(3);
    entry.alignedAt = alignToLeftStrike(clip);
  }
  // Layout per frame: 16 quaternions, then the hips offset (x, y, z).
  for (let f = 0; f < clip.frames; f++) {
    for (let k = 0; k < BONES.length * 4; k++) floats.push(clip.quats[f * BONES.length * 4 + k]);
    for (let k = 0; k < 3; k++) floats.push(clip.hips[f * 3 + k]);
  }
  index.clips[spec.name] = entry;
  console.log(spec.name.padEnd(8), `${entry.frames} frames, ${entry.duration}s`, spec.gait ? `speed ${entry.speed} m/s, stride ${entry.stride} m` : '');
}
writeFileSync(join(outDir, 'clips.bin'), Buffer.from(new Float32Array(floats).buffer));
writeFileSync(join(outDir, 'clips.json'), JSON.stringify(index));
console.log(`wrote ${floats.length * 4} bytes of animation data`);
