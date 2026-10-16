import { TestBed } from '@angular/core/testing';
import { createNewGame } from './data/generators';
import { MAX_SQUAD_SIZE, returnSeasonLoans } from './core/transfer-engine';
import { rollOverSquads } from './core/career/lifecycle';
import { aiInvest, facilityUpgradeCost } from './core/career/finance';
import { ArcadeMatch } from './core/services/arcade-match';
import { createPracticeTeams } from './core/football/practice';
import { smallSidedTeam } from './core/football/small-sided';
import { MATCH_TICK, SMALL_PITCH } from './core/football/match-types';
import { turnTowards } from './core/football/movement';
import { ShootoutBoardComponent } from './shared/components/shootout-board.component';
import { GameState } from './models/game.model';
import { Team } from './models/team.model';
import { MatchConfig } from './models/match.model';

/** Pads a squad with copies of its own outfield players until it is full. */
function fillSquad(team: Team, size = MAX_SQUAD_SIZE): void {
  const outfield = team.players.filter((player) => player.positionGroup !== 'GK');
  for (let index = 0; team.players.length < size; index++) {
    const copy = structuredClone(outfield[index % outfield.length]);
    copy.id = `${copy.id}-copy-${index}`;
    copy.overall = 40 + index;
    team.players.push(copy);
  }
}

function loanBetween(game: GameState, parent: Team, borrower: Team): string {
  const player = borrower.players.find((candidate) => candidate.positionGroup === 'MID')!;
  game.transfers.loans.push({
    id: 'qa-loan', playerId: player.id, parentTeamId: parent.id, borrowerTeamId: borrower.id, startSeason: 1, startWeek: 1,
    endSeason: game.league.season - 1, wageShare: 100, fee: 0, buyOption: null, active: true,
  });
  return player.id;
}

