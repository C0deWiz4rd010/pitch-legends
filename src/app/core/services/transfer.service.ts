import { Injectable, computed, inject } from '@angular/core';
import { AttributeKey } from '../../models/enums';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { ContractProposal, ScoutingReport, TransferKind, TransferNegotiation } from '../../models/transfer.model';
import {
  MAX_SQUAD_SIZE,
  TransferResult,
  acceptAgentCounter,
  acceptClubCounter,
  askingPriceFor,
  ensureTransferMarket,
  fourWeekReserve,
  listPlayerForTransfer,
  locateTransferPlayer,
  recommendedContract,
  removeTransferListing,
  renewPlayerContract,
  resolveIncomingOffer,
  submitPlayerContract,
  submitTransferOffer,
  weeklyWageBill,
} from '../transfer-engine';
import { hash32 } from '../visual-identity';
import { clamp } from '../util';
import { GameStateService } from './game-state.service';

export { MAX_SQUAD_SIZE } from '../transfer-engine';

export interface TransferTargetView {
  player: Player;
  team: Team | null;
  askingPrice: number;
  freeAgent: boolean;
  loanAvailable: boolean;
  shortlisted: boolean;
  report: ScoutingReport | null;
  improvesStartingXi: boolean;
}

export interface TransferFinances {
  budget: number;
  weeklyWages: number;
  wageBudget: number;
  wageRoom: number;
  fourWeekReserve: number;
  spendableAfterReserve: number;
}

const SCOUT_COST = 2_500;

@Injectable({ providedIn: 'root' })
export class TransferService {
  private readonly gs = inject(GameStateService);

  readonly targets = computed<TransferTargetView[]>(() => {
    const game = this.gs.game();
    if (!game) return [];
    const playerClub = game.teams.find((team) => team.id === game.clubId);
    const shortlist = new Set(game.transfers.shortlist.map((entry) => entry.playerId));
    const reports = new Map(game.transfers.reports.filter((report) => report.season === game.league.season).map((report) => [report.playerId, report]));
    const listings = new Map(game.transfers.listings.map((listing) => [listing.playerId, listing]));
    const players: Array<{ player: Player; team: Team | null }> = [
      ...game.teams.filter((team) => team.id !== game.clubId).flatMap((team) => team.players.map((player) => ({ player, team }))),
      ...game.transfers.freeAgents.map((player) => ({ player, team: null })),
    ];
    return players.map(({ player, team }) => ({
      player,
      team,
      askingPrice: askingPriceFor(player, team),
      freeAgent: !team,
      loanAvailable: listings.get(player.id)?.loanAvailable ?? false,
      shortlisted: shortlist.has(player.id),
      report: reports.get(player.id) ?? null,
      improvesStartingXi: playerClub ? this.improvesXi(player, playerClub) : false,
    }));
  });
  readonly market = computed(() => this.targets().map((target) => target.player));
  readonly shortlist = computed(() => this.targets().filter((target) => target.shortlisted));
  readonly negotiations = computed(() => this.gs.game()?.transfers.negotiations ?? []);
  readonly incomingOffers = computed(() => this.negotiations().filter((offer) => offer.direction === 'incoming'));
  readonly outgoingOffers = computed(() => this.negotiations().filter((offer) => offer.direction === 'outgoing'));
  readonly activity = computed(() => this.gs.game()?.transfers.activity ?? []);
  readonly finances = computed<TransferFinances>(() => {
    const game = this.gs.game();
    const team = this.gs.playerTeam();
    if (!game || !team) return { budget: 0, weeklyWages: 0, wageBudget: 0, wageRoom: 0, fourWeekReserve: 0, spendableAfterReserve: 0 };
    const weeklyWages = weeklyWageBill(game, team.id);
    const reserve = fourWeekReserve(game, team.id);
    return {
      budget: team.coins,
      weeklyWages,
      wageBudget: team.wageBudget,
      wageRoom: Math.max(0, team.wageBudget - weeklyWages),
      fourWeekReserve: reserve,
      spendableAfterReserve: Math.max(0, team.coins - reserve),
    };
  });

