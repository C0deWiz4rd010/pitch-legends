import { ArcadeMatch, MATCH_TICK } from './core/services/arcade-match';
import { createNewGame } from './data/generators';
import { EMPTY_MATCH_COMMAND, MatchCommand, MatchConfig } from './models/match.model';
import { smallSidedTeam } from './core/football/small-sided';

/**
 * Golden state hashes: a refactor of the engine must not change a single bit of the simulation.
 * A deliberate gameplay change updates the table below in the same commit (the failure prints the new values).
 */
const GOLDEN: Record<string, string> = {
  'auto-101': '3caa9eb7',
  'auto-202': '6b118819',
  'auto-303': '5b196006',
  'auto-404': 'e60b4107',
  'auto-505': 'ae6d1b73',
  'auto-606': 'b8dbbba9',
  'auto-easy': '25a1ba4d',
  'auto-hard': '4983576f',
  'auto-no-effects': '708c3546',
  'auto-rain': '9f540326',
  'auto-small': '317a7c2b',
  'auto-snow': 'bbe0e575',
  'play-assisted': '14fe71e6',
  'play-balanced': '46d7089b',
  'play-manual': '710e47bf',
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
