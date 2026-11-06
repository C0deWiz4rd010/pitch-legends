import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { createClubVisualIdentity, createPlayerVisualIdentity } from './core/visual-identity';
import { PlayerRuntimeSnapshot } from './models/match.model';
import { clearClipSet, clipSet, gaitWeights, installClipSet, sampleLocomotion, sampleSingle, setClipsEnabled } from './features/match/animation/clip-store';
import { celebrationVariant, createProceduralFootballer, poseFootballer } from './features/match/three-player.factory';

const BONES = ['hips', 'spine', 'chest', 'head', 'leftThigh', 'leftShin', 'leftFoot', 'rightThigh', 'rightShin', 'rightFoot', 'leftArm', 'leftForearm', 'leftHand', 'rightArm', 'rightForearm', 'rightHand'];
const FRAME = BONES.length * 4 + 3;
const kit = createClubVisualIdentity('Test', 'TST', '#18bb99', '#102844', 3).kits.home;

/** A handmade clip set: the spine pitches by a fixed angle per clip, the hips bob with the frame. */
function installSynthetic(): void {
  const pitch: Record<string, number> = { idle: 0, walk: 0.1, jog: 0.2, sprint: 0.4, dance: 0.7 };
  const names = Object.keys(pitch);
  const frames = 4;
  const data = new Float32Array(names.length * frames * FRAME);
  const clips: Record<string, { frames: number; duration: number; loop: boolean; offset: number }> = {};
  names.forEach((name, n) => {
    clips[name] = { frames, duration: 1, loop: true, offset: n * frames * FRAME };
    for (let f = 0; f < frames; f++) {
      const base = clips[name].offset + f * FRAME;
      for (let b = 0; b < BONES.length; b++) data[base + b * 4 + 3] = 1;
      const half = pitch[name] / 2, spine = BONES.indexOf('spine') * 4;
      data[base + spine] = Math.sin(half); data[base + spine + 3] = Math.cos(half);
      data[base + BONES.length * 4 + 1] = f % 2 ? 0.03 : -0.03;
    }
  });
  installClipSet({ fps: 30, bones: BONES, hipHeight: 0.813, clips }, data.buffer);
}

function baseState(patch: Partial<PlayerRuntimeSnapshot> = {}): PlayerRuntimeSnapshot {
  const { home, away } = createPracticeTeams();
  return { ...new ArcadeMatch(home, away, home.id).snapshot().players[0], x: 0, y: 0, vx: 0, vy: 0, facingX: 0, facingY: 1, animationDistance: 0, actionStartedTick: 0, ...patch };
}

afterEach(() => clearClipSet());

describe('Baked clips – sampling', () => {
  it('weights idle, walk, jog and sprint so that they always add up to one', () => {
    const weights = { idle: 0, walk: 0, jog: 0, sprint: 0 };
    for (let speed = 0; speed <= 10; speed += 0.25) {
      gaitWeights(speed, weights);
      expect(weights.idle + weights.walk + weights.jog + weights.sprint).toBeCloseTo(1, 10);
    }
    gaitWeights(0, weights); expect(weights.idle).toBe(1);
    gaitWeights(1.5, weights); expect(weights.walk).toBeCloseTo(1, 5);
    gaitWeights(4, weights); expect(weights.jog).toBeCloseTo(1, 5);
    gaitWeights(8, weights); expect(weights.sprint).toBeCloseTo(1, 5);
  });

  it('blends the gaits by speed and keeps every quaternion normalised', () => {
    installSynthetic();
    const set = clipSet()!;
    const frame = new Float32Array(set.frameSize);
    const spine = BONES.indexOf('spine') * 4;
    const pitchOf = () => 2 * Math.atan2(frame[spine], frame[spine + 3]);
    sampleLocomotion(set, 8, 0.3, 0, frame);
    expect(pitchOf()).toBeCloseTo(0.4, 4);
    sampleLocomotion(set, 5.75, 0.3, 0, frame);
    expect(pitchOf()).toBeGreaterThan(0.2);
    expect(pitchOf()).toBeLessThan(0.4);
    for (let b = 0; b < BONES.length; b++) expect(Math.hypot(frame[b * 4], frame[b * 4 + 1], frame[b * 4 + 2], frame[b * 4 + 3])).toBeCloseTo(1, 5);
  });

  it('loops around the end of a clip and only uses the bob of the hips around its mean', () => {
    installSynthetic();
    const set = clipSet()!;
    const frame = new Float32Array(set.frameSize);
    const a = new Float32Array(set.frameSize), b = new Float32Array(set.frameSize);
    sampleSingle(set, 'dance', 0.9999, a);
    sampleSingle(set, 'dance', 0.0001, b);
    const spine = BONES.indexOf('spine') * 4;
    expect(a[spine]).toBeCloseTo(b[spine], 3);
    // Frames alternate -0.03 / +0.03 around a mean of zero.
    sampleSingle(set, 'dance', 0, frame);
    expect(Math.abs(frame[BONES.length * 4 + 1])).toBeCloseTo(0.03, 5);
  });
});

