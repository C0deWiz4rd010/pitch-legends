import { Vector3 } from 'three';
import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { MatchMetrics } from './core/football/match-metrics';
import { TickInputBuffer } from './core/football/tick-input';
import { createNewGame } from './data/generators';
import { createClubVisualIdentity, createPlayerVisualIdentity } from './core/visual-identity';
import { EMPTY_MATCH_COMMAND, MatchConfig, MatchSnapshot } from './models/match.model';
import { interpolateThreeFrame, interpolateThreeReplay, playerInCameraSpace, RenderInterpolationScratch } from './features/match/three-render-state';
import { createProceduralFootballer } from './features/match/three-player.factory';

function config(teamId: string, seed: number): MatchConfig {
  return {
    mode: 'play', controllerMode: 'human', seed, fixtureId: 'fixture-phase0', controlledTeamId: teamId, halfMinutes: 3,
    difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'keyboard',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
  };
}

function newMatch(seed: number): ArcadeMatch {
  const game = createNewGame({ managerName: 'Fluid', clubName: 'Fluid FC', seed });
  const [home, away] = game.teams;
  return new ArcadeMatch(home, away, config(home.id, seed + 1));
}

describe('Phase 0 – fluid rendering', () => {
  it('keeps the teleport epoch steady in open play and bumps it when pieces are placed', () => {
    const match = newMatch(901);
    const first = match.renderState().teleportEpoch;
    for (let tick = 0; tick < 120; tick++) match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, moveX: 1, aimX: 1, device: 'keyboard' });
    expect(match.renderState().teleportEpoch).toBe(first);

    const before = match.renderState();
    (match as unknown as { setRestart: (phase: string, side: string, x: number, y: number) => void }).setRestart('throwIn', 'home', 20, 0);
    const after = match.renderState();
    expect(after.teleportEpoch).toBeGreaterThan(before.teleportEpoch);
    // Across the placement the renderer shows the new state as it is instead of sweeping the ball over the pitch.
    expect(interpolateThreeFrame({ previous: before, current: after, alpha: 0.5, deltaSeconds: 1 / 60 })).toBe(after);
  });

  it('keeps interpolating through harmless rule changes', () => {
    const match = newMatch(902);
    for (let tick = 0; tick < 30; tick++) match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    const previous = match.renderState();
    const current = match.renderState();
    current.tick += 1;
    current.ball.x += 0.2;
    const mid = interpolateThreeFrame({ previous, current, alpha: 0.5, deltaSeconds: 1 / 60 });
    expect(mid).not.toBe(current);
    expect(mid.ball.x).toBeCloseTo(previous.ball.x + 0.1, 8);
  });

  it('interpolates replays into reusable scratch objects without touching the source frames', () => {
    const match = newMatch(903);
    for (let tick = 0; tick < 20; tick++) match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    const previous: MatchSnapshot = match.snapshot();
    match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    const current: MatchSnapshot = match.snapshot();
    current.ball.x = previous.ball.x + 1;
    current.ball.y = previous.ball.y;
    const originalX = current.ball.x;
    const scratch: RenderInterpolationScratch = { players: [], owned: [] };
    const a = interpolateThreeReplay(previous, current, 0.25, scratch);
    const b = interpolateThreeReplay(previous, current, 0.75, scratch);
    expect(b).toBe(a);
    expect(b.ball.x).toBeCloseTo(previous.ball.x + 0.75, 8);
    expect(current.ball.x).toBe(originalX);
    expect(b.tick).toBeCloseTo(previous.tick + 0.75 * (current.tick - previous.tick), 8);
  });

  it('mirrors targets and contacts for the far-side camera without changing the source player', () => {
    const match = newMatch(904);
    const source = { ...match.renderState().players[0], actionTarget: { x: 10, y: 2, z: 1 }, contact: { tick: 5, x: 12, y: 3, z: 0.1, kind: 'foot' as const, foot: 'right' as const } };
    const scratch = { ...source };
    const mirrored = playerInCameraSpace(source, -1, scratch);
    expect(mirrored.actionTarget!.x).toBe(-10);
    expect(mirrored.contact!.x).toBe(-12);
    expect(source.actionTarget.x).toBe(10);
    expect(source.contact.x).toBe(12);
    // Pooled holders are reused with a scratch, fresh clones are returned without one.
    expect(playerInCameraSpace(source, -1, scratch).contact).toBe(mirrored.contact);
    expect(playerInCameraSpace(source, -1).contact).not.toBe(mirrored.contact);
  });

  it('shares vertices of the footballer geometry through an index', () => {
    const kit = createClubVisualIdentity('Test', 'TST', '#18bb99', '#102844', 3).kits.home;
    const model = createProceduralFootballer(createPlayerVisualIdentity('indexed'), kit, 10);
    const geometry = model.mesh.geometry;
    expect(geometry.index).not.toBeNull();
    const triangles = geometry.index!.count / 3;
    expect(geometry.getAttribute('position').count).toBeLessThan(triangles * 3);
    expect(geometry.getAttribute('skinIndex').count).toBe(geometry.getAttribute('position').count);
    model.destroy();
  });
});

describe('Phase 0 – metrics', () => {
  it('reports percentiles and keeps only the latest 3600 samples', () => {
    const metrics = new MatchMetrics();
    for (let i = 1; i <= 4000; i++) metrics.record(i, 1, 2, i % 2 ? NaN : 20 + (i % 100));
    const summary = metrics.summary();
    expect(summary.samples).toBe(3600);
    // Samples 401..4000 remain.
    expect(summary.frameMedian).toBeGreaterThan(2000);
    expect(summary.frameP99).toBeGreaterThan(summary.frameP95);
    expect(summary.simulationP95).toBe(1);
    expect(summary.renderP95).toBe(2);
    expect(summary.inputSamples).toBe(1800);
    expect(summary.inputLatencyP95).toBeGreaterThanOrEqual(110);
  });

  it('measures input latency from the oldest consumed button edge', () => {
    const buffer = new TickInputBuffer();
    buffer.set('key-j', 'pass', true, 100);
    buffer.set('key-l', 'shoot', true, 104);
    // Both edges are consumed by the same tick; the older one defines the latency.
    buffer.consume(EMPTY_MATCH_COMMAND, 110);
    expect(buffer.takeConsumedAt()).toBe(100);
    expect(buffer.takeConsumedAt()).toBeNull();
    buffer.set('key-j', 'pass', false, 130);
    buffer.consume(EMPTY_MATCH_COMMAND, 140);
    expect(buffer.takeConsumedAt()).toBe(130);
  });

  it('reports no latency when no button changed', () => {
    const buffer = new TickInputBuffer();
    buffer.consume(EMPTY_MATCH_COMMAND, 10);
    expect(buffer.takeConsumedAt()).toBeNull();
    expect(new Vector3().length()).toBe(0);
  });
});
