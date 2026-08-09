import { generatePlayer, autoFillLineup } from '../data/generators';
import { Position } from '../models/enums';
import { GameState } from '../models/game.model';
import { Player } from '../models/player.model';
import { Team } from '../models/team.model';
import {
  ContractProposal,
  LoanDeal,
  TransferActivity,
  TransferKind,
  TransferNegotiation,
  TransferRecord,
  TransferState,
  emptyTransferState,
} from '../models/transfer.model';
import { createPlayerVisualIdentity, hash32 } from './visual-identity';
import { marketValueFor, playerName, weeklySalaryFor } from './ratings';
import { clamp, Rng } from './util';

export const MIN_SQUAD_SIZE = 16;
export const MAX_SQUAD_SIZE = 26;

const MARKET_POSITIONS: ReadonlyArray<{ position: Position; alts: Position[] }> = [
  { position: 'GK', alts: [] },
  { position: 'CB', alts: ['RCB', 'LCB'] },
  { position: 'RB', alts: ['RWB'] },
  { position: 'LB', alts: ['LWB'] },
  { position: 'CDM', alts: ['CM'] },
  { position: 'CM', alts: ['CAM', 'CDM'] },
  { position: 'CAM', alts: ['CM'] },
  { position: 'RW', alts: ['RM'] },
  { position: 'LW', alts: ['LM'] },
  { position: 'ST', alts: ['CF'] },
];

export interface LocatedPlayer {
  player: Player;
  team: Team | null;
  freeAgent: boolean;
}

export interface TransferResult {
  ok: boolean;
  reason?: string;
  negotiation?: TransferNegotiation;
}

export function transferWeekKey(game: GameState): number {
  return game.league.season * 100 + game.league.currentWeek;
}

export function deterministicId(prefix: string, ...parts: Array<string | number | null>): string {
  return `${prefix}-${hash32(parts.join('|')).toString(36)}`;
}

export function locateTransferPlayer(game: GameState, playerId: string): LocatedPlayer | null {
  for (const team of game.teams) {
    const player = team.players.find((candidate) => candidate.id === playerId);
    if (player) return { player, team, freeAgent: false };
  }
  const player = game.transfers.freeAgents.find((candidate) => candidate.id === playerId);
  return player ? { player, team: null, freeAgent: true } : null;
}

export function ensureTransferMarket(game: GameState): void {
  game.transfers ??= emptyTransferState(game.league.season, game.league.currentWeek);
  const state = game.transfers;
  state.season = game.league.season;
  state.week = game.league.currentWeek;
  expireNegotiations(state, game.league.currentWeek);
  if (state.freeAgents.length < 12) generateFreeAgents(game, 12 - state.freeAgents.length);
  ensureAiListings(game);
}

function generateFreeAgents(game: GameState, count: number): void {
  const start = game.transfers.freeAgents.length;
  const seed = hash32(`${game.league.id}|free-agents|${game.league.season}`);
  const rng = new Rng(seed);
  for (let skip = 0; skip < start * 24; skip++) rng.next();
  const playerClub = game.teams.find((team) => team.id === game.clubId);
  const weakestStarter = playerClub
    ? Math.min(...playerClub.formation.slots.map((slot) => playerClub.players.find((player) => player.id === slot.playerId)?.overall ?? 99))
    : 58;
  for (let index = start; index < start + count; index++) {
    const slot = MARKET_POSITIONS[index % MARKET_POSITIONS.length];
    const affordable = index < 6;
    const target = affordable
      ? clamp(Math.round(rng.gaussian(Math.max(52, weakestStarter - 1), 8)), 48, 66)
      : clamp(Math.round(rng.gaussian(66, 13)), 50, 86);
    const player = generatePlayer(rng, slot.position, slot.alts, target, rng.int(2, 39));
    player.id = deterministicId('free', game.league.id, game.league.season, index);
    player.visuals = createPlayerVisualIdentity(player.id);
    player.marketValue = marketValueFor(player.overall, player.age, player.potential);
    player.salary = weeklySalaryFor(player);
    player.contractWeeks = 0;
    game.transfers.freeAgents.push(player);
  }
}

