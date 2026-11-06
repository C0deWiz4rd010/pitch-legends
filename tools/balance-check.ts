import { ArcadeMatch } from '../src/app/core/services/arcade-match';
import { createNewGame } from '../src/app/data/generators';
import { EMPTY_MATCH_COMMAND, MatchConfig } from '../src/app/models/match.model';
import { MATCH_TICK } from '../src/app/core/football/match-types';
import { Team } from '../src/app/models/team.model';

const count = Math.max(1, Number(process.argv[2]) || 500);
// node tmp/balance-check.mjs 500 --effects off  ->  plain attributes, to compare with the effect pipeline
const effects = !process.argv.includes('--effects=off') && !(process.argv.includes('--effects') && process.argv[process.argv.indexOf('--effects') + 1] === 'off');
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
    playerLockId: null, weather: 'clear', effects, inputDevice: 'ai',
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
  effects,
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

// Tactic telemetry: the sliders must visibly move the team. Same squad, the home side changes one slider; the figures are
// sampled every half second over a few short matches. High pressing must close the ball carrier down sooner and push the
// team up the pitch, a wide set-up must spread the team across the pitch.
const telemetryMatches = Math.min(count, 12);
interface Telemetry { depth: number; pressGap: number; spread: number; samples: number }
function measure(change: (team: Team) => void): Telemetry {
  const side = structuredClone(home);
  change(side);
  const total: Telemetry = { depth: 0, pressGap: 0, spread: 0, samples: 0 };
  let pressSamples = 0;
  for (let index = 0; index < telemetryMatches; index++) {
    const config: MatchConfig = {
      mode: 'instant', controllerMode: 'auto', seed: 70_000 + index, fixtureId: `telemetry-${index}`,
      controlledTeamId: side.id, halfMinutes: 3, difficulty: 'normal', assist: 'balanced',
      playerLockId: null, weather: 'clear', effects, inputDevice: 'ai',
      camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true },
    };
    const match = new ArcadeMatch(side, away, config);
    let tick = 0;
    while (!match.finished && tick < 20_000) {
      if (match.phase === 'halftime') match.resumeSecondHalf();
      if (match.phase === 'goalReplay') match.endReplay();
      match.step(MATCH_TICK, EMPTY_MATCH_COMMAND);
      if (++tick % 30 !== 0) continue;
      const direction = match.attackDirection('home');
      const outfield = match.actors.filter((actor) => actor.active && actor.side === 'home' && actor.player.positionGroup !== 'GK');
      if (!outfield.length) continue;
      total.depth += outfield.reduce((sum, actor) => sum + (direction > 0 ? actor.x : 105 - actor.x), 0) / outfield.length;
      const ys = outfield.map((actor) => actor.y);
      const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
      total.spread += Math.sqrt(ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0) / ys.length);
      total.samples++;
      const owner = match.actors.find((actor) => actor.player.id === match.ball.ownerId);
      if (owner && owner.side === 'away') {
        total.pressGap += Math.min(...outfield.map((actor) => Math.hypot(actor.x - owner.x, actor.y - owner.y)));
        pressSamples++;
      }
    }
  }
  return { depth: total.depth / Math.max(1, total.samples), spread: total.spread / Math.max(1, total.samples), pressGap: total.pressGap / Math.max(1, pressSamples), samples: total.samples };
}
const low = measure((team) => { team.tactics.pressing = 'low'; team.tactics.defensiveLine = 'deep'; });
const high = measure((team) => { team.tactics.pressing = 'gegenpress'; team.tactics.defensiveLine = 'high'; });
const narrow = measure((team) => { team.tactics.width = 'narrow'; });
const wide = measure((team) => { team.tactics.width = 'wide'; });
console.log(JSON.stringify({ tacticTelemetry: { matches: telemetryMatches, lowPress: low, highPress: high, narrow, wide } }, null, 2));

const failures = [
  high.pressGap < low.pressGap - 0.25 ? '' : 'high pressing must close the carrier down at least 0.25 m closer than low pressing',
  high.depth > low.depth + 1.5 ? '' : 'a high line with gegenpress must sit at least 1.5 m higher up the pitch than a deep line',
  wide.spread > narrow.spread + 1 ? '' : 'a wide set-up must spread the team at least 1 m more across the pitch than a narrow one',
  inRange(report.averageGoals, 2.2, 3.4) ? '' : 'averageGoals must be 2.2-3.4',
  inRange(report.averageShotsPerTeam, 8, 18) ? '' : 'averageShotsPerTeam must be 8-18',
  inRange(report.averagePassAccuracy, 65, 88) ? '' : 'averagePassAccuracy must be 65-88',
  inRange(report.drawPercent, 20, 32) ? '' : 'drawPercent must be 20-32',
  inRange(report.homeWinPercent, 42, 52) ? '' : 'homeWinPercent must be 42-52',
  report.averageMatchMs <= 600 ? '' : 'averageMatchMs must be at most 600',
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
