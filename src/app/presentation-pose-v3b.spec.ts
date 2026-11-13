import * as THREE from 'three';
import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { ACTION_CONTACT_TICKS, ACTION_DURATION_TICKS } from './core/football/action-timing';
import { createClubVisualIdentity, createPlayerVisualIdentity } from './core/visual-identity';
import { PlayerActionState, PlayerRuntimeSnapshot } from './models/match.model';
import { blendSecondsFor, fakeSwing, kickKnee, kickSwing, limpLoad, SWING_AT_CONTACT } from './features/match/animation/kick-phase';
import { checkPose, checkWeights } from './features/match/animation/rig-check';
import { createProceduralFootballer, hurtLeg, kickingFoot, measureFootSlide, poseFootballer, ProceduralFootballer } from './features/match/three-player.factory';

const kit = createClubVisualIdentity('Test', 'TST', '#18bb99', '#102844', 3).kits.home;

function baseState(): PlayerRuntimeSnapshot {
  const { home, away } = createPracticeTeams();
  return { ...new ArcadeMatch(home, away, home.id).snapshot().players[0], x: 0, y: 0, vx: 0, vy: 0, facingX: 0, facingY: 1, animationDistance: 0, actionStartedTick: 0, contact: undefined };
}

/** Poses a fresh figure `ticks` after the release of `action` (the release is tick 100). */
function pose(action: PlayerActionState, ticks: number, patch: Partial<PlayerRuntimeSnapshot> = {}, goalkeeper = false, lookAt?: { x: number; y: number }): ProceduralFootballer {
  const model = createProceduralFootballer(createPlayerVisualIdentity('pose-v3b'), kit, 7, goalkeeper);
  poseFootballer(model, { ...baseState(), action, actionStartedTick: 100, ...patch }, 100 + ticks, 1, true, 0, lookAt);
  return model;
}

const world = new THREE.Vector3();
function footWorld(model: ProceduralFootballer, side: 'left' | 'right'): THREE.Vector3 {
  model.mesh.updateMatrixWorld(true);
  return model.joints[`${side}Foot`].getWorldPosition(world).clone();
}

