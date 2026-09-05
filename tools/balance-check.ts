import { ArcadeMatch } from '../src/app/core/services/arcade-match';
import { createNewGame } from '../src/app/data/generators';
import { MatchConfig } from '../src/app/models/match.model';
import { Team } from '../src/app/models/team.model';

const count = Math.max(1, Number(process.argv[2]) || 500);
const source = createNewGame({ managerName: 'Balance', clubName: 'Balance FC', seed: 20_260_809 });
const home = structuredClone(source.teams[0]);
const away = cloneAsOpponent(home);
const started = performance.now();
let goals = 0;
let shots = 0;
let passAccuracy = 0;
let passAttempts = 0;
let passCompletions = 0;
let draws = 0;
let homeWins = 0;
let onTarget = 0;
let saves = 0;
let xG = 0;
let offsides = 0;
let shotDistance = 0;
let recordedShots = 0;

for (let index = 0; index < count; index++) {
  const config: MatchConfig = {
    mode: 'instant', controllerMode: 'auto', seed: 90_000 + index, fixtureId: `balance-${index}`,
    controlledTeamId: home.id, halfMinutes: 3, difficulty: 'normal', assist: 'balanced',
    playerLockId: null, weather: 'clear', inputDevice: 'ai',
    camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
  };
  const result = new ArcadeMatch(home, away, config).result();
  for (const event of result.events) if (event.type === 'shot' && typeof event.params?.['distance'] === 'number') { shotDistance += event.params['distance']; recordedShots++; }
  onTarget += result.homeStats.shotsOnTarget + result.awayStats.shotsOnTarget;
  saves += result.homeStats.saves + result.awayStats.saves;
  xG += result.homeStats.xG + result.awayStats.xG;
  offsides += result.homeStats.offsides + result.awayStats.offsides;
  goals += result.homeScore + result.awayScore;
  shots += result.homeStats.shots + result.awayStats.shots;
  passAccuracy += result.homeStats.passAccuracy + result.awayStats.passAccuracy;
  passAttempts += result.homeStats.passesAttempted + result.awayStats.passesAttempted;
  passCompletions += result.homeStats.passesCompleted + result.awayStats.passesCompleted;
  if (result.homeScore === result.awayScore) draws++;
  if (result.homeScore > result.awayScore) homeWins++;
}

const report = {
  seeds: count,
  averageGoals: round(goals / count),
  averageShotDistance: round(shotDistance / Math.max(1, recordedShots)),
  averageOnTarget: round(onTarget / count),
  averageSaves: round(saves / count),
  averageXG: round(xG / count),
  averageOffsides: round(offsides / count),
  averageShotsPerTeam: round(shots / count / 2),
  averagePassAccuracy: round(passAccuracy / count / 2),
  averagePassAttemptsPerTeam: round(passAttempts / count / 2),
  averagePassCompletionsPerTeam: round(passCompletions / count / 2),
  drawPercent: round(draws / count * 100),
  homeWinPercent: round(homeWins / count * 100),
  elapsedMs: Math.round(performance.now() - started),
  averageMatchMs: round((performance.now() - started) / count),
};

console.log(JSON.stringify(report, null, 2));

const failures = [
  inRange(report.averageGoals, 2.2, 3.4) ? '' : 'averageGoals must be 2.2-3.4',
  inRange(report.averageShotsPerTeam, 8, 18) ? '' : 'averageShotsPerTeam must be 8-18',
  inRange(report.averagePassAccuracy, 65, 88) ? '' : 'averagePassAccuracy must be 65-88',
  inRange(report.drawPercent, 20, 32) ? '' : 'drawPercent must be 20-32',
  inRange(report.homeWinPercent, 42, 52) ? '' : 'homeWinPercent must be 42-52',
  report.averageMatchMs <= 500 ? '' : 'averageMatchMs must be at most 500',
].filter(Boolean);
if (failures.length) {
  console.error(`Balance check failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}

function cloneAsOpponent(team: Team): Team {
  const opponent = structuredClone(team);
  opponent.id = `${team.id}-opponent`;
  opponent.name = 'Mirror Athletic';
  opponent.shortName = 'MIR';
  opponent.isPlayerControlled = false;
  const ids = new Map<string, string>();
  for (const player of opponent.players) {
    const oldId = player.id;
    player.id = `${oldId}-opponent`;
    ids.set(oldId, player.id);
  }
  for (const slot of opponent.formation.slots) if (slot.playerId) slot.playerId = ids.get(slot.playerId) ?? null;
  if (opponent.tactics.captainId) opponent.tactics.captainId = ids.get(opponent.tactics.captainId) ?? null;
  if (opponent.tactics.penaltyTakerId) opponent.tactics.penaltyTakerId = ids.get(opponent.tactics.penaltyTakerId) ?? null;
  if (opponent.tactics.freeKickTakerId) opponent.tactics.freeKickTakerId = ids.get(opponent.tactics.freeKickTakerId) ?? null;
  if (opponent.tactics.cornerTakerId) opponent.tactics.cornerTakerId = ids.get(opponent.tactics.cornerTakerId) ?? null;
  return opponent;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
