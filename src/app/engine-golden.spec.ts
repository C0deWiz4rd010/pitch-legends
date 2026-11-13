import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createNewGame } from './data/generators';
import { EMPTY_MATCH_COMMAND, MatchCommand, MatchConfig } from './models/match.model';
import { smallSidedTeam } from './core/football/small-sided';

/**
 * Golden state hashes: a refactor of the engine must not change a single bit of the simulation.
 * A deliberate gameplay change updates the table below in the same commit (the failure prints the new values).
 */
const GOLDEN: Record<string, string> = {
  'auto-101': '5848df03',
  'auto-202': '93724309',
  'auto-303': 'bf5faa2f',
  'auto-404': 'fdf6871d',
  'auto-505': 'b2d0730b',
  'auto-606': 'c6a91f17',
  'auto-easy': 'df1726df',
  'auto-hard': 'dc19de69',
  'auto-no-effects': '38c8a431',
  'auto-rain': '683342fc',
  'auto-small': '0531fa0a',
  'auto-snow': 'f1caf79c',
  'play-assisted': '6c1f09d1',
  'play-balanced': '3a54ee82',
  'play-manual': 'c88a81af',
};

type Case = { name: string; config: Partial<MatchConfig>; scripted?: boolean; smallSided?: boolean; ticks?: number };

const CASES: Case[] = [
  ...[101, 202, 303, 404, 505, 606].map((seed) => ({ name: `auto-${seed}`, config: { seed } })),
  { name: 'auto-easy', config: { seed: 707, difficulty: 'easy' } as Partial<MatchConfig> },
  { name: 'auto-hard', config: { seed: 808, difficulty: 'hard' } as Partial<MatchConfig> },
  { name: 'auto-rain', config: { seed: 909, weather: 'rain' } as Partial<MatchConfig> },
  { name: 'auto-snow', config: { seed: 1010, weather: 'snow' } as Partial<MatchConfig> },
  { name: 'auto-small', config: { seed: 1111, smallSided: true } as Partial<MatchConfig>, smallSided: true },
  { name: 'auto-no-effects', config: { seed: 1212, effects: false } as Partial<MatchConfig> },
  ...(['assisted', 'balanced', 'manual'] as const).map((assist, index) => ({
    name: `play-${assist}`, scripted: true, ticks: 9000,
    config: { seed: 1300 + index, mode: 'play', controllerMode: 'human', inputDevice: 'keyboard', assist } as Partial<MatchConfig>,
  })),
];

function scriptedCommand(tick: number): MatchCommand {
  return {
    ...EMPTY_MATCH_COMMAND,
    moveX: tick % 240 < 150 ? 1 : -0.4,
    moveY: tick % 180 < 90 ? 0.35 : -0.45,
    aimX: 1,
    aimY: tick % 300 < 150 ? -0.3 : 0.3,
    sprint: tick % 120 < 50,
    pass: tick % 210 >= 32 && tick % 210 < 38,
    through: tick % 530 >= 300 && tick % 530 < 306,
    lob: tick % 710 >= 400 && tick % 710 < 412,
    shoot: tick % 480 >= 250 && tick % 480 < 262,
    skill: tick % 390 >= 120 && tick % 390 < 124,
    modifier: tick % 900 >= 600 && tick % 900 < 700,
    device: 'keyboard',
  };
}

function run(test: Case): string {
  const game = createNewGame({ managerName: 'Golden', clubName: 'Golden FC', seed: 4711 });
  let [home, away] = game.teams;
  if (test.smallSided) { home = smallSidedTeam(home); away = smallSidedTeam(away); }
  const match = new ArcadeMatch(home, away, {
    mode: 'instant', controllerMode: 'auto', seed: 1, fixtureId: `golden-${test.name}`, controlledTeamId: home.id,
    halfMinutes: 3, difficulty: 'normal', assist: 'balanced', playerLockId: null, weather: 'clear', inputDevice: 'ai',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
    ...test.config,
  });
  const limit = test.ticks ?? 150_000;
  for (let tick = 0; tick < limit && !match.finished; tick++) {
    if (match.phase === 'halftime') match.resumeSecondHalf();
    if (match.phase === 'goalReplay') match.endReplay();
    match.step(MATCH_TICK, test.scripted ? scriptedCommand(tick) : EMPTY_MATCH_COMMAND);
  }
  return match.stateHash();
}

describe('Engine golden hashes', () => {
  it('keeps every reference match bit-identical', () => {
    const actual: Record<string, string> = {};
    for (const test of CASES) actual[test.name] = run(test);
    expect(actual).toEqual(GOLDEN);
  }, 120_000);
});