describe('Phase H: balance and QA fixes', () => {
  it('a returning loan never pushes an AI squad over the limit', () => {
    const game = createNewGame({ managerName: 'Loans', clubName: 'Loan FC', seed: 808 });
    const ai = game.teams.filter((team) => team.id !== game.clubId);
    const [parent, borrower] = ai;
    fillSquad(parent);
    game.league.season = 2;
    const playerId = loanBetween(game, parent, borrower);
    returnSeasonLoans(game);
    expect(parent.players).toHaveLength(MAX_SQUAD_SIZE);
    expect(parent.players.some((player) => player.id === playerId)).toBe(true);
    // The weakest outfield player went to the free-agent pool.
    expect(game.transfers.freeAgents.some((player) => player.id.endsWith('-copy-0'))).toBe(true);
  });

  it("extends the loan instead of releasing anyone from the manager's own full squad", () => {
    const game = createNewGame({ managerName: 'Loans', clubName: 'Loan FC', seed: 809 });
    const own = game.teams.find((team) => team.id === game.clubId)!;
    const borrower = game.teams.find((team) => team.id !== game.clubId)!;
    fillSquad(own);
    game.league.season = 2;
    const playerId = loanBetween(game, own, borrower);
    returnSeasonLoans(game);
    expect(own.players).toHaveLength(MAX_SQUAD_SIZE);
    expect(borrower.players.some((player) => player.id === playerId)).toBe(true);
    expect(game.transfers.loans[0]).toMatchObject({ active: true, endSeason: 2 });
  });

  it('tops a full AI squad up with a second keeper without exceeding the limit', () => {
    const game = createNewGame({ managerName: 'Keepers', clubName: 'Glove FC', seed: 810 });
    const team = game.teams.find((candidate) => candidate.id !== game.clubId)!;
    team.players = team.players.filter((player, index, all) => player.positionGroup !== 'GK' || all.findIndex((other) => other.positionGroup === 'GK') === index);
    fillSquad(team);
    for (const player of team.players) { player.contractWeeks = 100; player.age = Math.min(player.age, 28); }
    rollOverSquads(game);
    expect(team.players.length).toBeLessThanOrEqual(MAX_SQUAD_SIZE);
    expect(team.players.filter((player) => player.positionGroup === 'GK').length).toBeGreaterThanOrEqual(2);
  });

  it('lets rich AI clubs build twice a season, never the manager’s club', () => {
    const game = createNewGame({ managerName: 'Builder', clubName: 'Crane FC', seed: 811 });
    const team = game.teams.find((candidate) => candidate.id !== game.clubId)!;
    team.coins = 10_000_000;
    expect(aiInvest(game, team, 30_000)).toHaveLength(2);
    team.coins = facilityUpgradeCost(1) * 3 - 1;
    expect(aiInvest(game, team, 0)).toHaveLength(0);
    const own = game.teams.find((candidate) => candidate.id === game.clubId)!;
    own.coins = 10_000_000;
    expect(aiInvest(game, own, 0)).toHaveLength(0);
  });

  it('plays five-a-side with cage-sized distances: fewer pot shots, no players parked on the goal lines', () => {
    let shots = 0, passes = 0, completed = 0, edge = 0, samples = 0;
    for (const seed of [11, 12, 13]) {
      const { home, away } = createPracticeTeams(seed * 31);
      const config: MatchConfig = {
        mode: 'instant', controllerMode: 'auto', controlledTeamId: home.id, halfMinutes: 3, seed, difficulty: 'normal', assist: 'balanced',
        playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, smallSided: true,
      };
      const match = new ArcadeMatch(smallSidedTeam(home), smallSidedTeam(away), config);
      for (let tick = 0; tick < 60 * 360 && !match.finished; tick++) {
        if (match.phase === 'halftime') match.resumeSecondHalf();
        if (match.phase === 'goalReplay') match.endReplay();
        match.step(MATCH_TICK);
        if (tick % 30) continue;
        for (const actor of match.actors) {
          if (!actor.active || actor.player.positionGroup === 'GK') continue;
          samples++;
          if (actor.x < 3 || actor.x > SMALL_PITCH.length - 3) edge++;
        }
      }
      const result = match.result();
      shots += result.homeStats.shots + result.awayStats.shots;
      passes += result.homeStats.passesAttempted + result.awayStats.passesAttempted;
      completed += result.homeStats.passesCompleted + result.awayStats.passesCompleted;
    }
    // With full-pitch distances the whole cage counted as shooting range: over 100 shots a match, 61 % passing.
    expect(shots / 3).toBeLessThan(80);
    expect(completed / passes).toBeGreaterThan(0.65);
    expect(edge / samples).toBeLessThan(0.015);
  }, 60_000);

  it('turns through the shortest arc, snaps when close and keeps half turns counter-clockwise', () => {
    expect(turnTowards(1, 0, 0, 1, Math.PI)).toEqual({ x: 0, y: 1 });
    const limited = turnTowards(1, 0, 0, 1, 0.1);
    expect(limited.x).toBeCloseTo(Math.cos(0.1), 12);
    expect(limited.y).toBeCloseTo(Math.sin(0.1), 12);
    const half = turnTowards(1, 0, -1, 0, 0.2);
    expect(half.y).toBeGreaterThan(0);
    expect(turnTowards(0, 1, 0, 0, Math.PI)).toEqual({ x: 1, y: 0 });
  });

  it('reveals a shoot-out kick by kick in the order the penalties were taken', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ShootoutBoardComponent);
    fixture.componentRef.setInput('shootout', { home: [true, false, true], away: [true, true, true], takers: { home: ['h1', 'h2', 'h3'], away: ['a1', 'a2', 'a3'] }, winner: 'away' });
    fixture.componentRef.setInput('names', { h1: 'Home One', a1: 'Away One' });
    fixture.componentRef.setInput('homeName', 'HOM');
    fixture.componentRef.setInput('awayName', 'AWY');
    fixture.componentRef.setInput('instant', true);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('strong')!.textContent!.trim()).toBe('2 : 3');
    expect(element.querySelectorAll('li.scored')).toHaveLength(5);
    expect(element.querySelectorAll('li.missed')).toHaveLength(1);
    expect(element.querySelector('li')!.getAttribute('title')).toBe('Home One');
    expect(element.querySelector('.winner')!.textContent).toContain('AWY');
    TestBed.resetTestingModule();
  });
});
