import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { createClubVisualIdentity, createPlayerVisualIdentity } from './core/visual-identity';
import { EMPTY_MATCH_COMMAND, PlayerRuntimeSnapshot } from './models/match.model';
import { advanceGait, newGait, strideFor, turnStepAmount } from './features/match/animation/locomotion';
import { RefereeRig } from './features/match/animation/referee';
import { createProceduralFootballer, measureFootSlide, poseFootballer } from './features/match/three-player.factory';

const kit = createClubVisualIdentity('Test', 'TST', '#18bb99', '#102844', 3).kits.home;

function baseState(): PlayerRuntimeSnapshot {
  const { home, away } = createPracticeTeams();
  return { ...new ArcadeMatch(home, away, home.id).snapshot().players[0], x: 0, y: 0, vx: 0, vy: 0, facingX: 0, facingY: 1, animationDistance: 0, actionStartedTick: 0 };
}

describe('Phase 4 – locomotion timing', () => {
  it('takes longer strides the faster and the taller the player is', () => {
    expect(strideFor(1.5, 1.82)).toBeLessThan(strideFor(4.5, 1.82));
    expect(strideFor(4.5, 1.82)).toBeLessThan(strideFor(8.5, 1.82));
    expect(strideFor(4.5, 1.95)).toBeGreaterThan(strideFor(4.5, 1.7));
    // Clamped: a standing figure still has a sensible stride and no sprint exceeds the cap.
    expect(strideFor(0, 1.82)).toBeCloseTo(1.5, 5);
    expect(strideFor(20, 1.82)).toBeCloseTo(4.4, 5);
  });

  it('accumulates the phase from the ground covered, so a change of speed never makes it jump', () => {
    const gait = newGait();
    let cycle = advanceGait(gait, 0, 3, 1.82);
    let distance = 0;
    let largest = 0;
    for (let i = 0; i < 80; i++) {
      distance += 0.1;
      const speed = 3 + i * 0.07;
      const next = advanceGait(gait, distance, speed, 1.82);
      largest = Math.max(largest, next - cycle);
      cycle = next;
    }
    // A tenth of a metre is at most a tenth of a metre over the shortest stride in use.
    expect(largest).toBeLessThanOrEqual(0.1 / strideFor(3, 1.82) + 1e-9);
    expect(cycle).toBeGreaterThan(2);
  });

  it('restarts the phase from the reading after a replay seek, and steps on the spot while turning slowly', () => {
    const gait = newGait();
    advanceGait(gait, 50, 5, 1.82);
    expect(advanceGait(gait, 10, 5, 1.82)).toBeCloseTo(10 / strideFor(5, 1.82), 8);
    const before = gait.cycle;
    expect(advanceGait(gait, 10, 0.2, 1.82, 0.28)).toBeGreaterThan(before);
    expect(turnStepAmount(3, 0.2)).toBeGreaterThan(0);
    expect(turnStepAmount(3, 5)).toBe(0);
    expect(turnStepAmount(0, 0.2)).toBe(0);
  });

  it.each([3, 5, 8])('keeps a planted foot on the turf at %s m/s (under 3 cm per 5 cm of travel)', speed => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('slide-test'), kit, 7);
    expect(measureFootSlide(model, baseState(), speed)).toBeLessThan(0.03);
    model.destroy();
  });
});