function ensureAiListings(game: GameState): void {
  const existing = new Set(game.transfers.listings.map((listing) => listing.playerId));
  for (const team of game.teams.filter((candidate) => candidate.id !== game.clubId)) {
    const starters = new Set(team.formation.slots.map((slot) => slot.playerId));
    const candidates = team.players
      .filter((player) => !starters.has(player.id) && !existing.has(player.id))
      .sort((a, b) => a.overall - b.overall || a.age - b.age);
    for (const player of candidates.slice(0, 2)) {
      game.transfers.listings.push({
        playerId: player.id,
        teamId: team.id,
        askingPrice: askingPriceFor(player, team),
        loanAvailable: player.age <= 24 || player.overall < team.strength - 3,
        createdWeek: game.league.currentWeek,
      });
      existing.add(player.id);
    }
  }
}

export function askingPriceFor(player: Player, owner: Team | null): number {
  if (!owner) return 0;
  const contractFactor = player.contractWeeks <= 26 ? 0.82 : player.contractWeeks >= 104 ? 1.12 : 1;
  const importance = player.overall >= owner.strength + 4 ? 1.12 : player.overall <= owner.strength - 6 ? 0.92 : 1;
  return Math.round((player.marketValue * contractFactor * importance) / 1000) * 1000;
}

export function recommendedContract(player: Player): ContractProposal {
  const salary = weeklySalaryFor(player);
  return {
    weeks: player.age <= 23 ? 156 : player.age >= 31 ? 52 : 104,
    salary,
    squadRole: player.overall >= 80 ? 'star' : player.overall >= 70 ? 'starter' : player.age <= 21 ? 'prospect' : 'rotation',
    signingBonus: Math.round(Math.max(2_000, salary * 4) / 500) * 500,
  };
}

export function weeklyWageBill(game: GameState, teamId: string): number {
  const team = game.teams.find((candidate) => candidate.id === teamId);
  if (!team) return 0;
  const borrowed = new Map(
    game.transfers.loans
      .filter((loan) => loan.active && loan.borrowerTeamId === teamId)
      .map((loan) => [loan.playerId, loan]),
  );
  let total = team.players.reduce((sum, player) => {
    const loan = borrowed.get(player.id);
    return sum + Math.round(player.salary * (loan ? loan.wageShare / 100 : 1));
  }, 0);
  for (const loan of game.transfers.loans.filter((candidate) => candidate.active && candidate.parentTeamId === teamId)) {
    const player = game.teams.find((candidate) => candidate.id === loan.borrowerTeamId)?.players.find((candidate) => candidate.id === loan.playerId);
    if (player) total += Math.round(player.salary * (1 - loan.wageShare / 100));
  }
  return total;
}

export function fourWeekReserve(game: GameState, teamId: string): number {
  return weeklyWageBill(game, teamId) * 4;
}

export function submitTransferOffer(
  game: GameState,
  playerId: string,
  kind: TransferKind,
  fee: number,
  wageShare: 50 | 100 = 100,
  buyOption: number | null = null,
): TransferResult {
  ensureTransferMarket(game);
  const located = locateTransferPlayer(game, playerId);
  const buyer = game.teams.find((team) => team.id === game.clubId);
  if (!located || !buyer) return { ok: false, reason: 'Spieler oder Verein wurde nicht gefunden.' };
  if (located.team?.id === buyer.id) return { ok: false, reason: 'Der Spieler gehört bereits zu deinem Kader.' };
  if (buyer.players.length >= MAX_SQUAD_SIZE) return { ok: false, reason: 'Der Kader ist voll.' };
  if (kind === 'loan') {
    const listing = game.transfers.listings.find((candidate) => candidate.playerId === playerId);
    if (!located.team || !listing?.loanAvailable) return { ok: false, reason: 'Dieser Spieler ist nicht leihbar.' };
  }
  const requestedFee = kind === 'loan'
    ? Math.max(2_000, Math.round(located.player.marketValue * 0.035 / 1000) * 1000)
    : askingPriceFor(located.player, located.team);
  const id = deterministicId('neg', game.clubId, playerId, game.league.season, game.league.currentWeek, game.transfers.negotiations.length);
  const negotiation: TransferNegotiation = {
    id,
    playerId,
    fromTeamId: located.team?.id ?? null,
    toTeamId: buyer.id,
    direction: 'outgoing',
    kind,
    status: located.freeAgent ? 'contract' : 'submitted',
    fee: located.freeAgent ? 0 : Math.max(0, Math.round(fee / 1000) * 1000),
    requestedFee,
    loanFee: kind === 'loan' ? Math.max(0, Math.round(fee / 1000) * 1000) : 0,
    wageShare,
    buyOption,
    contract: null,
    clubCounterUsed: false,
    agentCounterUsed: false,
    createdWeek: game.league.currentWeek,
    expiresWeek: game.league.currentWeek + 1,
    message: located.freeAgent ? 'Bereit für Vertragsgespräche.' : 'Angebot wurde eingereicht.',
  };
  if (!located.freeAgent) evaluateClubOffer(game, negotiation, located.player, located.team!);
  game.transfers.negotiations.unshift(negotiation);
  return { ok: true, negotiation };
}

