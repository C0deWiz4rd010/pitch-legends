import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { celebrationVariant, createProceduralFootballer, poseFootballer } from './features/match/three-player.factory';
import { replayPlayback } from './features/match/replay-playback';
import { CAMERA_PRESETS } from './features/match/three-pitch.renderer';

function figure(seedIndex = 0) {
  const { home, away } = createPracticeTeams();
  const player = home.players[seedIndex];
  const model = createProceduralFootballer(player.visuals, home.visuals.kits.home, player.kitNumber, false, false, false, player.lastName);
  const state = new ArcadeMatch(home, away, home.id).snapshot().players[0];
  Object.assign(state, { x: 0, y: 0, vx: 0, vy: 0, facingX: 0, facingY: 1, action: 'idle', actionStartedTick: 0 });
  return { model, state };
}
function pose(model: ReturnType<typeof figure>['model']) {
  return Object.values(model.joints).map(joint => joint.quaternion.clone());
}

describe('Presentation 2', () => {
  it('slows the replay towards the finish and ends exactly once', () => {
    const start = replayPlayback(360, 0.5, false);
    const late = replayPlayback(360, 7.5, false);
    expect(start.cursor).toBeCloseTo(0.5 * 60 * 0.65, 5);
    const lateStep = replayPlayback(360, 7.6, false).cursor - late.cursor;
    expect(lateStep).toBeCloseTo(0.1 * 60 * 0.3, 5);
    expect(replayPlayback(360, 60, false)).toEqual({ cursor: 359, done: true });
    const reduced = replayPlayback(360, 2, true);
    expect(reduced.cursor).toBeCloseTo(2 * 60 * 0.65, 5);
  });

  it('offers three genuinely different broadcast angles', () => {
    expect(CAMERA_PRESETS.tv.pitch).toBeLessThan(CAMERA_PRESETS.arcade.pitch);
    expect(CAMERA_PRESETS.tactic.pitch).toBeGreaterThan(CAMERA_PRESETS.arcade.pitch + 20);
    expect(CAMERA_PRESETS.tactic.width).toBeGreaterThan(CAMERA_PRESETS.arcade.width);
  });

  it('cross-fades a new action from the last shown pose and settles on it', () => {
    const { model, state } = figure();
    poseFootballer(model, state, 0, 1.0, true);
    const idle = pose(model);
    Object.assign(state, { action: 'standing-tackle', actionStartedTick: 0 });
    poseFootballer(model, state, 5, 1.0, true);
    pose(model).forEach((q, i) => expect(q.angleTo(idle[i])).toBeLessThan(1e-6));
    poseFootballer(model, state, 6, 1.07, true);
    const midway = pose(model);
    poseFootballer(model, state, 6, 1.3, true);
    const settled = pose(model);
    const fresh = figure();
    Object.assign(fresh.state, { action: 'standing-tackle', actionStartedTick: 0 });
    poseFootballer(fresh.model, fresh.state, 6, 5, true);
    pose(fresh.model).forEach((q, i) => expect(q.angleTo(settled[i])).toBeLessThan(1e-5));
    expect(midway.some((q, i) => q.angleTo(idle[i]) > 1e-3 && q.angleTo(settled[i]) > 1e-3)).toBe(true);
    model.destroy(); fresh.model.destroy();
  });

  it('turns the head towards the ball and leans into turns', () => {
    const { model, state } = figure();
    poseFootballer(model, state, 0, 0, true, 0, { x: 5, y: 1 });
    expect(Math.abs(model.joints.head.rotation.y)).toBeGreaterThan(0.4);
    Object.assign(state, { action: 'sprint', vx: 0, vy: 8 });
    const running = figure(1);
    Object.assign(running.state, { action: 'sprint', vx: 0, vy: 8 });
    for (let i = 0; i < 12; i++) {
      const angle = i * 0.08;
      Object.assign(running.state, { facingX: Math.sin(angle), facingY: Math.cos(angle), vx: Math.sin(angle) * 8, vy: Math.cos(angle) * 8 });
      poseFootballer(running.model, running.state, i, i / 60, false);
    }
    expect(Math.abs(running.model.joints.hips.rotation.z)).toBeGreaterThan(0.02);
    model.destroy(); running.model.destroy();
  });

  it('spreads five celebrations across players deterministically', () => {
    const { home } = createPracticeTeams();
    const variants = new Set(home.players.map(player => celebrationVariant(createProceduralFootballer(player.visuals, home.visuals.kits.home, 1, false, false, true))));
    expect(variants.size).toBeGreaterThanOrEqual(3);
    for (const variant of variants) expect(variant).toBeLessThan(5);
  });
});