describe('Presentation 3b – the swing follows the simulated contact tick', () => {
  it.each(['pass', 'through-pass', 'lob', 'shot', 'volley', 'bicycle-kick'] as const)('winds up, reaches the ball exactly at the contact tick and follows through (%s)', action => {
    const contact = ACTION_CONTACT_TICKS[action]!, duration = ACTION_DURATION_TICKS[action]!;
    expect(contact).toBeGreaterThan(0);
    // Wind-up goes back (negative), the ball is met at the fixed fraction of the swing, the follow-through peaks later.
    let lowest = 0, lowestAt = 0;
    for (let t = 0; t <= contact; t += 0.25) { const s = kickSwing(t, contact, duration); if (s < lowest) { lowest = s; lowestAt = t; } }
    expect(lowest).toBeLessThan(-0.95);
    expect(lowestAt).toBeLessThan(contact);
    expect(kickSwing(contact, contact, duration)).toBeCloseTo(SWING_AT_CONTACT, 6);
    expect(kickSwing(contact + 6, contact, duration)).toBeGreaterThan(0.95);
    expect(kickSwing(duration, contact, duration)).toBe(0);
    // Continuous: no tick-to-tick jump in the swing (it would show as a pop in the pose).
    let largest = 0, previous = kickSwing(0, contact, duration);
    for (let t = 0.5; t <= duration; t += 0.5) { const next = kickSwing(t, contact, duration); largest = Math.max(largest, Math.abs(next - previous)); previous = next; }
    // Short wind-ups are fast by nature: the allowed jump per half tick shrinks with the length of the forward swing.
    expect(largest).toBeLessThan(3.4 / contact);
  });

  it('bends the knee while the foot goes back, whips it open through the ball and never exceeds the sensible range', () => {
    const contact = ACTION_CONTACT_TICKS.shot!, duration = ACTION_DURATION_TICKS.shot!;
    const atBack = kickKnee(contact * 0.55, contact, duration), atBall = kickKnee(contact, contact, duration, 0.3);
    expect(atBack).toBeGreaterThan(1.2);
    expect(atBall).toBeCloseTo(0.3, 5);
    for (let t = 0; t <= duration; t += 0.5) { const knee = kickKnee(t, contact, duration); expect(knee).toBeGreaterThanOrEqual(0); expect(knee).toBeLessThanOrEqual(1.6); }
  });

  it('moves the kicking thigh back before the contact tick and forward at and after it', () => {
    const contact = ACTION_CONTACT_TICKS.shot!;
    const before = pose('shot', contact * 0.55), at = pose('shot', contact, { contact: { tick: 100 + contact, x: 0, y: 0.8, z: 0.11, kind: 'foot', foot: 'right' } }), after = pose('shot', contact + 6);
    // Positive x rotation of a thigh swings the leg back, negative forward.
    expect(before.joints.rightThigh.rotation.x).toBeGreaterThan(0.3);
    expect(before.joints.rightShin.rotation.x).toBeGreaterThan(1.0);
    expect(after.joints.rightThigh.rotation.x).toBeLessThan(-1.0);
    expect(after.joints.rightThigh.rotation.x).toBeLessThan(at.joints.rightThigh.rotation.x + 0.2);
    for (const model of [before, at, after]) model.destroy();
  });

  it('puts the kicking foot at the ball at the contact tick and keeps the weight on the other leg', () => {
    const contact = ACTION_CONTACT_TICKS.shot!;
    const model = pose('shot', contact, { contact: { tick: 100 + contact, x: 0, y: 0.7, z: 0.11, kind: 'foot', foot: 'right' } });
    const foot = footWorld(model, 'right');
    // The ankle ends up a boot length behind the ball and close to the ground.
    expect(foot.z).toBeGreaterThan(0.25);
    expect(foot.z).toBeLessThan(0.75);
    expect(foot.y).toBeLessThan(0.3);
    expect(footWorld(model, 'left').y).toBeLessThan(0.25);
    model.destroy();
  });

  it('meets a volley at ankle height off the ground', () => {
    const contact = ACTION_CONTACT_TICKS.volley!;
    const model = pose('volley', contact, { contact: { tick: 100 + contact, x: 0, y: 0.6, z: 0.9, kind: 'foot', foot: 'right' } });
    expect(footWorld(model, 'right').y).toBeGreaterThan(0.5);
    expect(footWorld(model, 'left').y).toBeLessThan(0.35);
    model.destroy();
  });

  it('flips back for an overhead kick, with the foot above the hips at the contact tick and the body flat on the ground afterwards', () => {
    const contact = ACTION_CONTACT_TICKS['bicycle-kick']!, duration = ACTION_DURATION_TICKS['bicycle-kick']!;
    const resting = pose('idle', 0), at = pose('bicycle-kick', contact), landed = pose('bicycle-kick', duration - 1);
    expect(at.joints.hips.rotation.x).toBeLessThan(-1.5);
    expect(at.joints.hips.position.y).toBeGreaterThan(resting.joints.hips.position.y + 0.3);
    expect(footWorld(at, 'right').y).toBeGreaterThan(at.joints.hips.position.y + 0.5);
    expect(landed.joints.hips.position.y).toBeLessThan(0.45);
    expect(landed.joints.hips.rotation.x).toBeLessThan(-1.2);
    // The figure never goes through the pitch at any tick of the action.
    for (let t = 0; t < duration; t += 2) {
      const model = pose('bicycle-kick', t);
      model.mesh.updateMatrixWorld(true);
      for (const bone of Object.values(model.joints)) expect(bone.getWorldPosition(world).y).toBeGreaterThan(-0.16);
      model.destroy();
    }
    for (const model of [resting, at, landed]) model.destroy();
  }, 30_000);

  it('dives head first for a flying header and lands on the chest', () => {
    const contact = ACTION_CONTACT_TICKS['flying-header']!, duration = ACTION_DURATION_TICKS['flying-header']!;
    const at = pose('flying-header', contact, { contact: { tick: 100 + contact, x: 0, y: 0.8, z: 1.1, kind: 'head', foot: 'right' } });
    const landed = pose('flying-header', duration - 1);
    expect(at.joints.hips.rotation.x).toBeGreaterThan(1.0);
    expect(at.joints.hips.position.y).toBeCloseTo(0.8, 1);
    expect(landed.joints.hips.position.y).toBeLessThan(0.45);
    at.destroy(); landed.destroy();
  });

  it('jumps the wall with the knees up and the hands in front of the body', () => {
    const rest = pose('idle', 0), mid = pose('wall-jump', ACTION_DURATION_TICKS['wall-jump']! / 2);
    expect(mid.joints.hips.position.y).toBeGreaterThan(rest.joints.hips.position.y + 0.25);
    expect(mid.joints.leftForearm.rotation.x).toBeLessThan(-1.0);
    expect(mid.joints.leftThigh.rotation.x).toBeLessThan(-0.4);
    rest.destroy(); mid.destroy();
  });

  it('shows a feint as a wind-up that never goes through the ball', () => {
    const duration = ACTION_DURATION_TICKS['fake-shot']!;
    let lowest = 0;
    for (let t = 0; t <= duration; t += 0.5) { const s = fakeSwing(t, duration); lowest = Math.min(lowest, s); expect(s).toBeLessThanOrEqual(0); }
    expect(lowest).toBeLessThan(-0.95);
    expect(fakeSwing(duration, duration)).toBe(0);
    const model = pose('fake-shot', 5);
    expect(model.joints.rightThigh.rotation.x).toBeGreaterThan(0.3);
    model.destroy();
  });

  it('springs up for a keeper punch with both fists high, and drops low over the ball for a smother', () => {
    const target = { x: 0, y: 0.4, z: 2.3 };
    const rest = pose('keeper-ready', 0, {}, true);
    const punch = pose('keeper-punch', 8, { actionTarget: target }, true);
    expect(punch.joints.hips.position.y).toBeGreaterThan(rest.joints.hips.position.y + 0.25);
    punch.mesh.updateMatrixWorld(true);
    expect(punch.joints.leftHand.getWorldPosition(world).y).toBeGreaterThan(1.9);
    const smother = pose('keeper-smother', 14, { actionTarget: { x: 0, y: 0.4, z: 0.15 } }, true);
    expect(smother.joints.hips.position.y).toBeLessThan(rest.joints.hips.position.y - 0.25);
    expect(smother.joints.spine.rotation.x).toBeGreaterThan(0.7);
    smother.mesh.updateMatrixWorld(true);
    expect(smother.joints.rightHand.getWorldPosition(world).y).toBeLessThan(0.9);
    for (const model of [rest, punch, smother]) { expect(Number.isFinite(model.joints.hips.position.y)).toBe(true); model.destroy(); }
  });

  it('lets the cross-fade into a wind-up be short, and keeps it unchanged for everything else', () => {
    expect(blendSecondsFor(ACTION_CONTACT_TICKS.pass)).toBeLessThan(0.04);
    expect(blendSecondsFor(ACTION_CONTACT_TICKS['bicycle-kick'])).toBeLessThanOrEqual(0.06);
    expect(blendSecondsFor(undefined)).toBe(0.14);
    expect(blendSecondsFor(0)).toBe(0.14);
  });

  it('kicks with the foot the simulation names, else the foot on the ball side, else the strong foot', () => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('foot'), kit, 7, false, false);
    const state = { ...baseState(), actionStartedTick: 100 };
    expect(kickingFoot(model, state)).toBe('right');
    expect(kickingFoot(model, { ...state, contact: { tick: 103, x: 0, y: 0.6, z: 0.11, kind: 'foot', foot: 'left' } })).toBe('left');
    // A contact that belongs to an earlier action does not decide.
    expect(kickingFoot(model, { ...state, contact: { tick: 40, x: 0, y: 0.6, z: 0.11, kind: 'foot', foot: 'left' } })).toBe('right');
    // The ball clearly on his left (+x when facing +y is to the right of travel, so check both sides produce different feet).
    const left = kickingFoot(model, state, { x: 0.8, y: 0.5 }), right = kickingFoot(model, state, { x: -0.8, y: 0.5 });
    expect(left).not.toBe(right);
    model.destroy();
  });
});