function evaluateClubOffer(game: GameState, negotiation: TransferNegotiation, player: Player, owner: Team): void {
  const required = negotiation.requestedFee;
  const offered = negotiation.kind === 'loan' ? negotiation.loanFee : negotiation.fee;
  const rng = new Rng(hash32(`${game.league.id}|${negotiation.id}|club`));
  const tolerance = rng.float(0.97, 1.03);
  if (offered >= required * tolerance) {
    negotiation.status = negotiation.kind === 'loan' ? 'fee-agreed' : 'contract';
    negotiation.message = negotiation.kind === 'loan' ? `${owner.shortName} akzeptiert die Leihkonditionen.` : `${owner.shortName} akzeptiert die Ablöse.`;
  } else if (offered >= required * 0.8) {
    negotiation.status = 'countered';
    negotiation.clubCounterUsed = true;
    negotiation.requestedFee = Math.round((required * rng.float(0.96, 1.02)) / 1000) * 1000;
    negotiation.message = `${owner.shortName} fordert CR ${negotiation.requestedFee.toLocaleString('de-DE')}.`;
  } else {
    negotiation.status = 'rejected';
    negotiation.message = 'Das Angebot liegt zu weit unter der Forderung.';
  }
}

export function acceptClubCounter(game: GameState, negotiationId: string): TransferResult {
  const negotiation = game.transfers.negotiations.find((candidate) => candidate.id === negotiationId);
  if (!negotiation || negotiation.status !== 'countered') return { ok: false, reason: 'Kein offenes Gegenangebot.' };
  if (negotiation.kind === 'loan') negotiation.loanFee = negotiation.requestedFee;
  else negotiation.fee = negotiation.requestedFee;
  negotiation.status = negotiation.kind === 'loan' ? 'fee-agreed' : 'contract';
  negotiation.message = negotiation.kind === 'loan' ? 'Leihkonditionen vereinbart.' : 'Ablöse vereinbart. Jetzt folgt der Vertrag.';
  return { ok: true, negotiation };
}

