import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { TransferService, TransferTargetView, MAX_SQUAD_SIZE } from '../../core/services/transfer.service';
import { I18nPipe } from '../../shared/i18n.pipe';
import { ratingColor, formatCoins } from '../../shared/rating-color';
import { playerName } from '../../core/ratings';
import { Player, PlayerAttributes } from '../../models/player.model';
import { ContractProposal, TransferKind, TransferNegotiation } from '../../models/transfer.model';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { PlayerPortraitComponent } from '../../shared/components/player-portrait.component';
import { RadarChartComponent } from '../../shared/components/radar-chart.component';

type TransferTab = 'market' | 'shortlist' | 'offers' | 'squad';
type TransferModal = 'offer' | 'contract' | 'listing' | 'renewal' | null;

const UI_MEMORY = {
  tab: 'market' as TransferTab,
  search: '',
  position: 'ALL',
  sort: 'relevance',
  priceCap: 0,
  affordable: false,
  improves: false,
  u23: false,
  loan: false,
  listed: false,
  scrollTop: 0,
};

@Component({
  selector: 'app-transfer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe, ClubCrestComponent, PlayerPortraitComponent, RadarChartComponent],
  templateUrl: './transfer.page.html',
  styleUrl: './transfer.page.scss',
})
export class TransferPage {
  protected readonly gs = inject(GameStateService);
  protected readonly transfers = inject(TransferService);
  protected readonly ratingColor = ratingColor;
  protected readonly formatCoins = formatCoins;
  protected readonly playerName = playerName;
  protected readonly maxSquad = MAX_SQUAD_SIZE;
  protected readonly list = viewChild<ElementRef<HTMLElement>>('marketList');

  protected readonly tab = signal<TransferTab>(UI_MEMORY.tab);
  protected readonly search = signal(UI_MEMORY.search);
  protected readonly positionFilter = signal(UI_MEMORY.position);
  protected readonly sort = signal(UI_MEMORY.sort);
  protected readonly priceCap = signal(UI_MEMORY.priceCap);
  protected readonly affordableOnly = signal(UI_MEMORY.affordable);
  protected readonly improvesOnly = signal(UI_MEMORY.improves);
  protected readonly u23Only = signal(UI_MEMORY.u23);
  protected readonly loanOnly = signal(UI_MEMORY.loan);
  protected readonly listedOnly = signal(UI_MEMORY.listed);
  protected readonly positions = ['ALL', 'GK', 'DEF', 'MID', 'ATT'];
  protected readonly selectedId = signal<string | null>(null);
  protected readonly compareIds = signal<string[]>([]);
  protected readonly message = signal('');

  protected readonly modal = signal<TransferModal>(null);
  protected readonly modalPlayerId = signal<string | null>(null);
  protected readonly offerKind = signal<TransferKind>('permanent');
  protected readonly offerFee = signal(0);
  protected readonly wageShare = signal<50 | 100>(100);
  protected readonly buyOption = signal<number | null>(null);
  protected readonly activeNegotiationId = signal<string | null>(null);
  protected readonly contractWeeks = signal<ContractProposal['weeks']>(104);
  protected readonly contractSalary = signal(1_000);
  protected readonly contractRole = signal<ContractProposal['squadRole']>('rotation');
  protected readonly signingBonus = signal(4_000);
  protected readonly listingPrice = signal(0);
  protected readonly listingLoan = signal(false);