describe('Presentation 3b – limping after an injury', () => {
  const gait = (limp: number, distance: number) => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('limp'), kit, 7);
    const state = { ...baseState(), action: 'jog' as const, vy: 3, animationDistance: distance };
    poseFootballer(model, state, 100, 1, true, 0, undefined, limp);
    return model;
  };

  it('drops the body onto the hurt leg and drags it, and still plants the foot on the turf', () => {
    // Over a whole step the hurt leg's foot is lifted less than the healthy one's; the hips dip when it carries the weight.
    let hurtLift = 0, healthyLift = 0, lowestHips = Infinity, lowestFit = Infinity;
    for (let i = 0; i < 40; i++) {
      const fit = gait(0, i * 0.12), hurt = gait(1, i * 0.12);
      const reference = hurtLeg(hurt);
      const healthy = reference === 'left' ? 'right' : 'left';
      hurtLift = Math.max(hurtLift, footWorld(hurt, reference).y);
      healthyLift = Math.max(healthyLift, footWorld(hurt, healthy).y);
      lowestHips = Math.min(lowestHips, hurt.joints.hips.position.y);
      lowestFit = Math.min(lowestFit, fit.joints.hips.position.y);
      fit.destroy(); hurt.destroy();
    }
    expect(hurtLift).toBeLessThan(healthyLift * 0.7);
    expect(lowestHips).toBeLessThan(lowestFit - 0.03);
    const model = createProceduralFootballer(createPlayerVisualIdentity('limp-slide'), kit, 7);
    expect(measureFootSlide(model, baseState(), 3, 0.05, 120, 1)).toBeLessThan(0.03);
    model.destroy();
  }, 30_000);

  it('is only a function of the render flag: the simulated state is not touched and the same input gives the same pose', () => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('limp-pure'), kit, 7);
    const state = { ...baseState(), action: 'jog' as const, vy: 3, animationDistance: 2 };
    const before = JSON.stringify(state);
    poseFootballer(model, state, 100, 1, true, 0, undefined, 1);
    const first = model.joints.hips.position.y;
    poseFootballer(model, state, 100, 1, true, 0, undefined, 1);
    expect(model.joints.hips.position.y).toBeCloseTo(first, 6);
    expect(JSON.stringify(state)).toBe(before);
    // A limp flag never affects a kick or a dive.
    const kick = pose('shot', 8), limpKick = createProceduralFootballer(createPlayerVisualIdentity('pose-v3b'), kit, 7);
    poseFootballer(limpKick, { ...baseState(), action: 'shot', actionStartedTick: 100 }, 108, 1, true, 0, undefined, 1);
    expect(limpKick.joints.rightThigh.rotation.x).toBeCloseTo(kick.joints.rightThigh.rotation.x, 6);
    kick.destroy(); limpKick.destroy(); model.destroy();
  });

  it('puts the load on the hurt leg only while it is in stance', () => {
    expect(limpLoad(0.125, 0)).toBeGreaterThan(0.9);
    expect(limpLoad(0.6, 0)).toBe(0);
    expect(limpLoad(0.125 + 0.5, 0.5)).toBeGreaterThan(0.9);
  });
});