  ensureMarket(): void {
    const game = this.gs.game();
    if (!game) return;
    if (game.transfers.freeAgents.length >= 12 && game.transfers.listings.length) return;
    this.gs.mutate((draft) => ensureTransferMarket(draft));
  }

  teamFor(playerId: string): Team | null {
    const game = this.gs.game();
    return game ? locateTransferPlayer(game, playerId)?.team ?? null : null;
  }

  targetFor(playerId: string): TransferTargetView | null {
    return this.targets().find((target) => target.player.id === playerId) ?? null;
  }

  toggleShortlist(playerId: string): void {
    this.gs.mutate((draft) => {
      const index = draft.transfers.shortlist.findIndex((entry) => entry.playerId === playerId);
      if (index >= 0) draft.transfers.shortlist.splice(index, 1);
      else {
        const located = locateTransferPlayer(draft, playerId);
        if (located) draft.transfers.shortlist.unshift({ playerId, teamId: located.team?.id ?? null, addedWeek: draft.league.currentWeek });
      }
    });
  }

  scout(playerId: string): TransferResult {
    let result: TransferResult = { ok: false, reason: 'Kein Spielstand.' };
    this.gs.mutate((draft) => {
      const current = draft.transfers.reports.find((report) => report.playerId === playerId && report.season === draft.league.season);
      if (current) {
        result = { ok: true };
        return;
      }
      const club = draft.teams.find((team) => team.id === draft.clubId);
      const located = locateTransferPlayer(draft, playerId);
      if (!club || !located) {
        result = { ok: false, reason: 'Spieler nicht gefunden.' };
        return;
      }
      const scoutingRank = draft.manager.perks.scouting ?? 0;
      const cost = Math.max(500, SCOUT_COST - scoutingRank * 400);
      if (club.coins < cost) {
        result = { ok: false, reason: 'Nicht genug Budget für den Scoutbericht.' };
        return;
      }
      club.coins -= cost;
      const variance = Math.max(0, 4 - scoutingRank);
      const seedNoise = (hash32(`${draft.league.id}|${draft.league.season}|${playerId}|scout`) % 3) - 1;
      draft.transfers.reports.unshift({
        playerId,
        season: draft.league.season,
        createdWeek: draft.league.currentWeek,
        confidence: clamp(60 + scoutingRank * 10, 60, 100),
        overallMin: clamp(located.player.overall - variance + Math.min(0, seedNoise), 1, 99),
        overallMax: clamp(located.player.overall + variance + Math.max(0, seedNoise), 1, 99),
        potentialMin: clamp(located.player.potential - variance, 1, 99),
        potentialMax: clamp(located.player.potential + variance, 1, 99),
        exact: variance === 0,
      });
      result = { ok: true };
    });
    return result;
  }

  submitOffer(playerId: string, kind: TransferKind, fee: number, wageShare: 50 | 100 = 100, buyOption: number | null = null): TransferResult {
    let result: TransferResult = { ok: false, reason: 'Kein Spielstand.' };
    this.gs.mutate((draft) => { result = submitTransferOffer(draft, playerId, kind, fee, wageShare, buyOption); });
    return result;
  }

  acceptClubCounter(negotiationId: string): TransferResult {
    return this.mutateResult((draft) => acceptClubCounter(draft, negotiationId));
  }

  submitContract(negotiationId: string, contract: ContractProposal): TransferResult {
    return this.mutateResult((draft) => submitPlayerContract(draft, negotiationId, contract));
  }

  acceptAgentCounter(negotiationId: string): TransferResult {
    return this.mutateResult((draft) => acceptAgentCounter(draft, negotiationId));
  }

  listPlayer(playerId: string, askingPrice: number, loanAvailable = false): TransferResult {
    return this.mutateResult((draft) => listPlayerForTransfer(draft, playerId, askingPrice, loanAvailable));
  }

  unlistPlayer(playerId: string): void {
    this.gs.mutate((draft) => removeTransferListing(draft, playerId));
  }

  resolveIncoming(negotiationId: string, action: 'accept' | 'counter' | 'reject', counterFee?: number): TransferResult {
    return this.mutateResult((draft) => resolveIncomingOffer(draft, negotiationId, action, counterFee));
  }

