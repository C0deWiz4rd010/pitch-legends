import * as THREE from 'three';
import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createNewGame } from './data/generators';
import { EMPTY_MATCH_COMMAND } from './models/match.model';
import { BallPart, ballPanels, createBallMesh, paintBall } from './features/match/ball-mesh';
import { MATE_ARROW_RANGE, edgeMarker, groundView } from './features/match/three-pitch.renderer';

function humanMatch(seed: number): ArcadeMatch {
  const game = createNewGame({ managerName: 'Read', clubName: 'Read FC', seed: 77 });
  const [home, away] = game.teams;
  return new ArcadeMatch(home, away, {
    mode: 'play', controllerMode: 'human', seed, fixtureId: `read-${seed}`, controlledTeamId: home.id, halfMinutes: 3,
    difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'keyboard',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
  });
}

describe('Readability (V3)', () => {
  it('builds a football from twelve pentagons and twenty hexagons', () => {
    const panels = ballPanels();
    expect(panels.filter((panel) => panel.pentagon).length).toBe(12);
    expect(panels.filter((panel) => !panel.pentagon).length).toBe(20);
    for (const panel of panels) {
      expect(panel.corners.length).toBe(panel.pentagon ? 5 : 6);
      // Every corner lies on the unit sphere and all edges of the ball have the same length.
      for (let i = 0; i < panel.corners.length; i++) {
        const a = panel.corners[i], b = panel.corners[(i + 1) % panel.corners.length];
        expect(Math.hypot(...a)).toBeCloseTo(1, 6);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(0.4035, 3);
      }
    }
  });

  it('puts every vertex of the ball on its sphere, facing outwards, and repaints the panels', () => {
    const ball = createBallMesh(0.11);
    const position = ball.geometry.getAttribute('position'), color = ball.geometry.getAttribute('color');
    expect(position.count).toBe(ball.parts.length * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let triangle = 0; triangle < ball.parts.length; triangle++) {
      a.fromBufferAttribute(position, triangle * 3); b.fromBufferAttribute(position, triangle * 3 + 1); c.fromBufferAttribute(position, triangle * 3 + 2);
      expect(a.length()).toBeCloseTo(0.11, 5);
      // Counter-clockwise from outside: the face normal points away from the centre.
      expect(b.clone().sub(a).cross(c.clone().sub(a)).dot(a)).toBeGreaterThan(0);
    }
    const parts = new Set(ball.parts);
    expect(parts.has(BallPart.Body) && parts.has(BallPart.Panel) && parts.has(BallPart.Seam)).toBe(true);
    paintBall(ball, '#ff0000', '#0000ff');
    const panel = ball.parts.indexOf(BallPart.Panel), body = ball.parts.indexOf(BallPart.Body);
    expect(color.getX(panel * 3)).toBeCloseTo(1, 5);
    expect(color.getZ(panel * 3)).toBeCloseTo(0, 5);
    expect(color.getZ(body * 3)).toBeCloseTo(1, 5);
  });

  it('marks a point outside the picture on the edge it left through', () => {
    expect(edgeMarker(0.4, -0.9, false)).toBeNull();
    const right = edgeMarker(2, 0.5, false)!;
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.y).toBeCloseTo(0.25, 6);
    expect(Math.cos(right.angle)).toBeGreaterThan(0.9);
    const top = edgeMarker(-0.3, 3, false)!;
    expect(top.y).toBeCloseTo(1, 6);
    // Behind the camera the projection is mirrored: a point that seems up and right is really down and left.
    const behind = edgeMarker(0.5, 0.2, true)!;
    expect(behind.x).toBeCloseTo(-1, 6);
    expect(behind.y).toBeLessThan(0);
    expect(MATE_ARROW_RANGE).toBeGreaterThan(20);
  });

  it('outlines the grass the camera sees', () => {
    const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 300);
    camera.position.set(10, 30, 40);
    camera.lookAt(10, 0, 0);
    camera.updateMatrixWorld();
    const view = groundView(camera);
    // Bottom edge nearer to the camera and narrower than the top edge; symmetric about the camera's x.
    expect(view[1]).toBeGreaterThan(view[7]);
    expect(view[2] - view[0]).toBeLessThan(view[4] - view[6]);
    expect((view[0] + view[2]) / 2).toBeCloseTo(10, 4);
    expect(view[3]).toBeCloseTo(view[1], 4);
    // A camera that looks at the horizon gets a far, but finite, outline.
    camera.position.set(0, 2, 40); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
    for (const value of groundView(camera)) expect(Number.isFinite(value)).toBe(true);
  });

  it('names the player the switch button takes next, without changing the match', () => {
    const match = humanMatch(5);
    for (let tick = 0; tick < 240; tick++) match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    for (let round = 0; round < 6; round++) {
      const before = match.stateHash();
      const target = match.switchTarget();
      expect(match.stateHash()).toBe(before);
      expect(target).not.toBe(match.selectedPlayerId);
      // Press and release the button; give up the round if the automatic selection got in first.
      const selected = match.selectedPlayerId;
      match.step(MATCH_TICK, { ...EMPTY_MATCH_COMMAND, switchPlayer: true });
      if (target && match.selectedPlayerId !== selected) expect(match.actors.find((actor) => actor.player.id === match.selectedPlayerId)!.side).toBe(match.controlledSide);
      for (let tick = 0; tick < 100; tick++) match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
    }
    const locked = humanMatch(6);
    locked.config.playerLockId = locked.selectedPlayerId;
    expect(locked.switchTarget()).toBeNull();
  });
});