  protected readonly finances = this.transfers.finances;
  protected readonly squad = computed(() => [...this.gs.squad()].sort((a, b) => b.overall - a.overall));
  protected readonly contracts = computed(() => [...this.gs.squad()].sort((a, b) => a.contractWeeks - b.contractWeeks));
  protected readonly displayedTargets = computed(() => {
    let targets = this.tab() === 'shortlist' ? this.transfers.shortlist() : this.transfers.targets();
    const query = this.search().trim().toLocaleLowerCase();
    const group = this.positionFilter();
    const cap = this.priceCap();
    const budget = this.finances().budget;
    targets = targets.filter((target) =>
      (group === 'ALL' || target.player.positionGroup === group) &&
      (!query || playerName(target.player).toLocaleLowerCase().includes(query) || target.team?.name.toLocaleLowerCase().includes(query) || target.player.position.toLocaleLowerCase().includes(query)) &&
      (!cap || target.askingPrice <= cap) &&
      (!this.affordableOnly() || target.askingPrice + this.transfers.recommendedContract(target.player).signingBonus <= budget) &&
      (!this.improvesOnly() || target.improvesStartingXi) &&
      (!this.u23Only() || target.player.age < 23) &&
      (!this.loanOnly() || target.loanAvailable) &&
      (!this.listedOnly() || target.freeAgent || this.gs.game()?.transfers.listings.some((listing) => listing.playerId === target.player.id)),
    );
    return [...targets].sort((a, b) => {
      switch (this.sort()) {
        case 'price': return a.askingPrice - b.askingPrice;
        case 'overall': return b.player.overall - a.player.overall;
        case 'potential': return b.player.potential - a.player.potential;
        case 'age': return a.player.age - b.player.age;
        default:
          return Number(b.improvesStartingXi) - Number(a.improvesStartingXi) || Number(b.shortlisted) - Number(a.shortlisted) || a.askingPrice - b.askingPrice;
      }
    });
  });
  protected readonly selectedTarget = computed(() => {
    const displayed = this.displayedTargets();
    return displayed.find((target) => target.player.id === this.selectedId()) ?? displayed[0] ?? null;
  });
  protected readonly compareTargets = computed(() => this.compareIds().map((id) => this.transfers.targetFor(id)).filter((target): target is TransferTargetView => !!target));
  protected readonly currentNegotiation = computed(() => {
    const id = this.activeNegotiationId();
    return id ? this.transfers.negotiationById(id) : null;
  });
  protected readonly modalPlayer = computed(() => {
    const id = this.modalPlayerId();
    return id ? this.findPlayer(id) : null;
  });
  protected readonly bestPeer = computed(() => {
    const target = this.selectedTarget();
    if (!target) return null;
    return this.gs.squad().filter((player) => player.positionGroup === target.player.positionGroup).sort((a, b) => b.overall - a.overall)[0] ?? null;
  });

  constructor() {
    this.transfers.ensureMarket();
    effect(() => {
      UI_MEMORY.tab = this.tab();
      UI_MEMORY.search = this.search();
      UI_MEMORY.position = this.positionFilter();
      UI_MEMORY.sort = this.sort();
      UI_MEMORY.priceCap = this.priceCap();
      UI_MEMORY.affordable = this.affordableOnly();
      UI_MEMORY.improves = this.improvesOnly();
      UI_MEMORY.u23 = this.u23Only();
      UI_MEMORY.loan = this.loanOnly();
      UI_MEMORY.listed = this.listedOnly();
    });
    afterNextRender(() => {
      const list = this.list()?.nativeElement;
      if (list) list.scrollTop = UI_MEMORY.scrollTop;
    });
  }

  protected selectTab(tab: TransferTab): void {
    this.tab.set(tab);
    this.message.set('');
  }

  protected rememberScroll(event: Event): void {
    UI_MEMORY.scrollTop = (event.currentTarget as HTMLElement).scrollTop;
  }

  protected choose(target: TransferTargetView): void {
    this.selectedId.set(target.player.id);
  }

  protected toggleCompare(playerId: string): void {
    this.compareIds.update((ids) => ids.includes(playerId) ? ids.filter((id) => id !== playerId) : [...ids.slice(-2), playerId]);
  }

  protected isCompared(playerId: string): boolean {
    return this.compareIds().includes(playerId);
  }

  protected scout(target: TransferTargetView): void {
    const result = this.transfers.scout(target.player.id);
    this.message.set(result.ok ? 'Scoutbericht abgeschlossen: Werte und Potenzial sind jetzt verlässlicher.' : result.reason ?? 'Scouting fehlgeschlagen.');
  }

