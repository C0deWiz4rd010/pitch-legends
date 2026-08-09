import { createNewGame } from './data/generators';
import { recommendedContract } from './core/transfer-engine';
import {
  acceptClubCounter,
  askingPriceFor,
  ensureTransferMarket,
  locateTransferPlayer,
  processTransferWeek,
  returnSeasonLoans,
  submitPlayerContract,
  submitTransferOffer,
  weeklyWageBill,
} from './core/transfer-engine';
import { marketValueFor, weeklySalaryFor } from './core/ratings';
import { SaveService } from './core/services/save.service';

describe('Transfer market V2', () => {
  it('builds a deterministic market with affordable week-one options', () => {
    const source = createNewGame({ managerName: 'Scout', clubName: 'Scout FC', seed: 921 });
    const first = structuredClone(source);
    const second = structuredClone(source);

    ensureTransferMarket(first);
    ensureTransferMarket(second);

    const describe = (game: typeof first) => game.transfers.freeAgents.map((player) => ({
      id: player.id,
      name: `${player.firstName} ${player.lastName}`,
      overall: player.overall,
      potential: player.potential,
      value: player.marketValue,
      wage: player.salary,
    }));
    expect(describe(first)).toEqual(describe(second));
    expect(first.transfers.freeAgents.filter((player) => recommendedContract(player).signingBonus <= first.teams[0].coins)).toHaveLength(12);
    expect(first.transfers.listings.filter((listing) => listing.loanAvailable).length).toBeGreaterThanOrEqual(3);
  });

  it('completes a free-agent signing atomically', () => {
    const game = createNewGame({ managerName: 'Agent', clubName: 'Agent FC', seed: 922 });
    ensureTransferMarket(game);
    const club = game.teams.find((team) => team.id === game.clubId)!;
    const player = game.transfers.freeAgents[0];
    const squadBefore = club.players.length;
    const budgetBefore = club.coins;
    const negotiation = submitTransferOffer(game, player.id, 'permanent', 0).negotiation!;

    expect(negotiation.status).toBe('contract');
    const contract = recommendedContract(player);
    const result = submitPlayerContract(game, negotiation.id, contract);

    expect(result.ok).toBe(true);
    expect(result.negotiation?.status).toBe('accepted');
    expect(club.players).toHaveLength(squadBefore + 1);
    expect(club.players.filter((candidate) => candidate.id === player.id)).toHaveLength(1);
    expect(game.transfers.freeAgents.some((candidate) => candidate.id === player.id)).toBe(false);
    expect(club.coins).toBe(budgetBefore - contract.signingBonus);
    expect(game.transfers.history[0].kind).toBe('free-agent');
  });

  it('moves a loaned player once and returns him at the next season', () => {
    const game = createNewGame({ managerName: 'Loan', clubName: 'Loan FC', seed: 923 });
    ensureTransferMarket(game);
    const listing = game.transfers.listings.find((candidate) => candidate.loanAvailable)!;
    const located = locateTransferPlayer(game, listing.playerId)!;
    const parent = located.team!;
    const borrower = game.teams.find((team) => team.id === game.clubId)!;
    const parentSize = parent.players.length;
    const borrowerSize = borrower.players.length;
    const loanFee = Math.max(2_000, Math.round(located.player.marketValue * 0.035 / 1_000) * 1_000);
    let offer = submitTransferOffer(game, located.player.id, 'loan', Math.ceil(loanFee * 1.1 / 1_000) * 1_000, 50, located.player.marketValue);
    if (offer.negotiation?.status === 'countered') offer = acceptClubCounter(game, offer.negotiation.id);
    const result = submitPlayerContract(game, offer.negotiation!.id, recommendedContract(located.player));

    expect(result.ok).toBe(true);
    expect(parent.players).toHaveLength(parentSize - 1);
    expect(borrower.players).toHaveLength(borrowerSize + 1);
    expect(game.transfers.loans.filter((loan) => loan.active && loan.playerId === located.player.id)).toHaveLength(1);
    expect(weeklyWageBill(game, borrower.id)).toBeLessThan(borrower.players.reduce((sum, player) => sum + player.salary, 0));

    game.league.season++;
    returnSeasonLoans(game);
    expect(parent.players.some((player) => player.id === located.player.id)).toBe(true);
    expect(borrower.players.some((player) => player.id === located.player.id)).toBe(false);
    expect(game.transfers.loans.find((loan) => loan.playerId === located.player.id)?.active).toBe(false);
  });

  it('makes the same single counteroffer after save/load and leaves finances untouched', () => {
    const source = createNewGame({ managerName: 'Counter', clubName: 'Counter FC', seed: 924 });
    ensureTransferMarket(source);
    const target = source.teams[1].players[0];
    const asking = askingPriceFor(target, source.teams[1]);
    const first = structuredClone(source);
    const second = structuredClone(source);
    const budgets = first.teams.map((team) => team.coins);

    const a = submitTransferOffer(first, target.id, 'permanent', asking * 0.85).negotiation!;
    const b = submitTransferOffer(second, target.id, 'permanent', asking * 0.85).negotiation!;

    expect({ status: a.status, requested: a.requestedFee, message: a.message }).toEqual({ status: b.status, requested: b.requestedFee, message: b.message });
    expect(a.status).toBe('countered');
    expect(a.clubCounterUsed).toBe(true);
    expect(first.teams.map((team) => team.coins)).toEqual(budgets);
  });

  it('keeps weekly AI activity deterministic and every player unique', () => {
    const source = createNewGame({ managerName: 'League', clubName: 'League FC', seed: 925 });
    ensureTransferMarket(source);
    const first = structuredClone(source);
    const second = structuredClone(source);
    first.league.currentWeek = 2;
    second.league.currentWeek = 2;
    processTransferWeek(first);
    processTransferWeek(second);

    expect(first.transfers.history).toEqual(second.transfers.history);
    const ids = first.teams.flatMap((team) => team.players.map((player) => player.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(first.teams.every((team) => team.players.length >= 16 && team.coins >= 0)).toBe(true);
  });

  it('uses the arcade economy bands and stores only V4 saves', () => {
    expect(marketValueFor(50, 26, 50)).toBeGreaterThanOrEqual(20_000);
    expect(marketValueFor(50, 26, 50)).toBeLessThanOrEqual(45_000);
    expect(marketValueFor(80, 26, 80)).toBeGreaterThanOrEqual(500_000);
    expect(marketValueFor(80, 26, 80)).toBeLessThanOrEqual(1_500_000);
    const value = marketValueFor(70, 25, 74);
    expect(weeklySalaryFor({ marketValue: value, age: 25, overall: 70 })).toBeCloseTo(value * 0.006, -2);

    const game = createNewGame({ managerName: 'V4', clubName: 'V4 FC', seed: 926 });
    const saves = new SaveService();
    localStorage.clear();
    localStorage.setItem('pitch-legends:save:v3', JSON.stringify({ ...game, version: 3 }));
    expect(saves.load()).toBeNull();
    expect(localStorage.getItem('pitch-legends:save:v3')).toBeTruthy();
    saves.save(game);
    expect(JSON.parse(localStorage.getItem('pitch-legends:save:v4')!).version).toBe(4);
  });
});