describe('Phase 4 – action poses', () => {
  const pose = (action: PlayerRuntimeSnapshot['action'], patch: Partial<PlayerRuntimeSnapshot> = {}, age = 0.2, lookAt?: { x: number; y: number }, goalkeeper = false) => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('pose-test'), kit, 7, goalkeeper);
    poseFootballer(model, { ...baseState(), action, actionStartedTick: 100 - Math.round(age * 60), ...patch }, 100, 1, true, 0, lookAt);
    return model;
  };

  it('receives and tackles with the foot on the ball\'s side', () => {
    const left = pose('receive', {}, 0.09, { x: 1, y: 0.5 });
    const right = pose('receive', {}, 0.09, { x: -1, y: 0.5 });
    expect(left.joints.leftThigh.rotation.x).toBeLessThan(left.joints.rightThigh.rotation.x);
    expect(right.joints.rightThigh.rotation.x).toBeLessThan(right.joints.leftThigh.rotation.x);
    const tackle = pose('standing-tackle', {}, 0.1, { x: 1, y: 0.5 });
    expect(tackle.joints.leftThigh.rotation.x).toBeLessThan(tackle.joints.rightThigh.rotation.x);
    left.destroy(); right.destroy(); tackle.destroy();
  });

  it('shows a stumble with the arms out and the body pitched forward, a heavy touch only slightly', () => {
    const idle = pose('idle');
    const stumble = pose('stumble', {}, 0.23);
    const touch = pose('heavy-touch', {}, 0.125);
    expect(stumble.joints.leftArm.rotation.z).toBeGreaterThan(idle.joints.leftArm.rotation.z + 0.4);
    expect(stumble.joints.hips.position.y).toBeLessThan(idle.joints.hips.position.y);
    expect(touch.joints.leftArm.rotation.z).toBeGreaterThan(idle.joints.leftArm.rotation.z);
    expect(touch.joints.leftArm.rotation.z).toBeLessThan(stumble.joints.leftArm.rotation.z);
    idle.destroy(); stumble.destroy(); touch.destroy();
  });

  it('lets an outfield player throw in with both arms over the head while a keeper throws with one', () => {
    const outfield = pose('keeper-throw', {}, 0.2);
    const keeper = pose('keeper-throw', {}, 0.2, undefined, true);
    expect(outfield.joints.leftArm.rotation.x).toBeLessThan(-1.5);
    expect(outfield.joints.rightArm.rotation.x).toBeLessThan(-1.5);
    expect(keeper.joints.leftArm.rotation.x).toBeGreaterThan(-1.5);
    outfield.destroy(); keeper.destroy();
  });

  it('jumps as high for a header as the contact needs', () => {
    const low = pose('header', { contact: { tick: 90, x: 0, y: 0, z: 1.9, kind: 'head', foot: 'right' } }, 0.19);
    const high = pose('header', { contact: { tick: 90, x: 0, y: 0, z: 2.8, kind: 'head', foot: 'right' } }, 0.19);
    expect(high.joints.hips.position.y).toBeGreaterThan(low.joints.hips.position.y + 0.1);
    low.destroy(); high.destroy();
  });

  it('keeps every blended vertex weight normalised and the geometry indexed', () => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('weights'), kit, 3);
    const weights = model.mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weights.count; i += 7) expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 4);
    expect(model.mesh.geometry.index).not.toBeNull();
    model.destroy();
  });
});

describe('Phase 4 – the referee', () => {
  it('jogs after the ball inside the pitch and stands still when nothing moves', () => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('referee'), kit, 0);
    const rig = new RefereeRig(model);
    rig.update(0, 0, 0, 1, 10, true);
    const start = model.mesh.position.clone();
    rig.update(0, 0, 0, 1, 11, true);
    expect(model.mesh.position.distanceTo(start)).toBe(0);
    for (let i = 0; i < 900; i++) rig.update(40, 10, 1 / 60, 1 + i / 60, 12 + i, true);
    // About 9 m behind the ball, on the side of the centre circle.
    expect(model.mesh.position.x).toBeGreaterThan(28);
    expect(model.mesh.position.x).toBeLessThan(34);
    expect(Math.abs(model.mesh.position.x)).toBeLessThan(52.5);
    expect(Math.abs(model.mesh.position.z)).toBeLessThan(34);
    expect(Number.isFinite(model.joints.hips.position.y)).toBe(true);
    rig.destroy();
  });
});

describe('Phase 4 – match events the animation shows', () => {
  const stage = () => {
    const { home, away } = createPracticeTeams();
    const match = new ArcadeMatch(home, away, { mode: 'play', controllerMode: 'human', seed: 5501, fixtureId: 'anim-v3', controlledTeamId: home.id,
      halfMinutes: 3, difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'keyboard',
      camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true } });
    match.rule.phase = 'playing';
    match.tick = 100;
    return match;
  };

  it('alternates the dribbling foot, the strong one taking two touches in three', () => {
    const match = stage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner = match as unknown as Record<string, any>;
    const actor = match.actors[3];
    actor.player.foot = 'Right';
    const feet = [0, 11, 22, 33, 44, 55].map(tick => { match.tick = tick; return inner['dribbleFoot'](actor); });
    expect(feet).toEqual(['right', 'right', 'left', 'right', 'right', 'left']);
    actor.player.foot = 'Both';
    expect([0, 11].map(tick => { match.tick = tick; return inner['dribbleFoot'](actor); })).toEqual(['right', 'left']);
  });

  it('shows the shielding stance for a human carrier holding the button', () => {
    const match = stage();
    const carrier = match.actors.find(actor => actor.player.id === match.selectedPlayerId)!;
    for (const actor of match.actors) actor.active = actor === carrier;
    Object.assign(carrier, { x: 40, y: 34, vx: 0, vy: 0, decisionCooldown: 100 });
    Object.assign(match.ball, { ownerId: carrier.player.id, x: 40.3, y: 34, z: 0.11, vx: 0, vy: 0, controlledTouch: 0 });
    match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, jockey: true, device: 'keyboard' });
    expect(carrier.action).toBe('jockey');
  });
});
