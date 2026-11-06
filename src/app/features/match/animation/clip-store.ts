/**
 * Baked animation clips (Quaternius Universal Animation Library, CC0), produced by tools/bake-animations.mjs for
 * the footballer's 16 bones. Per frame a clip holds 16 local quaternions (x, y, z, w) and the hips offset (x, y, z).
 *
 * Gaits drive arms, torso, head and the hips' bob; the legs stay procedural so that planted feet never slide.
 * Without the files (offline cache miss, tests) everything falls back to the procedural poses.
 */
export interface ClipData {
  frames: number;
  duration: number;
  loop: boolean;
  /** First float of the clip in the shared data array. */
  offset: number;
  /** Mean hips offset over the clip, so only the bob around it is used. */
  meanHipsX: number;
  meanHipsY: number;
}

export interface ClipSet {
  fps: number;
  bones: readonly string[];
  /** Floats per frame: four per bone plus the hips offset. */
  frameSize: number;
  /** Hip height of the source character above its ankles, for scaling the bob. */
  hipHeight: number;
  clips: Record<string, ClipData>;
  data: Float32Array;
}

interface ClipIndex {
  fps: number;
  bones: string[];
  hipHeight: number;
  clips: Record<string, { frames: number; duration: number; loop: boolean; offset: number }>;
}

let current: ClipSet | null = null;
let enabled = true;

/** The loaded clips, or null when none are loaded or they are switched off (the studio's A/B switch). */
export function clipSet(): ClipSet | null {
  return enabled ? current : null;
}

export function setClipsEnabled(value: boolean): void {
  enabled = value;
}

export function clipsEnabled(): boolean {
  return enabled;
}

export function installClipSet(index: ClipIndex, buffer: ArrayBuffer): ClipSet {
  const data = new Float32Array(buffer);
  const frameSize = index.bones.length * 4 + 3;
  const clips: Record<string, ClipData> = {};
  for (const [name, entry] of Object.entries(index.clips)) {
    let x = 0, y = 0;
    for (let f = 0; f < entry.frames; f++) {
      const at = entry.offset + f * frameSize + index.bones.length * 4;
      x += data[at]; y += data[at + 1];
    }
    clips[name] = { ...entry, meanHipsX: x / entry.frames, meanHipsY: y / entry.frames };
  }
  current = { fps: index.fps, bones: index.bones, frameSize, hipHeight: index.hipHeight, clips, data };
  return current;
}

export function clearClipSet(): void {
  current = null;
  enabled = true;
}

/** Loads the baked clips once; a failure only means the procedural poses stay in use. */
export async function loadClipSet(baseUrl?: string): Promise<ClipSet | null> {
  if (current) return current;
  try {
    const base = baseUrl ?? new URL('assets/anim/', document.baseURI).href;
    const [indexResponse, binaryResponse] = await Promise.all([fetch(`${base}clips.json`), fetch(`${base}clips.bin`)]);
    if (!indexResponse.ok || !binaryResponse.ok) return null;
    return installClipSet((await indexResponse.json()) as ClipIndex, await binaryResponse.arrayBuffer());
  } catch {
    return null;
  }
}

/** Index of a bone in the frame layout, or -1. */
export function boneSlot(set: ClipSet, bone: string): number {
  return set.bones.indexOf(bone);
}

/**
 * Adds `weight` times the clip at loop phase `phase` (0 to 1) to `out` (frameSize floats). Quaternions are summed on
 * the same hemisphere as the first contribution and normalised by the caller with `normaliseFrame`.
 */