export function submitPlayerContract(game: GameState, negotiationId: string, proposal: ContractProposal): TransferResult {
  const negotiation = game.transfers.negotiations.find((candidate) => candidate.id === negotiationId);
  if (!negotiation || !['contract', 'fee-agreed'].includes(negotiation.status)) return { ok: false, reason: 'Die Ablöse ist noch nicht vereinbart.' };
  const located = locateTransferPlayer(game, negotiation.playerId);
  if (!located) return { ok: false, reason: 'Spieler nicht gefunden.' };
  const expected = recommendedContract(located.player);
  const roleWeight = { prospect: 0.86, rotation: 0.94, starter: 1, star: 1.1 }[proposal.squadRole];
  const expectedRoleWeight = { prospect: 0.86, rotation: 0.94, starter: 1, star: 1.1 }[expected.squadRole];
  const effective = proposal.salary * roleWeight + proposal.signingBonus / Math.max(52, proposal.weeks);
  const required = expected.salary * expectedRoleWeight + expected.signingBonus / expected.weeks;
  negotiation.contract = { ...proposal, salary: Math.max(0, Math.round(proposal.salary / 50) * 50), signingBonus: Math.max(0, Math.round(proposal.signingBonus / 500) * 500) };
  if (effective >= required) return executeNegotiation(game, negotiation);
  if (effective >= required * 0.85 && !negotiation.agentCounterUsed) {
    negotiation.agentCounterUsed = true;
    negotiation.status = 'contract';
    negotiation.contract.salary = Math.round(expected.salary / 50) * 50;
    negotiation.contract.signingBonus = expected.signingBonus;
    negotiation.message = 'Der Agent hat einmalig nachgebessert. Du kannst dieses Paket annehmen.';
    return { ok: true, negotiation };
  }
  negotiation.status = 'rejected';
  negotiation.message = 'Der Spieler lehnt die Konditionen ab.';
  return { ok: false, reason: negotiation.message, negotiation };
}

export function acceptAgentCounter(game: GameState, negotiationId: string): TransferResult {
  const negotiation = game.transfers.negotiations.find((candidate) => candidate.id === negotiationId);
  if (!negotiation?.contract || !negotiation.agentCounterUsed || negotiation.status !== 'contract') return { ok: false, reason: 'Kein Gegenangebot des Agenten.' };
  return executeNegotiation(game, negotiation);
}

function executeNegotiation(game: GameState, negotiation: TransferNegotiation): TransferResult {
  const located = locateTransferPlayer(game, negotiation.playerId);
  const buyer = game.teams.find((team) => team.id === negotiation.toTeamId);
  if (!located || !buyer) return { ok: false, reason: 'Transferziel nicht gefunden.' };
  const contract = negotiation.contract ?? recommendedContract(located.player);
  const transferCost = negotiation.kind === 'loan' ? negotiation.loanFee : negotiation.fee;
  const immediateCost = transferCost + (negotiation.kind === 'permanent' ? contract.signingBonus : 0);
  if (buyer.players.length >= MAX_SQUAD_SIZE) return { ok: false, reason: 'Der Kader ist voll.' };
  if (buyer.coins < immediateCost) return { ok: false, reason: 'Das Transferbudget reicht nicht.' };
  const projectedWages = weeklyWageBill(game, buyer.id) + Math.round(contract.salary * (negotiation.kind === 'loan' ? negotiation.wageShare / 100 : 1));
  if (projectedWages > buyer.wageBudget) return { ok: false, reason: 'Das Gehaltsbudget wird überschritten.' };
  if (located.team && !canReleasePlayer(located.team, located.player.id)) return { ok: false, reason: 'Der abgebende Club kann den Spieler nicht freigeben.' };

  buyer.coins -= immediateCost;
  if (located.team) {
    located.team.coins += transferCost;
    located.team.players = located.team.players.filter((player) => player.id !== located.player.id);
    autoFillLineup(located.team);
  } else {
    game.transfers.freeAgents = game.transfers.freeAgents.filter((player) => player.id !== located.player.id);
  }
  const player = located.player;
  if (negotiation.kind === 'permanent') {
    player.salary = contract.salary;
    player.contractWeeks = contract.weeks;
  }
  player.kitNumber = nextKitNumber(buyer, player.kitNumber);
  buyer.players.push(player);
  autoFillLineup(buyer);

  if (negotiation.kind === 'loan' && located.team) {
    const loan: LoanDeal = {
      id: deterministicId('loan', negotiation.id),
      playerId: player.id,
      parentTeamId: located.team.id,
      borrowerTeamId: buyer.id,
      startSeason: game.league.season,
      startWeek: game.league.currentWeek,
      endSeason: game.league.season,
      wageShare: negotiation.wageShare,
      fee: negotiation.loanFee,
      buyOption: negotiation.buyOption,
      active: true,
    };
    game.transfers.loans.push(loan);
  }
  negotiation.status = 'accepted';
  negotiation.message = `${playerName(player)} wechselt zu ${buyer.shortName}.`;
  game.transfers.listings = game.transfers.listings.filter((listing) => listing.playerId !== player.id);
  game.transfers.shortlist = game.transfers.shortlist.filter((entry) => entry.playerId !== player.id);
  pushRecord(game, player, located.team?.id ?? null, buyer.id, located.freeAgent ? 'free-agent' : negotiation.kind, transferCost);
  return { ok: true, negotiation };
}

