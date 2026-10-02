import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LegendsService } from '../../core/services/legends.service';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { PACKS, TIER_LABELS, TIER_ORDER, quickSellValue } from '../../core/legends/cards';
import {
  DRAFT_ENTRY, DRAFT_REWARDS, DRAFT_ROUNDS, RIVALS_PROMOTION_POINTS, RIVALS_RELEGATION_POINTS, RIVALS_SEASON_MATCHES, SBCS, divisionStrength,
  draftCards, draftChemistry, inSquad, sbcAvailable,
} from '../../core/legends/legends-engine';
import { LEGENDS_FORMATIONS, positionFit } from '../../core/legends/squad';
import { PackResult } from '../../core/legends/legends-engine';
import { CardTier, LegendsCard, LegendsTask, PackId } from '../../models/legends.model';
import { LegendsCardComponent } from '../../shared/components/legends-card.component';
import { groupForPosition } from '../../core/ratings';

type LegendsTab = 'hub' | 'team' | 'packs' | 'collection' | 'tasks' | 'draft';

@Component({
  selector: 'app-legends',
  imports: [FormsModule, RouterLink, LegendsCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './legends.page.html',
  styleUrl: './legends.page.scss',
})
export class LegendsPage {
  protected readonly legends = inject(LegendsService);
  protected readonly gs = inject(GameStateService);
  protected readonly i18n = inject(I18nService);
  protected readonly packs = Object.values(PACKS);
  protected readonly tiers = TIER_ORDER;
  protected readonly formations = LEGENDS_FORMATIONS;
  protected readonly sbcs = SBCS;
  protected readonly draftEntry = DRAFT_ENTRY;
  protected readonly draftRounds = DRAFT_ROUNDS;
  protected readonly draftRewards = DRAFT_REWARDS;
  protected readonly rivalsMatches = RIVALS_SEASON_MATCHES;
  protected readonly promotionPoints = RIVALS_PROMOTION_POINTS;
  protected readonly relegationPoints = RIVALS_RELEGATION_POINTS;
  protected readonly quickSellValue = quickSellValue;
  protected readonly tabs: Array<{ key: LegendsTab; de: string; en: string }> = [
    { key: 'hub', de: 'ÜBERSICHT', en: 'HUB' },
    { key: 'team', de: 'TEAM', en: 'TEAM' },
    { key: 'packs', de: 'PACKS', en: 'PACKS' },
    { key: 'collection', de: 'SAMMLUNG', en: 'COLLECTION' },
    { key: 'tasks', de: 'AUFGABEN', en: 'TASKS' },
    { key: 'draft', de: 'DRAFT', en: 'DRAFT' },
  ];

  protected readonly tab = signal<LegendsTab>('hub');
  protected readonly clubName = signal('');
  protected readonly message = signal('');
  protected readonly selectedSlot = signal<number | null>(null);
  protected readonly opening = signal<PackResult | null>(null);
  protected readonly revealed = signal(0);
  protected readonly tierFilter = signal<CardTier | 'all'>('all');
  protected readonly groupFilter = signal<'all' | 'GK' | 'DEF' | 'MID' | 'ATT'>('all');
  protected readonly page = signal(0);
  protected readonly selling = signal<string[]>([]);
  protected readonly sbcSelection = signal<{ id: string; cards: string[] } | null>(null);
  protected readonly draftSlot = computed(() => this.state()?.draft?.picks.findIndex((pick) => !pick.chosenId) ?? -1);

  protected readonly state = this.legends.state;
  protected readonly seed = computed(() => this.state()?.seed ?? 0);
  protected readonly view = this.legends.squad;
  protected readonly packCounts = computed(() => {
    const counts: Partial<Record<PackId, number>> = {};
    for (const pack of this.state()?.packs ?? []) counts[pack] = (counts[pack] ?? 0) + 1;
    return counts;
  });
  protected readonly filtered = computed(() => {
    const tier = this.tierFilter(), group = this.groupFilter();
    return [...(this.state()?.cards ?? [])]
      .filter((card) => (tier === 'all' || card.tier === tier) && (group === 'all' || card.player.positionGroup === group))
      .sort((a, b) => b.player.overall - a.player.overall || a.player.lastName.localeCompare(b.player.lastName));
  });
  protected readonly pageSize = 24;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));
  protected readonly pagedCards = computed(() => {
    const page = Math.min(this.page(), this.pages() - 1);
    return this.filtered().slice(page * this.pageSize, (page + 1) * this.pageSize);
  });
  protected readonly duplicateIds = computed(() => { this.state(); return new Set(this.legends.duplicates()); });
  /** Cards that fit the selected slot, best fit and rating first. */
  protected readonly slotCandidates = computed(() => {
    const slot = this.selectedSlot();
    const view = this.view();
    if (slot === null || !view) return [];
    const position = view.starters[slot]?.position ?? 'CM';
    return [...(this.state()?.cards ?? [])]
      .filter((card) => card.player.positionGroup === groupForPosition(position) || positionFit(card, position) > 0)
      .sort((a, b) => positionFit(b, position) * 4 + b.player.overall - (positionFit(a, position) * 4 + a.player.overall))
      .slice(0, 18);
  });
  protected readonly draftInfo = computed(() => { const draft = this.state()?.draft; return draft ? draftChemistry(draft) : null; });
  protected readonly draftSquad = computed(() => { const draft = this.state()?.draft; return draft ? draftCards(draft) : []; });

  constructor() {
    if (this.legends.hasClub()) this.legends.refreshTasks();
    if (this.legends.lastReport()) this.tab.set('hub');
  }

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }
  protected tierLabel(tier: CardTier): string { return this.text(TIER_LABELS[tier].de, TIER_LABELS[tier].en); }
  protected packName(id: PackId): string { return this.text(PACKS[id].de, PACKS[id].en); }
  protected percent(value: number): string { return `${Math.round(value * 1000) / 10} %`; }
  protected isInSquad(card: LegendsCard): boolean { const state = this.state(); return !!state && inSquad(state, card.id); }

  protected create(): void {
    this.legends.create(this.clubName().trim() || 'Legends XI');
    this.tab.set('hub');
  }

  protected buy(id: PackId): void {
    const result = this.legends.buy(id);
    this.message.set(result.ok ? this.text(`${PACKS[id].de} gekauft.`, `${PACKS[id].en} bought.`) : this.text('Nicht genug Münzen.', 'Not enough coins.'));
  }

  protected open(id: PackId): void {
    const result = this.legends.open(id);
    if (!result) return;
    this.revealed.set(0);
    this.opening.set(result);
    this.revealNext();
  }

  /** Cards flip one after another; gold and legend cards take a moment longer ("walkout"). */
  private revealNext(): void {
    const result = this.opening();
    if (!result || this.revealed() >= result.cards.length) return;
    const reduced = document.body.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = result.cards[this.revealed()];
    const delay = reduced ? 0 : next.tier === 'legend' ? 1400 : next.tier === 'gold' ? 900 : 380;
    setTimeout(() => { this.revealed.update((count) => count + 1); this.revealNext(); }, delay);
  }

  protected revealAll(): void {
    const result = this.opening();
    if (result) this.revealed.set(result.cards.length);
  }

  protected closePack(): void {
    this.opening.set(null);
  }

  protected toggleSell(card: LegendsCard): void {
    if (this.isInSquad(card)) return;
    this.selling.update((ids) => ids.includes(card.id) ? ids.filter((id) => id !== card.id) : [...ids, card.id]);
  }

  protected sellSelected(): void {
    const coins = this.legends.sell(this.selling());
    this.selling.set([]);
    this.message.set(this.text(`Verkauft für ${coins} Münzen.`, `Sold for ${coins} coins.`));
  }

  protected sellDuplicates(): void {
    const coins = this.legends.sellDuplicates();
    this.message.set(this.text(`Duplikate verkauft: ${coins} Münzen.`, `Duplicates sold: ${coins} coins.`));
  }

  protected sellValue(): number {
    const cards = this.state()?.cards ?? [];
    return this.selling().reduce((sum, id) => sum + quickSellValue(cards.find((card) => card.id === id)!), 0);
  }

  protected chooseForSlot(card: LegendsCard): void {
    const slot = this.selectedSlot();
    if (slot === null) return;
    const result = this.legends.setSlot(slot, card.id);
    if (!result.ok) this.message.set(this.text('Dieser Spieler steht schon im Kader.', 'That player is already in the squad.'));
    else this.selectedSlot.set(null);
  }

  protected taskLabel(task: LegendsTask): string {
    const t = task.target;
    const labels: Record<LegendsTask['kind'], [string, string]> = {
      'win-rivals': [`${t} Rivals-Sieg(e)`, `Win ${t} Rivals match(es)`],
      play: [`${t} Spiele bestreiten`, `Play ${t} matches`],
      goals: [`${t} Tore schießen`, `Score ${t} goals`],
      'open-pack': [`${t} Pack öffnen`, `Open ${t} pack`],
      'draft-win': [`${t} Draft-Siege`, `Win ${t} draft matches`],
      sbc: [`${t} SBC abschließen`, `Complete ${t} SBC`],
      'clean-sheet': [`${t} Spiel ohne Gegentor`, `Keep ${t} clean sheet`],
    };
    return this.text(...labels[task.kind]);
  }

  protected rewardLabel(task: LegendsTask): string {
    return [task.reward.coins ? `${task.reward.coins} ${this.text('Münzen', 'coins')}` : '', task.reward.pack ? this.packName(task.reward.pack) : ''].filter(Boolean).join(' + ');
  }

  protected claim(task: LegendsTask): void {
    if (this.legends.claimTask(task.id)) this.message.set(this.text('Belohnung erhalten.', 'Reward collected.'));
  }

  protected prepareSbc(id: string): void {
    const cards = this.legends.suggestSbc(id);
    if (!cards) { this.message.set(this.text('Deine Sammlung erfüllt die Bedingungen noch nicht (Kaderspieler zählen nicht).', 'Your collection cannot meet the requirements yet (squad players do not count).')); this.sbcSelection.set(null); return; }
    this.sbcSelection.set({ id, cards });
  }

  protected sbcCards(): LegendsCard[] {
    const selection = this.sbcSelection();
    const cards = this.state()?.cards ?? [];
    return selection ? selection.cards.map((id) => cards.find((card) => card.id === id)!).filter(Boolean) : [];
  }

  protected submitSbc(): void {
    const selection = this.sbcSelection();
    if (!selection) return;
    const result = this.legends.submitSbc(selection.id, selection.cards);
    this.sbcSelection.set(null);
    this.message.set(result.ok ? this.text('SBC abgeschlossen. Das Pack liegt bereit.', 'SBC complete. The pack is ready.') : this.text('Die Auswahl erfüllt die Bedingungen nicht.', 'The selection does not meet the requirements.'));
  }

  protected sbcDone(id: string): boolean {
    const state = this.state();
    const sbc = SBCS.find((candidate) => candidate.id === id)!;
    return !!state && !sbcAvailable(state, sbc);
  }

  protected startDraft(): void {
    const result = this.legends.startDraft();
    if (!result.ok) this.message.set(result.reason === 'coins' ? this.text(`Der Eintritt kostet ${DRAFT_ENTRY} Münzen.`, `Entry costs ${DRAFT_ENTRY} coins.`) : this.text('Ein Draft läuft bereits.', 'A draft is already running.'));
  }

  protected pickDraft(slotIndex: number, card: LegendsCard): void {
    if (!this.legends.draftPick(slotIndex, card.id)) this.message.set(this.text('Diesen Spieler hast du schon gewählt.', 'You already picked this player.'));
  }

  protected claimDraft(): void {
    const reward = this.legends.claimDraft();
    if (reward) this.message.set(this.text(`Belohnung: ${reward.coins} Münzen${reward.pack ? ' + ' + this.packName(reward.pack) : ''}.`, `Reward: ${reward.coins} coins${reward.pack ? ' + ' + this.packName(reward.pack) : ''}.`));
  }

  protected divisionStrength = divisionStrength;
}