  protected openOffer(target: TransferTargetView, kind: TransferKind): void {
    this.modalPlayerId.set(target.player.id);
    this.offerKind.set(kind);
    this.offerFee.set(kind === 'loan' ? Math.max(2_000, Math.round(target.player.marketValue * 0.035 / 1_000) * 1_000) : target.askingPrice);
    this.wageShare.set(100);
    this.buyOption.set(kind === 'loan' ? Math.round(target.player.marketValue / 1_000) * 1_000 : null);
    this.activeNegotiationId.set(null);
    this.modal.set('offer');
  }

  protected submitOffer(): void {
    const player = this.modalPlayer();
    if (!player) return;
    const result = this.transfers.submitOffer(player.id, this.offerKind(), this.offerFee(), this.wageShare(), this.buyOption());
    this.activeNegotiationId.set(result.negotiation?.id ?? null);
    if (!result.ok || result.negotiation?.status === 'rejected') {
      this.message.set(result.reason ?? result.negotiation?.message ?? 'Angebot abgelehnt.');
      this.closeModal();
      return;
    }
    if (result.negotiation?.status === 'countered') {
      this.message.set(result.negotiation.message);
      this.closeModal(false);
      this.selectTab('offers');
      return;
    }
    this.prepareContract(player, result.negotiation!);
  }

  protected acceptClubCounter(negotiation: TransferNegotiation): void {
    const result = this.transfers.acceptClubCounter(negotiation.id);
    const player = this.findPlayer(negotiation.playerId);
    if (!result.ok || !player) this.message.set(result.reason ?? 'Gegenangebot konnte nicht angenommen werden.');
    else this.prepareContract(player, result.negotiation!);
  }

  protected openContractFromOffer(negotiation: TransferNegotiation): void {
    const player = this.findPlayer(negotiation.playerId);
    if (player) this.prepareContract(player, negotiation);
  }

  protected submitContract(): void {
    const negotiation = this.currentNegotiation();
    if (!negotiation) return;
    const result = this.transfers.submitContract(negotiation.id, this.contractProposal());
    if (result.ok && result.negotiation?.status === 'accepted') {
      this.message.set(result.negotiation.message);
      this.closeModal();
    } else if (result.negotiation?.agentCounterUsed && result.negotiation.status === 'contract') {
      this.message.set(result.negotiation.message);
      this.closeModal(false);
      this.selectTab('offers');
    } else {
      this.message.set(result.reason ?? result.negotiation?.message ?? 'Vertrag gescheitert.');
      this.closeModal();
    }
  }

  protected acceptAgentCounter(negotiation: TransferNegotiation): void {
    const result = this.transfers.acceptAgentCounter(negotiation.id);
    this.message.set(result.negotiation?.message ?? result.reason ?? 'Verhandlung aktualisiert.');
  }

  protected openListing(player: Player): void {
    this.modalPlayerId.set(player.id);
    this.listingPrice.set(this.transfers.listingPrice(player.id) || Math.round(player.marketValue * 1.05 / 1_000) * 1_000);
    this.listingLoan.set(player.age <= 24);
    this.modal.set('listing');
  }

  protected saveListing(): void {
    const player = this.modalPlayer();
    if (!player) return;
    const result = this.transfers.listPlayer(player.id, this.listingPrice(), this.listingLoan());
    this.message.set(result.ok ? `${playerName(player)} steht jetzt auf der Transferliste.` : result.reason ?? 'Listung fehlgeschlagen.');
    this.closeModal();
  }

  protected unlist(player: Player): void {
    this.transfers.unlistPlayer(player.id);
    this.message.set(`${playerName(player)} wurde von der Transferliste genommen.`);
  }

  protected openRenewal(player: Player): void {
    this.modalPlayerId.set(player.id);
    this.activeNegotiationId.set(null);
    const proposal = this.transfers.recommendedContract(player);
    this.applyContractProposal(proposal);
    this.modal.set('renewal');
  }

  protected submitRenewal(): void {
    const player = this.modalPlayer();
    if (!player) return;
    const result = this.transfers.renewWith(player.id, this.contractProposal());
    this.message.set(result.ok ? `Vertrag mit ${playerName(player)} verlängert.` : result.reason ?? 'Verlängerung fehlgeschlagen.');
    if (result.ok) this.closeModal();
  }