  renewWith(playerId: string, proposal: ContractProposal): TransferResult {
    return this.mutateResult((draft) => renewPlayerContract(draft, playerId, proposal));
  }

  recommendedContract(player: Player): ContractProposal {
    return recommendedContract(player);
  }

  relevantAttributes(player: Player): Array<{ key: AttributeKey; value: number }> {
    const keys: Record<Player['positionGroup'], AttributeKey[]> = {
      GK: ['goalkeeping', 'passing', 'physical'],
      DEF: ['defending', 'physical', 'pace'],
      MID: ['passing', 'dribbling', 'stamina'],
      ATT: ['shooting', 'pace', 'dribbling'],
    };
    return keys[player.positionGroup].map((key) => ({ key, value: player.attributes[key] })).sort((a, b) => b.value - a.value);
  }

  scoutingLabel(target: TransferTargetView): string {
    if (target.report?.exact) return String(target.player.overall);
    if (target.report) return `${target.report.overallMin}-${target.report.overallMax}`;
    const rank = this.gs.manager()?.perks.scouting ?? 0;
    const uncertainty = Math.max(2, 6 - rank);
    return `${Math.max(1, target.player.overall - uncertainty)}-${Math.min(99, target.player.overall + uncertainty)}`;
  }

  isListed(playerId: string): boolean {
    return this.gs.game()?.transfers.listings.some((listing) => listing.playerId === playerId && listing.teamId === this.gs.game()?.clubId) ?? false;
  }

  listingPrice(playerId: string): number {
    return this.gs.game()?.transfers.listings.find((listing) => listing.playerId === playerId)?.askingPrice ?? 0;
  }

  negotiationById(id: string): TransferNegotiation | null {
    return this.negotiations().find((negotiation) => negotiation.id === id) ?? null;
  }

  // Compatibility while the new master-detail UI is mounted in the next commit.
  get refreshCost(): number { return SCOUT_COST; }
  refresh(): boolean { this.ensureMarket(); return true; }
  canBuy(player: Player): { ok: boolean; reason?: string } {
    const target = this.targetFor(player.id);
    const team = this.gs.playerTeam();
    if (!target || !team) return { ok: false, reason: 'Spieler nicht gefunden.' };
    if (team.players.length >= MAX_SQUAD_SIZE) return { ok: false, reason: 'Kader ist voll.' };
    return { ok: true };
  }
  buy(player: Player): boolean {
    const target = this.targetFor(player.id);
    if (!target) return false;
    let result = this.submitOffer(player.id, 'permanent', target.askingPrice);
    if (result.negotiation?.status === 'countered') result = this.acceptClubCounter(result.negotiation.id);
    const negotiation = result.negotiation;
    return !!negotiation && this.submitContract(negotiation.id, recommendedContract(player)).ok;
  }
  sell(playerId: string): boolean {
    const player = this.gs.squad().find((candidate) => candidate.id === playerId);
    return !!player && this.listPlayer(playerId, player.marketValue, false).ok;
  }
  renew(playerId: string, weeks = 104): boolean {
    const player = this.gs.squad().find((candidate) => candidate.id === playerId);
    if (!player) return false;
    const proposal = recommendedContract(player);
    proposal.weeks = [52, 104, 156, 208].includes(weeks) ? weeks as ContractProposal['weeks'] : 104;
    return this.renewWith(playerId, proposal).ok;
  }
  renewalCost(player: Player): number { return recommendedContract(player).signingBonus; }

  private improvesXi(player: Player, team: Team): boolean {
    const comparable = team.formation.slots
      .map((slot) => team.players.find((candidate) => candidate.id === slot.playerId))
      .filter((candidate): candidate is Player => !!candidate && candidate.positionGroup === player.positionGroup);
    return !comparable.length || player.overall > Math.min(...comparable.map((candidate) => candidate.overall));
  }

  private mutateResult(fn: (draft: NonNullable<ReturnType<GameStateService['game']>>) => TransferResult): TransferResult {
    let result: TransferResult = { ok: false, reason: 'Kein Spielstand.' };
    this.gs.mutate((draft) => { result = fn(draft); });
    return result;
  }
}