describe('Presentation 3b – all 128 identities have a sound rig', () => {
  it('has normalised weights and finite vertices on every figure, and no torn joints in an extreme pose', () => {
    let worst = 1;
    for (let seed = 0; seed < 128; seed++) {
      const model = createProceduralFootballer(createPlayerVisualIdentity(`studio-${seed}`), kit, seed % 99 + 1, false, false, true);
      const weights = checkWeights(model);
      expect(weights.vertices).toBeGreaterThan(500);
      expect(weights.badWeights).toBe(0);
      expect(weights.invalid).toBe(0);
      const base = baseState();
      for (const action of ['bicycle-kick', 'flying-header', 'slide'] as const) {
        // Posed twice, a moment apart: the first call only starts the cross-fade from the previous pose.
        const posed = checkPose(model, () => { const state = { ...base, action, actionStartedTick: 80 }, tick = action === 'slide' ? 95 : action === 'flying-header' ? 92 : 90; poseFootballer(model, state, tick, 1, true); poseFootballer(model, state, tick, 3, true); });
        expect(Number.isFinite(posed.maxStretch)).toBe(true);
        expect(posed.maxExtent).toBeLessThan(3);
        worst = Math.max(worst, posed.maxStretch);
        // Legs that swing far apart pull the crotch edges long; the limit catches tearing and exploding vertices, not that.
        expect(posed.maxStretch, `identity ${seed + 1}, ${action}`).toBeLessThan(4.6);
      }
      model.destroy();
    }
    expect(worst).toBeGreaterThan(1);
  }, 60_000);
});