export function renewPlayerContract(game: GameState, playerId: string, proposal: ContractProposal): TransferResult {
  const team = game.teams.find((candidate) => candidate.id === game.clubId);
  const player = team?.players.find((candidate) => candidate.id === playerId);
  if (!team || !player) return { ok: false, reason: 'Spieler nicht gefunden.' };
  const expected = recommendedContract(player);
  if (proposal.salary < expected.salary * 0.85) return { ok: false, reason: 'Das Gehaltsangebot ist zu niedrig.' };
  const projected = weeklyWageBill(game, team.id) - player.salary + proposal.salary;
  if (projected > team.wageBudget || team.coins < proposal.signingBonus) return { ok: false, reason: 'Budget reicht nicht für die Verlängerung.' };
  team.coins -= proposal.signingBonus;
  player.salary = proposal.salary;
  player.contractWeeks = Math.max(player.contractWeeks, 0) + proposal.weeks;
  player.morale = clamp(player.morale + 8, 0, 100);
  return { ok: true };
}

export function listPlayerForTransfer(game: GameState, playerId: string, askingPrice: number, loanAvailable: boolean): TransferResult {
  const team = game.teams.find((candidate) => candidate.id === game.clubId);
  const player = team?.players.find((candidate) => candidate.id === playerId);
  if (!team || !player) return { ok: false, reason: 'Spieler nicht gefunden.' };
  if (!canReleasePlayer(team, playerId)) return { ok: false, reason: 'Mindestens 16 Spieler und ein Torwart müssen bleiben.' };
  game.transfers.listings = game.transfers.listings.filter((listing) => listing.playerId !== playerId);
  game.transfers.listings.unshift({ playerId, teamId: team.id, askingPrice: Math.max(0, Math.round(askingPrice / 1000) * 1000), loanAvailable, createdWeek: game.league.currentWeek });
  return { ok: true };
}

export function removeTransferListing(game: GameState, playerId: string): void {
  game.transfers.listings = game.transfers.listings.filter((listing) => listing.playerId !== playerId);
}

export function processTransferWeek(game: GameState): void {
  ensureTransferMarket(game);
  createIncomingPlayerOffer(game);
  let deals = 0;
  const rng = new Rng(hash32(`${game.league.id}|ai-market|${transferWeekKey(game)}`));
  const listings = rng.shuffle(game.transfers.listings.filter((listing) => listing.teamId !== game.clubId));
  for (const listing of listings) {
    if (deals >= 2) break;
    const located = locateTransferPlayer(game, listing.playerId);
    if (!located?.team || !canReleasePlayer(located.team, located.player.id)) continue;
    const buyers = rng.shuffle(game.teams.filter((team) => team.id !== game.clubId && team.id !== located.team!.id && team.players.length < MAX_SQUAD_SIZE));
    const buyer = buyers.find((team) => teamNeedsPlayer(team, located.player) && team.coins - listing.askingPrice >= fourWeekReserve(game, team.id));
    if (!buyer) continue;
    buyer.coins -= listing.askingPrice;
    located.team.coins += listing.askingPrice;
    located.team.players = located.team.players.filter((player) => player.id !== located.player.id);
    located.player.kitNumber = nextKitNumber(buyer, located.player.kitNumber);
    buyer.players.push(located.player);
    autoFillLineup(located.team);
    autoFillLineup(buyer);
    game.transfers.listings = game.transfers.listings.filter((candidate) => candidate.playerId !== located.player.id);
    pushRecord(game, located.player, located.team.id, buyer.id, 'permanent', listing.askingPrice);
    deals++;
  }
  ensureAiListings(game);
  game.transfers.activity = game.transfers.activity.slice(0, 40);
  game.transfers.history = game.transfers.history.slice(0, 100);
}