describe('Baked clips – on the footballer', () => {
  const jog = { vy: 4.5, animationDistance: 3, action: 'jog' } as const;

  it('uses the clip for arms and torso of an outfield player, and not for a goalkeeper', () => {
    installSynthetic();
    const outfield = createProceduralFootballer(createPlayerVisualIdentity('clip-outfield'), kit, 7);
    const keeper = createProceduralFootballer(createPlayerVisualIdentity('clip-keeper'), kit, 1, true);
    poseFootballer(outfield, baseState({ ...jog, vy: 8 }), 60, 1, true);
    poseFootballer(keeper, baseState({ ...jog, vy: 8 }), 60, 1, true);
    setClipsEnabled(false);
    const plainOutfield = createProceduralFootballer(createPlayerVisualIdentity('clip-outfield'), kit, 7);
    const plainKeeper = createProceduralFootballer(createPlayerVisualIdentity('clip-keeper'), kit, 1, true);
    poseFootballer(plainOutfield, baseState({ ...jog, vy: 8 }), 60, 1, true);
    poseFootballer(plainKeeper, baseState({ ...jog, vy: 8 }), 60, 1, true);
    expect(outfield.joints.spine.rotation.x).toBeCloseTo(0.4, 1);
    expect(plainOutfield.joints.spine.rotation.x).not.toBeCloseTo(0.4, 1);
    expect(keeper.joints.spine.quaternion.angleTo(plainKeeper.joints.spine.quaternion)).toBeLessThan(1e-9);
    [outfield, keeper, plainOutfield, plainKeeper].forEach(model => model.destroy());
  });

  it('keeps the legs procedural so a planted foot stays planted', () => {
    installSynthetic();
    const withClips = createProceduralFootballer(createPlayerVisualIdentity('legs'), kit, 7);
    poseFootballer(withClips, baseState({ ...jog }), 60, 1, true);
    const thigh = withClips.joints.leftThigh.quaternion.clone(), shin = withClips.joints.leftShin.quaternion.clone();
    setClipsEnabled(false);
    const plain = createProceduralFootballer(createPlayerVisualIdentity('legs'), kit, 7);
    poseFootballer(plain, baseState({ ...jog }), 60, 1, true);
    expect(thigh.angleTo(plain.joints.leftThigh.quaternion)).toBeLessThan(1e-6);
    expect(shin.angleTo(plain.joints.leftShin.quaternion)).toBeLessThan(1e-6);
    withClips.destroy(); plain.destroy();
  });

  it('fades back to the procedural pose for a sidestep instead of snapping', () => {
    installSynthetic();
    const model = createProceduralFootballer(createPlayerVisualIdentity('sidestep'), kit, 7);
    // Facing +Z while moving along X: no forward component.
    const side = baseState({ vx: 4.5, vy: 0, action: 'jog' });
    poseFootballer(model, { ...side, vx: 0, vy: 4.5, animationDistance: 0 }, 60, 1, true);
    const forwardPitch = model.joints.spine.rotation.x;
    const sampled: number[] = [];
    for (let i = 1; i <= 60; i++) {
      poseFootballer(model, { ...side, animationDistance: i * 0.07 }, 60 + i, 1 + i / 60, true);
      sampled.push(model.joints.spine.rotation.x);
    }
    // The clip pitch (0.2) eases towards the procedural one; no frame jumps by more than a small step.
    for (let i = 1; i < sampled.length; i++) expect(Math.abs(sampled[i] - sampled[i - 1])).toBeLessThan(0.08);
    expect(Math.abs(sampled[sampled.length - 1] - forwardPitch)).toBeGreaterThan(0.05);
    model.destroy();
  });

  it('dances for one celebration variant when clips are there and raises the arms when they are not', () => {
    let seed = 0;
    let dancer = createProceduralFootballer(createPlayerVisualIdentity('dance-0'), kit, 7);
    while (celebrationVariant(dancer) !== 5 && seed < 200) { dancer.destroy(); dancer = createProceduralFootballer(createPlayerVisualIdentity(`dance-${++seed}`), kit, 7); }
    expect(celebrationVariant(dancer)).toBe(5);
    const celebrate = baseState({ action: 'celebrate' });
    installSynthetic();
    poseFootballer(dancer, celebrate, 60, 1, false);
    expect(dancer.joints.spine.rotation.x).toBeCloseTo(0.7, 1);
    clearClipSet();
    poseFootballer(dancer, celebrate, 60, 1, false);
    expect(dancer.joints.leftArm.rotation.z).toBeGreaterThan(2);
    dancer.destroy();
  });
});
