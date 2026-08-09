import { createNewGame } from './data/generators';
import { ArcadeMatch } from './core/services/arcade-match';
import { MatchConfig, PlayerActionState } from './models/match.model';
import {
  animationFrameFor,
  PLAYER_ACTION_FRAME_COUNTS,
  PLAYER_SPRITE_CACHE_LIMIT,
  PLAYER_SPRITE_HEIGHT,
  PLAYER_SPRITE_WIDTH,
} from './features/match/player-sprite.factory';

const ACTIONS: PlayerActionState[] = [
  'formation', 'idle', 'jog', 'sprint', 'carry', 'close-control', 'receive', 'heavy-touch',
  'pass', 'through-pass', 'lob', 'shot', 'low-shot', 'finesse-shot', 'chip-shot', 'header',
  'ball-roll', 'drag-back', 'skill-failed', 'press', 'support-press', 'standing-tackle', 'slide',
  'stumble', 'injured', 'celebrate', 'keeper-ready', 'keeper-rush', 'keeper-catch', 'keeper-parry',
  'keeper-dive', 'keeper-throw', 'keeper-kick', 'subbed-on',
];

describe('Player sprites V2', () => {
  it('defines an explicit multi-frame animation for every runtime action', () => {
    expect(Object.keys(PLAYER_ACTION_FRAME_COUNTS).sort()).toEqual([...ACTIONS].sort());
    for (const action of ACTIONS) expect(PLAYER_ACTION_FRAME_COUNTS[action]).toBeGreaterThanOrEqual(3);
    expect(PLAYER_ACTION_FRAME_COUNTS.sprint).toBe(8);
    expect(PLAYER_ACTION_FRAME_COUNTS.jog).toBe(6);
    expect(PLAYER_ACTION_FRAME_COUNTS['keeper-dive']).toBe(8);
  });

  it('uses travelled distance for locomotion and clamps one-shot animations', () => {
    expect(animationFrameFor('sprint', 0, 8, 0)).toBe(0);
    expect(animationFrameFor('sprint', 0, 8, 0.4)).not.toBe(0);
    expect(animationFrameFor('sprint', 120, 8, 0.4)).toBe(animationFrameFor('sprint', 0, 8, 0.4));
    expect(animationFrameFor('shot', 999, 0, 0)).toBe(PLAYER_ACTION_FRAME_COUNTS.shot - 1);
  });

  it('keeps presentation distance out of the deterministic simulation hash', () => {
    const game = createNewGame({ managerName: 'Sprite', clubName: 'Sprite FC', seed: 1501 });
    const [home, away] = game.teams;
    const config: MatchConfig = {
      mode: 'coach', controllerMode: 'auto', seed: 1502, fixtureId: 'sprite-hash', controlledTeamId: home.id,
      halfMinutes: 3, difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'ai',
      camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
    };
    const match = new ArcadeMatch(home, away, config);
    const before = match.stateHash();
    match.actors[0].animationDistance += 999;
    expect(match.stateHash()).toBe(before);
  });

  it('uses the planned 40 by 48 frame and bounded cache budget', () => {
    expect(PLAYER_SPRITE_WIDTH).toBe(40);
    expect(PLAYER_SPRITE_HEIGHT).toBe(48);
    expect(PLAYER_SPRITE_CACHE_LIMIT).toBe(896);
    expect(PLAYER_SPRITE_WIDTH * PLAYER_SPRITE_HEIGHT * 4 * PLAYER_SPRITE_CACHE_LIMIT).toBeLessThan(7_000_000);
  });
});