function createIncomingPlayerOffer(game: GameState): void {
  const openIncoming = game.transfers.negotiations.filter((negotiation) => negotiation.direction === 'incoming' && !['accepted', 'rejected', 'expired'].includes(negotiation.status));
  if (openIncoming.length >= 3) return;
  const listings = game.transfers.listings.filter((listing) => listing.teamId === game.clubId);
  if (!listings.length) return;
  const rng = new Rng(hash32(`${game.league.id}|incoming|${transferWeekKey(game)}`));
  const listing = rng.pick(listings);
  const seller = game.teams.find((team) => team.id === game.clubId)!;
  const player = seller.players.find((candidate) => candidate.id === listing.playerId);
  const buyers = game.teams.filter((team) => team.id !== game.clubId && team.players.length < MAX_SQUAD_SIZE);
  if (!player || !buyers.length || !canReleasePlayer(seller, player.id)) return;
  const buyer = rng.pick(buyers);
  const fee = Math.min(buyer.coins - fourWeekReserve(game, buyer.id), Math.round(listing.askingPrice * rng.float(0.82, 1.02) / 1000) * 1000);
  if (fee <= 0) return;
  const id = deterministicId('neg-in', player.id, buyer.id, transferWeekKey(game));
  if (game.transfers.negotiations.some((negotiation) => negotiation.id === id)) return;
  game.transfers.negotiations.unshift({
    id,
    playerId: player.id,
    fromTeamId: seller.id,
    toTeamId: buyer.id,
    direction: 'incoming',
    kind: 'permanent',
    status: 'submitted',
    fee,
    requestedFee: listing.askingPrice,
    loanFee: 0,
    wageShare: 100,
    buyOption: null,
    contract: null,
    clubCounterUsed: false,
    agentCounterUsed: false,
    createdWeek: game.league.currentWeek,
    expiresWeek: game.league.currentWeek + 1,
    message: `${buyer.shortName} bietet CR ${fee.toLocaleString('de-DE')}.`,
  });
}

export function resolveIncomingOffer(game: GameState, negotiationId: string, action: 'accept' | 'counter' | 'reject', counterFee?: number): TransferResult {
  const negotiation = game.transfers.negotiations.find((candidate) => candidate.id === negotiationId && candidate.direction === 'incoming');
  if (!negotiation || negotiation.status !== 'submitted') return { ok: false, reason: 'Angebot ist nicht mehr offen.' };
  if (action === 'reject') {
    negotiation.status = 'rejected';
    negotiation.message = 'Angebot abgelehnt.';
    return { ok: true, negotiation };
  }
  if (action === 'counter') {
    if (negotiation.clubCounterUsed) return { ok: false, reason: 'Es ist nur ein Gegenangebot möglich.' };
    negotiation.clubCounterUsed = true;
    const requested = Math.max(negotiation.fee, Math.round((counterFee ?? negotiation.requestedFee) / 1000) * 1000);
    const buyer = game.teams.find((team) => team.id === negotiation.toTeamId);
    const rng = new Rng(hash32(`${negotiation.id}|counter`));
    if (buyer && requested <= negotiation.requestedFee * rng.float(0.96, 1.04) && buyer.coins - requested >= fourWeekReserve(game, buyer.id)) {
      negotiation.fee = requested;
      negotiation.message = `${buyer.shortName} akzeptiert dein Gegenangebot.`;
    } else {
      negotiation.status = 'rejected';
      negotiation.message = 'Der Interessent steigt aus den Gesprächen aus.';
      return { ok: false, reason: negotiation.message, negotiation };
    }
  }
  return executeIncomingTransfer(game, negotiation);
}