export function accumulateClip(set: ClipSet, name: string, phase: number, weight: number, out: Float32Array): void {
  const clip = set.clips[name];
  if (!clip || weight <= 0) return;
  const position = ((phase % 1) + 1) % 1 * clip.frames;
  const first = Math.floor(position) % clip.frames;
  const second = (first + 1) % clip.frames;
  const t = position - Math.floor(position);
  const a = clip.offset + first * set.frameSize, b = clip.offset + second * set.frameSize;
  const quaternionFloats = set.bones.length * 4;
  for (let bone = 0; bone < set.bones.length; bone++) {
    const k = bone * 4;
    // Interpolate between the two frames (shortest way), then add on the hemisphere of what is already in `out`.
    const dotFrames = set.data[a + k] * set.data[b + k] + set.data[a + k + 1] * set.data[b + k + 1] + set.data[a + k + 2] * set.data[b + k + 2] + set.data[a + k + 3] * set.data[b + k + 3];
    const flipFrames = dotFrames < 0 ? -1 : 1;
    let qx = set.data[a + k] * (1 - t) + set.data[b + k] * t * flipFrames;
    let qy = set.data[a + k + 1] * (1 - t) + set.data[b + k + 1] * t * flipFrames;
    let qz = set.data[a + k + 2] * (1 - t) + set.data[b + k + 2] * t * flipFrames;
    let qw = set.data[a + k + 3] * (1 - t) + set.data[b + k + 3] * t * flipFrames;
    const length = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= length; qy /= length; qz /= length; qw /= length;
    const alignment = out[k] * qx + out[k + 1] * qy + out[k + 2] * qz + out[k + 3] * qw < 0 ? -1 : 1;
    out[k] += qx * weight * alignment; out[k + 1] += qy * weight * alignment; out[k + 2] += qz * weight * alignment; out[k + 3] += qw * weight * alignment;
  }
  out[quaternionFloats] += (set.data[a + quaternionFloats] * (1 - t) + set.data[b + quaternionFloats] * t - clip.meanHipsX) * weight;
  out[quaternionFloats + 1] += (set.data[a + quaternionFloats + 1] * (1 - t) + set.data[b + quaternionFloats + 1] * t - clip.meanHipsY) * weight;
  out[quaternionFloats + 2] += (set.data[a + quaternionFloats + 2] * (1 - t) + set.data[b + quaternionFloats + 2] * t) * weight;
}

export function normaliseFrame(set: ClipSet, out: Float32Array): void {
  for (let bone = 0; bone < set.bones.length; bone++) {
    const k = bone * 4;
    const length = Math.hypot(out[k], out[k + 1], out[k + 2], out[k + 3]);
    if (length < 1e-6) { out[k] = out[k + 1] = out[k + 2] = 0; out[k + 3] = 1; } else { out[k] /= length; out[k + 1] /= length; out[k + 2] /= length; out[k + 3] /= length; }
  }
}

const smooth = (value: number, from: number, to: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Weights of idle, walk, jog and sprint for a ground speed in m/s; they always add up to 1. */
export function gaitWeights(speed: number, out: { idle: number; walk: number; jog: number; sprint: number }): void {
  const walking = smooth(speed, 0.3, 1.0), jogging = smooth(speed, 2.0, 3.0), sprinting = smooth(speed, 5.0, 6.5);
  out.idle = 1 - walking;
  out.walk = walking * (1 - jogging);
  out.jog = walking * jogging * (1 - sprinting);
  out.sprint = walking * jogging * sprinting;
}

const WEIGHTS = { idle: 1, walk: 0, jog: 0, sprint: 0 };

/**
 * One locomotion frame for this speed: the gait clips share their phase (all start on the left foot's strike), idle runs
 * on its own, slower clock.
 */
export function sampleLocomotion(set: ClipSet, speed: number, gaitPhase: number, idlePhase: number, out: Float32Array): void {
  out.fill(0);
  gaitWeights(speed, WEIGHTS);
  accumulateClip(set, 'idle', idlePhase, WEIGHTS.idle, out);
  accumulateClip(set, 'walk', gaitPhase, WEIGHTS.walk, out);
  accumulateClip(set, 'jog', gaitPhase, WEIGHTS.jog, out);
  accumulateClip(set, 'sprint', gaitPhase, WEIGHTS.sprint, out);
  normaliseFrame(set, out);
}

/** One whole clip frame (a celebration), not mixed with anything. */
export function sampleSingle(set: ClipSet, name: string, phase: number, out: Float32Array): void {
  out.fill(0);
  accumulateClip(set, name, phase, 1, out);
  normaliseFrame(set, out);
}