  protected resolveIncoming(negotiation: TransferNegotiation, action: 'accept' | 'counter' | 'reject'): void {
    const result = this.transfers.resolveIncoming(negotiation.id, action, action === 'counter' ? negotiation.requestedFee : undefined);
    this.message.set(result.negotiation?.message ?? result.reason ?? 'Angebot aktualisiert.');
  }

  protected closeModal(clearNegotiation = true): void {
    this.modal.set(null);
    this.modalPlayerId.set(null);
    if (clearNegotiation) this.activeNegotiationId.set(null);
  }

  protected setPriceCap(raw: string): void { this.priceCap.set(Number(raw) || 0); }
  protected setOfferFee(raw: string): void { this.offerFee.set(Math.max(0, Number(raw) || 0)); }
  protected setBuyOption(raw: string): void { this.buyOption.set(raw ? Math.max(0, Number(raw)) : null); }
  protected setSalary(raw: string): void { this.contractSalary.set(Math.max(0, Number(raw) || 0)); }
  protected setContractWeeks(raw: string): void {
    const value = Number(raw);
    this.contractWeeks.set(value === 52 || value === 156 || value === 208 ? value : 104);
  }
  protected setBonus(raw: string): void { this.signingBonus.set(Math.max(0, Number(raw) || 0)); }
  protected setListingPrice(raw: string): void { this.listingPrice.set(Math.max(0, Number(raw) || 0)); }

  protected overallLabel(target: TransferTargetView): string { return this.transfers.scoutingLabel(target); }
  protected relevant(target: TransferTargetView) { return this.transfers.relevantAttributes(target.player); }
  protected statValue(target: TransferTargetView, value: number): string {
    if (target.report?.exact) return String(value);
    const width = target.report ? Math.max(1, target.report.overallMax - target.report.overallMin) : 6;
    return `${Math.max(1, value - width)}-${Math.min(99, value + width)}`;
  }
  protected radarAttributes(target: TransferTargetView): PlayerAttributes {
    if (target.report?.exact) return target.player.attributes;
    return Object.fromEntries(Object.entries(target.player.attributes).map(([key, value]) => [key, Math.round(value / 10) * 10])) as PlayerAttributes;
  }
  protected costAfter(target: TransferTargetView): number {
    return Math.max(0, this.finances().budget - target.askingPrice - this.transfers.recommendedContract(target.player).signingBonus);
  }
  protected teamName(id: string | null): string {
    return id ? this.gs.teamById(id)?.name ?? 'Free Agents' : 'Free Agents';
  }
  protected playerByNegotiation(negotiation: TransferNegotiation): Player | null { return this.findPlayer(negotiation.playerId); }
  protected teamById(id: string | null) { return id ? this.gs.teamById(id) ?? null : null; }
  protected isTerminal(negotiation: TransferNegotiation): boolean { return ['accepted', 'rejected', 'expired'].includes(negotiation.status); }

  private findPlayer(id: string): Player | null {
    return this.gs.game()?.teams.flatMap((team) => team.players).find((player) => player.id === id)
      ?? this.gs.game()?.transfers.freeAgents.find((player) => player.id === id)
      ?? null;
  }

  private prepareContract(player: Player, negotiation: TransferNegotiation): void {
    this.activeNegotiationId.set(negotiation.id);
    this.modalPlayerId.set(player.id);
    this.applyContractProposal(this.transfers.recommendedContract(player));
    this.modal.set('contract');
  }

  private applyContractProposal(proposal: ContractProposal): void {
    this.contractWeeks.set(proposal.weeks);
    this.contractSalary.set(proposal.salary);
    this.contractRole.set(proposal.squadRole);
    this.signingBonus.set(proposal.signingBonus);
  }

  private contractProposal(): ContractProposal {
    return { weeks: this.contractWeeks(), salary: this.contractSalary(), squadRole: this.contractRole(), signingBonus: this.signingBonus() };
  }
}