function executeIncomingTransfer(game: GameState, negotiation: TransferNegotiation): TransferResult {
  const seller = game.teams.find((team) => team.id === negotiation.fromTeamId);
  const buyer = game.teams.find((team) => team.id === negotiation.toTeamId);
  const player = seller?.players.find((candidate) => candidate.id === negotiation.playerId);
  if (!seller || !buyer || !player || !canReleasePlayer(seller, player.id) || buyer.players.length >= MAX_SQUAD_SIZE) return { ok: false, reason: 'Der Transfer ist nicht mehr möglich.' };
  if (buyer.coins - negotiation.fee < fourWeekReserve(game, buyer.id)) return { ok: false, reason: 'Der Käufer hat nicht mehr genug Budget.' };
  buyer.coins -= negotiation.fee;
  seller.coins += negotiation.fee;
  seller.players = seller.players.filter((candidate) => candidate.id !== player.id);
  player.kitNumber = nextKitNumber(buyer, player.kitNumber);
  buyer.players.push(player);
  autoFillLineup(seller);
  autoFillLineup(buyer);
  negotiation.status = 'accepted';
  negotiation.message = `${playerName(player)} wurde verkauft.`;
  game.transfers.listings = game.transfers.listings.filter((listing) => listing.playerId !== player.id);
  pushRecord(game, player, seller.id, buyer.id, 'permanent', negotiation.fee);
  return { ok: true, negotiation };
}

export function returnSeasonLoans(game: GameState): void {
  for (const loan of game.transfers.loans.filter((candidate) => candidate.active && candidate.endSeason < game.league.season)) {
    const borrower = game.teams.find((team) => team.id === loan.borrowerTeamId);
    const parent = game.teams.find((team) => team.id === loan.parentTeamId);
    const player = borrower?.players.find((candidate) => candidate.id === loan.playerId);
    if (!borrower || !parent || !player) {
      loan.active = false;
      continue;
    }
    borrower.players = borrower.players.filter((candidate) => candidate.id !== player.id);
    player.kitNumber = nextKitNumber(parent, player.kitNumber);
    parent.players.push(player);
    loan.active = false;
    autoFillLineup(borrower);
    autoFillLineup(parent);
    pushRecord(game, player, borrower.id, parent.id, 'loan-return', 0);
  }
}

function canReleasePlayer(team: Team, playerId: string): boolean {
  if (team.players.length <= MIN_SQUAD_SIZE) return false;
  const player = team.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  return player.position !== 'GK' || team.players.filter((candidate) => candidate.position === 'GK').length > 1;
}

function teamNeedsPlayer(team: Team, player: Player): boolean {
  const group = team.players.filter((candidate) => candidate.positionGroup === player.positionGroup);
  if (!group.length) return true;
  return player.overall >= group.reduce((sum, candidate) => sum + candidate.overall, 0) / group.length - 3;
}

function nextKitNumber(team: Team, preferred: number): number {
  const used = new Set(team.players.map((player) => player.kitNumber));
  if (!used.has(preferred)) return preferred;
  for (let number = 1; number <= 99; number++) if (!used.has(number)) return number;
  return preferred;
}

function expireNegotiations(state: TransferState, week: number): void {
  for (const negotiation of state.negotiations) {
    if (!['accepted', 'rejected', 'expired'].includes(negotiation.status) && negotiation.expiresWeek <= week) {
      negotiation.status = 'expired';
      negotiation.message = 'Das Angebot ist abgelaufen.';
    }
  }
}

function pushRecord(game: GameState, player: Player, fromTeamId: string | null, toTeamId: string, kind: TransferRecord['kind'], fee: number): void {
  const id = deterministicId('deal', player.id, fromTeamId, toTeamId, game.league.season, game.league.currentWeek, game.transfers.history.length);
  game.transfers.history.unshift({ id, playerId: player.id, playerName: playerName(player), fromTeamId, toTeamId, kind, fee, season: game.league.season, week: game.league.currentWeek });
  const from = fromTeamId ? game.teams.find((team) => team.id === fromTeamId)?.shortName ?? 'FA' : 'FA';
  const to = game.teams.find((team) => team.id === toTeamId)?.shortName ?? toTeamId;
  const activity: TransferActivity = { id: `${id}-activity`, season: game.league.season, week: game.league.currentWeek, tone: toTeamId === game.clubId ? 'success' : 'info', text: `${playerName(player)}: ${from} -> ${to} · CR ${fee.toLocaleString('de-DE')}` };
  game.transfers.activity.unshift(activity);
}
