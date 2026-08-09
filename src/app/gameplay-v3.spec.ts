import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { MATCH_CHECKPOINT_KEY, MatchCheckpointService } from './core/services/match-checkpoint.service';
import { createNewGame } from './data/generators';
import { EMPTY_MATCH_COMMAND, MatchCommand, MatchConfig } from './models/match.model';

function config(teamId: string, mode: MatchConfig['mode'] = 'coach', seed = 20260809): MatchConfig {
  return {
    mode,
    controllerMode: mode === 'play' ? 'human' : 'auto',
    seed,
    fixtureId: 'fixture-v3-test',
    controlledTeamId: teamId,
    halfMinutes: 3,
    difficulty: 'normal',
    assist: 'balanced',
    playerLockId: null,
    weather: 'clear',
    inputDevice: mode === 'play' ? 'keyboard' : 'ai',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
  };
}

function advance(match: ArcadeMatch, ticks: number, command: MatchCommand = EMPTY_MATCH_COMMAND): void {
  for (let tick = 0; tick < ticks && !match.finished; tick++) {
    if (match.phase === 'halftime') match.resumeSecondHalf();
    if (match.phase === 'goalReplay') match.endReplay();
    match.step(MATCH_TICK, command);
  }
}

describe('Gameplay V3 match contracts', () => {
  it('produces an identical state hash for the same seed and command stream', () => {
    const game = createNewGame({ managerName: 'Hash', clubName: 'Hash FC', seed: 81 });
    const [home, away] = game.teams;
    const first = new ArcadeMatch(home, away, config(home.id, 'play'));
    const second = new ArcadeMatch(home, away, config(home.id, 'play'));

    for (let tick = 0; tick < 900; tick++) {
      const command: MatchCommand = {
        ...EMPTY_MATCH_COMMAND,
        moveX: tick % 240 < 120 ? 1 : 0.35,
        moveY: tick % 180 < 90 ? 0.2 : -0.3,
        aimX: 1,
        aimY: tick % 300 < 150 ? -0.2 : 0.2,
        sprint: tick % 120 < 34,
        pass: tick % 210 >= 32 && tick % 210 < 40,
        shoot: tick % 480 >= 250 && tick % 480 < 260,
        device: 'keyboard',
      };
      first.step(MATCH_TICK, command);
      second.step(MATCH_TICK, command);
      if (first.phase === 'goalReplay') first.endReplay();
      if (second.phase === 'goalReplay') second.endReplay();
    }

    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('round-trips every state needed for deterministic checkpoint resume', () => {
    const game = createNewGame({ managerName: 'Resume', clubName: 'Resume FC', seed: 82 });
    const [home, away] = game.teams;
    const settings = config(home.id, 'coach', 991);
    const uninterrupted = new ArcadeMatch(home, away, settings);
    advance(uninterrupted, 780);
    const checkpoint = uninterrupted.checkpoint();
    const resumed = new ArcadeMatch(home, away, settings);

    expect(resumed.restore(checkpoint)).toBe(true);
    advance(uninterrupted, 900);
    advance(resumed, 900);

    expect(resumed.stateHash()).toBe(uninterrupted.stateHash());
    expect(resumed.homeStats).toEqual(uninterrupted.homeStats);
    expect(resumed.awayStats).toEqual(uninterrupted.awayStats);
  });

  it('ignores every human gameplay command while live AUTO is active', () => {
    const game = createNewGame({ managerName: 'Auto', clubName: 'Auto Athletic', seed: 182 });
    const [home, away] = game.teams;
    const withInput = new ArcadeMatch(home, away, config(home.id, 'play', 7781));
    const withoutInput = new ArcadeMatch(home, away, config(home.id, 'play', 7781));
    withInput.setControllerMode('auto');
    withoutInput.setControllerMode('auto');

    for (let tick = 0; tick < 720; tick++) {
      withInput.step(MATCH_TICK, {
        ...EMPTY_MATCH_COMMAND,
        moveX: 1,
        aimX: 1,
        sprint: true,
        pass: tick % 90 < 30,
        shoot: tick % 210 < 45,
        device: 'keyboard',
      });
      withoutInput.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    }

    expect(withInput.stateHash()).toBe(withoutInput.stateHash());
  });

  it('switches live control without changing clock or physics and persists AUTO in checkpoints', () => {
    const game = createNewGame({ managerName: 'Toggle', clubName: 'Toggle Town', seed: 183 });
    const [home, away] = game.teams;
    const match = new ArcadeMatch(home, away, config(home.id, 'play', 7782));
    advance(match, 180);
    const before = match.snapshot();

    match.setControllerMode('auto');
    expect(match.tick).toBe(before.tick);
    expect(match.elapsed).toBe(before.elapsed);
    expect(match.ball).toMatchObject(before.ball);
    const checkpoint = match.checkpoint();
    expect(checkpoint.version).toBe(2);
    expect(checkpoint.controllerMode).toBe('auto');

    const resumed = new ArcadeMatch(home, away, checkpoint.config);
    expect(resumed.restore(checkpoint)).toBe(true);
    expect(resumed.controllerMode).toBe('auto');
    expect(resumed.controllerChangedAtTick).toBe(match.controllerChangedAtTick);
    expect(resumed.stateHash()).toBe(match.stateHash());

    resumed.setControllerMode('human');
    expect(resumed.controllerMode).toBe('human');
    expect(resumed.tick).toBe(match.tick);
    expect(resumed.snapshot().ball).toEqual(match.snapshot().ball);
  });

  it('migrates a V1 checkpoint to the controller-aware V2 format', () => {
    const game = createNewGame({ managerName: 'Legacy Auto', clubName: 'Checkpoint FC', seed: 184 });
    const [home, away] = game.teams;
    const match = new ArcadeMatch(home, away, config(home.id, 'coach', 7783));
    const legacy = match.checkpoint() as any;
    legacy.version = 1;
    delete legacy.controllerMode;
    delete legacy.controllerChangedAtTick;
    delete legacy.config.controllerMode;
    localStorage.setItem('pitch-legends:match-checkpoint:v1', JSON.stringify(legacy));

    const service = new MatchCheckpointService();
    const migrated = service.load(legacy.fixtureId);

    expect(migrated?.version).toBe(2);
    expect(migrated?.controllerMode).toBe('auto');
    expect(migrated?.config.controllerMode).toBe('auto');
    expect(localStorage.getItem(MATCH_CHECKPOINT_KEY)).toBeTruthy();
    service.clear();
  });

  it('keeps coach and headless modes equivalent when they receive AI commands', () => {
    const game = createNewGame({ managerName: 'Modes', clubName: 'Modes FC', seed: 83 });
    const [home, away] = game.teams;
    const coach = new ArcadeMatch(home, away, config(home.id, 'coach', 441));
    const headless = new ArcadeMatch(home, away, config(home.id, 'instant', 441));
    // A short deterministic fixture exercises both halves without slowing the suite.
    (coach as unknown as { totalSeconds: number }).totalSeconds = 5;
    (headless as unknown as { totalSeconds: number }).totalSeconds = 5;
    coach.simulateToEnd();
    headless.simulateToEnd();

    const coachResult = coach.result();
    const headlessResult = headless.result();
    expect({ home: coachResult.homeScore, away: coachResult.awayScore, events: coachResult.events, stats: [coachResult.homeStats, coachResult.awayStats] }).toEqual({
      home: headlessResult.homeScore,
      away: headlessResult.awayScore,
      events: headlessResult.events,
      stats: [headlessResult.homeStats, headlessResult.awayStats],
    });
  });

  it('switches world sides at halftime while the controlled screen direction remains representable', () => {
    const game = createNewGame({ managerName: 'Sides', clubName: 'Sides FC', seed: 84 });
    const [home, away] = game.teams;
    const match = new ArcadeMatch(home, away, config(away.id, 'coach', 77));
    const firstHalfDirection = match.currentAttackDirection;
    (match as unknown as { totalSeconds: number }).totalSeconds = 1;
    for (let tick = 0; tick < 80 && match.phase !== 'halftime'; tick++) match.step(MATCH_TICK);

    expect(match.phase).toBe('halftime');
    expect(match.currentAttackDirection).toBe(-firstHalfDirection);
    match.resumeSecondHalf();
    expect(match.half).toBe(2);
  });

  it('keeps airborne and rolling ball state finite and inside numerical bounds', () => {
    const game = createNewGame({ managerName: 'Physics', clubName: 'Physics FC', seed: 85 });
    const [home, away] = game.teams;
    const match = new ArcadeMatch(home, away, config(home.id, 'coach', 123));
    advance(match, 40);
    Object.assign(match.ball, { ownerId: null, x: 52.5, y: 34, z: 1, vx: 18, vy: 3, vz: 7, spin: 4 });
    advance(match, 180);

    expect([match.ball.x, match.ball.y, match.ball.z, match.ball.vx, match.ball.vy, match.ball.vz].every(Number.isFinite)).toBe(true);
    expect(match.ball.z).toBeGreaterThanOrEqual(0);
  });

  it('serializes a stable RNG state and complete 22-player snapshot', () => {
    const game = createNewGame({ managerName: 'Contract', clubName: 'Contract FC', seed: 86 });
    const [home, away] = game.teams;
    const match = new ArcadeMatch(home, away, config(home.id, 'coach', 555));
    advance(match, 120);
    const checkpoint = match.checkpoint();

    expect(checkpoint.version).toBe(2);
    expect(checkpoint.actors).toHaveLength(22);
    expect(checkpoint.actors.every((actor) => Number.isFinite(actor.decisionCooldown) && Number.isFinite(actor.intentX))).toBe(true);
    expect(checkpoint.runtime.passAttempts).toEqual({ home: match.homeStats.passesAttempted, away: match.awayStats.passesAttempted });
  });
});
